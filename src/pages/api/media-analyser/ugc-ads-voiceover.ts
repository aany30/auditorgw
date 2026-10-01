/**
 * UGC Ads -- ElevenLabs voiceover (via FAL).
 *
 * Joins the Director plan's per-beat dialogue into one script and generates the
 * spoken voiceover with ElevenLabs TTS on FAL.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { generateElevenLabsSpeech } from "@/lib/media-analyser/fal";
import { resolveElevenVoice } from "@/lib/media-analyser/generation-models";

export const config = { maxDuration: 120 };

export interface UGCVoiceoverResponse {
  audioUrl: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const voice = resolveElevenVoice(String(body.language ?? ""), String(body.voiceCharacteristics ?? ""));

  const rawShots = Array.isArray(body.shots) ? (body.shots as Array<Record<string, unknown>>) : [];
  const fromShots = rawShots
    .map(s => String(s?.dialogue ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const text = (fromShots || String(body.dialogue ?? "").trim()).slice(0, 5000);

  if (!text) {
    return res.status(400).json({ error: "No dialogue to voice." });
  }

  const speed =
    Number(body.speed) ||
    Number(process.env.UGC_VOICE_SPEED) ||
    1.1;

  try {
    const audio = await generateElevenLabsSpeech(falKey, { text, voice, speed });
    const out: UGCVoiceoverResponse = { audioUrl: audio.url };
    return res.status(200).json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ugc-voiceover] failed: ${msg}`);
    return res.status(502).json({ error: `Could not generate the voiceover: ${msg}` });
  }
}
