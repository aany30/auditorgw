/**
 * POST /api/reporting/ad-insights/meta
 *
 * Ad-level insights — top ads ranked by spend with creative type + thumbnail.
 * Used by the Creative report.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";

export interface AdInsightRow {
  id: string;
  name: string;
  campaignName?: string;
  adSetName?: string;
  creativeType?: string;
  thumbnailUrl?: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

const DEMO_ADS: AdInsightRow[] = [
  { id: "ad_01", name: "Hero Reel — Skincare Routine v3",     campaignName: "GW_All_Product_Sales_Campaign_7_May'26",       adSetName: "TOF - Broad - All India",        creativeType: "VIDEO",    spend: 18500, impressions: 920000, clicks: 14200, conversions: 142, conversionValue: 96000 },
  { id: "ad_02", name: "Static — B1G1 Offer Banner",           campaignName: "Plenaire - TOF - B1G1 - 21/05",                adSetName: "TOF - Interest - Skincare",      creativeType: "PHOTO",    spend: 14200, impressions: 780000, clicks: 11800, conversions: 110, conversionValue: 71500 },
  { id: "ad_03", name: "Carousel — Product Range Tour",        campaignName: "GW_All_Product_Sales_Campaign_7_May'26",       adSetName: "TOF - LAL 1pct Purchasers",      creativeType: "CAROUSEL", spend: 12800, impressions: 540000, clicks: 9600,  conversions: 132, conversionValue: 102000 },
  { id: "ad_04", name: "UGC Video — Customer Testimonial",     campaignName: "Plenaire - TOF - Glacee - 21/05",              adSetName: "TOF - Broad 18-35 Female",       creativeType: "VIDEO",    spend: 9800,  impressions: 410000, clicks: 7200,  conversions: 88,  conversionValue: 61000 },
  { id: "ad_05", name: "Static — Limited Time Offer",          campaignName: "GW_Add_Cart_Retargeting_22nd_May'26",          adSetName: "MOF - Website Visitors 30d",     creativeType: "PHOTO",    spend: 8200,  impressions: 280000, clicks: 6400,  conversions: 95,  conversionValue: 78000 },
  { id: "ad_06", name: "Reel — 30s Founder Story",             campaignName: "Plenaire - TOF - Aesthetique - 03/06",         adSetName: "MOF - Video Viewers 75pct",      creativeType: "VIDEO",    spend: 7500,  impressions: 320000, clicks: 5100,  conversions: 42,  conversionValue: 33000 },
  { id: "ad_07", name: "Carousel — Bestsellers Top 5",         campaignName: "GW_All_Product_Sales_Campaign_8th_June'26",    adSetName: "BOF - ATC 7d",                   creativeType: "CAROUSEL", spend: 6800,  impressions: 145000, clicks: 4400,  conversions: 118, conversionValue: 102000 },
  { id: "ad_08", name: "Static — Free Sample Promo",           campaignName: "GW_All_Product_Catalogue_Sales_Campaign_12_May",adSetName: "BOF - Checkout Abandon 3d",      creativeType: "PHOTO",    spend: 5200,  impressions: 98000,  clicks: 3800,  conversions: 78,  conversionValue: 78000 },
  { id: "ad_09", name: "Reel — Influencer Collab #2",          campaignName: "Plenaire - TOF - Consolidate - BC - 14/05",    adSetName: "TOF - LAL 2pct Engagers",        creativeType: "VIDEO",    spend: 4500,  impressions: 195000, clicks: 2900,  conversions: 38,  conversionValue: 26000 },
  { id: "ad_10", name: "Static — Brand Awareness",             campaignName: "Plenaire - TOF - B1G1 - 21/05",                adSetName: "TOF - Broad - All India",        creativeType: "PHOTO",    spend: 3800,  impressions: 142000, clicks: 2100,  conversions: 24,  conversionValue: 16000 },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const { accessToken, businessId, startDate, endDate, limit } = req.body || {};
  if (!accessToken || !businessId) { res.status(400).json({ error: "Missing accessToken or businessId" }); return; }

  if (isDemoCredential(accessToken)) {
    res.status(200).json({ source: "demo", ads: DEMO_ADS, currency: "INR" });
    return;
  }

  try {
    const client = new MetaApiClient(accessToken);
    const accountPath = businessId.startsWith("act_") ? businessId : `act_${businessId}`;
    const [ads, currency] = await Promise.all([
      client.getAdInsights(accountPath, startDate, endDate, limit || 100),
      client.getAccountCurrency(accountPath),
    ]);
    res.status(200).json({ source: "live", ads, currency: currency || "USD" });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Ad insights fetch failed" });
  }
}
