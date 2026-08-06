"use client";

import { useEffect } from "react";

const DISMISS_MS = 3_000;

/** Auto-dismissing (3s) proctoring warning banner — see useInterviewMonitoring. */
export function WarningToast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timeout = setTimeout(onDismiss, DISMISS_MS);
    return () => clearTimeout(timeout);
  }, [message, onDismiss]);

  return (
    <div
      role="alert"
      className="fixed left-1/2 top-6 z-50 w-full max-w-sm animate-[toast-in_0.25s_ease-out_forwards] rounded-xl border border-dark-warning-border/60 bg-dark-warning-bg/95 px-4 py-3 text-center text-sm font-medium text-dark-warning-text shadow-xl backdrop-blur"
    >
      {message}
    </div>
  );
}
