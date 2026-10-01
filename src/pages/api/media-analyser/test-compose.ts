/**
 * TEST ONLY — probe FAL ffmpeg-api/compose to learn whether it can spatially STACK two videos
 * (top/bottom split) instead of just concatenating. POST { input: <raw compose input> } and it
 * forwards it verbatim, returning the raw FAL result (or error) so we can iterate the schema
 * without redeploying. Once the stacking shape is known it moves into a real helper.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { submitFalQueueJob, getFalQueueStatus, getFalQueueResult } from "@/lib/media-analyser/fal";

export const config = { maxDuration: 300 };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY not configured" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const input = (body.input && typeof body.input === "object") ? body.input as Record<string, unknown> : null;
  if (!input) return res.status(400).json({ error: "Provide { input: <compose input> }" });

  try {
    const submit = await submitFalQueueJob(falKey, "fal-ai/ffmpeg-api/compose", input);
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      await sleep(4000);
      let s: { status: string; error?: string };
      try { s = await getFalQueueStatus(falKey, submit.statusUrl); } catch { continue; }
      if (s.status === "COMPLETED") {
        const r = await getFalQueueResult(falKey, submit.responseUrl);
        return res.status(200).json({ ok: true, result: r });
      }
      if (s.status === "FAILED") return res.status(502).json({ ok: false, error: s.error ?? "failed" });
    }
    return res.status(504).json({ ok: false, error: "timed out" });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
