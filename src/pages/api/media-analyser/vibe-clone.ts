import type { NextApiRequest, NextApiResponse } from "next";
import { editWithNanoBananaPro, type FalAspect } from "@/lib/media-analyser/fal";
import { normalizeImageModel } from "@/lib/media-analyser/generation-models";
import { analyzeImageForVibe, type VibeMode } from "@/lib/media-analyser/brandVisualDna";

export const config = { maxDuration: 300 };

export interface VibeCloneUpdate {
  phase: "analyzing" | "generating" | "result" | "done" | "error";
  index?: number;
  total?: number;
  sceneName?: string;
  summary?: string;
  palette?: string[];
  /** The reference image URL echoed for side-by-side display. */
  sourceUrl?: string;
  /** Generated output image URL. */
  imageUrl?: string;
  /** Whether product images were supplied (changes card labelling on the client). */
  hasProduct?: boolean;
  message?: string;
}

function normalizeAspect(a: unknown): FalAspect {
  return a === "1:1" || a === "4:5" || a === "9:16" || a === "16:9" ? a : "auto";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  // ?dry=1 — runs the full Gemini vibe analysis and streams results but skips
  // the FAL generation call. Used for testing / debugging without FAL credits.
  const isDryRun = req.query.dry === "1";

  // Validate input before touching server keys so malformed payloads get accurate 400s.
  const body = (req.body ?? {}) as Record<string, unknown>;
  const imageModel = normalizeImageModel(body.imageModel).id;

  const rawRef = body.imageDataUrls;
  const refUrls = (Array.isArray(rawRef) ? rawRef : rawRef ? [rawRef] : [])
    .map(u => String(u))
    .filter(u => u.startsWith("data:image/"));

  const rawProd = body.productDataUrls;
  const productUrls = (Array.isArray(rawProd) ? rawProd : rawProd ? [rawProd] : [])
    .map(u => String(u))
    .filter(u => u.startsWith("data:image/"))
    .slice(0, 6);

  const aspect = normalizeAspect(body.aspect);

  if (!refUrls.length) {
    return res.status(400).json({ error: "imageDataUrls must include at least one reference image" });
  }
  if (refUrls.length > 15) {
    return res.status(400).json({ error: "Maximum 15 reference images allowed" });
  }

  const falKey = process.env.FAL_KEY ?? "";
  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!isDryRun && !falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  // mode drives both the Gemini system prompt and the FAL call:
  // "restyle"          — reference image is both the vibe source AND the FAL input
  // "product_compose"  — extract scene from reference, composite user's product into it
  // "replace_product"  — reference already has a product; swap it for the user's product
  const rawProductMode = String(body.productMode ?? "product_compose");
  const productModeVal: VibeMode = productUrls.length > 0
    ? (rawProductMode === "replace_product" ? "replace_product" : "product_compose")
    : "restyle";
  const mode: VibeMode = productModeVal;
  const hasProduct = mode !== "restyle";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (u: VibeCloneUpdate) => res.write(`data: ${JSON.stringify(u)}\n\n`);

  const total = refUrls.length;

  try {
    for (let i = 0; i < refUrls.length; i++) {
      const refUrl = refUrls[i];

      // STAGE 1 — the vibe agent reads the reference image and writes a JSON prompt.
      send({
        phase: "analyzing",
        index: i,
        total,
        hasProduct,
        message: hasProduct
          ? `Extracting vibe from reference ${i + 1} of ${total}…`
          : `Reading the vibe of image ${i + 1} of ${total}…`,
      });

      let vibe;
      try {
        vibe = await analyzeImageForVibe(refUrl, geminiKey, mode);
      } catch (e) {
        send({ phase: "error", index: i, total, message: `Image ${i + 1}: vibe analysis failed (${String(e)})` });
        continue;
      }
      if (!vibe) {
        send({ phase: "error", index: i, total, message: `Image ${i + 1}: could not read a usable vibe.` });
        continue;
      }

      // STAGE 2 — Nano Banana Pro generates the output.
      send({
        phase: "generating",
        index: i,
        total,
        hasProduct,
        sceneName: vibe.sceneName,
        summary: vibe.summary,
        palette: vibe.palette,
        message: hasProduct
          ? `Compositing your product into vibe ${i + 1} of ${total}…`
          : `Generating image ${i + 1} of ${total}…`,
      });

      if (isDryRun) {
        // Dry run: emit the vibe analysis as a result without calling FAL.
        send({
          phase: "result",
          index: i,
          total,
          hasProduct,
          sceneName: vibe.sceneName,
          summary: vibe.summary,
          palette: vibe.palette,
          sourceUrl: refUrl,
          // No imageUrl — FAL was intentionally skipped.
        });
      } else {
        try {
          const fullPrompt = vibe.negativePrompt
            ? `${vibe.visualPrompt}\n\nDo not: ${vibe.negativePrompt}.`
            : vibe.visualPrompt;

          // In product_compose mode we pass all product angles — Nano Banana uses
          // them as multi-reference to preserve the product across angles.
          const falInputs = hasProduct ? productUrls : [refUrl];
          const img = await editWithNanoBananaPro(falKey, falInputs, fullPrompt, { aspect, model: imageModel });

          send({
            phase: "result",
            index: i,
            total,
            hasProduct,
            sceneName: vibe.sceneName,
            summary: vibe.summary,
            palette: vibe.palette,
            sourceUrl: refUrl,
            imageUrl: img.url,
          });
        } catch (e) {
          send({ phase: "error", index: i, total, message: `Image ${i + 1}: generation failed (${String(e)})` });
        }
      }
    }

    send({ phase: "done", total, hasProduct, message: "All images generated." });
  } catch (err) {
    send({ phase: "error", message: String(err) });
  } finally {
    res.end();
  }
}
