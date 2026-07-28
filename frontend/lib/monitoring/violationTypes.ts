export type ViolationType =
  | "FACE_MISSING"
  | "MULTIPLE_FACES"
  | "LOOKING_AWAY"
  | "MOBILE_DETECTED"
  | "TAB_SWITCH"
  | "FULLSCREEN_EXIT"
  | "WINDOW_BLUR"
  | "CAMERA_DISABLED"
  | "MICROPHONE_DISABLED"
  | "BROWSER_CLOSED"
  | "SHORTCUT_ATTEMPTED";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ViolationSummary {
  counts: Partial<Record<ViolationType, number>>;
  total: number;
  riskLevel: RiskLevel;
}

export interface LogViolationResult extends ViolationSummary {
  forced: boolean;
}

export const MAX_INTERVIEW_WARNINGS = 5;

export const VIOLATION_MESSAGES: Record<ViolationType, string> = {
  FACE_MISSING: "Your face is not visible. Please return to the camera.",
  MULTIPLE_FACES: "Multiple people detected.",
  LOOKING_AWAY: "Please keep looking at the screen.",
  MOBILE_DETECTED: "Mobile phone detected.",
  TAB_SWITCH: "Leaving the interview tab is not allowed.",
  FULLSCREEN_EXIT: "Interview must remain in fullscreen.",
  WINDOW_BLUR: "Please stay focused on the interview window.",
  CAMERA_DISABLED: "Camera access was lost. Please reconnect your camera.",
  MICROPHONE_DISABLED: "Microphone access was lost. Please reconnect your microphone.",
  BROWSER_CLOSED: "Interview session ended.",
  SHORTCUT_ATTEMPTED: "That keyboard shortcut is disabled during the interview.",
};
