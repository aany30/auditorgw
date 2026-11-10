/**
 * Daily Snapchat conversion trend for the Conversion Monitoring tab.
 * Snapchat returns no conversion value, so conversionValue is always 0.
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { DailyConversionRow } from "./useGoogleAdsConversionDaily";

export function useSnapchatConversionDaily(
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
  } = useAuthStore();

  const [rows, setRows] = useState<DailyConversionRow[]>([]);
  const [loading, setLoading] = useState(false);

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    const hasServerDefaults = !!process.env.NEXT_PUBLIC_HAS_DEFAULT_CREDS;
    const hasCreds = snapchatRefreshToken && snapchatAdAccountId;
    if (!enabled || (!hasCreds && !hasServerDefaults)) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch("/api/reporting/daily/snapchat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: snapchatClientId,
        clientSecret: snapchatClientSecret,
        refreshToken: snapchatRefreshToken,
        adAccountId: snapchatAdAccountId,
        orgId: snapchatOrgId,
        startDate,
        endDate,
      }),
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setRows(d.rows || []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [startDate, endDate, enabled, snapchatClientId, snapchatClientSecret, snapchatRefreshToken, snapchatAdAccountId, snapchatOrgId]);

  return { rows, loading };
}
