import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// Hosted by Google — fetched once at runtime and cached by the browser, same
// as every other MediaPipe Tasks Vision integration. No model weights are
// vendored in this repo.
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.0/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export interface FacePoseResult {
  faceCount: number;
  /** Radians, magnitude only matters (sign convention isn't calibrated) — used purely as an away-from-screen threshold. */
  yaw: number;
  pitch: number;
}

// MediaPipe's WASM runtime logs its own informational lines (delegate
// creation, backend selection, etc.) through console.error rather than
// console.info/log — harmless, but Next.js's dev overlay treats every
// console.error as a crash and throws up a full-screen error, and this
// specific line only fires lazily on the *first* detectForVideo call (not
// at model creation), so it can't be caught with a try/catch either way.
// Downgrading these known-benign lines to console.debug is the standard
// workaround for MediaPipe + Next.js dev mode.
const BENIGN_MEDIAPIPE_LOG_PATTERNS = [
  /^INFO: /,
  /^WARNING: /,
  /Created TensorFlow Lite XNNPACK delegate/i,
];
let consolePatched = false;

function silenceBenignMediaPipeLogs(): void {
  if (consolePatched || typeof window === "undefined") return;
  consolePatched = true;
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (
      typeof first === "string" &&
      BENIGN_MEDIAPIPE_LOG_PATTERNS.some((pattern) => pattern.test(first))
    ) {
      console.debug(...args);
      return;
    }
    originalError(...args);
  };
}

export async function createFaceLandmarker(): Promise<FaceLandmarker> {
  silenceBenignMediaPipeLogs();
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const baseOptions = { modelAssetPath: MODEL_URL };
  try {
    return await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { ...baseOptions, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 3,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
    });
  } catch {
    // Some browsers/GPUs can't run the WebGL delegate — CPU is slower but
    // universally supported.
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { ...baseOptions, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 3,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
    });
  }
}

/**
 * Runs one detection pass against the current video frame. Head yaw/pitch
 * are derived from the first detected face's 4x4 transformation matrix
 * (standard rotation-matrix decomposition) — good enough for a coarse
 * "looking away" threshold, not precise gaze tracking.
 */
export function detectFacePose(
  landmarker: FaceLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): FacePoseResult {
  const result = landmarker.detectForVideo(video, timestampMs);
  const faceCount = result.faceLandmarks?.length ?? 0;
  const matrix = result.facialTransformationMatrixes?.[0]?.data;
  if (!matrix) return { faceCount, yaw: 0, pitch: 0 };

  const r00 = matrix[0];
  const r10 = matrix[4];
  const r20 = matrix[8];
  const r21 = matrix[9];
  const r22 = matrix[10];
  const yaw = Math.atan2(-r20, Math.sqrt(r00 * r00 + r10 * r10));
  const pitch = Math.atan2(r21, r22);
  return { faceCount, yaw, pitch };
}
