"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastVariant = "success" | "danger" | "info";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const DISMISS_MS = 4_000;

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: "border-success/30 bg-success-soft text-success-text",
  danger: "border-danger/30 bg-danger-soft text-danger-text",
  info: "border-brand-200 bg-brand-50 text-brand-700",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed left-1/2 top-6 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto animate-[toast-in_0.25s_ease-out_forwards] cursor-pointer rounded-[var(--radius-control)] border px-4 py-3 text-center text-sm font-medium shadow-lg ${VARIANT_CLASSES[t.variant]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
