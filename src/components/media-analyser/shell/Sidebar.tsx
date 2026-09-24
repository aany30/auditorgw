
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { NAV_ITEMS, NAV_SECTIONS } from "./nav-items";

interface Props {
  /** Called when a link is clicked — lets the shell close the mobile drawer. */
  onNavigate?: () => void;
}

/**
 * Persistent "Outpost" sidebar — mono uppercase nav grouped into sections, amber
 * active state with a left rule, and a wordmark with a live blip.
 */
export function Sidebar({ onNavigate }: Props) {
  const pathname = useRouter().pathname;
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => { setPending(null); }, [pathname]);

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Wordmark */}
      <Link
        href="/"
        prefetch
        onClick={onNavigate}
        className="flex items-center gap-2.5 px-5 h-16 border-b border-line"
      >
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent blip" aria-hidden />
        <span className="font-mono text-sm font-semibold tracking-[0.14em] uppercase text-fg">
          Ecom<span className="text-fg-mute"> · </span>Intel
        </span>
      </Link>

      {/* Nav — grouped by section */}
      <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
        {NAV_SECTIONS.map((section) => {
          const items = NAV_ITEMS.filter((i) => i.section === section);
          if (!items.length) return null;
          return (
            <div key={section} className="space-y-1">
              <p className="data px-3 mb-2">{section}</p>
              {items.map((item) => {
                const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const active = isActive || pending === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch
                    onClick={() => { if (!isActive) setPending(item.href); onNavigate?.(); }}
                    className={`group relative flex items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "bg-accent-soft text-accent"
                        : "text-fg-dim hover:bg-surface-2 hover:text-fg"
                    }`}
                  >
                    {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" aria-hidden />}
                    <Icon size={17} className={active ? "text-accent" : "text-fg-mute group-hover:text-fg-dim"} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-line">
        <p className="font-mono text-[10px] leading-relaxed tracking-wide text-fg-mute uppercase">
          AI competitive intelligence<br />&amp; creative studio
        </p>
      </div>
    </div>
  );
}
