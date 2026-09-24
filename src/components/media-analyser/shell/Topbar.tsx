
import { useRouter } from "next/router";
import { Menu } from "lucide-react";
import { ThemeToggle } from "@/components/media-analyser/ui/ThemeToggle";
import { activeNavItem } from "./nav-items";

interface Props {
  onMenuClick: () => void;
}

/** Slim sticky top bar: mobile menu toggle, current page title, health, theme toggle. */
export function Topbar({ onMenuClick }: Props) {
  const pathname = useRouter().pathname;
  const current = activeNavItem(pathname);

  return (
    <header className="sticky top-0 z-20 h-16 flex items-center gap-3 px-4 sm:px-6 lg:px-10 bg-bg/70 backdrop-blur border-b border-line">
      <button
        type="button"
        onClick={onMenuClick}
        className="lg:hidden grid place-items-center w-9 h-9 rounded-sm text-fg-dim hover:bg-surface-2 transition-colors"
        aria-label="Open navigation"
      >
        <Menu size={18} />
      </button>

      <h1 className="font-display text-base font-semibold tracking-tight text-fg truncate">
        {current?.title ?? "Ecom Intelligence"}
      </h1>

      <div className="ml-auto flex items-center gap-3">
        <ThemeToggle />
      </div>
    </header>
  );
}
