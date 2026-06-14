/**
 * Kicks off the Google OAuth flow.
 *
 * Hit /api/auth/google/start → redirects user to Google's consent screen.
 * After they approve, Google sends them back to /api/auth/google/callback.
 *
 * Scopes requested:
 *   - adwords            — Google Ads API
 *   - analytics.readonly — GA4 Data API
 *   - tagmanager.readonly— GTM API
 *
 * IMPORTANT — access_type=offline + prompt=consent forces Google to issue
 * a refresh_token (otherwise only short-lived access_token is returned,
 * which expires in 1 hour). The refresh_token is what we save and use
 * to mint fresh access tokens for every audit call.
 */

import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const redirectUri =
    process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI ||
    `${req.headers.origin || `http://${req.headers.host}`}/api/auth/google/callback`;

  if (!clientId) {
    return res.redirect("/?error=google_oauth_not_configured");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/adwords",
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/tagmanager.readonly",
    ].join(" "),
    access_type: "offline", // returns refresh_token
    prompt: "consent",       // forces re-consent so refresh_token is reliably issued
    include_granted_scopes: "true",
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
