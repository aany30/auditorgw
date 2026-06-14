import { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "@/store/auth";
import type { MetaAuditResponse } from "@/pages/api/audit/meta";
import type { GoogleAuditResponse } from "@/pages/api/audit/google";
import type { DateRange } from "@/components/shared/DateRangePicker";

export interface AuditState {
  meta: MetaAuditResponse | null;
  google: GoogleAuditResponse | null;
  loading: boolean;
  error: string | null;
  source: "live" | "demo" | "mixed" | null;
}

function dateRangeToParams(range: DateRange, customStart?: string, customEnd?: string) {
  if (range === "custom" && customStart && customEnd) {
    return { startDate: customStart, endDate: customEnd };
  }
  const today = new Date();
  const start = new Date(today);
  if (range === "7d") start.setDate(today.getDate() - 7);
  else if (range === "30d") start.setDate(today.getDate() - 30);
  else if (range === "90d") start.setDate(today.getDate() - 90);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: today.toISOString().slice(0, 10),
  };
}

export function useAudit(
  platform: "meta" | "google" | "both",
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string
): AuditState & { refresh: () => void } {
  const {
    metaAccessToken,
    metaPixelIds,
    googleAccessToken,
    googleCustomerId,
    gaPropertyId,
    gtmContainerId,
    googleAdsDeveloperToken,
    googleAdsLoginCustomerId,
    isMetaConnected,
    isGoogleConnected,
    demoMode,
  } = useAuthStore();
  // In demo mode, send demo-prefixed placeholders so the API endpoints take
  // their isDemoCredential() branch and return demo data — without ever
  // writing those placeholders into localStorage.
  const effectiveMetaToken = demoMode ? "demo-meta-token" : metaAccessToken;
  const effectiveGoogleToken = demoMode ? "demo-google-token" : googleAccessToken;
  const effectiveMetaConnected = demoMode ? true : isMetaConnected();
  const effectiveGoogleConnected = demoMode ? true : isGoogleConnected();

  const [state, setState] = useState<AuditState>({
    meta: null,
    google: null,
    loading: true,
    error: null,
    source: null,
  });

  const fetchAudit = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    const { startDate, endDate } = dateRangeToParams(dateRange, customStart, customEnd);
    const promises: Promise<void>[] = [];
    let metaData: MetaAuditResponse | null = null;
    let googleData: GoogleAuditResponse | null = null;
    let fetchError: string | null = null;

    if ((platform === "meta" || platform === "both") && effectiveMetaConnected && effectiveMetaToken) {
      promises.push(
        fetch("/api/audit/meta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: effectiveMetaToken,
            pixelIds: demoMode ? ["demo-pixel-001", "demo-pixel-002"] : metaPixelIds,
            businessId: demoMode ? "demo-business-123" : useAuthStore.getState().metaBusinessId,
            startDate,
            endDate,
          }),
        })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok) { fetchError = d.error || `Meta API error (HTTP ${r.status})`; return; }
            metaData = d;
          })
          .catch((e) => { fetchError = e?.message || "Meta fetch failed"; })
      );
    }

    if (
      (platform === "google" || platform === "both") &&
      effectiveGoogleConnected &&
      effectiveGoogleToken
    ) {
      promises.push(
        fetch("/api/audit/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: effectiveGoogleToken,
            customerId: demoMode ? "123-456-7890" : googleCustomerId,
            propertyId: demoMode ? "GA4-DEMO-001" : gaPropertyId,
            containerId: demoMode ? "GTM-DEMO" : gtmContainerId,
            developerToken: googleAdsDeveloperToken,
            loginCustomerId: googleAdsLoginCustomerId,
            startDate,
            endDate,
          }),
        })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok) { fetchError = d.error || `Google API error (HTTP ${r.status})`; return; }
            googleData = d;
          })
          .catch((e) => { fetchError = e?.message || "Google fetch failed"; })
      );
    }

    await Promise.all(promises);

    const sourcesArray: Array<string> = [];
    if (metaData) sourcesArray.push((metaData as any).source);
    if (googleData) sourcesArray.push((googleData as any).source);

    const source: AuditState["source"] =
      sourcesArray.length === 0
        ? null
        : sourcesArray.every((s) => s === "live")
        ? "live"
        : sourcesArray.every((s) => s === "demo")
        ? "demo"
        : "mixed";

    setState({ meta: metaData, google: googleData, loading: false, error: fetchError, source });
  }, [
    platform,
    dateRange,
    customStart,
    customEnd,
    demoMode,
    metaAccessToken,
    metaPixelIds,
    googleAccessToken,
    googleCustomerId,
    gaPropertyId,
    gtmContainerId,
    googleAdsDeveloperToken,
    googleAdsLoginCustomerId,
    isMetaConnected,
    isGoogleConnected,
  ]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  return { ...state, refresh: fetchAudit };
}
