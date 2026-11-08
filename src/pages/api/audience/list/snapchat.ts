/**
 * POST /api/audience/list/snapchat
 * Returns Snapchat audience segments (SAM segments) for the ad account.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { SnapchatApiClient } from "@/lib/api-clients/snapchat";
import { resolveSnapchatCreds } from "@/lib/default-credentials";

export const config = { maxDuration: 30 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const creds = resolveSnapchatCreds(req.body || {});
  if (!creds) return res.status(400).json({ error: "Missing Snapchat credentials" });

  try {
    const client = new SnapchatApiClient(creds);
    const segments = await client.listSegments();
    return res.status(200).json({ segments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Snapchat audience list failed:", message);
    return res.status(502).json({ error: message });
  }
}
