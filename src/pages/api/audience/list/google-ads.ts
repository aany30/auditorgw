/**
 * POST /api/audience/list/google-ads
 * Returns Google Ads remarketing/audience lists (user_list resource).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleAdsApiClient } from "@/lib/api-clients/google-ads";
import { resolveGoogleAdsCreds } from "@/lib/default-credentials";

export const config = { maxDuration: 30 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const creds = resolveGoogleAdsCreds(req.body || {});
  if (!creds) return res.status(400).json({ error: "Missing Google Ads credentials" });

  try {
    const client = new GoogleAdsApiClient(creds);
    const audiences = await client.listAudiences();
    return res.status(200).json({ audiences });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Google Ads audience list failed:", message);
    return res.status(502).json({ error: message });
  }
}
