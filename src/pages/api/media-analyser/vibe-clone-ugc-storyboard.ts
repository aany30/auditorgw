/**
 * Vibe Clone — UGC · Step 1: storyboard the reference reel.
 *
 * Resolve the reel link → mp4, let Gemini watch it (Files API) alongside the user's
 * model + product images, and return a ≤6-shot storyboard (keyframe prompt + motion
 * prompt per shot). The client then renders a keyframe per shot, animates each on
 * Seedance, and stitches the clips. All via FAL_KEY + GEMINI_API_KEY.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { uploadToFalStorage } from "@/lib/media-analyser/fal";
import { callVisionLLM, type VisionUserPart } from "@/lib/media-analyser/vision-llm";
import { geminiVisionModels, normalizeGeminiModel } from "@/lib/media-analyser/gemini-models";
import { deleteGeminiFile, uploadVideoToGeminiFiles } from "@/lib/media-analyser/gemini-files";
import { fetchAdsFromAdLibraryUrl, fetchInstagramVideoUrl } from "@/lib/media-analyser/meta-social";
import {
  buildVibeCloneUserMessage,
  MAX_VIBE_SHOTS,
  VIBE_CLONE_UGC_RESPONSE_SCHEMA,
  VIBE_CLONE_UGC_SYSTEM_PROMPT,
  VibeCloneStoryboardSchema,
  type VibeShot,
} from "@/lib/media-analyser/ugc/vibe-clone-ugc";

export const config = { maxDuration: 300 };

export interface VibeCloneStoryboardResponse {
  shots: VibeShot[];
  sourceVideoUrl: string;
  /** Model/product images hosted on FAL (https) so per-shot keyframe calls stay tiny. */
  modelHostedUrls: string[];
  productHostedUrls: string[];
}

function toInlinePart(dataUrl: string): VisionUserPart | null {
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

function directorModels(): string[] {
  const override = process.env.GEMINI_DIRECTOR_MODEL;
  if (override) return [normalizeGeminiModel(override)];
  return geminiVisionModels();
}

/** Resolve the reel link to a fetchable video URL (mirrors clone-analyze). */
async function resolveVideoUrl(reelUrl: string): Promise<string | null> {
  if (/instagram\.com/i.test(reelUrl)) return await fetchInstagramVideoUrl(reelUrl);
  if (/facebook\.com/i.test(reelUrl)) {
    const { ads } = await fetchAdsFromAdLibraryUrl(reelUrl, 5);
    return ads.find(a => a.videoUrl && /^https:\/\//i.test(a.videoUrl))?.videoUrl ?? null;
  }
  return /^https?:\/\//i.test(reelUrl) ? reelUrl : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const reelUrl = String(body.reelUrl ?? "").trim();
  const aspect = String(body.aspect ?? "9:16");

  const modelUrls = (Array.isArray(body.modelImageDataUrls) ? body.modelImageDataUrls : [])
    .map(u => String(u)).filter(u => u.startsWith("data:image/")).slice(0, 2);
  const productUrls = (Array.isArray(body.productImageDataUrls) ? body.productImageDataUrls : [])
    .map(u => String(u)).filter(u => u.startsWith("data:image/")).slice(0, 3);

  if (!/^https?:\/\//i.test(reelUrl)) {
    return res.status(400).json({ error: "Paste a reel link (Instagram reel, Meta Ad Library, or a direct video URL)." });
  }
  if (!modelUrls.length || !productUrls.length) {
    return res.status(400).json({ error: "Add a model photo and a product photo." });
  }

  let videoUrl: string | null;
  try {
    videoUrl = await resolveVideoUrl(reelUrl);
  } catch (e) {
    return res.status(502).json({ error: `Could not read that reel link: ${e instanceof Error ? e.message : String(e)}` });
  }
  if (!videoUrl) {
    return res.status(422).json({ error: "Couldn't find a video at that link. Use an Instagram reel, a Meta Ad Library link, or a direct .mp4 URL." });
  }

  let fileName: string | null = null;
  try {
    const file = await uploadVideoToGeminiFiles(geminiKey, videoUrl, { displayName: "vibe_clone_ugc_source" });
    fileName = file.name;

    const parts: VisionUserPart[] = [
      { text: buildVibeCloneUserMessage(aspect) },
      { file_data: { mime_type: file.mimeType ?? "video/mp4", file_uri: file.fileUri } },
      { text: `MODEL IMAGE(S) (${modelUrls.length}) — the creator who stars in every shot:` },
      ...modelUrls.map(toInlinePart).filter((p): p is VisionUserPart => p !== null),
      { text: `PRODUCT IMAGE(S) (${productUrls.length}) — feature this exact product:` },
      ...productUrls.map(toInlinePart).filter((p): p is VisionUserPart => p !== null),
    ];

    const raw = await callVisionLLM(VIBE_CLONE_UGC_SYSTEM_PROMPT, parts, geminiKey, {
      jsonMode: true,
      responseSchema: VIBE_CLONE_UGC_RESPONSE_SCHEMA,
      geminiOnly: true,
      enableThinking: true,
      maxTokens: 8192,
      models: directorModels(),
    });

    const parsed = VibeCloneStoryboardSchema.parse(JSON.parse(raw));
    const shots = parsed.shots
      .slice(0, MAX_VIBE_SHOTS)
      .map((s, i) => ({ ...s, shot_number: i + 1 }));
    if (!shots.length) return res.status(422).json({ error: "Couldn't storyboard that reel." });

    // Host the model + product images on FAL ONCE so each per-shot keyframe request
    // carries small https URLs instead of re-uploading megabytes of base64.
    const falKey = process.env.FAL_KEY ?? "";
    const hostAll = async (urls: string[]): Promise<string[]> => {
      if (!falKey) return [];
      const hosted = await Promise.all(urls.map(u => uploadToFalStorage(falKey, u).catch(() => null)));
      return hosted.filter((u): u is string => Boolean(u));
    };
    const [modelHostedUrls, productHostedUrls] = await Promise.all([hostAll(modelUrls), hostAll(productUrls)]);

    const out: VibeCloneStoryboardResponse = { shots, sourceVideoUrl: videoUrl, modelHostedUrls, productHostedUrls };
    return res.status(200).json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[vibe-clone-ugc-storyboard] failed: ${msg}`);
    return res.status(502).json({ error: `Could not storyboard that reel: ${msg}` });
  } finally {
    if (fileName) await deleteGeminiFile(geminiKey, fileName);
  }
}
