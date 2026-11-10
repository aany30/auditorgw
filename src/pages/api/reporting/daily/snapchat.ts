/**
 * POST /api/reporting/daily/snapchat
 *
 * Daily conversion/spend trend for Conversion Monitoring. Snapchat returns
 * conversions (count) and spend but no conversion value, so ROAS isn't
 * available — only conversions, spend and CPA.
 *
 * Body: { clientId?, clientSecret?, refreshToken?, adAccountId?, orgId?,
 *         startDate, endDate }
 * Returns: { rows: [{ label, spend, clicks, conversions, conversionValue }] }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { SnapchatApiClient, type SnapchatCredentials } from "@/lib/api-clients/snapchat";

export const config = { maxDuration: 60 };

function resolveSnapchatCreds(body: Record<string, unknown>): SnapchatCredentials | null {
  const clientId = (body.clientId as string) || process.env.SNAPCHAT_CLIENT_ID;
  const clientSecret = (body.clientSecret as string) || process.env.SNAPCHAT_CLIENT_SECRET;
  const refreshToken = (body.refreshToken as string) || process.env.DEFAULT_SNAPCHAT_REFRESH_TOKEN;
  const adAccountId = (body.adAccountId as string) || process.env.DEFAULT_SNAPCHAT_AD_ACCOUNT_ID;
  const orgId = (body.orgId as string) || process.env.DEFAULT_SNAPCHAT_ORG_ID;
  if (!clientId || !clientSecret || !refreshToken || !adAccountId) return null;
  return { clientId, clientSecret, refreshToken, adAccountId, orgId };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = (req.body || {}) as Record<string, unknown>;
  const { startDate, endDate } = body as { startDate?: string; endDate?: string };
  const creds = resolveSnapchatCreds(body);
  if (!creds) return res.status(400).json({ error: "Missing Snapchat credentials" });
  if (!startDate || !endDate) return res.status(400).json({ error: "Missing startDate or endDate" });

  try {
    const client = new SnapchatApiClient(creds);
    const daily = await client.getAccountDailyStats(startDate, endDate);
    const rows = daily.map((d) => ({
      label: d.date,
      spend: d.spend,
      clicks: d.swipes,
      conversions: d.conversions,
      conversionValue: 0,
    }));
    return res.status(200).json({ rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(502).json({ error: message });
  }
}
