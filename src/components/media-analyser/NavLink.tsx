
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

interface Props {
  href: string;
  children: React.ReactNode;
}

/**
 * Navigation link that:
 * - Highlights the current page (active state).
 * - Immediately darkens on click — before the new page has loaded — so the
 *   user gets instant visual feedback instead of a frozen-looking UI.
 */
export function NavLink({ href, children }: Props) {
  const pathname = useRouter().pathname;
  const [pending, setPending] = useState(false);

  // Exact match for "/" to avoid "/" matching every route.
  const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);

  // Reset pending once navigation completes.
  useEffect(() => { setPending(false); }, [pathname]);

  const active = isActive || pending;

  return (
    <Link
      href={href}
      prefetch
      onClick={() => { if (!isActive) setPending(true); }}
      className={`text-sm transition-colors relative ${
        active ? "text-fg font-medium" : "text-fg-dim hover:text-fg"
      }`}
    >
      {children}
      {/* Thin underline indicator for the active / just-clicked link. */}
      {active && (
        <span className="absolute -bottom-[17px] left-0 right-0 h-px bg-accent" aria-hidden />
      )}
    </Link>
  );
}
