/**
 * Fetches Google Ads remarketing/audience lists (user_list).
 */
import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";

export interface GoogleAdsAudience {
  id: string;
  name: string;
  type: string;
  membershipStatus: string;
  sizeForSearch: number;
  sizeForDisplay: number;
  description: string;
  membershipLifeSpanDays: number;
}

export function useGoogleAdsAudiences(enabled: boolean) {
  const { dv360ClientId, dv360ClientSecret, dv360RefreshToken, googleAdsCustomerId, demoMode } = useAuthStore();
  const [audiences, setAudiences] = useState<GoogleAdsAudience[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) { setAudiences([]); setLoading(false); return; }
    const hasServerDefaults = !!process.env.NEXT_PUBLIC_HAS_DEFAULT_CREDS;
    if (!hasServerDefaults && (!dv360RefreshToken || !googleAdsCustomerId)) { setAudiences([]); setLoading(false); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/audience/list/google-ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: dv360ClientId,
        clientSecret: dv360ClientSecret,
        refreshToken: dv360RefreshToken,
        customerId: googleAdsCustomerId,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) { setError(data.error); return; }
        setAudiences(data.audiences || []);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [enabled, dv360ClientId, dv360ClientSecret, dv360RefreshToken, googleAdsCustomerId, demoMode]);

  return { audiences, loading, error };
}
