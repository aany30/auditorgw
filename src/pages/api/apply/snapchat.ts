import type { NextApiRequest, NextApiResponse } from "next";
import { resolveSnapchatCreds } from "@/lib/default-credentials";
import { executeSnapchatAction } from "@/lib/apply/execute-snapchat";
import type { ApplyAction, ApplyResult } from "@/lib/apply/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = (req.body ?? {}) as { action?: ApplyAction } & Record<string, unknown>;
  const action = body.action;
  if (!action || action.platform !== "snapchat") {
    return res.status(400).json({ error: "Missing or invalid 'action' (expected platform=snapchat)." });
  }

  const creds = resolveSnapchatCreds(body);
  if (!creds) {
    const result: ApplyResult = {
      success: false,
      action,
      appliedAt: new Date().toISOString(),
      error: "Snapchat credentials not provided (clientId, clientSecret, refreshToken, adAccountId required).",
    };
    return res.status(400).json(result);
  }

  const result = await executeSnapchatAction(action, {
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refreshToken: creds.refreshToken,
    adAccountId: creds.adAccountId,
  });
  return res.status(result.success ? 200 : 502).json(result);
}
