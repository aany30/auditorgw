import { cn } from "./cn";

/** Amber ring spinner. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block w-3.5 h-3.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin", className)}
      role="status"
      aria-label="Loading"
    />
  );
}

/** Live amber blip dot (for "running"/"live" states). */
export function Blip({ className }: { className?: string }) {
  return <span className={cn("inline-block w-2 h-2 rounded-full bg-accent blip", className)} aria-hidden />;
}
