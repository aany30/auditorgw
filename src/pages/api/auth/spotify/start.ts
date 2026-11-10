/**
 * Kicks off the Spotify OAuth flow.
 *
 * Hit /api/auth/spotify/start -> redirects user to Spotify's consent screen.
 * After they approve, Spotify sends them back to /api/auth/spotify/callback.
 *
 * Env vars (in .env.local):
 *   SPOTIFY_CLIENT_ID=...
 *   SPOTIFY_CLIENT_SECRET=...
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { requestOrigin } from "@/lib/oauth-redirect";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;

  if (!clientId) {
    return res.redirect("/?error=spotify_oauth_not_configured");
  }

  const redirectUri =
    process.env.SPOTIFY_REDIRECT_URI ||
    `${requestOrigin(req)}/api/auth/spotify/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state: "spotify",
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
}
