/**
 * Check whether the stored credentials carry the write scope required
 * to apply changes on the given platform.
 *
 * - Meta: GET /me/permissions and look for `ads_management` granted.
 * - DV360: no cheap scope-check endpoint; return "unknown" and let the
 *   first Apply call surface the real error.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { resolveMetaCreds, resolveDV360Creds } from "@/lib/default-credentials";

interface ScopeStatus {
  status: "granted" | "missing" | "unknown";
  scopeRequired?: string;
  howToFix?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ScopeStatus | { error: string }>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const platform = (req.query.platform as string) || "";

  if (platform === "meta") {
    // Credentials come from query (?accessToken=…&businessId=…) or env defaults.
    const q = req.query as Record<string, unknown>;
    const creds = resolveMetaCreds({
      accessToken: q.accessToken,
      businessId: q.businessId,
    });
    if (!creds) {
      return res.status(200).json({
        status: "unknown",
        scopeRequired: "ads_management",
        howToFix: "No Meta credentials on file — connect Meta first.",
      });
    }

    try {
      const r = await fetch(
        `https://graph.facebook.com/v21.0/me/permissions?access_token=${encodeURIComponent(creds.accessToken)}`
      );
      const body: { data?: Array<{ permission: string; status: string }> } = await r.json();
      if (!r.ok || !Array.isArray(body.data)) {
        return res.status(200).json({
          status: "unknown",
          scopeRequired: "ads_management",
          howToFix: "Could not read Meta permissions. Try reconnecting your Meta account.",
        });
      }
      const granted = body.data.some(
        (p) => p.permission === "ads_management" && p.status === "granted"
      );
      return res.status(200).json(
        granted
          ? { status: "granted", scopeRequired: "ads_management" }
          : {
              status: "missing",
              scopeRequired: "ads_management",
              howToFix: "Reconnect your Meta account and grant the ads_management permission.",
            }
      );
    } catch {
      return res.status(200).json({
        status: "unknown",
        scopeRequired: "ads_management",
        howToFix: "Network error checking Meta permissions.",
      });
    }
  }

  if (platform === "dv360") {
    const q = req.query as Record<string, unknown>;
    const creds = resolveDV360Creds(q);
    if (!creds) {
      return res.status(200).json({
        status: "unknown",
        scopeRequired: "https://www.googleapis.com/auth/display-video",
        howToFix: "No DV360 credentials on file — connect DV360 first.",
      });
    }
    // DV360 has no cheap scope-check endpoint; the OAuth flow is what grants
    // the write scope. First Apply call will surface the real error.
    return res.status(200).json({
      status: "unknown",
      scopeRequired: "https://www.googleapis.com/auth/display-video",
      howToFix: "If applies fail with 403, reconnect DV360 and include the display-video (write) scope.",
    });
  }

  return res.status(400).json({ error: "Unknown platform. Use ?platform=meta or ?platform=dv360." });
}
