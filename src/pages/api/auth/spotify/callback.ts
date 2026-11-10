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

    // Fetch businesses (non-fatal)
    try {
      const bizRes = await fetch(`${SPOTIFY_ADS_BASE}/businesses`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (bizRes.ok) {
        const bizData = await bizRes.json();
        const businesses = bizData.businesses || bizData.data || [];
        if (businesses.length > 0) {
          const biz = businesses[0];
          const bizId = biz.id || biz.business_id || "";
          if (bizId) params.set("spotify_biz_id", bizId);
        }
      }
    } catch {
      // Non-fatal
    }

    // Fetch ad accounts (non-fatal)
    try {
      const memberAccountsRes = await fetch(
        `${SPOTIFY_ADS_BASE}/ad_accounts/business_member`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (memberAccountsRes.ok) {
        const aaData = await memberAccountsRes.json();
        const adAccounts = aaData.ad_accounts || aaData.data || [];
        const ids: string[] = [];
        const names: string[] = [];
        for (const aa of adAccounts) {
          const id = aa.ad_account_id || aa.id || "";
          const name = aa.name || aa.ad_account_name || id;
          if (id) {
            ids.push(id);
            names.push(name);
          }
        }
        if (ids.length > 0) {
          params.set("spotify_ad_account_ids", ids.join(","));
          params.set("spotify_ad_account_names", names.join("|"));
        }
      }
    } catch {
      // Non-fatal
    }

    res.redirect(`/app/dashboard?${params.toString()}`);
  } catch (e) {
    console.error("Spotify OAuth callback error:", e);
    res.redirect("/?error=spotify_oauth_error");
  }
}
