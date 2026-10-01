/**
 * Agent-facing decision layer — "best product for X constraint".
 *
 * Vector search (Gemini text-embedding-004 + cosine) retrieves the closest
 * products in the enriched catalog to the agent's constraint, then an LLM re-ranks
 * and writes a confident, structured answer. Retrieval degrades to lexical overlap
 * if embeddings are unavailable, so the endpoint always answers.
 */
import { llmJson } from "@/lib/media-analyser/ugc-playground/llm";
import { AgentSuggestion, type AgentRankedItem, type CanonicalProduct } from "./types";

/** The text an agent matches a query against — the query-relevant surface of a product. */
export function retrievalText(c: CanonicalProduct): string {
  return [
    c.title, c.brand, c.category, c.description,
    c.useCaseTags.join(", "), c.audience.join(", "), c.materials.join(", "),
    c.colorway.join(", "), c.stylingContext.join(", "),
    c.attributes.map(a => `${a.key}: ${a.value}`).join("; "),
    c.price,
  ].filter(Boolean).join(". ").slice(0, 4000);
}

// ── Gemini embeddings ────────────────────────────────────────────────────────
async function embed(text: string, key: string): Promise<number[] | null> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "models/text-embedding-004", content: { parts: [{ text: text.slice(0, 8000) }] } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { embedding?: { values?: number[] } };
    return d.embedding?.values ?? null;
  } catch { return null; }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Lexical fallback: token-overlap similarity 0..1. */
function lexical(query: string, doc: string): number {
  const toks = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const q = toks(query), d = toks(doc);
  if (!q.size) return 0;
  let hit = 0; for (const t of q) if (d.has(t)) hit++;
  return hit / q.size;
}

const ANSWER_SCHEMA = { type: "object", properties: { answer: { type: "string" }, bestIndex: { type: "number" }, reasoning: { type: "string" } } } as const;

/** Retrieve + rank the catalog for a constraint, then write the agent-facing answer. */
export async function suggest(query: string, catalog: CanonicalProduct[], geminiKey: string): Promise<AgentSuggestion> {
  if (!catalog.length) return AgentSuggestion.parse({ query, answer: "No products in the catalog to search.", best: null, ranked: [] });

  const docs = catalog.map(retrievalText);
  const qVec = geminiKey ? await embed(query, geminiKey) : null;
  const docVecs = qVec ? await Promise.all(docs.map(d => embed(d, geminiKey))) : [];

  const scored: AgentRankedItem[] = catalog.map((c, i) => {
    const sim = qVec && docVecs[i] ? cosine(qVec, docVecs[i]!) : lexical(query, docs[i]);
    return { sourceUrl: c.sourceUrl, title: c.title || `Product ${i + 1}`, score: Math.round(Math.max(0, Math.min(1, sim)) * 100), reasoning: "" };
  }).sort((a, b) => b.score - a.score);

  // LLM re-rank/answer over the top few retrieved candidates.
  const top = scored.slice(0, Math.min(5, scored.length));
  const topCanon = top.map(t => catalog.find(c => (c.sourceUrl || c.title) === (t.sourceUrl || t.title))!).filter(Boolean);
  const system = "You are an AI shopping agent. Given a shopper's constraint and a shortlist of candidate products (structured data), pick the single best match and write a concise, confident recommendation citing the specific attributes that satisfy the constraint. If none truly fit, say so. Return JSON {answer, bestIndex (0-based into the shortlist, -1 if none), reasoning}.";
  const shortlist = topCanon.map((c, i) => `[${i}] ${retrievalText(c)}`).join("\n\n");
  let answer = `Top match: ${top[0]?.title ?? "n/a"}.`;
  let best: AgentRankedItem | null = top[0] ?? null;
  try {
    const r = (await llmJson(system, `CONSTRAINT: ${query}\n\nSHORTLIST:\n${shortlist}`, ANSWER_SCHEMA, { geminiKey, maxTokens: 500 })) as { answer?: string; bestIndex?: number; reasoning?: string };
    if (r.answer) answer = r.answer;
    const idx = typeof r.bestIndex === "number" ? r.bestIndex : 0;
    if (idx >= 0 && top[idx]) best = { ...top[idx], reasoning: r.reasoning ?? "" };
    else if (idx < 0) best = null;
  } catch { /* keep retrieval-only answer */ }

  return AgentSuggestion.parse({ query, answer, best, ranked: scored.slice(0, 10) });
}
