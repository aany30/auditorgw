import type { NextApiRequest, NextApiResponse } from "next";
import { generateReferenceVideoWithSeedance, type FalAspect, type SeedanceResolution } from "@/lib/media-analyser/fal";

export const config = { maxDuration: 300 };

export interface CloneReelClipResponse { videoUrl: string; durationSeconds: number; }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const imageUrl = String(body.imageUrl ?? "");
  const prompt = String(body.prompt ?? "").trim();
  const aspect = (String(body.aspect ?? "9:16") as FalAspect);
  const durationSec = Math.max(5, Math.min(30, Math.round(Number(body.durationSec ?? 15)) || 15));
  const resolution: SeedanceResolution = process.env.UGC_VIDEO_RESOLUTION === "1080p" ? "1080p" : "720p";
  if (!/^https?:\/\//i.test(imageUrl)) return res.status(400).json({ error: "A keyframe image URL is required." });
  if (!prompt) return res.status(400).json({ error: "A motion prompt is required." });
  try {
    const video = await generateReferenceVideoWithSeedance(falKey, { imageUrls: [imageUrl], prompt, unclampedDurationSec: durationSec, aspect, resolution, generateAudio: true, seedanceProvider: "auto" });
    const out: CloneReelClipResponse = { videoUrl: video.url, durationSeconds: video.duration ?? durationSec };
    return res.status(200).json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[clone-reel-clip] failed: ${msg}`);
    return res.status(502).json({ error: `Could not render the clone reel: ${msg}` });
  }
}
