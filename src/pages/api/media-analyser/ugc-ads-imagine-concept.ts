/**
 * "Imagine concept" -- expand a user's one-line idea into a full, shootable CINEMATIC ad concept
 * BEFORE any script/storyboard is written.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { callVisionLLM, type VisionUserPart } from "@/lib/media-analyser/vision-llm";
import { geminiVisionModels } from "@/lib/media-analyser/gemini-models";

export const config = { maxDuration: 60 };

const SYSTEM = `You are a creative director for short-form (15s) product video ads. Expand the user's rough one-line idea into ONE vivid, shootable CINEMATIC concept (no spoken dialogue). Cover: the creative angle/hook, the visual story arc, the mood + lighting, and how the product stays the hero. Keep it concrete and directable — 3 to 5 sentences, a single paragraph. Return ONLY the concept text: no preamble, no headings, no bullet lists, no quotes.`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const idea = String(body.idea ?? "").trim().slice(0, 400);
  if (!idea) return res.status(400).json({ error: "Write a one-line idea first." });

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });

  const productTitle = String(body.productTitle ?? "").trim().slice(0, 200);
  const imgs = (Array.isArray(body.imageDataUrls) ? body.imageDataUrls : [])
    .map(u => String(u)).filter(u => u.startsWith("data:image/")).slice(0, 3);

  const parts: VisionUserPart[] = [];
  for (const u of imgs) {
    const m = u.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  parts.push({ text: `Product: ${productTitle || (imgs.length ? "(see attached product images)" : "(not specified)")}\nOne-line idea: ${idea}\n\nWrite the cinematic concept now.` });

  try {
    const concept = (await callVisionLLM(SYSTEM, parts, geminiKey, { maxTokens: 600, models: geminiVisionModels() })).trim();
    if (!concept) return res.status(502).json({ error: "Could not imagine a concept -- try rephrasing your idea." });
    return res.status(200).json({ concept });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
