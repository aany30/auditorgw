/** Micro Drama · Step 1 — analyse a full script and extract the cast of characters. */
import type { NextApiRequest, NextApiResponse } from "next";
import { brandReason, parseJson } from "@/lib/media-analyser/ugc-new/brand-llm";
import { ANALYZE_SYSTEM, analyzeUser, ANALYZE_SCHEMA, AnalyzeResult, type DramaAnalysis, type DramaScene, type DramaCharacter } from "@/lib/media-analyser/micro-drama";

export const config = { maxDuration: 120 };

export interface MicroDramaAnalyzeResponse {
  analysis: DramaAnalysis;
  scenes: DramaScene[];
  characters: DramaCharacter[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  if (!(process.env.OPENAI_API_KEY ?? "").trim()) {
    return res.status(500).json({ error: "OPENAI_API_KEY is not configured (temporary demo routing)." });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const script = String(body.script ?? "").trim();
  if (script.length < 20) return res.status(400).json({ error: "Paste a script first (a few lines at least)." });

  try {
    const { raw } = await brandReason({ system: ANALYZE_SYSTEM, user: analyzeUser(script), schema: ANALYZE_SCHEMA, maxTokens: 3200 });
    const parsed = AnalyzeResult.parse(parseJson(raw));
    const characters = parsed.characters
      .map((c, i) => ({ ...c, id: c.id || `char-${i + 1}` }))
      .filter(c => c.name)
      .slice(0, 12);
    if (!characters.length) throw new Error("No characters were found — is this a script with characters?");
    const scenes = parsed.scenes
      .map((s, i) => ({ ...s, id: s.id || `scene-${i + 1}` }))
      .slice(0, 40);
    const out: MicroDramaAnalyzeResponse = { analysis: parsed.analysis, scenes, characters };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: `Script analysis failed: ${e instanceof Error ? e.message : e}` });
  }
}
