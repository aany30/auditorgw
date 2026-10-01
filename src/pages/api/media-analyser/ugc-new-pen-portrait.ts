/** Claude Cohort Studio · Pen-Portrait — expand a selected persona into a full
 *  "World + Persona" dashboard (Fable), returned as structured JSON for the UI board. */
import type { NextApiRequest, NextApiResponse } from "next";
import { brandReason, parseJson } from "@/lib/media-analyser/ugc-new/brand-llm";
import { PEN_SYSTEM, penUser, type PenPortrait } from "@/lib/media-analyser/ugc-new/pen-portrait";
import { BrandAnalysis, Cohort, CohortPersona } from "@/lib/media-analyser/ugc-new/cohort-studio";

export const config = { maxDuration: 300 };

export interface PenPortraitResponse { portrait: PenPortrait; engine: "claude" | "gemini" }

/** Parse the model's JSON, repairing the common missing-comma case if needed. */
function tolerantParse(raw: string): unknown {
  try { return parseJson(raw); } catch { /* repair below */ }
  let t = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  t = t.replace(/"(\s*)("[^"]{1,48}"\s*:)/g, '",$1$2').replace(/\}(\s*)\{/g, "},$1{");
  return JSON.parse(t);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const country = String(body.country ?? "").trim().slice(0, 80);
  let analysis: BrandAnalysis, cohort: Cohort, persona: CohortPersona;
  try {
    analysis = BrandAnalysis.parse(body.analysis);
    cohort = Cohort.parse(body.cohort);
    persona = CohortPersona.parse(body.persona);
  } catch { return res.status(400).json({ error: "Missing analysis / cohort / persona." }); }

  try {
    const { raw, engine } = await brandReason({
      system: PEN_SYSTEM,
      user: penUser({ analysis, cohort, persona, country }),
      plainText: true,          // PEN_SYSTEM already specifies the JSON shape — skip the extra hint + token cap
      maxTokens: 8000,
      model: process.env.ANTHROPIC_PEN_MODEL || "claude-fable-5-1",
      timeoutMs: 600_000,
    });
    const portrait = tolerantParse(raw) as PenPortrait;
    if (!portrait || typeof portrait !== "object" || !portrait.title) throw new Error("Empty or malformed portrait.");
    const out: PenPortraitResponse = { portrait, engine };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: `Pen portrait failed: ${e instanceof Error ? e.message : e}` });
  }
}
