import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type GazeDirection = "CENTER" | "LEFT" | "RIGHT" | "UP" | "DOWN";

export interface GazeEstimate {
  direction: GazeDirection;
  eyesClosed: boolean;
}

// Canonical MediaPipe Face Mesh keypoint indices (stable across the SDK —
// exposed as FaceLandmarker.FACE_LANDMARKS_LEFT_EYE/RIGHT_EYE/*_IRIS
// connection arrays, these are the specific corner/lid/iris-center points
// within them). Indices 468-477 (iris) only exist because faceTracking.ts
// loads the full attention-mesh face_landmarker model — there is no
// separate "Iris Landmarker" task in @mediapipe/tasks-vision; iris tracking
// is this same model's extra 10 landmarks.
const LEFT_EYE_OUTER = 33;
const LEFT_EYE_INNER = 133;
const LEFT_EYE_TOP = 159;
const LEFT_EYE_BOTTOM = 145;
const LEFT_IRIS_CENTER = 468;

const RIGHT_EYE_OUTER = 263;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_TOP = 386;
const RIGHT_EYE_BOTTOM = 374;
const RIGHT_IRIS_CENTER = 473;

// Horizontal/vertical deviation-from-center (0.5) thresholds that trigger a
// direction, and the Eye Aspect Ratio below which eyes count as closed.
// Heuristic constants, not physically calibrated — same caveat as the
// existing LOOKING_AWAY_RADIANS threshold in useInterviewMonitoring.ts.
// The initial 0.18 guess turned out too high: real testing against a webcam
// showed a deliberate side glance rarely pushes the iris-in-socket ratio
// that far, so it never left CENTER. Lowered after that feedback; still a
// heuristic, so keep tuning if it over/under-fires in practice.
// Slightly loosened from 0.1/0.1/0.15 — gave a bit more tolerance for
// ordinary head/eye micro-movement before counting as a deliberate
// look-away, and for a normal squint/slow blink before counting as
// "eyes closed" (a lower EAR cutoff requires eyes to be more fully shut).
export const GAZE_HORIZONTAL_THRESHOLD = 0.12;
export const GAZE_VERTICAL_THRESHOLD = 0.12;
export const EYE_ASPECT_RATIO_CLOSED_THRESHOLD = 0.13;

function horizontalRatio(
  iris: NormalizedLandmark,
  cornerA: NormalizedLandmark,
  cornerB: NormalizedLandmark,
): number {
  const min = Math.min(cornerA.x, cornerB.x);
  const max = Math.max(cornerA.x, cornerB.x);
  if (max - min < 1e-6) return 0.5;
  return (iris.x - min) / (max - min);
}

function verticalRatio(
  iris: NormalizedLandmark,
  top: NormalizedLandmark,
  bottom: NormalizedLandmark,
): number {
  const span = bottom.y - top.y;
  if (Math.abs(span) < 1e-6) return 0.5;
  return (iris.y - top.y) / span;
}

function eyeAspectRatio(
  top: NormalizedLandmark,
  bottom: NormalizedLandmark,
  outer: NormalizedLandmark,
  inner: NormalizedLandmark,
): number {
  const vertical = Math.hypot(top.x - bottom.x, top.y - bottom.y);
  const horizontal = Math.hypot(outer.x - inner.x, outer.y - inner.y);
  if (horizontal < 1e-6) return 1;
  return vertical / horizontal;
}

/**
 * Derives gaze direction + eye-closed state from one FaceLandmarker result's
 * landmarks (the same detection pass useInterviewMonitoring already runs for
 * head-pose tracking — no extra model, no extra detectForVideo() call).
 * Pure and stateless: continuous-duration/cooldown logic for turning this
 * into a warning lives in useEyeTracking, not here.
 */
export function estimateGaze(landmarks: NormalizedLandmark[]): GazeEstimate | null {
  const leftIris = landmarks[LEFT_IRIS_CENTER];
  const rightIris = landmarks[RIGHT_IRIS_CENTER];
  const leftOuter = landmarks[LEFT_EYE_OUTER];
  const leftInner = landmarks[LEFT_EYE_INNER];
  const leftTop = landmarks[LEFT_EYE_TOP];
  const leftBottom = landmarks[LEFT_EYE_BOTTOM];
  const rightOuter = landmarks[RIGHT_EYE_OUTER];
  const rightInner = landmarks[RIGHT_EYE_INNER];
  const rightTop = landmarks[RIGHT_EYE_TOP];
  const rightBottom = landmarks[RIGHT_EYE_BOTTOM];
  if (
    !leftIris ||
    !rightIris ||
    !leftOuter ||
    !leftInner ||
    !leftTop ||
    !leftBottom ||
    !rightOuter ||
    !rightInner ||
    !rightTop ||
    !rightBottom
  ) {
    return null;
  }

  const ear =
    (eyeAspectRatio(leftTop, leftBottom, leftOuter, leftInner) +
      eyeAspectRatio(rightTop, rightBottom, rightOuter, rightInner)) /
    2;
  const eyesClosed = ear < EYE_ASPECT_RATIO_CLOSED_THRESHOLD;

  // While closed, the iris isn't reliably visible — don't attempt a
  // direction reading, the caller keeps whatever direction was last valid.
  if (eyesClosed) {
    return { direction: "CENTER", eyesClosed: true };
  }

  const hRatio =
    (horizontalRatio(leftIris, leftOuter, leftInner) +
      horizontalRatio(rightIris, rightOuter, rightInner)) /
    2;
  const vRatio =
    (verticalRatio(leftIris, leftTop, leftBottom) +
      verticalRatio(rightIris, rightTop, rightBottom)) /
    2;

  const hDeviation = hRatio - 0.5;
  const vDeviation = vRatio - 0.5;

  let direction: GazeDirection = "CENTER";
  if (
    Math.abs(hDeviation) > GAZE_HORIZONTAL_THRESHOLD &&
    Math.abs(hDeviation) >= Math.abs(vDeviation)
  ) {
    // Frame-relative, not anatomically calibrated: verify sign against a
    // real webcam (see plan verification notes) and flip if reversed.
    direction = hDeviation < 0 ? "LEFT" : "RIGHT";
  } else if (Math.abs(vDeviation) > GAZE_VERTICAL_THRESHOLD) {
    direction = vDeviation < 0 ? "UP" : "DOWN";
  }

  return { direction, eyesClosed: false };
}
