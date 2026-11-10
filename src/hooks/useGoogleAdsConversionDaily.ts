/**
 * Daily Google Ads conversion trend for the Conversion Monitoring tab.
 * Returns rows: [{ label, spend, clicks, conversions, conversionValue }].
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";

export interface DailyConversionRow {
  label: string;
  spend: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

export function useGoogleAdsConversionDaily(
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
  } = useAuthStore();

  const [rows, setRows] = useState<DailyConversionRow[]>([]);
  const [loading, setLoading] = useState(false);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    const hasServerDefaults = !!process.env.NEXT_PUBLIC_HAS_DEFAULT_CREDS;
    if (!enabled || (!googleAdsCustomerId && !hasServerDefaults)) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch("/api/reporting/daily/google-ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: dv360ClientId,
        clientSecret: dv360ClientSecret,
        refreshToken: dv360RefreshToken,
        customerId: googleAdsCustomerId,
        loginCustomerId: googleAdsLoginCustomerId,
        startDate,
        endDate,
      }),
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setRows(d.rows || []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [startDate, endDate, enabled, dv360ClientId, dv360ClientSecret, dv360RefreshToken, googleAdsCustomerId, googleAdsLoginCustomerId]);

  return { rows, loading };
}
