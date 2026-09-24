import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import fs from "fs";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const samplePath = path.resolve(process.cwd(), "../../sample_scraper_payload.json");
  try {
    const content = fs.readFileSync(samplePath, "utf-8");
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(content);
  } catch {
    return res.status(404).json({ error: "Sample payload not found" });
  }
}
