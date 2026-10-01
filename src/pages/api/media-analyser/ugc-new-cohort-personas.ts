/** Claude Cohort Studio · Step 2 — break a chosen cohort into 3-4 castable personas. */
import type { NextApiRequest, NextApiResponse } from "next";
import { brandReason, parseJson } from "@/lib/media-analyser/ugc-new/brand-llm";
import { PERSONAS_SYSTEM, personasUser, PERSONAS_SCHEMA, BrandAnalysis, Cohort, CohortPersona } from "@/lib/media-analyser/ugc-new/cohort-studio";

export const config = { maxDuration: 120 };

export interface CohortPersonasResponse { personas: CohortPersona[]; engine: "claude" | "gemini" }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const country = String(body.country ?? "").trim().slice(0, 80);
  let analysis: BrandAnalysis, cohort: Cohort;
  try { analysis = BrandAnalysis.parse(body.analysis); cohort = Cohort.parse(body.cohort); }
  catch { return res.status(400).json({ error: "Missing brand analysis or cohort." }); }
  if (!cohort.name) return res.status(400).json({ error: "Pick a cohort first." });

  try {
    const { raw, engine } = await brandReason({ system: PERSONAS_SYSTEM, user: personasUser({ analysis, cohort, country }), schema: PERSONAS_SCHEMA, maxTokens: 1800 });
    const parsed = parseJson<unknown>(raw);
    // Tolerate a bare array, {personas:[...]}, or {anyKey:[...]}.
    const arr: unknown[] = Array.isArray(parsed) ? parsed
      : Array.isArray((parsed as { personas?: unknown[] })?.personas) ? (parsed as { personas: unknown[] }).personas
      : (Object.values((parsed ?? {}) as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined) ?? [];
    const personas = arr.map((p, i) => { const cp = CohortPersona.parse(p); return { ...cp, id: cp.id || `p-${i + 1}` }; }).filter(p => p.name).slice(0, 6);
    if (!personas.length) throw new Error("No personas were produced for that cohort.");
    const out: CohortPersonasResponse = { personas, engine };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: `Persona suggestion failed: ${e instanceof Error ? e.message : e}` });
  }
}
