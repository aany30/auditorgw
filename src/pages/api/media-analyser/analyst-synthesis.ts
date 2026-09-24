import type { NextApiRequest, NextApiResponse } from "next";
import { FOCUS_LENSES, type DataConfidenceReport, type FocusLensResult, type FocusLensKey, type ChiefAnalystResult } from "@/lib/media-analyser/focus-lenses";
import { generateFocusLens, runChiefAnalyst } from "@/lib/media-analyser/focus-agents";

export const config = { maxDuration: 300 };

export interface AnalystSynthesisResponse {
  agents: Partial<Record<FocusLensKey, FocusLensResult>>;
  synthesis: ChiefAnalystResult;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!body.input || typeof body.input !== "object") {
    return res.status(400).json({ error: "A compact audit snapshot (input) is required." });
  }
  const qa = (body.qa && typeof body.qa === "object" ? body.qa : null) as DataConfidenceReport | null;
  if (!qa) return res.status(400).json({ error: "A Data Confidence report (qa) is required." });

  try {
    const settled = await Promise.allSettled(
      FOCUS_LENSES.map(l => generateFocusLens(geminiKey, l.key, body.input, qa)),
    );
    const agents: Partial<Record<FocusLensKey, FocusLensResult>> = {};
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") agents[FOCUS_LENSES[i].key] = r.value;
      else console.warn(`[analyst] ${FOCUS_LENSES[i].key} agent failed: ${r.reason}`);
    });
    if (!Object.keys(agents).length) {
      return res.status(502).json({ error: "All domain agents failed to produce a verdict." });
    }

    const synthesis = await runChiefAnalyst(geminiKey, { input: body.input, qa, verdicts: agents });
    const out: AnalystSynthesisResponse = { agents, synthesis };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: `Synthesis failed: ${e instanceof Error ? e.message : String(e)}` });
  }
}
