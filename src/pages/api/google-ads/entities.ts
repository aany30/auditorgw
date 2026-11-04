/**
 * POST /api/google-ads/entities
 *
 * Returns campaigns, ad groups, and ads for the connected Google Ads customer.
 * Used by the Account Structure tab.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleAdsApiClient } from "@/lib/api-clients/google-ads";
import { resolveGoogleAdsCreds } from "@/lib/default-credentials";

export const config = { maxDuration: 90 };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const creds = resolveGoogleAdsCreds(req.body || {});
  if (!creds) {
    return res
      .status(400)
      .json({ error: "Missing Google Ads credentials." });
  }

  const { startDate, endDate } = req.body || {};
  const sd = startDate || new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const ed = endDate || new Date().toISOString().slice(0, 10);

  try {
    const client = new GoogleAdsApiClient(creds);
    const [campaigns, adGroups, ads] = await Promise.all([
      client.listCampaigns(sd, ed),
      client.listAdGroups(sd, ed),
      client.listAds(sd, ed),
    ]);
    return res.status(200).json({ campaigns, adGroups, ads });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const lower = message.toLowerCase();
    if (
      lower.includes("401") ||
      lower.includes("403") ||
      lower.includes("permission")
    ) {
      return res
        .status(403)
        .json({ error: "Reconnect Google with the adwords scope." });
    }
    if (message.includes("REQUESTED_METRICS_FOR_MANAGER")) {
      return res.status(400).json({
        error: "This Google Ads account is a Manager (MCC) account. Please select a client account from the Manage Accounts dropdown.",
        code: "MANAGER_ACCOUNT",
      });
    }
    console.error("Google Ads entities fetch failed:", message);
    return res.status(502).json({ error: message });
  }
}
