import type { NextApiRequest, NextApiResponse } from "next";
import { buildVideoInput, submitFalQueueJob, type FalAspect } from "@/lib/media-analyser/fal";
import { normalizeVideoModel } from "@/lib/media-analyser/generation-models";
import { callVisionLLM } from "@/lib/media-analyser/vision-llm";

export const config = { maxDuration: 120 };

export interface InstaGridVideoUpdate {
  phase: "scripting" | "rendering" | "queued" | "result" | "done" | "error";
  index?: number;
  total?: number;
  sceneName?: string;
  adConcept?: string;
  videoUrl?: string;
  durationSeconds?: number;
  requestId?: string;
  modelId?: string;
  statusUrl?: string;
  responseUrl?: string;
  message?: string;
}

interface GridVideoItem {
  index: number;
  imageUrl: string;
  ar?: string;
  sceneName?: string;
}

function normalizeAspect(a: unknown): FalAspect {
  return a === "1:1" || a === "4:5" || a === "9:16" || a === "16:9" ? a : "9:16";
}

function seedanceSystemPrompt(maxSec: number): string {
  return `You are an expert AI Video Producer, Creative Director, and Master Prompt Engineer specializing in SeeDance reference-to-video generation. You receive MULTIPLE reference images (an Instagram grid row) and must translate them into ONE cohesive ${maxSec}-second video advertisement script.

SeeDance 2.0 reference-to-video accepts multiple images. In your seedancePrompt you MUST reference them as @Image1, @Image2, @Image3 (matching the order supplied). The video should flow across all three posts as one designed row — same palette, lighting, and rhythm — not three disconnected clips.

---

### PROMPT GENERATION GUIDELINES
1. Cinematography & Camera Movement: ARRI Alexa 65, Sony A7S3, Zeiss Master Primes; dolly push-ins, handheld, macro.
2. Lighting & Atmosphere: explicit Kelvin temps, side/back light, volumetric rays, fog.
3. Action & Physics Realism: natural movement, weight transfer, condensation, fabric texture.
4. Texture & Material Details: dew, asphalt, liquid bubbles, product surface read.
5. Technical Specs: aspect ratio, frame rates (60fps/120fps slow-mo where needed), film grain, grade.

KEEP EVERY PRODUCT/SUBJECT IN @Image1, @Image2, @Image3 IDENTICAL — animate camera, light, and environment around them.

---

### REQUIRED OUTPUT STRUCTURE
Return ONE JSON object only (no markdown, no code fences):
{
  "adConcept": "1-2 sentences on how the 3 grid posts become one flowing reel",
  "globalStyle": "camera, lens, lighting, palette, frame rates",
  "seedancePrompt": "FULL dense SeeDance reference prompt: multi-shot ${maxSec}-second sequence with timestamps. Each shot MUST cite @Image1, @Image2, or @Image3. Describe transitions between the three grid posts as one Instagram row story.",
  "onScreenText": "on-screen text + sound-design direction (no voiceover — silent video)",
  "params": { "aspectRatio": "9:16 | 1:1 | 4:5 | 16:9", "durationSec": ${maxSec}, "fps": 24 }
}`;
}

async function fetchImageInline(url: string): Promise<{ mime_type: string; data: string } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    if (!ct.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 6 * 1024 * 1024) return null;
    return { mime_type: ct, data: Buffer.from(buf).toString("base64") };
  } catch {
    return null;
  }
}

interface SeedanceScript {
  adConcept?: string;
  globalStyle?: string;
  seedancePrompt: string;
  onScreenText?: string;
  params?: { aspectRatio?: string; durationSec?: number; fps?: number };
}

async function generateSeedanceScript(
  geminiKey: string,
  inlines: Array<{ mime_type: string; data: string }>,
  ctx: { labels: string[]; ar?: string; maxSec: number },
): Promise<SeedanceScript> {
  const system = seedanceSystemPrompt(ctx.maxSec);
  const labelList = ctx.labels.map((l, i) => `@Image${i + 1} = ${l}`).join("; ");
  const userText = `You have ${inlines.length} reference images from one Instagram grid row (left to right: Post 1, Post 2, Post 3).
${labelList}
Target aspect ratio: ${ctx.ar ?? "9:16"}.
Write ONE ${ctx.maxSec}-second SeeDance reference-to-video script that flows across all ${inlines.length} images. The seedancePrompt MUST use @Image1, @Image2, @Image3 syntax.
Set params.aspectRatio to "${ctx.ar ?? "9:16"}" and params.durationSec to ${ctx.maxSec}. Keep every product/subject identical to its reference image.
Return ONLY the JSON object per your system instruction.`;

  let lastErr = "";
  // Text mode only — JSON mode + multi-image vision causes empty Gemini responses.
  for (const batch of [inlines, inlines.slice(0, 1)]) {
    if (!batch.length) continue;
    const batchParts: Array<Record<string, unknown>> = [
      ...batch.map(p => ({ inline_data: p })),
      { text: batch.length < inlines.length
        ? `${userText}\n\nOnly ${batch.length} reference image supplied — write the script for that frame.`
        : userText },
    ];
    try {
      const text = await callVisionLLM(system, batchParts, geminiKey, { jsonMode: false, maxTokens: 2048 });
      const stripped = text.startsWith("```") ? text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim() : text;
      const parsed = JSON.parse(stripped) as SeedanceScript;
      if (parsed.seedancePrompt?.trim()) return parsed;
      lastErr = "missing seedancePrompt";
    } catch (e) {
      lastErr = String(e);
    }
  }
  throw new Error(`SeeDance script generation failed: ${lastErr}`);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const isDryRun = req.query.dry === "1";

  const body = (req.body ?? {}) as Record<string, unknown>;
  const videoModel = normalizeVideoModel(body.videoModel).id;
  // Row-video length: 15s (default) or 30s — Seedance 2.5 renders up to 30s natively.
  const maxSec = Number(body.durationSeconds) === 30 ? 30 : 15;
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: GridVideoItem[] = (rawItems as Record<string, unknown>[])
    .map((it, i) => ({
      index: typeof it.index === "number" ? it.index : i,
      imageUrl: String(it.imageUrl ?? ""),
      ar: it.ar ? String(it.ar) : undefined,
      sceneName: it.sceneName ? String(it.sceneName) : undefined,
    }))
    .filter(it => it.imageUrl.startsWith("http"))
    .sort((a, b) => a.index - b.index)
    .slice(0, 3);

  if (!items.length) {
    return res.status(400).json({ error: "items must include at least one generated image URL" });
  }

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  const openaiKey = process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY ?? "";
  const falKey = process.env.FAL_KEY ?? "";
  if (!geminiKey && !openaiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY or OPENAI_API_KEY is required for video scripting" });
  }
  if (!isDryRun && !falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (u: InstaGridVideoUpdate) => { res.write(`data: ${JSON.stringify(u)}\n\n`); };

  const total = 1;
  const rowAR = items[0]?.ar;
  const labels = items.map(it => it.sceneName || `Post ${it.index + 1} of row`);

  try {
    send({
      phase: "scripting",
      index: 0,
      total,
      sceneName: "Grid row video",
      message: `Writing SeeDance 2.0 script for all ${items.length} posts…`,
    });

    const inlines: Array<{ mime_type: string; data: string }> = [];
    for (const item of items) {
      const inline = await fetchImageInline(item.imageUrl);
      if (inline) inlines.push(inline);
    }
    if (!inlines.length) {
      send({ phase: "error", message: "Could not load any generated images for video scripting." });
      res.end();
      return;
    }

    let script: SeedanceScript;
    try {
      script = await generateSeedanceScript(geminiKey, inlines, { labels, ar: rowAR, maxSec });
    } catch (e) {
      send({ phase: "error", message: e instanceof Error ? e.message : String(e) });
      res.end();
      return;
    }

    const durationSec = Math.max(4, Math.min(maxSec, Math.round(script.params?.durationSec ?? maxSec)));
    const aspect = normalizeAspect(script.params?.aspectRatio ?? rowAR);
    const imageUrls = items.map(it => it.imageUrl);

    if (isDryRun) {
      send({ phase: "result", index: 0, total, adConcept: script.adConcept, durationSeconds: durationSec });
      send({ phase: "done", total, message: "Video script ready (dry run)." });
      res.end();
      return;
    }

    send({
      phase: "rendering",
      index: 0,
      total,
      adConcept: script.adConcept,
      message: `Submitting ${durationSec}s video job to SeeDance 2.0…`,
    });

    try {
      // Build the input for the chosen video model. Reference-to-video is
      // Seedance-only; other models gracefully downgrade to i2v inside
      // buildVideoInput (first image = start frame, last = end frame).
      const built = buildVideoInput(videoModel, "ref", {
        prompt: script.seedancePrompt,
        imageUrls: imageUrls.slice(0, 9),
        durationSec,
        aspect,
        resolution: "720p",
        generateAudio: false,
      });

      let job: { requestId: string; statusUrl: string; responseUrl: string };
      let modelId: string;
      try {
        job = await submitFalQueueJob(falKey, built.falModelId, built.input);
        modelId = built.falModelId;
      } catch (primaryErr) {
        // If a reference-to-video submit fails, retry as plain i2v on the
        // same model (start frame only) so the row still renders.
        if (built.effectiveTask === "ref") {
          console.warn(`[insta-grid-video] reference-to-video submit failed (${primaryErr}), falling back to image-to-video`);
          const fallback = buildVideoInput(videoModel, "i2v", {
            prompt: script.seedancePrompt,
            imageUrl: imageUrls[0],
            endImageUrl: imageUrls.length > 1 ? imageUrls[imageUrls.length - 1] : null,
            durationSec,
            aspect,
            resolution: "720p",
            generateAudio: false,
          });
          job = await submitFalQueueJob(falKey, fallback.falModelId, fallback.input);
          modelId = fallback.falModelId;
        } else {
          throw primaryErr;
        }
      }

      send({
        phase: "queued",
        index: 0,
        total,
        adConcept: script.adConcept,
        durationSeconds: durationSec,
        requestId: job.requestId,
        modelId,
        statusUrl: job.statusUrl,
        responseUrl: job.responseUrl,
        message: "Video queued — rendering in background (usually 3–8 min)…",
      });
      send({ phase: "done", total, message: "Script ready — polling SeeDance for video." });
    } catch (e) {
      send({ phase: "error", message: `Video render failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  } catch (err) {
    send({ phase: "error", message: String(err) });
  } finally {
    res.end();
  }
  return;
}
