/**
 * POST /api/google-ads/accounts
 *
 * Lists every account visible under the given Google Ads customer ID.
 * Used to resolve a manager account (MCC) into its child client accounts —
 * metrics can only be queried on leaf (non-manager) accounts.
 *
 * Body: { clientId, clientSecret, refreshToken, customerId, loginCustomerId? }
 * Returns: { accounts: GAdsChildAccount[] }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleAdsApiClient } from "@/lib/api-clients/google-ads";
import { resolveGoogleAdsCreds } from "@/lib/default-credentials";

export const config = { maxDuration: 60 };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const creds = resolveGoogleAdsCreds(req.body || {});
  if (!creds) {
    return res.status(400).json({ error: "Missing Google Ads credentials." });
  }

  try {
    // Query customer_client FROM the entered account, so login-customer-id must
    // be that same account (required when it's a manager).
    const client = new GoogleAdsApiClient({
      ...creds,
      loginCustomerId: creds.loginCustomerId || creds.customerId,
    });
    const accounts = await client.listChildAccounts();
    return res.status(200).json({ accounts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Google Ads accounts fetch failed:", message);
    return res.status(502).json({ error: message });
  }
}
