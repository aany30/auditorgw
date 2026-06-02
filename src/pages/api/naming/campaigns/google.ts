import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleApiClient } from "@/lib/api-clients/google";
import { isDemoCredential, getDemoGoogleCampaigns } from "@/lib/demo-data";
import type { CampaignData } from "@/types";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CampaignData[] | { error: string }>
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { accessToken, customerId, developerToken, loginCustomerId, startDate, endDate } = req.body;

  if (!accessToken || !customerId || !developerToken) {
    res.status(400).json({ error: "Missing required credentials" });
    return;
  }

  // Demo token → return demo campaigns directly
  if (isDemoCredential(accessToken)) {
    res.status(200).json(getDemoGoogleCampaigns());
    return;
  }

  try {
    const client = new GoogleApiClient(accessToken, {
      developerToken,
      loginCustomerId: loginCustomerId || customerId,
    });
    const campaigns = await client.listCampaigns(customerId, startDate, endDate);
    if (!campaigns || campaigns.length === 0) {
      res.status(200).json(getDemoGoogleCampaigns());
      return;
    }
    res.status(200).json(campaigns);
  } catch (error) {
    console.error("Failed to fetch Google campaigns, returning demo:", error);
    res.status(200).json(getDemoGoogleCampaigns());
  }
}
