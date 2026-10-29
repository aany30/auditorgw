/**
 * POST /api/reporting/demographics/google-ads
 *
 * Returns Google Ads demographic/audience breakdowns from GAQL views:
 *   breakdown = "age"     → age_range_view
 *   breakdown = "gender"  → gender_view
 *   breakdown = "country" → geographic_view (country-level)
 *   breakdown = "device"  → campaign × segments.device
 *
 * Body: { clientId?, clientSecret?, refreshToken?, customerId?, loginCustomerId?,
 *         breakdown, startDate, endDate }
 * Returns: { rows: BreakdownRow[] }
 *
 * Each row has: label, spend, impressions, clicks, conversions, conversionValue.
 * The shape matches the BreakdownRow used by the audience analysis tab so it
 * plugs straight into the existing chart/table components.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleAdsApiClient } from "@/lib/api-clients/google-ads";
import { resolveGoogleAdsCreds } from "@/lib/default-credentials";

export const config = { maxDuration: 90 };

const VALID_BREAKDOWNS = ["age", "gender", "country", "device"] as const;
type Breakdown = (typeof VALID_BREAKDOWNS)[number];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const creds = resolveGoogleAdsCreds(req.body || {});
  if (!creds)
    return res.status(400).json({ error: "Missing Google Ads credentials." });

  const { breakdown, startDate, endDate } = req.body || {};
  if (!breakdown || !VALID_BREAKDOWNS.includes(breakdown))
    return res.status(400).json({ error: `Invalid breakdown. Use: ${VALID_BREAKDOWNS.join(", ")}` });
  if (!startDate || !endDate)
    return res.status(400).json({ error: "Missing startDate or endDate" });

  try {
    const client = new GoogleAdsApiClient(creds);
    let rawRows: Array<{ label: string; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }>;

    switch (breakdown as Breakdown) {
      case "age":
        rawRows = await client.getAgeBreakdown(startDate, endDate);
        break;
      case "gender":
        rawRows = await client.getGenderBreakdown(startDate, endDate);
        break;
      case "country":
        rawRows = await client.getGeoBreakdown(startDate, endDate);
        break;
      case "device":
        rawRows = await client.getDeviceBreakdown(startDate, endDate);
        break;
    }

    // Map into the BreakdownRow shape the frontend expects
    const rows = rawRows.map((r) => ({
      label: r.label,
      breakdownValues: { [breakdown]: r.label },
      spend: r.spend,
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: r.conversions,
      conversionValue: r.conversionValue,
    }));

    // Sort by spend descending (biggest spenders first)
    rows.sort((a, b) => b.spend - a.spend);

    return res.status(200).json({ rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Google Ads ${breakdown} breakdown fetch failed:`, message);
    return res.status(502).json({ error: message });
  }
}
