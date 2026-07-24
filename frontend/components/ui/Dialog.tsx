"use client";

import { type ReactNode, useEffect } from "react";

export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface-card p-5 shadow-lg"
      >
        <h2 className="font-heading text-base font-semibold text-text-primary">
          {title}
        </h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
