"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { AudioRecorder } from "@/components/AudioRecorder";
import { CircularVoiceVisualizer } from "@/components/CircularVoiceVisualizer";
import { CameraPreview } from "@/components/interview/CameraPreview";
import { MonitoringStatusBadge } from "@/components/interview/MonitoringStatusBadge";
import { WarningToast } from "@/components/interview/WarningToast";
import { useInterviewMonitoring } from "@/hooks/useInterviewMonitoring";
import { API_BASE_URL, apiFileUrl } from "@/lib/api";
import { requestCameraAndMic } from "@/lib/monitoring/cameraService";

const ANSWER_TIMEOUT_MS = 20_000;
const FORCED_SUBMISSION_MESSAGE =
  "You have exceeded the maximum allowed warnings. Your interview has been submitted automatically.";

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
  const pendingAnswerRef = useRef<{ blob: Blob; questionId: string } | null>(
    null,
  );
  const answerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setCameraError(null);
    setMicrophoneError(null);
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
  }

  const handleVideoReady = useCallback((video: HTMLVideoElement | null) => {
    setVideoEl(video);
  }, []);

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

  if (!started) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 p-6">
        <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h1 className="text-xl font-semibold text-white">
            AI Technical Interview
          </h1>
          <p className="text-sm text-gray-400">
            This is a live conversation — the interview begins as soon as you
            join. Just speak your answers naturally; if you go quiet for 10
            seconds, your answer is submitted automatically and the next
            question follows. No buttons to press.
          </p>
          <p className="text-xs text-gray-500">
            This interview is proctored: your camera stays on, the tab must
            stay in focus and fullscreen, and the session ends automatically
            after repeated warnings.
          </p>
          {cameraError && <p className="text-sm text-red-400">{cameraError}</p>}
          {microphoneError && (
            <p className="text-sm text-red-400">{microphoneError}</p>
          )}
          <button
            onClick={() => void startInterview()}
            className="self-start rounded-full bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-500"
          >
            Join Interview
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-gray-950 text-white">
      <div className="flex items-center justify-between px-6 py-4 text-sm text-gray-400">
        <span>{connected ? "Connected" : "Connecting…"}</span>
        <div className="flex items-center gap-3">
          {question && <span>Question {question.sequenceOrder}</span>}
          <MonitoringStatusBadge warningTotal={monitoring.warningTotal} />
        </div>
      </div>

      {error && (
        <p className="mx-6 rounded-lg border border-red-800 bg-red-950 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {monitoring.fullscreenLost && !result && (
        <div className="mx-6 flex items-center justify-between rounded-lg border border-amber-800 bg-amber-950 p-3">
          <p className="text-sm text-amber-300">
            Please return to fullscreen to continue your interview.
          </p>
          <button
            onClick={monitoring.requestFullscreenAgain}
            className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500"
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
          <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-green-800 bg-green-950 p-6 text-center">
            <h2 className="text-lg font-semibold text-green-300">
              Interview Complete
            </h2>
            <p className="text-sm text-green-200">{result.message}</p>
            <button
              onClick={() => router.push(`/status/${applicationId}`)}
              className="mx-auto mt-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-500"
            >
              Back to status
            </button>
          </div>
        ) : question ? (
          <>
            <CircularVoiceVisualizer stream={stream} active={listening} />

            <p className="max-w-xl text-center text-lg text-gray-100">
              {question.questionText}
            </p>

            <audio
              key={question.questionId}
              autoPlay
              src={apiFileUrl(question.questionAudioUrl)}
              onEnded={() => setListening(true)}
              className="hidden"
            />

            <div className="w-full max-w-md">
              <AudioRecorder
                stream={audioOnlyStream}
                active={listening}
                onAutoSubmit={sendAnswer}
              />
              {submitting && !stalled && (
                <p className="mt-2 text-center text-sm text-gray-400">
                  Submitting your answer…
                </p>
              )}
              {stalled && (
                <div className="mt-2 rounded-lg border border-amber-800 bg-amber-950 p-3">
                  <p className="text-sm text-amber-300">
                    That&apos;s taking longer than expected.
                  </p>
                  <button
                    onClick={retrySend}
                    className="mt-2 rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500"
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
            <p className="text-gray-400">Waiting for the first question…</p>
          </>
        )}
      </div>

      {!result && (
        <CameraPreview stream={stream} onVideoReady={handleVideoReady} />
      )}
    </main>
  );
}
