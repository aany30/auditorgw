/**
 * Fetches Meta daily breakdown for the current window AND the immediately
 * prior window of the same length. Used by the Overview's KPI cards (current
 * vs previous period deltas + sparklines).
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";

export interface DailyPoint {
  label: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  reach?: number;
  frequency?: number;
}

function prevWindow(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const s = new Date(startDate + "T00:00:00Z");
  const e = new Date(endDate   + "T00:00:00Z");
  const days = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  const prevEnd   = new Date(s.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);
  return {
    startDate: prevStart.toISOString().slice(0, 10),
    endDate:   prevEnd.toISOString().slice(0, 10),
  };
}

export function useMetaDailyVsPrev(
  platform: "meta" | "google" | "both",
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string
) {
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  const [current, setCurrent] = useState<DailyPoint[]>([]);
  const [previous, setPrevious] = useState<DailyPoint[]>([]);
  const [loading, setLoading] = useState(false);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);
  const prev = prevWindow(startDate, endDate);

  useEffect(() => {
    if (platform === "google") { setCurrent([]); setPrevious([]); return; }
    const token = demoMode ? "demo-meta-token" : metaAccessToken;
    const biz   = demoMode ? "demo-business-123" : metaBusinessId;
    if (!token || !biz) { setCurrent([]); setPrevious([]); return; }

    let cancelled = false;
    setLoading(true);

    const fetchDaily = (s: string, e: string) =>
      fetch("/api/reporting/breakdown/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, businessId: biz, breakdown: "daily", startDate: s, endDate: e }),
      })
        .then(r => r.json())
        .then(d => (d.rows || []) as DailyPoint[]);

    Promise.all([fetchDaily(startDate, endDate), fetchDaily(prev.startDate, prev.endDate)])
      .then(([cur, pr]) => { if (!cancelled) { setCurrent(cur); setPrevious(pr); } })
      .catch(() => { if (!cancelled) { setCurrent([]); setPrevious([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, startDate, endDate, prev.startDate, prev.endDate, metaAccessToken, metaBusinessId, demoMode]);

  return { current, previous, loading, startDate, endDate, prevStartDate: prev.startDate, prevEndDate: prev.endDate };
}
