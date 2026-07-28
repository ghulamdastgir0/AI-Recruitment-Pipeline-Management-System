/** Requests fullscreen on the whole page. Returns false if the browser refused (e.g. no user gesture). */
export async function enterFullscreen(): Promise<boolean> {
  if (document.fullscreenElement) return true;
  try {
    await document.documentElement.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

/**
 * Watches for the user leaving fullscreen and reports it. Re-entering
 * fullscreen programmatically from this handler often silently fails
 * without a fresh user gesture (browser security) — callers should also
 * expose a manual "Return to fullscreen" action rather than relying solely
 * on the auto-retry here.
 */
export function startFullscreenMonitor(onExit: () => void): () => void {
  function onFullscreenChange() {
    if (!document.fullscreenElement) onExit();
  }
  document.addEventListener("fullscreenchange", onFullscreenChange);
  return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
}
