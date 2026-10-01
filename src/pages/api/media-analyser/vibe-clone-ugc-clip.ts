/**
 * Vibe Clone — UGC · Step 3: animate one shot's keyframe into a short clip.
 * Seedance image-to-video (native audio). Awaited — a short clip fits the budget.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { generateVideoWithSeedance, type FalAspect, type SeedanceResolution } from "@/lib/media-analyser/fal";

export const config = { maxDuration: 300 };

export interface VibeCloneClipResponse {
  videoUrl: string;
  durationSeconds: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const imageUrl = String(body.imageUrl ?? "");
  const prompt = String(body.prompt ?? "").trim();
  const aspect = (String(body.aspect ?? "9:16") as FalAspect);
  const durationSec = Math.max(2, Math.min(10, Math.round(Number(body.durationSec ?? 4)) || 4));
  const resolution: SeedanceResolution = process.env.UGC_VIDEO_RESOLUTION === "1080p" ? "1080p" : "720p";

  if (!/^https?:\/\//i.test(imageUrl)) return res.status(400).json({ error: "A keyframe image URL is required." });
  if (!prompt) return res.status(400).json({ error: "A motion prompt is required." });

  try {
    const video = await generateVideoWithSeedance(falKey, {
      imageUrl,
      prompt,
      durationSec,
      aspect,
      resolution,
      generateAudio: true,
    });
    const out: VibeCloneClipResponse = { videoUrl: video.url, durationSeconds: video.duration ?? durationSec };
    return res.status(200).json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[vibe-clone-ugc-clip] failed: ${msg}`);
    return res.status(502).json({ error: `Could not animate the clip: ${msg}` });
  }
}
