"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { AudioRecorder } from "@/components/AudioRecorder";
import { CircularVoiceVisualizer } from "@/components/CircularVoiceVisualizer";
import { CameraPreview } from "@/components/interview/CameraPreview";
import { EyeTrackingBadge } from "@/components/interview/EyeTrackingBadge";
import { MonitoringStatusBadge } from "@/components/interview/MonitoringStatusBadge";
import { WarningToast } from "@/components/interview/WarningToast";
import { useInterviewMonitoring } from "@/hooks/useInterviewMonitoring";
import { API_BASE_URL, apiFetch, apiFileUrl } from "@/lib/api";
import { requestCameraAndMic } from "@/lib/monitoring/cameraService";

const ANSWER_TIMEOUT_MS = 20_000;
// Not a flat per-question deadline — re-armed on every timeupdate tick (see
// the question effect below), so this only ever measures a stretch of zero
// playback progress, not a question's actual length. Purely a safety net
// for play() neither resolving, rejecting, nor ever firing onended/onerror
// (a hung network read, a browser quirk). Without this, that failure mode
// leaves the candidate on a frozen screen forever: listening never flips
// true, so AudioRecorder (silence-detection *and* the manual submit button)
// never mounts, with no error and no way out.
const AUDIO_STUCK_TIMEOUT_MS = 20_000;
const FORCED_SUBMISSION_MESSAGE =
  "You have exceeded the maximum allowed warnings. Your interview has been submitted automatically.";

// A real (if silent) WAV, not an empty src — playing it is what actually
// registers as media playback with the browser's autoplay-activation
// tracking, which an empty/no-op play() call does not.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

interface TurnView {
  questionId: string;
  sequenceOrder: number;
  questionText: string;
  questionAudioUrl: string;
}

interface ResultView {
  status: "COMPLETED";
  message: string;
}

export default function InterviewPage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // A plain (non-DOM) Audio object, not a rendered <audio> element — a
  // fresh element per question (or one created after the "Join" click's
  // gesture has already expired) never counts as a user-activated play(),
  // so browsers silently block it. Priming *this one* instance during the
  // Join click's synchronous call stack (see startInterview) unlocks it for
  // every later programmatic .play() call on the same instance, gesture or
  // not — reusing it for every question is what keeps that unlock alive.
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const pendingAnswerRef = useRef<{ blob: Blob; questionId: string } | null>(
    null,
  );
  const answerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function getAudioEl(): HTMLAudioElement {
    if (!audioElRef.current) {
      audioElRef.current = new Audio();
    }
    return audioElRef.current;
  }

  const [statusChecked, setStatusChecked] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [alreadySubmittedToast, setAlreadySubmittedToast] = useState(false);
  const [started, setStarted] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioOnlyStream, setAudioOnlyStream] = useState<MediaStream | null>(
    null,
  );
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [connected, setConnected] = useState(false);
  const [question, setQuestion] = useState<TurnView | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [listening, setListening] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [joining, setJoining] = useState(false);
  const [audioStuck, setAudioStuck] = useState(false);
  const audioStuckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const monitoring = useInterviewMonitoring(applicationId, videoEl, started);

  function clearAnswerTimeout() {
    if (answerTimeoutRef.current) {
      clearTimeout(answerTimeoutRef.current);
      answerTimeoutRef.current = null;
    }
  }

  function stopMedia() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }

  // Tags every submission with the question it was actually recorded for.
  // A stalled request's "Retry" resends the exact same (blob, questionId)
  // pair — if the original slow-but-not-failed request already went through
  // by the time this fires, the backend detects the mismatch against its
  // now-current pending question instead of silently attaching this stale
  // audio to the wrong one.
  function emitAnswer(blob: Blob, questionId: string) {
    setListening(false);
    setSubmitting(true);
    setStalled(false);
    setError(null);
    blob.arrayBuffer().then((audio) => {
      socketRef.current?.emit("answer", {
        applicationId,
        audio,
        filename: "answer.webm",
        questionId,
      });
    });
    clearAnswerTimeout();
    answerTimeoutRef.current = setTimeout(() => {
      setStalled(true);
    }, ANSWER_TIMEOUT_MS);
  }

  function sendAnswer(blob: Blob) {
    if (!question) return;
    pendingAnswerRef.current = { blob, questionId: question.questionId };
    emitAnswer(blob, question.questionId);
  }

  function retrySend() {
    if (pendingAnswerRef.current) {
      emitAnswer(
        pendingAnswerRef.current.blob,
        pendingAnswerRef.current.questionId,
      );
    }
  }

  async function startInterview() {
    if (joining) return;
    // Must run synchronously, in the same call stack as the click that
    // triggered this handler — anything after the first `await` below no
    // longer carries the click's user-activation, so priming here (not in
    // the question effect, which only ever runs after an async WS
    // round-trip) is what makes every later question play automatically.
    const audio = getAudioEl();
    audio.src = SILENT_WAV;
    void audio
      .play()
      .then(() => audio.pause())
      .catch(() => undefined);

    setJoining(true);
    setCameraError(null);
    setMicrophoneError(null);
    try {
      const media = await requestCameraAndMic();
      if (!media.stream) {
        setCameraError(media.cameraError ?? null);
        setMicrophoneError(media.microphoneError ?? null);
        return;
      }
      streamRef.current = media.stream;
      setStream(media.stream);
      setAudioOnlyStream(new MediaStream(media.stream.getAudioTracks()));
      setStarted(true);
    } finally {
      setJoining(false);
    }
  }

  const handleVideoReady = useCallback((video: HTMLVideoElement | null) => {
    setVideoEl(video);
  }, []);

  // Checked once up front, before the Join screen ever renders — without
  // this, a candidate revisiting a finished interview's link would see the
  // normal Join button, click it, and only find out it's already over once
  // the WS 'join' handler rejects them. A transient failure here (network
  // hiccup) falls through to the normal join flow rather than blocking a
  // legitimate candidate — the WS handler still enforces this server-side
  // as a backstop either way.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ candidateStatus: string }>(
      `/interview-sessions/${applicationId}/status`,
    )
      .then((status) => {
        if (cancelled) return;
        if (status.candidateStatus !== "INTERVIEW_PENDING") {
          setAlreadySubmitted(true);
          setAlreadySubmittedToast(true);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setStatusChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  useEffect(() => {
    if (!alreadySubmitted) return;
    const timeout = setTimeout(() => {
      router.replace(`/status/${applicationId}`);
    }, 2500);
    return () => clearTimeout(timeout);
  }, [alreadySubmitted, applicationId, router]);

  // Forced early submission (5-warning cap) — stop everything and show the
  // same terminal card a natural completion shows, with a different
  // message. Deferred: effects must not call setState synchronously in
  // their own body — a microtask moves it just outside that window (same
  // pattern as AudioRecorder.tsx).
  useEffect(() => {
    if (!monitoring.forcedSubmission) return;
    clearAnswerTimeout();
    socketRef.current?.disconnect();
    stopMedia();
    queueMicrotask(() => {
      setSubmitting(false);
      setListening(false);
      setResult({ status: "COMPLETED", message: FORCED_SUBMISSION_MESSAGE });
    });
  }, [monitoring.forcedSubmission]);

  useEffect(() => {
    if (!started) return;

    const socket = io(`${API_BASE_URL}/interviews`);
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      // A prior connect_error/drop may have left a stale banner up — Socket.IO
      // auto-reconnects on its own (see interview.gateway.ts's disconnect
      // grace period), and a successful (re)connect means whatever it said is
      // no longer true.
      setError(null);
      socket.emit("join", { applicationId });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () =>
      setError("Could not connect to the interview server."),
    );
    socket.on("question", (turn: TurnView) => {
      clearAnswerTimeout();
      setQuestion(turn);
      setSubmitting(false);
      setStalled(false);
    });
    socket.on("completed", (finalResult: ResultView) => {
      clearAnswerTimeout();
      setResult(finalResult);
      setSubmitting(false);
      setListening(false);
      stopMedia();
    });
    socket.on("error", (payload: { message: string }) => {
      clearAnswerTimeout();
      setError(payload.message);
      setSubmitting(false);
      setStalled(false);
    });

    return () => {
      clearAnswerTimeout();
      socket.disconnect();
      stopMedia();
    };
  }, [started, applicationId]);

  function clearAudioStuckTimeout() {
    if (audioStuckTimeoutRef.current) {
      clearTimeout(audioStuckTimeoutRef.current);
      audioStuckTimeoutRef.current = null;
    }
  }

  function armAudioStuckTimeout() {
    clearAudioStuckTimeout();
    audioStuckTimeoutRef.current = setTimeout(() => {
      setAudioStuck(true);
    }, AUDIO_STUCK_TIMEOUT_MS);
  }

  // Reuses the single Audio instance startInterview() already unlocked
  // during the Join click's user gesture — swapping its src and playing
  // again doesn't need a fresh gesture, so this plays automatically with no
  // button, even after the WS round-trip to fetch/generate this question.
  useEffect(() => {
    if (!question) return;
    setAudioStuck(false);
    const audio = getAudioEl();
    audio.onended = () => {
      clearAudioStuckTimeout();
      setListening(true);
    };
    // A load/decode failure rejects play() on some browsers but only fires
    // this event on others — covering both is what makes the stuck-fallback
    // below actually reliable instead of depending on which failure mode
    // happens to occur.
    audio.onerror = () => setAudioStuck(true);
    // Re-arms on every progress tick (fires ~4x/sec while actually playing),
    // so the timeout only ever measures a stretch of *zero* progress — a
    // genuinely long question (30s+ of speech) never trips it just for
    // being long, only a real stall (load hang, dead connection) does.
    audio.ontimeupdate = armAudioStuckTimeout;
    audio.src = apiFileUrl(question.questionAudioUrl);
    void audio.play().catch(() => undefined);
    armAudioStuckTimeout();
    return clearAudioStuckTimeout;
  }, [question]);

  function retryQuestionAudio() {
    if (!question) return;
    setAudioStuck(false);
    const audio = getAudioEl();
    audio.src = apiFileUrl(question.questionAudioUrl);
    void audio.play().catch(() => undefined);
    armAudioStuckTimeout();
  }

  if (!statusChecked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-dark-bg p-6">
        <p className="flex items-center gap-2 text-sm text-dark-text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
          Loading…
        </p>
      </main>
    );
  }

  if (alreadySubmitted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-dark-bg p-6">
        {alreadySubmittedToast && (
          <WarningToast
            message="This interview has already been submitted."
            onDismiss={() => setAlreadySubmittedToast(false)}
          />
        )}
        <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-dark-border bg-dark-surface p-6 text-center">
          <h1 className="text-lg font-semibold text-dark-text">
            Already submitted
          </h1>
          <p className="text-sm text-dark-text-muted">
            This interview has already been completed. Redirecting you to
            your application status…
          </p>
          <button
            type="button"
            onClick={() => router.replace(`/status/${applicationId}`)}
            className="mx-auto mt-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            View status
          </button>
        </div>
      </main>
    );
  }

  if (!started) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-dark-bg p-6">
        <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-dark-border bg-dark-surface p-6">
          <h1 className="text-xl font-semibold text-dark-text">
            AI Technical Interview
          </h1>
          <p className="text-sm text-dark-text-muted">
            This is a live conversation — the interview begins as soon as you
            join. Just speak your answers naturally; if you go quiet for 10
            seconds, your answer is submitted automatically and the next
            question follows. No buttons to press.
          </p>
          <p className="text-xs text-dark-text-subtle">
            This interview is proctored: your camera stays on, the tab must
            stay in focus and fullscreen, and the session ends automatically
            after repeated warnings.
          </p>
          {cameraError && (
            <p className="text-sm text-dark-danger-text">{cameraError}</p>
          )}
          {microphoneError && (
            <p className="text-sm text-dark-danger-text">{microphoneError}</p>
          )}
          <button
            onClick={() => void startInterview()}
            disabled={joining}
            className="self-start rounded-full bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-brand-600/50"
          >
            {joining ? "Joining…" : "Join Interview"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-dark-bg text-dark-text">
      <div className="flex items-center justify-between px-6 py-4 text-sm text-dark-text-muted">
        <span>{connected ? "Connected" : "Connecting…"}</span>
        <div className="flex items-center gap-3">
          {question && <span>Question {question.sequenceOrder}</span>}
          <EyeTrackingBadge state={monitoring.eyeTracking} modelsReady={monitoring.modelsReady} />
          <MonitoringStatusBadge warningTotal={monitoring.warningTotal} />
        </div>
      </div>

      {error && (
        <p className="mx-6 rounded-lg border border-dark-danger-border bg-dark-danger-bg p-3 text-sm text-dark-danger-text">
          {error}
        </p>
      )}

      {monitoring.fullscreenLost && !result && (
        <div className="mx-6 flex items-center justify-between rounded-lg border border-dark-warning-border bg-dark-warning-bg p-3">
          <p className="text-sm text-dark-warning-text">
            Please return to fullscreen to continue your interview.
          </p>
          <button
            onClick={monitoring.requestFullscreenAgain}
            className="rounded bg-dark-warning-solid px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-dark-warning-solid-hover"
          >
            Return to fullscreen
          </button>
        </div>
      )}

      {monitoring.toast && (
        <WarningToast
          key={monitoring.toast.id}
          message={monitoring.toast.message}
          onDismiss={monitoring.dismissToast}
        />
      )}

      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-24">
        {result ? (
          <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-dark-success-border bg-dark-success-bg p-6 text-center">
            <h2 className="text-lg font-semibold text-dark-success-text">
              Interview Complete
            </h2>
            <p className="text-sm text-dark-success-text-secondary">{result.message}</p>
            <button
              onClick={() => router.push(`/status/${applicationId}`)}
              className="mx-auto mt-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              Back to status
            </button>
          </div>
        ) : question ? (
          <>
            <CircularVoiceVisualizer stream={stream} active={listening} />

            <p className="max-w-xl text-center text-lg text-dark-text-secondary">
              {question.questionText}
            </p>

            {audioStuck && !listening && (
              <div className="w-full max-w-md rounded-lg border border-dark-warning-border bg-dark-warning-bg p-3 text-center">
                <p className="text-sm text-dark-warning-text">
                  The question audio didn&apos;t play. Check your sound, then
                  try again.
                </p>
                <button
                  onClick={retryQuestionAudio}
                  className="mt-2 rounded bg-dark-warning-solid px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-dark-warning-solid-hover"
                >
                  Retry
                </button>
              </div>
            )}

            <div className="w-full max-w-md">
              <AudioRecorder
                stream={audioOnlyStream}
                active={listening}
                onAutoSubmit={sendAnswer}
              />
              {submitting && !stalled && (
                <p className="mt-2 flex items-center justify-center gap-2 text-center text-sm text-dark-text-muted">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
                  Submitting your answer…
                </p>
              )}
              {stalled && (
                <div className="mt-2 rounded-lg border border-dark-warning-border bg-dark-warning-bg p-3">
                  <p className="text-sm text-dark-warning-text">
                    That&apos;s taking longer than expected.
                  </p>
                  <button
                    onClick={retrySend}
                    className="mt-2 rounded bg-dark-warning-solid px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-dark-warning-solid-hover"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <CircularVoiceVisualizer stream={stream} active={false} />
            <p className="text-dark-text-muted">Waiting for the first question…</p>
          </>
        )}
      </div>

      {!result && (
        <CameraPreview stream={stream} onVideoReady={handleVideoReady} />
      )}
    </main>
  );
}
