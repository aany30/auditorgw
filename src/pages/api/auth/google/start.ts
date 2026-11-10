/**
 * Kicks off the Google OAuth flow for DV360.
 *
 * Hit /api/auth/google/start → redirects user to Google's consent screen.
 * After they approve, Google sends them back to /api/auth/google/callback.
 *
 * Scopes requested:
 *   - display-video          — read DV360 entities (campaigns, IOs, LIs, Floodlight)
 *   - doubleclickbidmanager  — run Bid Manager performance reports
 *   - dfatrafficking         — read CM360 Floodlight config and attribution data
 *   - adwords               — read/manage Google Ads campaigns and reporting
 *
 * Env vars (in .env.local):
 *   GOOGLE_CLIENT_ID=...       (from Google Cloud Console)
 *   GOOGLE_CLIENT_SECRET=...   (from Google Cloud Console — KEEP SECRET)
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { requestOrigin } from "@/lib/oauth-redirect";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/display-video",
  "https://www.googleapis.com/auth/doubleclickbidmanager",
  "https://www.googleapis.com/auth/dfatrafficking",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/adwords",
].join(" ");

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return res.redirect("/?error=google_oauth_not_configured");
  }

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `${requestOrigin(req)}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
