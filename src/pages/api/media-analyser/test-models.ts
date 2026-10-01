import type { NextApiRequest, NextApiResponse } from "next";
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  normalizeImageModel,
  normalizeVideoModel,
} from "@/lib/media-analyser/generation-models";

/**
 * Read-only diagnostics for the generation-model registry. No FAL/Gemini calls.
 *
 *   GET /api/media-analyser/test-models
 *   GET /api/media-analyser/test-models?img=dall-e&video=sora   ← confirm unknown ids fall back to defaults
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const imgQuery = req.query.img as string | undefined;
  const videoQuery = req.query.video as string | undefined;

  return res.status(200).json({
    ok: true,
    defaults: { image: DEFAULT_IMAGE_MODEL_ID, video: DEFAULT_VIDEO_MODEL_ID },
    imageModels: IMAGE_MODELS.map(m => ({ id: m.id, label: m.label, falModelId: m.falModelId, isDefault: m.isDefault })),
    videoModels: VIDEO_MODELS.map(m => ({
      id: m.id,
      label: m.label,
      i2vFalModelId: m.i2vFalModelId,
      refFalModelId: m.refFalModelId ?? null,
      isDefault: m.isDefault,
      supportsReferenceToVideo: m.supportsReferenceToVideo,
      supportsEndFrame: m.supportsEndFrame,
      supportsAudio: m.supportsAudio,
      durationFormat: m.durationFormat,
      durationRange: m.durationRange,
      allowedDurations: m.allowedDurations ?? null,
    })),
    // Echo how the supplied (possibly bogus) ids normalize.
    normalize: {
      image: { input: imgQuery ?? null, resolved: normalizeImageModel(imgQuery ?? undefined).id },
      video: { input: videoQuery ?? null, resolved: normalizeVideoModel(videoQuery ?? undefined).id },
    },
  });
}
