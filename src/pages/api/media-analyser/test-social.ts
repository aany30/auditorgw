import type { NextApiRequest, NextApiResponse } from "next";
import { fetchProductSocialInsights, isSocialStepEnabled } from "@/lib/media-analyser/meta-social";
import { CombinedScraperDataSchema } from "@/lib/media-analyser/types";

export const config = { maxDuration: 300 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = String(body.url ?? "").trim();
  const socialSource = (body.socialSource as string | undefined) ?? "auto";
  const instagramHandle = String(body.instagramHandle ?? "").trim();

  if (!url && !instagramHandle) {
    return res.status(400).json({ error: "Provide a product URL or an Instagram handle" });
  }

  if (!isSocialStepEnabled(socialSource as "auto" | "graph" | "public")) {
    return res.status(503).json({ error: "Social scraping disabled — set META_SOCIAL_ENABLED or PUBLIC_SOCIAL_ENABLED in env" });
  }

  try {
    const stub = CombinedScraperDataSchema.parse({ scope: "ecom" });
    const [social, counts, warning] = await fetchProductSocialInsights(url, stub, socialSource as "auto" | "graph" | "public", instagramHandle || undefined);
    return res.status(200).json({ ok: true, social, counts, warning });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
