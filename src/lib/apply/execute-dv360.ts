/**
 * Executes an ApplyAction against the DV360 (Display & Video 360) API v3.
 *
 * Uses the OAuth refresh-token exchange from DV360ApiClient (via its
 * getAccessToken() method) so we share the module-level token cache and
 * timeout behavior.
 */
import type { ApplyAction, ApplyResult } from "./types";
import { DV360ApiClient } from "@/lib/api-clients/dv360";

const DV360_BASE = "https://displayvideo.googleapis.com/v3";

interface DV360Credentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  advertiserId: string;
}

function missingScopeMessage(): string {
  return "Missing display-video write scope. Reconnect your DV360 account with write access.";
}

async function patchDv360(
  path: string,
  updateMask: string,
  body: Record<string, unknown>,
  accessToken: string
): Promise<{ ok: boolean; status: number; body: unknown; errorMessage?: string }> {
  const url = `${DV360_BASE}${path}?updateMask=${encodeURIComponent(updateMask)}`;
  const r = await fetch(url, {
    method: "PATCH",
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
    const err = respBody as { error?: { message?: string; status?: string } };
    let message = err?.error?.message || `DV360 API error (HTTP ${r.status})`;
    if (r.status === 401 || r.status === 403) {
      message = missingScopeMessage();
    }
    return { ok: false, status: r.status, body: respBody, errorMessage: message };
  }
  return { ok: true, status: r.status, body: respBody };
}

export async function executeDv360Action(
  action: ApplyAction,
  creds: DV360Credentials
): Promise<ApplyResult> {
  const appliedAt = new Date().toISOString();

  if (action.platform !== "dv360") {
    return {
      success: false,
      action,
      appliedAt,
      error: `executeDv360Action called with non-dv360 platform: ${action.platform}`,
    };
  }

  if (!creds.refreshToken || !creds.advertiserId) {
    return {
      success: false,
      action,
      appliedAt,
      error: "Missing DV360 credentials (refresh token or advertiser id).",
    };
  }

  // Device targeting isn't easily API-applyable in the simple shape the UI
  // uses — DV360 models targeting via assignedTargetingOptions calls per
  // option, not a single device_platforms array.
  if (action.kind === "set_device_targeting") {
    return {
      success: false,
      action,
      appliedAt,
      error: "Device targeting changes for DV360 must be made in the DV360 UI.",
    };
  }

  try {
    const client = new DV360ApiClient({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      refreshToken: creds.refreshToken,
      advertiserId: creds.advertiserId,
    });
    const accessToken = await client.getAccessToken();

    const advertiserId = encodeURIComponent(creds.advertiserId);
    const entityId = encodeURIComponent(action.entityId);

    if (action.kind === "set_budget") {
      if (action.entityType === "insertion_order") {
        // IO budgets are segment-based (time-bounded). For simplicity we
        // fetch the IO, replace the ACTIVE segment's budgetAmountMicros
        // (first segment covering today, else the first segment), then PATCH
        // the full budgetSegments array.
        const getUrl = `${DV360_BASE}/advertisers/${advertiserId}/insertionOrders/${entityId}`;
        const getR = await fetch(getUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!getR.ok) {
          const errBody = await getR.text();
          return {
            success: false,
            action,
            appliedAt,
            error:
              getR.status === 401 || getR.status === 403
                ? missingScopeMessage()
                : `DV360 fetch IO failed (HTTP ${getR.status}): ${errBody.slice(0, 300)}`,
          };
        }
        const io: {
          budget?: { budgetSegments?: Array<{ budgetAmountMicros?: string; dateRange?: { startDate?: any; endDate?: any } }> };
        } = await getR.json();

        const segments = io.budget?.budgetSegments ?? [];
        if (segments.length === 0) {
          return {
            success: false,
            action,
            appliedAt,
            error: "Insertion order has no budget segments to update.",
          };
        }
        // Minor-units → micros: 1 minor-unit cent = 10_000 micros (micros = currency * 1_000_000)
        const micros = String(action.to * 10_000);
        const now = new Date();
        const todayNum = (d: { year?: number; month?: number; day?: number } | undefined) =>
          d?.year && d?.month && d?.day ? new Date(d.year, d.month - 1, d.day).getTime() : null;
        let activeIdx = segments.findIndex((s) => {
          const start = todayNum(s.dateRange?.startDate);
          const end = todayNum(s.dateRange?.endDate);
          return start !== null && end !== null && start <= now.getTime() && now.getTime() <= end;
        });
        if (activeIdx < 0) activeIdx = 0;
        const updatedSegments = segments.map((s, i) =>
          i === activeIdx ? { ...s, budgetAmountMicros: micros } : s
        );

        const resp = await patchDv360(
          `/advertisers/${advertiserId}/insertionOrders/${entityId}`,
          "budget.budgetSegments",
          { budget: { budgetSegments: updatedSegments } },
          accessToken
        );
        return resp.ok
          ? { success: true, action, appliedAt, rawResponse: resp.body }
          : { success: false, action, appliedAt, error: resp.errorMessage!, rawResponse: resp.body };
      }

      // Line item budget — single budgetAmountMicros field.
      // Minor units → micros: cents * 10_000 = micros.
      const micros = String(action.to * 10_000);
      const resp = await patchDv360(
        `/advertisers/${advertiserId}/lineItems/${entityId}`,
        "budget.budgetAmountMicros",
        { budget: { budgetAmountMicros: micros } },
        accessToken
      );
      return resp.ok
        ? { success: true, action, appliedAt, rawResponse: resp.body }
        : { success: false, action, appliedAt, error: resp.errorMessage!, rawResponse: resp.body };
    }

    if (action.kind === "set_status") {
      // Only line items have a simple entityStatus flip in this UI's model.
      const entityStatus =
        action.to === "ACTIVE" ? "ENTITY_STATUS_ACTIVE" : "ENTITY_STATUS_PAUSED";
      const collection = action.entityType === "insertion_order" ? "insertionOrders" : "lineItems";
      const resp = await patchDv360(
        `/advertisers/${advertiserId}/${collection}/${entityId}`,
        "entityStatus",
        { entityStatus },
        accessToken
      );
      return resp.ok
        ? { success: true, action, appliedAt, rawResponse: resp.body }
        : { success: false, action, appliedAt, error: resp.errorMessage!, rawResponse: resp.body };
    }

    if (action.kind === "set_frequency_cap") {
      const resp = await patchDv360(
        `/advertisers/${advertiserId}/lineItems/${entityId}`,
        "frequencyCap",
        {
          frequencyCap: {
            maxImpressions: action.to.impressions,
            timeUnit: "TIME_UNIT_DAYS",
            timeUnitCount: action.to.days,
            unlimited: false,
          },
        },
        accessToken
      );
      return resp.ok
        ? { success: true, action, appliedAt, rawResponse: resp.body }
        : { success: false, action, appliedAt, error: resp.errorMessage!, rawResponse: resp.body };
    }

    return {
      success: false,
      action,
      appliedAt,
      error: `Unsupported DV360 action kind: ${(action as ApplyAction).kind}`,
    };
  } catch (e: any) {
    return {
      success: false,
      action,
      appliedAt,
      error: e?.message || "Network error calling DV360 API.",
    };
  }
}
