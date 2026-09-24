/**
 * UGC Ad Director pipeline — shared types, Zod validators and Gemini responseSchemas.
 *
 * Mirrors the two `responseSchema` blocks from the production spec
 * (`ugc-pipeline-all-system-prompts.md`): Stage 02 (Director plan) and
 * Stage 05 (QC gate). The Gemini `responseSchema` objects constrain generation;
 * the Zod schemas validate + repair what comes back before downstream stages run.
 */

import { z } from "zod";

// ─── Stage 02 — Director plan ──────────────────────────────────────────────

export const BEAT_NAMES = ["Hook", "Problem", "Demo", "Payoff", "CTA"] as const;
export const REF_PURPOSES = ["scene_anchoring", "product_in_context", "styling"] as const;
export const INPUT_REF_SLOTS = ["model_image", "product_image_1", "product_image_2", "product_image_3"] as const;

// Fields use z.coerce + .catch(default) so the OpenAI/OpenRouter fallback — which
// (unlike Gemini) can't be constrained by a responseSchema — is repaired into a
// valid plan instead of hard-failing on a minor type/shape mismatch. Gemini's
// schema-constrained output already matches exactly, so .catch never fires there.
export const ShotSchema = z.object({
  shot_number: z.coerce.number().int().catch(0),
  beat_name: z.enum(BEAT_NAMES).catch("Hook"),
  time_range: z.string().catch(""),
  camera: z.string().catch(""),
  subject_action: z.string().catch(""),
  dialogue: z.string().catch(""),
  text_overlay: z.string().nullable().optional(),
});

export const ReferenceAssetSpecSchema = z.object({
  asset_id: z.string(),
  purpose: z.enum(REF_PURPOSES),
  nano_banana_prompt: z.string(),
  input_references: z.array(z.enum(INPUT_REF_SLOTS)).default([]),
});

export const DirectorMetaSchema = z.object({
  duration_seconds: z.coerce.number().int().catch(15),
  aspect_ratio: z.string().catch("9:16"),
  style_descriptors: z.string().catch(""),
  rhythm: z.string().catch(""),
  character_description: z.string().catch(""),
  product_description: z.string().catch(""),
  scene_setting: z.string().catch(""),
  voice_characteristics: z.string().catch(""),
});

export const DirectorPlanSchema = z.object({
  meta: z.preprocess(v => (v && typeof v === "object" ? v : {}), DirectorMetaSchema),
  shots: z.array(ShotSchema).catch([]),
  reference_assets_needed: z.array(ReferenceAssetSpecSchema).catch([]),
  constraints: z.array(z.string()).catch([]),
  assembled_seedance_prompt: z.string().catch(""),
});

export type Shot = z.infer<typeof ShotSchema>;
export type ReferenceAssetSpec = z.infer<typeof ReferenceAssetSpecSchema>;
export type DirectorMeta = z.infer<typeof DirectorMetaSchema>;
export type UGCDirectorPlan = z.infer<typeof DirectorPlanSchema>;

// ─── Stage 05 — QC gate ────────────────────────────────────────────────────

export const QC_DIMENSIONS = [
  "character_consistency",
  "product_accuracy",
  "beat_structure",
  "dialogue_fidelity",
  "unintended_artifacts",
  "audio_quality",
] as const;

export const QC_SEVERITIES = ["pass", "low", "medium", "high", "critical"] as const;

export const REGEN_STRATEGIES = [
  "none",
  "full_regenerate",
  "regenerate_with_seed_change",
  "regenerate_plan",
  "regenerate_references",
] as const;

export const QcDimensionSchema = z.object({
  dimension: z.enum(QC_DIMENSIONS),
  pass: z.boolean(),
  severity: z.enum(QC_SEVERITIES),
  notes: z.string(),
  evidence_timestamps: z.array(z.string()).default([]),
});

export const QcFailedBeatSchema = z.object({
  beat_name: z.enum(BEAT_NAMES),
  issue: z.string(),
  required_fix: z.string(),
});

export const QcResultSchema = z.object({
  overall_pass: z.boolean(),
  summary: z.string(),
  dimension_assessments: z.array(QcDimensionSchema).default([]),
  failed_beats: z.array(QcFailedBeatSchema).default([]),
  regeneration_strategy: z.enum(REGEN_STRATEGIES).default("none"),
});

export type QcDimension = z.infer<typeof QcDimensionSchema>;
export type QcFailedBeat = z.infer<typeof QcFailedBeatSchema>;
export type QcResult = z.infer<typeof QcResultSchema>;

// ─── Gemini responseSchema objects (OpenAPI subset) ────────────────────────
// Verified live: gemini-2.5-flash honours `responseSchema` incl. string enums.

export const DIRECTOR_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    meta: {
      type: "object",
      properties: {
        duration_seconds: { type: "integer" },
        aspect_ratio: { type: "string" },
        style_descriptors: { type: "string" },
        rhythm: { type: "string" },
        character_description: { type: "string" },
        product_description: { type: "string" },
        scene_setting: { type: "string" },
        voice_characteristics: { type: "string" },
      },
      required: [
        "duration_seconds", "aspect_ratio", "style_descriptors", "rhythm",
        "character_description", "product_description", "scene_setting", "voice_characteristics",
      ],
    },
    shots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          shot_number: { type: "integer" },
          beat_name: { type: "string", enum: [...BEAT_NAMES] },
          time_range: { type: "string" },
          camera: { type: "string" },
          subject_action: { type: "string" },
          dialogue: { type: "string" },
          text_overlay: { type: "string", nullable: true },
        },
        required: ["shot_number", "beat_name", "time_range", "camera", "subject_action", "dialogue"],
      },
    },
    reference_assets_needed: {
      type: "array",
      items: {
        type: "object",
        properties: {
          asset_id: { type: "string" },
          purpose: { type: "string", enum: [...REF_PURPOSES] },
          nano_banana_prompt: { type: "string" },
          input_references: {
            type: "array",
            items: { type: "string", enum: [...INPUT_REF_SLOTS] },
          },
        },
        required: ["asset_id", "purpose", "nano_banana_prompt", "input_references"],
      },
    },
    constraints: { type: "array", items: { type: "string" } },
    assembled_seedance_prompt: { type: "string" },
  },
  required: ["meta", "shots", "reference_assets_needed", "constraints", "assembled_seedance_prompt"],
};

export const QC_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    overall_pass: { type: "boolean" },
    summary: { type: "string" },
    dimension_assessments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dimension: { type: "string", enum: [...QC_DIMENSIONS] },
          pass: { type: "boolean" },
          severity: { type: "string", enum: [...QC_SEVERITIES] },
          notes: { type: "string" },
          evidence_timestamps: { type: "array", items: { type: "string" } },
        },
        required: ["dimension", "pass", "severity", "notes"],
      },
    },
    failed_beats: {
      type: "array",
      items: {
        type: "object",
        properties: {
          beat_name: { type: "string", enum: [...BEAT_NAMES] },
          issue: { type: "string" },
          required_fix: { type: "string" },
        },
        required: ["beat_name", "issue", "required_fix"],
      },
    },
    regeneration_strategy: { type: "string", enum: [...REGEN_STRATEGIES] },
  },
  required: ["overall_pass", "summary", "dimension_assessments", "regeneration_strategy"],
};

// ─── Parse + repair helpers ────────────────────────────────────────────────

/** Strip ```json fences a model may wrap around its output. */
export function stripJsonFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return s;
}

/**
 * Validate + coerce a raw Director response into a clean plan. Forces exactly 5
 * beats in canonical order, renumbers shots, and sets duration — the downstream
 * Seedance call depends on a well-formed 5-beat plan.
 *
 * `targetSeconds` (15 or 30) forces the user-chosen ad length into the plan so the
 * render is deterministic; without it, duration is clamped to the default 10–15s.
 */
export function parseDirectorPlan(raw: string, targetSeconds?: number): UGCDirectorPlan {
  const obj = JSON.parse(stripJsonFences(raw)) as unknown;
  const plan = DirectorPlanSchema.parse(obj);

  // Force the canonical 5-beat funnel: keep the first shot per beat, in order.
  const byBeat = new Map<(typeof BEAT_NAMES)[number], Shot>();
  for (const s of plan.shots) if (!byBeat.has(s.beat_name)) byBeat.set(s.beat_name, s);
  const ordered: Shot[] = BEAT_NAMES
    .map(b => byBeat.get(b))
    .filter((s): s is Shot => Boolean(s))
    .map((s, i) => ({ ...s, shot_number: i + 1 }));
  plan.shots = ordered.length ? ordered : plan.shots.slice(0, 5);

  plan.reference_assets_needed = plan.reference_assets_needed.slice(0, 2);
  plan.meta.duration_seconds =
    targetSeconds === 15 || targetSeconds === 30
      ? targetSeconds
      : Math.max(10, Math.min(15, Math.round(plan.meta.duration_seconds || 15)));
  return plan;
}

export function parseQcResult(raw: string): QcResult {
  return QcResultSchema.parse(JSON.parse(stripJsonFences(raw)));
}
