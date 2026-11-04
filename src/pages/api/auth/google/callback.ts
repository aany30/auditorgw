/**
 * Google OAuth callback — exchanges auth code for a refresh token.
 *
 * Flow:
 *  1. User clicks "Connect with Google" → /api/auth/google/start → Google consent
 *  2. Google redirects here with ?code=<auth_code>
 *  3. We exchange code → access_token + refresh_token
 *  4. Redirect to dashboard with refresh_token + client creds as query params
 *     (dashboard.tsx picks them up and saves to Zustand store)
 *
 * Env vars (in .env.local):
 *   GOOGLE_CLIENT_ID=...
 *   GOOGLE_CLIENT_SECRET=...
 */

import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`/?error=google_oauth_${error}`);
  }
  if (!code) {
    return res.redirect("/?error=google_no_code");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `${req.headers.origin || `http://${req.headers.host}`}/api/auth/google/callback`;

  if (!clientId || !clientSecret) {
    console.error("Missing Google OAuth env vars");
    return res.redirect("/?error=google_oauth_not_configured");
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
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
      console.error("Google token exchange failed:", tokenData);
      const detail = tokenData.error_description || tokenData.error || "no_refresh_token";
      return res.redirect(`/?error=google_token_exchange&detail=${encodeURIComponent(detail)}`);
    }

    const refreshToken = tokenData.refresh_token as string;
    const accessToken = tokenData.access_token as string;

    // Capture the Google login email (openid/email scope) so alerts can default
    // to the account the user signed in with — no manual entry needed.
    let loginEmail = "";
    try {
      const uiRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (uiRes.ok) {
        const ui = await uiRes.json();
        loginEmail = (ui.email as string) || "";
      }
    } catch {
      // Non-fatal — user can still add an alert email manually.
    }

    let advertiserIds: string[] = [];
    let advertiserNames: string[] = [];
    let partnerIds: string[] = [];
    try {
      // Step 1: discover ALL the user's DV360 partners
      const partnerRes = await fetch(
        "https://displayvideo.googleapis.com/v4/partners?" +
          new URLSearchParams({ pageSize: "50" }).toString(),
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (partnerRes.ok) {
        const partnerData = await partnerRes.json();
        const partners: { partnerId: string }[] = partnerData.partners || [];
        partnerIds = partners.map((p) => p.partnerId);
      }
      // Step 2: list advertisers under EVERY partner
      for (const pid of partnerIds) {
        try {
          const advRes = await fetch(
            "https://displayvideo.googleapis.com/v4/advertisers?" +
              new URLSearchParams({ partnerId: pid, pageSize: "100" }).toString(),
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (advRes.ok) {
            const advData = await advRes.json();
            for (const a of advData.advertisers || []) {
              advertiserIds.push(a.advertiserId);
              advertiserNames.push(a.displayName || a.advertiserId);
            }
          }
        } catch {
          // skip this partner
        }
      }
    } catch {
      // Non-fatal — user can paste advertiser ID manually
    }

    const params = new URLSearchParams({
      dv360_refresh: refreshToken,
      dv360_client_id: clientId,
      dv360_client_secret: clientSecret,
    });
    if (loginEmail) params.set("login_email", loginEmail);
    if (partnerIds.length > 0) params.set("dv360_partner_id", partnerIds[0]);

    if (advertiserIds.length > 0) {
      params.set("dv360_adv_ids", advertiserIds.join(","));
      params.set("dv360_adv_names", advertiserNames.join("|"));
    }

    // Google Ads — list accessible customer accounts (non-fatal).
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (developerToken) {
      try {
        const gadsRes = await fetch(
          "https://googleads.googleapis.com/v26/customers:listAccessibleCustomers",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "developer-token": developerToken,
            },
          },
        );
        if (gadsRes.ok) {
          const gadsData = await gadsRes.json();
          const resourceNames: string[] = gadsData.resourceNames || [];
          const customerIds = resourceNames.map((r: string) =>
            r.replace("customers/", ""),
          );
          if (customerIds.length > 0) {
            const leafIds: string[] = [];
            const leafNames: string[] = [];
            for (const cid of customerIds) {
              try {
                const infoRes = await fetch(
                  `https://googleads.googleapis.com/v26/customers/${cid}`,
                  {
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                      "developer-token": developerToken,
                    },
                  },
                );
                if (infoRes.ok) {
                  const info = await infoRes.json();
                  if (!info.manager) {
                    leafIds.push(cid);
                    leafNames.push(info.descriptiveName || cid);
                  }
                } else {
                  leafIds.push(cid);
                  leafNames.push(cid);
                }
              } catch {
                leafIds.push(cid);
                leafNames.push(cid);
              }
            }
            if (leafIds.length > 0) {
              params.set("gads_customer_ids", leafIds.join(","));
              params.set("gads_customer_names", leafNames.join("|"));
            }
          }
        }
      } catch {
        // Non-fatal — user can enter customer ID manually
      }
    }

    res.redirect(`/app/dashboard?${params.toString()}`);
  } catch (e) {
    console.error("Google OAuth callback error:", e);
    res.redirect("/?error=google_oauth_error");
  }
}
