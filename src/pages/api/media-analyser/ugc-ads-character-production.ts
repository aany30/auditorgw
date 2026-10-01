/**
 * Character production shots (character-prompt.md).
 *
 * Renders structured PRODUCTION shots (product / garment / lifestyle) for a locked
 * character: token + locked traits + per-shot pose/lighting/lens/negatives are
 * serialized to a flattened Nano Banana Pro prompt and edited over the supplied
 * model + garment + texture references.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { editWithNanoBananaPro, type FalAspect, type FalImage } from "@/lib/media-analyser/fal";
import {
  buildLockedTraits,
  makeCharacterToken,
  serializeProductionShot,
  type CharacterTraits,
  type ProductionGlobal,
  type ProductionShotInput,
} from "@/lib/media-analyser/ugc/character-prompt";

export const config = { maxDuration: 300 };

export interface UGCProductionResponse {
  token: string;
  lockedTraits: string;
  shots: { id: string; prompt: string; imageUrl?: string; error?: string }[];
}

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
  const traits = (body.traits ?? {}) as CharacterTraits;
  const aspect = (String(body.aspect ?? "4:5") as FalAspect);
  const imageModel = "seedream-5-pro" as const;
  const global = (body.global ?? {}) as ProductionGlobal;
  const shotsIn = (Array.isArray(body.shots) ? body.shots : []) as ProductionShotInput[];

  const refs = [
    ...(Array.isArray(body.modelImageDataUrls) ? body.modelImageDataUrls : []),
    ...(Array.isArray(body.garmentImageDataUrls) ? body.garmentImageDataUrls : []),
    ...(Array.isArray(body.textureImageDataUrls) ? body.textureImageDataUrls : []),
  ].map(u => String(u)).filter(u => u.startsWith("data:image/") || u.startsWith("http")).slice(0, 6);

  if (!shotsIn.length) return res.status(400).json({ error: "Provide at least one shot." });
  if (!refs.length) return res.status(400).json({ error: "Provide a model/garment/texture reference image." });

  const token = makeCharacterToken(traits.name ?? String(body.name ?? ""));
  const lockedTraits = buildLockedTraits(traits);

  const shots = await Promise.all(shotsIn.slice(0, 6).map(async (shot, i) => {
    const id = shot.id || `shot_${i + 1}`;
    const prompt = serializeProductionShot(token, lockedTraits, global, shot);
    try {
      const img = await editWithNanoBananaPro(falKey, refs, prompt, { aspect, model: imageModel });
      return { id, prompt, imageUrl: await toDataUrl(img) };
    } catch (e) {
      return { id, prompt, error: e instanceof Error ? e.message : String(e) };
    }
  }));

  const out: UGCProductionResponse = { token, lockedTraits, shots };
  return res.status(200).json(out);
}
