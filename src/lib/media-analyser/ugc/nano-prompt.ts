/**
 * Stage 03 — Nano Banana Pro reference-asset prompt template (verbatim from the
 * production spec `ugc-pipeline-all-system-prompts.md`). These produce 0–2
 * REFERENCE assets (scene / product-in-context / styling) — NOT per-shot keyframes.
 */

import type { ReferenceAssetSpec } from "./types";

export const NANO_BANANA_BASE =
  "Photorealistic image, UGC aesthetic. " +
  "Natural daylight, sharp focus, realistic textures and skin details, " +
  "shallow depth of field, shot on a high-end smartphone with slight authentic imperfection. " +
  "Composition optimized for use as a reference image in a downstream video generation pipeline.";

export const PURPOSE_ANCHORS: Record<ReferenceAssetSpec["purpose"], string> = {
  scene_anchoring:
    "Empty environment shot, no people in frame. " +
    "The scene should feel inhabited but unoccupied — " +
    "lighting and props establish atmosphere without subjects.",
  product_in_context:
    "Product hero placement in a contextual setting. " +
    "The product must match the provided reference images exactly — " +
    "same color, branding, proportions, materials, and label details. " +
    "Product is the focal point with shallow depth-of-field background.",
  styling:
    "Outfit and styling reference. The person must match the provided model image — " +
    "same face, build, and hair. Neutral expression, neutral pose, clear view of wardrobe. " +
    "Plain background, even lighting.",
};

export const NANO_BANANA_NEGATIVES =
  "Avoid: any text, captions, subtitles, watermarks, logos other than " +
  "on the product. Avoid artificial studio lighting, plastic skin textures, oversaturated colors, " +
  "stock photo composition, multiple unintended subjects, blurry composition, AI artifacts.";

/** Build the full Nano Banana Pro prompt for one reference-asset spec. */
export function buildNanoBananaPrompt(assetSpec: ReferenceAssetSpec): string {
  const anchor = PURPOSE_ANCHORS[assetSpec.purpose];
  return `${NANO_BANANA_BASE}\n\n${anchor}\n\nScene: ${assetSpec.nano_banana_prompt}\n\n${NANO_BANANA_NEGATIVES}`;
}
