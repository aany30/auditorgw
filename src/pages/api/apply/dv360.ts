import type { NextApiRequest, NextApiResponse } from "next";
import { resolveDV360Creds } from "@/lib/default-credentials";
import { executeDv360Action } from "@/lib/apply/execute-dv360";
import type { ApplyAction, ApplyResult } from "@/lib/apply/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = (req.body ?? {}) as { action?: ApplyAction } & Record<string, unknown>;
  const action = body.action;
  if (!action || action.platform !== "dv360") {
    return res.status(400).json({ error: "Missing or invalid 'action' (expected platform=dv360)." });
  }

  const creds = resolveDV360Creds(body);
  if (!creds) {
    const result: ApplyResult = {
      success: false,
      action,
      appliedAt: new Date().toISOString(),
      error: "DV360 credentials not provided (clientId, clientSecret, refreshToken, advertiserId required).",
    };
    return res.status(400).json(result);
  }

  const result = await executeDv360Action(action, {
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refreshToken: creds.refreshToken,
    advertiserId: creds.advertiserId,
  });
  return res.status(result.success ? 200 : 502).json(result);
}
