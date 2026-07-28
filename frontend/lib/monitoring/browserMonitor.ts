interface BlockedCombo {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
}

// Chrome/Firefox reserve tab/window-management shortcuts at the browser
// chrome level — page JS's preventDefault() has no real effect on most of
// these (a deliberate browser security boundary, not a bug here). We still
// call preventDefault (harmless, occasionally effective in embedded/kiosk
// contexts) and always log the attempt via onShortcutAttempted.
const BLOCKED_COMBOS: BlockedCombo[] = [
  { key: "t", ctrl: true },
  { key: "n", ctrl: true },
  { key: "n", ctrl: true, shift: true },
  { key: "l", ctrl: true },
  { key: "w", ctrl: true },
  { key: "Tab", ctrl: true },
  { key: "PageUp", ctrl: true },
  { key: "PageDown", ctrl: true },
];

export interface BrowserMonitorHandlers {
  onTabSwitch: () => void;
  onWindowBlur: () => void;
  onShortcutAttempted: (combo: string) => void;
}

/** Wires tab-switch, window-blur, and blocked-shortcut detection. Returns a cleanup function. */
export function startBrowserMonitor(handlers: BrowserMonitorHandlers): () => void {
  function onVisibilityChange() {
    if (document.hidden) handlers.onTabSwitch();
  }
  function onWindowBlur() {
    handlers.onWindowBlur();
  }
  function onKeyDown(event: KeyboardEvent) {
    const match = BLOCKED_COMBOS.find(
      (combo) =>
        event.key.toLowerCase() === combo.key.toLowerCase() &&
        event.ctrlKey === Boolean(combo.ctrl) &&
        event.shiftKey === Boolean(combo.shift),
    );
    if (!match) return;
    event.preventDefault();
    const label = `${match.ctrl ? "Ctrl+" : ""}${match.shift ? "Shift+" : ""}${match.key}`;
    handlers.onShortcutAttempted(label);
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("blur", onWindowBlur);
  // Capture phase so we see the event before any focused element/embed does.
  window.addEventListener("keydown", onKeyDown, true);

  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("keydown", onKeyDown, true);
  };
}
