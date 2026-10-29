/**
 * Executes an ApplyAction against the Google Ads API v26.
 *
 * All writes use the mutate pattern via GoogleAdsApiClient.
 * Returns an ApplyResult — never throws.
 */
import type { ApplyAction, ApplyResult } from "./types";
import { GoogleAdsApiClient, type GoogleAdsCredentials } from "@/lib/api-clients/google-ads";

function missingScopeMessage(): string {
  return "Missing Google Ads write access. Ensure your developer token is approved and the account has Standard access.";
}

export async function executeGoogleAdsAction(
  action: ApplyAction,
  creds: GoogleAdsCredentials,
): Promise<ApplyResult> {
  const appliedAt = new Date().toISOString();

  if (action.platform !== "google_ads") {
    return {
      success: false,
      action,
      appliedAt,
      error: `executeGoogleAdsAction called with non-google_ads platform: ${action.platform}`,
    };
  }

  if (!creds.refreshToken || !creds.customerId || !creds.developerToken) {
    return {
      success: false,
      action,
      appliedAt,
      error: "Missing Google Ads credentials (refresh token, customer ID, or developer token).",
    };
  }

  try {
    const client = new GoogleAdsApiClient(creds);
    const custId = creds.customerId.replace(/-/g, "");

    if (action.kind === "set_budget") {
      // Google Ads budgets live on CampaignBudget resources, not directly on
      // campaigns or ad groups. For campaign-level budget changes, we need to
      // find the campaign's budget resource name first, then update it.
      if (action.entityType === "campaign") {
        // Fetch the campaign's budget resource name
        const rows = await client.search<{
          campaign: { campaignBudget: string };
        }>(`
          SELECT campaign.campaign_budget
          FROM campaign
          WHERE campaign.id = ${action.entityId}
          LIMIT 1
        `);
        const budgetResource = rows[0]?.campaign?.campaignBudget;
        if (!budgetResource) {
          return {
            success: false,
            action,
            appliedAt,
            error: "Could not find campaign budget resource to update.",
          };
        }
        // Minor units (cents/paise) → micros: cents × 10_000 = micros
        const micros = String(action.to * 10_000);
        await client.updateEntity("campaignBudgets", budgetResource, {
          amountMicros: micros,
        });
        return { success: true, action, appliedAt };
      }

      // Ad group level — update cpcBidMicros
      if (action.entityType === "adset") {
        const resourceName = `customers/${custId}/adGroups/${action.entityId}`;
        const micros = String(action.to * 10_000);
        await client.updateEntity("adGroups", resourceName, {
          cpcBidMicros: micros,
        });
        return { success: true, action, appliedAt };
      }

      return {
        success: false,
        action,
        appliedAt,
        error: `Budget changes for Google Ads ${action.entityType} are not supported yet.`,
      };
    }

    if (action.kind === "set_status") {
      const status = action.to === "ACTIVE" ? "ENABLED" : "PAUSED";

      if (action.entityType === "campaign") {
        const resourceName = `customers/${custId}/campaigns/${action.entityId}`;
        await client.updateEntity("campaigns", resourceName, { status });
        return { success: true, action, appliedAt };
      }

      if (action.entityType === "adset") {
        // Google Ads "ad set" = ad group
        const resourceName = `customers/${custId}/adGroups/${action.entityId}`;
        await client.updateEntity("adGroups", resourceName, { status });
        return { success: true, action, appliedAt };
      }

      if (action.entityType === "ad") {
        const resourceName = `customers/${custId}/adGroupAds/${action.entityId}`;
        await client.updateEntity("adGroupAds", resourceName, { status });
        return { success: true, action, appliedAt };
      }

      return {
        success: false,
        action,
        appliedAt,
        error: `Status changes for Google Ads ${action.entityType} are not supported yet.`,
      };
    }

    if (action.kind === "set_frequency_cap") {
      // Google Ads frequency caps are set at the campaign level via
      // frequencyCaps field.
      if (action.entityType === "campaign") {
        const resourceName = `customers/${custId}/campaigns/${action.entityId}`;
        await client.updateEntity("campaigns", resourceName, {
          frequencyCaps: [{
            key: {
              level: "AD_GROUP_AD",
              eventType: "IMPRESSION",
              timeLength: action.to.days,
              timeUnit: "DAY",
            },
            cap: action.to.impressions,
          }],
        });
        return { success: true, action, appliedAt };
      }
      return {
        success: false,
        action,
        appliedAt,
        error: "Frequency caps for Google Ads are only supported at the campaign level.",
      };
    }

    if (action.kind === "set_device_targeting") {
      return {
        success: false,
        action,
        appliedAt,
        error: "Device targeting changes for Google Ads must be made via bid adjustments in Google Ads UI.",
      };
    }

    return {
      success: false,
      action,
      appliedAt,
      error: `Unsupported Google Ads action kind: ${(action as ApplyAction).kind}`,
    };
  } catch (e: any) {
    const msg = e?.message || "Network error calling Google Ads API.";
    if (msg.includes("401") || msg.includes("403") || msg.includes("PERMISSION_DENIED")) {
      return { success: false, action, appliedAt, error: missingScopeMessage() };
    }
    return { success: false, action, appliedAt, error: msg };
  }
}
