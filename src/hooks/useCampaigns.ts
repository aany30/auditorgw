/**
 * Shared hook for fetching the campaign list from Meta + DV360 for a given
 * date range. Used by Reporting tabs that need spend / impressions / clicks /
 * conversions per campaign — same data AccountStructureTab loads internally.
 *
 * Returns { campaigns, loading, error, platformErrors }. Empty array when no
 * credentials. When one platform fails and the other succeeds, `campaigns`
 * holds the successful platform's rows and `platformErrors.<platform>` carries
 * the failure so tabs can show a "partial data" banner instead of failing silently.
 */

import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/store/auth";
import type { CampaignData } from "@/types";
import type { DateRange } from "@/components/shared/DateRangePicker";

// 5-minute client-side SWR cache for DV360 campaigns (localStorage).
// Keyed by advertiserId + date range so different windows never cross-pollinate.
const DV360_SWR_TTL_MS = 5 * 60 * 1000;

/** Soft notice (not a hard error) shown when DV360's live fetch failed but we
 *  served the last-good cache. Excluded from the red `error` banner. */
const DV360_CACHED_NOTICE = "DV360 showing recent cached data (live refresh pending)";

/** Max age for the failure-fallback cache read. Longer than the normal TTL so a
 *  sustained DV360 outage keeps showing last-known data rather than collapsing
 *  the aggregate to other-platforms-only. */
const DV360_SWR_STALE_MS = 60 * 60 * 1000;

/** Max dv360_campaigns:* entries to keep. Each entry can be hundreds of KB
 *  for large advertisers; unbounded growth was evicting the auth-store (user's
 *  tokens) via localStorage quota pressure. Cap at 4 — enough for the current
 *  window + a couple of recent switches. */
const DV360_SWR_MAX_ENTRIES = 4;

/** All localStorage keys this cache uses share this prefix. */
const DV360_SWR_PREFIX = "dv360_campaigns:";

function swrKey(advertiserId: string, start: string, end: string, strict = false) {
  return `${DV360_SWR_PREFIX}${advertiserId}:${start}:${end}${strict ? ":strict" : ""}`;
}

function swrRead(key: string): CampaignData[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { rows, ts } = JSON.parse(raw) as { rows: CampaignData[]; ts: number };
    if (Date.now() - ts > DV360_SWR_TTL_MS) { localStorage.removeItem(key); return null; }
    return rows;
  } catch { return null; }
}

// Stale-tolerant read used ONLY as a fallback when the live DV360 fetch fails.
// Returns cached rows up to DV360_SWR_STALE_MS old without deleting them, so a
// longer DV360 outage (gateway timeouts, 5xx) keeps the dashboard showing the
// last-known delivery instead of collapsing the aggregate.
function swrReadStale(key: string): CampaignData[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { rows, ts } = JSON.parse(raw) as { rows: CampaignData[]; ts: number };
    if (Date.now() - ts > DV360_SWR_STALE_MS) return null;
    return rows;
  } catch { return null; }
}

/** Evict oldest dv360_campaigns:* entries beyond MAX. Also drops any TTL-expired
 *  entries while scanning. Keeps auth-store (and everything else) safe from
 *  quota eviction by the browser. */
function pruneSwrCache(exceptKey?: string) {
  try {
    const now = Date.now();
    const entries: Array<{ key: string; ts: number }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(DV360_SWR_PREFIX)) continue;
      if (k === exceptKey) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(k) || "{}") as { ts?: number };
        const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
        // Drop expired entries up front; they're useless either way.
        if (!ts || now - ts > DV360_SWR_TTL_MS) {
          localStorage.removeItem(k);
          continue;
        }
        entries.push({ key: k, ts });
      } catch {
        // Corrupted entry — remove it.
        localStorage.removeItem(k);
      }
    }
    // Keep MAX_ENTRIES - 1 (reserve one slot for the write that triggered us).
    entries.sort((a, b) => b.ts - a.ts); // newest first
    const toEvict = entries.slice(DV360_SWR_MAX_ENTRIES - 1);
    for (const { key } of toEvict) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
  } catch { /* storage access failed — bail */ }
}

/** Nuke ALL dv360_campaigns:* entries. Last-resort when a write hits quota. */
function evictAllSwrCache() {
  try {
    const victims: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DV360_SWR_PREFIX)) victims.push(k);
    }
    for (const k of victims) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

function swrWrite(key: string, rows: CampaignData[]) {
  const payload = JSON.stringify({ rows, ts: Date.now() });
  // Pre-emptively keep the cache small so quota pressure never evicts the
  // auth-store entry.
  pruneSwrCache(key);
  try {
    localStorage.setItem(key, payload);
  } catch {
    // Quota probably exceeded. Drop every dv360_campaigns:* entry and retry
    // once. If it still fails (payload itself too large), silently give up —
    // the dashboard will just re-fetch next time.
    evictAllSwrCache();
    try { localStorage.setItem(key, payload); } catch { /* give up */ }
  }
}

function rangeToDates(
  range: DateRange,
  customStart?: string,
  customEnd?: string
): { startDate: string; endDate: string } {
  if (range === "custom" && customStart && customEnd)
    return { startDate: customStart, endDate: customEnd };
  const today = new Date();
  const start = new Date(today);
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  start.setDate(today.getDate() - days);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: today.toISOString().slice(0, 10),
  };
}

export function useCampaigns(
  platform: "meta" | "dv360" | "google_ads" | "snapchat" | "spotify" | "both",
  dateRange: DateRange,
  customStart?: string,
  customEnd?: string,
  /** When true, disables DV360's all-time fallback on the server so the picker
   * is honored strictly — used by the Dashboard tab. */
  strictWindow = false
) {
  const {
    metaAccessToken,
    metaBusinessId,
    dv360ClientId,
    dv360ClientSecret,
    dv360RefreshToken,
    dv360AdvertiserId,
    dv360PartnerId,
    googleAdsCustomerId,
    googleAdsLoginCustomerId,
    snapchatClientId,
    snapchatClientSecret,
    snapchatRefreshToken,
    snapchatAdAccountId,
    snapchatOrgId,
    spotifyClientId,
    spotifyClientSecret,
    spotifyRefreshToken,
    spotifyAdAccountId,
    demoMode,
    metaCurrency: storedMetaCurrency,
    dv360Currency: storedDv360Currency,
    googleAdsCurrency: storedGoogleAdsCurrency,
    snapchatCurrency: storedSnapchatCurrency,
    spotifyCurrency: storedSpotifyCurrency,
    setMetaCurrency,
    setDv360Currency,
    setGoogleAdsCurrency,
    setSnapchatCurrency,
    setSpotifyCurrency,
  } = useAuthStore();

  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platformErrors, setPlatformErrors] = useState<{ meta?: string; dv360?: string; google_ads?: string; snapchat?: string; spotify?: string }>({});
  const [dv360Repolling, setDv360Repolling] = useState(false);
  const swrSeeded = useRef(false);
  const dvRetries = useRef(0);
  const fetchInFlight = useRef(false);
  const campaignsRef = useRef<CampaignData[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const MAX_DV360_RETRIES = 3;

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  // On first render (and when the key params change) pre-populate from the
  // DV360 SWR cache so the UI renders immediately without waiting for the API.
  const effectiveAdvertiserId = demoMode ? "demo-advertiser-1" : dv360AdvertiserId;
  useEffect(() => {
    swrSeeded.current = false;
    dvRetries.current = 0; // fresh account/date window — restart the DV360 poll budget
    if (!effectiveAdvertiserId || !(platform === "dv360" || platform === "both")) return;
    const key = swrKey(effectiveAdvertiserId, startDate, endDate, strictWindow);
    const cached = swrRead(key);
    if (cached && cached.length > 0) {
      setCampaigns(cached);
      campaignsRef.current = cached;
      // Only skip the spinner for DV360-only mode. In "both" mode the DV360
      // cache doesn't include Meta, so clearing loading here would briefly show
      // a misleading "no Meta data" state until the Meta fetch lands — keep
      // loading true so Meta-dependent views show a loading state, not "empty".
      if (platform === "dv360") {
        swrSeeded.current = true;
        setLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, startDate, endDate, effectiveAdvertiserId]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // Prevent re-poll pileup: if a previous fetch is still in-flight (takes ~40s
    // for BM report polling), skip this tick and let it complete first.
    if (reloadTick > 0 && fetchInFlight.current) return;
    const isRepoll = reloadTick > 0;
    const fetchCampaigns = async () => {
      fetchInFlight.current = true;
      // First tick without SWR cache → show spinner. Re-poll ticks and SWR-seeded
      // renders leave loading unchanged (stays true while DV360 is pending, avoids
      // a flash between polls).
      if (!isRepoll && !swrSeeded.current) setLoading(true);
      if (!isRepoll) {
        setError(null);
        setPlatformErrors({});
      }
      const errs: { meta?: string; dv360?: string; google_ads?: string; snapchat?: string; spotify?: string } = {};
      // On repoll, seed with existing non-DV360 campaigns so they aren't wiped.
      const all: CampaignData[] = isRepoll ? campaignsRef.current.filter((c) => c.platform !== "dv360") : [];
      const hasServerDefaults = !!process.env.NEXT_PUBLIC_HAS_DEFAULT_CREDS;
      try {
        const effectiveMetaToken = demoMode ? "demo-meta-token" : metaAccessToken;
        const effectiveMetaBiz = demoMode ? "demo-business-123" : metaBusinessId;
        const effectiveDv360Refresh = demoMode ? "demo-dv360-refresh" : dv360RefreshToken;

        const canFetchMeta = (platform === "meta" || platform === "both") && (effectiveMetaToken && effectiveMetaBiz || hasServerDefaults);
        const canFetchDv = (platform === "dv360" || platform === "both") &&
          (effectiveDv360Refresh && (demoMode || (dv360ClientId && dv360ClientSecret && dv360AdvertiserId)) || hasServerDefaults);
        const canFetchGads = (platform === "google_ads" || platform === "both") &&
          (googleAdsCustomerId && dv360RefreshToken && dv360ClientId && dv360ClientSecret || hasServerDefaults);
        const canFetchSnap = (platform === "snapchat" || platform === "both") &&
          (snapchatRefreshToken && snapchatClientId && snapchatClientSecret && snapchatAdAccountId || hasServerDefaults);
        const canFetchSpotify = (platform === "spotify" || platform === "both") &&
          (spotifyRefreshToken && spotifyClientId && spotifyClientSecret && spotifyAdAccountId || hasServerDefaults);

        type PlatformKey = "meta" | "dv360" | "google_ads" | "snapchat" | "spotify";
        const fetches: Array<{ key: PlatformKey; promise: Promise<Response> }> = [];

        // On DV360 repoll ticks, only refetch DV360 — keep existing data for
        // other platforms to avoid flickering the whole dashboard to zero.
        if (canFetchMeta && !isRepoll) fetches.push({ key: "meta", promise: fetch("/api/naming/campaigns/meta", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: effectiveMetaToken || undefined, businessId: effectiveMetaBiz || undefined, startDate, endDate }),
        })});
        if (canFetchDv) fetches.push({ key: "dv360", promise: fetch("/api/naming/campaigns/dv360", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: demoMode ? "demo-client" : dv360ClientId || undefined,
            clientSecret: demoMode ? "demo-secret" : dv360ClientSecret || undefined,
            refreshToken: effectiveDv360Refresh || undefined,
            advertiserId: demoMode ? "demo-advertiser-1" : dv360AdvertiserId || undefined,
            partnerId: dv360PartnerId || undefined, startDate, endDate, strictWindow,
          }),
        })});
        if (canFetchGads && !isRepoll) fetches.push({ key: "google_ads", promise: fetch("/api/naming/campaigns/google-ads", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: dv360ClientId || undefined, clientSecret: dv360ClientSecret || undefined,
            refreshToken: dv360RefreshToken || undefined, customerId: googleAdsCustomerId || undefined,
            loginCustomerId: googleAdsLoginCustomerId || undefined, startDate, endDate,
          }),
        })});
        if (canFetchSnap && !isRepoll) fetches.push({ key: "snapchat", promise: fetch("/api/naming/campaigns/snapchat", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: snapchatClientId || undefined, clientSecret: snapchatClientSecret || undefined,
            refreshToken: snapchatRefreshToken || undefined, adAccountId: snapchatAdAccountId || undefined,
            orgId: snapchatOrgId || undefined, startDate, endDate,
          }),
        })});
        if (canFetchSpotify && !isRepoll) fetches.push({ key: "spotify", promise: fetch("/api/naming/campaigns/spotify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: spotifyClientId || undefined, clientSecret: spotifyClientSecret || undefined,
            refreshToken: spotifyRefreshToken || undefined, adAccountId: spotifyAdAccountId || undefined,
            startDate, endDate,
          }),
        })});

        // Robustness: DV360 delivery comes from async Bid Manager reports that
        // can time out at the gateway ("Failed to fetch") or return a 5xx. When
        // the live fetch fails, reuse the last-good SWR cache so the aggregate
        // doesn't collapse to other-platforms-only (spend/impressions swinging
        // between e.g. ₹1.25L and ₹6.44L across reloads). Returns true if the
        // cache was applied.
        const dv360CacheFallback = (): boolean => {
          if (!effectiveAdvertiserId) return false;
          if (all.some((c) => c.platform === "dv360")) return false; // already have fresh rows
          const cached = swrReadStale(swrKey(effectiveAdvertiserId, startDate, endDate, strictWindow));
          if (!cached || cached.length === 0) return false;
          all.push(...cached);
          if (!cancelled) {
            campaignsRef.current = [...all];
            setCampaigns([...all]);
          }
          return true;
        };

        // Process each platform response as it arrives so the UI updates
        // progressively instead of waiting for the slowest platform.
        let resolved = 0;
        await Promise.allSettled(fetches.map(async ({ key, promise }) => {
          try {
            const r = await promise;
            if (r.ok) {
              const rows: CampaignData[] = await r.json();
              all.push(...rows);
              if (key === "dv360" && effectiveAdvertiserId && rows.length > 0) {
                swrWrite(swrKey(effectiveAdvertiserId, startDate, endDate, strictWindow), rows);
              }
              if (!cancelled) {
                campaignsRef.current = [...all];
                setCampaigns([...all]);
              }
            } else {
              const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
              errs[key] = body.error || `${key} API error (HTTP ${r.status})`;
              if (key === "dv360" && dv360CacheFallback()) {
                errs[key] = DV360_CACHED_NOTICE;
              }
            }
          } catch (e) {
            errs[key] = e instanceof Error ? e.message : `${key} fetch failed`;
            if (key === "dv360" && dv360CacheFallback()) {
              errs[key] = DV360_CACHED_NOTICE;
            }
          } finally {
            resolved++;
            if (!cancelled && resolved < fetches.length) {
              setPlatformErrors({ ...errs });
            }
          }
        }));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Fetch failed");
      } finally {
        if (!cancelled) {
          setCampaigns(all);
          campaignsRef.current = all;
          setPlatformErrors(errs);
          // Keep legacy `error` populated for existing consumers — but the DV360
          // cached-data fallback is a soft notice (data loaded fine from cache),
          // not a blocking error, so it must not drive the red error banners.
          const dvHardErr = errs.dv360 === DV360_CACHED_NOTICE ? undefined : errs.dv360;
          const first = errs.meta || dvHardErr || errs.google_ads || errs.snapchat || errs.spotify;
          if (first) setError(first);
          // Cache each platform's detected currency (sticky) so a later
          // rate-limited fetch that drops a platform still renders the right
          // symbol. Done here (not in a separate effect) to keep hook count fixed.
          const m = all.find((c) => c.platform === "meta" && c.currency)?.currency;
          const d = all.find((c) => c.platform === "dv360" && c.currency)?.currency;
          const g = all.find((c) => c.platform === "google_ads" && c.currency)?.currency;
          const s = all.find((c) => c.platform === "snapchat" && c.currency)?.currency;
          const sp = all.find((c) => c.platform === "spotify" && c.currency)?.currency;
          if (m) setMetaCurrency(m);
          if (d) setDv360Currency(d);
          if (g) setGoogleAdsCurrency(g);
          if (s) setSnapchatCurrency(s);
          if (sp) setSpotifyCurrency(sp);

          fetchInFlight.current = false;
          // DV360 re-poll: DV360 delivery comes from async Bid Manager reports
          // that may still be generating on the first call. Re-poll only when
          // delivery metrics (spend + impressions) are still zero — don't gate
          // on reach, which may legitimately stay 0 if no reach report exists.
          let willRepoll = false;
          if (!errs.dv360 && (platform === "dv360" || platform === "both") && !demoMode) {
            const dv = all.filter((c) => c.platform === "dv360");
            const dvDelivered = dv.reduce((s, c) => s + (c.spend || 0) + (c.impressions || 0), 0);
            const pending = dv.length > 0 && dvDelivered === 0;
            if (pending && dvRetries.current < MAX_DV360_RETRIES) {
              willRepoll = true;
              dvRetries.current += 1;
              const delay = 3000 * Math.pow(2, dvRetries.current - 1);
              retryTimer = setTimeout(() => { if (!cancelled) setReloadTick((t) => t + 1); }, delay);
            }
          }
          setDv360Repolling(willRepoll);
          setLoading(false);
        }
      }
    };
    fetchCampaigns();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    platform,
    startDate,
    endDate,
    metaAccessToken,
    metaBusinessId,
    dv360ClientId,
    dv360ClientSecret,
    dv360RefreshToken,
    dv360AdvertiserId,
    googleAdsCustomerId,
    googleAdsLoginCustomerId,
    snapchatClientId,
    snapchatClientSecret,
    snapchatRefreshToken,
    snapchatAdAccountId,
    snapchatOrgId,
    spotifyClientId,
    spotifyClientSecret,
    spotifyRefreshToken,
    spotifyAdAccountId,
    demoMode,
    reloadTick,
    strictWindow,
  ]);

  // Per-platform account currencies. Detect strictly from each platform's own
  // campaigns (never cross-fall-back, so DV360's USD can't mislabel Meta's INR).
  // Cache the detected value in the store so a later rate-limited fetch that
  // returns no campaigns for a platform still renders the right symbol.
  const detectedMeta = campaigns.find((c) => c.platform === "meta" && c.currency)?.currency;
  const detectedDv360 = campaigns.find((c) => c.platform === "dv360" && c.currency)?.currency;
  const detectedGads = campaigns.find((c) => c.platform === "google_ads" && c.currency)?.currency;
  const detectedSnap = campaigns.find((c) => c.platform === "snapchat" && c.currency)?.currency;
  const detectedSpotify = campaigns.find((c) => c.platform === "spotify" && c.currency)?.currency;

  const metaCurrency = detectedMeta || storedMetaCurrency || "USD";
  const dv360Currency = detectedDv360 || storedDv360Currency || "USD";
  const googleAdsCurrency = detectedGads || storedGoogleAdsCurrency || "USD";
  const snapchatCurrency = detectedSnap || storedSnapchatCurrency || "USD";
  const spotifyCurrency = detectedSpotify || storedSpotifyCurrency || "USD";

  return { campaigns, loading, dv360Repolling, error, platformErrors, startDate, endDate, metaCurrency, dv360Currency, googleAdsCurrency, snapchatCurrency, spotifyCurrency };
}
