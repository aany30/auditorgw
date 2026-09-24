import type { NextApiRequest, NextApiResponse } from "next";
import { runProductAnalysisStream, type SocialSource, type ManualCompetitor } from "@/lib/media-analyser/pipeline";
import type { StreamUpdate } from "@/lib/media-analyser/pipeline";
import { cleanUserError } from "@/lib/media-analyser/user-errors";

export const config = { maxDuration: 800 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = String(body.url ?? "").trim();
  const useLlm = body.useLlm !== false;
  const socialSource = (body.socialSource as SocialSource | undefined) ?? "auto";
  const instagramHandle = String(body.instagramHandle ?? "").trim();
  const adLibraryUrl = String(body.adLibraryUrl ?? "").trim();
  const coverCompetitors = body.coverCompetitors === true;
  const brandName = String(body.brandName ?? "").trim().slice(0, 120);
  const competitorsOnly = body.competitorsOnly === true;
  const includeGoogleAds = body.includeGoogleAds === true;
  const includeLinkedIn = body.includeLinkedIn === true;
  const linkedInUrl = String(body.linkedInUrl ?? "").trim();
  const googleAdsMode = body.googleAdsMode === "rich" ? "rich" : "fast";
  const googleAdsUrl = String(body.googleAdsUrl ?? "").trim().slice(0, 1000);
  const competitors: ManualCompetitor[] = (Array.isArray(body.competitors) ? body.competitors : [])
    .map((c): ManualCompetitor => {
      const o = (c ?? {}) as Record<string, unknown>;
      return {
        brand: String(o.brand ?? "").trim().slice(0, 120),
        instagramHandle: String(o.instagramHandle ?? "").trim().slice(0, 200),
        metaAdLibraryUrl: String(o.metaAdLibraryUrl ?? "").trim().slice(0, 1000),
        adKeyword: String(o.adKeyword ?? "").trim().slice(0, 100),
        googleAdsUrl: String(o.googleAdsUrl ?? "").trim().slice(0, 1000),
        linkedInUrl: String(o.linkedInUrl ?? "").trim().slice(0, 1000),
      };
    })
    .filter(c => c.brand || c.instagramHandle || c.metaAdLibraryUrl)
    .slice(0, 5);

  const googleSeed = includeGoogleAds && (!!googleAdsUrl || !!brandName);
  if (!url && !instagramHandle && !adLibraryUrl && !googleSeed && competitors.length === 0) {
    return res.status(400).json({ error: "Provide your brand (url / Instagram / Meta Ad Library / Google Ads) or pin at least one competitor." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    for await (const update of runProductAnalysisStream(url, { useLlm, socialSource, instagramHandle, adLibraryUrl, coverCompetitors, competitors, brandName, competitorsOnly, includeGoogleAds, googleAdsMode, googleAdsUrl, includeLinkedIn, linkedInUrl })) {
      res.write(`data: ${JSON.stringify(update)}\n\n`);
    }
  } catch (err) {
    const errUpdate: StreamUpdate = { status: `## Error\n\n${cleanUserError(err)}`, phase: "error" };
    res.write(`data: ${JSON.stringify(errUpdate)}\n\n`);
  } finally {
    res.end();
  }
}
