/**
 * POST /api/audience/adset-insights/meta
 *
 * Returns ad-set level insights from Meta Insights API at level=adset.
 * Provides name, spend, impressions, clicks, reach, frequency, conversions,
 * conversionValue — the full dataset needed by the Audience Analysis tabs.
 *
 * Body: { accessToken, businessId, startDate?, endDate? }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";

export interface AdSetRow {
  id: string;
  name: string;
  campaignName?: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  frequency: number;
  conversions: number;
  conversionValue: number;
}

const DEMO_ADSETS: AdSetRow[] = [
  { id: "a001", name: "TOF - Broad - All India",             campaignName: "Awareness - Broad India",        spend: 48000, impressions: 1850000, clicks: 22000, reach: 820000, frequency: 2.3, conversions: 180, conversionValue: 126000 },
  { id: "a002", name: "TOF - Interest - Fashion & Lifestyle",campaignName: "Awareness - Interest Stacks",    spend: 32000, impressions: 1120000, clicks: 15000, reach: 560000, frequency: 2.0, conversions: 145, conversionValue: 101500 },
  { id: "a003", name: "TOF - LAL 1pct Purchasers",           campaignName: "Prospecting - LAL",              spend: 28000, impressions: 980000,  clicks: 13000, reach: 490000, frequency: 2.0, conversions: 168, conversionValue: 134400 },
  { id: "a004", name: "MOF - Website Visitors 30d",          campaignName: "Retargeting - Web Visitors",     spend: 22000, impressions: 680000,  clicks: 11000, reach: 180000, frequency: 3.8, conversions: 132, conversionValue: 105600 },
  { id: "a005", name: "MOF - Video Viewers 75pct",           campaignName: "Retargeting - Video Viewers",    spend: 12000, impressions: 420000,  clicks: 6200,  reach: 95000,  frequency: 4.4, conversions: 65,  conversionValue: 52000  },
  { id: "a006", name: "BOF - ATC 7d",                        campaignName: "Conversion - ATC Retargeting",   spend: 18000, impressions: 380000,  clicks: 8500,  reach: 52000,  frequency: 7.3, conversions: 198, conversionValue: 178200 },
  { id: "a007", name: "BOF - Checkout Abandon 3d",           campaignName: "Conversion - Checkout Recovery", spend: 9500,  impressions: 195000,  clicks: 4800,  reach: 28000,  frequency: 6.96,conversions: 128, conversionValue: 128000 },
  { id: "a008", name: "LOY - Existing Customers 180d",       campaignName: "Loyalty - Repeat Purchase",      spend: 8000,  impressions: 240000,  clicks: 4200,  reach: 45000,  frequency: 5.3, conversions: 95,  conversionValue: 114000 },
  { id: "a009", name: "TOF - Broad 18-35 Female",            campaignName: "Awareness - Broad India",        spend: 22000, impressions: 960000,  clicks: 12500, reach: 440000, frequency: 2.2, conversions: 88,  conversionValue: 52800  },
  { id: "a010", name: "MOF - IG Engaged 60d",                campaignName: "Retargeting - Social Engaged",   spend: 7500,  impressions: 285000,  clicks: 4100,  reach: 68000,  frequency: 4.2, conversions: 42,  conversionValue: 33600  },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const { accessToken, businessId, startDate, endDate } = req.body || {};
  if (!accessToken || !businessId) {
    res.status(400).json({ error: "Missing accessToken or businessId" });
    return;
  }

  if (isDemoCredential(accessToken)) {
    res.status(200).json({ source: "demo", adsets: DEMO_ADSETS, currency: "INR" });
    return;
  }

  try {
    const client = new MetaApiClient(accessToken);
    const accountPath = businessId.startsWith("act_") ? businessId : `act_${businessId}`;
    const [adsets, currency] = await Promise.all([
      client.getAdSetFullInsights(accountPath, startDate, endDate),
      client.getAccountCurrency(accountPath),
    ]);
    res.status(200).json({ source: "live", adsets, currency: currency || "USD" });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Ad set insights fetch failed" });
  }
}
