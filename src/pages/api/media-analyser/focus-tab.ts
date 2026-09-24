import type { NextApiRequest, NextApiResponse } from "next";
import { FOCUS_LENSES, type DataConfidenceReport, type FocusLensResult } from "@/lib/media-analyser/focus-lenses";
import { generateFocusLens } from "@/lib/media-analyser/focus-agents";

export const config = { maxDuration: 120 };

export interface FocusTabResponse {
  lens: string;
  result: FocusLensResult;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const lensKey = String(body.lens ?? "");
  const lens = FOCUS_LENSES.find(l => l.key === lensKey);
  if (!lens) return res.status(400).json({ error: `Unknown lens "${lensKey}".` });

  if (!body.input || typeof body.input !== "object") {
    return res.status(400).json({ error: "A compact audit snapshot (input) is required." });
  }
  const qa = (body.qa && typeof body.qa === "object" ? body.qa : null) as DataConfidenceReport | null;

  try {
    const result = await generateFocusLens(geminiKey, lens.key, body.input, qa);
    const out: FocusTabResponse = { lens: lens.key, result };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: `Could not generate the ${lens.label} lens: ${e instanceof Error ? e.message : String(e)}` });
  }
}
