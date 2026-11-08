/**
 * GET /api/snapchat/debug-stats
 * Debug endpoint to see raw Snapchat stats response.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { SnapchatApiClient, type SnapchatCredentials } from "@/lib/api-clients/snapchat";

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = (req.query.clientId as string) || process.env.SNAPCHAT_CLIENT_ID;
  const clientSecret = (req.query.clientSecret as string) || process.env.SNAPCHAT_CLIENT_SECRET;
  const refreshToken = (req.query.refreshToken as string) || process.env.DEFAULT_SNAPCHAT_REFRESH_TOKEN;
  const adAccountId = (req.query.adAccountId as string) || process.env.DEFAULT_SNAPCHAT_AD_ACCOUNT_ID;

  if (!clientId || !clientSecret || !refreshToken || !adAccountId) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  const creds: SnapchatCredentials = { clientId, clientSecret, refreshToken, adAccountId };
  const client = new SnapchatApiClient(creds);
  const debug: Record<string, unknown> = {};

  // 1) List campaigns
  try {
    const campaigns = await client.listCampaigns();
    debug.campaigns = campaigns.map(c => ({ id: c.id, name: c.name, status: c.status }));
  } catch (e) {
    debug.campaignsError = e instanceof Error ? e.message : String(e);
  }

  // 2) Try account-level breakdown stats for last 7 days
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  const startDate = weekAgo.toISOString().slice(0, 10);
  const endDate = now.toISOString().slice(0, 10);

  try {
    const breakdownStats = await client.getCampaignBreakdownStats(startDate, endDate);
    debug.breakdownStats_7d = Object.fromEntries(breakdownStats);
    debug.breakdownStatsCount_7d = breakdownStats.size;
  } catch (e) {
    debug.breakdownStatsError_7d = e instanceof Error ? e.message : String(e);
  }

  // 3) Raw stats request to see exactly what Snapchat returns
  try {
    const params = new URLSearchParams({
      granularity: "TOTAL",
      start_time: `${startDate}T00:00:00-00:00`,
      end_time: `${endDate}T23:59:59-00:00`,
      breakdown: "campaign",
      fields: "spend,impressions,swipes,video_views,conversion_purchases",
    });
    const rawData = await client.request<unknown>(
      `/adaccounts/${adAccountId}/stats?${params}`,
    );
    debug.rawStatsResponse_7d = rawData;
  } catch (e) {
    debug.rawStatsError_7d = e instanceof Error ? e.message : String(e);
  }

  // 4) Per-campaign stats for the active campaign (if we found it)
  if (debug.campaigns && Array.isArray(debug.campaigns)) {
    const active = (debug.campaigns as Array<{ id: string; status: string }>).find(c => c.status === "ACTIVE");
    if (active) {
      try {
        const stats = await client.getCampaignStats(active.id, startDate, endDate);
        debug.activeCampaignStats_7d = stats;
      } catch (e) {
        debug.activeCampaignStatsError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  return res.status(200).json({ startDate, endDate, ...debug });
}
