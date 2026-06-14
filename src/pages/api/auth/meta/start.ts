/**
 * Kicks off the Meta OAuth flow.
 *
 * Hit /api/auth/meta/start → redirects user to Meta's consent screen.
 * After they approve, Meta sends them back to /api/auth/meta/callback.
 *
 * Scopes requested:
 *   - ads_read        — read campaigns/ad sets/ads/insights
 *   - business_management — read Business Manager + ad accounts
 *   - pages_show_list — optional, to enumerate associated pages
 *
 * NOTE: For the app to work in production with ads_read, Meta requires
 * "App Review" (2-6 weeks). In Development mode it works immediately for
 * the app owner + anyone added as a Tester in Roles → Roles in the app dashboard.
 */

import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const redirectUri =
    process.env.NEXT_PUBLIC_META_REDIRECT_URI ||
    `${req.headers.origin || `http://${req.headers.host}`}/api/auth/meta/callback`;

  if (!appId) {
    return res.redirect("/?error=meta_oauth_not_configured");
  }

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "ads_read,business_management,pages_show_list",
    auth_type: "rerequest", // re-prompt for scopes if user previously denied any
  });

  res.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`);
}
