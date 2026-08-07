"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  message: string;
  resolve: (value: boolean) => void;
}

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback<ConfirmFn>((message, options) => {
    return new Promise<boolean>((resolve) => {
      setState({ message, resolve, ...options });
    });
  }, []);

  function settle(result: boolean) {
    state?.resolve(result);
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={state !== null}
        onClose={() => settle(false)}
        title={state?.title ?? "Please confirm"}
      >
        <p className="text-sm text-text-secondary">{state?.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => settle(false)}>
            {state?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={state?.destructive ? "destructive" : "primary"}
            onClick={() => settle(true)}
          >
            {state?.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
