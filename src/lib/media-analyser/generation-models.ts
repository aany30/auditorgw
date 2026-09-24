/**
 * Generation model registry — single source of truth for the user-selectable
 * image and video models surfaced on every creative-generation surface.
 *
 * Routes validate an incoming model id against this registry; unknown or
 * disabled ids fall back to the default entry rather than hitting a bogus FAL
 * endpoint. Mirrors the normalize-with-default pattern in
 * scraper/services/ecomAgent/modelConfig.ts but is self-contained.
 */

export type ImageModelId = "nano-banana-pro" | "nano-banana-2" | "seedream-5-lite" | "seedream-5-pro" | "gpt-image-1";
export type VideoModelId = "seedance-2-5" | "seedance-2" | "veo-3" | "kling-2";

export interface ImageModelEntry {
  id: ImageModelId;
  label: string;
  falModelId: string;
  isDefault: boolean;
}

export type VideoDurationFormat = "string-seconds" | "number-seconds" | "enum-bucket";

export interface VideoModelEntry {
  id: VideoModelId;
  label: string;
  /** image-to-video endpoint */
  i2vFalModelId: string;
  /** reference-to-video endpoint (multi-image); only Seedance today */
  refFalModelId?: string;
  isDefault: boolean;
  supportsReferenceToVideo: boolean;
  supportsEndFrame: boolean;
  supportsAudio: boolean;
  durationFormat: VideoDurationFormat;
  /** clamp window [min, max] in seconds */
  durationRange: [number, number];
  /** max seconds the reference-to-video endpoint accepts (often longer than i2v); defaults to durationRange[1] */
  refDurationMax?: number;
  /** discrete durations a model accepts (enum-bucket models only) */
  allowedDurations?: number[];
}

// ─── Image models ────────────────────────────────────────────────────────────

export const IMAGE_MODELS: ImageModelEntry[] = [
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    falModelId: "fal-ai/nano-banana-pro/edit",
    // Default: proven edit endpoint on this FAL account + the fallback target in
    // editWithNanoBananaPro. (The Seedream v5 slugs 404, so it can't be the default.)
    isDefault: true,
  },
  {
    id: "nano-banana-2",
    label: "Nano Banana 2",
    falModelId: "fal-ai/nano-banana-2/edit",
    isDefault: false,
  },
  {
    // ByteDance Seedream edit — multi-image (up to 10) reference editing.
    // NOTE: the `v5/lite/edit` + `v5/pro/edit` slugs 404 on this FAL account, so both
    // Seedream options point at the proven `v4/edit` endpoint. editWithNanoBananaPro
    // additionally falls back to Nano Banana Pro if any edit endpoint fails.
    id: "seedream-5-lite",
    label: "Seedream 5 Lite",
    falModelId: "fal-ai/bytedance/seedream/v4/edit",
    isDefault: false,
  },
  {
    id: "seedream-5-pro",
    label: "Seedream 5 Pro",
    falModelId: "fal-ai/bytedance/seedream/v4/edit",
    isDefault: false,
  },
  {
    // OpenAI GPT Image edit — input_fidelity:"high" preserves the product.
    id: "gpt-image-1",
    label: "GPT Image",
    falModelId: "fal-ai/gpt-image-1/edit-image",
    isDefault: false,
  },
  // NOTE: Reve (fal-ai/reve/*) is intentionally omitted — the configured FAL key
  // cannot access the "reve" application (both fal.run and queue.fal.run return
  // "Application 'reve' not found"), so exposing it would be a broken option.
];

// ─── Video models ────────────────────────────────────────────────────────────

export const VIDEO_MODELS: VideoModelEntry[] = [
  {
    // ByteDance Seedance 2.5 — native up to 30s, joint audio+video (better lip-sync),
    // ~20% better prompt adherence. i2v aspect is "auto" only; resolution 480p/720p.
    // Docs: https://fal.ai/models/bytedance/seedance-2.5/image-to-video
    id: "seedance-2-5",
    label: "Seedance 2.5",
    i2vFalModelId: "bytedance/seedance-2.5/image-to-video",
    refFalModelId: "bytedance/seedance-2.5/reference-to-video",
    isDefault: true,
    supportsReferenceToVideo: true,
    supportsEndFrame: true,
    supportsAudio: true,
    durationFormat: "string-seconds",
    durationRange: [4, 30],
    refDurationMax: 30,   // 2.5 renders a native clip up to 30s
  },
  {
    id: "seedance-2",
    label: "Seedance 2.0",
    i2vFalModelId: "bytedance/seedance-2.0/image-to-video",
    refFalModelId: "bytedance/seedance-2.0/reference-to-video",
    isDefault: false,
    supportsReferenceToVideo: true,
    supportsEndFrame: true,
    supportsAudio: true,
    durationFormat: "string-seconds",
    durationRange: [4, 10],  // i2v caps at 10s
    refDurationMax: 15,      // ref-to-video accepts up to 15s
  },
  {
    id: "veo-3",
    label: "Veo 3",
    // VERIFY: FAL docs — exact slug + i2v support for this FAL account.
    i2vFalModelId: "fal-ai/veo3/image-to-video",
    isDefault: false,
    supportsReferenceToVideo: false,
    supportsEndFrame: false,
    supportsAudio: true,
    durationFormat: "enum-bucket",
    durationRange: [8, 8],
    allowedDurations: [8],
  },
  {
    id: "kling-2",
    label: "Kling 2.x",
    // VERIFY: FAL docs — exact tier/version slug (v2.1 vs v2.5, standard vs pro).
    i2vFalModelId: "fal-ai/kling-video/v2.1/standard/image-to-video",
    isDefault: false,
    supportsReferenceToVideo: false,
    supportsEndFrame: true,
    supportsAudio: false,
    durationFormat: "enum-bucket",
    durationRange: [5, 10],
    allowedDurations: [5, 10],
  },
];

export const DEFAULT_IMAGE_MODEL: ImageModelEntry =
  IMAGE_MODELS.find(m => m.isDefault) ?? IMAGE_MODELS[0];
export const DEFAULT_VIDEO_MODEL: VideoModelEntry =
  VIDEO_MODELS.find(m => m.isDefault) ?? VIDEO_MODELS[0];

export const DEFAULT_IMAGE_MODEL_ID = DEFAULT_IMAGE_MODEL.id;
export const DEFAULT_VIDEO_MODEL_ID = DEFAULT_VIDEO_MODEL.id;

// ─── Normalisation (validate + fall back to default) ───────────────────────────

function canon(id: unknown): string {
  // Also fold dots so "seedance-2.5" and "seedance-2-5" resolve to the same entry.
  return String(id ?? "").trim().toLowerCase().replace(/[-.\s/]+/g, "_");
}

/** Resolve any incoming image-model id to a known entry, defaulting on unknown. */
export function normalizeImageModel(id: unknown): ImageModelEntry {
  const c = canon(id);
  return IMAGE_MODELS.find(m => canon(m.id) === c) ?? DEFAULT_IMAGE_MODEL;
}

/** Resolve any incoming video-model id to a known entry, defaulting on unknown. */
export function normalizeVideoModel(id: unknown): VideoModelEntry {
  const c = canon(id);
  return VIDEO_MODELS.find(m => canon(m.id) === c) ?? DEFAULT_VIDEO_MODEL;
}

/** Clamp/snap a requested duration (seconds) to what a video model accepts. */
export function resolveVideoDuration(entry: VideoModelEntry, durationSec?: number): number {
  const [min, max] = entry.durationRange;
  const want = Math.round(durationSec ?? max);
  if (entry.durationFormat === "enum-bucket" && entry.allowedDurations?.length) {
    return entry.allowedDurations.reduce((best, d) =>
      Math.abs(d - want) < Math.abs(best - want) ? d : best,
    entry.allowedDurations[0]);
  }
  return Math.max(min, Math.min(max, want));
}

// ─── ElevenLabs voices (via FAL) ────────────────────────────────────────────
// The ElevenLabs voice is auto-selected from the chosen language/accent + the
// script's voice_characteristics (gender). `id` is the value sent to FAL's
// ElevenLabs TTS `voice` field; the multilingual model handles non-English scripts.
// `accents` tags which language/accent buckets a voice best fits.
// VERIFY: for a truly native Hindi/Indian accent, add an Indian-accent voice id here
// and tag it "indian" — the default set below leans neutral/US/UK/AU.
export interface ElevenVoiceEntry { id: string; label: string; gender: "female" | "male"; accents: string[] }

export const ELEVENLABS_VOICES: ElevenVoiceEntry[] = [
  { id: "Aria", label: "Aria (F)", gender: "female", accents: ["neutral", "american"] },
  { id: "Rachel", label: "Rachel (F)", gender: "female", accents: ["neutral", "american"] },
  { id: "Sarah", label: "Sarah (F)", gender: "female", accents: ["neutral", "american"] },
  { id: "Alice", label: "Alice (F)", gender: "female", accents: ["british"] },
  { id: "Lily", label: "Lily (F)", gender: "female", accents: ["british"] },
  { id: "Adam", label: "Adam (M)", gender: "male", accents: ["neutral", "american"] },
  { id: "Bill", label: "Bill (M)", gender: "male", accents: ["neutral", "american"] },
  { id: "George", label: "George (M)", gender: "male", accents: ["british"] },
  { id: "Charlie", label: "Charlie (M)", gender: "male", accents: ["australian"] },
];

export const DEFAULT_ELEVEN_VOICE = ELEVENLABS_VOICES[0].id;

/** Infer gender from the plan's voice_characteristics (default female). */
function elevenGender(desc: string): "female" | "male" {
  const d = desc.toLowerCase();
  if (/\b(female|woman|women|she|her|girl|feminine)\b/.test(d)) return "female";
  if (/\b(male|man|men|he|his|him|guy|masculine)\b/.test(d)) return "male";
  return "female";
}

/** Map the language/accent dropdown value to a voice accent bucket. */
function elevenAccentBucket(language: string): string {
  const l = language.toLowerCase();
  if (l.includes("british")) return "british";
  if (l.includes("australian")) return "australian";
  if (l.includes("american")) return "american";
  // Indian / Punjabi / Tamil / Hindi / Hinglish / Spanish / Arabic / neutral / "" →
  // no dedicated accent voice yet, so use a neutral multilingual voice.
  return "neutral";
}

/**
 * Auto-pick the ElevenLabs voice from the chosen language/accent + the script's
 * voice description (gender). No manual picker — matches (gender × accent), then
 * degrades to gender-only, then the default.
 */
export function resolveElevenVoice(language: string, voiceCharacteristics: string): string {
  const gender = elevenGender(voiceCharacteristics ?? "");
  const bucket = elevenAccentBucket(language ?? "");
  return (
    ELEVENLABS_VOICES.find(v => v.gender === gender && v.accents.includes(bucket)) ??
    ELEVENLABS_VOICES.find(v => v.gender === gender && v.accents.includes("neutral")) ??
    ELEVENLABS_VOICES.find(v => v.gender === gender) ??
    ELEVENLABS_VOICES[0]
  ).id;
}
