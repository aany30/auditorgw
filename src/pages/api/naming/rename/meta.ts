/**
 * Rename a Meta object (campaign / ad set / ad) via the Graph API.
 *
 * Meta's `POST /{object_id}` accepts the same `{ name }` body for any
 * campaign / ad-set / ad — so one endpoint covers all three for the naming
 * audit. Accepts either `nodeId` (preferred) or legacy `campaignId`.
 *
 * Demo mode (token starts with `demo-` etc): no-op success — UI shows the
 * queued banner without hitting Meta's API. Real tokens: live rename call.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";

interface RenameRequest {
  accessToken: string;
  /** Object ID to rename — campaign, ad set, or ad. */
  nodeId?: string;
  /** Legacy alias kept for backward compatibility with existing callers. */
  campaignId?: string;
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

  const { accessToken, newName } = req.body as RenameRequest;
  const id = (req.body as RenameRequest).nodeId || (req.body as RenameRequest).campaignId;
  if (!accessToken || !id || !newName?.trim()) {
    res.status(400).json({ error: "accessToken, nodeId, and newName are required" });
    return;
  }

  // Length validation — Meta caps names at 400 chars across object types.
  if (newName.length > 400) {
    res.status(400).json({ error: "Name exceeds Meta's 400-character limit" });
    return;
  }

  // Demo mode: pretend success without calling Meta.
  if (isDemoCredential(accessToken)) {
    res.status(200).json({ success: true, source: "demo" });
    return;
  }

  // Live: call Meta Graph API. `renameCampaign` POSTs to `/{id}` which works
  // for ANY Meta object — same endpoint for campaigns, ad sets, and ads.
  const client = new MetaApiClient(accessToken);
  const result = await client.renameCampaign(id, newName);

  if (!result.success) {
    res.status(502).json({ error: result.error || "Rename failed" });
    return;
  }

  res.status(200).json({ success: true, source: "live" });
}
