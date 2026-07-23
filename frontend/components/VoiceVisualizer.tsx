"use client";

import { useEffect, useRef } from "react";

const BAR_COUNT = 40;
const IDLE_SPEED = 0.0018;

/**
 * Canvas frequency-bar visualizer. Opens its own AudioContext/AnalyserNode
 * on `stream` (a MediaStream can feed multiple independent consumers, so
 * this doesn't interfere with AudioRecorder's own analyser on the same
 * stream). While `active` is false (AI speaking / idle), renders a slow
 * ambient breathing animation with no audio graph at all — cheap and
 * intentionally distinct from the reactive state.
 */
export function VoiceVisualizer({
  stream,
  active,
}: {
  stream: MediaStream | null;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    function drawBars(levels: number[]) {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const gap = 4;
      const barWidth = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT;
      for (let i = 0; i < BAR_COUNT; i++) {
        const level = levels[i] ?? 0;
        const barHeight = Math.max(4, level * height);
        const x = i * (barWidth + gap);
        const y = (height - barHeight) / 2;
        ctx.fillStyle = `rgba(59, 111, 240, ${0.45 + level * 0.55})`;
        const radius = Math.min(barWidth / 2, 3);
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, radius);
        ctx.fill();
      }
    }

    if (!active || !stream) {
      let t = 0;
      function idleTick() {
        t += 1;
        const levels = Array.from({ length: BAR_COUNT }, (_, i) => {
          const phase = t * IDLE_SPEED * 1000 + i * 0.35;
          return 0.08 + 0.05 * (1 + Math.sin(phase));
        });
        drawBars(levels);
        rafRef.current = requestAnimationFrame(idleTick);
      }
      idleTick();
      return () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      };
    }

    let audioCtx: AudioContext;
    let source: MediaStreamAudioSourceNode;
    let analyser: AnalyserNode;
    try {
      audioCtx = new AudioContext();
      source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
    } catch {
      return;
    }
    const freqData = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser.getByteFrequencyData(freqData);
      const step = Math.floor(freqData.length / BAR_COUNT) || 1;
      const levels = Array.from({ length: BAR_COUNT }, (_, i) => {
        const value = freqData[i * step] ?? 0;
        return value / 255;
      });
      drawBars(levels);
      rafRef.current = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      source.disconnect();
      void audioCtx.close();
    };
  }, [active, stream]);

  return (
    <canvas
      ref={canvasRef}
      className="h-24 w-full max-w-md"
      aria-hidden
    />
  );
}
