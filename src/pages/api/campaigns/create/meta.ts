import type { NextApiRequest, NextApiResponse } from "next";
import { resolveMetaCreds } from "@/lib/default-credentials";
import type {
  MetaCampaignInput,
  MetaAdSetInput,
  MetaAdInput,
  CreateCampaignResponse,
} from "@/types/create-campaign";

const META_BASE = "https://graph.facebook.com/v21.0";

async function postMeta(
  path: string,
  accessToken: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }> {
  const url = `${META_BASE}/${path}`;
  const params = new URLSearchParams();
  params.append("access_token", accessToken);
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "object") {
      params.append(key, JSON.stringify(value));
    } else {
      params.append(key, String(value));
    }
  }
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const err = data as { error?: { message?: string; code?: number; error_user_msg?: string } };
    let msg = err?.error?.error_user_msg || err?.error?.message || `Meta API error (HTTP ${r.status})`;
    if (r.status === 403 || err?.error?.code === 200 || err?.error?.code === 10) {
      msg = "Missing ads_management scope. Reconnect your Meta account with write access.";
    }
    return { ok: false, data, error: msg };
  }
  return { ok: true, data };
}

function normalizeBusinessId(id: string): string {
  return /^\d+$/.test(id) ? `act_${id}` : id;
}

function cleanSpecialAdCategories(cats: string[] | undefined): string[] {
  if (!cats) return [];
  return cats.filter((c) => c !== "NONE");
}

// Returns Unix epoch seconds, at least 1 hour in the future.
function futureStartUnix(iso: string): number {
  const t = new Date(iso).getTime();
  const minStart = Date.now() + 3600_000;
  return Math.floor((t < minStart ? minStart : t) / 1000);
}

// Given a start (epoch seconds) and optional end ISO, return an end (epoch
// seconds) that is always at least 25 hours after start. Defaults to +30 days.
function scheduledEndUnix(startUnix: number, endIso?: string): number {
  const min = startUnix + 25 * 3600;
  if (endIso) {
    const e = Math.floor(new Date(endIso).getTime() / 1000);
    if (e >= min) return e;
  }
  return startUnix + 30 * 24 * 3600;
}

function billingEventForGoal(goal: string): string {
  if (goal === "THRUPLAY") return "THRUPLAY";
  return "IMPRESSIONS";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body ?? {};
  const creds = resolveMetaCreds(body as Record<string, unknown>);
  if (!creds) {
    return res.status(400).json({ success: false, error: "Meta credentials required (accessToken + businessId)." } as CreateCampaignResponse);
  }

  const campaign = body.campaign as MetaCampaignInput | undefined;
  if (!campaign?.name || !campaign?.objective) {
    return res.status(400).json({ success: false, error: "Campaign name and objective are required." } as CreateCampaignResponse);
  }

  const actId = normalizeBusinessId(creds.businessId);
  const partialErrors: string[] = [];
  let campaignId: string | undefined;
  let adsetId: string | undefined;
  let adId: string | undefined;

  // Step 1: Create campaign
  const campPayload: Record<string, unknown> = {
    name: campaign.name,
    objective: campaign.objective,
    special_ad_categories: cleanSpecialAdCategories(campaign.special_ad_categories),
    buying_type: campaign.buying_type || "AUCTION",
    status: "PAUSED",
  };
  if (campaign.daily_budget) {
    campPayload.daily_budget = String(campaign.daily_budget);
  } else {
    campPayload.is_adset_budget_sharing_enabled = "false";
  }
  if (campaign.lifetime_budget) campPayload.lifetime_budget = String(campaign.lifetime_budget);

  const campResult = await postMeta(`${actId}/campaigns`, creds.accessToken, campPayload);
  if (!campResult.ok) {
    return res.status(502).json({ success: false, error: campResult.error } as CreateCampaignResponse);
  }
  campaignId = String(campResult.data.id);

  // Step 2: Create ad set (optional)
  const adset = body.adset as MetaAdSetInput | undefined;
  if (adset?.name) {
    const adsetPayload: Record<string, unknown> = {
      campaign_id: campaignId,
      name: adset.name,
      optimization_goal: adset.optimization_goal,
      billing_event: billingEventForGoal(adset.optimization_goal),
      status: "PAUSED",
      targeting: adset.targeting,
    };
    const startUnix = futureStartUnix(adset.start_time);
    adsetPayload.start_time = startUnix;
    if (adset.daily_budget) {
      adsetPayload.daily_budget = String(adset.daily_budget);
      // Daily-budget ad sets must run ≥24h; guarantee a valid window.
      adsetPayload.end_time = scheduledEndUnix(startUnix, adset.end_time);
    } else if (adset.lifetime_budget) {
      adsetPayload.lifetime_budget = String(adset.lifetime_budget);
      adsetPayload.end_time = scheduledEndUnix(startUnix, adset.end_time);
    } else if (adset.end_time) {
      adsetPayload.end_time = Math.floor(new Date(adset.end_time).getTime() / 1000);
    }
    if (adset.bid_strategy) adsetPayload.bid_strategy = adset.bid_strategy;
    if (adset.promoted_object) adsetPayload.promoted_object = adset.promoted_object;

    const adsetResult = await postMeta(`${actId}/adsets`, creds.accessToken, adsetPayload);
    if (!adsetResult.ok) {
      partialErrors.push(`Ad set creation failed: ${adsetResult.error}`);
    } else {
      adsetId = String(adsetResult.data.id);
    }
  }

  // Step 3: Create ad + creative (optional)
  const ad = body.ad as MetaAdInput | undefined;
  if (ad?.name && ad?.creative && adsetId) {
    // 3a: Create ad creative
    const creativePayload: Record<string, unknown> = {
      name: ad.creative.name,
      object_story_spec: ad.creative.object_story_spec,
    };
    const creativeResult = await postMeta(`${actId}/adcreatives`, creds.accessToken, creativePayload);
    if (!creativeResult.ok) {
      partialErrors.push(`Ad creative creation failed: ${creativeResult.error}`);
    } else {
      // 3b: Create ad
      const creativeId = String(creativeResult.data.id);
      const adPayload: Record<string, unknown> = {
        name: ad.name,
        adset_id: adsetId,
        creative: { creative_id: creativeId },
        status: "PAUSED",
      };
      const adResult = await postMeta(`${actId}/ads`, creds.accessToken, adPayload);
      if (!adResult.ok) {
        partialErrors.push(`Ad creation failed: ${adResult.error}`);
      } else {
        adId = String(adResult.data.id);
      }
    }
  } else if (ad?.name && !adsetId) {
    partialErrors.push("Ad creation skipped: ad set was not created.");
  }

  const response: CreateCampaignResponse = {
    success: true,
    campaignId,
    adsetId,
    adId,
    partialErrors: partialErrors.length > 0 ? partialErrors : undefined,
  };
  return res.status(200).json(response);
}
