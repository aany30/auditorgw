/**
 * UGC New — pipeline prompts & constants, ported verbatim from the ugc-video-pipeline
 * architecture (research → brief → script → persona → voice → video). These are the
 * exact prompts that drive each stage's generation; keep them intact.
 */

// ── Pipeline constants (single source of truth for length/aspect) ────────────
export const TARGET_VIDEO_SECONDS = 30;          // ad length; Seedance 2.5 ref supports up to 30s
export const TARGET_ASPECT_RATIO = "9:16" as const;
export const MAX_REFERENCE_AUDIO_SECONDS = 15;   // both video models 422 past this
export const WORDS_PER_SECOND = 1.9;             // measured (eleven_v3)
export const SPEECH_HEADROOM_SECONDS = 1.5;
export const SPEECH_TARGET_SECONDS = TARGET_VIDEO_SECONDS - SPEECH_HEADROOM_SECONDS; // 13.5
export const SCRIPT_WORD_BUDGET = Math.floor(SPEECH_TARGET_SECONDS * WORDS_PER_SECOND);        // 25
export const SCRIPT_WORD_FLOOR = Math.floor((SPEECH_TARGET_SECONDS - 3) * WORDS_PER_SECOND);   // 19
// 4 by default — the staged studio casts a 4-up persona grid (its own step, decoupled
// from the render, so the ARK burst no longer competes with the video). Portraits are
// Seedream 5 Pro on ARK; arkFetch retries ride out any throttle and any that still fail
// render as a "portrait failed" card. Tunable via UGC_PERSONA_COUNT.
export const PERSONA_COUNT = Math.max(1, Math.min(4, Number(process.env.UGC_PERSONA_COUNT) || 4));
export const MIN_PRODUCT_IMAGES = 2;
export const MAX_PRODUCT_IMAGES = 3;
export const DEFAULT_TIME_OF_DAY = "18:00";
export const QC_PASS_THRESHOLD = 60;

// ── Stage 0 — INTAKE ─────────────────────────────────────────────────────────
export const INTAKE_SYSTEM = `You are onboarding a new UGC ad campaign from whatever material the user happened to have. Extract:
audienceLabel: a short phrase naming who this is for (max 12 words).
audienceDescription: 2-4 sentences on that audience — their situation, what they already believe, what they want.
productDescription: what the product is, its key specs, format and price if stated.
otherInfo: constraints that should govern the creative — tone of voice, banned words, mandatory or prohibited claims, brand assets that must appear. This is where compliance rules belong.
missing: names of any of the above you had to invent or could not determine, so the user knows to check them.
Only use what is actually in the material. Do not invent specifics like prices or ingredients — if a field cannot be filled from the source, write a short neutral placeholder and list that field in \`missing\`.`;

export function intakeUser(opts: { pastedText?: string; productUrl?: string; imageCount?: number; hasPdf?: boolean }): string {
  return [
    opts.pastedText ? `Pasted material:\n${opts.pastedText}` : null,
    opts.productUrl ? `Product URL: ${opts.productUrl}` : null,
    typeof opts.imageCount === "number" ? `Product images provided: ${opts.imageCount}` : null,
    opts.hasPdf ? "A PDF is attached — treat it as the most authoritative source." : null,
  ].filter(Boolean).join("\n\n");
}

// ── Stage 1 — SEARCH QUERIES + BRIEF ─────────────────────────────────────────
export const SEARCH_QUERY_SYSTEM = `You turn a product description into short web-search queries. Each query must be at most 8 words, keyword-style, no punctuation, no brand names that were invented for this product (search the category, not the brand). competitorQuery finds competing products; adStyleQuery finds UGC/social ad examples in this category.`;

export const BRIEF_SYSTEM = `You are a creative strategist synthesizing product research into a concise creative brief for a UGC ad campaign. Cover: what the product is, who it's for, the key selling point, tone/style cues drawn from competitor UGC ad examples, and one differentiator. Keep it under 250 words, plain prose, no headers. Write the brief itself only — no preamble like "Here's a creative brief".`;

export function briefUser(opts: {
  productDescription: string; otherInfo?: string; productUrl?: string;
  imageCount?: number; researchNotes: string; hasPdf?: boolean; steering?: string;
}): string {
  return [
    `Product details: ${opts.productDescription}`,
    `Other info: ${opts.otherInfo || "none"}`,
    `Product URL: ${opts.productUrl ?? "none"}`,
    `Reference product images provided: ${opts.imageCount ?? 0}`,
    `Market research:\n${opts.researchNotes}`,
    opts.hasPdf ? "A product spec sheet / brand deck PDF is attached — factor it in too." : null,
    opts.steering ? `IMPORTANT user direction — follow this closely: ${opts.steering}` : null,
  ].filter(Boolean).join("\n\n");
}

// ── Stage 2 — SCRIPT (3 angles) ──────────────────────────────────────────────
export const SCRIPT_ANGLES = [
  { id: "punchy", label: "Punchy", instruction: "High-energy and punchy — hook in the first line, fast pacing, exclamation-worthy enthusiasm." },
  { id: "story-driven", label: "Story-driven", instruction: "Story-driven — open with a relatable problem/before-state, then the product as the turning point, personal and reflective tone." },
  { id: "direct-benefit", label: "Direct benefit", instruction: "Direct and benefit-led — calm, confident, straight to what the product does and why it matters, minimal fluff." },
] as const;
export type ScriptAngle = (typeof SCRIPT_ANGLES)[number]["id"];

export function scriptSystem(instruction: string): string {
  return `You write UGC (user-generated-content style) ad scripts for social video. LENGTH: ${SCRIPT_WORD_FLOOR}-${SCRIPT_WORD_BUDGET} words. This is spoken aloud over a ${TARGET_VIDEO_SECONDS}-second clip at roughly ${WORDS_PER_SECOND} words per second. Fewer than ${SCRIPT_WORD_FLOOR} words leaves dead air on screen and is a failed script; more than ${SCRIPT_WORD_BUDGET} gets cut off mid-sentence. Use the full time. Write in short sentences of 4-8 words each. Never one long run-on. Output ONLY the spoken words: no title, no preamble, no shot directions, no stage notes in brackets, no markdown, no word count. Casual first-person tone, one clear hook, then land the benefit. Creative angle for this script: ${instruction}`;
}

export function scriptUser(opts: { brief: string; audienceLabel: string; audienceDescription: string; ageRange?: string; interests?: string }): string {
  return `Creative brief: ${opts.brief}\n\nTarget audience — Label: ${opts.audienceLabel}. Description: ${opts.audienceDescription}. Age range: ${opts.ageRange ?? "unspecified"}. Interests: ${opts.interests || "unspecified"}.\n\nWrite the spoken script only, ${SCRIPT_WORD_FLOOR}-${SCRIPT_WORD_BUDGET} words — aim for ${SCRIPT_WORD_BUDGET}.`;
}

// ── Stage 3 — PERSONA + PORTRAIT + IMAGE QC ──────────────────────────────────
export const PERSONA_SYSTEM = `You invent UGC (user-generated-content style) creator personas for ad videos. The persona must fit the voice and scenario of the given script — someone who could plausibly be the one saying these lines. Respond with ONLY a JSON array like [{"name":"...","description":"..."}] — no prose, no markdown fences. Use realistic human names. Each description should cover appearance, personality, and speaking style in 1-2 sentences.`;

export function personaUser(opts: { audienceLabel: string; audienceDescription: string; ageRange?: string; interests?: string; scriptAngle: string; scriptContent: string }): string {
  return `Generate exactly ${PERSONA_COUNT} distinct personas for this target audience:\nLabel: ${opts.audienceLabel}\nDescription: ${opts.audienceDescription}\nAge range: ${opts.ageRange ?? "unspecified"}\nInterests: ${opts.interests || "unspecified"}\n\nSelected script (${opts.scriptAngle} angle) they need to deliver:\n${opts.scriptContent}`;
}

export function portraitPrompt(persona: { name: string; description: string }): string {
  return `Photorealistic UGC-style selfie/portrait of ${persona.name}: ${persona.description}. Naturally holding or using the product shown in the reference images. Casual smartphone-camera lighting and framing, authentic user-generated-content ad aesthetic, not studio/commercial polish.`;
}

export const IMAGE_QC_SYSTEM = `You are a strict quality checker for AI-generated UGC ad imagery. Judge only what is actually visible. productVisible: is the described product clearly present and recognisable? faceUsable: is there exactly one clear, undistorted human face suitable for animating into a talking-head video (false if the face is cropped, deformed, has wrong anatomy, or multiple people compete for focus)? score: 0-100 overall usability for a social ad. notes: one short sentence naming the single biggest problem, or 'looks good' if there is none. Be conservative — a plausible-looking but flawed image should not score highly.`;

export function imageQcUser(productDescription: string, personaDescription: string): string {
  return `Product that should appear: ${productDescription}\n\nIntended persona: ${personaDescription}`;
}

// ── Stage 4 — VOICE TRAITS ───────────────────────────────────────────────────
export const VOICE_TRAITS_SYSTEM = `Infer how this UGC creator persona would sound. ageBracket maps to ElevenLabs buckets: young (18-30), middle_aged (30-55), old (55+). descriptors: 3-5 single tone words drawn from the vocabulary voice libraries actually use (warm, calm, confident, energetic, raspy, smooth, casual, professional, gentle, upbeat). preferredUseCase: how the read should function. Use null where genuinely unsure rather than guessing.`;

export function voiceTraitsUser(persona: { name: string; description: string }): string {
  return `Name: ${persona.name}\nDescription: ${persona.description}`;
}

// ── Stage 5 — VIDEO PROMPT ───────────────────────────────────────────────────
// The prompt MUST cite the numbered asset pool or the model ignores the inputs.
export const REFERENCE_TOKENS = {
  seedance: { image: "@Image1", audio: "@Audio1" },
  hailuo: { image: "Image 1", audio: "Audio 1" },
} as const;

/** Lighting phrase from a "HH:MM" time-of-day. */
export function describeTimeOfDay(time: string): string {
  const hour = parseInt(time.split(":")[0] ?? "18", 10);
  if (hour < 6) return "night, moody low light";
  if (hour < 9) return "early morning, soft cool light";
  if (hour < 12) return "late morning, bright natural light";
  if (hour < 16) return "afternoon, flat even daylight";
  if (hour < 19) return "early evening, warm golden-hour light";
  return "evening, warm indoor light";
}

/** Build the reference-to-video prompt for a provider (never quotes the script — it arrives as audio). */
export function buildVideoPrompt(opts: {
  provider: "seedance" | "hailuo";
  characterName?: string; characterDescription: string;
  hasPortrait: boolean; hasVoiceover: boolean; scriptContent: string; timeOfDay: string;
}): string {
  const t = REFERENCE_TOKENS[opts.provider];
  const lighting = describeTimeOfDay(opts.timeOfDay);
  const character = opts.characterName ? `${opts.characterName} — ${opts.characterDescription}` : opts.characterDescription;
  const subject = opts.hasPortrait ? `The speaker is the person in ${t.image}: ${character}.` : `The speaker: ${character}.`;
  const speak = opts.hasVoiceover
    ? `The speaker speaks the words in ${t.audio}, lip-synced exactly to that audio, talking straight to camera at a natural conversational pace.`
    : `The speaker talks straight to camera and delivers this script ONCE, word for word, at a natural conversational pace — spread evenly across the entire clip from start to finish, lip-synced. Do not repeat, loop, echo or pad any words; do not re-say lines to fill time; when the script ends, stop speaking. Script: "${opts.scriptContent}"`;
  return [
    subject,
    `Selfie-style UGC ad video, handheld smartphone framing, ${lighting}.`,
    speak,
    "Natural micro-expressions and small head movement; no captions or on-screen text.",
  ].filter(Boolean).join(" ");
}
