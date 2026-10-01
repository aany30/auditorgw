/**
 * Agent-facing REST endpoint — "best product for X constraint".
 *
 * This is the decision layer a shopping agent (or MCP tool) calls. POST a natural-
 * language constraint plus the enriched catalog; get back a ranked, structured
 * answer via vector retrieval + LLM re-rank. GET ?q=… returns the same for a quick
 * agent probe (uses the catalog posted in the session; documents usage if none).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { suggest } from "@/lib/media-analyser/agent-ready/retrieval";
import { CanonicalProduct } from "@/lib/media-analyser/agent-ready/types";

export const config = { maxDuration: 120 };

const USAGE = {
  service: "agent-ready/query",
  how: "POST { query: string, catalog: CanonicalProduct[] } → { query, answer, best, ranked }",
  note: "The catalog is the set of enriched products from the Agent-Ready audit tab.",
};

function parseCatalog(v: unknown): CanonicalProduct[] {
  if (!Array.isArray(v)) return [];
  return v.map(x => { try { return CanonicalProduct.parse(x); } catch { return null; } }).filter((x): x is CanonicalProduct => !!x);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") {
    const geminiKey = process.env.GEMINI_API_KEY ?? "";
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = String(body.query ?? "").trim();
    if (!query) return res.status(400).json({ error: "Provide a `query` constraint.", usage: USAGE });
    const catalog = parseCatalog(body.catalog);
    if (!catalog.length) return res.status(400).json({ error: "Provide a non-empty `catalog` of enriched products.", usage: USAGE });
    try {
      return res.status(200).json(await suggest(query, catalog, geminiKey));
    } catch (e) {
      return res.status(502).json({ error: `Query failed: ${e instanceof Error ? e.message : e}` });
    }
  } else if (req.method === "GET") {
    const q = req.query.q as string | undefined;
    if (!q) return res.status(200).json(USAGE);
    return res.status(200).json({ ...USAGE, hint: "GET is a probe — POST the catalog to actually retrieve.", query: q });
  } else {
    return res.status(405).end();
  }
}
