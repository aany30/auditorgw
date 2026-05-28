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
  } = useAuthStore();

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

    if ((platform === "meta" || platform === "both") && isMetaConnected() && metaAccessToken) {
      promises.push(
        fetch("/api/audit/meta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: metaAccessToken,
            pixelIds: metaPixelIds,
            // Sent so the endpoint can auto-discover pixels when the user
            // left the Pixel IDs field blank in the credential form.
            businessId: useAuthStore.getState().metaBusinessId,
            startDate,
            endDate,
          }),
        })
          .then((r) => r.json())
          .then((d) => {
            metaData = d;
          })
          .catch(() => {})
      );
    }

    if (
      (platform === "google" || platform === "both") &&
      isGoogleConnected() &&
      googleAccessToken
    ) {
      promises.push(
        fetch("/api/audit/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: googleAccessToken,
            customerId: googleCustomerId,
            propertyId: gaPropertyId,
            containerId: gtmContainerId,
            developerToken: googleAdsDeveloperToken,
            loginCustomerId: googleAdsLoginCustomerId,
            startDate,
            endDate,
          }),
        })
          .then((r) => r.json())
          .then((d) => {
            googleData = d;
          })
          .catch(() => {})
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

    setState({ meta: metaData, google: googleData, loading: false, error: null, source });
  }, [
    platform,
    dateRange,
    customStart,
    customEnd,
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
