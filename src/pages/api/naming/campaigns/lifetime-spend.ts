/**
 * Fetch LIFETIME spend / impressions / clicks for a list of Meta campaign IDs.
 * Used by the Funnel-Separation drill-down to surface "spend before pausing"
 * for campaigns that show 0 spend in the user's selected window.
 *
 * Single batched Graph API call (`?ids=id1,id2,...`) for any list size up to
 * Graph's batch limit (chunked at 50 inside the client method).
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";

interface ReqBody {
  accessToken: string;
  campaignIds: string[];
}

interface RespMap {
  metrics: Record<string, { spend: number; impressions: number; clicks: number; dateStart?: string; dateStop?: string }>;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RespMap | { error: string }>
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

  // Demo mode: return zeros — the audit UI handles "0" gracefully.
  if (isDemoCredential(accessToken)) {
    const metrics: RespMap["metrics"] = {};
    for (const id of campaignIds) metrics[id] = { spend: 0, impressions: 0, clicks: 0 };
    res.status(200).json({ metrics });
    return;
  }

  try {
    const client = new MetaApiClient(accessToken);
    const metrics = await client.getCampaignLifetimeMetrics(campaignIds);
    res.status(200).json({ metrics });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Lifetime spend fetch failed:", message);
    res.status(502).json({ error: message });
  }
}
