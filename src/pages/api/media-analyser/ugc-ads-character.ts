/**
 * "Create character" -- generate a UGC talent portrait from a text description.
 *
 * The UGC pipeline's optional model/talent slot is just a `data:image/...` URL
 * (uploaded by the user). This route gives the user a second way to fill it:
 * pick a few casting traits + free-text detail, and we render a photorealistic
 * creator portrait via Nano Banana Pro. We return it as a DATA URL so it drops
 * straight into the existing `modelImage` slot -- /script and /render can't tell
 * it apart from an uploaded photo, so nothing downstream changes.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { editWithNanoBananaPro, generateImageWithNanoBananaPro, type FalImage } from "@/lib/media-analyser/fal";
import {
  AGE_OPTIONS,
  ANIMATED_STYLE_OPTIONS,
  buildAnimatedCharacterPrompt,
  buildAnimatedPortraitSubject,
  buildCharacterEditPrompt,
  buildCharacterPrompt,
  buildCharacterUserMessage,
  buildPortraitSubject,
  CHARACTER_REFERENCES_DIRECTIVE,
  CHARACTER_RESPONSE_SCHEMA,
  CHARACTER_SYSTEM_PROMPT,
  CHARACTER_PORTRAIT_QC_SYSTEM,
  CHARACTER_PORTRAIT_QC_SCHEMA,
  CHARACTER_VARIATIONS,
  CharacterPlanSchema,
  ETHNICITY_OPTIONS,
  GENDER_OPTIONS,
  normalizeCharacterStyle,
  normalizeOptionId,
  SKIN_TONE_OPTIONS,
  type CharacterStyle,
  type CharacterTraits,
  type ProductContext,
} from "@/lib/media-analyser/ugc/character-prompt";
import { geminiVisionModels } from "@/lib/media-analyser/gemini-models";
import { callVisionLLM, type VisionUserPart } from "@/lib/media-analyser/vision-llm";
import { fetchInstagramImageUrls } from "@/lib/media-analyser/meta-social";

export const config = { maxDuration: 300 };

const MAX_REF_IMAGE_BYTES = 5 * 1024 * 1024;

/** Download a (public IG CDN) image URL -> a Gemini inline_data part. Null on failure. */
async function fetchImageInlinePart(url: string): Promise<VisionUserPart | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
        Referer: "https://www.instagram.com/",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").split(";")[0];
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_REF_IMAGE_BYTES) return null;
    return { inline_data: { mime_type: ct, data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

export interface UGCCharacterResponse {
  /** The consistent set: anchor portrait + identity-locked variations of the same person. */
  imageDataUrls: string[];
  prompt: string;
  /** Image-QC of the anchor portrait (real style only): 0-100 usability + a one-line note. */
  qcScore?: number;
  qcNotes?: string;
  /** Back-compat: the anchor shot (= imageDataUrls[0]). */
  imageDataUrl?: string;
  /** Inspectable prompts (cohort debug dropdown): the exact text sent to Nano Banana Pro. */
  debug?: {
    anchorPrompt: string;
    variationPrompts: string[];
  };
}

/** Fetch a FAL image URL and inline it as a JPEG data URL (AI-friendly, body-cap safe). */
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
  // Image engine: "ark" (ByteDance ARK Seedream 5 Pro) when the ByteDance toggle is on,
  // else "fal". ARK falls back to FAL automatically inside the image helpers.
  const imgProvider: "ark" | "fal" = body.provider === "ark" ? "ark" : "fal";
  const rawTraits = (body.traits ?? {}) as Record<string, unknown>;
  const free = (v: unknown, n = 200) => String(v ?? "").trim().slice(0, n);
  const traits: CharacterTraits = {
    // id-based traits are validated against the option tables.
    gender: normalizeOptionId(rawTraits.gender, GENDER_OPTIONS) || undefined,
    ageRange: normalizeOptionId(rawTraits.ageRange, AGE_OPTIONS) || undefined,
    ethnicity: normalizeOptionId(rawTraits.ethnicity, ETHNICITY_OPTIONS) || undefined,
    skinTone: normalizeOptionId(rawTraits.skinTone, SKIN_TONE_OPTIONS) || undefined,
    // freeform traits -- trimmed + capped.
    hair: free(rawTraits.hair) || undefined,
    eyes: free(rawTraits.eyes) || undefined,
    distinguishingMark: free(rawTraits.distinguishingMark, 120) || undefined,
    build: free(rawTraits.build) || undefined,
    name: free(rawTraits.name, 40) || undefined,
  };
  const details = String(body.details ?? "").trim().slice(0, 600);
  // Optional persona grounding (cohort mode) -- individuates each cohort's creator.
  const personaName = String(body.personaName ?? "").trim().slice(0, 200);
  const personaContext = String(body.personaContext ?? "").trim().slice(0, 600);

  // Character style -- a photorealistic real person (default) or an animated character
  // rendered in one of the ANIMATED_STYLE_OPTIONS looks.
  const style: CharacterStyle = normalizeCharacterStyle(body.style);
  const animatedStyle = normalizeOptionId(body.animatedStyle, ANIMATED_STYLE_OPTIONS);

  // Optional company/brand context -- when the "cast from company data" toggle is on, the
  // caller passes the fetched product/brand signals so the casting director derives a
  // character relevant to the company rather than a generic creator.
  const rawPc = (body.productContext ?? {}) as Record<string, unknown>;
  const productContext: ProductContext = {
    product: free(rawPc.product, 200) || undefined,
    category: free(rawPc.category, 120) || undefined,
    brandAdjectives: free(rawPc.brandAdjectives, 200) || undefined,
    moodDirection: free(rawPc.moodDirection, 400) || undefined,
    archetypeOverride: free(rawPc.archetypeOverride, 120) || undefined,
  };
  const hasProductContext = Boolean(
    productContext.product || productContext.category || productContext.brandAdjectives ||
    productContext.moodDirection || productContext.archetypeOverride,
  );
  // Per-request variation seed so identical traits still produce distinct people.
  const personaSeed = Math.floor(Math.random() * 1_000_000_000);

  // Optional "From references" mode -- Instagram post links whose aesthetic + creator
  // archetype the generated character should match (new face, not a copy).
  const rawRefs = body.referenceUrls;
  const referenceUrls = (Array.isArray(rawRefs) ? rawRefs : [])
    .map(u => String(u).trim())
    .filter(u => /^https?:\/\//i.test(u) && /instagram\.com/i.test(u))
    .slice(0, 3);

  // Generate a SINGLE photo -- just the anchor portrait.
  const count = 1;

  // References alone are sufficient grounding; otherwise require at least one trait.
  const hasTrait = Boolean(
    traits.gender || traits.ageRange || traits.ethnicity || traits.skinTone ||
    traits.hair || traits.eyes || traits.distinguishingMark || traits.build || details,
  );
  if (!hasTrait && !referenceUrls.length) {
    return res.status(400).json({ error: "Describe the character -- pick a trait, add a detail, or paste Instagram references." });
  }

  // Resolve + download the reference images (if any) for the Gemini analysis.
  const refImageParts: VisionUserPart[] = [];
  if (referenceUrls.length) {
    try {
      const imageUrls = await fetchInstagramImageUrls(referenceUrls);
      const parts = await Promise.all(imageUrls.map(fetchImageInlinePart));
      for (const p of parts) if (p) refImageParts.push(p);
    } catch (e) {
      return res.status(502).json({ error: `Could not read those Instagram posts: ${e instanceof Error ? e.message : String(e)}` });
    }
    if (!refImageParts.length) {
      return res.status(422).json({ error: "Couldn't read images from those Instagram links -- make sure they're public posts." });
    }
  }

  // -- Resolve the shot prompts --
  let anchorPrompt = "";
  const variationPrompts: string[] = [];
  let promptLabel = "";

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  const useLLM = Boolean(style === "real" && geminiKey && (refImageParts.length || personaName || personaContext || hasProductContext));
  if (useLLM) {
    try {
      const userParts: VisionUserPart[] = [];
      if (refImageParts.length) {
        userParts.push({ text: CHARACTER_REFERENCES_DIRECTIVE }, ...refImageParts);
      }
      userParts.push({ text: buildCharacterUserMessage(traits, details, count, { personaSeed, personaName, personaContext, productContext: hasProductContext ? productContext : undefined }) });
      const raw = await callVisionLLM(
        CHARACTER_SYSTEM_PROMPT,
        userParts,
        geminiKey,
        { jsonMode: true, responseSchema: CHARACTER_RESPONSE_SCHEMA, geminiOnly: true, enableThinking: true, maxTokens: 6144, models: geminiVisionModels() },
      );
      console.log(`[ugc-character] generated plan (refs=${refImageParts.length} traits=${JSON.stringify(traits)} details="${details}"):\n${raw}`);
      const plan = CharacterPlanSchema.parse(JSON.parse(raw));
      const shots = plan.shots.slice(0, count);
      anchorPrompt = shots[0]?.prompt ?? "";
      for (const s of shots.slice(1)) variationPrompts.push(s.prompt);
      promptLabel = String((plan.base_identity_prompt?.subject as string) ?? "") || anchorPrompt;
    } catch (e) {
      console.warn(`[ugc-character] structured prompt failed, falling back to flat assembly: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (!anchorPrompt) {
    if (style === "animated") {
      anchorPrompt = buildAnimatedCharacterPrompt(traits, details, animatedStyle);
      promptLabel = buildAnimatedPortraitSubject(traits);
      for (const v of CHARACTER_VARIATIONS.slice(0, Math.max(0, count - 1))) {
        variationPrompts.push(buildCharacterEditPrompt(v.direction, v.negatives, { style, animatedStyle }));
      }
    } else {
      anchorPrompt = buildCharacterPrompt(traits, details);
      promptLabel = buildPortraitSubject(traits);
      for (const v of CHARACTER_VARIATIONS.slice(0, Math.max(0, count - 1))) {
        variationPrompts.push(buildCharacterEditPrompt(v.direction, v.negatives));
      }
    }
  }

  try {
    const anchor = await generateImageWithNanoBananaPro(falKey, anchorPrompt, { aspect: "9:16", seed: personaSeed, provider: imgProvider });

    const variations = await Promise.all(
      variationPrompts.map(vp =>
        editWithNanoBananaPro(falKey, [anchor.url], vp, {
          aspect: "9:16",
          resolution: "2K",
          model: "seedream-5-pro",
          provider: imgProvider,
        }).catch(e => { console.warn(`[ugc-character] variation failed: ${e instanceof Error ? e.message : e}`); return null; }),
      ),
    );

    const imgs: FalImage[] = [anchor, ...variations.filter((v): v is FalImage => v !== null)];
    const imageDataUrls = await Promise.all(imgs.map(toDataUrl));

    let qcScore: number | undefined, qcNotes: string | undefined;
    if (style === "real" && geminiKey && imageDataUrls[0]?.startsWith("data:")) {
      try {
        const raw = await callVisionLLM(
          CHARACTER_PORTRAIT_QC_SYSTEM,
          [{ text: "Judge this creator portrait." }, { inline_data: { mime_type: "image/jpeg", data: imageDataUrls[0].split(",")[1] ?? "" } }],
          geminiKey,
          { jsonMode: true, responseSchema: CHARACTER_PORTRAIT_QC_SCHEMA, geminiOnly: true, maxTokens: 300, models: geminiVisionModels() },
        );
        const qc = JSON.parse(raw) as { score?: number; notes?: string };
        if (typeof qc.score === "number") qcScore = qc.score;
        if (typeof qc.notes === "string") qcNotes = qc.notes;
      } catch (e) { console.warn(`[ugc-character] QC skipped: ${e instanceof Error ? e.message : e}`); }
    }

    const out: UGCCharacterResponse = {
      imageDataUrls,
      imageDataUrl: imageDataUrls[0],
      prompt: promptLabel,
      qcScore,
      qcNotes,
      debug: { anchorPrompt, variationPrompts },
    };
    return res.status(200).json(out);
  } catch (err) {
    console.error(`[ugc-character] generation failed: ${err instanceof Error ? err.message : err}`);
    return res.status(502).json({ error: `Could not create the character: ${String(err instanceof Error ? err.message : err)}` });
  }
}
