import type { NextApiRequest, NextApiResponse } from "next";
import { deepClassifyAdVideos, type DeepAdVerdict } from "@/lib/media-analyser/meta-social";
import type { SocialPaidAd } from "@/lib/media-analyser/types";

export const config = { maxDuration: 800 };

export interface DeepScanUpdate {
  phase: "scanning" | "done" | "error";
  done?: number;
  total?: number;
  message?: string;
  verdicts?: DeepAdVerdict[];
  influencerCount?: number;
  regionalCount?: number;
  videoCount?: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const ads = (Array.isArray(body.ads) ? body.ads : []) as SocialPaidAd[];
  const scoped = ads.filter(a => a && a.adId).slice(0, 600);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (u: DeepScanUpdate) => res.write(`data: ${JSON.stringify(u)}\n\n`);

  try {
    const videoCount = scoped.filter(a => a.videoUrl).length;
    if (!videoCount) {
      send({ phase: "done", verdicts: [], influencerCount: 0, regionalCount: 0, videoCount: 0, message: "No video ads to deep-scan in this range." });
      return res.end();
    }
    send({ phase: "scanning", done: 0, total: videoCount, message: `Deep-scanning ${videoCount} video ad(s) — first 5s + audio…` });

    const deadlineMs = Date.now() + 700_000;
    const verdicts = await deepClassifyAdVideos(
      scoped,
      (done, total) => send({ phase: "scanning", done, total }),
      deadlineMs,
    );

    const influencerCount = verdicts.filter(v => v.isInfluencer).length;
    const regionalCount = verdicts.filter(v => v.isRegional).length;
    send({ phase: "done", verdicts, influencerCount, regionalCount, videoCount, message: `Precise scan complete — ${verdicts.length} videos analysed.` });
  } catch (err) {
    send({ phase: "error", message: String(err).slice(0, 300) });
  } finally {
    res.end();
  }
}
