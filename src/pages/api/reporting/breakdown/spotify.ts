/**
 * POST /api/reporting/breakdown/spotify
 *
 * Returns Spotify account-level daily breakdown in the same
 * { rows: DailyPoint[] } shape as the other platform breakdown endpoints.
 *
 * Body: { clientId, clientSecret, refreshToken, adAccountId, startDate, endDate }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { resolveSpotifyCreds } from "@/lib/default-credentials";
import { SpotifyAdsApiClient } from "@/lib/api-clients/spotify-ads";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const creds = resolveSpotifyCreds(body);
  if (!creds) {
    return res.status(400).json({ error: "Spotify credentials required", rows: [] });
  }

  const startDate = (body.startDate as string) || "";
  const endDate   = (body.endDate   as string) || "";
  if (!startDate || !endDate) {
    return res.status(400).json({ error: "startDate and endDate required", rows: [] });
  }

  try {
    const client = new SpotifyAdsApiClient({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      refreshToken: creds.refreshToken,
      adAccountId: creds.adAccountId,
    });

    const daily = await client.getDailyReport(startDate, endDate);

    // Map to the common DailyPoint shape
    const rows = daily.map((d) => ({
      label: d.startTime?.slice(0, 10) || "",
      spend: d.spend,
      impressions: d.impressions,
      clicks: d.clicks,
      conversions: 0,             // Spotify doesn't have a direct conversions metric
      conversionValue: 0,
    })).filter((r) => r.label);

    return res.status(200).json({ source: "spotify", rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[breakdown/spotify]", msg);
    return res.status(502).json({ error: msg, rows: [] });
  }
}
