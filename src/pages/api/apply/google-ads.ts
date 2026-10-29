import type { NextApiRequest, NextApiResponse } from "next";
import { resolveGoogleAdsCreds } from "@/lib/default-credentials";
import { executeGoogleAdsAction } from "@/lib/apply/execute-google-ads";
import type { ApplyAction, ApplyResult } from "@/lib/apply/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = (req.body ?? {}) as { action?: ApplyAction } & Record<string, unknown>;
  const action = body.action;
  if (!action || action.platform !== "google_ads") {
    return res.status(400).json({ error: "Missing or invalid 'action' (expected platform=google_ads)." });
  }

  const creds = resolveGoogleAdsCreds(body);
  if (!creds) {
    const result: ApplyResult = {
      success: false,
      action,
      appliedAt: new Date().toISOString(),
      error: "Google Ads credentials not provided (clientId, clientSecret, refreshToken, customerId, developerToken required).",
    };
    return res.status(400).json(result);
  }

  const result = await executeGoogleAdsAction(action, creds);
  return res.status(result.success ? 200 : 502).json(result);
}
