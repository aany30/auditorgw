/**
 * Kicks off the Snapchat OAuth flow.
 *
 * Hit /api/auth/snapchat/start → redirects user to Snapchat's consent screen.
 * After they approve, Snapchat sends them back to /api/auth/snapchat/callback.
 *
 * Scope requested:
 *   - snapchat-marketing-api — read/manage Snapchat Ads entities and reporting
 *
 * Env vars (in .env.local):
 *   SNAPCHAT_CLIENT_ID=...       (from Snap Business Manager)
 *   SNAPCHAT_CLIENT_SECRET=...   (from Snap Business Manager — KEEP SECRET)
 */

import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.SNAPCHAT_PUBLIC_CLIENT_ID || process.env.SNAPCHAT_CLIENT_ID;

  if (!clientId) {
    return res.redirect("/?error=snapchat_oauth_not_configured");
  }

  const redirectUri =
    process.env.SNAPCHAT_REDIRECT_URI ||
    `${req.headers.origin || `http://${req.headers.host}`}/api/auth/snapchat/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "snapchat-marketing-api",
    state: "snapchat",
  });

  res.redirect(`https://accounts.snapchat.com/login/oauth2/authorize?${params.toString()}`);
}
