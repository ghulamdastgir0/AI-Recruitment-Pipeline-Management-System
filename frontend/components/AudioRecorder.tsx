"use client";

import { useRef, useState } from "react";

/**
 * Records a single spoken answer via the browser mic (MediaRecorder,
 * webm/opus — satisfies the backend's `/^audio\//` mimetype validator).
 * Lets the user preview and re-record before submitting, since a silent or
 * failed recording is easy to produce by accident.
 */
export function AudioRecorder({
  onSubmit,
  disabled,
}: {
  onSubmit: (blob: Blob) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  async function startRecording() {
    setError(null);
    setRecordedBlob(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        setRecordedBlob(new Blob(chunksRef.current, { type: recorder.mimeType }));
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError(
        "Could not access the microphone. Check your browser's permission prompt.",
      );
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  function reset() {
    setRecordedBlob(null);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!recordedBlob && (
        <button
          type="button"
          disabled={disabled}
          onClick={recording ? stopRecording : startRecording}
          className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
            recording ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {recording ? "Stop Recording" : "Start Recording"}
        </button>
      )}

      {recordedBlob && (
        <div className="flex flex-col gap-2">
          <audio controls src={URL.createObjectURL(recordedBlob)} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSubmit(recordedBlob)}
              className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              Submit Answer
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={reset}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              Re-record
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
