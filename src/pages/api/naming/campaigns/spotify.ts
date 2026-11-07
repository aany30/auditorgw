/**
 * POST /api/naming/campaigns/spotify
 *
 * Returns Spotify campaigns mapped into the shared CampaignData shape:
 *   CampaignData        = Spotify Campaign
 *   CampaignData.adSets = Ad Sets
 *   adSets[].ads        = Ads
 *
 * Metrics come from Spotify Ads API aggregate reports (CAMPAIGN granularity).
 *
 * Body: { clientId, clientSecret, refreshToken, adAccountId, startDate, endDate }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import {
  SpotifyAdsApiClient,
  type SpotifyAdsCredentials,
} from "@/lib/api-clients/spotify-ads";
import type { CampaignData, AdSetData, AdData } from "@/types";

export const config = { maxDuration: 60 };

function resolveSpotifyCreds(body: Record<string, unknown>): SpotifyAdsCredentials | null {
  const clientId = (body.clientId as string) || process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = (body.clientSecret as string) || process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = (body.refreshToken as string) || process.env.DEFAULT_SPOTIFY_REFRESH_TOKEN;
  const adAccountId = (body.adAccountId as string) || process.env.DEFAULT_SPOTIFY_AD_ACCOUNT_ID;

  if (!clientId || !clientSecret || !refreshToken || !adAccountId) return null;
  return { clientId, clientSecret, refreshToken, adAccountId };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CampaignData[] | { error: string }>,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const { startDate, endDate } = body as { startDate?: string; endDate?: string };
  const creds = resolveSpotifyCreds(body);

  if (!creds) {
    return res.status(400).json({
      error: "Missing Spotify credentials (clientId / clientSecret / refreshToken / adAccountId)",
    });
  }
  if (!startDate || !endDate) {
    return res.status(400).json({ error: "Missing startDate or endDate" });
  }

  try {
    const client = new SpotifyAdsApiClient(creds);

    // Fetch campaigns, ad sets, ads, and campaign-level stats in parallel.
    // Try date-windowed stats first; if empty, fall back to lifetime stats
    // (completed campaigns have no delivery in recent windows).
    const [campaigns, adSets, ads, campaignStats] = await Promise.all([
      client.listCampaigns(),
      client.listAdSets().catch((e) => { console.warn("Spotify listAdSets failed:", e.message); return []; }),
      client.listAds().catch((e) => { console.warn("Spotify listAds failed:", e.message); return []; }),
      client.getCampaignReport(startDate, endDate).catch((e) => { console.warn("Spotify getCampaignReport failed:", e.message); return []; }),
    ]);

    // If windowed report returned no rows, try lifetime stats using
    // each campaign's own start/end dates (completed campaigns won't
    // have delivery in the recent window).
    let effectiveStats = campaignStats;
    if (effectiveStats.length === 0 && campaigns.length > 0) {
      const earliest = campaigns.reduce((min, c) => {
        if (c.startDate && (!min || c.startDate < min)) return c.startDate;
        return min;
      }, "" as string) || "2020-01-01";
      const latest = campaigns.reduce((max, c) => {
        if (c.endDate && (!max || c.endDate > max)) return c.endDate;
        return max;
      }, "" as string) || endDate;
      effectiveStats = await client.getCampaignReport(earliest, latest).catch((e) => {
        console.warn("Spotify lifetime getCampaignReport failed:", e.message);
        return [];
      });
    }

    // Build a stats map keyed by campaign ID.
    const statsMap = new Map<string, { spend: number; impressions: number; clicks: number; reach: number }>();
    for (const row of effectiveStats) {
      statsMap.set(row.entityId, {
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
        reach: row.reach,
      });
    }

    // Group ads by ad set.
    const adsByAdSet = new Map<string, AdData[]>();
    for (const ad of ads) {
      const adData: AdData = {
        id: ad.id,
        name: ad.name,
        status: ad.status,
        lineItemType: ad.format,
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
      };
      const key = ad.adSetId || "__none__";
      const arr = adsByAdSet.get(key) ?? [];
      arr.push(adData);
      adsByAdSet.set(key, arr);
    }

    // Group ad sets by campaign.
    const adSetsByCampaign = new Map<string, AdSetData[]>();
    for (const as_ of adSets) {
      const setAds = adsByAdSet.get(as_.id) ?? [];
      const adSet: AdSetData = {
        id: as_.id,
        name: as_.name,
        status: as_.status,
        spend: 0,
        impressions: 0,
        clicks: 0,
        ads: setAds,
      };
      const arr = adSetsByCampaign.get(as_.campaignId) ?? [];
      arr.push(adSet);
      adSetsByCampaign.set(as_.campaignId, arr);
    }

    const out: CampaignData[] = campaigns.map((c) => {
      const sets = adSetsByCampaign.get(c.id) ?? [];
      const stats = statsMap.get(c.id);
      return {
        id: c.id,
        name: c.name,
        objective: c.objective || "AWARENESS",
        status: c.status,
        platform: "spotify" as const,
        spend: stats?.spend ?? 0,
        impressions: stats?.impressions ?? 0,
        clicks: stats?.clicks ?? 0,
        conversions: 0,
        conversionValue: 0,
        currency: "INR",
        adSets: sets,
      };
    });

    return res.status(200).json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Spotify campaigns fetch failed:", message);
    return res.status(502).json({ error: message });
  }
}
