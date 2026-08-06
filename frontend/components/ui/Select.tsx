import { forwardRef, type SelectHTMLAttributes } from "react";
import { FIELD_CLASSES } from "./Input";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = "", ...props }, ref) {
    return <select ref={ref} className={`${FIELD_CLASSES} ${className}`} {...props} />;
  },
);
