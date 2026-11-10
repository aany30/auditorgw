/**
 * Spotify OAuth callback — exchanges auth code for a refresh token.
 *
 * Flow:
 *  1. User clicks "Connect with Spotify" -> /api/auth/spotify/start -> Spotify consent
 *  2. Spotify redirects here with ?code=<auth_code>
 *  3. We exchange code -> access_token + refresh_token
 *  4. Fetch businesses + ad accounts from Spotify Ads API
 *  5. Redirect to dashboard with credentials as query params
 *
 * Env vars (in .env.local):
 *   SPOTIFY_CLIENT_ID=...
 *   SPOTIFY_CLIENT_SECRET=...
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { requestOrigin } from "@/lib/oauth-redirect";

const SPOTIFY_ADS_BASE = "https://api-partner.spotify.com/ads/v3";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`/?error=spotify_oauth_${error}`);
  }
  if (!code) {
    return res.redirect("/?error=spotify_no_code");
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri =
    process.env.SPOTIFY_REDIRECT_URI ||
    `${requestOrigin(req)}/api/auth/spotify/callback`;

  if (!clientId || !clientSecret) {
    console.error("Missing Spotify OAuth env vars");
    return res.redirect("/?error=spotify_oauth_not_configured");
  }

  try {
    // Exchange auth code for tokens
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        code: code as string,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.refresh_token) {
      console.error("Spotify token exchange failed:", tokenData);
      const detail = tokenData.error_description || tokenData.error || "no_refresh_token";
      return res.redirect(`/?error=spotify_token_exchange&detail=${encodeURIComponent(detail)}`);
    }

    const refreshToken = tokenData.refresh_token as string;
    const accessToken = tokenData.access_token as string;

    const params = new URLSearchParams({
      spotify_refresh: refreshToken,
      spotify_client_id: clientId,
      spotify_client_secret: clientSecret,
    });

    // Auto-detect ad accounts. Spotify has no top-level ad-accounts list — they
    // are business-scoped: GET /businesses, then GET /businesses/{id}/ad_accounts
    // for each. If this yields nothing (or errors), we signal the dashboard so it
    // can prompt for a manual Ad Account ID instead of failing silently.
    const ids: string[] = [];
    const names: string[] = [];
    try {
      const bizRes = await fetch(`${SPOTIFY_ADS_BASE}/businesses`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (bizRes.ok) {
        const bizData = await bizRes.json();
        const businesses = bizData.businesses || bizData.data || [];
        if (businesses.length > 0) {
          const firstBizId = businesses[0].id || businesses[0].business_id || "";
          if (firstBizId) params.set("spotify_biz_id", firstBizId);
        }
        const seen = new Set<string>();
        for (const biz of businesses) {
          const bizId = biz.id || biz.business_id || "";
          if (!bizId) continue;
          try {
            const aaRes = await fetch(
              `${SPOTIFY_ADS_BASE}/businesses/${encodeURIComponent(bizId)}/ad_accounts`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            if (!aaRes.ok) continue;
            const aaData = await aaRes.json();
            for (const aa of aaData.ad_accounts || aaData.data || []) {
              const id = aa.id || aa.ad_account_id || "";
              if (!id || seen.has(id)) continue;
              seen.add(id);
              ids.push(id);
              names.push(aa.name || aa.ad_account_name || id);
            }
          } catch {
            // Skip this business — others may still resolve.
          }
        }
      }
    } catch {
      // Non-fatal — fall through to the manual-entry signal below.
    }

    // If nothing was detected, we still redirect with the refresh token so the
    // dashboard marks Spotify authenticated-but-not-connected and shows the
    // manual Ad Account ID entry in Manage Accounts.
    if (ids.length > 0) {
      params.set("spotify_ad_account_ids", ids.join(","));
      params.set("spotify_ad_account_names", names.join("|"));
    }

    res.redirect(`/app/dashboard?${params.toString()}`);
  } catch (e) {
    console.error("Spotify OAuth callback error:", e);
    res.redirect("/?error=spotify_oauth_error");
  }
}
