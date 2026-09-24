import type { NextApiRequest, NextApiResponse } from "next";
import { fetchRecentScans } from "@/lib/media-analyser/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const limit = parseInt(
    typeof req.query.limit === "string" ? req.query.limit : "20",
    10,
  );
  const scans = await fetchRecentScans(limit);
  return res.status(200).json(scans);
}
