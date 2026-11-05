/**
 * POST /api/spotify/entities
 *
 * Fetches Spotify Ads campaigns, ad sets, ads, and aggregate report.
 * Body: { clientId, clientSecret, refreshToken, adAccountId, startDate, endDate }
 * Returns: { campaigns, adSets, ads, report }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { resolveSpotifyCreds } from "@/lib/default-credentials";
import { SpotifyAdsApiClient } from "@/lib/api-clients/spotify-ads";

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const creds = resolveSpotifyCreds(req.body || {});
  if (!creds) {
    return res.status(400).json({ error: "Missing Spotify Ads credentials" });
  }

  const startDate = (req.body?.startDate as string) || "";
  const endDate = (req.body?.endDate as string) || "";

  try {
    const client = new SpotifyAdsApiClient(creds);

    const [campaigns, adSets, ads] = await Promise.all([
      client.listCampaigns().catch(() => []),
      client.listAdSets().catch(() => []),
      client.listAds().catch(() => []),
    ]);

    let report: Awaited<ReturnType<SpotifyAdsApiClient["getCampaignReport"]>> = [];
    if (startDate && endDate) {
      report = await client.getCampaignReport(startDate, endDate).catch(() => []);
    }

    return res.status(200).json({ campaigns, adSets, ads, report });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(502).json({ error: msg });
  }
}
