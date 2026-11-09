/**
 * POST /api/naming/campaigns/snapchat
 *
 * Returns Snapchat campaigns mapped into the shared CampaignData shape:
 *   CampaignData        = Snapchat Campaign
 *   CampaignData.adSets = Ad Squads
 *   adSets[].ads        = Ads
 *
 * Metrics come from Snapchat Marketing API stats endpoint (TOTAL granularity,
 * breakdown by campaign). Spend is converted from micros → currency units.
 *
 * Body: { clientId, clientSecret, refreshToken, adAccountId, orgId?,
 *         startDate, endDate }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import {
  SnapchatApiClient,
  snapchatObjectiveLabel,
  getSnapchatAccountCurrency,
  type SnapchatCredentials,
} from "@/lib/api-clients/snapchat";
import type { CampaignData, AdSetData, AdData } from "@/types";

export const config = { maxDuration: 60 };

function resolveSnapchatCreds(body: Record<string, unknown>): SnapchatCredentials | null {
  const clientId = (body.clientId as string) || process.env.SNAPCHAT_CLIENT_ID;
  const clientSecret = (body.clientSecret as string) || process.env.SNAPCHAT_CLIENT_SECRET;
  const refreshToken = (body.refreshToken as string) || process.env.DEFAULT_SNAPCHAT_REFRESH_TOKEN;
  const adAccountId = (body.adAccountId as string) || process.env.DEFAULT_SNAPCHAT_AD_ACCOUNT_ID;
  const orgId = (body.orgId as string) || process.env.DEFAULT_SNAPCHAT_ORG_ID;

  if (!clientId || !clientSecret || !refreshToken || !adAccountId) return null;
  return { clientId, clientSecret, refreshToken, adAccountId, orgId };
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
  const creds = resolveSnapchatCreds(body);

  if (!creds) {
    return res.status(400).json({
      error: "Missing Snapchat credentials (clientId / clientSecret / refreshToken / adAccountId)",
    });
  }
  if (!startDate || !endDate) {
    return res.status(400).json({ error: "Missing startDate or endDate" });
  }

  try {
    const client = new SnapchatApiClient(creds);

    // Fetch campaigns, ad squads, ads, currency, and campaign-level stats in parallel.
    const [campaigns, adSquads, ads, currency, statsMap] = await Promise.all([
      client.listCampaigns(),
      client.listAdSquads().catch(() => []),
      client.listAds().catch(() => []),
      getSnapchatAccountCurrency(client),
      client.getCampaignBreakdownStats(startDate, endDate),
    ]);

    // Fallback: if breakdown returned empty, fetch per-campaign stats
    let effectiveStats = statsMap;
    if (effectiveStats.size === 0 && campaigns.length > 0) {
      const perCampaign = await Promise.all(
        campaigns.map((c) => client.getCampaignStats(c.id, startDate, endDate)),
      );
      effectiveStats = new Map();
      for (const row of perCampaign) {
        if (row) effectiveStats.set(row.id, row);
      }
    }

    // Group ads by ad squad.
    const adsBySquad = new Map<string, AdData[]>();
    for (const ad of ads) {
      const adData: AdData = {
        id: ad.id,
        name: ad.name,
        status: ad.status,
        lineItemType: ad.type,
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
      };
      const arr = adsBySquad.get(ad.adSquadId) ?? [];
      arr.push(adData);
      adsBySquad.set(ad.adSquadId, arr);
    }

    // Group ad squads by campaign.
    const squadsByCampaign = new Map<string, AdSetData[]>();
    for (const sq of adSquads) {
      const squadAds = adsBySquad.get(sq.id) ?? [];
      const squad: AdSetData = {
        id: sq.id,
        name: sq.name,
        status: sq.status,
        spend: 0,
        impressions: 0,
        clicks: 0,
        ads: squadAds,
      };
      const arr = squadsByCampaign.get(sq.campaignId) ?? [];
      arr.push(squad);
      squadsByCampaign.set(sq.campaignId, arr);
    }

    const out: CampaignData[] = campaigns.map((c) => {
      const squads = squadsByCampaign.get(c.id) ?? [];
      const stats = effectiveStats.get(c.id);
      return {
        id: c.id,
        name: c.name,
        objective: snapchatObjectiveLabel(c.objective),
        status: c.status,
        platform: "snapchat" as const,
        spend: stats?.spend ?? 0,
        impressions: stats?.impressions ?? 0,
        clicks: stats?.swipes ?? 0, // Snapchat uses "swipes" as click-equivalent
        videoViews: stats?.videoViews ?? 0,
        conversions: stats?.conversions ?? 0,
        conversionValue: 0,
        dailyBudget: c.dailyBudgetMicro ? c.dailyBudgetMicro / 1_000_000 : undefined,
        lifetimeBudget: c.lifetimeSpendCapMicro ? c.lifetimeSpendCapMicro / 1_000_000 : undefined,
        currency,
        adSets: squads,
      };
    });

    return res.status(200).json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Snapchat campaigns fetch failed:", message);
    return res.status(502).json({ error: message });
  }
}
