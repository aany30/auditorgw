/**
 * Per-ad reel analysis — the "Analyze" button on each competitor ad in the
 * Product Intelligence brief. Answers, for one ad creative:
 *   • What KIND of reel is it? (influencer reel / UGC ad / brand-produced / other)
 *   • Who is the actor/creator? (named if derivable, else described)
 *   • What is the reel trying to depict?
 *   • What are they showcasing / the selling angle?
 *
 * Dual-path so it runs regardless of provider health:
 *   1. VIDEO (richest) — when the ad has a videoUrl AND Gemini is usable, upload
 *      the mp4 to the Gemini Files API and let Gemini natively watch it. This is
 *      geminiOnly (OpenAI can't read video).
 *   2. KEY FRAME (fallback) — otherwise analyse the still / poster frame via
 *      callVisionLLM, which falls back to OpenAI/OpenRouter when Gemini is down.
 *
 * Both paths are grounded with the ad's copy + structural influencer signals so
 * the model can name the creator when the data is actually present (partnership
 * label, @mention, on-screen credit) rather than guessing a stranger's identity.
 */

import { z } from "zod";
import { callVisionLLM, type VisionUserPart } from "./vision-llm";
import { fetchCdnImageInline, fetchCdnVideoInline } from "./brandVisualDna";
import { uploadVideoToGemini } from "./meta-social";
import type { SocialPaidAd } from "./types";

export const AD_REEL_TYPES = [
  "influencer_reel",
  "ugc_ad",
  "brand_produced_ad",
  "product_showcase",
  "testimonial",
  "other",
] as const;

// Tolerant (coerce + .catch) so the OpenAI fallback — which can't be constrained
// by Gemini's responseSchema — is repaired into a valid result, never rejected.
export const AdReelAnalysisSchema = z.object({
  reel_type: z.enum(AD_REEL_TYPES).catch("other"),
  reel_type_label: z.string().catch(""),
  is_influencer: z.boolean().catch(false),
  /** One-line identification of the creator/influencer, when present. */
  influencer_brief: z.string().catch(""),
  actor_present: z.boolean().catch(false),
  actor_name: z.string().catch(""),
  actor_description: z.string().catch(""),
  depicts: z.string().catch(""),
  showcases: z.string().catch(""),
  format: z.string().catch(""),
  setting: z.string().catch(""),
  spoken_language: z.string().catch(""),
  confidence: z.coerce.number().catch(0.5),
  reasoning: z.string().catch(""),
});

export type AdReelAnalysis = z.infer<typeof AdReelAnalysisSchema> & {
  /** Which media the verdict was derived from ("copy" = no still/video available). */
  source: "video" | "image" | "copy";
};

/** Gemini structured-output schema (OpenAPI subset) mirroring AdReelAnalysisSchema. */
const AD_REEL_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    reel_type: { type: "string", enum: [...AD_REEL_TYPES] },
    reel_type_label: { type: "string" },
    is_influencer: { type: "boolean" },
    influencer_brief: { type: "string" },
    actor_present: { type: "boolean" },
    actor_name: { type: "string" },
    actor_description: { type: "string" },
    depicts: { type: "string" },
    showcases: { type: "string" },
    format: { type: "string" },
    setting: { type: "string" },
    spoken_language: { type: "string" },
    confidence: { type: "number" },
    reasoning: { type: "string" },
  },
  required: [
    "reel_type", "reel_type_label", "is_influencer", "influencer_brief", "actor_present",
    "actor_name", "actor_description", "depicts", "showcases", "format",
    "setting", "confidence", "reasoning",
  ],
};

const SYSTEM_PROMPT = `You are a paid-social creative analyst. You are given ONE competitor's ad (a short video/reel, or its key frame if a video is unavailable) plus the ad's copy and metadata. Classify the creative and explain it. Be concrete and specific to THIS ad — no generic filler.

Classify reel_type as exactly one of:
- "influencer_reel": a recognisable creator/influencer presents the product to THEIR audience (often a paid partnership, an @mention, or an on-screen creator credit).
- "ugc_ad": an everyday-person / creator-style ad — authentic, handheld/selfie, real home/room/street, talking to camera — even if it runs from the brand's own page with NO partnership label. Brands routinely hire creators and run it as a normal ad.
- "brand_produced_ad": a polished studio/brand-produced commercial with professional production.
- "product_showcase": product-only / packaging / demo with no real person presenting.
- "testimonial": a customer/expert giving a review or endorsement to camera.
- "other": anything else (graphic/text-only, meme, announcement, etc.).

ACTOR / CREATOR — set actor_present=true if a real human presents or acts in the ad.
- actor_name: give a NAME only if it is genuinely derivable from the provided data — a "paid partnership with X" label, an @handle, an on-screen name/credit, or the known creator field. If you cannot source a name from that evidence, leave actor_name as "" and do NOT guess the identity of an unknown real person.
- actor_description: describe them regardless (apparent age range, gender presentation, look, energy, e.g. "woman in her late 20s, casual athleisure, upbeat").

influencer_brief — ONE short line (≤20 words) identifying the person on screen, filled whenever actor_present=true (an influencer, a UGC creator, or a testimonial speaker — NOT only paid influencers). Empty "" only when no real person appears (pure product/graphic ads). Lead with the name/@handle if it's derivable from the evidence (partnership label, an @mention or on-screen handle, a spoken/printed name), then a few identifying words; if no name is sourceable, write "Unnamed creator — <short description>". Examples: "@fitwithria — fitness creator, mid-20s, gym setting" · "Unnamed creator — woman ~20s, rooftop, POV skit". Never invent or guess a real person's name — describe instead.

depicts: 2-3 sentences on what the reel actually shows — the scene/story, what the person or product is doing, on-screen text/claims.
showcases: 1-2 sentences on what they are SELLING with it — the product benefit, feature, or angle being pushed (e.g. "positions the suitcase as lightweight and travel-ready for frequent flyers").
format: e.g. "talking-head", "skit", "product demo", "lifestyle b-roll", "unboxing", "before/after", "static graphic".
setting: where it's shot (e.g. "home bedroom", "airport", "studio seamless").
spoken_language: the language spoken in the audio if you can hear it (e.g. "Hindi", "English"), else "".
confidence: 0.0-1.0 for your reel_type call.
reasoning: one sentence justifying the classification from concrete evidence.

Return ONLY a single JSON object with EXACTLY these keys (no markdown fences, no commentary):
{
  "reel_type": "<one of the values above>",
  "reel_type_label": "<short human label, e.g. 'Influencer reel'>",
  "is_influencer": true|false,
  "influencer_brief": "<≤20-word creator identification when is_influencer, else ''>",
  "actor_present": true|false,
  "actor_name": "<name or ''>",
  "actor_description": "<string>",
  "depicts": "<string>",
  "showcases": "<string>",
  "format": "<string>",
  "setting": "<string>",
  "spoken_language": "<string or ''>",
  "confidence": 0.0,
  "reasoning": "<string>"
}`;

/** Build the grounding text block from the ad's copy + structural signals. */
function adContext(ad: SocialPaidAd, mode: "video" | "image" | "copy"): string {
  const lines: string[] = [];
  lines.push(
    mode === "video"
      ? "You are watching this competitor video ad (and listening to its audio)."
      : mode === "image"
        ? "You are looking at the key frame / still of this competitor ad (no video available)."
        : "No image or video could be retrieved for this competitor ad. Infer what you can STRICTLY from the ad copy and metadata below. Do NOT invent visual details (actor looks, setting, on-screen action) — leave those fields empty or say what the copy implies, and lower your confidence accordingly."
  );
  const ctx: [string, unknown][] = [
    ["Advertiser page", ad.pageName],
    ["Headline", ad.title],
    ["Body copy", ad.body],
    ["Call to action", ad.cta],
    ["Paid-partnership label", ad.partnershipLabel],
    ["Branded content flag", ad.brandedContent ? "yes" : ""],
    ["Instagram creator (@)", ad.igActor],
    ["Advertiser type", ad.advertiserEntityType],
    ["Page categories", ad.pageCategories?.length ? ad.pageCategories.join(", ") : ""],
  ];
  const known = ctx.filter(([, v]) => v != null && String(v).trim() !== "");
  if (known.length) {
    lines.push("\nAD CONTEXT (use as factual grounding — do not contradict it):");
    for (const [k, v] of known) lines.push(`- ${k}: ${String(v).slice(0, 400)}`);
  }
  lines.push("\nProduce the structured JSON analysis now.");
  return lines.join("\n");
}

/** VIDEO path — upload the mp4 to Gemini Files and let Gemini watch it (geminiOnly). */
async function analyzeViaVideo(ad: SocialPaidAd, geminiKey: string): Promise<AdReelAnalysis> {
  const inline = await fetchCdnVideoInline(ad.videoUrl as string);
  if (!inline) throw new Error("Could not download the ad video from the CDN");
  const bytes = Buffer.from(inline.data, "base64");
  const fileUri = await uploadVideoToGemini(bytes, inline.mime_type, geminiKey);
  if (!fileUri) throw new Error("Gemini Files upload failed for the ad video");

  const parts: VisionUserPart[] = [
    { file_data: { mime_type: inline.mime_type, file_uri: fileUri } },
    { text: adContext(ad, "video") },
  ];
  const raw = await callVisionLLM(SYSTEM_PROMPT, parts, geminiKey, {
    jsonMode: true,
    responseSchema: AD_REEL_RESPONSE_SCHEMA,
    geminiOnly: true, // OpenAI can't read video
    enableThinking: true,
    maxTokens: 2048,
  });
  return { ...parseAnalysis(raw), source: "video" };
}

/** KEY-FRAME path — analyse the still via callVisionLLM (Gemini → OpenAI fallback). */
async function analyzeViaImage(ad: SocialPaidAd, geminiKey: string): Promise<AdReelAnalysis> {
  const still = ad.imageUrl || ad.thumbnailUrl;
  if (!still) throw new Error("This ad has no still image or thumbnail to analyse");
  const inline = await fetchCdnImageInline(still);
  if (!inline) throw new Error("Could not download the ad image from the CDN");

  const parts: VisionUserPart[] = [
    { inline_data: { mime_type: inline.mime_type, data: inline.data } },
    { text: adContext(ad, "image") },
  ];
  const raw = await callVisionLLM(SYSTEM_PROMPT, parts, geminiKey, {
    jsonMode: true,
    responseSchema: AD_REEL_RESPONSE_SCHEMA, // honoured by Gemini; ignored by the OpenAI fallback
    maxTokens: 2048,
  });
  return { ...parseAnalysis(raw), source: "image" };
}

/**
 * COPY path (last resort) — no still or video could be fetched (e.g. a video-only ad
 * with Gemini down, or a creative the CDN blocks). Analyse from the ad's copy +
 * metadata alone so the button always returns a (lower-confidence) verdict instead of
 * a dead-end error. Text-only, so it routes through the Gemini → OpenAI fallback.
 */
async function analyzeViaCopy(ad: SocialPaidAd, geminiKey: string): Promise<AdReelAnalysis> {
  const parts: VisionUserPart[] = [{ text: adContext(ad, "copy") }];
  const raw = await callVisionLLM(SYSTEM_PROMPT, parts, geminiKey, {
    jsonMode: true,
    responseSchema: AD_REEL_RESPONSE_SCHEMA,
    maxTokens: 2048,
  });
  const parsed = parseAnalysis(raw);
  // Never claim visual certainty from copy alone — cap confidence.
  return { ...parsed, confidence: Math.min(parsed.confidence, 0.5), source: "copy" };
}

function parseAnalysis(raw: string): z.infer<typeof AdReelAnalysisSchema> {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return AdReelAnalysisSchema.parse(JSON.parse(s));
}

/**
 * Cheap Gemini auth probe (a tiny list-models GET). Lets us skip the expensive
 * video download+upload when the key is invalid (e.g. a stale 401 key on Vercel)
 * and go straight to the key-frame path, which routes through the OpenAI fallback.
 */
async function geminiUsable(key: string): Promise<boolean> {
  if (!key) return false;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Analyse one competitor ad. Prefers native video understanding; falls back to
 * the key frame (which works via OpenAI even when Gemini is down). Throws only
 * when BOTH paths are impossible/failed.
 */
export async function analyzeAdReel(ad: SocialPaidAd, geminiKey: string): Promise<AdReelAnalysis> {
  const canVideo = !!ad.videoUrl && (await geminiUsable(geminiKey));
  if (canVideo) {
    try {
      return await analyzeViaVideo(ad, geminiKey);
    } catch (e) {
      // Gemini down/out-of-credit, CDN block, or upload failure — fall back to the
      // still frame, which can route through the OpenAI/OpenRouter fallback.
      console.warn(`[analyze-ad] video path failed, falling back to key frame: ${String(e).slice(0, 160)}`);
    }
  }
  // Key-frame path when a still exists; otherwise (video-only ad we couldn't watch,
  // or a CDN-blocked creative) degrade to a copy-only read rather than dead-ending.
  if (ad.imageUrl || ad.thumbnailUrl) {
    try {
      return await analyzeViaImage(ad, geminiKey);
    } catch (e) {
      console.warn(`[analyze-ad] key-frame path failed, falling back to copy: ${String(e).slice(0, 160)}`);
    }
  }
  return analyzeViaCopy(ad, geminiKey);
}
