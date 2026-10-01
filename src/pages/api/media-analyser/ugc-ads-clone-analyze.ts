/**
 * Clone UGC -- analyze a reference ad video and produce a cloned Director plan.
 *
 * Given a link to an existing UGC ad (a Meta Ad Library link or a direct video
 * URL) + the user's product images, we upload the video to the Gemini Files API,
 * let Gemini watch it, and reverse-engineer a NEW 5-beat Director plan that
 * reproduces the reference's style for the user's product.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { callVisionLLM, type VisionUserPart } from "@/lib/media-analyser/vision-llm";
import { normalizeGeminiModel } from "@/lib/media-analyser/gemini-models";
import { deleteGeminiFile, uploadVideoToGeminiFiles } from "@/lib/media-analyser/gemini-files";
import { CLONE_DIRECTOR_SYSTEM_PROMPT, buildCloneUserMessage } from "@/lib/media-analyser/ugc/clone-prompt";
import { DIRECTOR_RESPONSE_SCHEMA, parseDirectorPlan, type UGCDirectorPlan } from "@/lib/media-analyser/ugc/types";
import { fetchAdsFromAdLibraryUrl, fetchInstagramVideoUrl } from "@/lib/media-analyser/meta-social";

export const config = { maxDuration: 300 };

export interface UGCCloneResponse {
  plan: UGCDirectorPlan;
  sourceVideoUrl: string;
}

/** data:<mime>;base64,<data> -> an inline_data vision part (or null if malformed). */
function toInlinePart(dataUrl: string): VisionUserPart | null {
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

function directorModels(): string[] {
  const override = process.env.GEMINI_DIRECTOR_MODEL;
  if (override) return [normalizeGeminiModel(override)];
  return [normalizeGeminiModel(process.env.GEMINI_VISION_MODEL ?? "gemini-2.5-flash")];
}

/** Resolve the pasted link to a fetchable video URL. */
async function resolveVideoUrl(adUrl: string): Promise<string | null> {
  if (/instagram\.com/i.test(adUrl)) {
    return await fetchInstagramVideoUrl(adUrl);
  }
  if (/facebook\.com/i.test(adUrl)) {
    const { ads } = await fetchAdsFromAdLibraryUrl(adUrl, 5);
    const withVideo = ads.find(a => a.videoUrl && /^https:\/\//i.test(a.videoUrl));
    return withVideo?.videoUrl ?? null;
  }
  return /^https?:\/\//i.test(adUrl) ? adUrl : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const adUrl = String(body.adUrl ?? "").trim();
  const aspect = String(body.aspect ?? "9:16");

  const rawUrls = body.imageDataUrls ?? body.imageDataUrl;
  const productImageUrls = (Array.isArray(rawUrls) ? rawUrls : rawUrls ? [rawUrls] : [])
    .map(u => String(u))
    .filter(u => u.startsWith("data:image/"))
    .slice(0, 3);

  if (!/^https?:\/\//i.test(adUrl)) {
    return res.status(400).json({ error: "Paste a link to the reference ad (an Instagram reel, a Meta Ad Library link, or a direct video URL)." });
  }
  if (!productImageUrls.length) {
    return res.status(400).json({ error: "Add at least one product photo so the clone features your product." });
  }

  let videoUrl: string | null;
  try {
    videoUrl = await resolveVideoUrl(adUrl);
  } catch (e) {
    return res.status(502).json({ error: `Could not read that ad link: ${e instanceof Error ? e.message : String(e)}` });
  }
  if (!videoUrl) {
    return res.status(422).json({ error: "Couldn't find a video to clone at that link. Use an Instagram reel, a Meta Ad Library link (with a video ad), or a direct .mp4 URL." });
  }

  let fileName: string | null = null;
  try {
    const file = await uploadVideoToGeminiFiles(geminiKey, videoUrl, { displayName: "ugc_clone_source" });
    fileName = file.name;

    const parts: VisionUserPart[] = [
      { text: buildCloneUserMessage(aspect) },
      { file_data: { mime_type: file.mimeType ?? "video/mp4", file_uri: file.fileUri } },
      { text: `PRODUCT IMAGE(S) (${productImageUrls.length}) -- the NEW product to feature; reproduce exactly:` },
    ];
    for (const url of productImageUrls) {
      const p = toInlinePart(url);
      if (p) parts.push(p);
    }

    const raw = await callVisionLLM(CLONE_DIRECTOR_SYSTEM_PROMPT, parts, geminiKey, {
      jsonMode: true,
      responseSchema: DIRECTOR_RESPONSE_SCHEMA,
      geminiOnly: true,
      enableThinking: true,
      maxTokens: 8192,
      models: directorModels(),
    });

    const plan = parseDirectorPlan(raw);
    const out: UGCCloneResponse = { plan, sourceVideoUrl: videoUrl };
    return res.status(200).json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ugc-clone] failed: ${msg}`);
    return res.status(502).json({ error: `Could not clone that ad: ${msg}` });
  } finally {
    if (fileName) await deleteGeminiFile(geminiKey, fileName);
  }
}
