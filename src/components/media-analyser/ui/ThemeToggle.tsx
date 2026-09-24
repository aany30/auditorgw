
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/media-analyser/ThemeProvider";
import { cn } from "./cn";

/** Sun/moon theme switch. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light" : "Dark"}
      className={cn(
        "inline-grid place-items-center w-8 h-8 rounded-sm border border-line text-fg-dim",
        "hover:text-accent hover:border-accent transition-colors",
        className,
      )}
    >
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
