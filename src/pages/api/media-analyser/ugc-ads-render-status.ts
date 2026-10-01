/**
 * Stage 04 (poll) -- check a submitted Seedance job and, once complete, return its video.
 *
 * The client polls THIS route every few seconds. Each call is a single short status
 * check (plus one result fetch when complete).
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { fetchFalVideoResult, getFalQueueStatus, isArkHandle, arkTaskIdFromHandle } from "@/lib/media-analyser/fal";
import { getArkSeedanceStatus } from "@/lib/media-analyser/ark";

export const config = { maxDuration: 60 };

export interface UGCRenderStatus {
  status: "pending" | "rendered" | "failed";
  videoUrl?: string;
  durationSeconds?: number;
  error?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const statusUrl = String(body.statusUrl ?? "");
  const responseUrl = String(body.responseUrl ?? "");
  if (!statusUrl || !responseUrl) {
    return res.status(400).json({ status: "failed", error: "statusUrl and responseUrl are required" } satisfies UGCRenderStatus);
  }

  // ARK-rendered jobs carry an ark:// task-id handle -- poll ModelArk, not the FAL queue.
  if (isArkHandle(statusUrl)) {
    try {
      const { status, videoUrl, error } = await getArkSeedanceStatus(arkTaskIdFromHandle(statusUrl));
      if (status === "COMPLETED" && videoUrl) {
        return res.status(200).json({ status: "rendered", videoUrl } satisfies UGCRenderStatus);
      }
      if (status === "FAILED") {
        return res.status(200).json({ status: "failed", error: error ?? "Seedance (ARK) render failed" } satisfies UGCRenderStatus);
      }
      return res.status(200).json({ status: "pending" } satisfies UGCRenderStatus);
    } catch (err) {
      console.warn(`[ugc-render-status] transient ARK poll error: ${err instanceof Error ? err.message : err}`);
      return res.status(200).json({ status: "pending" } satisfies UGCRenderStatus);
    }
  }

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ status: "failed", error: "FAL_KEY is not configured" } satisfies UGCRenderStatus);

  try {
    const { status, error } = await getFalQueueStatus(falKey, statusUrl);

    if (status === "COMPLETED") {
      try {
        const video = await fetchFalVideoResult(falKey, responseUrl);
        if (!video?.url) throw new Error("the completed render returned no video URL");
        const out: UGCRenderStatus = {
          status: "rendered",
          videoUrl: video.url,
          durationSeconds: video.duration,
        };
        return res.status(200).json(out);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[ugc-render-status] COMPLETED but no video (terminal failure): ${msg}`);
        return res.status(200).json({
          status: "failed",
          error: `The render finished but produced no video -- it was likely rejected (e.g. a real-person likeness in a reference image). ${msg}`.slice(0, 400),
        } satisfies UGCRenderStatus);
      }
    }

    if (status === "FAILED") {
      return res.status(200).json({ status: "failed", error: error ?? "Seedance render failed" } satisfies UGCRenderStatus);
    }

    // IN_QUEUE | IN_PROGRESS
    return res.status(200).json({ status: "pending" } satisfies UGCRenderStatus);
  } catch (err) {
    console.warn(`[ugc-render-status] transient poll error: ${err instanceof Error ? err.message : err}`);
    return res.status(200).json({ status: "pending" } satisfies UGCRenderStatus);
  }
}
