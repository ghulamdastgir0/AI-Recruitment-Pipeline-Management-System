"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { AudioRecorder } from "@/components/AudioRecorder";
import { API_BASE_URL, apiFileUrl } from "@/lib/api";

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
  const [connected, setConnected] = useState(false);
  const [question, setQuestion] = useState<TurnView | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
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
      setQuestion(turn);
      setSubmitting(false);
    });
    socket.on("completed", (finalResult: ResultView) => {
      setResult(finalResult);
      setSubmitting(false);
    });
    socket.on("error", (payload: { message: string }) => {
      setError(payload.message);
      setSubmitting(false);
    });

    return () => {
      socket.disconnect();
    };
  }, [applicationId]);

  async function handleAnswer(blob: Blob) {
    setSubmitting(true);
    setError(null);
    const audio = await blob.arrayBuffer();
    socketRef.current?.emit("answer", {
      applicationId,
      audio,
      filename: "answer.webm",
    });
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <h1 className="text-2xl font-bold">AI Technical Interview</h1>
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
          <p className="text-sm text-gray-500">Question {question.sequenceOrder}</p>
          <p className="text-lg">{question.questionText}</p>
          <audio controls autoPlay src={apiFileUrl(question.questionAudioUrl)} />
          <AudioRecorder onSubmit={handleAnswer} disabled={submitting} />
          {submitting && (
            <p className="text-sm text-gray-500">Submitting your answer…</p>
          )}
        </div>
      ) : (
        <p className="mt-6 text-gray-500">Waiting for the first question…</p>
      )}
    </main>
  );
}
