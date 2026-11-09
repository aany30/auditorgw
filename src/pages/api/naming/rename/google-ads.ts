/**
 * Rename a Google Ads entity (campaign / ad group) via the Google Ads API.
 *
 * Body: { clientId, clientSecret, refreshToken, customerId, loginCustomerId?,
 *         entityId, newName, kind? }  — kind defaults to "campaign".
 *
 * Demo mode (refresh token starts with `demo-`): no-op success.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleAdsApiClient } from "@/lib/api-clients/google-ads";
import { isDemoCredential } from "@/lib/demo-data";
import { resolveGoogleAdsCreds } from "@/lib/default-credentials";

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

  const creds = resolveGoogleAdsCreds(req.body || {});
  const { entityId, newName, kind } = req.body || {};

  if (!creds || !entityId || !newName?.trim()) {
    res.status(400).json({ error: "Google Ads credentials, entityId, and newName are required" });
    return;
  }

  if (newName.length > 255) {
    res.status(400).json({ error: "Name exceeds Google Ads' 255-character limit" });
    return;
  }

  if (isDemoCredential(creds.refreshToken)) {
    res.status(200).json({ success: true, source: "demo" });
    return;
  }

  const entityKind: "campaign" | "adGroup" = kind === "adGroup" ? "adGroup" : "campaign";

  try {
    const client = new GoogleAdsApiClient(creds);
    const custId = creds.customerId.replace(/-/g, "");

    if (entityKind === "campaign") {
      const resourceName = `customers/${custId}/campaigns/${entityId}`;
      await client.updateEntity("campaigns", resourceName, { name: newName });
    } else {
      const resourceName = `customers/${custId}/adGroups/${entityId}`;
      await client.updateEntity("adGroups", resourceName, { name: newName });
    }

    res.status(200).json({ success: true, source: "live" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Google Ads rename failed";
    const status = msg.includes("401") || msg.includes("403") || msg.includes("PERMISSION_DENIED") ? 403 : 502;
    res.status(status).json({ error: msg });
  }
}
