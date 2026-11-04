import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";

/**
 * POST /api/data-deletion
 *
 * Meta Data Deletion Request Callback.
 * Meta sends a signed POST when a user requests deletion of their data.
 *
 * Since we don't permanently store user data on the server (tokens are in
 * the user's browser localStorage, campaign data is fetched in real time),
 * we acknowledge the request and provide a confirmation code + status URL.
 *
 * See: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const signedRequest = req.body?.signed_request;
  if (!signedRequest) {
    return res.status(400).json({ error: "Missing signed_request" });
  }

  const appSecret = process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || "";
  if (!appSecret) {
    return res.status(500).json({ error: "App secret not configured" });
  }

  const data = parseSignedRequest(signedRequest, appSecret);
  if (!data) {
    return res.status(400).json({ error: "Invalid signed_request" });
  }

  const userId = data.user_id;
  const confirmationCode = `del_${userId}_${Date.now()}`;
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || `https://${req.headers.host}`;

  // Since we store no persistent user data server-side, deletion is instant.
  // The confirmation URL shows the user the status.
  return res.status(200).json({
    url: `${siteUrl}/deletion-status?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}

function parseSignedRequest(
  signedRequest: string,
  secret: string,
): Record<string, unknown> | null {
  const [encodedSig, payload] = signedRequest.split(".");
  if (!encodedSig || !payload) return null;

  const sig = base64UrlDecode(encodedSig);
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest();

  if (!crypto.timingSafeEqual(sig, expectedSig)) return null;

  try {
    return JSON.parse(base64UrlDecode(payload).toString("utf8"));
  } catch {
    return null;
  }
}

function base64UrlDecode(str: string): Buffer {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  return Buffer.from(base64, "base64");
}
