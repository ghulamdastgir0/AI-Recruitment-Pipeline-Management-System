"use client";

import { useEffect, useRef } from "react";

const BAR_COUNT = 48;
const IDLE_SPEED = 0.0015;
const SMOOTHING = 0.35; // per-frame lerp factor toward the target level — keeps bars fluid instead of jittery

/**
 * Canvas-based circular/radial frequency visualizer for the AI interview
 * call screen — a glowing pulsing core with frequency-reactive bars radiating
 * around it, replacing the old horizontal-bar VoiceVisualizer for this
 * screen's "single centered glowing orb" design language (see the Stitch
 * design doc for this project). Opens its own AudioContext/AnalyserNode on
 * `stream` (a MediaStream can feed multiple independent consumers, so this
 * doesn't interfere with AudioRecorder's own analyser on the same stream).
 * While `active` is false (AI speaking / idle), renders a slow ambient
 * breathing glow with no audio graph at all.
 */
export function CircularVoiceVisualizer({
  stream,
  active,
  size = 240,
}: {
  stream: MediaStream | null;
  active: boolean;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const smoothedRef = useRef<number[]>(new Array(BAR_COUNT).fill(0));

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

    const cx = width / 2;
    const cy = height / 2;
    const coreBaseRadius = Math.min(width, height) * 0.17;
    const barInnerRadius = Math.min(width, height) * 0.24;
    const barMaxLength = Math.min(width, height) * 0.2;

    function drawFrame(targetLevels: number[], avg: number) {
      if (!ctx) return;
      const smoothed = smoothedRef.current;
      ctx.clearRect(0, 0, width, height);

      // Outer glow halo behind the core, scaled by overall volume.
      const coreRadius = coreBaseRadius * (0.9 + avg * 0.5);
      const halo = ctx.createRadialGradient(
        cx,
        cy,
        0,
        cx,
        cy,
        coreRadius * 2.2,
      );
      // Colors mirror the brand tokens in globals.css (brand-400/500) so the
      // visualizer doesn't silently drift from the rest of the UI's blue.
      halo.addColorStop(0, "rgba(98,141,245,0.55)"); // brand-400
      halo.addColorStop(0.55, "rgba(59,111,240,0.18)"); // brand-500
      halo.addColorStop(1, "rgba(59,111,240,0)"); // brand-500
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius * 2.2, 0, Math.PI * 2);
      ctx.fill();

      // Radial frequency bars.
      for (let i = 0; i < BAR_COUNT; i++) {
        const target = targetLevels[i] ?? 0;
        smoothed[i] += (target - smoothed[i]) * SMOOTHING;
        const level = smoothed[i];
        const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
        const outerRadius = barInnerRadius + Math.max(3, level * barMaxLength);
        const x1 = cx + Math.cos(angle) * barInnerRadius;
        const y1 = cy + Math.sin(angle) * barInnerRadius;
        const x2 = cx + Math.cos(angle) * outerRadius;
        const y2 = cy + Math.sin(angle) * outerRadius;
        const alpha = 0.35 + level * 0.65;
        ctx.strokeStyle = `rgba(147,178,251,${alpha})`; // brand-300
        ctx.lineWidth = Math.max(2, ((2 * Math.PI * barInnerRadius) / BAR_COUNT) * 0.5);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Solid glowing core, drawn last so it sits above the bar roots.
      ctx.save();
      ctx.shadowColor = "rgba(59,111,240,0.85)";
      ctx.shadowBlur = 28;
      ctx.fillStyle = "rgba(37,99,235,0.95)";
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (!active || !stream) {
      let t = 0;
      function idleTick() {
        t += 1;
        const levels = Array.from({ length: BAR_COUNT }, (_, i) => {
          const phase = t * IDLE_SPEED * 1000 + i * 0.4;
          return 0.06 + 0.05 * (1 + Math.sin(phase));
        });
        const avg = 0.5 + 0.1 * Math.sin(t * IDLE_SPEED * 400);
        drawFrame(levels, avg);
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
      analyser.smoothingTimeConstant = 0.7;
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
      const avg = freqData.reduce((sum, v) => sum + v, 0) / freqData.length / 255;
      drawFrame(levels, avg);
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
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
