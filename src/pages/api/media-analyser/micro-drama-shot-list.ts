/** Micro Drama · Step 3 — shot list generator: break the analysed scenes into clips
 *  (angle / movement / cut / action / dialogue) per scene. */
import type { NextApiRequest, NextApiResponse } from "next";
import { brandReason, parseJson } from "@/lib/media-analyser/ugc-new/brand-llm";
import { SHOTLIST_SYSTEM, shotlistUser, SHOTLIST_SCHEMA, ShotListResult, DramaAnalysis, DramaScene, type SceneShotList } from "@/lib/media-analyser/micro-drama";

export const config = { maxDuration: 180 };

export interface MicroDramaShotListResponse { scenes: SceneShotList[] }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  if (!(process.env.OPENAI_API_KEY ?? "").trim()) {
    return res.status(500).json({ error: "OPENAI_API_KEY is not configured (temporary demo routing)." });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  let analysis: DramaAnalysis, scenes: DramaScene[];
  try {
    analysis = DramaAnalysis.parse(body.analysis);
    scenes = (Array.isArray(body.scenes) ? body.scenes : []).map(s => DramaScene.parse(s));
  } catch { return res.status(400).json({ error: "Missing analysis or scenes — run the script analysis first." }); }
  if (!scenes.length) return res.status(400).json({ error: "No scenes to build shots from." });

  try {
    const { raw } = await brandReason({ system: SHOTLIST_SYSTEM, user: shotlistUser({ analysis, scenes }), schema: SHOTLIST_SCHEMA, maxTokens: 4000 });
    const parsed = ShotListResult.parse(parseJson(raw));
    const out: MicroDramaShotListResponse = {
      scenes: parsed.scenes.map((sc, si) => ({
        ...sc,
        sceneId: sc.sceneId || scenes[si]?.id || `scene-${si + 1}`,
        sceneHeading: sc.sceneHeading || scenes[si]?.heading || "",
        shots: sc.shots.map((sh, i) => ({ ...sh, id: sh.id || `${sc.sceneId || `scene-${si + 1}`}-shot-${i + 1}` })),
      })),
    };
    if (!out.scenes.some(s => s.shots.length)) throw new Error("No shots were produced.");
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: `Shot list failed: ${e instanceof Error ? e.message : e}` });
  }
}
