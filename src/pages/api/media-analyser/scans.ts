import type { NextApiRequest, NextApiResponse } from "next";
import { fetchRecentScans, fetchScanById } from "@/lib/media-analyser/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const { id, limit: limitParam } = req.query;

  if (typeof id === "string") {
    const scan = await fetchScanById(id);
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    return res.status(200).json(scan);
  }

  const limit = parseInt(
    typeof limitParam === "string" ? limitParam : "20",
    10,
  );
  const scans = await fetchRecentScans(limit);
  return res.status(200).json(scans);
}
