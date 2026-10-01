/**
 * Clone Reel · Step 1 — turn a competitor's analysed reel into a plan for OUR product.
 *
 * Takes the AI reel analysis (type / format / setting / depicts / showcases / actor) and the
 * user's product, and writes a single-shot 15-second plan that mirrors the competitor reel's
 * WINNING STRUCTURE — but features our product as the hero (no competitor branding). Output
 * feeds the Seedream keyframe (Step 2) and the Seedance 15s clip (Step 3).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { callVisionLLM, type VisionUserPart } from "@/lib/media-analyser/vision-llm";
import { geminiVisionModels } from "@/lib/media-analyser/gemini-models";

export const config = { maxDuration: 60 };

export interface CloneReelPlan {
  script: string;
  keyframePrompt: string;
  motionPrompt: string;
}

const SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    script: { type: "string" },
    keyframePrompt: { type: "string" },
    motionPrompt: { type: "string" },
  },
  required: ["script", "keyframePrompt", "motionPrompt"],
  additionalProperties: false,
};

const SYSTEM = `You are a short-form ad director. A competitor is running a winning reel; recreate its WINNING STRUCTURE for OUR product as ONE 15-second vertical video. Do NOT copy their product or branding — OUR product (shown in the reference images) is the hero. Return ONLY JSON with exactly:
- "script": the 15s concept as 2-4 short beats (hook → demo → payoff) — the on-screen action and any spoken line, in plain text.
- "keyframePrompt": ONE vivid image prompt for the opening hero frame — same vibe / setting / energy as the competitor reel, OUR product as the clear hero, photorealistic, vertical 9:16, natural lighting, NO text overlays, NO competitor logos.
- "motionPrompt": camera movement + action for a single 15-second Seedance clip that mirrors the competitor reel's format and pacing while keeping OUR product the focus.
No preamble, no markdown — JSON only.`;

function parsePlan(raw: string): CloneReelPlan {
  const m = raw.match(/\{[\s\S]*\}/);
  const obj = JSON.parse(m ? m[0] : raw) as Partial<CloneReelPlan>;
  const s = (v: unknown) => String(v ?? "").trim();
  if (!s(obj.keyframePrompt) || !s(obj.motionPrompt)) throw new Error("plan missing prompts");
  return { script: s(obj.script), keyframePrompt: s(obj.keyframePrompt), motionPrompt: s(obj.motionPrompt) };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const reel = (body.reel ?? {}) as Record<string, unknown>;
  const productName = String(body.productName ?? "").trim().slice(0, 200);
  const g = (k: string) => String(reel[k] ?? "").trim();

  const brief = [
    `COMPETITOR REEL (to mirror the structure of, NOT to copy):`,
    `- Type: ${g("reel_type_label") || g("reel_type") || "reel"}`,
    g("format") && `- Format: ${g("format")}`,
    g("setting") && `- Setting: ${g("setting")}`,
    (g("actor_description") || g("actor_name")) && `- Actor/creator: ${g("actor_name") || g("actor_description")}`,
    g("depicts") && `- What it depicts: ${g("depicts")}`,
    g("showcases") && `- What it showcases: ${g("showcases")}`,
    g("spoken_language") && `- Language: ${g("spoken_language")}`,
    ``,
    `OUR PRODUCT: ${productName || "(see the attached reference images)"}`,
    `Write the 15-second clone plan now.`,
  ].filter(Boolean).join("\n");

  const parts: VisionUserPart[] = [{ text: brief }];

  try {
    const raw = await callVisionLLM(SYSTEM, parts, geminiKey, {
      jsonMode: true, responseSchema: SCHEMA, models: geminiVisionModels(), maxTokens: 1200, geminiOnly: false,
    });
    return res.status(200).json(parsePlan(raw));
  } catch (e) {
    return res.status(502).json({ error: `Could not plan the clone: ${e instanceof Error ? e.message : String(e)}` });
  }
}
