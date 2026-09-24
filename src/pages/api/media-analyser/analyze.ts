import type { NextApiRequest, NextApiResponse } from "next";
import { CombinedScraperDataSchema } from "@/lib/media-analyser/types";
import { analyzeScraperInsights } from "@/lib/media-analyser/service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const useLlm = body.useLlm !== false;
  const rawData = body.data ?? body;

  const parsed = CombinedScraperDataSchema.safeParse(rawData);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  try {
    const result = await analyzeScraperInsights(parsed.data, { useLlm });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
