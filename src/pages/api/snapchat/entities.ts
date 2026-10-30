/**
 * POST /api/snapchat/entities
 *
 * Returns campaigns, ad squads, and ads for the connected Snapchat ad account.
 * Mirrors /api/google-ads/entities so the Account Structure tab can treat
 * Snapchat identically. Ad squads sit in the "adGroups" slot and ads in "ads",
 * both carrying their parent campaign/squad id for grouping.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { SnapchatApiClient, type SnapchatCredentials } from "@/lib/api-clients/snapchat";

export const config = { maxDuration: 90 };

function resolveSnapchatCreds(body: Record<string, unknown>): SnapchatCredentials | null {
  const clientId = (body.clientId as string) || process.env.SNAPCHAT_CLIENT_ID;
  const clientSecret = (body.clientSecret as string) || process.env.SNAPCHAT_CLIENT_SECRET;
  const refreshToken = (body.refreshToken as string) || process.env.DEFAULT_SNAPCHAT_REFRESH_TOKEN;
  const adAccountId = (body.adAccountId as string) || process.env.DEFAULT_SNAPCHAT_AD_ACCOUNT_ID;
  const orgId = (body.orgId as string) || process.env.DEFAULT_SNAPCHAT_ORG_ID;
  if (!clientId || !clientSecret || !refreshToken || !adAccountId) return null;
  return { clientId, clientSecret, refreshToken, adAccountId, orgId };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const creds = resolveSnapchatCreds(req.body || {});
  if (!creds) return res.status(400).json({ error: "Missing Snapchat credentials." });

  try {
    const client = new SnapchatApiClient(creds);
    const [campaigns, adSquads, ads] = await Promise.all([
      client.listCampaigns(),
      client.listAdSquads().catch(() => []),
      client.listAds().catch(() => []),
    ]);
    // Shape to the Account Structure tab's expected keys (campaigns, adGroups, ads).
    const outAdGroups = adSquads.map((sq) => ({
      id: sq.id,
      name: sq.name,
      status: sq.status,
      campaignId: sq.campaignId,
      type: sq.type,
    }));
    const outAds = ads.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      adGroupId: a.adSquadId,
      type: a.type,
    }));
    return res.status(200).json({ campaigns, adGroups: outAdGroups, ads: outAds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Snapchat entities fetch failed:", message);
    return res.status(502).json({ error: message });
  }
}
