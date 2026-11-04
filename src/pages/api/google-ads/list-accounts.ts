/**
 * POST /api/google-ads/list-accounts
 *
 * Lists every Google Ads account the token can reach via listAccessibleCustomers.
 * MCC (manager) accounts are returned with their child (leaf) accounts nested
 * under them so the UI can display a hierarchical picker.
 *
 * Body: { clientId, clientSecret, refreshToken }
 * Returns: { accounts: [{ id, name, isManager, children?: [{ id, name }] }] }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { getGoogleAccessToken } from "@/lib/api-clients/google-token-cache";

export const config = { maxDuration: 120 };

const GADS_BASE = "https://googleads.googleapis.com/v19";

interface AccountInfo {
  id: string;
  name: string;
  isManager: boolean;
  children?: { id: string; name: string }[];
}

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
    const authHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
    };

    // Step 1: Get all accessible customer IDs
    const listRes = await fetch(`${GADS_BASE}/customers:listAccessibleCustomers`, {
      headers: authHeaders,
    });
    if (!listRes.ok) {
      const err = await listRes.text();
      return res.status(listRes.status).json({ error: err.slice(0, 300) || "Google Ads API error" });
    }

    const listData = await listRes.json();
    const resourceNames: string[] = listData.resourceNames || [];
    const customerIds = resourceNames.map((r: string) => r.replace("customers/", ""));

    // Step 2: Fetch info for each customer (name + isManager) in parallel
    const infoMap = new Map<string, { name: string; isManager: boolean }>();
    await Promise.all(
      customerIds.map(async (cid) => {
        try {
          const infoRes = await fetch(`${GADS_BASE}/customers/${cid}`, { headers: authHeaders });
          if (infoRes.ok) {
            const info = await infoRes.json();
            infoMap.set(cid, {
              name: info.descriptiveName || cid,
              isManager: !!info.manager,
            });
          } else {
            infoMap.set(cid, { name: cid, isManager: false });
          }
        } catch {
          infoMap.set(cid, { name: cid, isManager: false });
        }
      })
    );

    // Step 3: For each MCC account, fetch child accounts via GAQL
    const accounts: AccountInfo[] = [];
    const managerIds = customerIds.filter((id) => infoMap.get(id)?.isManager);
    const leafIds = customerIds.filter((id) => !infoMap.get(id)?.isManager);
    const childrenClaimed = new Set<string>();

    await Promise.all(
      managerIds.map(async (mccId) => {
        const children = await fetchMccChildren(mccId, authHeaders, developerToken);
        const mccInfo = infoMap.get(mccId)!;
        accounts.push({
          id: mccId,
          name: mccInfo.name,
          isManager: true,
          children,
        });
        for (const c of children) childrenClaimed.add(c.id);
      })
    );

    // Step 4: Add standalone leaf accounts (not claimed by any MCC)
    for (const lid of leafIds) {
      if (!childrenClaimed.has(lid)) {
        const info = infoMap.get(lid)!;
        accounts.push({ id: lid, name: info.name, isManager: false });
      }
    }

    // Sort: MCC accounts first (alphabetical), then standalone leaves
    accounts.sort((a, b) => {
      if (a.isManager !== b.isManager) return a.isManager ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return res.status(200).json({ accounts });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ error: msg });
  }
}

async function fetchMccChildren(
  mccId: string,
  authHeaders: Record<string, string>,
  developerToken: string,
): Promise<{ id: string; name: string }[]> {
  try {
    const gaql = `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.manager,
        customer_client.status
      FROM customer_client
      WHERE customer_client.manager = FALSE
        AND customer_client.status = 'ENABLED'
    `;

    const searchRes = await fetch(
      `${GADS_BASE}/customers/${mccId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
          "login-customer-id": mccId,
        },
        body: JSON.stringify({ query: gaql }),
      },
    );

    if (!searchRes.ok) return [];

    const streamData = await searchRes.json();
    const children: { id: string; name: string }[] = [];

    for (const batch of streamData) {
      const results = batch.results || [];
      for (const row of results) {
        const cc = row.customerClient;
        if (!cc) continue;
        children.push({
          id: String(cc.id || ""),
          name: cc.descriptiveName || String(cc.id || ""),
        });
      }
    }

    children.sort((a, b) => a.name.localeCompare(b.name));
    return children;
  } catch {
    return [];
  }
}
