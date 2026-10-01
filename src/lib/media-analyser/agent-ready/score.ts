/**
 * Agent-Ready visibility score — deterministic (no LLM cost).
 *
 * Scores how "agent-selectable" a canonical product is: a shopping agent can only
 * confidently surface a product it can read structured, unambiguous facts about.
 * Each dimension maps to a concrete gap + fix so the tab can show what to enrich.
 */
import type { CanonicalProduct, VisibilityDimension, VisibilityScore } from "./types";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** schema.org/Product completeness — the fields agents index off. */
function schemaCompleteness(s: Record<string, unknown>): number {
  const offers = (s.offers ?? {}) as Record<string, unknown>;
  const checks = [
    !!s.name,
    !!s.brand,
    !!s.description,
    Array.isArray(s.image) ? (s.image as unknown[]).length > 0 : !!s.image,
    !!s.category,
    !!offers.price,
    !!offers.availability,
    Array.isArray(s.additionalProperty) && (s.additionalProperty as unknown[]).length > 0,
  ];
  return checks.filter(Boolean).length / checks.length; // 0..1
}

export function scoreVisibility(c: CanonicalProduct, schemaOrg: Record<string, unknown>): VisibilityScore {
  const dims: VisibilityDimension[] = [];
  const add = (key: string, label: string, ratio: number, max: number, gap: string, fix: string) => {
    const score = Math.round(clamp(ratio, 0, 1) * max);
    const status: VisibilityDimension["status"] = ratio >= 0.85 ? "pass" : ratio >= 0.4 ? "warn" : "fail";
    dims.push({ key, label, score, max, status, gap: status === "pass" ? "" : gap, fix: status === "pass" ? "" : fix });
  };

  // 1 · Structured attributes — agents match on discrete key/value facts, not prose.
  const attrN = c.attributes.length;
  add("attributes", "Structured attributes", clamp(attrN / 8, 0, 1), 20,
    `Only ${attrN} structured attribute${attrN === 1 ? "" : "s"} — agents can't match on prose.`,
    "Extract 8+ discrete key/value attributes (fabric, weight, fit, features) from the description.");

  // 2 · Materials
  add("materials", "Materials / composition", c.materials.length ? 1 : 0, 10,
    "No material/composition data.",
    "Add materials (e.g. '100% merino wool') — a top agent filter.");

  // 3 · Sizing structure
  const sizeRatio = (c.sizing.system ? 0.4 : 0) + (c.sizing.availableSizes.length ? 0.4 : 0) + (c.sizing.fitNotes ? 0.2 : 0);
  add("sizing", "Sizing structure", sizeRatio, 10,
    "Sizing is unstructured or missing.",
    "Provide a sizing system, the available sizes array, and fit notes.");

  // 4 · Use-case tags
  const tagN = c.useCaseTags.length;
  add("usecase", "Use-case tags", clamp(tagN / 4, 0, 1), 15,
    `Only ${tagN} use-case tag${tagN === 1 ? "" : "s"} — agents query by intent ("for X").`,
    "Add 4+ concrete use-case/occasion tags an agent would query by.");

  // 5 · Image-derived attributes (the vision moat: what a generic vendor can't extract)
  const imgAttrN = c.attributes.filter(a => a.source === "image" || a.source === "both").length + c.stylingContext.length + c.colorway.length;
  add("vision", "Image-derived attributes", clamp(imgAttrN / 5, 0, 1), 15,
    "Little/no attribute data extracted from imagery.",
    "Read material, color, fit and styling context straight off the product images.");

  // 6 · schema.org/Product markup
  add("schema", "schema.org/Product markup", schemaCompleteness(schemaOrg), 20,
    "schema.org/Product markup is incomplete.",
    "Fill name, brand, description, image, category, additionalProperty, and offers (price + availability).");

  // 7 · Availability + price
  const avail = (c.availability ? 0.5 : 0) + (c.price ? 0.5 : 0);
  add("commerce", "Price & availability", avail, 10,
    "Missing price and/or availability.",
    "Expose current price + availability so agents can act, not just surface.");

  const score = dims.reduce((s, d) => s + d.score, 0); // out of 100
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";
  const weakest = [...dims].filter(d => d.status !== "pass").sort((a, b) => (b.max - b.score) - (a.max - a.score)).slice(0, 3);
  const summary = weakest.length
    ? `Biggest gaps: ${weakest.map(d => d.label.toLowerCase()).join(", ")}.`
    : "Fully agent-legible — all dimensions pass.";
  return { score, grade, dimensions: dims, summary };
}
