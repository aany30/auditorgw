/** UGC Playground — extract selectable product features/use-cases from scraped details. */
import type { NextApiRequest, NextApiResponse } from "next";
import { extractFeatures } from "@/lib/media-analyser/ugc-playground/stages";

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  if (!(process.env.GEMINI_API_KEY ?? "")) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const description = String(body.description ?? "").trim();
  const bullets = (Array.isArray(body.bullets) ? body.bullets : []).map(String).filter(Boolean).slice(0, 12);
  if (!description && !bullets.length) return res.status(400).json({ error: "No product details to extract features from." });
  try {
    const features = await extractFeatures({ title: String(body.title ?? ""), brand: String(body.brand ?? ""), description, bullets });
    return res.status(200).json({ features });
  } catch (e) {
    return res.status(502).json({ error: `Feature extraction failed: ${e instanceof Error ? e.message : e}` });
  }
}
