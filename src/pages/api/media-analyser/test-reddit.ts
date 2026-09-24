import type { NextApiRequest, NextApiResponse } from "next";
import { fetchProductRedditReviews, isRedditReviewsEnabled } from "@/lib/media-analyser/reddit";
import { CombinedScraperDataSchema } from "@/lib/media-analyser/types";

export const config = { maxDuration: 120 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = String(body.url ?? "").trim();
  if (!url) return res.status(400).json({ error: "url is required" });

  if (!isRedditReviewsEnabled()) {
    return res.status(503).json({ error: "Reddit reviews disabled — set REDDIT_REVIEWS_ENABLED=true in env" });
  }

  try {
    const stub = CombinedScraperDataSchema.parse({ scope: "ecom" });
    const [reddit, counts, warning] = await fetchProductRedditReviews(url, stub);
    return res.status(200).json({ ok: true, reddit, counts, warning });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
