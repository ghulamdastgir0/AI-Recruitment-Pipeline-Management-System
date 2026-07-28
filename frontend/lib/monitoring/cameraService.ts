export interface CameraMicResult {
  stream?: MediaStream;
  cameraError?: string;
  microphoneError?: string;
}

async function probe(constraints: MediaStreamConstraints): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}

/**
 * Requests camera+mic together first (the common case). If that fails,
 * probes each device separately so the pre-join screen can say exactly
 * which permission is missing instead of one generic error — a single
 * combined getUserMedia call can't tell you which of the two was denied.
 */
export async function requestCameraAndMic(): Promise<CameraMicResult> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    return { stream };
  } catch {
    const [cameraOk, micOk] = await Promise.all([
      probe({ video: true }),
      probe({ audio: true }),
    ]);
    return {
      cameraError: cameraOk
        ? undefined
        : "Camera access is required to continue. Check your browser's permission prompt and try again.",
      microphoneError: micOk
        ? undefined
        : "Microphone access is required to continue. Check your browser's permission prompt and try again.",
    };
  }
}
