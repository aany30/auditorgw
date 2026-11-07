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

    // Spotify aggregate reports have a 90-day max window. If the windowed
    // report returned empty (completed campaigns have no delivery in the
    // recent window), chunk the full campaign lifespan into ≤90-day windows.
    let effectiveStats = campaignStats;
    if (effectiveStats.length === 0 && campaigns.length > 0) {
      const earliest = campaigns.reduce((min, c) => {
        if (c.startDate && (!min || c.startDate < min)) return c.startDate;
        return min;
      }, "" as string) || startDate;
      const latest = campaigns.reduce((max, c) => {
        if (c.endDate && (!max || c.endDate > max)) return c.endDate;
        return max;
      }, "" as string) || endDate;

      // Chunk into 90-day windows
      const chunks: Array<{ s: string; e: string }> = [];
      let cursor = new Date(earliest);
      const end = new Date(latest);
      while (cursor < end) {
        const chunkEnd = new Date(cursor);
        chunkEnd.setDate(chunkEnd.getDate() + 89);
        if (chunkEnd > end) chunkEnd.setTime(end.getTime());
        chunks.push({ s: cursor.toISOString().slice(0, 10), e: chunkEnd.toISOString().slice(0, 10) });
        cursor = new Date(chunkEnd);
        cursor.setDate(cursor.getDate() + 1);
      }

      const allRows = await Promise.all(
        chunks.map((ch) =>
          client.getCampaignReport(ch.s, ch.e).catch((e) => {
            console.warn(`Spotify getCampaignReport(${ch.s}–${ch.e}) failed:`, e.message);
            return [];
          })
        )
      );
      // Merge: sum metrics per campaign across chunks
      const merged = new Map<string, typeof effectiveStats[0]>();
      for (const rows of allRows) {
        for (const row of rows) {
          const existing = merged.get(row.entityId);
          if (existing) {
            existing.impressions += row.impressions;
            existing.clicks += row.clicks;
            existing.spend += row.spend;
            existing.reach += row.reach;
          } else {
            merged.set(row.entityId, { ...row });
          }
        }
      }
      effectiveStats = Array.from(merged.values());
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
      // Spotify API returns campaign status as ACTIVE even when all ad sets
      // are COMPLETED. Derive effective status from ad sets.
      let effectiveStatus = c.status;
      if (sets.length > 0 && sets.every((s) => s.status === "COMPLETED")) {
        effectiveStatus = "COMPLETED";
      } else if (sets.length > 0 && sets.every((s) => s.status === "PAUSED" || s.status === "COMPLETED")) {
        effectiveStatus = "PAUSED";
      }
      return {
        id: c.id,
        name: c.name,
        objective: c.objective || "AWARENESS",
        status: effectiveStatus,
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
