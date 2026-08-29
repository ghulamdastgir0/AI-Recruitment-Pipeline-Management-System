export interface CameraMicResult {
  stream?: MediaStream;
  cameraError?: string;
  microphoneError?: string;
}

// getUserMedia can sit unresolved indefinitely — a permission prompt the
// candidate never answers, an OS picker left open, or an embedded/locked-down
// context where the promise simply never settles. Without a ceiling, the
// pre-join screen's "Joining…" button stays disabled forever with no error
// and no way out (the caller only clears its loading state once this
// resolves). 45s is comfortably longer than a human takes to click Allow.
const GET_USER_MEDIA_TIMEOUT_MS = 45_000;

class MediaTimeoutError extends Error {
  constructor() {
    super("getUserMedia timed out");
    this.name = "MediaTimeoutError";
  }
}

function getUserMediaWithTimeout(
  constraints: MediaStreamConstraints,
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error("mediaDevices unavailable"));
  }
  return new Promise<MediaStream>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new MediaTimeoutError());
    }, GET_USER_MEDIA_TIMEOUT_MS);

    navigator.mediaDevices.getUserMedia(constraints).then(
      (stream) => {
        if (settled) {
          // Timed out already — don't leak the now-orphaned tracks.
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(stream);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err as Error);
      },
    );
  });
}

async function probe(constraints: MediaStreamConstraints): Promise<boolean> {
  try {
    const stream = await getUserMediaWithTimeout(constraints);
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}

const TIMEOUT_MESSAGE =
  "We couldn't get access to your camera and microphone in time. Make sure you allow the permission prompt, then try again.";
const CAMERA_DENIED_MESSAGE =
  "Camera access is required to continue. Check your browser's permission prompt and try again.";
const MIC_DENIED_MESSAGE =
  "Microphone access is required to continue. Check your browser's permission prompt and try again.";

/**
 * Requests camera+mic together first (the common case). If that fails,
 * probes each device separately so the pre-join screen can say exactly
 * which permission is missing instead of one generic error — a single
 * combined getUserMedia call can't tell you which of the two was denied.
 * Always resolves (never hangs): a hung prompt surfaces as a timeout error
 * rather than an infinitely-disabled "Joining…" button.
 */
export async function requestCameraAndMic(): Promise<CameraMicResult> {
  try {
    const stream = await getUserMediaWithTimeout({ video: true, audio: true });
    return { stream };
  } catch (err) {
    if (err instanceof MediaTimeoutError) {
      return {
        cameraError: TIMEOUT_MESSAGE,
      };
    }
    const [cameraOk, micOk] = await Promise.all([
      probe({ video: true }),
      probe({ audio: true }),
    ]);
    return {
      cameraError: cameraOk ? undefined : CAMERA_DENIED_MESSAGE,
      microphoneError: micOk ? undefined : MIC_DENIED_MESSAGE,
    };
  }
}
