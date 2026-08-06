import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

export const FIELD_CLASSES =
  "w-full rounded-[var(--radius-control)] border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return <input ref={ref} className={`${FIELD_CLASSES} ${className}`} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = "", ...props }, ref) {
  return <textarea ref={ref} className={`${FIELD_CLASSES} ${className}`} {...props} />;
});

export function Label({ className = "", ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={`text-sm font-medium text-text-secondary ${className}`}
      {...props}
    />
  );
}
