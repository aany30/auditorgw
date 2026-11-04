import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { accessToken } = req.body as { accessToken?: string };
  if (!accessToken) return res.status(400).json({ error: "accessToken required" });

  try {
    const url = `https://graph.facebook.com/v21.0/me/adaccounts?fields=account_id,name,account_status&limit=100&access_token=${encodeURIComponent(accessToken)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({ error: err?.error?.message || "Meta API error" });
    }
    const data = await resp.json();
    const accounts = (data.data || []).map((a: { account_id: string; name: string; account_status: number }) => ({
      id: `act_${a.account_id}`,
      name: a.name || `Account ${a.account_id}`,
      status: a.account_status,
    }));
    return res.status(200).json({ accounts });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ error: msg });
  }
}
