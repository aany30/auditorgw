/**
 * POST /api/spotify/ad-accounts
 *
 * Lists Spotify ad accounts the user has access to.
 * Body: { clientId, clientSecret, refreshToken }
 * Returns: { adAccounts: [{ id, name }] }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { SpotifyAdsApiClient } from "@/lib/api-clients/spotify-ads";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const clientId = (req.body?.clientId as string) || process.env.SPOTIFY_CLIENT_ID || "";
  const clientSecret = (req.body?.clientSecret as string) || process.env.SPOTIFY_CLIENT_SECRET || "";
  const refreshToken = (req.body?.refreshToken as string) || process.env.SPOTIFY_REFRESH_TOKEN || "";

  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(400).json({ error: "Missing Spotify credentials" });
  }

  try {
    const client = new SpotifyAdsApiClient({
      clientId, clientSecret, refreshToken,
      adAccountId: "",
    });
    const adAccounts = await client.listAdAccounts();
    return res.status(200).json({ adAccounts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(502).json({ error: msg });
  }
}
