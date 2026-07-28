import * as cocoSsd from "@tensorflow-models/coco-ssd";
import * as tf from "@tensorflow/tfjs";

const PHONE_CLASS = "cell phone";
// Library default is 0.5 — a held-up phone at typical webcam distance/angle
// often scores lower than a studio detection benchmark would suggest, so
// this stays close to that default rather than tightening it.
const MIN_CONFIDENCE = 0.5;

export async function createPhoneDetector(): Promise<cocoSsd.ObjectDetection> {
  await tf.ready();
  // "mobilenet_v2" — more accurate than the "lite" variant. We only run this
  // once a second (see PHONE_DETECT_INTERVAL_MS), so there's a full second
  // of budget per inference and accuracy matters more than shaving
  // milliseconds off a single call.
  return cocoSsd.load({ base: "mobilenet_v2" });
}

/** True if a cell phone is visible in the current frame above the confidence threshold. */
export async function detectPhone(
  model: cocoSsd.ObjectDetection,
  video: HTMLVideoElement,
): Promise<boolean> {
  const predictions = await model.detect(video, 10, MIN_CONFIDENCE);
  return predictions.some((p) => p.class === PHONE_CLASS);
}
