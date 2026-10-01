/** UGC New · Step 2 — cast a 4-persona grid for the chosen script (portraits on Seedream 5
 *  Pro via ARK, each QC-scored). Re-post to "Regenerate 4 personas". */
import type { NextApiRequest, NextApiResponse } from "next";
import { runPersonas } from "@/lib/media-analyser/ugc-new/stages";
import type { GeneratedPersona } from "@/lib/media-analyser/ugc-new/types";

export const config = { maxDuration: 300 };

export interface UGCPersonasResponse { personas: GeneratedPersona[]; }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });
  if (!(process.env.GEMINI_API_KEY ?? "")) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const productImageDataUrls = (Array.isArray(body.productImageDataUrls) ? body.productImageDataUrls : []).map(String).filter((u) => u.startsWith("data:image/")).slice(0, 3);
  const productDescription = String(body.productDescription ?? "").trim();
  const audienceLabel = String(body.audienceLabel ?? "").trim();
  const audienceDescription = String(body.audienceDescription ?? "").trim();
  const scriptAngle = String(body.scriptAngle ?? "").trim();
  const scriptContent = String(body.scriptContent ?? "").trim();

  if (productImageDataUrls.length < 2) return res.status(400).json({ error: "Add 2–3 product images so the creator can hold the product." });
  if (!scriptContent) return res.status(400).json({ error: "Pick a script first." });

  try {
    const personas = await runPersonas({ falKey, productImageDataUrls, productDescription, audienceLabel, audienceDescription, scriptAngle, scriptContent });
    if (!personas.some(p => p.imageDataUrl)) throw new Error("No usable persona portraits were generated — try different product images.");
    const out: UGCPersonasResponse = { personas };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: `Persona casting failed: ${e instanceof Error ? e.message : e}` });
  }
}
