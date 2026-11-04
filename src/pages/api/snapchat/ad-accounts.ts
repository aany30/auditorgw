/**
 * POST /api/snapchat/ad-accounts
 *
 * Lists every Snapchat ad account the token can reach, across ALL organizations
 * the user belongs to. Used by the Manage Accounts dropdown to auto-populate the
 * picker once a token exists — mirrors /api/meta/ad-accounts and
 * /api/dv360/advertisers so all platforms behave the same way.
 *
 * Body: { clientId, clientSecret, refreshToken }
 * Returns: { adAccounts: [{ id, name, orgId }], orgs: [{ id, name }] }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { SnapchatApiClient } from "@/lib/api-clients/snapchat";

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const clientId = (req.body?.clientId as string) || process.env.SNAPCHAT_CLIENT_ID || "";
  const clientSecret = (req.body?.clientSecret as string) || process.env.SNAPCHAT_CLIENT_SECRET || "";
  const refreshToken = (req.body?.refreshToken as string) || process.env.DEFAULT_SNAPCHAT_REFRESH_TOKEN || "";

  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(400).json({ error: "Missing Snapchat OAuth credentials" });
  }

  try {
    // adAccountId isn't needed to list orgs/accounts — pass empty.
    const client = new SnapchatApiClient({ clientId, clientSecret, refreshToken, adAccountId: "" });

    const orgData = (await client.getOrganizations()) as {
      organizations?: Array<{ organization?: { id: string; name?: string } }>;
    };
    const orgs = (orgData.organizations || [])
      .map((entry) => entry.organization)
      .filter((o): o is { id: string; name?: string } => !!o?.id);

    if (orgs.length === 0) {
      return res.status(200).json({ adAccounts: [], orgs: [] });
    }

    const allAccounts: { id: string; name: string; orgId: string }[] = [];

    await Promise.all(
      orgs.map(async (org) => {
        try {
          const aaData = (await client.listAdAccounts(org.id)) as {
            adaccounts?: Array<{ adaccount?: { id: string; name?: string } }>;
          };
          for (const entry of aaData.adaccounts || []) {
            const aa = entry.adaccount;
            if (aa?.id) {
              allAccounts.push({ id: aa.id, name: aa.name || aa.id, orgId: org.id });
            }
          }
        } catch {
          // skip this org silently
        }
      })
    );

    return res.status(200).json({
      adAccounts: allAccounts,
      orgs: orgs.map((o) => ({ id: o.id, name: o.name || o.id })),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ error: msg });
  }
}
