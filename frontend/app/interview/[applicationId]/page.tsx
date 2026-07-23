"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { AudioRecorder } from "@/components/AudioRecorder";
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
  const pendingAnswerRef = useRef<Blob | null>(null);
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

  function sendAnswer(blob: Blob) {
    pendingAnswerRef.current = blob;
    setListening(false);
    setSubmitting(true);
    setStalled(false);
    setError(null);
    blob.arrayBuffer().then((audio) => {
      socketRef.current?.emit("answer", {
        applicationId,
        audio,
        filename: "answer.webm",
      });
    });
    clearAnswerTimeout();
    answerTimeoutRef.current = setTimeout(() => {
      setStalled(true);
    }, ANSWER_TIMEOUT_MS);
  }

  function retrySend() {
    if (pendingAnswerRef.current) {
      sendAnswer(pendingAnswerRef.current);
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

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <h1 className="text-2xl font-bold">AI Technical Interview</h1>

      {!started ? (
        <div className="mt-6 flex flex-col gap-3 rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-600">
            This interview listens continuously — just speak your answer. If
            you go quiet for 10 seconds, your answer is submitted
            automatically and the next question follows.
          </p>
          {micError && <p className="text-sm text-red-600">{micError}</p>}
          <button
            onClick={() => void startInterview()}
            className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Start Interview
          </button>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-500">
            {connected ? "Connected" : "Connecting…"}
          </p>

          {error && <p className="mt-4 text-red-600">{error}</p>}

          {result ? (
            <div className="mt-6 rounded-lg border border-green-300 bg-green-50 p-4">
              <h2 className="text-lg font-semibold text-green-800">
                Interview Submitted
              </h2>
              <p className="mt-2 text-sm text-gray-700">{result.message}</p>
              <button
                onClick={() => router.push(`/status/${applicationId}`)}
                className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Back to status
              </button>
            </div>
          ) : question ? (
            <div className="mt-6 flex flex-col gap-4">
              <p className="text-sm text-gray-500">
                Question {question.sequenceOrder}
              </p>
              <p className="text-lg">{question.questionText}</p>
              <audio
                key={question.questionId}
                controls
                autoPlay
                src={apiFileUrl(question.questionAudioUrl)}
                onEnded={() => setListening(true)}
              />
              <AudioRecorder
                stream={stream}
                active={listening}
                onAutoSubmit={sendAnswer}
              />
              {submitting && !stalled && (
                <p className="text-sm text-gray-500">Submitting your answer…</p>
              )}
              {stalled && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <p className="text-sm text-amber-800">
                    That&apos;s taking longer than expected.
                  </p>
                  <button
                    onClick={retrySend}
                    className="mt-2 rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-6 text-gray-500">Waiting for the first question…</p>
          )}
        </>
      )}
    </main>
  );
}
