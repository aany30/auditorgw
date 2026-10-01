import type { NextApiRequest, NextApiResponse } from "next";
import { fetchRecentGenerations, saveGenerationBatch, type GenerationInput } from "@/lib/media-analyser/supabase";

function parseInput(raw: unknown): GenerationInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const thumbs = Array.isArray(o.referenceThumbnails)
    ? o.referenceThumbnails.filter(t => typeof t === "string").slice(0, 3) as string[]
    : undefined;
  const input: GenerationInput = {
    prompt: str(o.prompt),
    description: str(o.description),
    productUrl: str(o.productUrl),
    aspect: str(o.aspect),
    imageModel: str(o.imageModel),
    videoModel: str(o.videoModel),
    referenceThumbnails: thumbs && thumbs.length ? thumbs : undefined,
  };
  return Object.values(input).some(v => v !== undefined) ? input : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const limit = Math.min(100, parseInt(
      typeof req.query.limit === "string" ? req.query.limit : "50", 10,
    ) || 50);
    const batches = await fetchRecentGenerations(limit);
    return res.status(200).json(batches);
  }

  if (req.method === "POST") {
    const body = req.body ?? {};
    const mode = String(body.mode ?? "").trim();
    if (!mode) return res.status(400).json({ saved: false, reason: "mode is required" });

    const results = Array.isArray(body.results) ? body.results : [];
    const { ok, error } = await saveGenerationBatch({
      scan_id: body.scan_id ? String(body.scan_id) : null,
      mode,
      product_name: body.product_name ? String(body.product_name) : null,
      brand: body.brand ? String(body.brand) : null,
      result_count: typeof body.result_count === "number" ? body.result_count : results.length,
      thumbnail_url: body.thumbnail_url ? String(body.thumbnail_url) : null,
      results,
      input: parseInput(body.input),
      dna_confidence: body.dna_confidence ? String(body.dna_confidence) : null,
    });

    return res.status(200).json(ok ? { saved: true } : { saved: false, error });
  }

  return res.status(405).end();
}
