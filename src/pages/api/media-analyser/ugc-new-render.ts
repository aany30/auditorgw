/** UGC New · Step 3 — render the chosen persona + script into a talking-head video.
 *  Voice (ElevenLabs) → ByteDance ARK Seedance 2.5 (FAL fallback). Streams SSE progress. */
import type { NextApiRequest, NextApiResponse } from "next";
import { uploadToFalStorage } from "@/lib/media-analyser/fal";
import { renderSeedanceVideo } from "@/lib/media-analyser/ugc-new/stages";

export const config = { maxDuration: 300 };

export interface UGCRenderUpdate {
  phase: "voice" | "video" | "done" | "error";
  message?: string;
  audioUrl?: string;
  provider?: string;
  videoUrl?: string;
  usedModel?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const personaImageDataUrl = String(body.personaImageDataUrl ?? "");
  // Optional extra visual reference — the character "world" scene image (data URL).
  const worldImageDataUrl = String(body.worldImageDataUrl ?? "");
  const personaName = String(body.personaName ?? "Creator").trim();
  const personaDescription = String(body.personaDescription ?? "").trim();
  const scriptContent = String(body.scriptContent ?? "").trim();
  const timeOfDay = String(body.timeOfDay ?? "18:00").trim();
  const durationSec = Math.max(4, Math.min(30, Math.round(Number(body.durationSec) || 30)));

  if (!personaImageDataUrl.startsWith("data:image/")) return res.status(400).json({ error: "Pick a persona with a portrait first." });
  if (!scriptContent) return res.status(400).json({ error: "Missing script." });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (u: UGCRenderUpdate) => res.write(`data: ${JSON.stringify(u)}\n\n`);

  try {
    send({ phase: "video", message: `Rendering the ${durationSec}s video on ByteDance Seedance 2.5…` });
    const portraitUrl = await uploadToFalStorage(falKey, personaImageDataUrl);
    // Upload the character-world scene (if supplied) as an extra reference image.
    const referenceUrls: string[] = [];
    if (worldImageDataUrl.startsWith("data:image/")) {
      try { referenceUrls.push(await uploadToFalStorage(falKey, worldImageDataUrl)); }
      catch (e) { send({ phase: "video", message: `Character-world reference skipped (${e instanceof Error ? e.message : e}).` }); }
    }
    // Seedance generates its own lip-synced audio from the script in the prompt (native to
    // the on-screen mouth). A separate pre-generated voiceover went unused on the ARK path
    // and a 30s track breaks the FAL models' 15s reference-audio cap, so it's dropped.
    const { videoUrl, usedModel } = await renderSeedanceVideo(
      { falKey, portraitUrl, referenceUrls, characterName: personaName, characterDescription: personaDescription, scriptContent, timeOfDay, durationSec },
      () => send({ phase: "video", message: "ByteDance ARK unavailable — falling back to the FAL Seedance queue…" }),
    );
    if (!videoUrl) throw new Error("Seedance did not return a finished video in time.");
    send({ phase: "video", message: `Rendered on ${usedModel}.`, provider: "seedance", videoUrl, usedModel });

    send({ phase: "done", message: "UGC video ready." });
  } catch (e) {
    send({ phase: "error", message: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
}
