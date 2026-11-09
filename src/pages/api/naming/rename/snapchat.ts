/**
 * Rename a Snapchat entity (campaign / ad squad / ad) via the Snapchat
 * Marketing API v1 PUT.
 *
 * Body: { clientId, clientSecret, refreshToken, adAccountId,
 *         entityId, newName, kind? }  — kind defaults to "campaign".
 *
 * Demo mode (refresh token starts with `demo-`): no-op success.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { SnapchatApiClient } from "@/lib/api-clients/snapchat";
import { isDemoCredential } from "@/lib/demo-data";
import { resolveSnapchatCreds } from "@/lib/default-credentials";

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

  const creds = resolveSnapchatCreds(req.body || {});
  const { entityId, newName, kind } = req.body || {};

  if (!creds || !entityId || !newName?.trim()) {
    res.status(400).json({ error: "Snapchat credentials, entityId, and newName are required" });
    return;
  }

  if (newName.length > 375) {
    res.status(400).json({ error: "Name exceeds Snapchat's 375-character limit" });
    return;
  }

  if (isDemoCredential(creds.refreshToken)) {
    res.status(200).json({ success: true, source: "demo" });
    return;
  }

  const entityKind: "campaign" | "adSquad" | "ad" =
    kind === "adSquad" ? "adSquad" : kind === "ad" ? "ad" : "campaign";

  try {
    const client = new SnapchatApiClient({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      refreshToken: creds.refreshToken,
      adAccountId: creds.adAccountId,
    });

    if (entityKind === "campaign") {
      await client.updateCampaign(entityId, { name: newName });
    } else if (entityKind === "adSquad") {
      await client.updateAdSquad(entityId, { name: newName });
    } else {
      await client.updateAd(entityId, { name: newName });
    }

    res.status(200).json({ success: true, source: "live" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Snapchat rename failed";
    res.status(502).json({ error: msg });
  }
}
