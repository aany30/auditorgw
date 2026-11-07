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

  // Try campaign report for March-May 2026 (when campaigns ran)
  try {
    const report = await client.getCampaignReport("2026-03-01", "2026-05-31");
    debug.campaignReport_MarMay = report;
    debug.campaignReportCount_MarMay = report.length;
  } catch (e) {
    debug.campaignReportError_MarMay = e instanceof Error ? e.message : String(e);
  }

  // Try account-level lifetime report
  try {
    const accountReport = await client.getAccountTotals("2026-01-01", "2026-12-31");
    debug.accountReport_2026 = accountReport;
  } catch (e) {
    debug.accountReportError_2026 = e instanceof Error ? e.message : String(e);
  }

  return res.status(200).json(debug);
}
