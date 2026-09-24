import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from "react";
import { cn } from "./cn";

const base =
  "w-full rounded-sm border border-line bg-bg text-sm text-fg placeholder-fg-mute " +
  "focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50 transition-colors";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(base, "px-3.5 py-2.5", className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(base, "px-3.5 py-2.5 resize-y", className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(base, "px-3 py-2.5", className)} {...props} />;
  },
);

/** Mono uppercase field label. */
export function FieldLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={cn("data block mb-1.5", className)}>{children}</label>;
}
