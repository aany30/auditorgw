/**
 * Rename a Meta campaign via the Graph API.
 *
 * Demo mode (token starts with `demo-` etc): no-op success — UI shows the
 * queued banner without hitting Meta's API. Real tokens: live rename call.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";

interface RenameRequest {
  accessToken: string;
  campaignId: string;
  newName: string;
}

interface RenameResponse {
  success: boolean;
  source: "live" | "demo";
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RenameResponse | { error: string }>
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { accessToken, campaignId, newName } = req.body as RenameRequest;
  if (!accessToken || !campaignId || !newName?.trim()) {
    res.status(400).json({ error: "accessToken, campaignId, and newName are required" });
    return;
  }

  // Length validation — Meta caps campaign names at 400 chars.
  if (newName.length > 400) {
    res.status(400).json({ error: "Campaign name exceeds Meta's 400-character limit" });
    return;
  }

  // Demo mode: pretend success without calling Meta.
  if (isDemoCredential(accessToken)) {
    res.status(200).json({ success: true, source: "demo" });
    return;
  }

  // Live: call Meta Graph API.
  const client = new MetaApiClient(accessToken);
  const result = await client.renameCampaign(campaignId, newName);

  if (!result.success) {
    res.status(502).json({ error: result.error || "Rename failed" });
    return;
  }

  res.status(200).json({ success: true, source: "live" });
}
