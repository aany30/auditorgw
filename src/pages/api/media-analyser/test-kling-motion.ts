/**
 * TEST ONLY — verify the Kling motion-control / AI-avatar input schema against FAL before the
 * Reaction Reel v2 pipeline is built on it. POST { imageUrl, videoUrl?, audioUrl?, pro? }.
 *  - imageUrl + videoUrl  → motion-control (character image driven by reference video)
 *  - imageUrl + audioUrl  → AI avatar (image + audio → talking)
 * Returns the resulting video URL, or the raw FAL error (so we can read the correct field names).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { generateVideoWithKlingMotionControl, generateKlingAiAvatar, cloneVoiceWithF5TTS } from "@/lib/media-analyser/fal";

export const config = { maxDuration: 300 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;

  // F5-TTS voice-clone length probe: { f5RefUrl, f5Text }
  const f5RefUrl = String(body.f5RefUrl ?? "").trim();
  const f5Text = String(body.f5Text ?? "").trim();
  if (f5RefUrl && f5Text) {
    try {
      const r = await cloneVoiceWithF5TTS(falKey, { refAudioUrl: f5RefUrl, text: f5Text });
      return res.status(200).json({ mode: "f5", chars: f5Text.length, audioUrl: r.url });
    } catch (e) {
      return res.status(502).json({ mode: "f5", chars: f5Text.length, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const imageUrl = String(body.imageUrl ?? "").trim();
  const videoUrl = String(body.videoUrl ?? "").trim();
  const audioUrl = String(body.audioUrl ?? "").trim();
  const prompt = String(body.prompt ?? "").trim() || undefined;
  const pro = body.pro === true;
  const characterOrientation = String(body.characterOrientation ?? "").trim() || undefined;
  const extra = (body.extra && typeof body.extra === "object") ? body.extra as Record<string, unknown> : undefined;

  if (!/^https?:\/\//i.test(imageUrl)) return res.status(400).json({ error: "imageUrl (https) required" });

  try {
    if (videoUrl) {
      const v = await generateVideoWithKlingMotionControl(falKey, { imageUrl, referenceVideoUrl: videoUrl, prompt, pro, characterOrientation, extra });
      return res.status(200).json({ mode: "motion-control", videoUrl: v.url, duration: v.duration ?? null });
    }
    if (audioUrl) {
      const avatarModel = String(body.avatarModel ?? "").trim() || undefined;
      const t0 = Date.now();
      const v = await generateKlingAiAvatar(falKey, { imageUrl, audioUrl, prompt, model: avatarModel });
      return res.status(200).json({ mode: "ai-avatar", model: avatarModel ?? "default", videoUrl: v.url, elapsedSec: Math.round((Date.now() - t0) / 1000) });
    }
    return res.status(400).json({ error: "Provide videoUrl (motion-control) or audioUrl (ai-avatar)." });
  } catch (e) {
    // Surface the raw FAL error so we can read the correct field names on a 422/400.
    return res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
