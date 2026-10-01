/**
 * Agent-Ready audit · SSE orchestrator.
 *  scrape → enrich (text + vision) → schema.org/agent-feed → visibility score →
 *  agent-query harness (before/after). Reuses the existing product scraper.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { enrichText, enrichVision, buildCanonical, type ScrapedProduct } from "@/lib/media-analyser/agent-ready/enrich";
import { buildSchemaOrg, buildAgentFeed } from "@/lib/media-analyser/agent-ready/feed";
import { scoreVisibility } from "@/lib/media-analyser/agent-ready/score";
import { generateAgentQueries, runHarness } from "@/lib/media-analyser/agent-ready/measure";
import type { CanonicalProduct, VisibilityScore, MeasurementReport } from "@/lib/media-analyser/agent-ready/types";

export const config = { maxDuration: 300 };

export interface AgentReadyUpdate {
  phase: "scraping" | "enrich-text" | "enrich-vision" | "schema" | "score" | "measure" | "done" | "error";
  message?: string;
  canonical?: CanonicalProduct;
  schemaOrg?: Record<string, unknown>;
  agentFeed?: Record<string, unknown>;
  visibility?: VisibilityScore;
  measurement?: MeasurementReport | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = String(body.url ?? "").trim();
  const runMeasurement = body.measure !== false;
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "Paste a full product URL (http/https)." });

  const proto = req.headers["x-forwarded-proto"] ?? "http";
  const host = req.headers.host ?? "localhost:3000";
  const origin = `${proto}://${host}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (u: AgentReadyUpdate) => { res.write(`data: ${JSON.stringify(u)}\n\n`); };

  try {
    // ── scrape (reuse the existing single-product scraper) ──
    send({ phase: "scraping", message: "Scraping product data + images…" });
    const fetchRes = await fetch(`${origin}/api/ugc-ads/fetch-product`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const data = (await fetchRes.json().catch(() => ({}))) as Partial<ScrapedProduct> & { error?: string };
    if (!fetchRes.ok) throw new Error(data.error ?? "Scrape failed");
    const scraped: ScrapedProduct = {
      title: data.title ?? "", brand: data.brand ?? "", description: data.description ?? "",
      bullets: Array.isArray(data.bullets) ? data.bullets : [], price: data.price ?? "",
      imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : [], sourceUrl: url,
    };
    if (!scraped.title && !scraped.description) throw new Error("Scraper returned no usable product data.");
    send({ phase: "scraping", message: `Scraped "${scraped.title || "product"}" (${scraped.imageUrls.length} images).` });

    // ── enrichment: text + vision in parallel ──
    send({ phase: "enrich-text", message: "Structuring attributes from text + reading imagery…" });
    const [text, vision] = await Promise.all([
      enrichText(scraped),
      enrichVision(scraped, geminiKey),
    ]);
    const canonical = buildCanonical(scraped, text, vision);
    send({ phase: "enrich-vision", message: `Canonical record: ${canonical.attributes.length} attributes (${canonical.attributes.filter(a => a.source !== "text").length} from images), ${canonical.useCaseTags.length} use-case tags.`, canonical });

    // ── feed adapters ──
    const schemaOrg = buildSchemaOrg(canonical);
    const agentFeed = buildAgentFeed(canonical);
    send({ phase: "schema", message: "Built schema.org/Product + agent-feed.", schemaOrg, agentFeed });

    // ── visibility score ──
    const visibility = scoreVisibility(canonical, schemaOrg);
    send({ phase: "score", message: `Agent Visibility Score: ${visibility.score}/100 (${visibility.grade}).`, visibility });

    // ── measurement harness (before/after) ──
    let measurement: MeasurementReport | null = null;
    if (runMeasurement) {
      send({ phase: "measure", message: "Running agent queries before vs after enrichment…" });
      const queries = await generateAgentQueries(canonical);
      if (queries.length) {
        measurement = await runHarness(scraped, canonical, queries);
        send({ phase: "measure", message: measurement.summary, measurement });
      } else {
        send({ phase: "measure", message: "Skipped measurement — could not generate queries." });
      }
    }

    send({ phase: "done", message: "Audit complete." });
  } catch (e) {
    send({ phase: "error", message: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
  return;
}
