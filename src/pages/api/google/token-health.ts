/**
 * POST /api/google/token-health
 *
 * Proactive check of the shared Google OAuth token (used by both DV360 and
 * Google Ads). Attempts a token refresh and reports whether it still works, so
 * the UI can prompt a reconnect BEFORE a data fetch fails.
 *
 * Body: { clientId?, clientSecret?, refreshToken? } — falls back to server env.
 * Returns: { connected, ok, expired?, error? }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { getGoogleAccessToken } from "@/lib/api-clients/google-token-cache";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const b = (req.body || {}) as Record<string, string | undefined>;
  const clientId = b.clientId || process.env.DEFAULT_DV360_CLIENT_ID || "";
  const clientSecret = b.clientSecret || process.env.DEFAULT_DV360_CLIENT_SECRET || "";
  const refreshToken = b.refreshToken || process.env.DEFAULT_DV360_REFRESH_TOKEN || "";

  // Nothing to check — Google isn't connected.
  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(200).json({ connected: false, ok: false });
  }

  try {
    await getGoogleAccessToken(clientId, clientSecret, refreshToken);
    return res.status(200).json({ connected: true, ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    const expired = /invalid_grant|expired|revoked|unauthor|\b40[013]\b/i.test(msg);
    return res.status(200).json({ connected: true, ok: false, expired, error: msg.slice(0, 200) });
  }
}
