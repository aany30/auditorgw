/**
 * Voice Clone — clone a creator's voice from one reference sample (FAL f5-tts, zero-shot)
 * and speak any number of scripts in that voice.
 *
 * SSE stream: uploads the reference sample once, then for each script chunks it to F5-TTS's
 * length limit, clones each chunk in the reference voice, and stitches the parts into one MP3.
 * F5-TTS needs a CLEAN speech reference (5–15s); music/noise makes it fail.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { cloneVoiceWithF5TTS, uploadToFalStorage } from "@/lib/media-analyser/fal";
import { concatAudioWithFfmpeg } from "@/lib/media-analyser/ffmpeg-compose";

export const config = { maxDuration: 300 };

export interface VoiceCloneUpdate {
  phase: "uploading" | "cloning" | "result" | "item-error" | "done" | "error";
  index?: number;
  total?: number;
  script?: string;
  audioUrl?: string;
  message?: string;
  error?: string;
}

/** Split text into sentence-sized pieces under maxChars (F5-TTS caps input length). */
function chunkText(text: string, maxChars: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]*/g) ?? [clean];
  const pieces: string[] = [];
  for (const s of sentences) {
    const sent = s.trim();
    if (!sent) continue;
    if (sent.length <= maxChars) { pieces.push(sent); continue; }
    let cur = "";
    for (const w of sent.split(" ")) {
      if ((cur + " " + w).trim().length > maxChars && cur) { pieces.push(cur.trim()); cur = w; }
      else cur = (cur + " " + w).trim();
    }
    if (cur.trim()) pieces.push(cur.trim());
  }
  const merged: string[] = [];
  for (const p of pieces) {
    if (merged.length && (merged[merged.length - 1] + " " + p).length <= maxChars) merged[merged.length - 1] += " " + p;
    else merged.push(p);
  }
  return merged.length ? merged : [clean];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured." });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const voiceSample = String(body.voiceSampleDataUrl ?? "").trim();
  const scripts = (Array.isArray(body.scripts) ? body.scripts : [])
    .map(s => String(s ?? "").trim())
    .filter(Boolean)
    .slice(0, 10);

  if (!voiceSample.startsWith("data:audio/")) {
    return res.status(400).json({ error: "Upload a reference voice sample (audio)." });
  }
  if (!scripts.length) {
    return res.status(400).json({ error: "Add at least one script to speak." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (u: VoiceCloneUpdate) => res.write(`data: ${JSON.stringify(u)}\n\n`);

  try {
    send({ phase: "uploading", message: "Uploading the reference voice…" });
    const refUrl = await uploadToFalStorage(falKey, voiceSample);

    for (let i = 0; i < scripts.length; i++) {
      const script = scripts[i];
      send({ phase: "cloning", index: i, total: scripts.length, message: `Cloning voice for script ${i + 1} of ${scripts.length}…` });
      try {
        const chunks = chunkText(script, 150);
        const parts = await Promise.all(chunks.map(t => cloneVoiceWithF5TTS(falKey, { refAudioUrl: refUrl, text: t })));
        const audioUrl = await concatAudioWithFfmpeg(falKey, parts.map(p => p.url));
        send({ phase: "result", index: i, total: scripts.length, script, audioUrl });
      } catch (e) {
        send({ phase: "item-error", index: i, script, error: e instanceof Error ? e.message : String(e) });
      }
    }
    send({ phase: "done", message: "Done." });
  } catch (e) {
    send({ phase: "error", error: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
}
