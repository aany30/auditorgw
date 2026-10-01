import type { NextApiRequest, NextApiResponse } from "next";
import { extractBrandVisualDnaFromBase64 } from "@/lib/media-analyser/brandVisualDna";

export const config = { maxDuration: 120 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!geminiKey) {
    return res.status(500).json({ success: false, reason: "GEMINI_API_KEY is not configured" });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawUrls = Array.isArray(body.brandDataUrls) ? body.brandDataUrls : [];
  const brandDataUrls = (rawUrls as unknown[])
    .map(u => String(u))
    .filter(u => u.startsWith("data:image/"));

  if (brandDataUrls.length < 2) {
    return res.status(400).json(
      { success: false, reason: "Upload at least 2 brand identity images for analysis" },
    );
  }
  if (brandDataUrls.length > 15) {
    return res.status(400).json(
      { success: false, reason: "Maximum 15 brand identity images allowed" },
    );
  }

  try {
    const result = await extractBrandVisualDnaFromBase64(brandDataUrls, geminiKey);
    if (!result) {
      return res.status(422).json(
        {
          success: false,
          reason:
            "Could not extract brand visual DNA from these images. Try uploading clearer, more diverse brand images (posts, ads, lookbook shots) — at least 2 are required.",
        },
      );
    }
    return res.status(200).json({ success: true, ...result });
  } catch (e) {
    console.error("[extract-brand-dna]", e);
    return res.status(500).json({ success: false, reason: String(e) });
  }
}
