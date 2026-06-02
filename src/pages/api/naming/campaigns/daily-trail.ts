/**
 * Fetch per-day spend for the last 14 days for a list of Meta campaign IDs.
 * Used by BudgetAllocationAudit to show rolling 7d / 14d averages instead of
 * a meaningless window-total ÷ days comparison against a potentially stale
 * current daily-budget setting.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";

interface ReqBody {
  accessToken: string;
  campaignIds: string[];
}

interface RespBody {
  trails: Record<string, Array<{ date: string; spend: number }>>;
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

  // Demo mode: return empty trails so the UI falls back to window-based display.
  if (isDemoCredential(accessToken)) {
    const trails: RespBody["trails"] = {};
    for (const id of campaignIds) trails[id] = [];
    res.status(200).json({ trails });
    return;
  }

  try {
    const client = new MetaApiClient(accessToken);
    const trails = await client.getCampaignDailySpendTrail(campaignIds);
    res.status(200).json({ trails });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Daily trail fetch failed:", message);
    res.status(502).json({ error: message });
  }
}
