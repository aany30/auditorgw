/**
 * Talking Avatar — turn a topic or script into a lip-synced, AI-presenter video.
 *
 * Inspired by MoneyPrinterTurbo's topic → script → voiceover flow, but instead of a
 * faceless stock-footage montage it produces a TALKING AVATAR: an AI-generated
 * presenter that speaks the script, lip-synced to an ElevenLabs voiceover. Everything
 * renders on FAL (no local ffmpeg), so it fits the serverless budget.
 *
 * Pipeline (SSE, one stream):
 *   1. script    — Gemini writes a short spoken VO script from the topic (skipped if the
 *                  user supplies their own script)
 *   2. presenter — Seedream/Nano Banana Pro generates a front-facing presenter portrait
 *   3. voiceover — ElevenLabs TTS (via FAL) reads the script
 *   4. animating — Seedance animates the portrait into a talking-to-camera clip
 *   5. lipsync   — fal-ai/sync-lipsync matches the mouth to the voiceover → final video
 */
import type { NextApiRequest, NextApiResponse } from "next";
import {
  generateImageWithNanoBananaPro,
  editWithNanoBananaPro,
  generateVideoWithSeedance,
  generateElevenLabsSpeech,
  stitchVideosWithFal,
  submitFalQueueJob,
  getFalQueueStatus,
  getFalQueueResult,
  extractFalVideo,
  type FalAspect,
} from "@/lib/media-analyser/fal";
import { resolveElevenVoice } from "@/lib/media-analyser/generation-models";
import { callVisionLLM, type VisionUserPart } from "@/lib/media-analyser/vision-llm";
import { geminiVisionModels } from "@/lib/media-analyser/gemini-models";

export const config = { maxDuration: 300 };

interface Update {
  phase: "script" | "presenter" | "voiceover" | "animating" | "lipsync" | "done" | "error";
  message?: string;
  script?: string;
  presenterUrl?: string;
  videoUrl?: string;
  error?: string;
}

const SCRIPT_SYSTEM = `You are a scriptwriter for short talking-head presenter videos. Turn the user's topic into ONE spoken voiceover script for a single on-camera presenter. Rules: conversational and punchy, first or second person, a strong hook in the first line, no stage directions, no scene descriptions, no headings, no emojis, no hashtags, no markdown — ONLY the words the presenter says. Keep it tight: aim for the requested length. Return ONLY the script text.`;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured on the server." });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const mode = body.mode === "script" ? "script" : "topic";
  const topic = String(body.topic ?? "").trim().slice(0, 600);
  const providedScript = String(body.script ?? "").trim().slice(0, 1200);
  const productImageDataUrls = (Array.isArray(body.productImageDataUrls) ? body.productImageDataUrls : [])
    .map(u => String(u)).filter(u => u.startsWith("data:image/") || u.startsWith("http")).slice(0, 3);
  const presenterDesc = String(body.presenter ?? "").trim().slice(0, 400)
    || "a friendly, professional spokesperson in their early 30s";
  const aspect = (body.aspect === "16:9" ? "16:9" : "9:16") as FalAspect;
  const language = String(body.language ?? "").trim().slice(0, 80);
  const voiceCharacteristics = String(body.voiceCharacteristics ?? "").trim().slice(0, 200);
  const lengthHint = body.length === "long" ? "long" : body.length === "short" ? "short" : "medium";

  if (mode === "topic" && !topic) return res.status(400).json({ error: "Enter a topic to script from." });
  if (mode === "script" && !providedScript) return res.status(400).json({ error: "Enter a script." });
  if (mode === "topic" && !geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured (needed to write the script)." });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (u: Update) => res.write(`data: ${JSON.stringify(u)}\n\n`);

  try {
    // ── 1. script ──
    let script = providedScript;
    if (mode === "topic") {
      send({ phase: "script", message: "Writing the script…" });
      const words = lengthHint === "short" ? "about 30–45 words (~15s)" : lengthHint === "long" ? "about 90–120 words (~45s)" : "about 55–75 words (~30s)";
      const langLine = language ? `\nLanguage: write the script in ${language} (use Roman transliteration for Hindi/Hinglish, the way real creators talk).` : "";
      const parts: VisionUserPart[] = [{ text: `Topic: ${topic}\nTarget length: ${words}.${langLine}\n\nWrite the presenter's voiceover script now.` }];
      script = (await callVisionLLM(SCRIPT_SYSTEM, parts, geminiKey, { maxTokens: 700, models: geminiVisionModels() })).trim();
      if (!script) throw new Error("Could not write a script — try rephrasing the topic.");
    }
    // Guard render time: cap at ~130 words (~60s of speech).
    if (wordCount(script) > 130) script = script.split(/\s+/).slice(0, 130).join(" ");
    send({ phase: "script", script, message: "Script ready." });

    // ── 2. presenter portrait ──
    send({ phase: "presenter", message: productImageDataUrls.length ? "Generating the presenter with your product…" : "Generating the presenter…" });
    const portrait = productImageDataUrls.length
      ? await editWithNanoBananaPro(falKey, productImageDataUrls,
          `Photorealistic shot of ${presenterDesc} holding up and showcasing the product shown in the reference image(s) toward the camera. Reproduce the product EXACTLY — same shape, colour, logo and label — clearly visible and in focus. Upper-body framing, the person faces the camera with a natural neutral expression, soft even studio lighting, clean uncluttered background, high detail. Single person.`,
          { aspect, model: "seedream-5-pro" })
      : await generateImageWithNanoBananaPro(falKey,
          `Photorealistic portrait of ${presenterDesc}. Head-and-shoulders framing, facing the camera directly, looking straight at the lens, mouth closed with a natural neutral expression, soft even studio lighting, clean simple uncluttered background, sharp focus on the face, high detail. Single person, centered.`,
          { aspect, resolution: "2K" });
    send({ phase: "presenter", presenterUrl: portrait.url, message: "Presenter ready." });

    // ── 3. voiceover ──
    send({ phase: "voiceover", message: "Recording the voiceover…" });
    const voice = resolveElevenVoice(language, voiceCharacteristics);
    const audio = await generateElevenLabsSpeech(falKey, { text: script, voice, speed: 1.05 });
    const speechSec = audio.duration && audio.duration > 0 ? audio.duration : Math.max(4, wordCount(script) / 2.3);

    // ── 4. animate the portrait into a talking-to-camera clip ──
    send({ phase: "animating", message: "Animating the presenter…" });
    const clipSec = Math.min(10, Math.max(5, Math.ceil(speechSec)));
    const animPrompt = `The person looks directly at the camera and speaks naturally like a presenter addressing the viewer: subtle natural head movements, occasional blinking, lips and mouth moving as if talking, shoulders steady.${productImageDataUrls.length ? " Keep the product held up and clearly visible in frame throughout, unchanged." : ""} Fixed camera, static background, no zoom, no camera movement.`;
    const clip = await generateVideoWithSeedance(falKey, {
      imageUrl: portrait.url, prompt: animPrompt, durationSec: clipSec, aspect, resolution: "720p", generateAudio: false,
      seedanceProvider: "auto",
    });

    // Cover the full voiceover length: loop the clip if the speech is longer.
    let baseVideoUrl = clip.url;
    const clipDur = clip.duration && clip.duration > 0 ? clip.duration : clipSec;
    if (clipDur * 1.15 < speechSec) {
      const copies = Math.min(8, Math.ceil(speechSec / clipDur));
      send({ phase: "animating", message: `Extending clip to cover ${Math.round(speechSec)}s…` });
      const stitched = await stitchVideosWithFal(falKey, Array.from({ length: copies }, () => ({ url: clip.url, durationSec: clipDur })), { keepAudio: false });
      baseVideoUrl = stitched.url;
    }

    // ── 5. lip-sync ──
    send({ phase: "lipsync", message: "Lip-syncing to the voiceover…" });
    const submit = await submitFalQueueJob(falKey, "fal-ai/sync-lipsync", { video_url: baseVideoUrl, audio_url: audio.url });
    const deadline = Date.now() + 620_000;
    let result: Record<string, unknown> | null = null;
    while (Date.now() < deadline) {
      await sleep(5000);
      let s: { status: string; error?: string };
      try { s = await getFalQueueStatus(falKey, submit.statusUrl); } catch { continue; }
      if (s.status === "COMPLETED") { result = await getFalQueueResult(falKey, submit.responseUrl); break; }
      if (s.status === "FAILED") throw new Error(`Lip-sync failed: ${s.error ?? "unknown error"}`);
    }
    if (!result) throw new Error("Lip-sync timed out — try a shorter script.");
    const final = extractFalVideo(result);

    send({ phase: "done", videoUrl: final.url, presenterUrl: portrait.url, script, message: "Done." });
  } catch (e) {
    send({ phase: "error", error: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
}
