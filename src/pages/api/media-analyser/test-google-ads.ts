import type { NextApiRequest, NextApiResponse } from "next";
import { attachAdAnalyses } from "@/lib/media-analyser/meta-social";
import { fetchGoogleAds, type GoogleAdsMode } from "@/lib/media-analyser/google-ads";
import { buildPaidAdBuckets, enrichPaidAd } from "@/lib/media-analyser/paid-ad-buckets";

export const config = { maxDuration: 300 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const brand = String(body.brand ?? "").trim();
  const googleAdsUrl = String(body.googleAdsUrl ?? "").trim();
  const mode: GoogleAdsMode = body.mode === "rich" ? "rich" : "fast";
  const limit = Math.min(Number(body.limit ?? 30), 100);

  if (!brand && !googleAdsUrl) {
    return res.status(400).json({ error: "Provide a brand (fast) or a googleAdsUrl (rich)." });
  }

  const { ads, fetchError } = await fetchGoogleAds({ brand, googleAdsUrl: googleAdsUrl || undefined }, mode);

  const enriched = ads.slice(0, limit).map(ad => enrichPaidAd(ad));
  const analyzed = body.analyze === false ? enriched : await attachAdAnalyses(enriched);
  const { groups: googleAdBuckets, summary: googleAdsSummary } = buildPaidAdBuckets(analyzed);

  return res.status(200).json({
    ok: true,
    mode,
    count: analyzed.length,
    ads: analyzed,
    googleAdBuckets,
    googleAdsSummary,
    analysisSummary: {
      withCreativeAnalysis: analyzed.filter(a => a.adCreativeAnalysis?.visualStyle).length,
      withCampaignAnalysis: analyzed.filter(a => a.adCampaignAnalysis?.summary).length,
      total: analyzed.length,
    },
    warning: fetchError ?? null,
  });
}
