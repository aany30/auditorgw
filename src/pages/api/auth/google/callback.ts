/**
 * Google OAuth callback — returns the refresh_token to the dashboard.
 *
 * The auditor's API client uses Google Ads API which needs:
 *   - refresh_token (long-lived; what we save)
 *   - developer_token (separate, manually applied for at ads.google.com → API Center)
 *
 * Flow:
 *   1. User clicks "Connect with Google" → /api/auth/google/start
 *   2. Google consent → redirects here with ?code=...
 *   3. Exchange code → { access_token, refresh_token, scope }
 *   4. List Google Ads customers + GA4 properties + GTM containers (best-effort)
 *   5. Redirect to dashboard with refresh_token as the "googleAccessToken" the
 *      Zustand store knows about (the audit endpoints mint fresh access tokens
 *      from this refresh_token + the developer_token on each call).
 */

import type { NextApiRequest, NextApiResponse } from "next";

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`/?error=google_oauth_${error}`);
  }
  if (!code) {
    return res.redirect("/?error=google_no_code");
  }

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI ||
    `${req.headers.origin || `http://${req.headers.host}`}/api/auth/google/callback`;

  if (!clientId || !clientSecret) {
    console.error("Missing Google OAuth env vars");
    return res.redirect("/?error=google_oauth_not_configured");
  }

  try {
    // STEP 1 — Exchange auth code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code: code as string,
        grant_type: "authorization_code",
      }).toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      console.error("Google token exchange failed:", err);
      return res.redirect(`/?error=google_token_exchange&detail=${encodeURIComponent(err.error_description || "")}`);
    }

    const tokenData = (await tokenRes.json()) as GoogleTokenResponse;
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;

    if (!refreshToken) {
      // This happens if the user previously authorized this app — Google won't
      // re-issue a refresh_token unless we forced prompt=consent in /start.
      // (We do force it, so this is rare.)
      console.warn("Google did not return a refresh_token");
      return res.redirect("/?error=google_no_refresh_token");
    }

    // STEP 2 — Best-effort fetch of the user's first Google Ads customer,
    // GA4 property, and GTM container so the dashboard auto-selects them.
    // We use the short-lived access_token for these (only valid for 1 hour,
    // but that's fine for this one-time discovery call).
    let customerId = "";
    let propertyId = "";
    let containerId = "";

    // Google Ads — list accessible customers
    try {
      const r = await fetch(
        "https://googleads.googleapis.com/v16/customers:listAccessibleCustomers",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (r.ok) {
        const data = (await r.json()) as { resourceNames?: string[] };
        const first = data.resourceNames?.[0];
        if (first) customerId = first.split("/").pop() || "";
      }
    } catch (_e) { /* not fatal */ }

    // GA4 — list properties (uses Admin API)
    try {
      const r = await fetch(
        "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (r.ok) {
        const data = (await r.json()) as { accountSummaries?: Array<{ propertySummaries?: Array<{ property?: string }> }> };
        const firstProp = data.accountSummaries?.[0]?.propertySummaries?.[0]?.property;
        if (firstProp) propertyId = firstProp.split("/").pop() || "";
      }
    } catch (_e) { /* not fatal */ }

    // GTM — list accounts + containers
    try {
      const r = await fetch("https://www.googleapis.com/tagmanager/v2/accounts", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (r.ok) {
        const data = (await r.json()) as { account?: Array<{ path?: string }> };
        const acctPath = data.account?.[0]?.path;
        if (acctPath) {
          const c = await fetch(
            `https://www.googleapis.com/tagmanager/v2/${acctPath}/containers`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (c.ok) {
            const cd = (await c.json()) as { container?: Array<{ publicId?: string }> };
            containerId = cd.container?.[0]?.publicId || "";
          }
        }
      }
    } catch (_e) { /* not fatal */ }

    // STEP 3 — Redirect to dashboard. We save the refresh_token AS the
    // "googleAccessToken" field — the existing audit endpoints know to mint
    // a fresh access token from it + the developer_token on each call.
    res.redirect(
      `/app/dashboard?google_token=${encodeURIComponent(refreshToken)}` +
        `&customer_id=${encodeURIComponent(customerId)}` +
        `&property_id=${encodeURIComponent(propertyId)}` +
        `&container_id=${encodeURIComponent(containerId)}`
    );
  } catch (e) {
    console.error("Google OAuth callback error:", e);
    res.redirect("/?error=google_oauth_error");
  }
}
