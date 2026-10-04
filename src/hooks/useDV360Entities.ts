/**
 * Lazy, one-shot fetch of the connected DV360 advertiser's insertion orders
 * and line items. Caches in component state (and in a module-level map keyed
 * by advertiserId) so re-mounting the hook on a different campaign row
 * doesn't re-fire the API call.
 *
 * The UI uses the full raw entity shapes — budget segments, flight dates,
 * frequency cap, status — so this hook returns them untyped (unknown) and
 * callers cast at the point of use.
 */
import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { isDemoCredential } from "@/lib/demo-data";

export interface DV360IoRaw {
  insertionOrderId: string;
  campaignId: string;
  displayName: string;
  entityStatus: string;
  budget?: {
    budgetUnit?: string;
    budgetSegments?: Array<{
      budgetAmountMicros?: string;
      description?: string;
      dateRange?: {
        startDate?: { year?: number; month?: number; day?: number };
        endDate?: { year?: number; month?: number; day?: number };
      };
    }>;
  };
  pacing?: { pacingPeriod?: string; pacingType?: string; dailyMaxMicros?: string };
}

export interface DV360LiRaw {
  lineItemId: string;
  insertionOrderId: string;
  campaignId: string;
  displayName: string;
  entityStatus: string;
  lineItemType?: string;
  flight?: {
    dateRange?: {
      startDate?: { year?: number; month?: number; day?: number };
      endDate?: { year?: number; month?: number; day?: number };
    };
  };
  budget?: {
    budgetAllocationType?: string;
    budgetUnit?: string;
    maxAmount?: string;
    budgetAmountMicros?: string;
  };
  frequencyCap?: {
    maxImpressions?: number;
    timeUnit?: string;
    timeUnitCount?: number;
    unlimited?: boolean;
  };
  bidStrategy?: Record<string, unknown>;
}

interface State {
  ios: DV360IoRaw[] | null;
  lis: DV360LiRaw[] | null;
  loading: boolean;
  error: string | null;
}

const cache = new Map<string, { ios: DV360IoRaw[]; lis: DV360LiRaw[] }>();

export function useDV360Entities(): State & {
  iosForCampaign: (campaignId: string) => DV360IoRaw[];
  lisForIo: (ioId: string) => DV360LiRaw[];
  refetch: () => void;
} {
  const {
    dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId,
  } = useAuthStore();
  const isDemo = !dv360RefreshToken || isDemoCredential(dv360RefreshToken);
  const cacheKey = dv360AdvertiserId || "";
  const [state, setState] = useState<State>(() => {
    const hit = cache.get(cacheKey);
    return { ios: hit?.ios ?? null, lis: hit?.lis ?? null, loading: false, error: null };
  });

  const canFetch = !isDemo && !!dv360RefreshToken && !!dv360AdvertiserId && !!dv360ClientId && !!dv360ClientSecret;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!canFetch) return;
    if (cache.has(cacheKey)) {
      const hit = cache.get(cacheKey)!;
      setState({ ios: hit.ios, lis: hit.lis, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch("/api/dv360/entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: dv360ClientId,
        clientSecret: dv360ClientSecret,
        refreshToken: dv360RefreshToken,
        advertiserId: dv360AdvertiserId,
      }),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
        return body as { insertionOrders: DV360IoRaw[]; lineItems: DV360LiRaw[] };
      })
      .then((data) => {
        if (cancelled) return;
        cache.set(cacheKey, { ios: data.insertionOrders, lis: data.lineItems });
        setState({ ios: data.insertionOrders, lis: data.lineItems, loading: false, error: null });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({ ios: null, lis: null, loading: false, error: e?.message || "Fetch failed" });
      });
    return () => { cancelled = true; };
  }, [canFetch, cacheKey, dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId, tick]);

  const iosByCampaign = useMemo(() => {
    const m = new Map<string, DV360IoRaw[]>();
    for (const io of state.ios ?? []) {
      const list = m.get(io.campaignId) ?? [];
      list.push(io);
      m.set(io.campaignId, list);
    }
    return m;
  }, [state.ios]);

  const lisByIo = useMemo(() => {
    const m = new Map<string, DV360LiRaw[]>();
    for (const li of state.lis ?? []) {
      const list = m.get(li.insertionOrderId) ?? [];
      list.push(li);
      m.set(li.insertionOrderId, list);
    }
    return m;
  }, [state.lis]);

  return {
    ...state,
    iosForCampaign: (campaignId: string) => iosByCampaign.get(campaignId) ?? [],
    lisForIo: (ioId: string) => lisByIo.get(ioId) ?? [],
    refetch: () => { cache.delete(cacheKey); setTick((t) => t + 1); },
  };
}
