/**
 * "Create world / background" -- generate the ad's backdrop image.
 *
 * Given style / time / lighting / a free-text description, render ONE empty
 * environment (no people) via Nano Banana Pro and return it as a data URL.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { generateImageWithNanoBananaPro, type FalImage } from "@/lib/media-analyser/fal";
import { buildWorldPrompt } from "@/lib/media-analyser/ugc/world-prompt";

export const config = { maxDuration: 120 };

export interface UGCWorldResponse {
  imageDataUrl: string;
  prompt: string;
}

/** Fetch a FAL image URL and inline it as a JPEG data URL (body-cap safe). */
async function toDataUrl(img: FalImage): Promise<string> {
  const res = await fetch(img.url);
  if (!res.ok) throw new Error(`Could not fetch generated image (${res.status})`);
  const contentType = img.content_type || res.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buf.toString("base64")}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const style = String(body.style ?? "").trim();
  const time = String(body.time ?? "").trim();
  const lighting = String(body.lighting ?? "").trim();
  const description = String(body.description ?? "").trim().slice(0, 600);

  if (!style && !time && !lighting && !description) {
    return res.status(400).json({ error: "Describe the world -- pick a style/time/lighting or add a description." });
  }

  const prompt = buildWorldPrompt({ style, time, lighting, description });
  const seed = Math.floor(Math.random() * 1_000_000_000);

  try {
    const img = await generateImageWithNanoBananaPro(falKey, prompt, { aspect: "9:16", resolution: "1K", seed });
    const imageDataUrl = await toDataUrl(img);
    const out: UGCWorldResponse = { imageDataUrl, prompt };
    return res.status(200).json(out);
  } catch (err) {
    console.error(`[ugc-world] generation failed: ${err instanceof Error ? err.message : err}`);
    return res.status(502).json({ error: `Could not create the world: ${String(err instanceof Error ? err.message : err)}` });
  }
}
