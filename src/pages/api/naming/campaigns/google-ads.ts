/**
 * POST /api/naming/campaigns/google-ads
 *
 * Google Ads campaign list mapped into the shared CampaignData shape:
 *   CampaignData        = Google Ads Campaign
 *   CampaignData.adSets = Ad Groups
 *   adSets[].ads        = Ads (RSA, responsive display, video, etc.)
 *
 * Metrics come from GAQL searchStream queries — synchronous, no polling needed.
 *
 * Body: { clientId, clientSecret, refreshToken, customerId, loginCustomerId?,
 *         startDate, endDate }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleAdsApiClient } from "@/lib/api-clients/google-ads";
import { resolveGoogleAdsCreds } from "@/lib/default-credentials";
import type { CampaignData, AdSetData, AdData } from "@/types";

export const config = { maxDuration: 90 };

function channelTypeToObjective(ct: string): string {
  const map: Record<string, string> = {
    SEARCH: "Search",
    DISPLAY: "Display",
    SHOPPING: "Shopping",
    VIDEO: "Video",
    MULTI_CHANNEL: "Performance Max",
    PERFORMANCE_MAX: "Performance Max",
    LOCAL: "Local",
    SMART: "Smart",
    HOTEL: "Hotel",
    DISCOVERY: "Demand Gen",
    DEMAND_GEN: "Demand Gen",
    TRAVEL: "Travel",
  };
  return map[ct] ?? ct.replace(/_/g, " ").toLowerCase();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CampaignData[] | { error: string; code?: string }>,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { startDate, endDate } = req.body || {};
  const creds = resolveGoogleAdsCreds(req.body || {});

  if (!creds) {
    return res
      .status(400)
      .json({ error: "Missing Google Ads credentials (customerId or developerToken)" });
  }
  if (!startDate || !endDate) {
    return res.status(400).json({ error: "Missing startDate or endDate" });
  }

  try {
    const client = new GoogleAdsApiClient(creds);

    const [campaigns, adGroups, ads, customerInfo] = await Promise.all([
      client.listCampaigns(startDate, endDate),
      client.listAdGroups(startDate, endDate),
      client.listAds(startDate, endDate),
      client.getCustomerInfo(),
    ]);

    const currency = customerInfo.currencyCode || "USD";

    const adsByAdGroup = new Map<string, AdData[]>();
    for (const ad of ads) {
      const adData: AdData = {
        id: ad.id,
        name:
          ad.headlines?.join(" | ") ||
          ad.name ||
          `Ad ${ad.id}`,
        status: ad.status,
        lineItemType: ad.type,
        spend: (ad.costMicros ?? 0) / 1_000_000,
        impressions: ad.impressions ?? 0,
        clicks: ad.clicks ?? 0,
        conversions: ad.conversions ?? 0,
      };
      const arr = adsByAdGroup.get(ad.adGroupId) ?? [];
      arr.push(adData);
      adsByAdGroup.set(ad.adGroupId, arr);
    }

    const adGroupsByCampaign = new Map<string, AdSetData[]>();
    for (const ag of adGroups) {
      const agAds = adsByAdGroup.get(ag.id) ?? [];
      const adSet: AdSetData = {
        id: ag.id,
        name: ag.name,
        status: ag.status,
        spend: (ag.costMicros ?? 0) / 1_000_000,
        impressions: ag.impressions ?? 0,
        clicks: ag.clicks ?? 0,
        ads: agAds,
      };
      const arr = adGroupsByCampaign.get(ag.campaignId) ?? [];
      arr.push(adSet);
      adGroupsByCampaign.set(ag.campaignId, arr);
    }

    const out: CampaignData[] = campaigns.map((c) => {
      const ios = adGroupsByCampaign.get(c.id) ?? [];
      const totalSpend = (c.costMicros ?? 0) / 1_000_000;
      return {
        id: c.id,
        name: c.name,
        objective: channelTypeToObjective(c.advertisingChannelType),
        status: c.status,
        platform: "google_ads" as const,
        spend: totalSpend,
        impressions: c.impressions ?? 0,
        clicks: c.clicks ?? 0,
        reach: c.reach ?? 0,
        videoViews: c.videoViews ?? 0,
        conversions: c.conversions ?? 0,
        conversionValue: c.conversionsValue ?? 0,
        lifetimeBudget: c.budgetAmountMicros
          ? Number(c.budgetAmountMicros) / 1_000_000
          : undefined,
        currency,
        adSets: ios,
      };
    });

    return res.status(200).json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("REQUESTED_METRICS_FOR_MANAGER")) {
      return res.status(400).json({
        error: "This Google Ads account is a Manager (MCC) account. Please select a client account from the Manage Accounts dropdown.",
        code: "MANAGER_ACCOUNT",
      });
    }
    console.error("Google Ads campaigns fetch failed:", message);
    return res.status(502).json({ error: message });
  }
}
