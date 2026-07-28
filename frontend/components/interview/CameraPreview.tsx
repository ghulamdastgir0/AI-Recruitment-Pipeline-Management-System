"use client";

import { useEffect, useRef } from "react";

/**
 * Small self-view camera feed shown during the interview — both a
 * reassurance signal to the candidate that they're being recorded, and the
 * video element useInterviewMonitoring's face/phone detection loops read
 * frames from (via `onVideoReady`).
 */
export function CameraPreview({
  stream,
  onVideoReady,
}: {
  stream: MediaStream | null;
  onVideoReady: (video: HTMLVideoElement | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    onVideoReady(video);
    return () => onVideoReady(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onVideoReady is stable per render
  }, [stream]);

  return (
    <div className="fixed bottom-4 right-4 z-40 overflow-hidden rounded-2xl border border-white/10 bg-black shadow-lg">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="h-28 w-40 scale-x-[-1] object-cover"
      />
      <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
        Monitoring
      </span>
    </div>
  );
}
