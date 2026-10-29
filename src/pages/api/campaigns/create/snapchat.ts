import type { NextApiRequest, NextApiResponse } from "next";
import { resolveSnapchatCreds } from "@/lib/default-credentials";
import { SnapchatApiClient } from "@/lib/api-clients/snapchat";
import type {
  SnapchatCampaignInput,
  SnapchatAdSquadInput,
  CreateCampaignResponse,
} from "@/types/create-campaign";

/**
 * POST /api/campaigns/create/snapchat
 *
 * Creates a Snapchat campaign (+ optional ad squad).
 * Hierarchy: Campaign → Ad Squad
 * All entities created in PAUSED state.
 *
 * Snapchat Marketing API v1 uses POST to create, with entity arrays:
 * POST /v1/adaccounts/{id}/campaigns  body: { campaigns: [...] }
 * POST /v1/campaigns/{id}/adsquads    body: { adsquads: [...] }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body ?? {};
  const creds = resolveSnapchatCreds(body as Record<string, unknown>);
  if (!creds) {
    return res.status(400).json({
      success: false,
      error: "Snapchat credentials required (clientId, clientSecret, refreshToken, adAccountId).",
    } as CreateCampaignResponse);
  }

  const campaign = body.campaign as SnapchatCampaignInput | undefined;
  if (!campaign?.name) {
    return res.status(400).json({
      success: false,
      error: "Campaign name is required.",
    } as CreateCampaignResponse);
  }

  const client = new SnapchatApiClient({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refreshToken: creds.refreshToken,
    adAccountId: creds.adAccountId,
    orgId: creds.orgId,
  });

  const partialErrors: string[] = [];
  let campaignId: string | undefined;
  let adSquadId: string | undefined;

  try {
    // Step 1: Create campaign
    const campaignResult = await client.createCampaign({
      ...campaign,
      status: "PAUSED",
    });
    campaignId = (campaignResult as { id?: string })?.id;

    // Step 2: Create ad squad (optional)
    const adSquad = body.adSquad as SnapchatAdSquadInput | undefined;
    if (adSquad?.name && campaignId) {
      try {
        const adSquadResult = await client.createAdSquad(campaignId, {
          ...adSquad,
          status: "PAUSED",
        });
        adSquadId = (adSquadResult as { id?: string })?.id;
      } catch (e: any) {
        partialErrors.push(`Ad squad creation failed: ${e.message}`);
      }
    }
  } catch (e: any) {
    return res.status(502).json({
      success: false,
      error: e.message || "Snapchat API error",
    } as CreateCampaignResponse);
  }

  const response: CreateCampaignResponse = {
    success: true,
    campaignId,
    adSquadId,
    partialErrors: partialErrors.length > 0 ? partialErrors : undefined,
  };
  return res.status(200).json(response);
}
