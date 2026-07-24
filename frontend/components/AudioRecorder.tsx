"use client";

import { useEffect, useRef, useState } from "react";

// Tunable knobs for the silence-based auto-submit behavior.
const SILENCE_THRESHOLD = 0.02; // RMS amplitude below this counts as silence
const SILENCE_MS = 10_000;
const MAX_TURN_MS = 120_000; // safety cap if the candidate never pauses
const COUNTDOWN_WARN_MS = 5_000; // show the countdown once this close to auto-submit
const TICK_INTERVAL_MS = 100; // setInterval, not requestAnimationFrame — keeps ticking in a backgrounded tab

/**
 * Hands-free answer capture: while `active`, continuously records from the
 * shared mic `stream` and watches its volume via the Web Audio API. Once the
 * candidate has been silent for SILENCE_MS, it stops the recording and hands
 * the clip to `onAutoSubmit` — no manual Start/Stop/Submit clicks. A "Submit
 * now" button lets a candidate who finishes early skip the rest of the wait.
 */
export function AudioRecorder({
  stream,
  active,
  onAutoSubmit,
}: {
  stream: MediaStream | null;
  active: boolean;
  onAutoSubmit: (blob: Blob) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [silenceMs, setSilenceMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSpeechAtRef = useRef(0);
  const turnStartAtRef = useRef(0);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (!active || !stream) return;

    submittedRef.current = false;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      // Deferred: effects must not call setState synchronously in their own
      // body (react-hooks/set-state-in-effect) — a microtask moves it just
      // outside that window without any perceptible delay.
      queueMicrotask(() => setError("This browser can't record audio."));
      return;
    }
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const audioCtx = audioCtxRef.current;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buffer = new Uint8Array(analyser.fftSize);

    const now = performance.now();
    lastSpeechAtRef.current = now;
    turnStartAtRef.current = now;

    recorder.onstop = () => {
      source.disconnect();
      onAutoSubmit(new Blob(chunksRef.current, { type: recorder.mimeType }));
    };

    function stopAndSubmit() {
      if (submittedRef.current) return;
      submittedRef.current = true;
      if (tickIntervalRef.current !== null) clearInterval(tickIntervalRef.current);
      recorder.stop();
    }

    function tick() {
      analyser.getByteTimeDomainData(buffer);
      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i++) {
        const normalized = (buffer[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / buffer.length);
      const nowTs = performance.now();
      if (rms > SILENCE_THRESHOLD) {
        lastSpeechAtRef.current = nowTs;
      }
      const silenceDuration = nowTs - lastSpeechAtRef.current;
      setSilenceMs(silenceDuration);

      if (
        silenceDuration >= SILENCE_MS ||
        nowTs - turnStartAtRef.current >= MAX_TURN_MS
      ) {
        stopAndSubmit();
      }
    }

    recorderRef.current = recorder;
    recorder.start(250);
    // setInterval (not requestAnimationFrame) so silence/max-duration detection
    // keeps running — at a throttled but nonzero rate — if the candidate
    // switches tabs mid-answer; rAF fully suspends in backgrounded tabs and
    // would otherwise leave the recording (and the interview) hanging forever.
    tickIntervalRef.current = setInterval(tick, TICK_INTERVAL_MS);

    return () => {
      if (tickIntervalRef.current !== null) clearInterval(tickIntervalRef.current);
      if (recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      source.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onAutoSubmit is stable per render, re-running on it would restart the recorder mid-turn
  }, [active, stream]);

  function submitNow() {
    if (submittedRef.current) return;
    submittedRef.current = true;
    if (tickIntervalRef.current !== null) clearInterval(tickIntervalRef.current);
    recorderRef.current?.stop();
  }

  if (!active) return null;

  const secondsLeft = Math.max(0, Math.ceil((SILENCE_MS - silenceMs) / 1000));
  const showCountdown = silenceMs >= SILENCE_MS - COUNTDOWN_WARN_MS;

  return (
    <div className="flex flex-col items-center gap-3">
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" />
        <p className="text-sm text-gray-400">
          {showCountdown
            ? `Listening… submitting in ${secondsLeft}s`
            : "Listening…"}
        </p>
      </div>
      <button
        type="button"
        onClick={submitNow}
        className="rounded-full bg-gray-800 px-4 py-2 text-xs font-medium text-gray-200 hover:bg-gray-700"
      >
        Submit now
      </button>
    </div>
  );
}
