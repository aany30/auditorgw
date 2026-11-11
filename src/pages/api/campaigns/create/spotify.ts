import type { NextApiRequest, NextApiResponse } from "next";
import { resolveSpotifyCreds } from "@/lib/default-credentials";
import { SpotifyAdsApiClient } from "@/lib/api-clients/spotify-ads";
import type { CreateCampaignResponse } from "@/types/create-campaign";

/**
 * POST /api/campaigns/create/spotify
 *
 * Creates a Spotify campaign + ad set.
 * Hierarchy: Campaign → Ad Set (→ Ad, future)
 *
 * Spotify Ads API v3:
 *   POST /ad_accounts/{id}/campaigns   body: { name, delivery_goal_group }
 *   POST /ad_accounts/{id}/ad_sets     body: { campaign_id, name, start_time, budget, targets, ... }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body ?? {};
  const creds = resolveSpotifyCreds(body as Record<string, unknown>);
  if (!creds) {
    return res.status(400).json({
      success: false,
      error: "Spotify credentials required (clientId, clientSecret, refreshToken, adAccountId).",
    } as CreateCampaignResponse);
  }

  const campaignInput = body.campaign as { name?: string; delivery_goal_group?: string } | undefined;
  if (!campaignInput?.name) {
    return res.status(400).json({
      success: false,
      error: "Campaign name is required.",
    } as CreateCampaignResponse);
  }

  const client = new SpotifyAdsApiClient({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refreshToken: creds.refreshToken,
    adAccountId: creds.adAccountId,
  });

  const partialErrors: string[] = [];
  let campaignId: string | undefined;
  let adSetId: string | undefined;

  try {
    // Step 1: Create campaign
    const campaignResult = await client.createCampaign({
      name: campaignInput.name,
      delivery_goal_group: campaignInput.delivery_goal_group,
    });
    campaignId = campaignResult.id;

    // Step 2: Create ad set (optional)
    const adSetInput = body.adSet as Record<string, unknown> | undefined;
    if (adSetInput?.name && campaignId) {
      try {
        const adSetResult = await client.createAdSet({
          campaign_id: campaignId,
          name: adSetInput.name as string,
          start_time: adSetInput.start_time as string,
          end_time: adSetInput.end_time as string | undefined,
          budget: adSetInput.budget as { micro_amount: number; type: "DAILY" | "LIFETIME" },
          targets: adSetInput.targets as {
            placements?: string[];
            age_ranges?: string[];
            genders?: string[];
            platforms?: string[];
            geo_targets?: Array<{ country_code: string }>;
          },
          delivery_goal: adSetInput.delivery_goal as string | undefined,
          bid_strategy: adSetInput.bid_strategy as string | undefined,
        });
        adSetId = adSetResult.id;
      } catch (e: any) {
        partialErrors.push(`Ad set creation failed: ${e.message}`);
      }
    }
  } catch (e: any) {
    return res.status(502).json({
      success: false,
      error: e.message || "Spotify API error",
    } as CreateCampaignResponse);
  }

  const response: CreateCampaignResponse = {
    success: true,
    campaignId,
    adsetId: adSetId,
    partialErrors: partialErrors.length > 0 ? partialErrors : undefined,
  };
  return res.status(200).json(response);
}
