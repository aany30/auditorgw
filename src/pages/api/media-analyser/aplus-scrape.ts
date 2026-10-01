import type { NextApiRequest, NextApiResponse } from "next";
import { scrapeProductForAplus } from "@/lib/media-analyser/aplus-scrape";

export const config = { maxDuration: 120 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as { url?: string };
  const url = String(body.url ?? "").trim();
  if (!url) return res.status(400).json({ error: "url is required" });
  try {
    const data = await scrapeProductForAplus(url);
    if (!data.imageUrls.length) {
      return res.status(422).json({ error: "Scraped the product but found no images — paste image URLs manually." });
    }
    return res.status(200).json({ ok: true, ...data });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
