"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { AudioRecorder } from "@/components/AudioRecorder";
import { VoiceVisualizer } from "@/components/VoiceVisualizer";
import { API_BASE_URL, apiFileUrl } from "@/lib/api";

const ANSWER_TIMEOUT_MS = 20_000;

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
  const [connected, setConnected] = useState(false);
  const [question, setQuestion] = useState<TurnView | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [listening, setListening] = useState(false);
  const [stalled, setStalled] = useState(false);

  function clearAnswerTimeout() {
    if (answerTimeoutRef.current) {
      clearTimeout(answerTimeoutRef.current);
      answerTimeoutRef.current = null;
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
    setMicError(null);
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = micStream;
      setStream(micStream);
    } catch {
      setMicError(
        "Could not access the microphone. Check your browser's permission prompt and try again.",
      );
      return;
    }
    setStarted(true);
  }

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
      streamRef.current?.getTracks().forEach((track) => track.stop());
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
      streamRef.current?.getTracks().forEach((track) => track.stop());
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
          {micError && <p className="text-sm text-red-400">{micError}</p>}
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
        {question && <span>Question {question.sequenceOrder}</span>}
      </div>

      {error && (
        <p className="mx-6 rounded-lg border border-red-800 bg-red-950 p-3 text-sm text-red-300">
          {error}
        </p>
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
            <div
              className={`flex h-40 w-40 items-center justify-center rounded-full border transition-colors duration-500 ${
                listening
                  ? "border-brand-500 bg-brand-500/10"
                  : "border-gray-700 bg-gray-900"
              }`}
            >
              <div
                className={`h-24 w-24 rounded-full transition-all duration-500 ${
                  listening ? "bg-brand-500/30" : "bg-gray-800"
                }`}
              />
            </div>

            <VoiceVisualizer stream={stream} active={listening} />

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
                stream={stream}
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
            <VoiceVisualizer stream={stream} active={false} />
            <p className="text-gray-400">Waiting for the first question…</p>
          </>
        )}
      </div>
    </main>
  );
}
