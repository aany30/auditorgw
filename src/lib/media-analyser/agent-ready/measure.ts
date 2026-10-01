/**
 * Measurement harness — the pilot's core proof number.
 *
 * We ask a real LLM shopping agent (Gemini) the same set of category-relevant
 * shopping queries twice: once against the RAW scraped product blob, once against
 * the ENRICHED canonical + agent-feed. For each we capture whether the agent would
 * surface/recommend the product and how confident it is. The lift between the two
 * runs — measured on identical queries — is the visibility delta.
 *
 * This is an LLM-simulated stand-in for live ChatGPT-Shopping / Gemini-Shopping
 * selection; the methodology (same queries, same agent, only the product data
 * changes) is what makes the before/after number meaningful.
 */
import { llmJson } from "@/lib/media-analyser/ugc-playground/llm";
import {
  AgentQuery, AgentVerdict, MeasurementReport,
  type CanonicalProduct, type MeasurementRow,
} from "./types";
import { buildAgentFeed } from "./feed";
import type { ScrapedProduct } from "./enrich";

const QUERIES_SCHEMA = { type: "object", properties: { queries: { type: "array", items: { type: "object", properties: { query: { type: "string" }, intent: { type: "string" } } } } } } as const;
const VERDICT_SCHEMA = { type: "object", properties: { surfaced: { type: "boolean" }, confidence: { type: "number" }, reasoning: { type: "string" } } } as const;

/** Generate realistic buyer/agent shopping queries for this product's category. */
export async function generateAgentQueries(c: CanonicalProduct, count = 6): Promise<AgentQuery[]> {
  const system = `You simulate how real buyers phrase shopping requests to an AI shopping agent. Given a product, write ${count} realistic, DIVERSE natural-language queries a shopper might ask an agent that this product COULD be a legitimate answer to — some broad, some with specific constraints (budget, use-case, material, audience, occasion). Do NOT name the brand/product. Return JSON {queries:[{query,intent}]}.`;
  const user = `Product: ${c.title}\nCategory: ${c.category}\nUse-cases: ${c.useCaseTags.join(", ")}\nAudience: ${c.audience.join(", ")}\nMaterials: ${c.materials.join(", ")}\nPrice: ${c.price}`;
  try {
    const raw = (await llmJson(system, user, QUERIES_SCHEMA, { maxTokens: 800 })) as { queries?: unknown[] };
    return (raw.queries ?? []).map(q => AgentQuery.parse(q)).filter(q => q.query).slice(0, count);
  } catch { return []; }
}

const RAW_BLOB = (p: ScrapedProduct) => JSON.stringify({ title: p.title, brand: p.brand, price: p.price, description: p.description, bullets: p.bullets }).slice(0, 6000);
const ENRICHED_BLOB = (c: CanonicalProduct) => JSON.stringify(buildAgentFeed(c)).slice(0, 8000);

async function agentVerdict(query: string, productData: string): Promise<AgentVerdict> {
  const system = "You are an AI shopping agent choosing products to recommend to a user. You are given ONE candidate product's data and a user query. Decide, using ONLY the data provided, whether you could confidently surface this product as a relevant recommendation for the query. An agent will NOT recommend a product whose data doesn't clearly establish fit — ambiguity lowers confidence. Return JSON {surfaced:boolean, confidence:0-100, reasoning}.";
  const user = `USER QUERY: ${query}\n\nCANDIDATE PRODUCT DATA:\n${productData}`;
  try { return AgentVerdict.parse(await llmJson(system, user, VERDICT_SCHEMA, { maxTokens: 400 })); }
  catch { return AgentVerdict.parse({}); }
}

/** Run every query pre (raw) and post (enriched) and aggregate the lift. */
export async function runHarness(raw: ScrapedProduct, canonical: CanonicalProduct, queries: AgentQuery[]): Promise<MeasurementReport> {
  const rawBlob = RAW_BLOB(raw);
  const richBlob = ENRICHED_BLOB(canonical);
  const rows: MeasurementRow[] = await Promise.all(queries.map(async (q) => {
    const [pre, post] = await Promise.all([agentVerdict(q.query, rawBlob), agentVerdict(q.query, richBlob)]);
    return { query: q.query, pre, post };
  }));
  const n = rows.length || 1;
  const pct = (f: (r: MeasurementRow) => number) => Math.round((rows.reduce((s, r) => s + f(r), 0) / n));
  const preRate = pct(r => (r.pre.surfaced ? 100 : 0));
  const postRate = pct(r => (r.post.surfaced ? 100 : 0));
  const preAvgConfidence = pct(r => r.pre.confidence);
  const postAvgConfidence = pct(r => r.post.confidence);
  return MeasurementReport.parse({
    rows, preRate, postRate, deltaRate: postRate - preRate, preAvgConfidence, postAvgConfidence,
    summary: `Agent selection rate ${preRate}% → ${postRate}% (${postRate - preRate >= 0 ? "+" : ""}${postRate - preRate} pts) across ${rows.length} queries; confidence ${preAvgConfidence} → ${postAvgConfidence}.`,
  });
}
