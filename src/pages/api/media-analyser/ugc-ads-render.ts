/**
 * Stage 03 + Stage 04 (submit) -- Reference assets -> submit Seedance job.
 *
 *  03  Nano Banana Pro generates 0-2 REFERENCE assets (scene / product-in-context
 *      / styling) -- NOT per-shot keyframes.
 *  04  Submit ONE Seedance 2.0 reference-to-video job (15s 9:16 with VO/lip-sync)
 *      and return its FAL queue handle WITHOUT waiting for it to finish.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import {
  editWithNanoBananaPro,
  generateImageWithNanoBananaPro,
  submitReferenceVideoSeedance,
  shouldRenderOnArk,
  uploadToFalStorage,
  type FalAspect,
  type SeedanceResolution,
} from "@/lib/media-analyser/fal";
import { normalizeVideoModel } from "@/lib/media-analyser/generation-models";
import { buildNanoBananaPrompt } from "@/lib/media-analyser/ugc/nano-prompt";
import { assembleSeedancePrompt, assembleSeedanceReferences, buildReferenceGuide, type SeedanceRefRole } from "@/lib/media-analyser/ugc/seedance-assembler";
import { DirectorPlanSchema, REGEN_STRATEGIES, type ReferenceAssetSpec, type UGCDirectorPlan } from "@/lib/media-analyser/ugc/types";

export const config = { maxDuration: 300 };

export interface UGCRenderSubmit {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  attempt: number;
  durationSeconds: number;
  /** Inspectable prompts/inputs (cohort debug dropdown): what was sent to Nano + Seedance. */
  debug?: {
    seedancePrompt: string;
    referenceUrls: string[];
    referenceManifest: SeedanceRefRole[];
    nanoRefPrompts: string[];
    /** Reference assets Nano Banana Pro generated this run (may be empty). */
    nanoRefImages: string[];
  };
}

type RegenStrategy = (typeof REGEN_STRATEGIES)[number];

/** Resolve a plan's `input_references` slots to the actual data URLs the user supplied. */
function resolveInputRefs(
  spec: ReferenceAssetSpec,
  modelUrls: string[],
  productUrls: string[],
): string[] {
  const out: string[] = [];
  for (const slot of spec.input_references) {
    if (slot === "model_image" && modelUrls[0]) out.push(modelUrls[0]);
    else if (slot === "product_image_1" && productUrls[0]) out.push(productUrls[0]);
    else if (slot === "product_image_2" && productUrls[1]) out.push(productUrls[1]);
    else if (slot === "product_image_3" && productUrls[2]) out.push(productUrls[2]);
  }
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;

  const rawUrls = body.imageDataUrls ?? body.imageDataUrl;
  const productDataUrls = (Array.isArray(rawUrls) ? rawUrls : rawUrls ? [rawUrls] : [])
    .map(u => String(u))
    .filter(u => u.startsWith("data:image/"))
    .slice(0, 3);

  const rawModelUrls = body.modelImageDataUrls ?? body.modelImageDataUrl;
  const modelDataUrls = (Array.isArray(rawModelUrls) ? rawModelUrls : rawModelUrls ? [rawModelUrls] : [])
    .map(u => String(u))
    .filter(u => u.startsWith("data:image/"))
    .slice(0, 3);

  const worldDataUrl = typeof body.worldImageDataUrl === "string" && body.worldImageDataUrl.startsWith("data:image/")
    ? body.worldImageDataUrl
    : null;

  let plan: UGCDirectorPlan;
  try {
    plan = DirectorPlanSchema.parse(body.plan);
  } catch {
    return res.status(400).json({ error: "A valid Director plan is required." });
  }

  const imageModel = "seedream-5-pro" as const;
  let videoModel = normalizeVideoModel(body.videoModel).id;
  const audioMode = body.audioMode === "elevenlabs" ? "elevenlabs" : "model";
  const withDialogue = body.dialogue !== false;
  const seedanceProvider = body.seedanceProvider === "ark" || body.seedanceProvider === "fal"
    ? body.seedanceProvider
    : "auto";

  const requested = String(body.videoResolution ?? "");
  const resolution: SeedanceResolution =
    requested === "1080p" || requested === "720p" || requested === "480p"
      ? (requested as SeedanceResolution)
      : process.env.UGC_VIDEO_RESOLUTION === "1080p" ? "1080p"
        : process.env.UGC_VIDEO_RESOLUTION === "480p" ? "480p"
          : "720p";

  const attempt = Math.max(1, Math.min(5, Math.round(Number(body.attempt ?? 1)) || 1));
  const regenStrategy: RegenStrategy = REGEN_STRATEGIES.includes(body.regenStrategy as RegenStrategy)
    ? (body.regenStrategy as RegenStrategy)
    : "none";
  const qcFeedback = String(body.qcFeedback ?? "").trim().slice(0, 4000);
  const isRegen = attempt > 1;

  if (!productDataUrls.length) {
    return res.status(400).json({ error: "imageDataUrls must include at least one product photo." });
  }

  try {
    // -- STAGE 03 -- reference assets (0-2) --
    const refSpecs = plan.reference_assets_needed.slice(0, 2);
    const rebuildRefs = !isRegen || regenStrategy === "regenerate_references";
    const nanoRefPrompts: string[] = rebuildRefs ? refSpecs.map(buildNanoBananaPrompt) : [];
    let nanoUrls: string[] = [];
    if (rebuildRefs) {
      const results = await Promise.all(refSpecs.map(async (spec, i) => {
        const prompt = nanoRefPrompts[i];
        const refAspect: FalAspect = spec.purpose === "product_in_context" ? "1:1" : "9:16";
        const inputs = resolveInputRefs(spec, modelDataUrls, productDataUrls);
        try {
          const img = inputs.length
            ? await editWithNanoBananaPro(falKey, inputs, prompt, { aspect: refAspect, model: imageModel })
            : await generateImageWithNanoBananaPro(falKey, prompt, { aspect: refAspect });
          return img.url;
        } catch {
          return null;
        }
      }));
      nanoUrls = results.filter((u): u is string => u !== null);
    }

    // -- STAGE 04 (submit) -- host inputs, then submit the Seedance job --
    console.log(`[ugc-render] attempt=${attempt} uploading ${productDataUrls.length} product + ${modelDataUrls.length} model image(s) to FAL storage`);
    const modelHttpUrls: string[] = [];
    for (const u of modelDataUrls) {
      const hosted = await uploadToFalStorage(falKey, u).catch(e => { console.warn(`[ugc-render] model upload failed: ${e}`); return null; });
      if (hosted) modelHttpUrls.push(hosted);
    }
    const productHttpUrls: string[] = [];
    for (const u of productDataUrls) {
      const hosted = await uploadToFalStorage(falKey, u).catch(e => { console.warn(`[ugc-render] product upload failed: ${e}`); return null; });
      if (hosted) productHttpUrls.push(hosted);
    }
    if (!productHttpUrls.length) {
      return res.status(502).json({ error: "Could not upload product images for rendering. Please retry." });
    }

    const sceneHttpUrls: string[] = [];
    if (worldDataUrl) {
      const hosted = await uploadToFalStorage(falKey, worldDataUrl).catch(e => { console.warn(`[ugc-render] world upload failed: ${e}`); return null; });
      if (hosted) sceneHttpUrls.push(hosted);
    }

    if (modelHttpUrls.length && videoModel === "seedance-2-5" && !shouldRenderOnArk("seedance-2-5", seedanceProvider)) {
      console.log(`[ugc-render] attempt=${attempt} creator reference present on FAL -- using Seedance 2.0 (FAL 2.5 rejects AI-generated faces)`);
      videoModel = "seedance-2";
    }

    const richRefs = videoModel === "seedance-2-5";
    const { urls: refs, manifest } = assembleSeedanceReferences(
      modelHttpUrls, productHttpUrls, sceneHttpUrls,
      richRefs ? { maxCreator: 3, maxProduct: 3, maxScene: 4, extraSceneUrls: nanoUrls } : undefined,
    );

    let seedancePrompt = assembleSeedancePrompt(plan, buildReferenceGuide(manifest), { dialogue: withDialogue });
    if (isRegen && qcFeedback) {
      seedancePrompt += `\n\nQC FIX NOTES (previous take ${attempt - 1} had issues -- correct these): ${qcFeedback}`;
    }

    const durationSeconds = plan.meta.duration_seconds || 15;
    console.log(`[ugc-render] attempt=${attempt} refs sent=${refs.length} (rich=${richRefs}: model=${modelHttpUrls.length} product=${productHttpUrls.length} scene=${sceneHttpUrls.length} nano=${nanoUrls.length}) dur=${plan.meta.duration_seconds}s model=${videoModel} -- submitting Seedance`);

    const submit = await submitReferenceVideoSeedance(falKey, {
      imageUrls: refs,
      prompt: seedancePrompt,
      unclampedDurationSec: durationSeconds,
      aspect: "9:16",
      resolution,
      generateAudio: audioMode !== "elevenlabs",
      model: videoModel,
      seedanceProvider,
    });
    console.log(`[ugc-render] attempt=${attempt} SUBMITTED req=${submit.requestId} -- client will poll for completion`);

    const out: UGCRenderSubmit = {
      requestId: submit.requestId,
      statusUrl: submit.statusUrl,
      responseUrl: submit.responseUrl,
      attempt,
      durationSeconds,
      debug: {
        seedancePrompt,
        referenceUrls: refs,
        referenceManifest: manifest,
        nanoRefPrompts,
        nanoRefImages: nanoUrls,
      },
    };
    return res.status(200).json(out);
  } catch (err) {
    console.error(`[ugc-render] attempt=${attempt} SUBMIT ERROR: ${err instanceof Error ? err.message : err}`);
    return res.status(502).json({ error: `Could not start the render: ${String(err instanceof Error ? err.message : err)}` });
  }
}
