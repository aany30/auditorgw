import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleApiClient, GoogleAuditResult } from "@/lib/api-clients/google";
import {
  isDemoCredential,
  getDemoGoogleAudit,
  getDemoGA4,
  getDemoGoogleAds,
  getDemoGTM,
} from "@/lib/demo-data";
import { analyzeGoogleAudit, rankRecommendations, Recommendation } from "@/lib/recommendations/engine";

export interface GoogleAuditResponse {
  source: "live" | "demo" | "mixed";
  audit: GoogleAuditResult;
  recommendations: Recommendation[];
  perPlatformSource: { ga4: "live" | "demo"; ads: "live" | "demo"; gtm: "live" | "demo" };
  generatedAt: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GoogleAuditResponse | { error: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { accessToken, customerId, propertyId, containerId, startDate, endDate, developerToken, loginCustomerId } = req.body || {};

  if (!accessToken || !customerId || !propertyId || !containerId) {
    return res.status(400).json({ error: "accessToken, customerId, propertyId, containerId required" });
  }

  const useDemo = isDemoCredential(accessToken);
  let audit: GoogleAuditResult;
  const perPlatform: GoogleAuditResponse["perPlatformSource"] = { ga4: "live", ads: "live", gtm: "live" };

  if (useDemo) {
    audit = getDemoGoogleAudit();
    perPlatform.ga4 = "demo";
    perPlatform.ads = "demo";
    perPlatform.gtm = "demo";
  } else {
    const client = new GoogleApiClient(accessToken, { developerToken, loginCustomerId });
    const result = await client.getFullAudit(
      propertyId,
      customerId,
      containerId,
      startDate || "30daysAgo",
      endDate || "today"
    );

    // Per-platform fallback so partial failures don't blank the dashboard
    audit = {
      ga4: result?.ga4 ?? getDemoGA4(),
      ads: result?.ads ?? getDemoGoogleAds(),
      gtm: result?.gtm ?? getDemoGTM(),
    };
    if (!result?.ga4) perPlatform.ga4 = "demo";
    if (!result?.ads) perPlatform.ads = "demo";
    if (!result?.gtm) perPlatform.gtm = "demo";
  }

  const recs = analyzeGoogleAudit(audit);
  const sources = Object.values(perPlatform);
  const source: GoogleAuditResponse["source"] =
    sources.every((s) => s === "live") ? "live" :
    sources.every((s) => s === "demo") ? "demo" : "mixed";

  res.status(200).json({
    source,
    audit,
    recommendations: rankRecommendations(recs),
    perPlatformSource: perPlatform,
    generatedAt: new Date().toISOString(),
  });
}
