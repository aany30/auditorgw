/**
 * Reaction Reel · compositing validation + step.
 * Takes a background video URL + a talking-avatar clip URL and returns a composited reel
 * (circular avatar PiP over the background + auto-captions) via Creatomate. Used both to
 * VALIDATE the compositing path on sample clips and as the final step of the full pipeline.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { renderReactionReel, creatomateEnabled } from "@/lib/media-analyser/creatomate";

export const config = { maxDuration: 300 };

export interface ReactionReelCompositeResponse { videoUrl: string }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  if (!creatomateEnabled()) {
    return res.status(500).json({ error: "CREATOMATE_API_KEY is not set on the server — add it to the Vercel env to composite reaction reels." });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const backgroundUrl = String(body.backgroundUrl ?? "").trim();
  const avatarUrl = String(body.avatarUrl ?? "").trim();
  const aspect = body.aspect === "16:9" ? "16:9" : "9:16";
  const captions = body.captions !== false;

  if (!/^https?:\/\//i.test(backgroundUrl) || !/^https?:\/\//i.test(avatarUrl)) {
    return res.status(400).json({ error: "backgroundUrl and avatarUrl (https) are required." });
  }
  try {
    const videoUrl = await renderReactionReel({ backgroundUrl, avatarUrl, aspect, captions });
    const out: ReactionReelCompositeResponse = { videoUrl };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
