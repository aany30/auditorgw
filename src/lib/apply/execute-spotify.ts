/**
 * Executes an ApplyAction against the Spotify Ads API v3.
 *
 * Shapes verified against the official OpenAPI spec:
 *   - Campaign pause/resume: PATCH /ad_accounts/{aid}/campaigns/{id}
 *       body { status: "PAUSED" | "ACTIVE" }
 *   - Ad-set budget:         PATCH /ad_accounts/{aid}/ad_sets/{id}
 *       body { budget: { micro_amount, type: "DAILY" | "LIFETIME" } }  (micros)
 *   - Ad-set pause/resume:   PATCH /ad_accounts/{aid}/ad_sets/{id}
 *       body { delivery: "OFF" | "ON" }   (must be the ONLY field)
 *
 * Writes share the same OAuth as reads. A reporting-only partner entitlement
 * surfaces as a 401/403 — reported clearly rather than failing silently.
 */
import type { ApplyAction, ApplyResult } from "./types";
import { getSpotifyAccessToken } from "@/lib/api-clients/spotify-token-cache";

const ADS_BASE = "https://api-partner.spotify.com/ads/v3";

interface SpotifyCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  adAccountId: string;
}

async function patchSpotify(
  path: string,
  body: Record<string, unknown>,
  accessToken: string,
): Promise<{ ok: boolean; status: number; body: unknown; errorMessage?: string }> {
  const r = await fetch(`${ADS_BASE}${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let respBody: unknown = null;
  try { respBody = await r.json(); } catch { respBody = null; }

  if (!r.ok) {
    const err = respBody as { error?: { message?: string }; message?: string };
    let message = err?.error?.message || err?.message || `Spotify API error (HTTP ${r.status})`;
    if (r.status === 401 || r.status === 403) {
      message = "Your Spotify access is reporting-only — writes aren't permitted for this account. Request write/management access from Spotify, or make this change in Spotify Ad Studio.";
    }
    return { ok: false, status: r.status, body: respBody, errorMessage: message };
  }
  return { ok: true, status: r.status, body: respBody };
}

export async function executeSpotifyAction(
  action: ApplyAction,
  creds: SpotifyCredentials,
): Promise<ApplyResult> {
  const appliedAt = new Date().toISOString();

  if (action.platform !== "spotify") {
    return { success: false, action, appliedAt, error: `executeSpotifyAction called with non-spotify platform: ${action.platform}` };
  }
  if (!creds.refreshToken || !creds.adAccountId) {
    return { success: false, action, appliedAt, error: "Missing Spotify credentials (refresh token or ad account id)." };
  }

  const aid = encodeURIComponent(creds.adAccountId);
  const entityId = encodeURIComponent(action.entityId);

  try {
    const accessToken = await getSpotifyAccessToken(creds.clientId, creds.clientSecret, creds.refreshToken);

    if (action.kind === "set_status") {
      // Campaigns use `status`; ad sets use `delivery` (which must be sent alone).
      if (action.entityType === "campaign") {
        const resp = await patchSpotify(`/ad_accounts/${aid}/campaigns/${entityId}`, { status: action.to }, accessToken);
        return resp.ok
          ? { success: true, action, appliedAt, rawResponse: resp.body }
          : { success: false, action, appliedAt, error: resp.errorMessage!, rawResponse: resp.body };
      }
      if (action.entityType === "ad_set") {
        const delivery = action.to === "PAUSED" ? "OFF" : "ON";
        const resp = await patchSpotify(`/ad_accounts/${aid}/ad_sets/${entityId}`, { delivery }, accessToken);
        return resp.ok
          ? { success: true, action, appliedAt, rawResponse: resp.body }
          : { success: false, action, appliedAt, error: resp.errorMessage!, rawResponse: resp.body };
      }
      return { success: false, action, appliedAt, error: `Status changes not supported for Spotify entity type: ${action.entityType}` };
    }

    if (action.kind === "set_budget") {
      // Spotify budget lives on the ad set, not the campaign.
      if (action.entityType !== "ad_set") {
        return { success: false, action, appliedAt, error: "Spotify budget is set at the ad-set level — target an ad set, not a campaign." };
      }
      // ApplyAction amounts are minor units (paise/cents); Spotify wants micros.
      // minor × 10,000 = micros (e.g. 25000 paise = ₹250 = 250,000,000 micros).
      const microAmount = Math.round(action.to * 10_000);
      const type = action.budgetType === "lifetime" ? "LIFETIME" : "DAILY";
      const resp = await patchSpotify(
        `/ad_accounts/${aid}/ad_sets/${entityId}`,
        { budget: { micro_amount: microAmount, type } },
        accessToken,
      );
      return resp.ok
        ? { success: true, action, appliedAt, rawResponse: resp.body }
        : { success: false, action, appliedAt, error: resp.errorMessage!, rawResponse: resp.body };
    }

    if (action.kind === "set_frequency_cap") {
      return { success: false, action, appliedAt, error: "Frequency cap changes for Spotify must be made in Spotify Ad Studio." };
    }
    if (action.kind === "set_device_targeting") {
      return { success: false, action, appliedAt, error: "Device targeting for Spotify must be set in Spotify Ad Studio." };
    }

    return { success: false, action, appliedAt, error: `Unsupported Spotify action kind: ${(action as ApplyAction).kind}` };
  } catch (e: unknown) {
    return { success: false, action, appliedAt, error: e instanceof Error ? e.message : "Network error calling Spotify API." };
  }
}
