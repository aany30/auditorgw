/** UGC New · Step 1 — generate the 3 script angles (Punchy / Story-driven / Direct benefit).
 *  Initial call runs intake → brief → scripts. "Regenerate" re-posts with the cached brief +
 *  audience so it only re-runs the (fast) script stage and returns 3 fresh takes. */
import type { NextApiRequest, NextApiResponse } from "next";
import { runIntake, runBrief, runScripts } from "@/lib/media-analyser/ugc-new/stages";
import type { GeneratedScript } from "@/lib/media-analyser/ugc-new/types";

export const config = { maxDuration: 300 };

export interface UGCScriptsResponse {
  scripts: GeneratedScript[];
  audienceLabel: string;
  audienceDescription: string;
  productDescription: string;
  productUrl: string;
  brief: string;
  missing: string[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  if (!(process.env.GEMINI_API_KEY ?? "")) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
  const body = (req.body ?? {}) as Record<string, unknown>;

  const pastedText = String(body.pastedText ?? "").trim();
  const productUrl = String(body.productUrl ?? "").trim();
  const pdfDataUrl = typeof body.pdfDataUrl === "string" && body.pdfDataUrl.startsWith("data:application/pdf") ? body.pdfDataUrl : "";
  const imageCount = (Array.isArray(body.productImageDataUrls) ? body.productImageDataUrls : []).filter((u) => String(u).startsWith("data:image/")).length;
  const steering = String(body.steering ?? "").trim();

  // Fast path (Regenerate): brief + audience already known → skip intake/brief.
  const cachedBrief = String(body.brief ?? "").trim();
  const cachedAudienceLabel = String(body.audienceLabel ?? "").trim();
  const cachedAudienceDescription = String(body.audienceDescription ?? "").trim();

  try {
    if (cachedBrief && cachedAudienceLabel) {
      const scripts = await runScripts({ brief: cachedBrief, audienceLabel: cachedAudienceLabel, audienceDescription: cachedAudienceDescription });
      const out: UGCScriptsResponse = { scripts, audienceLabel: cachedAudienceLabel, audienceDescription: cachedAudienceDescription, productDescription: String(body.productDescription ?? ""), productUrl, brief: cachedBrief, missing: [] };
      return res.status(200).json(out);
    }

    if (!pastedText && !pdfDataUrl) return res.status(400).json({ error: "Paste some material or attach a PDF to start." });

    const intake = await runIntake({ pastedText, productUrl, pdfDataUrl, imageCount });
    const { brief } = await runBrief({ productDescription: intake.productDescription, otherInfo: intake.otherInfo, productUrl: intake.productUrl, steering, imageCount, pdfDataUrl });
    const scripts = await runScripts({ brief, audienceLabel: intake.audienceLabel, audienceDescription: intake.audienceDescription });
    if (!scripts.some(s => s.content)) throw new Error("No usable scripts were generated — add more product detail.");

    const out: UGCScriptsResponse = {
      scripts,
      audienceLabel: intake.audienceLabel,
      audienceDescription: intake.audienceDescription,
      productDescription: intake.productDescription,
      productUrl: intake.productUrl,
      brief,
      missing: intake.missing ?? [],
    };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: `Script generation failed: ${e instanceof Error ? e.message : e}` });
  }
}
