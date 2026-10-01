/** Claude Cohort Studio · Strategy document — generate the Cohort → Persona → Pen Portrait
 *  strategy doc (with Nano Banana + Seedream prompts per persona) as markdown for download. */
import type { NextApiRequest, NextApiResponse } from "next";
import { brandReason } from "@/lib/media-analyser/ugc-new/brand-llm";
import { DOC_SYSTEM, docUser, BrandAnalysis, Cohort, CohortPersona } from "@/lib/media-analyser/ugc-new/cohort-studio";

export const config = { maxDuration: 300 };

export interface CohortDocResponse { markdown: string; engine: "claude" | "gemini" }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const country = String(body.country ?? "").trim().slice(0, 80);
  let analysis: BrandAnalysis, cohorts: Cohort[], personaGroups: { cohort: Cohort; personas: CohortPersona[] }[];
  try {
    analysis = BrandAnalysis.parse(body.analysis);
    cohorts = (Array.isArray(body.cohorts) ? body.cohorts : []).map(c => Cohort.parse(c));
    personaGroups = (Array.isArray(body.personaGroups) ? body.personaGroups : []).map(g => {
      const gg = g as { cohort?: unknown; personas?: unknown[] };
      return { cohort: Cohort.parse(gg.cohort), personas: (Array.isArray(gg.personas) ? gg.personas : []).map(p => CohortPersona.parse(p)) };
    });
  } catch { return res.status(400).json({ error: "Missing analysis / cohorts / personas." }); }
  if (!cohorts.length) return res.status(400).json({ error: "Run the analysis first." });

  try {
    const { raw, engine } = await brandReason({
      system: DOC_SYSTEM,
      user: docUser({ analysis, country, cohorts, personaGroups }),
      plainText: true,
      maxTokens: 8000,
      model: process.env.ANTHROPIC_DOC_MODEL, // undefined → default (Sonnet)
      timeoutMs: 600_000,
    });
    const markdown = raw.replace(/```(?:markdown)?/gi, "").trim();
    if (!markdown) throw new Error("Empty document.");
    const out: CohortDocResponse = { markdown, engine };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: `Document generation failed: ${e instanceof Error ? e.message : e}` });
  }
}
