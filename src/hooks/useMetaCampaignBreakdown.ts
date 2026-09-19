/**
 * Fetches per-campaign Meta insights broken down by publisher_platform (or
 * other supported breakdowns). Powers the Planning tab's Channel drill so
 * each publisher only shows the campaigns that actually delivered on it.
 */
import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import type { DateRange } from "@/components/shared/DateRangePicker";

interface Row {
  campaignId: string;
  breakdownValue: string;
  spend: number;
  impressions: number;
  clicks: number;
}

function rangeToDates(range: DateRange, cs?: string, ce?: string) {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const daysBack = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 30;
  if (range === "custom" && cs && ce) return { startDate: cs, endDate: ce };
  const start = new Date(today.getTime() - daysBack * 86_400_000).toISOString().slice(0, 10);
  return { startDate: start, endDate: end };
}

export function useMetaCampaignBreakdown(
  breakdown: "publisher_platform" | "platform_position" | "device_platform" | "impression_device",
  range: DateRange,
  cs?: string,
  ce?: string,
  enabled = true,
) {
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const { startDate, endDate } = rangeToDates(range, cs, ce);

  useEffect(() => {
    if (!enabled) { setRows([]); return; }
    const token = demoMode ? "demo-meta-token" : metaAccessToken;
    const biz = demoMode ? "demo-business-123" : metaBusinessId;
    const hasServerDefaults = !!process.env.NEXT_PUBLIC_HAS_DEFAULT_CREDS;
    if (!hasServerDefaults && !token && !biz) { setRows([]); return; }
    let cancelled = false;
    setLoading(true);
    fetch("/api/reporting/breakdown/meta-by-campaign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token, businessId: biz, breakdown, startDate, endDate }),
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setRows(d.rows || []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, breakdown, startDate, endDate, metaAccessToken, metaBusinessId, demoMode]);

  return { rows, loading };
}
