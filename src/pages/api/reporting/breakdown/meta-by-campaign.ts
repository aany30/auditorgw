/**
 * POST /api/reporting/breakdown/meta-by-campaign
 *
 * Returns Meta campaign-level insights grouped by a breakdown dimension
 * (currently publisher_platform). Used by the Planning tab's Channel drill
 * so each publisher shows only the campaigns that actually delivered on it,
 * instead of every campaign in the account.
 *
 * Body: { accessToken, businessId, breakdown, startDate, endDate }
 *   - breakdown: one of "publisher_platform" | "platform_position" |
 *                        "device_platform" | "impression_device"
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";
import { metaSafeCall, metaCache, cacheKey } from "@/lib/meta-request-utils";

interface Row {
  campaignId: string;
  breakdownValue: string;
  spend: number;
  impressions: number;
  clicks: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const { accessToken, businessId, breakdown, startDate, endDate } = req.body || {};
  if (!accessToken || !businessId || !breakdown) {
    res.status(400).json({ error: "Missing accessToken, businessId, or breakdown" });
    return;
  }

  const ALLOWED = new Set(["publisher_platform", "platform_position", "device_platform", "impression_device"]);
  if (!ALLOWED.has(breakdown)) {
    res.status(400).json({ error: `Unsupported breakdown "${breakdown}"` });
    return;
  }

  if (isDemoCredential(accessToken)) {
    // Demo: fabricate a plausible mapping — 3 sample campaigns × 3 publishers.
    const rows: Row[] = [
      { campaignId: "demo-c-1", breakdownValue: "facebook",   spend: 32000, impressions: 800000, clicks: 12000 },
      { campaignId: "demo-c-1", breakdownValue: "instagram",  spend: 18000, impressions: 480000, clicks: 7200 },
      { campaignId: "demo-c-2", breakdownValue: "facebook",   spend: 25000, impressions: 600000, clicks: 9500 },
      { campaignId: "demo-c-2", breakdownValue: "audience_network", spend: 6000, impressions: 180000, clicks: 3200 },
      { campaignId: "demo-c-3", breakdownValue: "instagram",  spend: 15000, impressions: 420000, clicks: 6300 },
      { campaignId: "demo-c-3", breakdownValue: "messenger",  spend: 3200,  impressions: 88000,  clicks: 1400 },
    ];
    res.status(200).json({ source: "demo", rows });
    return;
  }

  const accountPath = businessId.startsWith("act_") ? businessId : `act_${businessId}`;

  // Cache — this endpoint took 27s on Flipkart-scale accounts; reloads hurt.
  const ck = cacheKey(accountPath, `by-campaign:${breakdown}`, { startDate, endDate });
  const cached = metaCache.get<Row[]>(ck);
  if (cached) {
    res.status(200).json({ source: "cache", rows: cached });
    return;
  }

  try {
    const client = new MetaApiClient(accessToken);

    // Graph API accepts breakdowns on level=campaign; each returned row carries
    // campaign_id + the breakdown value.
    const params: Record<string, string> = {
      level: "campaign",
      fields: "campaign_id,spend,impressions,clicks",
      breakdowns: breakdown,
      limit: "500",
    };
    if (startDate && endDate) params.time_range = `{"since":"${startDate}","until":"${endDate}"}`;
    else params.date_preset = "last_30d";

    const rows = await metaSafeCall<Row[]>(async () => {
      const out: Row[] = [];
      const firstPage = await (client as unknown as {
        fetch: <T>(path: string, params?: Record<string, string>) => Promise<T>;
      }).fetch<{ data?: unknown[]; paging?: { next?: string } }>(`/${accountPath}/insights`, params);
      const collect = (data?: unknown[]) => {
        for (const raw of data ?? []) {
          const r = raw as Record<string, unknown>;
          out.push({
            campaignId: String(r.campaign_id ?? ""),
            breakdownValue: String(r[breakdown] ?? ""),
            spend: r.spend ? parseFloat(String(r.spend)) : 0,
            impressions: r.impressions ? parseInt(String(r.impressions), 10) : 0,
            clicks: r.clicks ? parseInt(String(r.clicks), 10) : 0,
          });
        }
      };
      collect(firstPage.data);
      let nextUrl = firstPage.paging?.next;
      let pageBudget = 20;
      while (nextUrl && pageBudget-- > 0) {
        const page = await (client as unknown as {
          fetchAbsolute: <T>(url: string) => Promise<T>;
        }).fetchAbsolute<{ data?: unknown[]; paging?: { next?: string } }>(nextUrl);
        collect(page.data);
        nextUrl = page.paging?.next;
      }
      return out;
    }, {
      onRetry: (attempt, err) => console.warn(`[Meta by-campaign "${breakdown}"] retry #${attempt}: ${err.message}`),
    });

    metaCache.set(ck, rows);
    res.status(200).json({ source: "live", rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Meta campaign breakdown fetch failed";
    console.error(`[Meta by-campaign breakdown "${breakdown}"] failed:`, message);
    res.status(500).json({ error: message });
  }
}
