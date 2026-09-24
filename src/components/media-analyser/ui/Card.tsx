import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** Hairline-bordered surface — the default panel. */
export function Card({ className, hover, ...props }: HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div
      className={cn(
        "rounded border border-line bg-surface shadow-sm",
        hover && "transition-all hover:border-accent hover:shadow-md",
        className,
      )}
      {...props}
    />
  );
}
