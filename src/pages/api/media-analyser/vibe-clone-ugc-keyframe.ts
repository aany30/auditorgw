/**
 * Vibe Clone — UGC · Step 2: generate one shot's keyframe photo.
 * Nano Banana Pro composes the model + product into the shot's frame (reel vibe).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { editWithNanoBananaPro, type FalAspect } from "@/lib/media-analyser/fal";

export const config = { maxDuration: 300 };

export interface VibeCloneKeyframeResponse {
  imageUrl: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const keyframePrompt = String(body.keyframePrompt ?? "").trim();
  const aspect = (String(body.aspect ?? "9:16") as FalAspect);
  const imageModel = "seedream-5-pro" as const; // keyframe gen forced to Seedream 5 Pro

  const refs = [
    ...(Array.isArray(body.modelImageDataUrls) ? body.modelImageDataUrls : []),
    ...(Array.isArray(body.productImageDataUrls) ? body.productImageDataUrls : []),
  ].map(u => String(u)).filter(u => u.startsWith("data:image/") || u.startsWith("http")).slice(0, 5);

  if (!keyframePrompt) return res.status(400).json({ error: "Missing keyframe prompt." });
  if (!refs.length) return res.status(400).json({ error: "Missing model/product images." });

  try {
    const img = await editWithNanoBananaPro(falKey, refs, keyframePrompt, { aspect, model: imageModel });
    const out: VibeCloneKeyframeResponse = { imageUrl: img.url };
    return res.status(200).json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[vibe-clone-ugc-keyframe] failed: ${msg}`);
    return res.status(502).json({ error: `Could not generate the keyframe: ${msg}` });
  }
}
