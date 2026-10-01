/**
 * Enrichment — turn scraped product data into a canonical, agent-legible record.
 *
 * Two passes: (1) LLM structures the unstructured text (attributes, materials,
 * sizing, use-case tags); (2) a vision pass reads attributes straight off the
 * product imagery (material, colour, fit, styling context) — the differentiator a
 * generic agent vendor can't easily replicate. The two are merged, with each
 * attribute tagged by where it came from.
 */
import { llmJson } from "@/lib/media-analyser/ugc-playground/llm";
import { callVisionLLM } from "@/lib/media-analyser/vision-llm";
import {
  CanonicalProduct, TextEnrichment, VisionEnrichment,
  type CanonicalAttribute,
} from "./types";

export interface ScrapedProduct {
  title: string; brand: string; description: string; bullets: string[]; price: string; imageUrls: string[]; sourceUrl?: string;
}

const TEXT_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string" },
    attributes: { type: "array", items: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } } } },
    materials: { type: "array", items: { type: "string" } },
    sizing: { type: "object", properties: { system: { type: "string" }, availableSizes: { type: "array", items: { type: "string" } }, fitNotes: { type: "string" } } },
    useCaseTags: { type: "array", items: { type: "string" } },
    audience: { type: "array", items: { type: "string" } },
  },
} as const;

const VISION_SCHEMA = {
  type: "object",
  properties: {
    materials: { type: "array", items: { type: "string" } },
    colorway: { type: "array", items: { type: "string" } },
    stylingContext: { type: "array", items: { type: "string" } },
    attributes: { type: "array", items: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } } } },
    notes: { type: "string" },
  },
} as const;

const productBlurb = (p: ScrapedProduct) =>
  [p.title && `Title: ${p.title}`, p.brand && `Brand: ${p.brand}`, p.price && `Price: ${p.price}`,
   p.description && `Description: ${p.description}`, p.bullets.length && `Bullets:\n- ${p.bullets.join("\n- ")}`]
    .filter(Boolean).join("\n").slice(0, 6000);

/** LLM: structure the text description into canonical fields. */
export async function enrichText(p: ScrapedProduct): Promise<TextEnrichment> {
  const system = "You are a product-data normaliser for AI shopping agents. From the raw product text, extract STRUCTURED, discrete facts an agent can match a query against. Return JSON only. attributes: 8+ concrete key/value pairs (e.g. {key:'Weight', value:'310g'}, {key:'Waterproof', value:'yes'}) — never prose. materials: composition list. sizing: system (US/EU/alpha), availableSizes[], fitNotes. useCaseTags: concrete intents/occasions an agent would query by ('trail running','office wear'). audience: who it's for. Infer only what the text supports; omit unknowns rather than guessing.";
  try { return TextEnrichment.parse(await llmJson(system, productBlurb(p), TEXT_SCHEMA, { maxTokens: 1400 })); }
  catch { return TextEnrichment.parse({}); }
}

/** Download a product image and return a Gemini inline_data part. */
async function imageInline(url: string): Promise<{ inline_data: { mime_type: string; data: string } } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 4_000_000) return null;
    const ct = r.headers.get("content-type") || "image/jpeg";
    return { inline_data: { mime_type: ct.startsWith("image/") ? ct : "image/jpeg", data: buf.toString("base64") } };
  } catch { return null; }
}

/** Vision: read attributes directly off the product images. */
export async function enrichVision(p: ScrapedProduct, geminiKey: string): Promise<VisionEnrichment> {
  const imgs = p.imageUrls.slice(0, 3);
  const parts: Record<string, unknown>[] = [];
  for (const u of imgs) { const part = await imageInline(u); if (part) parts.push(part); }
  if (!parts.length) return VisionEnrichment.parse({});
  const system = "You are a product-vision analyst for AI shopping agents. Look ONLY at the product images and report what you can SEE that text often misses: materials/finish, exact colourway, fit/silhouette, and styling context (settings/occasions the product visually suits). Also list any additional visible key/value attributes. Return JSON only; report only what is visible, not guesses.";
  parts.push({ text: `Analyse the ${parts.length} product image(s) for "${p.title || "this product"}". ${VISION_HINT}` });
  try {
    const raw = await callVisionLLM(system, parts, geminiKey, { jsonMode: true, responseSchema: VISION_SCHEMA, maxTokens: 1200 });
    return VisionEnrichment.parse(JSON.parse(raw));
  } catch { return VisionEnrichment.parse({}); }
}
const VISION_HINT = "Return materials[], colorway[], stylingContext[], attributes[{key,value}], notes.";

const dedupeStr = (arr: string[]) => Array.from(new Map(arr.map(s => [s.trim().toLowerCase(), s.trim()])).values()).filter(Boolean);

/** Merge text + vision enrichment into one canonical product, tagging attribute provenance. */
export function buildCanonical(p: ScrapedProduct, text: TextEnrichment, vision: VisionEnrichment): CanonicalProduct {
  const byKey = new Map<string, CanonicalAttribute>();
  for (const a of text.attributes) { if (!a.key) continue; byKey.set(a.key.toLowerCase(), { key: a.key, value: a.value, source: "text" }); }
  for (const a of vision.attributes) {
    if (!a.key) continue;
    const k = a.key.toLowerCase();
    if (byKey.has(k)) byKey.set(k, { ...byKey.get(k)!, source: "both" });
    else byKey.set(k, { key: a.key, value: a.value, source: "image" });
  }
  return CanonicalProduct.parse({
    sourceUrl: p.sourceUrl ?? "",
    title: p.title, brand: p.brand, category: text.category, description: p.description,
    attributes: Array.from(byKey.values()),
    materials: dedupeStr([...text.materials, ...vision.materials]),
    colorway: dedupeStr(vision.colorway),
    sizing: text.sizing,
    useCaseTags: dedupeStr(text.useCaseTags),
    audience: dedupeStr(text.audience),
    stylingContext: dedupeStr(vision.stylingContext),
    availability: p.price ? "in stock" : "",
    price: p.price,
    currency: (p.price.match(/[$£€₹]|USD|EUR|GBP|INR/) ?? [""])[0],
    images: p.imageUrls.slice(0, 8),
  });
}
