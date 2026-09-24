import type { HTMLAttributes } from "react";
import { cn } from "./cn";

type Tone = "neutral" | "accent" | "teal" | "alert";

const TONES: Record<Tone, string> = {
  neutral: "border-line text-fg-dim",
  accent: "border-accent/40 text-accent bg-accent-soft",
  teal: "border-accent-2/40 text-accent-2 bg-accent-2-soft",
  alert: "border-alert/40 text-alert bg-alert-soft",
};

/** Mono pill/chip. `active` fills it; used for filters + labels. */
export function Badge({
  tone = "neutral", active, className, ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; active?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[11px] tracking-wide whitespace-nowrap",
        active ? "border-accent bg-accent text-bg" : TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
