/**
 * POST /api/reporting/daily/google-ads
 *
 * Daily conversion/spend trend for Conversion Monitoring. Google Ads returns
 * real conversions and conversion value, so ROAS is available.
 *
 * Body: { clientId?, clientSecret?, refreshToken?, customerId, loginCustomerId?,
 *         startDate, endDate }
 * Returns: { rows: [{ label, spend, clicks, conversions, conversionValue }] }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleAdsApiClient } from "@/lib/api-clients/google-ads";
import { resolveGoogleAdsCreds } from "@/lib/default-credentials";

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { startDate, endDate } = req.body || {};
  const creds = resolveGoogleAdsCreds(req.body || {});
  if (!creds) {
    return res.status(400).json({ error: "Missing Google Ads credentials (customerId or developerToken)" });
  }
  if (!startDate || !endDate) {
    return res.status(400).json({ error: "Missing startDate or endDate" });
  }

  try {
    const client = new GoogleAdsApiClient(creds);
    const daily = await client.listDailyMetrics(startDate, endDate);
    const rows = daily.map((d) => ({
      label: d.date,
      spend: d.spend,
      clicks: d.clicks,
      conversions: d.conversions,
      conversionValue: d.conversionValue,
    }));
    return res.status(200).json({ rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("REQUESTED_METRICS_FOR_MANAGER")) {
      return res.status(400).json({
        error: "This Google Ads account is a Manager (MCC) account. Please select a client account.",
        code: "MANAGER_ACCOUNT",
      });
    }
    return res.status(502).json({ error: message });
  }
}
