/**
 * Executes an ApplyAction against the Snapchat Marketing API v1.
 *
 * Uses the OAuth refresh-token exchange from SnapchatApiClient (via its
 * getAccessToken() method) so we share the module-level token cache.
 */
import type { ApplyAction, ApplyResult } from "./types";
import { SnapchatApiClient } from "@/lib/api-clients/snapchat";

const SNAP_BASE = "https://adsapi.snapchat.com/v1";

interface SnapchatCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  adAccountId: string;
}

function missingScopeMessage(): string {
  return "Missing Snapchat write access. Reconnect your Snapchat account.";
}

async function putSnapchat(
  path: string,
  body: Record<string, unknown>,
  accessToken: string,
): Promise<{ ok: boolean; status: number; body: unknown; errorMessage?: string }> {
  const url = `${SNAP_BASE}${path}`;
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let respBody: unknown = null;
  try {
    respBody = await r.json();
  } catch {
    respBody = null;
  }

  if (!r.ok) {
    const err = respBody as { request_status?: string; request_error_message?: string };
    let message = err?.request_error_message || `Snapchat API error (HTTP ${r.status})`;
    if (r.status === 401 || r.status === 403) {
      message = missingScopeMessage();
    }
    return { ok: false, status: r.status, body: respBody, errorMessage: message };
  }
  return { ok: true, status: r.status, body: respBody };
}

export async function executeSnapchatAction(
  action: ApplyAction,
  creds: SnapchatCredentials,
): Promise<ApplyResult> {
  const appliedAt = new Date().toISOString();

  if (action.platform !== "snapchat") {
    return {
      success: false,
      action,
      appliedAt,
      error: `executeSnapchatAction called with non-snapchat platform: ${action.platform}`,
    };
  }

  if (!creds.refreshToken || !creds.adAccountId) {
    return {
      success: false,
      action,
      appliedAt,
      error: "Missing Snapchat credentials (refresh token or ad account id).",
    };
  }

  if (action.kind === "set_device_targeting") {
    return {
      success: false,
      action,
      appliedAt,
      error: "Device targeting must be set through the Snapchat UI.",
    };
  }

  try {
    const client = new SnapchatApiClient({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      refreshToken: creds.refreshToken,
      adAccountId: creds.adAccountId,
    });
    const accessToken = await client.getAccessToken();
    const entityId = encodeURIComponent(action.entityId);

    if (action.kind === "set_budget") {
      // Minor units (cents) → micro: cents × 10_000 = micro-currency.
      const microAmount = String(action.to * 10_000);

      if (action.entityType === "campaign") {
        const resp = await putSnapchat(
          `/campaigns/${entityId}`,
          { campaigns: [{ id: action.entityId, daily_budget_micro: microAmount }] },
          accessToken,
        );
        return resp.ok
          ? { success: true, action, appliedAt, rawResponse: resp.body }
          : { success: false, action, appliedAt, error: resp.errorMessage!, rawResponse: resp.body };
      }

      if (action.entityType === "ad_squad") {
        const resp = await putSnapchat(
          `/adsquads/${entityId}`,
          { adsquads: [{ id: action.entityId, bid_micro: microAmount }] },
          accessToken,
        );
        return resp.ok
          ? { success: true, action, appliedAt, rawResponse: resp.body }
          : { success: false, action, appliedAt, error: resp.errorMessage!, rawResponse: resp.body };
      }

      return {
        success: false,
        action,
        appliedAt,
        error: `Budget changes not supported for Snapchat entity type: ${action.entityType}`,
      };
    }

    if (action.kind === "set_status") {
      const status = action.to; // ACTIVE or PAUSED — same values Snapchat uses
      let collection: string;
      let wrapper: string;

      if (action.entityType === "campaign") {
        collection = "campaigns";
        wrapper = "campaigns";
      } else if (action.entityType === "ad_squad") {
        collection = "adsquads";
        wrapper = "adsquads";
      } else if (action.entityType === "ad") {
        collection = "ads";
        wrapper = "ads";
      } else {
        return {
          success: false,
          action,
          appliedAt,
          error: `Status changes not supported for Snapchat entity type: ${action.entityType}`,
        };
      }

      const resp = await putSnapchat(
        `/${collection}/${entityId}`,
        { [wrapper]: [{ id: action.entityId, status }] },
        accessToken,
      );
      return resp.ok
        ? { success: true, action, appliedAt, rawResponse: resp.body }
        : { success: false, action, appliedAt, error: resp.errorMessage!, rawResponse: resp.body };
    }

    if (action.kind === "set_frequency_cap") {
      const resp = await putSnapchat(
        `/adsquads/${entityId}`,
        {
          adsquads: [{
            id: action.entityId,
            frequency_cap: {
              frequency_cap_type: 1,
              time_interval: action.to.days,
              frequency_cap_count: action.to.impressions,
            },
          }],
        },
        accessToken,
      );
      return resp.ok
        ? { success: true, action, appliedAt, rawResponse: resp.body }
        : { success: false, action, appliedAt, error: resp.errorMessage!, rawResponse: resp.body };
    }

    return {
      success: false,
      action,
      appliedAt,
      error: `Unsupported Snapchat action kind: ${(action as ApplyAction).kind}`,
    };
  } catch (e: any) {
    return {
      success: false,
      action,
      appliedAt,
      error: e?.message || "Network error calling Snapchat API.",
    };
  }
}
