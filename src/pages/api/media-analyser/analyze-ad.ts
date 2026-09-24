import type { NextApiRequest, NextApiResponse } from "next";
import { analyzeAdReel } from "@/lib/media-analyser/ad-reel-analysis";
import { SocialPaidAdSchema } from "@/lib/media-analyser/types";

export const config = { maxDuration: 120 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;

  const parsed = SocialPaidAdSchema.safeParse(body.ad);
  if (!parsed.success) {
    return res.status(400).json({ error: "A valid ad object is required." });
  }
  const ad = parsed.data;

  if (!ad.videoUrl && !ad.imageUrl && !ad.thumbnailUrl) {
    return res.status(400).json({ error: "This ad has no video or image to analyse." });
  }

  const geminiKey = process.env.GEMINI_API_KEY ?? "";

  try {
    const analysis = await analyzeAdReel(ad, geminiKey);
    return res.status(200).json({ analysis });
  } catch (e) {
    return res.status(502).json({ error: `Could not analyse this ad: ${String(e instanceof Error ? e.message : e)}` });
  }
}
