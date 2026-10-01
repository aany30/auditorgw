/**
 * UGC New — Gemini responseSchemas + shared TS types for the pipeline stages.
 */
import { z } from "zod";

// ── Gemini structured-output schemas (object stages) ─────────────────────────
export const INTAKE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    audienceLabel: { type: "string" },
    audienceDescription: { type: "string" },
    productDescription: { type: "string" },
    otherInfo: { type: "string" },
    missing: { type: "array", items: { type: "string" } },
  },
  required: ["audienceLabel", "audienceDescription", "productDescription", "otherInfo", "missing"],
};

export const SEARCH_QUERY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { competitorQuery: { type: "string" }, adStyleQuery: { type: "string" } },
  required: ["competitorQuery", "adStyleQuery"],
};

export const IMAGE_QC_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    productVisible: { type: "boolean" },
    faceUsable: { type: "boolean" },
    score: { type: "integer" },
    notes: { type: "string" },
  },
  required: ["productVisible", "faceUsable", "score", "notes"],
};

export const VOICE_TRAITS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    gender: { type: "string", enum: ["male", "female"], nullable: true },
    ageBracket: { type: "string", enum: ["young", "middle_aged", "old"], nullable: true },
    descriptors: { type: "array", items: { type: "string" } },
    preferredUseCase: { type: "string", enum: ["conversational", "social_media", "narrative_story"], nullable: true },
  },
};

// ── Zod validation of parsed replies ─────────────────────────────────────────
export const IntakeResult = z.object({
  audienceLabel: z.string().default(""),
  audienceDescription: z.string().default(""),
  productDescription: z.string().default(""),
  otherInfo: z.string().default(""),
  missing: z.array(z.string()).default([]),
});
export type IntakeResult = z.infer<typeof IntakeResult>;

export const SearchQueries = z.object({
  competitorQuery: z.string().catch(""),
  adStyleQuery: z.string().catch(""),
});

export const Persona = z.object({ name: z.string(), description: z.string() });
export type Persona = z.infer<typeof Persona>;
export const PersonaArray = z.array(Persona);

export const ImageQc = z.object({
  productVisible: z.boolean().catch(false),
  faceUsable: z.boolean().catch(false),
  score: z.number().catch(0),
  notes: z.string().catch(""),
});
export type ImageQc = z.infer<typeof ImageQc>;

export const VoiceTraits = z.object({
  gender: z.enum(["male", "female"]).nullable().catch(null),
  ageBracket: z.enum(["young", "middle_aged", "old"]).nullable().catch(null),
  descriptors: z.array(z.string()).catch([]),
  preferredUseCase: z.enum(["conversational", "social_media", "narrative_story"]).nullable().catch(null),
});
export type VoiceTraits = z.infer<typeof VoiceTraits>;

// ── Pipeline data shapes shared with the client ──────────────────────────────
export interface GeneratedScript { angle: string; label: string; content: string; wordCount: number }
export interface GeneratedPersona extends Persona { imageDataUrl?: string; provider?: string; qcScore?: number; qcNotes?: string }
export interface VideoResult { provider: "seedance" | "hailuo"; videoUrl?: string; error?: string }
