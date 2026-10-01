import type { NextApiRequest, NextApiResponse } from "next";
import { editWithNanoBananaPro, type FalAspect } from "@/lib/media-analyser/fal";
import { normalizeImageModel } from "@/lib/media-analyser/generation-models";
import { extractCombinedVibeFromImages, shotSpecToPrompt } from "@/lib/media-analyser/brandVisualDna";

export const config = { maxDuration: 300 };

export interface VibeMatchUpdate {
  phase: "extracting" | "vibe_ready" | "generating" | "result" | "done" | "error";
  /** Emitted once after vibe extraction (vibe_ready phase). */
  vibeSummary?: string;
  vibeConfidence?: string;
  palette?: string[];
  colourTone?: string;
  promptCount?: number;
  /** Per shot-spec generation. */
  index?: number;
  total?: number;
  sceneName?: string;
  shotId?: string;
  imageUrl?: string;
  message?: string;
}

function normalizeAspect(a: unknown): FalAspect {
  return a === "1:1" || a === "4:5" || a === "9:16" || a === "16:9" ? a : "auto";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  // ?dry=1 — runs Gemini extraction and streams results but skips FAL generation.
  const isDryRun = req.query.dry === "1";

  const body = (req.body ?? {}) as Record<string, unknown>;
  const imageModel = normalizeImageModel(body.imageModel).id;

  const rawRef = body.referenceDataUrls ?? body.imageDataUrls;
  const refUrls = (Array.isArray(rawRef) ? rawRef : rawRef ? [rawRef] : [])
    .map(u => String(u))
    .filter(u => u.startsWith("data:image/"));

  const rawProd = body.productDataUrls;
  const productUrls = (Array.isArray(rawProd) ? rawProd : rawProd ? [rawProd] : [])
    .map(u => String(u))
    .filter(u => u.startsWith("data:image/"))
    .slice(0, 6);

  // User-selected fallback aspect; each shot spec's own ar overrides this.
  const fallbackAspect = normalizeAspect(body.aspect);

  if (refUrls.length < 2) {
    return res.status(400).json({ error: "Upload at least 2 reference images to extract a combined vibe" });
  }
  if (refUrls.length > 15) {
    return res.status(400).json({ error: "Maximum 15 reference images allowed" });
  }
  if (!productUrls.length) {
    return res.status(400).json({ error: "At least one product image is required for Vibe Match" });
  }

  const falKey = process.env.FAL_KEY ?? "";
  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!isDryRun && !falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (u: VibeMatchUpdate) => res.write(`data: ${JSON.stringify(u)}\n\n`);

  try {
    // STAGE 1 — one Gemini call across ALL reference images → v2 shot-spec output.
    send({
      phase: "extracting",
      message: `Synthesising combined vibe from ${refUrls.length} reference image${refUrls.length !== 1 ? "s" : ""}…`,
    });

    const vibe = await extractCombinedVibeFromImages(refUrls, geminiKey);
    if (!vibe || !vibe.shotSpecs.length) {
      send({ phase: "error", message: "Could not extract a combined vibe. Try using fewer reference images or images with a more consistent look and feel." });
      res.end();
      return;
    }

    const palette = vibe.palette;
    const colourTone = vibe.paletteV2?.colour_tone;
    const total = vibe.shotSpecs.length;

    send({
      phase: "vibe_ready",
      vibeSummary: vibe.summary,
      vibeConfidence: vibe.confidence,
      palette,
      colourTone,
      promptCount: total,
      message: `Combined vibe extracted (${vibe.confidence} confidence) — generating ${total} product render${total !== 1 ? "s" : ""}…`,
    });

    // STAGE 2 — render the product in each shot spec.
    for (let i = 0; i < vibe.shotSpecs.length; i++) {
      const spec = vibe.shotSpecs[i];
      const label = spec.shot_label || spec.shot_id || `Scene ${i + 1}`;
      send({
        phase: "generating",
        index: i,
        total,
        sceneName: label,
        shotId: spec.shot_id,
        message: `Compositing your product into shot ${i + 1} of ${total}: "${label}"…`,
      });

      if (isDryRun) {
        send({ phase: "result", index: i, total, sceneName: label, shotId: spec.shot_id });
        continue;
      }

      try {
        const prompt = shotSpecToPrompt(spec);
        const fullPrompt = spec.negativePrompt
          ? `${prompt}\n\nDo not: ${spec.negativePrompt}.`
          : prompt;
        // Each shot spec carries its own aspect ratio; fall back to user selection.
        const specAspect = normalizeAspect(spec.ar) !== "auto" ? normalizeAspect(spec.ar) : fallbackAspect;
        const img = await editWithNanoBananaPro(falKey, productUrls, fullPrompt, { aspect: specAspect, model: imageModel });
        send({ phase: "result", index: i, total, sceneName: label, shotId: spec.shot_id, imageUrl: img.url });
      } catch (e) {
        send({ phase: "error", index: i, total, message: `Shot ${i + 1} render failed: ${String(e)}` });
      }
    }

    send({ phase: "done", message: `${total} product render${total !== 1 ? "s" : ""} complete.` });
  } catch (err) {
    send({ phase: "error", message: String(err) });
  } finally {
    res.end();
  }
}
