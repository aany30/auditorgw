/**
 * "Create world / background" — builds a Nano Banana Pro prompt for the BACKDROP /
 * environment the UGC ad takes place in. Mirrors the character generator: a few
 * dropdowns (style / time / lighting) + optional free text → one empty-environment
 * scene image (no people) used as the ad's scene reference. Option lists are the
 * single source of truth shared by the /api/ugc-ads/world route and the UGC form.
 */

import { NANO_BANANA_BASE, NANO_BANANA_NEGATIVES, PURPOSE_ANCHORS } from "./nano-prompt";

interface Option {
  id: string;
  label: string;
}

export interface WorldOptions {
  style?: string;
  time?: string;
  lighting?: string;
  description?: string;
}

// `id: ""` is the "no preference" choice — omitted from the prompt entirely. The id
// is the descriptive phrase injected into the prompt; the label is what the UI shows.
export const WORLD_STYLE_OPTIONS: Option[] = [
  { id: "", label: "Any style" },
  { id: "photorealistic, true-to-life", label: "Realistic" },
  { id: "fantasy, imaginative stylised world", label: "Fantasy" },
  { id: "3D rendered, CGI", label: "3D" },
  { id: "animated, illustrated cartoon style", label: "Animated" },
  { id: "authentic everyday UGC look, shot on a phone", label: "UGC" },
  { id: "aspirational lifestyle setting", label: "Lifestyle" },
  { id: "cinematic, filmic, dramatic depth of field", label: "Cinematic" },
  { id: "high-end commercial advertising production value", label: "High-end ad" },
];

export const WORLD_TIME_OPTIONS: Option[] = [
  { id: "", label: "Any time" },
  { id: "morning", label: "Morning" },
  { id: "evening", label: "Evening" },
  { id: "night", label: "Night" },
  { id: "sundown / golden hour", label: "Sundown" },
];

export const WORLD_LIGHTING_OPTIONS: Option[] = [
  { id: "", label: "Any lighting" },
  { id: "indoor lighting", label: "Indoor" },
  { id: "outdoor natural light", label: "Outdoor" },
  { id: "soft and diffused light", label: "Soft & diffused" },
  { id: "neon lighting", label: "Neon" },
  { id: "bright natural sunlight", label: "Sunlight" },
  { id: "warm golden-hour light", label: "Golden hour" },
  { id: "clean studio lighting", label: "Studio" },
];

/** A short human-readable summary of the world selections (used to ground the Director). */
export function worldSummary(o: WorldOptions): string {
  return [o.style, o.time, o.lighting, (o.description ?? "").trim()]
    .map(s => (s ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/** Compose the full Nano Banana Pro prompt for an empty world/backdrop image. */
export function buildWorldPrompt(o: WorldOptions): string {
  const bits: string[] = [];
  if (o.style?.trim()) bits.push(`Visual style: ${o.style.trim()}.`);
  if (o.time?.trim()) bits.push(`Time of day: ${o.time.trim()}.`);
  if (o.lighting?.trim()) bits.push(`Lighting: ${o.lighting.trim()}.`);
  const desc = (o.description ?? "").trim();
  if (desc) bits.push(`Scene: ${desc}.`);
  const spec = bits.length ? bits.join(" ") : "A clean, versatile everyday setting.";
  return `${NANO_BANANA_BASE}\n\n${PURPOSE_ANCHORS.scene_anchoring}\n\n${spec}\n\n${NANO_BANANA_NEGATIVES}`;
}
