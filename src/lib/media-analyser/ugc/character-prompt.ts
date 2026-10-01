/**
 * "Create character" — builds a photorealistic UGC-creator portrait prompt from a
 * few minimal casting traits + free-text detail, for Nano Banana Pro. The output
 * image is used as the optional model/talent reference in the UGC ad pipeline, so
 * it must read as a single, real person facing the camera — NOT a glossy studio
 * model shot. The option lists below are the single source of truth shared by the
 * /api/ugc-ads/character route and the UGCAds form so they never drift.
 */

import { z } from "zod";

export interface CharacterTraits {
  gender?: string;
  ageRange?: string;
  ethnicity?: string;
  /** Fitzpatrick skin tone (id from SKIN_TONE_OPTIONS). */
  skinTone?: string;
  /** Hair — colour · style/texture · part/volume, freeform. */
  hair?: string;
  /** Eyes — colour + shape, freeform. */
  eyes?: string;
  /** One short distinguishing mark (mole, freckles, gap tooth…). Optional. */
  distinguishingMark?: string;
  /** Build — height + body type (production shots). Freeform. */
  build?: string;
  /** Optional character name → identity token {NAME}_CHR. */
  name?: string;
}

/**
 * Universal product/brand signal fed into casting. Deliberately category-agnostic —
 * no hardcoded vertical logic (no "if sports then athletic" tables). Instead the
 * system prompt is instructed to REASON from these fields to derive the right
 * archetype, build, expression, wardrobe register, pose energy and setting, the
 * way a human casting director would read a creative brief. This is what makes
 * the same prompt work for a sports shoe, a skincare serum, a fintech app, or a
 * luxury watch without any per-category branching in code.
 */
export interface ProductContext {
  /** What's being sold, as specifically as possible: "trail-running shoes", "vitamin-C serum", "no-code budgeting app". */
  product?: string;
  /** Category/industry if product name alone is ambiguous: "sports & fitness", "skincare", "fintech". */
  category?: string;
  /** Brand tone in a few adjectives: "bold, energetic, confident" / "clean, calm, premium" / "playful, approachable". */
  brandAdjectives?: string;
  /** Free-text campaign/mood direction: "mid-workout energy, gym or outdoor training setting", "quiet morning skincare ritual, soft bathroom light". */
  moodDirection?: string;
  /** Optional explicit archetype override if the caller already knows exactly who they want cast, e.g. "athletic performance model/influencer". Skips derivation. */
  archetypeOverride?: string;
}

interface Option {
  id: string;
  label: string;
}

// `id: ""` is the "no preference" choice — omitted from the prompt entirely.
export const GENDER_OPTIONS: Option[] = [
  { id: "", label: "Any gender" },
  { id: "Woman", label: "Woman" },
  { id: "Man", label: "Man" },
  { id: "Non-binary, androgynous", label: "Non-binary / androgynous" },
];

export const AGE_OPTIONS: Option[] = [
  { id: "", label: "Any age" },
  { id: "in their late teens", label: "Teens" },
  { id: "in their 20s", label: "20s" },
  { id: "in their 30s", label: "30s" },
  { id: "in their 40s", label: "40s" },
  { id: "in their 50s", label: "50s" },
  { id: "60 or older", label: "60+" },
];

export const ETHNICITY_OPTIONS: Option[] = [
  { id: "", label: "Any ethnicity" },
  { id: "South Asian", label: "South Asian" },
  { id: "East Asian", label: "East Asian" },
  { id: "Southeast Asian", label: "Southeast Asian" },
  { id: "Black / African", label: "Black / African" },
  { id: "White / Caucasian", label: "White / Caucasian" },
  { id: "Hispanic / Latino", label: "Hispanic / Latino" },
  { id: "Middle Eastern", label: "Middle Eastern" },
  { id: "Mixed ethnicity", label: "Mixed" },
];

// Fitzpatrick scale — composes cleanly with ethnicity for consistent skin rendering (§3).
export const SKIN_TONE_OPTIONS: Option[] = [
  { id: "", label: "Not specified" },
  { id: "fair Fitzpatrick I-II", label: "Fair" },
  { id: "light-medium Fitzpatrick III", label: "Light-medium" },
  { id: "medium olive Fitzpatrick IV", label: "Medium / olive" },
  { id: "deep Fitzpatrick V", label: "Deep" },
  { id: "very deep Fitzpatrick VI", label: "Very deep" },
];

/** Validate an id against an option table (blank passes as "no preference"). */
export function normalizeOptionId(id: unknown, options: Option[]): string {
  const v = String(id ?? "").trim();
  if (!v) return "";
  return options.some(o => o.id === v) ? v : "";
}

// ───────────────────────────────────────────────────────────────────────────
// Character STYLE — real human vs an animated / illustrated character.
//
// A persona is either a photorealistic real person (the default UGC creator) or
// an animated character rendered in one of a few well-known illustration styles.
// The style id below is a natural-language phrase spliced straight into the image
// prompt, so it doubles as the single source of truth shared by the route and UI.
// ───────────────────────────────────────────────────────────────────────────

export type CharacterStyle = "real" | "animated";

/** `id` is the phrase spliced into the prompt; `label` is the UI chip. */
export const ANIMATED_STYLE_OPTIONS: Option[] = [
  { id: "", label: "Any animated style" },
  { id: "3D Pixar-style animated character, soft global illumination, subsurface skin shading, expressive rounded features", label: "3D / Pixar" },
  { id: "2D anime character, clean cel shading, crisp linework, expressive large eyes, vibrant flat colors", label: "Anime" },
  { id: "claymation stop-motion character, handmade modelling-clay texture, tactile fingerprints, soft studio light", label: "Claymation" },
  { id: "flat vector illustration character, bold geometric shapes, minimal shading, clean corporate-memphis palette", label: "Flat vector" },
  { id: "hand-drawn comic-book character, inked outlines, halftone shading, dynamic saturated colors", label: "Comic book" },
  { id: "3D low-poly stylized character, faceted surfaces, clean studio lighting, playful game-art look", label: "Low-poly 3D" },
];

/** Normalize a style id (defaults to "real"). */
export function normalizeCharacterStyle(v: unknown): CharacterStyle {
  return String(v ?? "").trim() === "animated" ? "animated" : "real";
}

// Aesthetic aligned with the UGC New pipeline's portrait prompt: an authentic
// user-generated-content selfie, NOT a studio/commercial headshot. Kept usable as a
// casting reference (one clear, well-lit face) so it still composites cleanly downstream.
const PORTRAIT_BASE =
  "Photorealistic UGC-style selfie/portrait of ONE real person. " +
  "Upper-body framing, looking directly at the camera with a warm, natural, candid expression. " +
  "Casual smartphone-camera lighting and framing in a simple everyday setting, realistic skin texture and detail, " +
  "authentic user-generated-content ad aesthetic with slight natural imperfection — NOT studio or commercial polish. " +
  "Casting reference for a video ad — the face must be clear, unobstructed and well-lit.";

const PORTRAIT_NEGATIVES =
  "Avoid: more than one person, studio glamour lighting, heavy makeup retouching, plastic skin, " +
  "oversaturated colors, stock-photo posing, any text, captions, watermarks or logos, sunglasses, " +
  "hats covering the face, AI artifacts.";

// ── Image-QC for a generated creator portrait (ported from the UGC New pipeline's
// image-QC, adapted for a SOLO portrait — no product-in-shot check). Scores whether
// the face is clean enough to animate into a talking-head, so bad generations are
// flagged before a video is built on them.
export const CHARACTER_PORTRAIT_QC_SYSTEM =
  "You are a strict quality checker for AI-generated UGC creator portraits used as casting references for talking-head video ads. Judge only what is actually visible. " +
  "faceUsable: is there exactly one clear, undistorted human face suitable for animating into a talking-head video (false if the face is cropped, deformed, has wrong or asymmetric anatomy, extra/warped features, or multiple people compete for focus)? " +
  "score: 0-100 overall usability of this portrait as a creator reference for a social ad. " +
  "notes: one short sentence naming the single biggest problem, or 'looks good' if there is none. " +
  "Be conservative — a plausible-looking but flawed face should not score highly.";

export const CHARACTER_PORTRAIT_QC_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    faceUsable: { type: "boolean" },
    score: { type: "integer" },
    notes: { type: "string" },
  },
  required: ["faceUsable", "score", "notes"],
};

/**
 * Extra-shot directions for the consistent multi-shot set. The anchor portrait
 * (shot 1) uses `buildCharacterPrompt`; each of these drives one identity-locked
 * variation of the SAME person via `editWithNanoBananaPro` (anchor as reference).
 *
 * ONLY the head angle changes — NOT the expression or lighting. Seedance drifts the
 * identity when its reference images differ in expression/lighting ("it invents
 * features reconciling the differences"), so the set must be a true minimal pair:
 * same neutral expression, same daylight, same wardrobe, just a slight angle change.
 */
/** A degree-based angle variation (§4b) with negatives for the adjacent extremes. */
export interface CharacterVariation {
  id: string;
  direction: string;
  /** Extra negatives that stop the model over/undershooting this angle. */
  negatives: string;
}

export const CHARACTER_VARIATIONS: CharacterVariation[] = [
  {
    id: "three_quarter_right",
    direction: "a slight three-quarter angle, head turned only a few degrees (about 20-30°) off-camera to the right — keep the SAME neutral, relaxed, natural expression, the SAME soft daylight and the SAME wardrobe as the reference; change ONLY the head angle",
    negatives: "full profile, front facing, exaggerated turn, looking away",
  },
  {
    id: "three_quarter_left",
    direction: "a slight three-quarter angle, head turned only a few degrees (about 20-30°) off-camera to the left — keep the SAME neutral, relaxed, natural expression, the SAME soft daylight and the SAME wardrobe as the reference; change ONLY the head angle",
    negatives: "full profile, front facing, exaggerated turn, looking away",
  },
  {
    id: "chin_up",
    direction: "head tilted up about 15°, chin lifted, camera angled slightly low — keep the SAME expression, lighting and wardrobe as the reference; change ONLY the head angle",
    negatives: "extreme upward tilt, looking at the ceiling, front facing flat",
  },
];

/**
 * The angle set offered by the "Add angles" picker on a saved persona. A superset
 * of CHARACTER_VARIATIONS that also includes the two profiles and a full-body shot,
 * so a saved character can be reused across reels from whatever angle a scene needs.
 * Each `direction` is fed to `buildAngleEditPrompt` with the saved anchor as the
 * identity reference.
 */
export const ANGLE_OPTIONS: CharacterVariation[] = [
  ...CHARACTER_VARIATIONS,
  {
    id: "three_quarter_left",
    direction: "a slight three-quarter angle, head turned only a few degrees (about 20-30°) off-camera to the left — keep the SAME expression, lighting and wardrobe as the reference; change ONLY the head angle",
    negatives: "full profile, front facing, exaggerated turn, looking away",
  },
  {
    id: "profile_right",
    direction: "a clean side profile, head turned about 90° to the right so the face is seen from the side — keep the SAME expression, lighting and wardrobe as the reference; change ONLY the head angle",
    negatives: "front facing, three-quarter only, looking at camera",
  },
  {
    id: "full_body",
    direction: "a full-body shot from head to toe, standing in a relaxed natural pose, showing the complete outfit — keep the SAME face, hair, skin tone and wardrobe as the reference; widen the framing to full body",
    negatives: "cropped body, close-up, cut-off feet, different outfit",
  },
].filter((v, i, arr) => arr.findIndex(o => o.id === v.id) === i);

/**
 * Identity-locked edit prompt for a variation / angle shot. Fed to Nano Banana Pro
 * with the anchor portrait as the reference image so it reproduces the EXACT same
 * character in a different angle rather than inventing a new one. For a real person
 * the render register is photoreal; for an animated character it holds the SAME
 * illustration style as the reference instead. Expression, lighting and wardrobe are
 * held constant so the shots form a clean consistency pair. `extraNegatives` (the
 * adjacent-extreme guards) are added ahead of the static set.
 */
export function buildCharacterEditPrompt(
  direction: string,
  extraNegatives?: string,
  opts?: { style?: CharacterStyle; animatedStyle?: string },
): string {
  const extra = extraNegatives?.trim() ? `Avoid: ${extraNegatives.trim()}.\n\n` : "";
  const animated = opts?.style === "animated";
  if (animated) {
    const styleLabel = opts?.animatedStyle?.trim() || "the SAME animation style as the reference";
    return (
      "Reproduce the EXACT same animated character from the reference image — identical face design, " +
      "hair, colour palette, outfit and proportions. Do NOT change the character's identity, expression or style. " +
      `Render in ${styleLabel}. ` +
      `New shot of that same character: ${direction}. ` +
      "ONE character only, clean background consistent with the reference." +
      `\n\n${extra}Avoid: more than one character, style drift, photorealistic render, any text, captions, watermarks or logos, AI artifacts.`
    );
  }
  return (
    "Reproduce the EXACT same person from the reference image — identical face, hair, " +
    "skin tone, eye colour, age and outfit. Do NOT change their identity, expression, lighting or wardrobe. " +
    `New shot of that same person: ${direction}. ` +
    "Photorealistic, ONE real person only, simple neutral background, soft natural daylight, " +
    "realistic skin texture, face clear, unobstructed and well-lit (casting reference for a video ad)." +
    `\n\n${extra}${PORTRAIT_NEGATIVES}`
  );
}

/** Assign a short uppercase identity token {NAME}_CHR (§4a). */
export function makeCharacterToken(name?: string): string {
  const base = String(name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return `${base || "MODEL"}_CHR`;
}

// ───────────────────────────────────────────────────────────────────────────
// Structured-JSON character generation (LLM-authored identity + shots).
//
// Instead of the flat string assembly above, an LLM designs ONE locked persona
// (base_identity_prompt) + a consistency contract (global_rules) + per-shot image
// prompts (shots[]). The route renders shots[0] as the anchor and the rest as
// identity-locked edits off the anchor. The flat builders above remain as a
// graceful fallback if the LLM call fails.
// ───────────────────────────────────────────────────────────────────────────

/** One render instruction in the structured plan. */
export const CharacterShotSchema = z.object({
  id: z.string().default(""),
  type: z.string().default(""),
  identity_locked: z.boolean().default(true),
  prompt: z.string().min(1),
});

/** Validated structured character plan returned by the LLM. */
export const CharacterPlanSchema = z.object({
  base_identity_prompt: z.record(z.string(), z.unknown()).optional(),
  global_rules: z.record(z.string(), z.unknown()).optional(),
  shots: z.array(CharacterShotSchema).min(1),
});

export type CharacterPlan = z.infer<typeof CharacterPlanSchema>;

/** Gemini responseSchema for the structured character plan. */
export const CHARACTER_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    base_identity_prompt: {
      type: "object",
      properties: {
        subject: { type: "string" },
        archetype: { type: "string" },
        facial_features: { type: "string" },
        skin_rendering: { type: "string" },
        lips: { type: "string" },
        hair: { type: "string" },
        makeup: { type: "string" },
        wardrobe_register: { type: "string" },
        expression: { type: "string" },
        lighting: { type: "string" },
        realism: { type: "string" },
        negative_prompt: { type: "string" },
      },
      required: ["subject", "archetype", "facial_features", "skin_rendering", "expression", "negative_prompt"],
    },
    global_rules: {
      type: "object",
      properties: {
        style: { type: "string" },
        age_appearance: { type: "string" },
        height: { type: "string" },
        physique: { type: "string" },
        skin: { type: "string" },
        hair: { type: "string" },
        energy: { type: "string" },
        consistency_priority: { type: "array", items: { type: "string" } },
        avoid: { type: "array", items: { type: "string" } },
      },
    },
    shots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          identity_locked: { type: "boolean" },
          prompt: { type: "string", description: "Complete standalone image prompt for this shot." },
        },
        required: ["id", "prompt"],
      },
    },
  },
  required: ["base_identity_prompt", "shots"],
};

/**
 * System prompt: turns casting traits + a universal product/brand context into a
 * single strict-JSON character plan. Deliberately has NO vertical-specific branching
 * (no "if sports then athletic build" tables) — instead it instructs the LLM to
 * reason from product_context the way a human casting director reads a creative
 * brief, so the same prompt correctly casts a sports shoe, a skincare serum, a
 * fintech app, or a luxury watch without code-level special-casing per category.
 */
export const CHARACTER_SYSTEM_PROMPT = `You are a casting director and prompt-engineering engine for a brand video-ad pipeline. Given casting traits and a product/brand brief, you design ONE consistent, photorealistic persona who looks like she/he was ACTUALLY CAST FOR THIS PRODUCT — not a generic stock creator — and output it as a single STRICT JSON object that a downstream image model (Nano Banana Pro) will use as a casting reference.

INPUTS (provided at runtime; any field may be empty / "no preference"):
- ethnicity, gender, age_range
- additional_detail        (free-text styling notes, optional)
- product_context: { product, category, brand_adjectives, mood_direction, archetype_override }
- shot_count               (integer, default 2)

HARD OUTPUT RULES:
- Output ONLY the JSON object. No markdown, no code fences, no commentary, no trailing text.
- The JSON must match this shape exactly:
  { "base_identity_prompt": { subject, archetype, facial_features, skin_rendering, lips, hair, makeup, wardrobe_register, expression, lighting, realism, negative_prompt }, "global_rules": { style, age_appearance, height, physique, skin, hair, energy, consistency_priority[], avoid[] }, "shots": [ { id, type, identity_locked, prompt } ] }
- Every base_identity_prompt field is a single string of natural, comma-separated descriptive phrases. Do not invent extra keys.

STEP 1 — ARCHETYPE DERIVATION (do this FIRST, before writing any other field):
- If product_context.archetype_override is set, use it as-is.
- Otherwise, read product, category, brand_adjectives and mood_direction together and reason like a casting director: "Who would this brand actually put in front of the camera for this product?" Consider what build, energy, grooming/styling level, and setting the product category implicitly demands (e.g. a product used during physical activity implies an active, capable-looking body and alert energy; a precision or ritual product implies calm focus and clean styling; a product about ease or approachability implies warmth and relaxed styling — reason this out from the brief itself, don't rely on a fixed list).
- Write the result as a short archetype label (2-6 words) in the "archetype" field, e.g. "athletic performance creator", "calm skincare-ritual creator", "confident everyday fintech user". This label must directly justify every downstream choice below.
- If product_context is entirely empty, fall back to "relatable everyday content creator" as the archetype — that is the ONLY case where the generic default applies.

STEP 2 — IDENTITY (base_identity_prompt), generated ONCE and treated as locked:
- subject line logic: "A {ethnicity} {gender} {age_range}, {archetype}." Omit any trait left empty. Then expand with build/proportions/posture phrases that visibly support the archetype (physical build is not just wardrobe — a product implying physical activity should shape actual physique, not just clothing).
- wardrobe_register: the general styling world this person's outfit should come from (e.g. "technical athleisure, performance fabrics" / "minimal tailored, clean neutral palette" / "casual streetwear") — derived from archetype + brand_adjectives. This seeds every shot's wardrobe; specific garments/products are added per-shot later.
- expression: the DEFAULT baseline expression that matches the archetype's energy (e.g. alert and energized vs. composed and serene vs. warm and candid) — derived from archetype + mood_direction, not a fixed default.
- DISTINCTIVENESS IS CRITICAL — this persona must read as a SPECIFIC, real individual, not a generic stock model. Deliberately VARY: face shape (round / oval / square / heart / long), feature proportions (eye spacing, nose shape, lip fullness, brow shape, jawline, cheekbones), hairstyle + exact colour/texture/length, skin tone and undertone within the ethnicity, and overall build. Commit to ONE concrete distinguishing feature in facial_features (e.g. a small mole, light freckles across the nose, a beauty spot, a gap tooth, a sharp widow's peak, a nose stud, slight under-eye character) so the face is memorable and unique.
- Do NOT default to the "instagram default" / symmetrical beauty-influencer look unless the derived archetype specifically calls for that register. Two different product briefs must yield two clearly different-looking, differently-styled people.
- If a Persona / Persona context is provided, design a believable specific person AROUND it, filtered through the archetype — do not flatten it into a generic creator.
- Tailor facial_features, skin_rendering, lips, hair, makeup to the casting traits, the persona, the archetype, and additional_detail. Where a trait is unspecified, make a SPECIFIC distinctive choice consistent with the archetype (not a fixed default) so variety emerges across generations and across categories.
- Rendering register: realistic skin texture and pores, natural (not plastic) finish. Lighting/gloss level should match the archetype — e.g. soft candid daylight for an everyday-creator archetype, crisper more directional light for a performance or editorial archetype — rather than forcing every persona into the same soft-UGC look.
- lighting: derive from archetype + mood_direction; default to soft natural daylight only when nothing else suggests otherwise.
- realism: "ultra realistic high-end-smartphone + editorial hybrid" as the baseline, but let archetype push it toward more editorial polish (performance/luxury/beauty briefs) or stay closer to raw candid smartphone (everyday/relatable briefs).
- negative_prompt (string): always include, at minimum — more than one person, heavy makeup retouching, plastic/waxy skin, over-sharpened skin, beauty-filter artifacts, uncanny smoothing, oversaturated colors, distorted anatomy, any text/captions/watermarks/logos, sunglasses, hats covering the face, AI artifacts. Add archetype-specific negatives on top (e.g. an athletic archetype should also avoid "static/passive posing, studio glamour lighting"; a calm skincare archetype should avoid "high-energy action posing, harsh gym lighting") — reasoned from the SAME archetype, not a fixed list.

STEP 3 — GLOBAL RULES (consistency contract):
- style: derived from archetype (see realism guidance above), stated as a short label.
- age_appearance: derive a short range from age_range (e.g. age_range "in their 30s" -> "30-36"); if age_range is empty, use "adult, 20s-30s".
- height / physique / skin / hair: short natural descriptors consistent with the identity AND the archetype.
- energy: one short phrase capturing the baseline energy level shots should hold to (e.g. "alert, dynamic, capable" vs "composed, unhurried, focused" vs "warm, relaxed, candid") — this is what shot-writing in Step 4 must stay consistent with.
- consistency_priority: ordered list the image model must hold constant across shots, e.g. ["face shape","eye spacing","nose structure","lips","body proportions","shoulder width","waist-to-hip ratio"].
- avoid: base list ["dramatic styling shifts","fantasy fashion","exaggerated makeup","overprocessed skin","extreme lighting changes"] plus anything that would contradict the archetype's energy (e.g. don't let an athletic persona go slack/static, don't let a calm-ritual persona go hyper-energetic).

SHOTS:
- Produce exactly shot_count entries (default 2).
- shots[0] is the ANCHOR: id "anchor", upper-body framing, person looking directly at camera with the archetype's baseline "expression" (from Step 2) and "energy" (from Step 3), background and lighting consistent with the archetype and mood_direction, face clear, unobstructed and well-lit. This is the reference image.
- Every later shot is identity_locked = true and changes ONLY pose / head angle / setting details, while holding the SAME identity, the SAME expression family and energy, the SAME lighting register, and the SAME wardrobe_register as the anchor (the downstream model drifts identity when the reference shots differ in expression or lighting, so keep them a clean consistency pair).
- Default second shot: a slight three-quarter angle or a small pose variation appropriate to the archetype (e.g. a mid-motion moment for an active archetype, a hands-with-product moment for a ritual/beauty archetype), still holding identity, expression family and lighting constant. If product_context.product is set, this and any further shots should show the person genuinely using/wearing/holding that product in a setting that fits mood_direction — not a bare studio background by default. If more shots are requested, keep escalating naturalness and specificity (setting, interaction with product) while never contradicting the locked identity or energy. Never add text, logos, or anything covering the face.
- Each shots[].prompt must be a complete, standalone image prompt and must restate: ONE real person only, photorealistic, realistic skin texture, face clear and well-lit, casting reference for a video ad, plus the shot's specific background/lighting/wardrobe consistent with the locked identity. For identity-locked shots, the prompt must instruct the model to reproduce the EXACT same person from the reference image (identical face, hair, skin tone, eye colour, age) and to change nothing but the stated pose/angle/setting/product-interaction.

Return the JSON now.`;

/**
 * Leading directive used when the request includes REFERENCE IMAGES (Instagram
 * posts). Sits before the reference images in the user parts; instructs the model
 * to transfer the references' aesthetic + creator archetype onto a NEW person.
 */
export const CHARACTER_REFERENCES_DIRECTIVE =
  "You are given REFERENCE IMAGES (Instagram posts) that define the desired look. Derive TWO things from them: " +
  "(a) the AESTHETIC — color palette, lighting style, film/grain, contrast, mood and composition; and " +
  "(b) the CREATOR ARCHETYPE — apparent age, build, hair, skin, wardrobe/styling and distinctive features " +
  "(tattoos, piercings, glasses, freckles, etc.). " +
  "Design a NEW, distinct individual that FITS this aesthetic and archetype — match the vibe, palette, lighting " +
  "and styling closely — but DO NOT copy any real person's exact face; the generated creator must be a clearly " +
  "different, new person. Bake the aesthetic + lighting into base_identity_prompt (skin_rendering, lighting, " +
  "makeup, hair, realism) and into EVERY shot's prompt so the rendered creator visibly carries the references' look. " +
  "The reference images follow.";

/** Build the user message (casting traits + product/brand context) for the structured character prompt. */
export function buildCharacterUserMessage(
  traits: CharacterTraits,
  details: string,
  shotCount: number,
  opts?: {
    personaSeed?: number;
    personaName?: string;
    personaContext?: string;
    productContext?: ProductContext;
  },
): string {
  const v = (s?: string) => (s && s.trim() ? s.trim() : "no preference");
  const lines = [
    "CASTING TRAITS:",
    `- ethnicity: ${v(traits.ethnicity)}`,
    `- gender: ${v(traits.gender)}`,
    `- age_range: ${v(traits.ageRange)}`,
    `- skin_tone: ${v(traits.skinTone)}`,
    `- hair: ${v(traits.hair)}`,
    `- eyes: ${v(traits.eyes)}`,
    `- distinguishing_mark: ${v(traits.distinguishingMark)}`,
    `- build: ${v(traits.build)}`,
    `- additional_detail: ${details.trim() || "(none)"}`,
    `- shot_count: ${shotCount}`,
  ];

  const pc = opts?.productContext;
  if (pc && (pc.product?.trim() || pc.category?.trim() || pc.brandAdjectives?.trim() || pc.moodDirection?.trim() || pc.archetypeOverride?.trim())) {
    lines.push(
      "",
      "PRODUCT_CONTEXT (use this to derive the casting archetype per STEP 1 — do not ignore):",
      `- product: ${v(pc.product)}`,
      `- category: ${v(pc.category)}`,
      `- brand_adjectives: ${v(pc.brandAdjectives)}`,
      `- mood_direction: ${v(pc.moodDirection)}`,
      `- archetype_override: ${v(pc.archetypeOverride)}`,
    );
  }

  if (opts?.personaName?.trim()) lines.push("", `- persona: ${opts.personaName.trim()}`);
  if (opts?.personaContext?.trim()) lines.push(`- persona_context: ${opts.personaContext.trim()}`);
  if (typeof opts?.personaSeed === "number") {
    lines.push(
      `- variation_token: ${opts.personaSeed} — use this to design a DISTINCT, specific individual; do NOT reuse a generic average face. A different token must yield a clearly different-looking person.`,
    );
  }
  lines.push("", "Derive the archetype from PRODUCT_CONTEXT first, then design the persona, then return the JSON now.");
  return lines.join("\n");
}

/**
 * Build the v2 portrait subject line from the full trait set (§2/§3):
 *   A {ethnicity} {gender} {age}{, skin}{, hair}{, eyes}{, mark}, a relatable everyday content creator.
 * Any blank trait is omitted; an all-blank set falls back to the generic creator.
 */
export function buildPortraitSubject(traits: CharacterTraits): string {
  const lead = [traits.ethnicity, traits.gender, traits.ageRange].map(t => (t ?? "").trim()).filter(Boolean);
  const extra = [traits.skinTone, traits.hair, traits.eyes, traits.distinguishingMark]
    .map(t => (t ?? "").trim()).filter(Boolean);
  if (!lead.length && !extra.length) return "A relatable everyday content creator.";
  const head = lead.length ? `A ${lead.join(" ")}` : "A person";
  const tail = extra.length ? `, ${extra.join(", ")}` : "";
  return `${head}${tail}, a relatable everyday content creator.`;
}

/** Compose the full Nano Banana Pro prompt for a character portrait (v2 deterministic). */
export function buildCharacterPrompt(traits: CharacterTraits, details?: string): string {
  const subject = buildPortraitSubject(traits);
  const extra = (details ?? "").trim();
  const extraLine = extra ? `\n\nAdditional detail: ${extra}` : "";
  return `${PORTRAIT_BASE}\n\nSubject: ${subject}${extraLine}\n\n${PORTRAIT_NEGATIVES}`;
}

/**
 * Subject line for an animated character — same trait composition as the real-person
 * portrait but described as a designed character rather than a photographed person.
 */
export function buildAnimatedPortraitSubject(traits: CharacterTraits): string {
  const lead = [traits.ethnicity, traits.gender, traits.ageRange].map(t => (t ?? "").trim()).filter(Boolean);
  const extra = [traits.hair, traits.eyes, traits.distinguishingMark, traits.build]
    .map(t => (t ?? "").trim()).filter(Boolean);
  const head = lead.length ? `A ${lead.join(" ")} character` : "A character";
  const tail = extra.length ? `, ${extra.join(", ")}` : "";
  return `${head}${tail}, friendly and expressive as a brand mascot / creator.`;
}

/**
 * Compose the Nano Banana Pro prompt for an ANIMATED character portrait. `animatedStyle`
 * is a phrase from ANIMATED_STYLE_OPTIONS (empty → let the model pick a clean style).
 * Kept photoreal-free on purpose so the render reads as illustration, not a person.
 */
export function buildAnimatedCharacterPrompt(traits: CharacterTraits, details?: string, animatedStyle?: string): string {
  const style = (animatedStyle ?? "").trim() || "a clean, appealing animated character style";
  const subject = buildAnimatedPortraitSubject(traits);
  const extra = (details ?? "").trim();
  const extraLine = extra ? `\n\nAdditional detail: ${extra}` : "";
  return (
    `${style}. Upper-body character portrait of ONE animated character, facing the camera with a warm, ` +
    `expressive look, simple clean background, consistent character design suitable as a reusable brand creator/mascot reference.` +
    `\n\nSubject: ${subject}${extraLine}` +
    `\n\nAvoid: more than one character, photorealistic render, style drift, any text, captions, watermarks or logos, AI artifacts, distorted anatomy.`
  );
}

// ───────────────────────────────────────────────────────────────────────────
// PRODUCTION MODE (§5/§6) — structured shots for product / garment / lifestyle,
// serialized to the flattened text prompt these image models actually read.
// ───────────────────────────────────────────────────────────────────────────

/** Camera & lens vocabulary (§6) — concrete language beats "professional photo". */
export const CAMERA_LENS = {
  lens: {
    portrait: "85mm f/1.8, portrait compression, shallow depth of field",
    product: "50mm f/4, natural product shot",
    lifestyle: "35mm f/2.8, environmental, more background visible",
  },
  finish: "fine grain, editorial, visible skin pores",
  depthCue: "subject sharply in focus, background softly diffused",
} as const;

/** Static negatives every production shot appends after its contextual ones (§5e). */
export const PRODUCTION_STATIC_NEGATIVES = [
  "more than one person", "watermark", "text", "logo", "AI artifacts",
  "plastic skin", "mannequin crease lines", "pasted or composite look",
];

/** Flatten the locked identity traits into one comma string (§5a locked_traits). */
export function buildLockedTraits(traits: CharacterTraits): string {
  return [traits.ageRange, traits.ethnicity, traits.gender, traits.build, traits.skinTone, traits.hair, traits.eyes, traits.distinguishingMark]
    .map(t => (t ?? "").trim()).filter(Boolean).join(", ");
}

export interface ProductionGlobal {
  background?: string;
  crop?: string;
  fabric_instruction?: string;
  pose_rule?: string;
  /**
   * Short archetype/energy phrase carried over from the identity stage (e.g.
   * "dynamic athletic energy, action-ready stance" or "calm ritual energy, soft
   * unhurried movement"). Ensures manually-authored production shots stay on-brand
   * even if the caller's own pose/framing text forgets to say so.
   */
  archetype_cue?: string;
}

export interface ProductionShotInput {
  id?: string;
  /** Garment / product description worn or held. */
  product?: string;
  /** Pose + framing description (state the emotional/action intent — §5d). */
  pose?: string;
  framing?: string;
  /** Lighting descriptors (Kelvin when continuity matters — §5c). */
  lighting?: string;
  /** "portrait" | "product" | "lifestyle" → a CAMERA_LENS preset. */
  lens?: keyof typeof CAMERA_LENS.lens;
  /** Contextual negatives derived from this shot's positive claims (§5e). */
  negatives?: string[];
}

/**
 * Serialize a production shot into the flattened wire prompt (§5f order):
 * locked_traits → product → pose/framing → lighting → background → camera/lens →
 * "Avoid:" (contextual + static negatives). The token opens the prompt so the shot
 * is self-describing even out of context (§4a).
 */
export function serializeProductionShot(
  token: string,
  lockedTraits: string,
  global: ProductionGlobal,
  shot: ProductionShotInput,
): string {
  const lens = CAMERA_LENS.lens[shot.lens ?? "product"];
  const parts = [
    `${token}, ${lockedTraits}`.replace(/, $/, ""),
    shot.product?.trim(),
    global.archetype_cue?.trim(),
    [shot.pose?.trim(), shot.framing?.trim(), global.pose_rule?.trim()].filter(Boolean).join(". "),
    shot.lighting?.trim(),
    global.background ? `Background: ${global.background.trim()}.` : "",
    global.crop ? `Crop: ${global.crop.trim()}.` : "",
    global.fabric_instruction?.trim(),
    `${lens}, ${CAMERA_LENS.finish}, ${CAMERA_LENS.depthCue}`,
  ].filter(Boolean);
  const negatives = [...(shot.negatives ?? []).map(n => n.trim()).filter(Boolean), ...PRODUCTION_STATIC_NEGATIVES];
  return `${parts.join(". ")}. Avoid: ${negatives.join(", ")}.`;
}
