import type { NextApiRequest, NextApiResponse } from "next";
import { resolveSpotifyCreds } from "@/lib/default-credentials";
import { executeSpotifyAction } from "@/lib/apply/execute-spotify";
import type { ApplyAction, ApplyResult } from "@/lib/apply/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = (req.body ?? {}) as { action?: ApplyAction } & Record<string, unknown>;
  const action = body.action;
  if (!action || action.platform !== "spotify") {
    return res.status(400).json({ error: "Missing or invalid 'action' (expected platform=spotify)." });
  }

  const creds = resolveSpotifyCreds(body);
  if (!creds) {
    const result: ApplyResult = {
      success: false,
      action,
      appliedAt: new Date().toISOString(),
      error: "Spotify credentials not provided (clientId, clientSecret, refreshToken, adAccountId required).",
    };
    return res.status(400).json(result);
  }

  const result = await executeSpotifyAction(action, creds);
  return res.status(result.success ? 200 : 502).json(result);
}
