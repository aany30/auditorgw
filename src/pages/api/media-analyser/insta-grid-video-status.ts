import type { NextApiRequest, NextApiResponse } from "next";
import { extractFalVideo, getFalQueueResult, getFalQueueStatus } from "@/lib/media-analyser/fal";

export const config = { maxDuration: 30 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const statusUrl = (req.query.statusUrl as string) ?? "";
  const responseUrl = (req.query.responseUrl as string) ?? "";

  if (!statusUrl || !responseUrl) {
    return res.status(400).json({ error: "statusUrl and responseUrl are required" });
  }
  if (!statusUrl.startsWith("https://queue.fal.run/") || !responseUrl.startsWith("https://queue.fal.run/")) {
    return res.status(400).json({ error: "Invalid Fal queue URL" });
  }

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });

  try {
    const { status, error } = await getFalQueueStatus(falKey, statusUrl);
    if (status === "COMPLETED") {
      const data = await getFalQueueResult(falKey, responseUrl);
      const video = extractFalVideo(data);
      return res.status(200).json({ status, videoUrl: video.url, duration: video.duration });
    }
    if (status === "FAILED") {
      return res.status(200).json({ status, error: error ?? "SeeDance render failed" });
    }
    return res.status(200).json({
      status,
      message: status === "IN_QUEUE" ? "Waiting in queue…" : "Rendering video…",
    });
  } catch (e) {
    return res.status(500).json(
      { error: e instanceof Error ? e.message : String(e) },
    );
  }
}
