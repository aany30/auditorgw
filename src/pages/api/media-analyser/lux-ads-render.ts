/**
 * Lux Ads — Stage 03 + 04 (submit): reference assets → submit Seedance job.
 *
 *  03  Nano Banana Pro generates 0–2 luxury reference assets (macro_detail /
 *      scene_anchoring / product_in_context) from the plan's own nano prompts.
 *  04  Submit ONE Seedance 2.5 reference-to-video job (native 30s) using the plan's
 *      self-assembled `assembled_video_prompt`, and return the FAL queue handle WITHOUT
 *      waiting. The client polls /api/ugc-ads/render-status (model-agnostic) until ready.
 *
 * Seedance 2.5 is FAL-only (no ARK), so this always renders through the FAL queue.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import {
  editWithNanoBananaPro,
  generateImageWithNanoBananaPro,
  submitReferenceVideoSeedance,
  uploadToFalStorage,
  type FalAspect,
  type SeedanceResolution,
} from "@/lib/media-analyser/fal";
import { LuxPlanSchema, LUX_REF_SLOTS, type LuxPlan } from "@/lib/media-analyser/lux-ads/prompt";

// Refs (Nano, ~130s each, in parallel) + FAL uploads + submit. Under 300s.
export const config = { maxDuration: 300 };

export interface LuxRenderSubmit {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  durationSeconds: number;
  debug?: {
    seedancePrompt: string;
    referenceUrls: string[];
    nanoRefPrompts: string[];
    nanoRefImages: string[];
  };
}

type LuxRefSlot = (typeof LUX_REF_SLOTS)[number];

const MAX_NANO_REFS = 2;   // cap concurrent Nano renders so we stay under the 300s cap

/** Lux aspect strings map 1:1 to FalAspect; default 16:9 for broadcast luxury. */
function luxAspect(a: string): FalAspect {
  return a === "9:16" || a === "1:1" || a === "16:9" ? a : "16:9";
}

/** Resolve a reference asset's slots to the uploaded, hosted image URLs. */
function resolveSlots(slots: LuxRefSlot[], modelUrls: string[], productUrls: string[]): string[] {
  const pick: Record<LuxRefSlot, string | undefined> = {
    model_image_1: modelUrls[0], model_image_2: modelUrls[1],
    product_image_1: productUrls[0], product_image_2: productUrls[1], product_image_3: productUrls[2],
  };
  return slots.map(s => pick[s]).filter((u): u is string => !!u);
}

/** Fallback Seedance prompt if the LLM's assembled_video_prompt came back empty. */
function fallbackPrompt(plan: LuxPlan): string {
  const head = `Generate a 30-second ${plan.aspect_ratio} ultra-luxury commercial advertisement, ${plan.delivery_mode.replace(/_/g, " ").toLowerCase()} delivery. Mood: ${plan.meta.mood}. ${plan.meta.act_structure}`;
  const beats = plan.keyframes.map(k =>
    `Keyframe ${k.keyframe_number}: [${k.time_range}] — ${k.camera_direction} ${k.action} Color grade: ${k.color_grade}.${k.on_screen_text ? ` On-screen text: "${k.on_screen_text}".` : ""}`,
  ).join("\n");
  const rules = (plan.constraints.length ? plan.constraints : [
    "Do not generate watermarks or logos other than the brand's own.",
    "Realistic skin, metal, and material textures; no plastic feel, no AI rendering distortions.",
    "Maintain one unified color grade philosophy across the full 30-second spot.",
  ]).join(" ");
  return [head, beats, rules].filter(Boolean).join("\n\n");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;

  const rawUrls = body.imageDataUrls ?? body.imageDataUrl;
  const productDataUrls = (Array.isArray(rawUrls) ? rawUrls : rawUrls ? [rawUrls] : [])
    .map(u => String(u)).filter(u => u.startsWith("data:image/")).slice(0, 3);

  const rawModelUrls = body.modelImageDataUrls ?? body.modelImageDataUrl;
  const modelDataUrls = (Array.isArray(rawModelUrls) ? rawModelUrls : rawModelUrls ? [rawModelUrls] : [])
    .map(u => String(u)).filter(u => u.startsWith("data:image/")).slice(0, 2);

  if (!productDataUrls.length) {
    return res.status(400).json({ error: "At least one product image is required." });
  }

  let plan: LuxPlan;
  try {
    plan = LuxPlanSchema.parse(body.plan);
  } catch {
    return res.status(400).json({ error: "A valid Lux plan is required." });
  }

  const requested = String(body.videoResolution ?? "");
  const resolution: SeedanceResolution =
    requested === "480p" || requested === "720p" ? (requested as SeedanceResolution) : "720p";

  // Render engine: "ark" (direct Seedance on BytePlus ARK) is the default — ARK's
  // Seedance 2.5 renders the 30s luxury spot WITH the creator reference (ARK does not
  // reject AI-generated faces, unlike FAL's 2.5 which 422s on a real-person likeness).
  // "fal" forces the old FAL-queue path; "auto" defers to the SEEDANCE_PROVIDER env.
  const seedanceProvider: "ark" | "fal" | "auto" =
    body.seedanceProvider === "fal" || body.seedanceProvider === "auto" ? body.seedanceProvider : "ark";

  try {
    // Host the product + model images on FAL (Seedance/Nano need public URLs).
    const [productHttpUrls, modelHttpUrls] = await Promise.all([
      Promise.all(productDataUrls.map(u => uploadToFalStorage(falKey, u))),
      Promise.all(modelDataUrls.map(u => uploadToFalStorage(falKey, u))),
    ]);

    // Stage 03 — best-effort Nano reference assets from the plan's own nano prompts.
    // Non-fatal: a failed ref is simply skipped; the render still proceeds on the raw refs.
    const nanoSpecs = plan.reference_assets_needed.filter(r => r.nano_banana_prompt.trim()).slice(0, MAX_NANO_REFS);
    const nanoRefPrompts = nanoSpecs.map(r => r.nano_banana_prompt);
    const nanoRefImages = (await Promise.all(nanoSpecs.map(async spec => {
      try {
        const refs = resolveSlots(spec.input_references, modelHttpUrls, productHttpUrls);
        const img = refs.length
          ? await editWithNanoBananaPro(falKey, refs, spec.nano_banana_prompt, { aspect: luxAspect(plan.aspect_ratio), resolution: "2K" })
          : await generateImageWithNanoBananaPro(falKey, spec.nano_banana_prompt, { aspect: luxAspect(plan.aspect_ratio), resolution: "2K" });
        return img.url;
      } catch (e) {
        console.warn(`[lux-render] nano ref "${spec.asset_id}" failed (skipping): ${e instanceof Error ? e.message : e}`);
        return null;
      }
    }))).filter((u): u is string => !!u);

    // Reference stack: model (≤2) + product (≤3) + Nano context refs (≤2). Seedance 2.5
    // handles many refs without the drift 2.0 had, and luxury spots are product-led.
    const refs = [...modelHttpUrls, ...productHttpUrls, ...nanoRefImages].slice(0, 7);

    const seedancePrompt = (plan.assembled_video_prompt.trim() || fallbackPrompt(plan));

    const submit = await submitReferenceVideoSeedance(falKey, {
      imageUrls: refs,
      prompt: seedancePrompt,
      unclampedDurationSec: 30,   // Seedance 2.5 native 30s
      aspect: luxAspect(plan.aspect_ratio),
      resolution,
      generateAudio: true,        // luxury spots carry VO or crafted sound design
      model: "seedance-2-5",
      seedanceProvider,
    });

    const out: LuxRenderSubmit = {
      requestId: submit.requestId,
      statusUrl: submit.statusUrl,
      responseUrl: submit.responseUrl,
      durationSeconds: 30,
      debug: { seedancePrompt, referenceUrls: refs, nanoRefPrompts, nanoRefImages },
    };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: `Lux render failed: ${e instanceof Error ? e.message : String(e)}` });
  }
}
