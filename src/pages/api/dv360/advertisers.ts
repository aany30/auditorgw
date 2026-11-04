import type { NextApiRequest, NextApiResponse } from "next";
import { getGoogleAccessToken } from "@/lib/api-clients/google-token-cache";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { clientId, clientSecret, refreshToken } = req.body as {
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
  };

  const cid = clientId || process.env.DEFAULT_DV360_CLIENT_ID || "";
  const csec = clientSecret || process.env.DEFAULT_DV360_CLIENT_SECRET || "";
  const rtok = refreshToken || process.env.DEFAULT_DV360_REFRESH_TOKEN || "";

  if (!cid || !csec || !rtok) {
    return res.status(400).json({ error: "Missing Google OAuth credentials" });
  }

  try {
    const accessToken = await getGoogleAccessToken(cid, csec, rtok);

    // Step 1: discover ALL partners the user has access to
    const pRes = await fetch(
      "https://displayvideo.googleapis.com/v4/partners?" +
        new URLSearchParams({ pageSize: "50" }).toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!pRes.ok) {
      const err = await pRes.json().catch(() => ({}));
      return res.status(pRes.status).json({ error: err?.error?.message || "DV360 partners API error" });
    }

    const pData = await pRes.json();
    const partners: { partnerId: string; displayName?: string }[] = pData.partners || [];

    if (partners.length === 0) {
      return res.status(200).json({ advertisers: [], partnerIds: [] });
    }

    // Step 2: fetch advertisers from EVERY partner in parallel
    const allAdvertisers: { id: string; name: string; status?: string; partnerId: string }[] = [];

    const fetches = partners.map(async (partner) => {
      try {
        const advRes = await fetch(
          "https://displayvideo.googleapis.com/v4/advertisers?" +
            new URLSearchParams({ partnerId: partner.partnerId, pageSize: "100" }).toString(),
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!advRes.ok) return;
        const advData = await advRes.json();
        for (const a of advData.advertisers || []) {
          allAdvertisers.push({
            id: a.advertiserId,
            name: a.displayName || a.advertiserId,
            status: a.entityStatus,
            partnerId: partner.partnerId,
          });
        }
      } catch {
        // skip this partner silently
      }
    });

    await Promise.all(fetches);

    return res.status(200).json({
      advertisers: allAdvertisers,
      partners: partners.map((p) => ({
        id: p.partnerId,
        name: p.displayName || p.partnerId,
      })),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ error: msg });
  }
}
