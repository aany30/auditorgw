/**
 * "Add angles" for a saved persona -- generate identity-locked extra angles of an
 * already-created character from its anchor image.
 *
 *   POST { sourceImageDataUrl, angles: string[] (ANGLE_OPTIONS ids), style?, animatedStyle? }
 *        -> { imageDataUrls, prompts }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { editWithNanoBananaPro, type FalImage } from "@/lib/media-analyser/fal";
import {
  ANGLE_OPTIONS,
  ANIMATED_STYLE_OPTIONS,
  buildCharacterEditPrompt,
  normalizeCharacterStyle,
  normalizeOptionId,
  type CharacterStyle,
} from "@/lib/media-analyser/ugc/character-prompt";

export const config = { maxDuration: 300 };

export interface UGCCharacterAnglesResponse {
  imageDataUrls: string[];
  prompts: string[];
}

/** Fetch a FAL image URL -> JPEG data URL (matches the character route). */
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
  const source = String(body.sourceImageDataUrl ?? "");
  if (!source.startsWith("data:image/") && !source.startsWith("http")) {
    return res.status(400).json({ error: "A valid source character image is required." });
  }

  const style: CharacterStyle = normalizeCharacterStyle(body.style);
  const animatedStyle = normalizeOptionId(body.animatedStyle, ANIMATED_STYLE_OPTIONS);

  // Resolve the requested angle ids -> known variations. Cap at 3 per call.
  const wantedIds = (Array.isArray(body.angles) ? body.angles : []).map(v => String(v)).slice(0, 3);
  const angles = wantedIds
    .map(id => ANGLE_OPTIONS.find(a => a.id === id))
    .filter((a): a is (typeof ANGLE_OPTIONS)[number] => Boolean(a));
  if (!angles.length) {
    return res.status(400).json({ error: "Pick at least one angle to generate." });
  }

  const prompts = angles.map(a => buildCharacterEditPrompt(a.direction, a.negatives, { style, animatedStyle }));

  try {
    const results = await Promise.all(
      prompts.map(p =>
        editWithNanoBananaPro(falKey, [source], p, {
          aspect: "9:16",
          resolution: "2K",
          model: "seedream-5-pro",
          provider: "fal",
        }).catch(e => { console.warn(`[ugc-angles] angle failed: ${e instanceof Error ? e.message : e}`); return null; }),
      ),
    );
    const imgs = results.filter((v): v is FalImage => v !== null);
    if (!imgs.length) throw new Error("None of the angle shots could be generated. Please try again.");
    const imageDataUrls = await Promise.all(imgs.map(toDataUrl));
    const out: UGCCharacterAnglesResponse = { imageDataUrls, prompts };
    return res.status(200).json(out);
  } catch (err) {
    console.error(`[ugc-angles] generation failed: ${err instanceof Error ? err.message : err}`);
    return res.status(502).json({ error: `Could not generate angles: ${String(err instanceof Error ? err.message : err)}` });
  }
}
