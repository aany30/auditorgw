/**
 * POST /api/google-ads/list-accounts
 *
 * Lists every Google Ads account the token can reach via listAccessibleCustomers,
 * dropping manager (MCC) accounts — metrics can only be queried on leaf accounts.
 * Used by the Manage Accounts dropdown to auto-populate the picker once a token
 * exists, mirroring /api/meta/ad-accounts and /api/dv360/advertisers.
 *
 * Body: { clientId, clientSecret, refreshToken }
 * Returns: { accounts: [{ id, name }] }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { getGoogleAccessToken } from "@/lib/api-clients/google-token-cache";

export const config = { maxDuration: 60 };

const GADS_BASE = "https://googleads.googleapis.com/v26";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const clientId = (req.body?.clientId as string) || process.env.DEFAULT_DV360_CLIENT_ID || "";
  const clientSecret = (req.body?.clientSecret as string) || process.env.DEFAULT_DV360_CLIENT_SECRET || "";
  const refreshToken = (req.body?.refreshToken as string) || process.env.DEFAULT_DV360_REFRESH_TOKEN || "";
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "";

  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(400).json({ error: "Missing Google OAuth credentials" });
  }
  if (!developerToken) {
    return res.status(400).json({ error: "Missing GOOGLE_ADS_DEVELOPER_TOKEN" });
  }

  try {
    const accessToken = await getGoogleAccessToken(clientId, clientSecret, refreshToken);
    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
    };

    const listRes = await fetch(`${GADS_BASE}/customers:listAccessibleCustomers`, {
      headers: authHeaders,
    });
    if (!listRes.ok) {
      const err = await listRes.text();
      return res.status(listRes.status).json({ error: err.slice(0, 300) || "Google Ads API error" });
    }

    const listData = await listRes.json();
    const resourceNames: string[] = listData.resourceNames || [];
    const customerIds = resourceNames.map((r) => r.replace("customers/", ""));

    const accounts: { id: string; name: string }[] = [];

    // Fetch each customer's info to drop managers, in parallel.
    await Promise.all(
      customerIds.map(async (cid) => {
        try {
          const infoRes = await fetch(`${GADS_BASE}/customers/${cid}`, { headers: authHeaders });
          if (infoRes.ok) {
            const info = await infoRes.json();
            if (!info.manager) {
              accounts.push({ id: cid, name: info.descriptiveName || cid });
            }
          } else {
            // If we can't read info, keep it as a leaf rather than hiding it.
            accounts.push({ id: cid, name: cid });
          }
        } catch {
          accounts.push({ id: cid, name: cid });
        }
      })
    );

    return res.status(200).json({ accounts });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ error: msg });
  }
}
