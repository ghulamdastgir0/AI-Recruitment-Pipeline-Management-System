import type { ReactNode } from "react";
import { Card } from "./Card";

type Accent = "brand" | "success" | "warning" | "violet" | "teal";

const ACCENT_CLASSES: Record<Accent, string> = {
  brand: "bg-brand-50 text-brand-600",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  violet: "bg-accent-violet-soft text-accent-violet-text",
  teal: "bg-accent-teal-soft text-accent-teal-text",
};

export function StatTile({
  label,
  value,
  hint,
  icon,
  accent = "brand",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  accent?: Accent;
}) {
  return (
    <Card className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-text-muted">{label}</p>
        <p className="mt-1.5 font-heading text-2xl font-semibold text-text-primary">
          {value}
        </p>
        {hint && <p className="mt-1 truncate text-xs text-text-muted">{hint}</p>}
      </div>
      {icon && (
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${ACCENT_CLASSES[accent]}`}
        >
          <span className="h-4 w-4">{icon}</span>
        </span>
      )}
    </Card>
  );
}
