/** Micro Drama · Step 2 — generate (or regenerate) a single character portrait on Seedream.
 *  Called once per character; the user regenerates until they confirm the look. */
import type { NextApiRequest, NextApiResponse } from "next";
import { generateImageWithNanoBananaPro, type FalImage } from "@/lib/media-analyser/fal";
import { DramaCharacter, characterImagePrompt } from "@/lib/media-analyser/micro-drama";

export const config = { maxDuration: 300 };

export interface MicroDramaCharacterResponse { imageDataUrl: string }

async function toDataUrl(img: FalImage): Promise<string> {
  const r = await fetch(img.url);
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:${img.content_type || "image/jpeg"};base64,${buf.toString("base64")}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  let character: DramaCharacter;
  try { character = DramaCharacter.parse(body.character); } catch { return res.status(400).json({ error: "Missing character." }); }
  if (!character.name) return res.status(400).json({ error: "Character has no name." });
  const steer = String(body.steer ?? "").trim().slice(0, 300); // optional "make him older / add glasses" on regenerate
  // A per-attempt seed so regenerate actually yields a different take.
  const seed = Number.isFinite(Number(body.seed)) ? Math.floor(Number(body.seed)) : Math.floor(Math.random() * 1_000_000_000);

  try {
    const img = await generateImageWithNanoBananaPro(falKey, characterImagePrompt(character, steer), { aspect: "4:5", provider: "ark", seed });
    const imageDataUrl = await toDataUrl(img);
    const out: MicroDramaCharacterResponse = { imageDataUrl };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: `Character generation failed: ${e instanceof Error ? e.message : e}` });
  }
}
