/**
 * Shared hook for fetching Meta ad-set level insights.
 * Used by all Audience Analysis tabs (Funnel, Performance, Saturation, etc.).
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { AdSetRow } from "@/pages/api/audience/adset-insights/meta";
import type { DateRange } from "@/components/shared/DateRangePicker";

export type { AdSetRow };

export function useAdSetInsights(
  platform: "meta" | "google" | "both",
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string
) {
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  const [adsets, setAdsets] = useState<AdSetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("INR");

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    if (platform === "google") {
      setAdsets([]);
      return;
    }
    const effectiveToken = demoMode ? "demo-meta-token" : metaAccessToken;
    const effectiveBiz = demoMode ? "demo-business-123" : metaBusinessId;
    if (!effectiveToken || !effectiveBiz) { setAdsets([]); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/audience/adset-insights/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: effectiveToken, businessId: effectiveBiz, startDate, endDate }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) { setError(data.error); return; }
        setAdsets(data.adsets || []);
        if (data.currency) setCurrency(data.currency);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, startDate, endDate, metaAccessToken, metaBusinessId, demoMode]);

  return { adsets, loading, error, currency, startDate, endDate };
}
