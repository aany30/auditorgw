/**
 * POST /api/google-ads/list-accounts
 *
 * Lists every Google Ads account the token can reach.
 * MCC (manager) accounts are returned with their child (leaf) accounts nested
 * under them so the UI can display a hierarchical picker.
 *
 * Uses the GoogleAdsApiClient (GAQL searchStream) for fetching account info
 * and children — the REST GET endpoint 404s for accounts reached through a
 * manager, while searchStream honours login-customer-id.
 *
 * Body: { clientId, clientSecret, refreshToken }
 * Returns: { accounts: [{ id, name, isManager, children?: [{ id, name }] }] }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { getGoogleAccessToken } from "@/lib/api-clients/google-token-cache";
import { GoogleAdsApiClient } from "@/lib/api-clients/google-ads";

export const config = { maxDuration: 120 };

const GADS_BASE = "https://googleads.googleapis.com/v26";

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

    // Step 1: Get all accessible customer IDs
    const listRes = await fetch(`${GADS_BASE}/customers:listAccessibleCustomers`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
      },
    });
    if (!listRes.ok) {
      const err = await listRes.text();
      return res.status(502).json({ error: `Google Ads listAccessibleCustomers failed (${listRes.status}): ${err.slice(0, 300)}` });
    }

    const listData = await listRes.json();
    const resourceNames: string[] = listData.resourceNames || [];
    const customerIds = resourceNames.map((r: string) => r.replace("customers/", ""));

    // Step 2: For each customer, use GoogleAdsApiClient (GAQL) to get name + isManager.
    // GAQL searchStream works reliably for both normal and MCC accounts,
    // using login-customer-id = the account itself.
    const infoMap = new Map<string, { name: string; isManager: boolean }>();
    await Promise.all(
      customerIds.map(async (cid) => {
        try {
          const client = new GoogleAdsApiClient({
            clientId, clientSecret, refreshToken, developerToken,
            customerId: cid,
            loginCustomerId: cid,
          });
          const info = await client.getCustomerInfo();
          infoMap.set(cid, {
            name: info.descriptiveName || cid,
            isManager: !!info.manager,
          });
        } catch {
          infoMap.set(cid, { name: cid, isManager: false });
        }
      })
    );

    // Step 3: For each MCC, fetch child leaf accounts
    const accounts: AccountInfo[] = [];
    const managerIds = customerIds.filter((id) => infoMap.get(id)?.isManager);
    const leafIds = customerIds.filter((id) => !infoMap.get(id)?.isManager);
    const childrenClaimed = new Set<string>();

    await Promise.all(
      managerIds.map(async (mccId) => {
        try {
          const client = new GoogleAdsApiClient({
            clientId, clientSecret, refreshToken, developerToken,
            customerId: mccId,
            loginCustomerId: mccId,
          });
          const allChildren = await client.listChildAccounts();
          const leafChildren = allChildren
            .filter((c) => !c.isManager && c.id !== mccId)
            .map((c) => ({ id: c.id, name: c.name }));

          const mccInfo = infoMap.get(mccId)!;
          accounts.push({
            id: mccId,
            name: mccInfo.name,
            isManager: true,
            children: leafChildren.sort((a, b) => a.name.localeCompare(b.name)),
          });
          for (const c of leafChildren) childrenClaimed.add(c.id);
        } catch {
          const mccInfo = infoMap.get(mccId)!;
          accounts.push({ id: mccId, name: mccInfo.name, isManager: true, children: [] });
        }
      })
    );

    // Step 4: Add standalone leaf accounts (not claimed by any MCC)
    for (const lid of leafIds) {
      if (!childrenClaimed.has(lid)) {
        const info = infoMap.get(lid)!;
        accounts.push({ id: lid, name: info.name, isManager: false });
      }
    }

    // Sort: MCC accounts first, then standalone leaves, alphabetical
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
