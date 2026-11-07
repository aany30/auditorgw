/**
 * GET /api/spotify/debug?clientId=...&clientSecret=...&refreshToken=...&adAccountId=...
 *
 * Debug endpoint — returns raw Spotify Ads API responses for campaigns
 * and aggregate reports to diagnose zero-metrics issues.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { SpotifyAdsApiClient } from "@/lib/api-clients/spotify-ads";

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = (req.query.clientId as string) || (req.body?.clientId as string) || process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = (req.query.clientSecret as string) || (req.body?.clientSecret as string) || process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = (req.query.refreshToken as string) || (req.body?.refreshToken as string);
  const adAccountId = (req.query.adAccountId as string) || (req.body?.adAccountId as string);

  if (!clientId || !clientSecret || !refreshToken || !adAccountId) {
    return res.status(400).json({ error: "Missing credentials", received: { clientId: !!clientId, clientSecret: !!clientSecret, refreshToken: !!refreshToken, adAccountId: !!adAccountId } });
  }

  const client = new SpotifyAdsApiClient({ clientId, clientSecret, refreshToken, adAccountId });
  const debug: Record<string, unknown> = {};

  try {
    const campaigns = await client.listCampaigns();
    debug.campaigns = campaigns;
    debug.campaignCount = campaigns.length;
  } catch (e) {
    debug.campaignsError = e instanceof Error ? e.message : String(e);
  }

  try {
    const adSets = await client.listAdSets();
    debug.adSets = adSets;
    debug.adSetCount = adSets.length;
  } catch (e) {
    debug.adSetsError = e instanceof Error ? e.message : String(e);
  }

  // Try campaign report in 90-day chunks (API max)
  try {
    const report1 = await client.getCampaignReport("2026-03-01", "2026-05-29");
    debug.campaignReport_MarMay = report1;
    debug.campaignReportCount_MarMay = report1.length;
  } catch (e) {
    debug.campaignReportError_MarMay = e instanceof Error ? e.message : String(e);
  }

  // Try account-level report (90-day chunk)
  try {
    const accountReport = await client.getAccountTotals("2026-03-01", "2026-05-29");
    debug.accountReport = accountReport;
  } catch (e) {
    debug.accountReportError = e instanceof Error ? e.message : String(e);
  }

  return res.status(200).json(debug);
}
