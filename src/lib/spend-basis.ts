/**
 * Shared "spend basis" logic for the TOF/MOF/BOF and CBO/ABO performance
 * charts. Every bar in a chart must use ONE consistent basis — mixing
 * window-spend (active campaigns) with lifetime-spend (paused campaigns)
 * produces a meaningless comparison.
 *
 * Three bases:
 *   - window   : spend within the dashboard's selected date range (paused → 0)
 *   - lifetime : all-time total spend per campaign
 *   - perDay   : lifetime spend ÷ days the campaign actually ran (date_start→
 *                date_stop). The fairest like-for-like — compares spend velocity
 *                regardless of how long each campaign ran. Default.
 */

import type { CampaignData } from "@/types";

export type SpendBasis = "perDay" | "lifetime" | "window";

export interface LifetimeMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  dateStart?: string;
  dateStop?: string;
}

export type LifetimeMap = Record<string, LifetimeMetrics>;

export const BASIS_OPTIONS: Array<{ id: SpendBasis; label: string }> = [
  { id: "perDay", label: "Avg / day" },
  { id: "lifetime", label: "Lifetime" },
  { id: "window", label: "Window" },
];

export const BASIS_SUBTITLE: Record<SpendBasis, string> = {
  perDay: "Per-day averages — total lifetime spend ÷ days each campaign ran. Fairest comparison across active & paused campaigns.",
  lifetime: "All-time totals per campaign (active + paused). Long-running campaigns naturally show larger totals.",
  window: "Spend strictly within the selected date range. Paused campaigns may show 0.",
};

/** Inclusive day count between two ISO date strings (min 1). */
function activeDays(start?: string, stop?: string): number {
  if (!start || !stop) return 1;
  const a = new Date(start).getTime();
  const b = new Date(stop).getTime();
  if (isNaN(a) || isNaN(b) || b < a) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/**
 * Resolve a campaign's spend/impressions/clicks under the chosen basis. All
 * three values use the SAME basis so derived ratios (CPM/CTR/CPC) stay coherent.
 */
export function basisMetrics(
  c: CampaignData,
  lifetime: LifetimeMap,
  basis: SpendBasis
): { spend: number; impressions: number; clicks: number } {
  if (basis === "window") {
    return {
      spend: c.spend || 0,
      impressions: c.impressions || 0,
      clicks: c.clicks || 0,
    };
  }
  const lt = lifetime[c.id];
  // Fall back to window values if lifetime hasn't loaded yet (or non-Meta).
  const spend = lt?.spend ?? c.spend ?? 0;
  const impressions = lt?.impressions ?? c.impressions ?? 0;
  const clicks = lt?.clicks ?? c.clicks ?? 0;
  if (basis === "lifetime") {
    return { spend, impressions, clicks };
  }
  // perDay
  const days = activeDays(lt?.dateStart, lt?.dateStop);
  return {
    spend: spend / days,
    impressions: impressions / days,
    clicks: clicks / days,
  };
}
