/**
 * Stage 02 -- UGC Ad Director.
 *
 * Takes 2-3 product images + an optional model/talent image + a text brief, and
 * returns a structured 5-beat funnel plan (Hook -> Problem -> Demo -> Payoff -> CTA)
 * plus a production-ready `assembled_seedance_prompt`.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { callVisionLLM, type VisionUserPart } from "@/lib/media-analyser/vision-llm";
import { normalizeGeminiModel } from "@/lib/media-analyser/gemini-models";
import { DIRECTOR_SYSTEM_PROMPT, NO_MODEL_IMAGE_NOTE, durationDirective } from "@/lib/media-analyser/ugc/director-prompt";
import { DIRECTOR_RESPONSE_SCHEMA, parseDirectorPlan } from "@/lib/media-analyser/ugc/types";

export const config = { maxDuration: 120 };

/** data:<mime>;base64,<data> -> an inline_data vision part (or null if malformed). */
function toInlinePart(dataUrl: string): VisionUserPart | null {
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

/** Resolve the Director model list -- strong reasoning preferred, env-overridable. */
function directorModels(): string[] {
  const override = process.env.GEMINI_DIRECTOR_MODEL;
  if (override) return [normalizeGeminiModel(override)];
  const vision = normalizeGeminiModel(process.env.GEMINI_VISION_MODEL ?? "gemini-2.5-flash");
  return [vision];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const description = String(body.description ?? "").trim();
  const aspect = String(body.aspect ?? "9:16");
  const durationSeconds = Number(body.durationSeconds) === 30 ? 30 : 15;
  const withDialogue = body.dialogue !== false;
  const imagine = body.imagine === true;
  const productFeatures = String(body.productFeatures ?? "").trim().slice(0, 2000);
  const language = String(body.language ?? "").trim().slice(0, 120);
  const worldImageDataUrl = typeof body.worldImageDataUrl === "string" && body.worldImageDataUrl.startsWith("data:image/")
    ? body.worldImageDataUrl
    : null;
  const worldDescription = String(body.worldDescription ?? "").trim().slice(0, 600);

  const rawCohort = (body.cohort ?? null) as Record<string, unknown> | null;
  const cohort = rawCohort
    ? {
        name: String(rawCohort.name ?? "").trim().slice(0, 120),
        personaName: String(rawCohort.personaName ?? "").trim().slice(0, 200),
        problemStatement: String(rawCohort.problemStatement ?? "").trim().slice(0, 600),
        keyInsight: String(rawCohort.keyInsight ?? "").trim().slice(0, 400),
        angle: String(rawCohort.angle ?? "").trim().slice(0, 400),
        scriptBrief: String(rawCohort.scriptBrief ?? "").trim().slice(0, 600),
      }
    : null;

  const rawUrls = body.imageDataUrls ?? body.imageDataUrl;
  const productImageUrls = (Array.isArray(rawUrls) ? rawUrls : rawUrls ? [rawUrls] : [])
    .map(u => String(u))
    .filter(u => u.startsWith("data:image/"))
    .slice(0, 3);

  const rawModelUrls = body.modelImageDataUrls ?? body.modelImageDataUrl;
  const modelImageUrls = (Array.isArray(rawModelUrls) ? rawModelUrls : rawModelUrls ? [rawModelUrls] : [])
    .map(u => String(u))
    .filter(u => u.startsWith("data:image/"))
    .slice(0, 3);

  if (!productImageUrls.length) {
    return res.status(400).json({ error: "Upload at least one product photo (data URL)." });
  }
  if (!description && !cohort) {
    return res.status(400).json({ error: "Describe what you want the UGC ad to do." });
  }

  const parts: VisionUserPart[] = [];
  let brief = description
    ? (imagine
        ? `ROUGH ONE-LINE IDEA -- the user isn't sure of the full concept. IMAGINE a complete, compelling cinematic ad concept from this seed: choose a strong creative angle, an attention hook, a visual story and a satisfying payoff, then build the full storyboard around it:\n${description}`
        : `CREATIVE BRIEF:\n${description}`)
    : `CREATIVE BRIEF:\nCreate a ${durationSeconds}-second UGC ad for this product.`;
  if (productFeatures) {
    brief += `\n\nKNOWN PRODUCT DETAILS FROM THE LISTING (use as factual grounding for copy and the product description; do not contradict the product images):\n${productFeatures}`;
  }
  if (cohort && (cohort.name || cohort.problemStatement || cohort.scriptBrief)) {
    brief += `\n\nTARGET COHORT -- tailor the hook, problem framing and language to THIS specific audience (same product)`;
    if (cohort.name) brief += `: ${cohort.name}`;
    if (cohort.personaName) brief += ` (${cohort.personaName})`;
    brief += ".";
    if (cohort.problemStatement) brief += ` Their core problem: ${cohort.problemStatement}`;
    if (cohort.keyInsight) brief += ` Key insight: "${cohort.keyInsight}".`;
    if (cohort.angle) brief += ` Angle: ${cohort.angle}.`;
    if (cohort.scriptBrief) brief += ` ${cohort.scriptBrief}`;
    brief += ` The talent/creator reference image IS the representative person for this cohort -- keep them consistent.`;
  }
  if (language) {
    brief += `\n\nLANGUAGE / ACCENT: The creator speaks in ${language}. Write ALL dialogue lines in that language and accent/style, and set meta.voice_characteristics to a voice with that accent. For Hindi or Hinglish, write the spoken lines in Roman script (transliteration), code-mixing with English naturally the way real creators talk. Keep the per-beat word budgets (count words regardless of language).`;
  }
  if (worldImageDataUrl || worldDescription) {
    brief += `\n\nWORLD / BACKDROP -- stage the entire ad in this environment; the scene_setting and every shot must match its location, lighting and mood`;
    brief += worldDescription ? `: ${worldDescription}.` : " (shown in the world/backdrop reference image).";
  }
  if (!withDialogue) {
    brief += `\n\nCINEMATIC MODE -- NO DIALOGUE: This is a cinematic product ad with NO spoken words. Leave EVERY shot's "dialogue" field empty (""), and set meta.voice_characteristics to "". There is no talking-head creator and no voiceover script. Drive each beat purely through cinematography -- dramatic lighting, dynamic camera movement, product hero/beauty shots, satisfying motion and texture. Any on-screen message goes in text_overlay, not spoken lines. Keep the 5-beat funnel structure and timing.`;
  }
  brief += `\n\nTarget: a ${durationSeconds}-second ${aspect} vertical ${withDialogue ? "UGC ad" : "cinematic (no-dialogue) ad"}. Produce the structured JSON plan now.`;
  if (!modelImageUrls.length) brief += NO_MODEL_IMAGE_NOTE;
  parts.push({ text: brief });

  if (worldImageDataUrl) {
    const worldPart = toInlinePart(worldImageDataUrl);
    if (worldPart) {
      parts.push({ text: "WORLD / BACKDROP IMAGE -- the environment the ad takes place in (no people); set the scene here:" });
      parts.push(worldPart);
    }
  }

  if (modelImageUrls.length) {
    const modelParts = modelImageUrls.map(toInlinePart).filter((p): p is VisionUserPart => p !== null);
    if (modelParts.length) {
      parts.push({ text: `MODEL / TALENT IMAGE(S) (${modelParts.length}) -- the same person who will appear in the ad, shown from multiple angles; keep them consistent:` });
      parts.push(...modelParts);
    }
  }

  parts.push({ text: `PRODUCT IMAGE(S) (${productImageUrls.length}) -- the product being advertised; reproduce exactly:` });
  for (const url of productImageUrls) {
    const p = toInlinePart(url);
    if (p) parts.push(p);
  }

  try {
    const raw = await callVisionLLM(DIRECTOR_SYSTEM_PROMPT + durationDirective(durationSeconds), parts, geminiKey, {
      jsonMode: true,
      responseSchema: DIRECTOR_RESPONSE_SCHEMA,
      enableThinking: true,
      maxTokens: 8192,
      models: directorModels(),
      geminiOnly: false,
    });

    const plan = parseDirectorPlan(raw, durationSeconds);
    return res.status(200).json({ plan });
  } catch (e) {
    return res.status(502).json({ error: `Could not write the UGC ad plan: ${String(e)}` });
  }
}
