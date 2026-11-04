/**
 * Snapchat attribution — campaign-level conversion stats from the Snapchat
 * Marketing API stats endpoint. Snapchat uses Snap Pixel + CAPI for
 * attribution with a default 28-day click / 1-day view window.
 *
 * Snapchat does not expose per-action attribution configuration via API
 * (unlike Meta's per-campaign window or DV360's Floodlight activities),
 * so we show the default attribution model info + campaign conversion data.
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";

export interface SnapchatCampaignConv {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  swipes: number;
  conversions: number;
}

export interface SnapchatAttributionState {
  loading: boolean;
  campaigns?: SnapchatCampaignConv[];
  totals?: { spend: number; impressions: number; swipes: number; conversions: number };
  error?: string;
}

export function useSnapchatAttribution(
  enabled: boolean,
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string,
) {
  const {
    snapchatClientId, snapchatClientSecret, snapchatRefreshToken,
    snapchatAdAccountId, snapchatOrgId, demoMode,
  } = useAuthStore();

  const [state, setState] = useState<SnapchatAttributionState>({ loading: false });

  useEffect(() => {
    const hasServerDefaults = !!process.env.NEXT_PUBLIC_HAS_DEFAULT_CREDS;
    if (
      !enabled ||
      (!hasServerDefaults && !demoMode && (!snapchatRefreshToken || !snapchatAdAccountId))
    ) {
      setState({ loading: false });
      return;
    }

    let cancelled = false;
    setState({ loading: true });

    const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

    // Fetch campaigns + stats in parallel via the existing naming route
    // which already merges campaigns with stats.
    fetch("/api/naming/campaigns/snapchat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: demoMode ? "demo-snap-client" : snapchatClientId,
        clientSecret: demoMode ? "demo-snap-secret" : snapchatClientSecret,
        refreshToken: demoMode ? "demo-snap-refresh" : snapchatRefreshToken,
        adAccountId: demoMode ? "demo-snap-account" : snapchatAdAccountId,
        orgId: snapchatOrgId || undefined,
        startDate,
        endDate,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setState({ loading: false, error: data.error });
          return;
        }
        const campaigns: SnapchatCampaignConv[] = (data.campaigns || []).map(
          (c: Record<string, unknown>) => ({
            id: String(c.id || ""),
            name: String(c.name || ""),
            spend: Number(c.spend || 0),
            impressions: Number(c.impressions || 0),
            swipes: Number(c.clicks || 0),
            conversions: Number(c.conversions || 0),
          }),
        );
        const totals = campaigns.reduce(
          (acc, c) => ({
            spend: acc.spend + c.spend,
            impressions: acc.impressions + c.impressions,
            swipes: acc.swipes + c.swipes,
            conversions: acc.conversions + c.conversions,
          }),
          { spend: 0, impressions: 0, swipes: 0, conversions: 0 },
        );
        setState({ loading: false, campaigns, totals });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, error: "Network error" });
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, demoMode, snapchatRefreshToken, snapchatAdAccountId, dateRange, customStart, customEnd]);

  return state;
}
