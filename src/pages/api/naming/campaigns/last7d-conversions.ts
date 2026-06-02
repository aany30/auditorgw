/**
 * Fixed 7-day conversion totals per Meta campaign — used by the Learning
 * Phase audit to evaluate Meta's 50-events / 7-day exit threshold. Window
 * is hard-coded (not driven by the global date picker) because the rule
 * itself is fixed at 7 days.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";

interface ReqBody {
  accessToken: string;
  campaignIds: string[];
}

interface RespBody {
  conversions: Record<string, {
    conversions7d: number;
    conversionValue7d: number;
    reach7d: number;
    frequency7d: number;
    impressions7d: number;
    spend7d: number;
  }>;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RespBody | { error: string }>
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const { accessToken, campaignIds } = req.body as ReqBody;
  if (!accessToken || !Array.isArray(campaignIds) || campaignIds.length === 0) {
    res.status(400).json({ error: "Missing accessToken or campaignIds[]" });
    return;
  }

  // Demo mode: empty map → UI falls back to "—" cleanly.
  if (isDemoCredential(accessToken)) {
    res.status(200).json({ conversions: {} });
    return;
  }

  try {
    const client = new MetaApiClient(accessToken);
    const conversions = await client.getCampaignLast7dConversions(campaignIds);
    res.status(200).json({ conversions });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Last-7d conversions fetch failed:", message);
    res.status(502).json({ error: message });
  }
}
