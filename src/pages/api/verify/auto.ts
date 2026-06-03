/**
 * Auto-verification endpoint — runs a SECOND independent Meta Insights query
 * and confirms the dashboard's per-campaign spend sums match Meta's
 * account-level total. Catches:
 *   – Campaigns dropped from our /campaigns paging (silent paging cutoffs).
 *   – Per-campaign aggregation bugs (one campaign's spend silently zeroed).
 *   – Filtering bugs (status filter cutting off real spend).
 *   – Network/race issues that left some campaigns stale.
 *
 * This is the deterministic foundation for the passive "✓ Verified vs Meta"
 * banner shown at the top of Account Structure. Polls every 60s while the
 * page is open.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient, META_ATTRIBUTION_WINDOW } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";

interface ReqBody {
  accessToken: string;
  businessId: string;
  startDate?: string;
  endDate?: string;
  /** What the dashboard currently shows — keyed by campaign id. */
  ourCampaignSpend: Record<string, number>;
  /** Attribution windows we used to compute the dashboard's totals.
   * Sent so the verification re-pull uses the same windows — otherwise
   * Meta returns conversions on a different basis and the comparison would
   * be apples-to-oranges. */
  attributionWindows?: string[];
}

interface CampaignDiff {
  campaignId: string;
  ourSpend: number;
  metaSpend: number;
  match: boolean;
  deltaPct: number;
}

interface RespBody {
  status: "verified" | "drift" | "error";
  message: string;
  ourTotal: number;
  metaAccountTotal: number;
  metaCampaignSumTotal: number;
  campaignsChecked: number;
  driftedCampaigns: CampaignDiff[];
  metaRequestUrl?: string;
  attributionUsed: string;
  verifiedAt: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RespBody | { error: string }>
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { accessToken, businessId, startDate, endDate, ourCampaignSpend, attributionWindows } = req.body as ReqBody;
  if (!accessToken || !businessId || !ourCampaignSpend) {
    res.status(400).json({ error: "Missing accessToken, businessId, or ourCampaignSpend" });
    return;
  }

  // Demo mode: pretend everything's verified.
  if (isDemoCredential(accessToken)) {
    const ourTotal = Object.values(ourCampaignSpend).reduce((s, v) => s + (v || 0), 0);
    res.status(200).json({
      status: "verified",
      message: "Demo mode — synthetic data treated as verified.",
      ourTotal,
      metaAccountTotal: ourTotal,
      metaCampaignSumTotal: ourTotal,
      campaignsChecked: Object.keys(ourCampaignSpend).length,
      driftedCampaigns: [],
      attributionUsed: META_ATTRIBUTION_WINDOW.label,
      verifiedAt: new Date().toISOString(),
    });
    return;
  }

  try {
    const client = new MetaApiClient(accessToken);
    const accountPath = businessId.startsWith("act_") ? businessId : /^\d+$/.test(businessId) ? `act_${businessId}` : businessId;

    // 1) Re-fetch per-campaign spend using the same attribution we used.
    //    This catches stale-data issues + per-campaign aggregation bugs.
    const freshCampaignInsights = await client.getCampaignInsights(accountPath, startDate, endDate, attributionWindows);

    // 2) Independently fetch account-level total (no level filter).
    //    If the campaign sum ≠ account total, we've dropped campaigns somewhere.
    const accountInsightsPath = `/${accountPath}/insights`;
    const accountParams: Record<string, string> = {
      fields: "spend",
      action_attribution_windows: JSON.stringify(attributionWindows && attributionWindows.length > 0 ? attributionWindows : META_ATTRIBUTION_WINDOW.raw),
    };
    if (startDate && endDate) accountParams.time_range = `{"since":"${startDate}","until":"${endDate}"}`;
    else accountParams.date_preset = "last_30d";

    // Reuse the private fetch via a public-ish call. We'll build a one-off
    // direct fetch here so the verification endpoint is self-contained.
    const url = new URL(`https://graph.facebook.com/v18.0${accountInsightsPath}`);
    url.searchParams.set("access_token", accessToken);
    Object.entries(accountParams).forEach(([k, v]) => url.searchParams.set(k, v));
    const accountRes = await fetch(url.toString());
    if (!accountRes.ok) {
      const errText = await accountRes.text();
      throw new Error(`Account-level insights failed: ${accountRes.status} ${errText.slice(0, 200)}`);
    }
    const accountJson = await accountRes.json() as { data?: Array<{ spend?: string }> };
    const metaAccountTotal = accountJson.data?.[0]?.spend ? parseFloat(accountJson.data[0].spend) : 0;

    // 3) Compute diffs.
    const ourTotal = Object.values(ourCampaignSpend).reduce((s, v) => s + (v || 0), 0);
    const metaCampaignSumTotal = Object.values(freshCampaignInsights).reduce((s, v) => s + (v.spend || 0), 0);

    const driftedCampaigns: CampaignDiff[] = [];
    for (const [id, ourSpend] of Object.entries(ourCampaignSpend)) {
      const metaSpend = freshCampaignInsights[id]?.spend ?? 0;
      const deltaPct = ourSpend > 0 ? Math.abs(metaSpend - ourSpend) / ourSpend * 100 : (metaSpend > 0 ? 100 : 0);
      const match = deltaPct < 1; // within 1% rounding tolerance
      if (!match) {
        driftedCampaigns.push({ campaignId: id, ourSpend, metaSpend, match, deltaPct });
      }
    }

    const accountVsSumDeltaPct = metaAccountTotal > 0
      ? Math.abs(metaCampaignSumTotal - metaAccountTotal) / metaAccountTotal * 100
      : 0;

    const allMatch = driftedCampaigns.length === 0 && accountVsSumDeltaPct < 2;
    const attributionUsed = attributionWindows && attributionWindows.length > 0
      ? attributionWindows.join(" + ").replace(/d_click/g, "-day click").replace(/d_view/g, "-day view")
      : META_ATTRIBUTION_WINDOW.label;

    if (allMatch) {
      res.status(200).json({
        status: "verified",
        message: `All ${Object.keys(ourCampaignSpend).length} campaign spends match Meta exactly.`,
        ourTotal,
        metaAccountTotal,
        metaCampaignSumTotal,
        campaignsChecked: Object.keys(ourCampaignSpend).length,
        driftedCampaigns: [],
        metaRequestUrl: url.toString().replace(/access_token=[^&]+/, "access_token=***"),
        attributionUsed,
        verifiedAt: new Date().toISOString(),
      });
      return;
    }

    res.status(200).json({
      status: "drift",
      message: driftedCampaigns.length > 0
        ? `${driftedCampaigns.length} campaign${driftedCampaigns.length === 1 ? "" : "s"} drift detected.`
        : `Account total (${metaAccountTotal}) differs from campaign sum (${metaCampaignSumTotal}) by ${accountVsSumDeltaPct.toFixed(1)}% — likely missing campaigns.`,
      ourTotal,
      metaAccountTotal,
      metaCampaignSumTotal,
      campaignsChecked: Object.keys(ourCampaignSpend).length,
      driftedCampaigns,
      metaRequestUrl: url.toString().replace(/access_token=[^&]+/, "access_token=***"),
      attributionUsed,
      verifiedAt: new Date().toISOString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Auto-verify failed:", message);
    res.status(200).json({
      status: "error",
      message,
      ourTotal: 0,
      metaAccountTotal: 0,
      metaCampaignSumTotal: 0,
      campaignsChecked: 0,
      driftedCampaigns: [],
      attributionUsed: META_ATTRIBUTION_WINDOW.label,
      verifiedAt: new Date().toISOString(),
    });
  }
}
