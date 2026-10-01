/**
 * Lux Ads — Stage 02: Ultra-Luxury Director.
 *
 * Product (1–3) + optional ambassador (0–2) + a brief → a 30-second, 8–10-keyframe
 * luxury spot as structured JSON (see lux-ads/prompt.ts). The Director assembles the
 * final Seedance prompt itself (`assembled_video_prompt`); /api/lux-ads/render feeds it
 * straight to Seedance 2.5. Uses Gemini's responseSchema with OpenAI/OpenRouter fallback.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { callVisionLLM, type VisionUserPart } from "@/lib/media-analyser/vision-llm";
import { normalizeGeminiModel } from "@/lib/media-analyser/gemini-models";
import { LUX_SYSTEM_PROMPT, LUX_NO_DIALOGUE_DIRECTIVE, LUX_RESPONSE_SCHEMA, parseLuxPlan, type LuxPlan } from "@/lib/media-analyser/lux-ads/prompt";

export const config = { maxDuration: 120 };

export interface LuxScriptResponse {
  plan: LuxPlan;
}

/** data:<mime>;base64,<data> → an inline_data vision part (or null if malformed). */
function toInlinePart(dataUrl: string): VisionUserPart | null {
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

/** Strong-reasoning model list (env-overridable), same policy as the UGC director. */
function directorModels(): string[] {
  const override = process.env.GEMINI_DIRECTOR_MODEL;
  if (override) return [normalizeGeminiModel(override)];
  return [normalizeGeminiModel(process.env.GEMINI_VISION_MODEL ?? "gemini-2.5-flash")];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const description = String(body.description ?? "").trim();
  // Lux spots are 16:9 by default (broadcast), but honour a requested vertical/square.
  const aspect = ["16:9", "9:16", "1:1"].includes(String(body.aspect)) ? String(body.aspect) : "16:9";
  const productFeatures = String(body.productFeatures ?? "").trim().slice(0, 2000);
  const palette = String(body.palette ?? "").trim().slice(0, 400);
  const tone = String(body.tone ?? "").trim().slice(0, 400);

  const rawUrls = body.imageDataUrls ?? body.imageDataUrl;
  const productImageUrls = (Array.isArray(rawUrls) ? rawUrls : rawUrls ? [rawUrls] : [])
    .map(u => String(u))
    .filter(u => u.startsWith("data:image/"))
    .slice(0, 3);

  const rawModelUrls = body.modelImageDataUrls ?? body.modelImageDataUrl;
  const modelImageUrls = (Array.isArray(rawModelUrls) ? rawModelUrls : rawModelUrls ? [rawModelUrls] : [])
    .map(u => String(u))
    .filter(u => u.startsWith("data:image/"))
    .slice(0, 2);

  if (!productImageUrls.length) {
    return res.status(400).json({ error: "Upload at least one product photo (data URL)." });
  }
  if (!description) {
    return res.status(400).json({ error: "Describe the luxury spot you want." });
  }

  // Build the multimodal brief: text + (optional) ambassador image(s) + product image(s).
  let brief = `CREATIVE BRIEF:\n${description}`;
  if (productFeatures) {
    brief += `\n\nKNOWN PRODUCT DETAILS (factual grounding for copy + product block; do not contradict the product images):\n${productFeatures}`;
  }
  if (palette) brief += `\n\nCOLOR PALETTE: ${palette}`;
  if (tone) brief += `\n\nTONE WORDS: ${tone}`;
  if (!modelImageUrls.length) {
    brief += `\n\nNOTE: No ambassador/model image was provided. Favour VOICEOVER_ONLY or VISUAL_ATMOSPHERIC delivery (macro/b-roll/product craftsmanship); do not invent an on-camera face. In reference_assets_needed, use only product_image_* slots.`;
  }
  brief += `\n\nTarget: a 30-second ${aspect} ultra-luxury commercial. Produce the structured JSON plan now.`;

  const parts: VisionUserPart[] = [{ text: brief }];

  if (modelImageUrls.length) {
    const modelParts = modelImageUrls.map(toInlinePart).filter((p): p is VisionUserPart => p !== null);
    if (modelParts.length) {
      parts.push({ text: `AMBASSADOR / MODEL IMAGE(S) (${modelParts.length}) — the same person if they appear; keep them consistent:` });
      parts.push(...modelParts);
    }
  }

  parts.push({ text: `PRODUCT IMAGE(S) (${productImageUrls.length}) — the hero product; reproduce exactly (appearance, colour, branding):` });
  for (const url of productImageUrls) {
    const p = toInlinePart(url);
    if (p) parts.push(p);
  }

  try {
    const raw = await callVisionLLM(LUX_SYSTEM_PROMPT + LUX_NO_DIALOGUE_DIRECTIVE, parts, geminiKey, {
      jsonMode: true,
      responseSchema: LUX_RESPONSE_SCHEMA,
      enableThinking: true,
      maxTokens: 8192,
      models: directorModels(),
      geminiOnly: false,
    });
    const plan = parseLuxPlan(raw);
    return res.status(200).json({ plan });
  } catch (e) {
    return res.status(502).json({ error: `Could not write the Lux ad plan: ${String(e)}` });
  }
}
