/** Claude Cohort Studio · Step 3 — write the 15s UGC script + casting brief for a persona. */
import type { NextApiRequest, NextApiResponse } from "next";
import { brandReason, parseJson } from "@/lib/media-analyser/ugc-new/brand-llm";
import { SCRIPT_SYSTEM, scriptUser, SCRIPT_SCHEMA, BrandAnalysis, Cohort, CohortPersona, CohortScript } from "@/lib/media-analyser/ugc-new/cohort-studio";

export const config = { maxDuration: 120 };

export interface CohortScriptResponse extends CohortScript { engine: "claude" | "gemini" }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  let analysis: BrandAnalysis, cohort: Cohort, persona: CohortPersona;
  try { analysis = BrandAnalysis.parse(body.analysis); cohort = Cohort.parse(body.cohort); persona = CohortPersona.parse(body.persona); }
  catch { return res.status(400).json({ error: "Missing analysis, cohort, or persona." }); }
  if (!persona.name) return res.status(400).json({ error: "Pick a persona first." });

  try {
    const { raw, engine } = await brandReason({ system: SCRIPT_SYSTEM, user: scriptUser({ analysis, cohort, persona }), schema: SCRIPT_SCHEMA, maxTokens: 900 });
    const rawObj = parseJson<Record<string, unknown>>(raw);
    // Tolerate a wrapped object, e.g. {result:{script:...}}.
    const obj = (rawObj && typeof rawObj === "object" && rawObj.script === undefined)
      ? ((Object.values(rawObj).find(v => v && typeof v === "object" && "script" in (v as object)) as Record<string, unknown> | undefined) ?? rawObj)
      : rawObj;
    const parsed = CohortScript.parse(obj);
    if (!parsed.script) throw new Error("No script was produced.");
    const out: CohortScriptResponse = { ...parsed, engine };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: `Script generation failed: ${e instanceof Error ? e.message : e}` });
  }
}
