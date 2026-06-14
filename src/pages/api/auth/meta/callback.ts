/**
 * Meta OAuth callback — proper Facebook Graph implementation.
 *
 * Flow:
 *  1. User clicks "Connect with Meta" → /api/auth/meta/start → Meta consent screen
 *  2. Meta redirects here with ?code=<auth_code>
 *  3. We exchange code → short-lived access_token (1 hour)
 *  4. Exchange short-lived → long-lived token (60 days) via fb_exchange_token
 *  5. Fetch user's ad accounts via /me/adaccounts
 *  6. Fetch business assets if available
 *  7. Redirect to dashboard with token + ad-account list as query params
 *
 * Env vars (in .env.local):
 *   NEXT_PUBLIC_META_APP_ID=...      (from developers.facebook.com)
 *   META_APP_SECRET=...               (from developers.facebook.com — KEEP SECRET)
 *   NEXT_PUBLIC_META_REDIRECT_URI=... (must match the URI registered in the app)
 */

import { NextApiRequest, NextApiResponse } from "next";

interface ShortLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

interface LongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

interface AdAccount {
  id: string;          // formatted "act_1234567890"
  account_id: string;  // bare "1234567890"
  name: string;
  account_status?: number;
  business?: { id: string; name?: string };
}

interface AdAccountsResponse {
  data: AdAccount[];
}

interface BusinessesResponse {
  data: Array<{ id: string; name: string }>;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`/?error=meta_oauth_${error}`);
  }
  if (!code) {
    return res.redirect("/?error=meta_no_code");
  }

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri =
    process.env.NEXT_PUBLIC_META_REDIRECT_URI ||
    `${req.headers.origin || `http://${req.headers.host}`}/api/auth/meta/callback`;

  if (!appId || !appSecret) {
    console.error("Missing Meta OAuth env vars");
    return res.redirect("/?error=meta_oauth_not_configured");
  }

  try {
    // STEP 1 — Exchange code for short-lived access token (1 hour)
    const tokenRes = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?` +
        new URLSearchParams({
          client_id: appId,
          client_secret: appSecret,
          redirect_uri: redirectUri,
          code: code as string,
        }).toString()
    );
    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      console.error("Meta token exchange failed:", err);
      return res.redirect(`/?error=meta_token_exchange&detail=${encodeURIComponent(err.error?.message || "")}`);
    }
    const tokenData = (await tokenRes.json()) as ShortLivedTokenResponse;
    const shortLived = tokenData.access_token;

    // STEP 2 — Exchange short-lived → long-lived token (60 days)
    const llRes = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?` +
        new URLSearchParams({
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortLived,
        }).toString()
    );
    const longLivedToken = llRes.ok
      ? ((await llRes.json()) as LongLivedTokenResponse).access_token
      : shortLived; // fall back to short-lived if extension fails

    // STEP 3 — Fetch user's ad accounts (NOT pages — pages live at /me/accounts)
    const adAccountsRes = await fetch(
      `https://graph.facebook.com/v18.0/me/adaccounts?fields=id,account_id,name,account_status,business&limit=100&access_token=${longLivedToken}`
    );
    const adAccountsData: AdAccountsResponse = adAccountsRes.ok
      ? await adAccountsRes.json()
      : { data: [] };
    const adAccounts = adAccountsData.data || [];

    // STEP 4 — Fetch user's business managers (for businessId disambiguation)
    let primaryBusinessId = "";
    try {
      const bizRes = await fetch(
        `https://graph.facebook.com/v18.0/me/businesses?fields=id,name&access_token=${longLivedToken}`
      );
      if (bizRes.ok) {
        const bizData = (await bizRes.json()) as BusinessesResponse;
        primaryBusinessId = bizData.data?.[0]?.id || "";
      }
    } catch {
      /* not fatal — most accounts have a business but it's not required */
    }

    if (adAccounts.length === 0) {
      // OAuth worked but user has no ad accounts they can access
      return res.redirect("/?error=meta_no_ad_accounts");
    }

    // STEP 5 — Build redirect to dashboard
    // For the auditor, businessId = the first ad account's account_id (bare numeric).
    // The audit endpoints accept either a Business Manager ID or an ad-account ID.
    const businessId = primaryBusinessId || adAccounts[0].account_id;
    const adAccountIds = adAccounts.map((a) => a.account_id).join(",");
    const adAccountNames = adAccounts.map((a) => a.name).join("|");

    res.redirect(
      `/app/dashboard?meta_token=${encodeURIComponent(longLivedToken)}` +
        `&business_id=${encodeURIComponent(businessId)}` +
        `&pixel_ids=${encodeURIComponent(adAccountIds)}` +
        `&pixel_names=${encodeURIComponent(adAccountNames)}`
    );
  } catch (e) {
    console.error("Meta OAuth callback error:", e);
    res.redirect("/?error=meta_oauth_error");
  }
}
