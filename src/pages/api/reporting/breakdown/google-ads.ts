/**
 * POST /api/reporting/breakdown/google-ads
 *
 * Returns Google Ads account-level insights grouped by a time segment.
 * Currently supports breakdown="daily" (segments.date), which the Overview /
 * Key Metrics trend + current-vs-previous KPI cards consume. Synchronous — no
 * polling, unlike DV360's Bid Manager reports.
 *
 * Body: { clientId, clientSecret, refreshToken, customerId, loginCustomerId?,
 *         breakdown, startDate, endDate }
 * Returns: { rows: DailyPoint[] }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleAdsApiClient } from "@/lib/api-clients/google-ads";
import { resolveGoogleAdsCreds } from "@/lib/default-credentials";

export const config = { maxDuration: 90 };

interface DailyRow {
  label: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const creds = resolveGoogleAdsCreds(req.body || {});
  if (!creds) return res.status(400).json({ error: "Missing Google Ads credentials." });

  const { startDate, endDate } = req.body || {};
  if (!startDate || !endDate)
    return res.status(400).json({ error: "Missing startDate or endDate" });

  try {
    const client = new GoogleAdsApiClient(creds);
    const rows = await client.search<{
      segments: { date: string };
      metrics: {
        costMicros: string;
        impressions: string;
        clicks: string;
        conversions: string;
        conversionsValue: string;
      };
    }>(`
      SELECT
        segments.date,
        metrics.cost_micros, metrics.impressions, metrics.clicks,
        metrics.conversions, metrics.conversions_value
      FROM customer
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);

    // Aggregate by date (customer-level rows are already one per date, but sum
    // defensively in case the API returns multiple segments per day).
    const byDate = new Map<string, DailyRow>();
    for (const r of rows) {
      const label = r.segments.date;
      const cur = byDate.get(label) ?? {
        label, spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0,
      };
      cur.spend += (Number(r.metrics.costMicros) || 0) / 1_000_000;
      cur.impressions += Number(r.metrics.impressions) || 0;
      cur.clicks += Number(r.metrics.clicks) || 0;
      cur.conversions += Number(r.metrics.conversions) || 0;
      cur.conversionValue += Number(r.metrics.conversionsValue) || 0;
      byDate.set(label, cur);
    }
    const out = [...byDate.values()].sort((a, b) => a.label.localeCompare(b.label));
    return res.status(200).json({ rows: out });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Google Ads breakdown fetch failed:", message);
    return res.status(502).json({ error: message });
  }
}
