/** Claude Cohort Studio · Step 3 — build the chosen persona's CHARACTER WORLD.
 *  Claude writes a rich bio (likes / dislikes / appearance / world), then GPT Image
 *  (fal-ai/gpt-image-1 via the FAL key) renders a photoreal "in their world" scene using
 *  the persona portrait as the identity reference. Both feed the reviewable step; the scene
 *  image then goes in as an extra visual reference for the UGC render. */
import type { NextApiRequest, NextApiResponse } from "next";
import { brandReason, parseJson } from "@/lib/media-analyser/ugc-new/brand-llm";
import { editWithNanoBananaPro, type FalImage } from "@/lib/media-analyser/fal";
import {
  CHARACTER_WORLD_SYSTEM, characterWorldUser, CHARACTER_WORLD_SCHEMA, characterWorldImagePrompt,
  CharacterWorld, BrandAnalysis, Cohort, CohortPersona,
} from "@/lib/media-analyser/ugc-new/cohort-studio";

export const config = { maxDuration: 300 };

export interface CharacterWorldResponse {
  bio: CharacterWorld;
  worldImageDataUrl: string; // photoreal "in their world" scene (data URL)
  engine: "claude";
}

async function toDataUrl(img: FalImage): Promise<string> {
  const r = await fetch(img.url);
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:${img.content_type || "image/jpeg"};base64,${buf.toString("base64")}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured — GPT Image runs on the FAL key." });
  if (!(process.env.OPENROUTER_API_KEY ?? "").trim()) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured (temporary demo routing)." });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const country = String(body.country ?? "").trim().slice(0, 80);
  const portraitDataUrl = String(body.portraitDataUrl ?? "");
  let analysis: BrandAnalysis, cohort: Cohort, persona: CohortPersona;
  try { analysis = BrandAnalysis.parse(body.analysis); cohort = Cohort.parse(body.cohort); persona = CohortPersona.parse(body.persona); }
  catch { return res.status(400).json({ error: "Missing analysis, cohort, or persona." }); }
  if (!persona.name) return res.status(400).json({ error: "Pick a persona first." });
  if (!portraitDataUrl.startsWith("data:image/")) return res.status(400).json({ error: "The persona's portrait is still generating — try again in a moment." });

  try {
    // 1 · Claude writes the character bio (likes / dislikes / appearance / world).
    const { raw, engine } = await brandReason({
      system: CHARACTER_WORLD_SYSTEM,
      user: characterWorldUser({ analysis, cohort, persona, country }),
      schema: CHARACTER_WORLD_SCHEMA,
      maxTokens: 1200,
    });
    const bio = CharacterWorld.parse(parseJson(raw));

    // 2 · Render the persona in their world FROM the portrait, keeping the SAME person.
    const prompt = characterWorldImagePrompt(bio, persona);
    const img = await editWithNanoBananaPro(falKey, [portraitDataUrl], prompt, { aspect: "9:16", model: "seedream-5-pro", provider: "ark" });
    const worldImageDataUrl = await toDataUrl(img);

    const out: CharacterWorldResponse = { bio, worldImageDataUrl, engine };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: `Character world failed: ${e instanceof Error ? e.message : e}` });
  }
}
