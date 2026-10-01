/** Claude Cohort Studio · Step 1 — scrape a product URL, analyse the brand (Claude, with
 *  vision over its imagery), and suggest audience cohorts. */
import type { NextApiRequest, NextApiResponse } from "next";
import { imageToInput, brandReason, parseJson } from "@/lib/media-analyser/ugc-new/brand-llm";
import { ANALYZE_SYSTEM, analyzeUser, ANALYZE_SCHEMA, AnalyzeResult, type BrandAnalysis, type Cohort } from "@/lib/media-analyser/ugc-new/cohort-studio";

export const config = { maxDuration: 300 };

export type AnalyzeMode = "normal" | "deep";

export interface BrandAnalyzeResponse {
  analysis: BrandAnalysis;
  cohorts: Cohort[];
  engine: "claude" | "gemini";
  mode: AnalyzeMode; // which analysis depth ran
  model: string;     // the Claude model used (sonnet for normal, fable for deep)
  images: string[]; // scraped product image URLs (for the UI + downstream casting)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  if (!(process.env.OPENROUTER_API_KEY ?? "").trim()) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured (temporary demo routing). Set OPENROUTER_API_KEY and redeploy." });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = String(body.url ?? "").trim();
  const country = String(body.country ?? "").trim().slice(0, 80);
  const mode: AnalyzeMode = body.mode === "deep" ? "deep" : "normal";
  // Normal analysis → Sonnet 5 (latest, fast+solid). Deep analysis → Fable 5.1 (latest, more thorough).
  const model = mode === "deep"
    ? (process.env.ANTHROPIC_ANALYZE_MODEL || "claude-fable-5-1")
    : (process.env.ANTHROPIC_NORMAL_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-5");
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "Paste a full product URL (http/https)." });

  const proto = req.headers["x-forwarded-proto"] ?? "http";
  const host = req.headers.host ?? "localhost:3000";
  const origin = `${proto}://${host}`;
  try {
    // Scrape product details + imagery (reuse the single-product scraper).
    const sres = await fetch(`${origin}/api/ugc-ads/fetch-product`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const s = (await sres.json().catch(() => ({}))) as { title?: string; brand?: string; description?: string; bullets?: string[]; imageUrls?: string[]; error?: string };
    if (!sres.ok) throw new Error(s.error ?? "Could not scrape that product.");
    const imageUrls = (Array.isArray(s.imageUrls) ? s.imageUrls : []).slice(0, 10);

    // Deep analysis looks at more imagery + gets more room to reason than normal.
    const imgCount = mode === "deep" ? 6 : 4;
    const images = (await Promise.all(imageUrls.slice(0, imgCount).map(imageToInput))).filter((x): x is NonNullable<typeof x> => !!x);

    const { raw, engine } = await brandReason({
      system: ANALYZE_SYSTEM,
      user: analyzeUser({ title: s.title, brand: s.brand, description: s.description, bullets: s.bullets, url, imageCount: images.length, country, deep: mode === "deep" }),
      images,
      schema: ANALYZE_SCHEMA,
      maxTokens: mode === "deep" ? 4096 : 2600,
      // Normal → Sonnet; Deep → Fable. Overridable via env.
      model,
      timeoutMs: 600_000,
    });
    // Tolerant of shape drift: Fable (esp. deep mode) sometimes returns the analysis fields
    // flat at the top level, or as a JSON string, instead of nested under `analysis`.
    const rawObj = (parseJson(raw) ?? {}) as Record<string, unknown>;
    let analysisSrc: unknown = rawObj.analysis;
    if (typeof analysisSrc === "string") { try { analysisSrc = JSON.parse(analysisSrc); } catch { /* keep string → fallback below */ } }
    if (!analysisSrc || typeof analysisSrc !== "object") analysisSrc = rawObj; // flat shape
    const asObj = analysisSrc as Record<string, unknown>;
    const cohortsSrc = Array.isArray(rawObj.cohorts) ? rawObj.cohorts
      : Array.isArray(asObj.cohorts) ? asObj.cohorts
      : [];
    const parsed = AnalyzeResult.parse({ analysis: analysisSrc, cohorts: cohortsSrc });
    if (!parsed.cohorts.length) throw new Error("No cohorts were produced — try a richer product page.");
    const cohorts = parsed.cohorts.map((c, i) => ({ ...c, id: c.id || `cohort-${i + 1}` }));

    const out: BrandAnalyzeResponse = { analysis: parsed.analysis, cohorts, engine, mode, model, images: imageUrls };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: `Brand analysis failed: ${e instanceof Error ? e.message : e}` });
  }
}
