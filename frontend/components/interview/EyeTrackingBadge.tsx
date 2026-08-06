import type { EyeTrackingState } from "@/hooks/useEyeTracking";

const DIRECTION_LABEL: Record<EyeTrackingState["direction"], string> = {
  CENTER: "Forward",
  LEFT: "Left",
  RIGHT: "Right",
  UP: "Up",
  DOWN: "Down",
};

/** Small, non-intrusive eye-tracking status chip — same pill styling as MonitoringStatusBadge/CameraPreview. */
export function EyeTrackingBadge({
  state,
  modelsReady,
}: {
  state: EyeTrackingState;
  modelsReady: boolean;
}) {
  // Detection genuinely hasn't started yet while models are still loading —
  // showing "Not detected" during that window reads as a face-tracking
  // failure when it's really just startup latency.
  if (!modelsReady) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-dark-warning-text" />
        <span>Starting face/eye monitoring…</span>
      </div>
    );
  }

  let eyesLabel = "👀 Tracking";
  if (!state.faceDetected) eyesLabel = "⏸️ Paused";
  else if (state.eyesClosed) eyesLabel = "😴 Closed";

  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
      <span>Face: {state.faceDetected ? "✅ Detected" : "❌ Not detected"}</span>
      <span className="text-white/50">·</span>
      <span>Eyes: {eyesLabel}</span>
      <span className="text-white/50">·</span>
      <span className={state.direction === "CENTER" ? "text-white/70" : "text-dark-warning-text"}>
        Direction: {DIRECTION_LABEL[state.direction]}
      </span>
    </div>
  );
}
