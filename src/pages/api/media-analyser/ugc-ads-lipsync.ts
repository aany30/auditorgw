/**
 * UGC Ads -- lip-sync the ElevenLabs voiceover onto the (silent) rendered video.
 *
 * Submits a FAL lip-sync job (video + audio -> talking video with the mouth matched
 * to the audio; the audio track is merged in). Returns the FAL queue handle in the
 * SAME shape as /render, so the client polls it via /render-status like any render.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { submitLipsyncJob } from "@/lib/media-analyser/fal";
import type { UGCRenderSubmit } from "@/pages/api/media-analyser/ugc-ads-render";

export const config = { maxDuration: 300 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const videoUrl = String(body.videoUrl ?? "");
  const audioUrl = String(body.audioUrl ?? "");

  if (!/^https?:\/\//i.test(videoUrl) || !/^https?:\/\//i.test(audioUrl)) {
    return res.status(400).json({ error: "videoUrl and audioUrl (https) are required." });
  }

  try {
    const submit = await submitLipsyncJob(falKey, { videoUrl, audioUrl });
    const out: UGCRenderSubmit = {
      requestId: submit.requestId,
      statusUrl: submit.statusUrl,
      responseUrl: submit.responseUrl,
      attempt: 1,
      durationSeconds: 0,
    };
    return res.status(200).json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ugc-lipsync] failed: ${msg}`);
    return res.status(502).json({ error: `Could not start lip-sync: ${msg}` });
  }
}
