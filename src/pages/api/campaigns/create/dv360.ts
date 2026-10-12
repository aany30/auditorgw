import type { NextApiRequest, NextApiResponse } from "next";
import { resolveDV360Creds } from "@/lib/default-credentials";
import { DV360ApiClient } from "@/lib/api-clients/dv360";
import type {
  DV360CampaignInput,
  DV360InsertionOrderInput,
  DV360LineItemInput,
  CreateCampaignResponse,
} from "@/types/create-campaign";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body ?? {};
  const creds = resolveDV360Creds(body as Record<string, unknown>);
  if (!creds) {
    return res.status(400).json({ success: false, error: "DV360 credentials required." } as CreateCampaignResponse);
  }

  const campaign = body.campaign as DV360CampaignInput | undefined;
  if (!campaign?.displayName) {
    return res.status(400).json({ success: false, error: "Campaign displayName is required." } as CreateCampaignResponse);
  }

  const client = new DV360ApiClient({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refreshToken: creds.refreshToken,
    advertiserId: creds.advertiserId,
  });

  const partialErrors: string[] = [];
  let campaignId: string | undefined;
  let insertionOrderId: string | undefined;
  let lineItemId: string | undefined;

  try {
    // Step 1: Create campaign
    const campResult = await client.createCampaign(campaign as unknown as Record<string, unknown>);
    campaignId = String(campResult.campaignId || campResult.name?.toString().split("/").pop());
    if (!campaignId) {
      return res.status(502).json({ success: false, error: "DV360 campaign creation returned no ID." } as CreateCampaignResponse);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "DV360 campaign creation failed.";
    return res.status(502).json({ success: false, error: msg } as CreateCampaignResponse);
  }

  // Step 2: Create insertion order (optional)
  const io = body.insertionOrder as DV360InsertionOrderInput | undefined;
  if (io?.displayName) {
    try {
      const ioData = { ...io, campaignId } as unknown as Record<string, unknown>;
      const ioResult = await client.createInsertionOrder(ioData);
      insertionOrderId = String(ioResult.insertionOrderId || ioResult.name?.toString().split("/").pop());
    } catch (e: unknown) {
      partialErrors.push(`IO creation failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }

  // Step 3: Create line item (optional)
  const li = body.lineItem as DV360LineItemInput | undefined;
  if (li?.displayName && insertionOrderId) {
    try {
      const liData = { ...li, campaignId, insertionOrderId } as unknown as Record<string, unknown>;
      const liResult = await client.createLineItem(liData);
      lineItemId = String(liResult.lineItemId || liResult.name?.toString().split("/").pop());
    } catch (e: unknown) {
      partialErrors.push(`Line item creation failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  } else if (li?.displayName && !insertionOrderId) {
    partialErrors.push("Line item creation skipped: insertion order was not created.");
  }

  const response: CreateCampaignResponse = {
    success: true,
    campaignId,
    insertionOrderId,
    lineItemId,
    partialErrors: partialErrors.length > 0 ? partialErrors : undefined,
  };
  return res.status(200).json(response);
}
