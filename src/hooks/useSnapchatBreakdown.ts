/**
 * Hook for fetching Snapchat demographic/placement breakdowns from
 * /api/reporting/demographics/snapchat.
 *
 * Mirrors useGoogleAdsBreakdown so the same chart and table components render
 * without changes.
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { BreakdownRow } from "./useMetaBreakdown";

export function useSnapchatBreakdown(
  breakdown: "age" | "gender" | "country" | "device" | "placement",
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string,
  enabled = true,
) {
  const {
    snapchatClientId,
    snapchatClientSecret,
    snapchatRefreshToken,
    snapchatAdAccountId,
    snapchatOrgId,
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

    const adAcc = demoMode ? "demo-snap-ad-account" : snapchatAdAccountId;
    const hasServerDefaults = !!process.env.NEXT_PUBLIC_HAS_DEFAULT_CREDS;
    if (!hasServerDefaults && !adAcc) {
      setRows([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/reporting/demographics/snapchat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: snapchatClientId,
        clientSecret: snapchatClientSecret,
        refreshToken: snapchatRefreshToken,
        adAccountId: adAcc,
        orgId: snapchatOrgId || undefined,
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
    snapchatClientId,
    snapchatClientSecret,
    snapchatRefreshToken,
    snapchatAdAccountId,
    snapchatOrgId,
    demoMode,
  ]);

  return { rows, loading, error };
}
