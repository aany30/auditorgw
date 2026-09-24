import type { NextApiRequest, NextApiResponse } from "next";
import { fetchEcomAudit, healthCheck, EcomScraperError, EcomScraperUnavailable } from "@/lib/media-analyser/ecom-client";

export const config = { maxDuration: 300 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = String(body.url ?? "").trim();
  if (!url) return res.status(400).json({ error: "url is required" });

  const ok = await healthCheck();
  if (!ok) return res.status(503).json({ error: "Ecom scraper not configured (no RAINFOREST_API_KEY or CUSTOM_SCRAPER_URL)" });

  try {
    const result = await fetchEcomAudit(url);
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    if (err instanceof EcomScraperUnavailable) return res.status(503).json({ error: err.message });
    if (err instanceof EcomScraperError) return res.status(422).json({ error: err.message });
    return res.status(500).json({ error: String(err) });
  }
}
