/**
 * Model config for Ecom Agent creative generation.
 * Defines fal.ai model IDs, cost helpers, and payload builders.
 * CF Worker compatible — no Node.js APIs.
 */

// ─── Model identifiers ─────────────────────────────────────────────────────────

export const MODEL_STANDARD = 'tz_standard' as const;
export const MODEL_PRECISE  = 'tz_precise'  as const;
export const DEFAULT_MODEL  = MODEL_STANDARD;
export const VALID_MODELS   = new Set([MODEL_STANDARD, MODEL_PRECISE]);

// fal.ai model IDs (used in API calls)
export const FAL_NANO_BANANA  = 'fal-ai/nano-banana-2/edit'  as const;
export const FAL_GPT_IMAGE    = 'openai/gpt-image-2/edit'     as const;

// Pricing (USD per image — raw fal cost before margin)
export const STANDARD_COST_PER_IMAGE = 0.175;
export const PRECISE_COST_LISTING    = 0.22;
export const PRECISE_COST_APLUS      = 0.16;
export const MARGIN_MULTIPLIER       = 1.25;
export const CREDITS_PER_USD         = 20;

// Negative prompt base — added to all nano-banana-2 calls
export const BASE_NEGATIVE =
  'human face, facial features, visible face, nudity, semi-nude, naked, underwear, swimwear';

// ─── Model normalisation ───────────────────────────────────────────────────────

export function normalizeModel(modelId: string | null | undefined): string {
  if (!modelId) return DEFAULT_MODEL;
  const m = String(modelId).trim().toLowerCase()
    .replace(/-/g, '_').replace(/ /g, '_').replace(/\//g, '_');
  if (VALID_MODELS.has(m as any)) return m;
  if (['standard', 'nano_banana', 'nano_banana_2', 'nanobanana', 'fal_ai_nano_banana_2_edit'].includes(m)) return MODEL_STANDARD;
  if (['precise', 'gpt_image', 'gpt_image_2', 'gptimage', 'openai', 'openai_gpt_image_2_edit'].includes(m)) return MODEL_PRECISE;
  return DEFAULT_MODEL;
}

/** Convert fal model string to internal model key */
export function falModelToKey(falModelId: string): string {
  if (falModelId === FAL_NANO_BANANA) return MODEL_STANDARD;
  if (falModelId === FAL_GPT_IMAGE)   return MODEL_PRECISE;
  return normalizeModel(falModelId);
}

// ─── Pricing ───────────────────────────────────────────────────────────────────

export function imageCostUsd(modelKey: string, imageType: 'listing' | 'aplus'): number {
  const m = normalizeModel(modelKey);
  if (m === MODEL_PRECISE) return imageType === 'aplus' ? PRECISE_COST_APLUS : PRECISE_COST_LISTING;
  return STANDARD_COST_PER_IMAGE;
}

export interface PackCostResult {
  model:            string;
  raw_usd:          number;
  with_margin_usd:  number;
  credits:          number;
  per_image_breakdown: {
    listing_per_image: number;
    aplus_per_image:   number;
    listing_count:     number;
    aplus_count:       number;
  };
}

/** Calculate total pack cost including margin */
export function packCostUsd(
  modelId: string,
  numListing = 7,
  numAplus   = 5,
  includeCopy = false,
): PackCostResult {
  const m = normalizeModel(modelId);
  const perListing = imageCostUsd(m, 'listing');
  const perAplus   = imageCostUsd(m, 'aplus');
  const imageCost  = numListing * perListing + numAplus * perAplus;
  const totalImages = numListing + numAplus;
  const promptCost = totalImages * 0.02;  // LLM prompt generation cost
  const blsCost    = 0.01;               // BLS extraction
  const visionCost = 0.03;               // Vision call
  const copyCost   = includeCopy ? 0.02 : 0;
  const raw        = imageCost + promptCost + blsCost + visionCost + copyCost;
  const withMargin = raw * MARGIN_MULTIPLIER;
  const credits    = Math.max(1, Math.round(withMargin * CREDITS_PER_USD));

  return {
    model:           m,
    raw_usd:         Math.round(raw * 1000) / 1000,
    with_margin_usd: Math.round(withMargin * 1000) / 1000,
    credits,
    per_image_breakdown: {
      listing_per_image: perListing,
      aplus_per_image:   perAplus,
      listing_count:     numListing,
      aplus_count:       numAplus,
    },
  };
}

// ─── Model metadata ─────────────────────────────────────────────────────────────

export interface ModelMeta {
  id:                   string;
  name:                 string;
  tagline:              string;
  description:          string;
  fal_model:            string;
  raw_cost_per_image:   { listing: number; aplus: number };
  sample_full_pack_credits?: number;
  sample_full_pack_usd?:     number;
}

export const MODEL_METADATA: Record<string, ModelMeta> = {
  [MODEL_STANDARD]: {
    id:          MODEL_STANDARD,
    name:        'TZ Standard',
    tagline:     'Fast, versatile, high-volume',
    description: 'Nano Banana 2 Edit — 4K output, premium photorealism, great for scale.',
    fal_model:   FAL_NANO_BANANA,
    raw_cost_per_image: { listing: STANDARD_COST_PER_IMAGE, aplus: STANDARD_COST_PER_IMAGE },
  },
  [MODEL_PRECISE]: {
    id:          MODEL_PRECISE,
    name:        'TZ Precise',
    tagline:     'Editorial fidelity, HD quality',
    description: 'GPT-Image-2 Edit — state-of-the-art text rendering, sharper typography, editorial depth.',
    fal_model:   FAL_GPT_IMAGE,
    raw_cost_per_image: { listing: PRECISE_COST_LISTING, aplus: PRECISE_COST_APLUS },
  },
};

export function listModels(): ModelMeta[] {
  return [MODEL_STANDARD, MODEL_PRECISE].map(mid => {
    const meta   = { ...MODEL_METADATA[mid] };
    const sample = packCostUsd(mid, 7, 5, true);
    meta.sample_full_pack_credits = sample.credits;
    meta.sample_full_pack_usd     = sample.with_margin_usd;
    return meta;
  });
}

// ─── Fal.ai payload builders ───────────────────────────────────────────────────

export interface NanoBananaPayload {
  prompt:             string;
  image_urls?:        string[];
  num_images:         number;
  aspect_ratio:       '1:1' | '16:9';
  resolution:         '4K';
  output_format:      'png' | 'jpeg';
  thinking_level:     'high';
  enable_web_search:  boolean;
  safety_tolerance:   '5';
  limit_generations:  boolean;
  negative_prompt?:   string;
}

export interface GptImage2Payload {
  prompt:       string;
  image_urls?:  string[];
  image_size:   { width: number; height: number } | string;
  quality:      'high';
  num_images:   number;
  output_format: 'png';
}

export type FalPayload = NanoBananaPayload | GptImage2Payload;

/**
 * Build a fal.ai payload for a single creative slot.
 * Returns [falModelId, payload] tuple.
 *
 * @param modelId         Internal model key ('tz_standard'|'tz_precise') OR full fal model string
 * @param prompt          Slot-specific generation prompt
 * @param referenceUrls   Array of reference image URLs (up to 4)
 * @param imageType       'listing' (1:1) or 'aplus' (16:9)
 * @param negativePrompt  Additional negative prompt to merge with base
 */
export function buildFalPayload(
  modelId: string,
  prompt: string,
  referenceUrls: string[],
  imageType: 'listing' | 'aplus' = 'listing',
  negativePrompt = '',
): [string, FalPayload] {
  const m    = normalizeModel(modelId);
  const refs = referenceUrls.filter(u => typeof u === 'string' && u.startsWith('http')).slice(0, 4);

  if (m === MODEL_PRECISE) {
    const imageSize = imageType === 'aplus'
      ? { width: 1920, height: 1080 }
      : 'square_hd';

    const payload: GptImage2Payload = {
      prompt,
      image_size:   imageSize,
      quality:      'high',
      num_images:   1,
      output_format: 'png',
    };
    if (refs.length) payload.image_urls = refs;
    return [FAL_GPT_IMAGE, payload];
  }

  // MODEL_STANDARD — nano-banana-2
  const ar      = imageType === 'aplus' ? '16:9' : '1:1';
  const fullNeg = negativePrompt
    ? `${negativePrompt}, ${BASE_NEGATIVE}`
    : BASE_NEGATIVE;

  const payload: NanoBananaPayload = {
    prompt,
    num_images:        1,
    aspect_ratio:      ar,
    resolution:        '4K',
    output_format:     'png',
    thinking_level:    'high',
    enable_web_search: true,
    safety_tolerance:  '5',
    limit_generations: true,
    negative_prompt:   fullNeg,
  };
  if (refs.length) payload.image_urls = refs;
  return [FAL_NANO_BANANA, payload];
}

// ─── Legacy single-URL helper (kept for backward compat) ──────────────────────

/** @deprecated Use buildFalPayload with referenceUrls array instead */
export function buildFalPayloadLegacy(
  referenceImageUrl: string,
  prompt: string,
  aspectRatio: 'square' | 'landscape' = 'square',
): NanoBananaPayload {
  const imageType = aspectRatio === 'landscape' ? 'aplus' : 'listing';
  const [, payload] = buildFalPayload(MODEL_STANDARD, prompt, [referenceImageUrl], imageType);
  return payload as NanoBananaPayload;
}
