/**
 * Agent-Ready Commerce — shared schemas.
 *
 * The pipeline turns a scraped product into a canonical, agent-legible record
 * (data layer), scores how "agent-selectable" it is, exposes it to a shopping
 * agent (decision layer), and measures the before/after visibility lift
 * (measurement harness). One product per audit; the session accumulates a small
 * catalog the agent-query endpoint can retrieve over.
 */
import { z } from "zod";

// ── Data layer: the canonical, normalized product ────────────────────────────
export const CanonicalAttribute = z.object({
  key: z.string(),
  value: z.string(),
  /** Where the attribute came from — text description, image/vision, or both. */
  source: z.enum(["text", "image", "both"]).catch("text"),
});
export type CanonicalAttribute = z.infer<typeof CanonicalAttribute>;

export const CanonicalSizing = z.object({
  system: z.string().catch(""),          // e.g. "US", "EU", "alpha (S/M/L)"
  availableSizes: z.array(z.string()).catch([]),
  fitNotes: z.string().catch(""),
});
export type CanonicalSizing = z.infer<typeof CanonicalSizing>;

export const CanonicalProduct = z.object({
  sourceUrl: z.string().catch(""),
  title: z.string().catch(""),
  brand: z.string().catch(""),
  category: z.string().catch(""),
  description: z.string().catch(""),
  attributes: z.array(CanonicalAttribute).catch([]),
  materials: z.array(z.string()).catch([]),
  colorway: z.array(z.string()).catch([]),
  sizing: CanonicalSizing.catch({ system: "", availableSizes: [], fitNotes: "" }),
  useCaseTags: z.array(z.string()).catch([]),
  audience: z.array(z.string()).catch([]),
  /** Image-derived styling / context cues (the vision differentiator). */
  stylingContext: z.array(z.string()).catch([]),
  availability: z.string().catch(""),
  price: z.string().catch(""),
  currency: z.string().catch(""),
  images: z.array(z.string()).catch([]),
});
export type CanonicalProduct = z.infer<typeof CanonicalProduct>;

/** LLM text-enrichment output (before we fold in vision + deterministic fields). */
export const TextEnrichment = z.object({
  category: z.string().catch(""),
  attributes: z.array(CanonicalAttribute).catch([]),
  materials: z.array(z.string()).catch([]),
  sizing: CanonicalSizing.catch({ system: "", availableSizes: [], fitNotes: "" }),
  useCaseTags: z.array(z.string()).catch([]),
  audience: z.array(z.string()).catch([]),
});
export type TextEnrichment = z.infer<typeof TextEnrichment>;

/** Vision-enrichment output — attributes read directly off product imagery. */
export const VisionEnrichment = z.object({
  materials: z.array(z.string()).catch([]),
  colorway: z.array(z.string()).catch([]),
  stylingContext: z.array(z.string()).catch([]),
  attributes: z.array(CanonicalAttribute).catch([]),
  notes: z.string().catch(""),
});
export type VisionEnrichment = z.infer<typeof VisionEnrichment>;

// ── Visibility score ─────────────────────────────────────────────────────────
export const VisibilityDimension = z.object({
  key: z.string(),
  label: z.string(),
  score: z.number(),
  max: z.number(),
  status: z.enum(["pass", "warn", "fail"]),
  gap: z.string().catch(""),
  fix: z.string().catch(""),
});
export type VisibilityDimension = z.infer<typeof VisibilityDimension>;

export const VisibilityScore = z.object({
  score: z.number(),           // 0-100
  grade: z.string(),           // A / B / C / D
  dimensions: z.array(VisibilityDimension),
  summary: z.string().catch(""),
});
export type VisibilityScore = z.infer<typeof VisibilityScore>;

// ── Measurement harness (before/after) ───────────────────────────────────────
export const AgentQuery = z.object({ query: z.string(), intent: z.string().catch("") });
export type AgentQuery = z.infer<typeof AgentQuery>;

export const AgentVerdict = z.object({
  surfaced: z.boolean().catch(false),
  confidence: z.number().catch(0),   // 0-100
  reasoning: z.string().catch(""),
});
export type AgentVerdict = z.infer<typeof AgentVerdict>;

export const MeasurementRow = z.object({
  query: z.string(),
  pre: AgentVerdict,
  post: AgentVerdict,
});
export type MeasurementRow = z.infer<typeof MeasurementRow>;

export const MeasurementReport = z.object({
  rows: z.array(MeasurementRow),
  preRate: z.number(),          // % of queries that surfaced the product (pre)
  postRate: z.number(),         // ...(post)
  deltaRate: z.number(),        // postRate - preRate
  preAvgConfidence: z.number(),
  postAvgConfidence: z.number(),
  summary: z.string().catch(""),
});
export type MeasurementReport = z.infer<typeof MeasurementReport>;

// ── Agent-facing (decision) layer ────────────────────────────────────────────
export const AgentRankedItem = z.object({
  sourceUrl: z.string().catch(""),
  title: z.string(),
  score: z.number(),            // retrieval/similarity score 0-100
  reasoning: z.string().catch(""),
});
export type AgentRankedItem = z.infer<typeof AgentRankedItem>;

export const AgentSuggestion = z.object({
  query: z.string(),
  answer: z.string(),           // natural-language "best product for X" answer
  best: AgentRankedItem.nullable(),
  ranked: z.array(AgentRankedItem),
});
export type AgentSuggestion = z.infer<typeof AgentSuggestion>;

/** The full audit result the tab renders + persists into the session catalog. */
export interface AgentReadyAudit {
  canonical: CanonicalProduct;
  schemaOrg: Record<string, unknown>;
  agentFeed: Record<string, unknown>;
  visibility: VisibilityScore;
  measurement: MeasurementReport | null;
}
