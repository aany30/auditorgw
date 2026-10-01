import type { NextApiRequest, NextApiResponse } from "next";
import { resolveMetaCreds } from "@/lib/default-credentials";
import { executeMetaAction } from "@/lib/apply/execute-meta";
import type { ApplyAction, ApplyResult } from "@/lib/apply/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = (req.body ?? {}) as { action?: ApplyAction; accessToken?: string; businessId?: string };
  const action = body.action;
  if (!action || action.platform !== "meta") {
    return res.status(400).json({ error: "Missing or invalid 'action' (expected platform=meta)." });
  }

  const creds = resolveMetaCreds(body as unknown as Record<string, unknown>);
  if (!creds) {
    const result: ApplyResult = {
      success: false,
      action,
      appliedAt: new Date().toISOString(),
      error: "Meta credentials not provided (accessToken + businessId required).",
    };
    return res.status(400).json(result);
  }

  const result = await executeMetaAction(action, creds.accessToken);
  return res.status(result.success ? 200 : 502).json(result);
}
