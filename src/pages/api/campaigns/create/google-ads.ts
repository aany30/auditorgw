import type { NextApiRequest, NextApiResponse } from "next";
import { resolveGoogleAdsCreds } from "@/lib/default-credentials";
import { GoogleAdsApiClient } from "@/lib/api-clients/google-ads";
import type {
  GAdsCampaignInput,
  GAdsAdGroupInput,
  GAdsAdInput,
  CreateCampaignResponse,
} from "@/types/create-campaign";

/**
 * POST /api/campaigns/create/google-ads
 *
 * Creates a Google Ads campaign (+ optional ad group + ad).
 * Hierarchy: Campaign Budget → Campaign → Ad Group → Ad
 * All entities created in PAUSED state.
 *
 * Google Ads API v26 uses the mutate pattern — all writes go through
 * POST /customers/{customerId}/{resource}:mutate.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body ?? {};
  const creds = resolveGoogleAdsCreds(body as Record<string, unknown>);
  if (!creds) {
    return res.status(400).json({
      success: false,
      error: "Google Ads credentials required (refreshToken + customerId + developerToken).",
    } as CreateCampaignResponse);
  }

  const campaign = body.campaign as GAdsCampaignInput | undefined;
  if (!campaign?.name || !campaign?.advertisingChannelType || !campaign?.dailyBudget) {
    return res.status(400).json({
      success: false,
      error: "Campaign name, channel type, and daily budget are required.",
    } as CreateCampaignResponse);
  }

  const client = new GoogleAdsApiClient(creds);
  const partialErrors: string[] = [];
  let campaignId: string | undefined;
  let adGroupId: string | undefined;
  let adGroupAdId: string | undefined;

  try {
    // Step 1: Create campaign budget
    const budgetMicros = String(Math.round(campaign.dailyBudget * 1_000_000));
    const budgetResourceName = await client.createCampaignBudget({
      name: `${campaign.name} Budget`,
      amountMicros: budgetMicros,
      deliveryMethod: "STANDARD",
      explicitlyShared: false,
    });

    // Step 2: Create campaign
    const campaignResourceName = await client.createCampaign({
      name: campaign.name,
      advertisingChannelType: campaign.advertisingChannelType,
      status: "PAUSED",
      campaignBudget: budgetResourceName,
      biddingStrategyType: campaign.biddingStrategyType || "MAXIMIZE_CLICKS",
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      networkSettings: campaign.networkSettings,
    });
    // Extract ID from resource name: "customers/123/campaigns/456" → "456"
    campaignId = campaignResourceName.split("/").pop();

    // Step 3: Create ad group (optional)
    const adGroup = body.adGroup as GAdsAdGroupInput | undefined;
    if (adGroup?.name) {
      try {
        const adGroupResourceName = await client.createAdGroup({
          name: adGroup.name,
          campaign: campaignResourceName,
          type: adGroup.type || "SEARCH_STANDARD",
          status: "PAUSED",
          cpcBidMicros: adGroup.cpcBidMicros,
        });
        adGroupId = adGroupResourceName.split("/").pop();

        // Step 4: Create ad (optional, requires ad group)
        const ad = body.ad as GAdsAdInput | undefined;
        if (ad?.headlines?.length && ad?.descriptions?.length && ad?.finalUrls?.length) {
          try {
            const adResourceName = await client.createResponsiveSearchAd({
              adGroup: adGroupResourceName,
              finalUrls: ad.finalUrls,
              headlines: ad.headlines,
              descriptions: ad.descriptions,
              status: "PAUSED",
            });
            adGroupAdId = adResourceName.split("/").pop();
          } catch (e: any) {
            partialErrors.push(`Ad creation failed: ${e.message}`);
          }
        }
      } catch (e: any) {
        partialErrors.push(`Ad group creation failed: ${e.message}`);
      }
    }
  } catch (e: any) {
    return res.status(502).json({
      success: false,
      error: e.message || "Google Ads API error",
    } as CreateCampaignResponse);
  }

  const response: CreateCampaignResponse = {
    success: true,
    campaignId,
    adGroupId,
    adGroupAdId,
    partialErrors: partialErrors.length > 0 ? partialErrors : undefined,
  };
  return res.status(200).json(response);
}
