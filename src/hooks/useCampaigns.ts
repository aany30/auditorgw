/**
 * Shared hook for fetching the campaign list from Meta + Google for a given
 * date range. Used by Reporting tabs that need spend / impressions / clicks /
 * conversions per campaign — same data AccountStructureTab loads internally.
 *
 * Returns { campaigns, loading, error }. Empty array when no credentials.
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import type { CampaignData } from "@/types";
import type { DateRange } from "@/components/shared/DateRangePicker";

function rangeToDates(
  range: DateRange,
  customStart?: string,
  customEnd?: string
): { startDate: string; endDate: string } {
  if (range === "custom" && customStart && customEnd)
    return { startDate: customStart, endDate: customEnd };
  const today = new Date();
  const start = new Date(today);
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  start.setDate(today.getDate() - days);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: today.toISOString().slice(0, 10),
  };
}

export function useCampaigns(
  platform: "meta" | "google" | "both",
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string
) {
  const {
    metaAccessToken,
    metaBusinessId,
    googleAccessToken,
    googleCustomerId,
    googleAdsDeveloperToken,
    googleAdsLoginCustomerId,
    demoMode,
  } = useAuthStore();

  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    let cancelled = false;
    const fetchCampaigns = async () => {
      setLoading(true);
      setError(null);
      const all: CampaignData[] = [];
      try {
        const effectiveMetaToken = demoMode ? "demo-meta-token" : metaAccessToken;
        const effectiveMetaBiz = demoMode ? "demo-business-123" : metaBusinessId;
        if ((platform === "meta" || platform === "both") && effectiveMetaToken && effectiveMetaBiz) {
          const r = await fetch("/api/naming/campaigns/meta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken: effectiveMetaToken,
              businessId: effectiveMetaBiz,
              startDate,
              endDate,
            }),
          });
          if (r.ok) {
            all.push(...(await r.json()));
          } else {
            const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
            if (!cancelled) setError(body.error || `Meta API error (HTTP ${r.status})`);
          }
        }
        const effectiveGoogleToken = demoMode ? "demo-google-token" : googleAccessToken;
        if (
          (platform === "google" || platform === "both") &&
          effectiveGoogleToken &&
          (demoMode || (googleCustomerId && googleAdsDeveloperToken))
        ) {
          const r = await fetch("/api/naming/campaigns/google", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken: effectiveGoogleToken,
              customerId: demoMode ? "123-456-7890" : googleCustomerId,
              developerToken: demoMode ? "demo-dev-token" : googleAdsDeveloperToken,
              loginCustomerId: googleAdsLoginCustomerId || googleCustomerId,
              startDate,
              endDate,
            }),
          });
          if (r.ok) {
            all.push(...(await r.json()));
          } else {
            const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
            if (!cancelled) setError(body.error || `Google API error (HTTP ${r.status})`);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Fetch failed");
      } finally {
        if (!cancelled) {
          setCampaigns(all);
          setLoading(false);
        }
      }
    };
    fetchCampaigns();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    platform,
    startDate,
    endDate,
    metaAccessToken,
    metaBusinessId,
    googleAccessToken,
    googleCustomerId,
    googleAdsDeveloperToken,
    demoMode,
  ]);

  return { campaigns, loading, error, startDate, endDate };
}
