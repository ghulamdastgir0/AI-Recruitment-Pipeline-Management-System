import { API_BASE_URL } from "@/lib/api";

/**
 * Reports a BROWSER_CLOSED violation via sendBeacon on tab/window close —
 * a normal fetch() started during beforeunload/pagehide is not guaranteed
 * to complete, but sendBeacon is specifically designed to survive
 * navigation/unload. The backend force-completes the interview immediately
 * on receiving this (see InterviewSessionService.logViolation).
 */
export function registerUnloadBeacon(applicationId: string): () => void {
  function send() {
    const body = JSON.stringify({ type: "BROWSER_CLOSED" });
    navigator.sendBeacon?.(
      `${API_BASE_URL}/interview-sessions/${applicationId}/violations`,
      new Blob([body], { type: "application/json" }),
    );
  }
  window.addEventListener("pagehide", send);
  window.addEventListener("beforeunload", send);
  return () => {
    window.removeEventListener("pagehide", send);
    window.removeEventListener("beforeunload", send);
  };
}
