/**
 * Google Ads attribution — conversion actions with type, status, category,
 * counting type, and metrics. Fetched from /api/google-ads/conversions.
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";

export interface GAdsConvAction {
  id: string;
  name: string;
  type: string;
  status: string;
  category?: string;
  countingType?: string;
  conversions: number;
  allConversions: number;
  conversionsValue: number;
}

export interface GoogleAdsAttributionState {
  loading: boolean;
  conversionActions?: GAdsConvAction[];
  error?: string;
}

export function useGoogleAdsAttribution(enabled: boolean) {
  const {
    dv360ClientId, dv360ClientSecret, dv360RefreshToken,
    googleAdsCustomerId, googleAdsLoginCustomerId, demoMode,
  } = useAuthStore();

  const [state, setState] = useState<GoogleAdsAttributionState>({ loading: false });

  useEffect(() => {
    const hasServerDefaults = !!process.env.NEXT_PUBLIC_HAS_DEFAULT_CREDS;
    if (
      !enabled ||
      (!hasServerDefaults && !demoMode && (!dv360RefreshToken || !googleAdsCustomerId))
    ) {
      setState({ loading: false });
      return;
    }
    let cancelled = false;
    setState({ loading: true });

    fetch("/api/google-ads/conversions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: demoMode ? "demo-client" : dv360ClientId,
        clientSecret: demoMode ? "demo-secret" : dv360ClientSecret,
        refreshToken: demoMode ? "demo-refresh" : dv360RefreshToken,
        customerId: demoMode ? "demo-customer" : googleAdsCustomerId,
        loginCustomerId: googleAdsLoginCustomerId || undefined,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setState({ loading: false, error: data.error });
        } else {
          setState({ loading: false, conversionActions: data.conversionActions || [] });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, error: "Network error" });
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, demoMode, dv360RefreshToken, googleAdsCustomerId]);

  return state;
}
