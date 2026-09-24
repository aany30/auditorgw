import type { NextApiRequest, NextApiResponse } from "next";
import { fetchAdsFromAdLibraryUrl, attachAdAnalyses } from "@/lib/media-analyser/meta-social";
import { fetchCdnImageInline, fetchCdnVideoInline } from "@/lib/media-analyser/brandVisualDna";
import { geminiVisionModels } from "@/lib/media-analyser/gemini-models";
import { buildPaidAdBuckets, enrichPaidAd } from "@/lib/media-analyser/paid-ad-buckets";

export const config = { maxDuration: 300 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const adLibraryUrl = String(body.adLibraryUrl ?? "").trim();
  const limit = Math.min(Number(body.limit ?? 30), 50);

  if (!adLibraryUrl) {
    return res.status(400).json({ error: "adLibraryUrl is required" });
  }

  const { ads, label, mode, error } = await fetchAdsFromAdLibraryUrl(adLibraryUrl, limit);

  if (error && ads.length === 0) {
    const status = error.includes("META_ACCESS_TOKEN") ? 503 : error.includes("token") ? 503 : 422;
    return res.status(status).json({ error });
  }

  const enriched = ads.map(ad => enrichPaidAd(ad));

  let probe: Record<string, unknown> | null = null;
  if (body.probe) {
    const target = enriched.find(a => a.imageUrl ?? a.thumbnailUrl);
    const imgUrl = target?.imageUrl ?? target?.thumbnailUrl ?? null;
    if (imgUrl) {
      const inline = await fetchCdnImageInline(imgUrl);
      probe = {
        imgUrl: imgUrl.slice(0, 90),
        fetchOk: !!inline,
        mime: inline?.mime_type ?? null,
        bytes: inline ? Math.round((inline.data.length * 3) / 4) : 0,
        visionModels: geminiVisionModels(),
        geminiKeySet: !!process.env.GEMINI_API_KEY,
        visionModelEnv: process.env.GEMINI_VISION_MODEL ?? null,
      };
      if (inline) {
        const model = geminiVisionModels()[0];
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ inline_data: { mime_type: inline.mime_type, data: inline.data } }, { text: "Reply with the single word OK." }] }],
              generationConfig: { maxOutputTokens: 16 },
            }),
          },
        );
        probe.visionStatus = r.status;
        probe.visionBody = (await r.text().catch(() => "")).slice(0, 300);
      }
    }
  }

  let videoProbe: Array<Record<string, unknown>> | null = null;
  if (body.videoProbe) {
    const vids = enriched.filter(a => a.videoUrl).slice(0, 5);
    videoProbe = await Promise.all(vids.map(async a => {
      const inline = await fetchCdnVideoInline(a.videoUrl as string);
      return {
        adId: a.adId,
        videoUrl: String(a.videoUrl).slice(0, 90),
        host: (() => { try { return new URL(a.videoUrl as string).hostname; } catch { return "?"; } })(),
        fetchOk: !!inline,
        mime: inline?.mime_type ?? null,
        mb: inline ? Math.round((inline.data.length * 3) / 4 / 1024 / 1024 * 10) / 10 : 0,
      };
    }));
  }

  const analyzed = body.analyze === false ? enriched : await attachAdAnalyses(enriched);
  const { groups: paidAdBuckets, summary: paidAdsSummary } = buildPaidAdBuckets(analyzed);

  return res.status(200).json({
    ok: true,
    probe,
    videoProbe,
    ads: analyzed,
    analysisSummary: {
      withCampaignAnalysis: analyzed.filter(a => a.adCampaignAnalysis?.summary).length,
      withCreativeAnalysis: analyzed.filter(a => a.adCreativeAnalysis?.visualStyle).length,
      total: analyzed.length,
    },
    paidAdBuckets,
    paidAdsSummary,
    label,
    mode,
    count: analyzed.length,
    warning: error ?? null,
  });
}
