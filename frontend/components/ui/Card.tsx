import type { HTMLAttributes } from "react";

export function Card({
  as: Tag = "div",
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "div" | "li" }) {
  return (
    <Tag
      className={`rounded-[var(--radius-card)] border border-border bg-surface-card p-5 shadow-sm ${className}`}
      {...props}
    />
  );
}
