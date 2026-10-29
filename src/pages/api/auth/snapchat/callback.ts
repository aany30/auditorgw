/**
 * Snapchat OAuth callback — exchanges auth code for a refresh token.
 *
 * Flow:
 *  1. User clicks "Connect with Snapchat" → /api/auth/snapchat/start → Snapchat consent
 *  2. Snapchat redirects here with ?code=<auth_code>
 *  3. We exchange code → access_token + refresh_token
 *  4. Fetch orgs + ad accounts from Snapchat Marketing API
 *  5. Redirect to dashboard with credentials as query params
 *     (dashboard.tsx picks them up and saves to Zustand store)
 *
 * Env vars (in .env.local):
 *   SNAPCHAT_CLIENT_ID=...
 *   SNAPCHAT_CLIENT_SECRET=...
 */

import type { NextApiRequest, NextApiResponse } from "next";

const SNAP_ADS_BASE = "https://adsapi.snapchat.com/v1";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`/?error=snapchat_oauth_${error}`);
  }
  if (!code) {
    return res.redirect("/?error=snapchat_no_code");
  }

  const clientId = process.env.SNAPCHAT_CLIENT_ID;
  const clientSecret = process.env.SNAPCHAT_CLIENT_SECRET;
  const redirectUri =
    process.env.SNAPCHAT_REDIRECT_URI ||
    `${req.headers.origin || `http://${req.headers.host}`}/api/auth/snapchat/callback`;

  if (!clientId || !clientSecret) {
    console.error("Missing Snapchat OAuth env vars");
    return res.redirect("/?error=snapchat_oauth_not_configured");
  }

  try {
    const tokenRes = await fetch("https://accounts.snapchat.com/login/oauth2/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code as string,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.refresh_token) {
      console.error("Snapchat token exchange failed:", tokenData);
      const detail = tokenData.error_description || tokenData.error || "no_refresh_token";
      return res.redirect(`/?error=snapchat_token_exchange&detail=${encodeURIComponent(detail)}`);
    }

    const refreshToken = tokenData.refresh_token as string;
    const accessToken = tokenData.access_token as string;

    const params = new URLSearchParams({
      snap_refresh: refreshToken,
      snap_client_id: clientId,
      snap_client_secret: clientSecret,
    });

    // Fetch organizations (non-fatal).
    let orgId = "";
    try {
      const orgRes = await fetch(`${SNAP_ADS_BASE}/me/organizations`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (orgRes.ok) {
        const orgData = await orgRes.json();
        const orgs = orgData.organizations || [];
        if (orgs.length > 0) {
          orgId = orgs[0].organization?.id || "";
          if (orgId) params.set("snap_org_id", orgId);
        }
      }
    } catch {
      // Non-fatal — user can enter org ID manually
    }

    // Fetch ad accounts for the first org (non-fatal).
    if (orgId) {
      try {
        const aaRes = await fetch(`${SNAP_ADS_BASE}/organizations/${orgId}/adaccounts`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (aaRes.ok) {
          const aaData = await aaRes.json();
          const adAccounts = aaData.adaccounts || [];
          const ids: string[] = [];
          const names: string[] = [];
          for (const entry of adAccounts) {
            const aa = entry.adaccount || entry;
            if (aa.id) {
              ids.push(aa.id);
              names.push(aa.name || aa.id);
            }
          }
          if (ids.length > 0) {
            params.set("snap_ad_account_ids", ids.join(","));
            params.set("snap_ad_account_names", names.join("|"));
          }
        }
      } catch {
        // Non-fatal — user can enter ad account ID manually
      }
    }

    res.redirect(`/app/dashboard?${params.toString()}`);
  } catch (e) {
    console.error("Snapchat OAuth callback error:", e);
    res.redirect("/?error=snapchat_oauth_error");
  }
}
