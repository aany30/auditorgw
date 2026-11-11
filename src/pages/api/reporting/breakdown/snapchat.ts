/**
 * POST /api/reporting/breakdown/snapchat
 *
 * Returns Snapchat account-level daily breakdown in the same
 * { rows: DailyPoint[] } shape as the Meta/DV360/Google Ads endpoints.
 *
 * Body: { clientId, clientSecret, refreshToken, adAccountId, startDate, endDate }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { resolveSnapchatCreds } from "@/lib/default-credentials";
import { SnapchatApiClient } from "@/lib/api-clients/snapchat";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const creds = resolveSnapchatCreds(body);
  if (!creds) {
    return res.status(400).json({ error: "Snapchat credentials required", rows: [] });
  }

  const startDate = (body.startDate as string) || "";
  const endDate   = (body.endDate   as string) || "";
  if (!startDate || !endDate) {
    return res.status(400).json({ error: "startDate and endDate required", rows: [] });
  }

  try {
    const client = new SnapchatApiClient({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      refreshToken: creds.refreshToken,
      adAccountId: creds.adAccountId,
      orgId: creds.orgId,
    });

    const daily = await client.getAccountDailyStats(startDate, endDate);

    // Map to the common DailyPoint shape
    const rows = daily.map((d) => ({
      label: d.date,
      spend: d.spend,
      impressions: d.impressions,
      clicks: d.swipes,           // Snapchat "swipes" = clicks
      conversions: d.conversions,
      conversionValue: 0,         // Snapchat doesn't expose conversion value
    }));

    return res.status(200).json({ source: "snapchat", rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[breakdown/snapchat]", msg);
    return res.status(502).json({ error: msg, rows: [] });
  }
}
