import {
  LayoutDashboard,
  History,
  type LucideIcon,
} from "lucide-react";

export type NavSection = "Intelligence" | "Archive";

export interface NavItem {
  href: string;
  label: string;
  /** Page title shown in the topbar. */
  title: string;
  icon: LucideIcon;
  section: NavSection;
}

/** Order the sidebar renders section groups in. */
export const NAV_SECTIONS: NavSection[] = ["Intelligence", "Archive"];

/**
 * Single source of truth for the sidebar nav + topbar titles.
 * Media Analyser — the competitive-intelligence surface only.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Analyze", title: "Product Intelligence", icon: LayoutDashboard, section: "Intelligence" },
  { href: "/scans", label: "History", title: "Scan History", icon: History, section: "Archive" },
];

/** Resolve the active nav item for a pathname (exact match for "/"). */
export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
}
