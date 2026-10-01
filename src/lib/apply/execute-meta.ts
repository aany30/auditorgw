/**
 * Executes an ApplyAction against the Meta Marketing API.
 *
 * All writes go through POST https://graph.facebook.com/v21.0/{entity-id}
 * with the access token as a `?access_token=` query param (consistent with
 * the rest of the project). Returns an ApplyResult — never throws.
 */
import type { ApplyAction, ApplyResult } from "./types";

const META_WRITE_BASE = "https://graph.facebook.com/v21.0";

interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
}

function missingScopeMessage(): string {
  return "Missing ads_management scope. Reconnect your Meta account with write access.";
}

async function postToMeta(
  entityId: string,
  accessToken: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; status: number; body: unknown; errorMessage?: string }> {
  const url = `${META_WRITE_BASE}/${encodeURIComponent(entityId)}?access_token=${encodeURIComponent(accessToken)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let body: unknown = null;
  try {
    body = await r.json();
  } catch {
    body = null;
  }

  if (!r.ok) {
    const errBody = body as MetaErrorBody;
    let message = errBody?.error?.message || `Meta API error (HTTP ${r.status})`;
    if (r.status === 403 || errBody?.error?.code === 200 || errBody?.error?.code === 10) {
      message = missingScopeMessage();
    }
    return { ok: false, status: r.status, body, errorMessage: message };
  }

  return { ok: true, status: r.status, body };
}

export async function executeMetaAction(
  action: ApplyAction,
  accessToken: string
): Promise<ApplyResult> {
  const appliedAt = new Date().toISOString();

  if (action.platform !== "meta") {
    return {
      success: false,
      action,
      appliedAt,
      error: `executeMetaAction called with non-meta platform: ${action.platform}`,
    };
  }

  if (!accessToken) {
    return {
      success: false,
      action,
      appliedAt,
      error: "Missing Meta access token.",
    };
  }

  try {
    let payload: Record<string, unknown>;

    switch (action.kind) {
      case "set_budget": {
        payload =
          action.budgetType === "daily"
            ? { daily_budget: action.to }
            : { lifetime_budget: action.to };
        break;
      }
      case "set_status": {
        payload = { status: action.to };
        break;
      }
      case "set_frequency_cap": {
        payload = {
          frequency_control_specs: [
            {
              event: "IMPRESSIONS",
              interval_days: action.to.days,
              max_frequency: action.to.impressions,
            },
          ],
        };
        break;
      }
      case "set_device_targeting": {
        // Meta requires the full `targeting` object; the caller passes the
        // final device_platforms array. We send only the delta — Meta merges
        // the existing targeting with device_platforms replaced.
        payload = {
          targeting: { device_platforms: action.to },
        };
        break;
      }
    }

    const resp = await postToMeta(action.entityId, accessToken, payload);
    if (!resp.ok) {
      return {
        success: false,
        action,
        appliedAt,
        error: resp.errorMessage || "Meta API request failed.",
        rawResponse: resp.body,
      };
    }

    return {
      success: true,
      action,
      appliedAt,
      rawResponse: resp.body,
    };
  } catch (e: any) {
    return {
      success: false,
      action,
      appliedAt,
      error: e?.message || "Network error calling Meta API.",
    };
  }
}
