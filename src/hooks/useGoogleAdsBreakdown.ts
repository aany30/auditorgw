/**
 * Hook for fetching Google Ads demographic/audience breakdowns from
 * /api/reporting/demographics/google-ads.
 *
 * Returns the same BreakdownRow shape as useMetaBreakdown so existing chart
 * and table components render without changes.
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { BreakdownRow } from "./useMetaBreakdown";

export function useGoogleAdsBreakdown(
  breakdown: "age" | "gender" | "country" | "device",
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string,
  enabled = true,
) {
  const {
    dv360ClientId,
    dv360ClientSecret,
    dv360RefreshToken,
    googleAdsCustomerId,
    googleAdsLoginCustomerId,
    demoMode,
  } = useAuthStore();

  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      return;
    }

    const custId = demoMode ? "demo-gads-123" : googleAdsCustomerId;
    const hasServerDefaults = !!process.env.NEXT_PUBLIC_HAS_DEFAULT_CREDS;
    if (!hasServerDefaults && !custId) {
      setRows([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/reporting/demographics/google-ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: dv360ClientId,
        clientSecret: dv360ClientSecret,
        refreshToken: dv360RefreshToken,
        customerId: custId,
        loginCustomerId: googleAdsLoginCustomerId,
        breakdown,
        startDate,
        endDate,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setRows(d.rows || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || "Fetch failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    breakdown,
    startDate,
    endDate,
    enabled,
    dv360ClientId,
    dv360ClientSecret,
    dv360RefreshToken,
    googleAdsCustomerId,
    googleAdsLoginCustomerId,
    demoMode,
  ]);

  return { rows, loading, error };
}
