/**
 * POST /api/reporting/ad-insights/meta
 *
 * Ad-level insights — top ads ranked by spend with creative type + thumbnail.
 * Language is derived from the ad set's targeting.locales[] field (Meta locale IDs).
 * Used by the Creative report.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";
import { metaSafeCall, metaCache, cacheKey, chunk, withAbortTimeout, metaThrottle } from "@/lib/meta-request-utils";
import { resolveMetaCreds } from "@/lib/default-credentials";

// Same chunk-size rationale as /adsets/meta — some large accounts have
// Meta silently returning 0 ads on account-level `/act_/insights?level=ad`
// because the aggregation ceiling is exceeded. Splitting by campaign IDs
// via a filtering predicate keeps every request well under the ceiling.
const CAMPAIGNS_PER_CHUNK = 10;
const META_API_BASE = "https://graph.facebook.com/v18.0";

export interface AdInsightRow {
  id: string;
  name: string;
  campaignName?: string;
  adSetName?: string;
  adSetId?: string;
  creativeType?: string;
  thumbnailUrl?: string;
  language?: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  videoViews: number;
}

// Meta's full ad-locale table is static reference data — fetch once and cache
// for the server's lifetime so we don't re-pull it on every request.
let localeMapCache: Map<number, string> | null = null;
async function getLocaleNameMap(client: MetaApiClient): Promise<Map<number, string>> {
  if (localeMapCache && localeMapCache.size > 0) return localeMapCache;
  const m = await client.getAdLocales();
  if (m.size > 0) localeMapCache = m;
  return m;
}

// Meta locale ID → language name (most common ones) — built-in fallback used when
// the full ad-locale fetch is unavailable.
export const META_LOCALE_MAP: Record<number, string> = {
  6:   "English",
  24:  "English",
  4:   "English",
  23:  "Hindi",
  45:  "Tamil",
  57:  "Kannada",
  67:  "Malayalam",
  74:  "Marathi",
  50:  "Bengali",
  90:  "Telugu",
  54:  "Gujarati",
  81:  "Punjabi",
  28:  "Spanish",
  25:  "French",
  14:  "German",
  5:   "Italian",
  27:  "Portuguese",
  31:  "Arabic",
  7:   "Japanese",
  10:  "Korean",
  29:  "Chinese (Simplified)",
};

/**
 * Resolve locale IDs to a display language string.
 * - No locales targeted → "All languages" (genuinely no language restriction).
 * - Locales present → their real names via `nameMap` (Meta's full ad-locale
 *   table), falling back to the small built-in map. If IDs still can't be
 *   resolved we return "Unknown" — NEVER "All languages", which would falsely
 *   imply the ad set wasn't language-targeted.
 */
export function localesToLanguage(locales: number[] | undefined, nameMap?: Map<number, string>): string {
  if (!locales || locales.length === 0) return "All languages";
  const resolve = (id: number) => nameMap?.get(id) ?? META_LOCALE_MAP[id];
  const names = [...new Set(locales.map(resolve).filter(Boolean))];
  return names.length > 0 ? names.join(" / ") : "Unknown";
}

// Demo: adSetId → locales mapping (realistic for an Indian DTC brand)
const DEMO_ADSET_LOCALES: Record<string, number[]> = {
  "as_001": [6, 23],     // English + Hindi (Broad All India)
  "as_002": [6],          // English (Interest - Skincare)
  "as_003": [6],          // English (LAL)
  "as_004": [6, 23],     // English + Hindi (Broad Female)
  "as_005": [6],          // English (Website Visitors)
  "as_006": [6],          // English (Video Viewers)
  "as_007": [6, 23],     // English + Hindi (ATC)
  "as_008": [6],          // English (Checkout Abandon)
  "as_009": [6],          // English (LAL Engagers)
  "as_010": [6, 23],     // English + Hindi (Broad All India)
};

const DEMO_ADS: AdInsightRow[] = [
  { id: "ad_01", adSetId: "as_001", name: "Hero Reel — Skincare Routine v3",     campaignName: "GW_All_Product_Sales_Campaign_7_May'26",        adSetName: "TOF - Broad - All India",         creativeType: "VIDEO",    language: "English / Hindi", spend: 18500, impressions: 920000, reach: 680000,  clicks: 14200, conversions: 142, conversionValue: 96000,  videoViews: 276000 },
  { id: "ad_02", adSetId: "as_002", name: "Static — B1G1 Offer Banner",           campaignName: "Plenaire - TOF - B1G1 - 21/05",                 adSetName: "TOF - Interest - Skincare",       creativeType: "PHOTO",    language: "English",         spend: 14200, impressions: 780000, reach: 520000,  clicks: 11800, conversions: 110, conversionValue: 71500,  videoViews: 0 },
  { id: "ad_03", adSetId: "as_003", name: "Carousel — Product Range Tour",        campaignName: "GW_All_Product_Sales_Campaign_7_May'26",        adSetName: "TOF - LAL 1pct Purchasers",       creativeType: "CAROUSEL", language: "English",         spend: 12800, impressions: 540000, reach: 380000,  clicks: 9600,  conversions: 132, conversionValue: 102000, videoViews: 0 },
  { id: "ad_04", adSetId: "as_004", name: "UGC Video — Customer Testimonial",     campaignName: "Plenaire - TOF - Glacee - 21/05",               adSetName: "TOF - Broad 18-35 Female",        creativeType: "VIDEO",    language: "English / Hindi", spend: 9800,  impressions: 410000, reach: 310000,  clicks: 7200,  conversions: 88,  conversionValue: 61000,  videoViews: 143500 },
  { id: "ad_05", adSetId: "as_005", name: "Static — Limited Time Offer",          campaignName: "GW_Add_Cart_Retargeting_22nd_May'26",           adSetName: "MOF - Website Visitors 30d",      creativeType: "PHOTO",    language: "English",         spend: 8200,  impressions: 280000, reach: 195000,  clicks: 6400,  conversions: 95,  conversionValue: 78000,  videoViews: 0 },
  { id: "ad_06", adSetId: "as_006", name: "Reel — 30s Founder Story",             campaignName: "Plenaire - TOF - Aesthetique - 03/06",          adSetName: "MOF - Video Viewers 75pct",       creativeType: "VIDEO",    language: "English",         spend: 7500,  impressions: 320000, reach: 240000,  clicks: 5100,  conversions: 42,  conversionValue: 33000,  videoViews: 112000 },
  { id: "ad_07", adSetId: "as_007", name: "Carousel — Bestsellers Top 5",         campaignName: "GW_All_Product_Sales_Campaign_8th_June'26",     adSetName: "BOF - ATC 7d",                    creativeType: "CAROUSEL", language: "English / Hindi", spend: 6800,  impressions: 145000, reach: 98000,   clicks: 4400,  conversions: 118, conversionValue: 102000, videoViews: 0 },
  { id: "ad_08", adSetId: "as_008", name: "Static — Free Sample Promo",           campaignName: "GW_All_Product_Catalogue_Sales_Campaign_12_May",adSetName: "BOF - Checkout Abandon 3d",       creativeType: "PHOTO",    language: "English",         spend: 5200,  impressions: 98000,  reach: 72000,   clicks: 3800,  conversions: 78,  conversionValue: 78000,  videoViews: 0 },
  { id: "ad_09", adSetId: "as_009", name: "Reel — Influencer Collab #2",          campaignName: "Plenaire - TOF - Consolidate - BC - 14/05",     adSetName: "TOF - LAL 2pct Engagers",         creativeType: "VIDEO",    language: "English",         spend: 4500,  impressions: 195000, reach: 148000,  clicks: 2900,  conversions: 38,  conversionValue: 26000,  videoViews: 68250 },
  { id: "ad_10", adSetId: "as_010", name: "Static — Brand Awareness",             campaignName: "Plenaire - TOF - B1G1 - 21/05",                 adSetName: "TOF - Broad - All India",         creativeType: "PHOTO",    language: "English / Hindi", spend: 3800,  impressions: 142000, reach: 105000,  clicks: 2100,  conversions: 24,  conversionValue: 16000,  videoViews: 0 },
];

/** Direct Meta fetch — used for the campaign-list lookup and the chunked
 *  insights calls. Uses the same error-parsing shape as the client. */
async function metaFetch<T>(token: string, path: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  const url = new URL(`${META_API_BASE}${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), signal ? { signal } : undefined);
  try {
    const acctMatch = path.match(/\/act_(\d+)/);
    if (acctMatch) metaThrottle.recordFromHeader(`act_${acctMatch[1]}`, res.headers.get("x-business-use-case-usage") ?? res.headers.get("x-ad-account-usage") ?? res.headers.get("x-app-usage"));
  } catch { /* best-effort */ }
  if (!res.ok) {
    const body = await res.text();
    let msg = `Meta API ${res.status}`;
    try { const j = JSON.parse(body); msg = `Meta API: ${j?.error?.message ?? msg}`; } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/** Fetch ad-level insights for a specific chunk of campaign IDs using the
 *  filtering=[{field:"campaign.id",operator:"IN",value:[...]}] predicate.
 *  This bypasses Meta's account-level aggregation ceiling that returns
 *  empty 200s on very large accounts. */
async function fetchAdInsightsForCampaignChunk(
  token: string,
  accountPath: string,
  campaignIds: string[],
  startDate?: string,
  endDate?: string,
  limit = 200,
  signal?: AbortSignal,
): Promise<any[]> {
  const filtering = JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }]);
  const params: Record<string, string> = {
    level: "ad",
    fields: "ad_id,ad_name,adset_id,campaign_name,adset_name,spend,impressions,reach,clicks,actions,action_values,video_play_actions",
    filtering,
    limit: String(limit),
    sort: "spend_descending",
  };
  if (startDate && endDate) params.time_range = `{"since":"${startDate}","until":"${endDate}"}`;
  else params.date_preset = "last_30d";
  const res = await metaFetch<{ data?: any[] }>(token, `/${accountPath}/insights`, params, signal);
  return res.data ?? [];
}

/** Hydrate object_type + thumbnail for a batch of ad IDs via the
 *  ?ids=... batch endpoint. Chunked at 50 (Graph's practical limit). */
async function hydrateAdCreatives(
  token: string,
  adIds: string[],
): Promise<Record<string, { object_type?: string; thumbnail_url?: string }>> {
  const out: Record<string, { object_type?: string; thumbnail_url?: string }> = {};
  const CHUNK = 50;
  for (let i = 0; i < adIds.length; i += CHUNK) {
    const ids = adIds.slice(i, i + CHUNK);
    try {
      const res = await metaFetch<Record<string, { creative?: { object_type?: string; thumbnail_url?: string } }>>(
        token,
        "/",
        { ids: ids.join(","), fields: "creative{object_type,thumbnail_url}" }
      );
      for (const id of ids) {
        const rec = res?.[id]?.creative;
        if (rec) out[id] = { object_type: rec.object_type, thumbnail_url: rec.thumbnail_url };
      }
    } catch { /* skip failed batch, leave those ads without creative type */ }
  }
  return out;
}

/** Sum conversion events, deduplicating aliases. Mirrors MetaApiClient. */
function sumConversions(rows: Array<{ action_type: string; value: string }> | undefined): number {
  if (!rows || rows.length === 0) return 0;
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.action_type] = (byType[r.action_type] || 0) + (parseFloat(r.value) || 0);
  const groups: Array<[string, ...string[]]> = [
    ["purchase", "offsite_conversion.fb_pixel_purchase"],
    ["subscribe", "offsite_conversion.fb_pixel_subscribe"],
    ["start_trial", "offsite_conversion.fb_pixel_start_trial"],
    ["lead", "offsite_conversion.fb_pixel_lead"],
    ["onsite_conversion.lead_grouped"],
    ["complete_registration", "offsite_conversion.fb_pixel_complete_registration"],
    ["app_install", "mobile_app_install"],
    ["onsite_conversion.messaging_conversation_started_7d"],
    ["onsite_conversion.total_messaging_connection"],
  ];
  let total = 0;
  for (const group of groups) {
    for (const t of group) {
      if (byType[t] !== undefined) { total += byType[t]; break; }
    }
  }
  return total;
}
function sumActionValues(rows: Array<{ action_type: string; value: string }> | undefined): number {
  if (!rows || rows.length === 0) return 0;
  return rows.reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const meta = resolveMetaCreds(req.body || {});
  const accessToken = meta?.accessToken;
  const businessId = meta?.businessId;
  const { startDate, endDate, limit } = req.body || {};
  if (!accessToken || !businessId) { res.status(400).json({ error: "Missing accessToken or businessId" }); return; }

  if (isDemoCredential(accessToken)) {
    res.status(200).json({ source: "demo", ads: DEMO_ADS, currency: "INR" });
    return;
  }

  const accountPath = businessId.startsWith("act_") ? businessId : `act_${businessId}`;

  // Cache first — Creative view + PDF pipeline both hit this key.
  const ck = cacheKey(accountPath, "ad-insights", { startDate, endDate, limit: String(limit || 100) });
  const cached = metaCache.get<{ ads: AdInsightRow[]; currency: string }>(ck);
  if (cached) {
    res.status(200).json({ source: "cache", ...cached });
    return;
  }

  try {
    const client = new MetaApiClient(accessToken);

    // Step 1: fetch campaign IDs so we can chunk the insights call.
    // Also fetch currency in parallel — cheap ping.
    const [campaigns, currency] = await Promise.all([
      metaSafeCall(() =>
        metaFetch<{ data?: Array<{ id: string }> }>(accessToken, `/${accountPath}/campaigns`, {
          fields: "id", limit: "500",
        }).then((r) => r.data ?? []),
        { onRetry: (attempt, err) => console.warn(`[ad-insights/meta] campaigns retry #${attempt}: ${err.message}`) },
      ),
      metaSafeCall(() => client.getAccountCurrency(accountPath)),
    ]);

    if (!campaigns || campaigns.length === 0) {
      res.status(200).json({ source: "live", ads: [], currency: currency || "USD" });
      return;
    }

    // Step 2: chunk campaign IDs and fetch ad-level insights per chunk.
    const campaignIds = campaigns.map((c) => String(c.id));
    const chunks = chunk(campaignIds, CAMPAIGNS_PER_CHUNK);
    const perAdLimit = Math.max(50, Math.floor((limit || 200) / Math.max(1, chunks.length)));

    const CHUNK_TIMEOUT_MS = 45_000;
    const chunkResults = await Promise.allSettled(
      chunks.map((ids) =>
        withAbortTimeout(
          (signal) => metaSafeCall(
            () => fetchAdInsightsForCampaignChunk(accessToken, accountPath, ids, startDate, endDate, perAdLimit, signal),
            {
              longBackoff: true, // ad-insights is one of the heavy endpoints; match Meta's real recovery window
              onRetry: (attempt, err) => console.warn(`[ad-insights/meta] insights chunk retry #${attempt}: ${err.message}`),
            },
          ),
          CHUNK_TIMEOUT_MS,
          [] as any[],
        ),
      ),
    );

    const rawAds: any[] = [];
    let failedChunks = 0;
    for (const r of chunkResults) {
      if (r.status === "fulfilled" && Array.isArray(r.value) && r.value.length > 0) rawAds.push(...r.value);
      else if (r.status === "fulfilled") failedChunks++; // empty result (timeout or truly empty)
      else failedChunks++;
    }

    if (rawAds.length === 0 && failedChunks > 0) {
      const firstErr = chunkResults.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      const errMsg = firstErr ? (firstErr.reason as Error).message : "All ad-insights chunks failed";
      throw new Error(errMsg);
    }

    // Step 3: hydrate creative type + thumbnail via batch endpoint.
    const adIds = rawAds.map((a) => String(a.ad_id || "")).filter(Boolean);
    const creativeMeta = adIds.length > 0
      ? await metaSafeCall(() => hydrateAdCreatives(accessToken, adIds)).catch(() => ({} as Record<string, { object_type?: string; thumbnail_url?: string }>))
      : {} as Record<string, { object_type?: string; thumbnail_url?: string }>;

    const baseRows: AdInsightRow[] = rawAds.map((row: any) => {
      const id = String(row.ad_id || "");
      const cm = creativeMeta[id];
      return {
        id,
        name: String(row.ad_name || ""),
        campaignName: row.campaign_name ? String(row.campaign_name) : undefined,
        adSetName: row.adset_name ? String(row.adset_name) : undefined,
        adSetId: row.adset_id ? String(row.adset_id) : undefined,
        creativeType: cm?.object_type,
        thumbnailUrl: cm?.thumbnail_url,
        spend: row.spend ? parseFloat(row.spend) : 0,
        impressions: row.impressions ? parseInt(row.impressions, 10) : 0,
        reach: row.reach ? parseInt(row.reach, 10) : 0,
        clicks: row.clicks ? parseInt(row.clicks, 10) : 0,
        conversions: sumConversions(row.actions),
        conversionValue: sumConversions(row.action_values),
        videoViews: sumActionValues(row.video_play_actions),
      };
    });

    // Step 4: fetch targeting locales for the unique ad sets represented.
    const adSetIds = [...new Set(baseRows.map(a => a.adSetId).filter(Boolean) as string[])];
    type TargetingMap = Awaited<ReturnType<typeof client.getAdSetsTargeting>>;
    const [targetingMap, localeNames] = await Promise.all([
      adSetIds.length
        ? metaSafeCall(() => client.getAdSetsTargeting(accountPath, adSetIds)).catch(() => ({} as TargetingMap))
        : Promise.resolve({} as TargetingMap),
      getLocaleNameMap(client),
    ]);

    const localesFor = (adSetId?: string): number[] | undefined =>
      adSetId && targetingMap[adSetId]?.targeting?.locales ? targetingMap[adSetId].targeting!.locales : undefined;

    const enriched: AdInsightRow[] = baseRows.map(a => ({
      ...a,
      language: localesToLanguage(localesFor(a.adSetId), localeNames),
    }));

    const withCreativeType = enriched.filter(a => a.creativeType).length;
    console.log(`[ad-insights/meta] account=${accountPath} campaigns=${campaigns.length} chunks=${chunks.length} failedChunks=${failedChunks} ads=${enriched.length} withCreativeType=${withCreativeType} withoutCreativeType=${enriched.length - withCreativeType}`);

    const payload = { ads: enriched, currency: currency || "USD" };
    if (enriched.length > 0) metaCache.set(ck, payload);
    const quota = metaThrottle.get(accountPath);
    res.status(200).json({
      source: "live",
      ...payload,
      metaQuota: quota,
      ...(failedChunks > 0 ? { partial: true, failedChunks } : {}),
    });
  } catch (e) {
    console.error("[ad-insights/meta] failed:", e instanceof Error ? e.message : e);
    res.status(502).json({ error: e instanceof Error ? e.message : "Ad insights fetch failed" });
  }
}
