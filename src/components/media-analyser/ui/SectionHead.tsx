import type { ReactNode } from "react";
import { cn } from "./cn";

/** Mono eyebrow + display heading + optional subtitle — the page/section header. */
export function SectionHead({
  eyebrow, title, subtitle, right, className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-4 flex-wrap", className)}>
      <div className="space-y-1.5">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="font-display text-xl sm:text-2xl font-semibold text-fg tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-fg-dim max-w-2xl">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
