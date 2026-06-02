/**
 * Bundles the attribution-readiness checks that Meta DOES expose via Graph API:
 *   - Verified domains (per Business)
 *   - Default attribution spec on the ad account
 *
 * Conversions API status is already surfaced via the regular pixel audit
 * (see Pixel Health tab). All other attribution-checklist items (Consent Mode,
 * SKAdNetwork config, AEM priority events) are NOT exposed by Meta — the
 * Attribution tab links those out to the platform UI for manual verification.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";

interface ReqBody {
  accessToken: string;
  businessId?: string;
  pixelIds?: string[];
}

interface RespBody {
  verifiedDomains: Array<{ businessId: string; businessName: string; domains: string[] }>;
  attributionSpec: Array<{ event_type: string; window_days: number }> | null;
  aem: Record<string, Array<{ event_name: string; priority: number }>>;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RespBody | { error: string }>
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const { accessToken, businessId, pixelIds } = req.body as ReqBody;
  if (!accessToken) {
    res.status(400).json({ error: "Missing accessToken" });
    return;
  }

  if (isDemoCredential(accessToken)) {
    res.status(200).json({ verifiedDomains: [], attributionSpec: null, aem: {} });
    return;
  }

  try {
    const client = new MetaApiClient(accessToken);
    // Normalise the businessId/ad-account-id the same way listCampaigns does.
    const accountPath = businessId
      ? (businessId.startsWith("act_") ? businessId : /^\d+$/.test(businessId) ? `act_${businessId}` : businessId)
      : null;

    const ids = Array.isArray(pixelIds) ? pixelIds : [];
    const [verifiedDomains, attributionSpec, aemResults] = await Promise.all([
      client.getVerifiedDomains(),
      accountPath ? client.getAccountAttributionSpec(accountPath) : Promise.resolve(null),
      Promise.all(ids.map(async (id) => [id, await client.getAemConfig(id)] as const)),
    ]);

    const aem: RespBody["aem"] = {};
    for (const [id, cfg] of aemResults) aem[id] = cfg;

    res.status(200).json({ verifiedDomains, attributionSpec, aem });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Attribution checks fetch failed:", message);
    res.status(502).json({ error: message });
  }
}
