/**
 * Vibe Clone — UGC · Step 4: stitch the per-shot clips into the final reel
 * (FAL ffmpeg compose), preserving each clip's native audio.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { stitchVideosWithFal } from "@/lib/media-analyser/fal";

export const config = { maxDuration: 300 };

export interface VibeCloneStitchResponse {
  videoUrl: string;
  durationSeconds: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const clips = (Array.isArray(body.clips) ? body.clips : [])
    .map(c => ({ url: String((c as Record<string, unknown>)?.url ?? ""), durationSec: Number((c as Record<string, unknown>)?.durationSec ?? 0) }))
    .filter(c => /^https?:\/\//i.test(c.url) && c.durationSec > 0);

  if (!clips.length) return res.status(400).json({ error: "No clips to stitch." });

  try {
    const video = await stitchVideosWithFal(falKey, clips, { keepAudio: true });
    const out: VibeCloneStitchResponse = { videoUrl: video.url, durationSeconds: video.duration ?? 0 };
    return res.status(200).json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[vibe-clone-ugc-stitch] failed: ${msg}`);
    return res.status(502).json({ error: `Could not stitch the reel: ${msg}` });
  }
}
