/**
 * Spotify Ads API client — Spotify Ads API v3 (REST).
 *
 * Auth: Spotify OAuth refresh-token grant + Bearer token.
 * Base: https://api-partner.spotify.com/ads/v3
 *
 * Rate limits (per 30 s window):
 *   - 1500 requests per client+user
 *   - 150 requests for reporting endpoints
 */

import { getSpotifyAccessToken } from "./spotify-token-cache";

const ADS_BASE = "https://api-partner.spotify.com/ads/v3";

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface SpotifyAdsCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  adAccountId: string;
}

export interface SpotifyAdAccount {
  id: string;
  name: string;
}

export interface SpotifyCampaign {
  id: string;
  name: string;
  status: string;
  objective?: string;
  startDate?: string;
  endDate?: string;
  impressions?: number;
  clicks?: number;
  spend?: number;
  reach?: number;
  frequency?: number;
  completionRate?: number;
  ctr?: number;
  listeners?: number;
  streams?: number;
  newListeners?: number;
}

export interface SpotifyAdSet {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  impressions?: number;
  clicks?: number;
  spend?: number;
  reach?: number;
  completionRate?: number;
}

export interface SpotifyAd {
  id: string;
  adSetId?: string;
  name: string;
  status: string;
  format?: string;
  impressions?: number;
  clicks?: number;
  spend?: number;
  completionRate?: number;
  videoViews?: number;
}

export interface SpotifyReportRow {
  entityType: string;
  entityId: string;
  entityName: string;
  entityStatus: string;
  startTime?: string;
  endTime?: string;
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  frequency: number;
  completionRate: number;
  ctr: number;
  listeners: number;
  streams: number;
  newListeners: number;
  completes: number;
  videoViews: number;
}

export class SpotifyAdsApiClient {
  private creds: SpotifyAdsCredentials;

  constructor(creds: SpotifyAdsCredentials) {
    this.creds = creds;
  }

  private async getToken(): Promise<string> {
    return getSpotifyAccessToken(
      this.creds.clientId,
      this.creds.clientSecret,
      this.creds.refreshToken,
    );
  }

  private async request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.getToken();
    const url = `${ADS_BASE}${path}`;
    const res = await fetchWithTimeout(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Spotify Ads API error (${res.status}): ${errBody}`);
    }
    return res.json() as Promise<T>;
  }

  // ─── Ad Accounts ──────────────────────────────────────────────────────

  async listAdAccounts(): Promise<SpotifyAdAccount[]> {
    const data = await this.request<{
      ad_accounts?: Array<{ ad_account_id?: string; id?: string; name?: string; ad_account_name?: string }>;
      data?: Array<{ ad_account_id?: string; id?: string; name?: string; ad_account_name?: string }>;
    }>("/ad_accounts/business_member");
    const accounts = data.ad_accounts || data.data || [];
    return accounts.map((a) => ({
      id: a.ad_account_id || a.id || "",
      name: a.name || a.ad_account_name || a.ad_account_id || a.id || "",
    }));
  }

  // ─── Campaigns ────────────────────────────────────────────────────────

  async listCampaigns(): Promise<SpotifyCampaign[]> {
    const data = await this.request<{
      campaigns?: Array<{
        campaign_id?: string; id?: string;
        name?: string; campaign_name?: string;
        status?: string; objective?: string;
        start_date?: string; end_date?: string;
      }>;
      data?: Array<{
        campaign_id?: string; id?: string;
        name?: string; campaign_name?: string;
        status?: string; objective?: string;
        start_date?: string; end_date?: string;
      }>;
    }>(`/ad_accounts/${this.creds.adAccountId}/campaigns`);
    const campaigns = data.campaigns || data.data || [];
    return campaigns.map((c) => ({
      id: c.campaign_id || c.id || "",
      name: c.name || c.campaign_name || "",
      status: c.status || "UNKNOWN",
      objective: c.objective,
      startDate: c.start_date,
      endDate: c.end_date,
    }));
  }

  // ─── Ad Sets ──────────────────────────────────────────────────────────

  async listAdSets(): Promise<SpotifyAdSet[]> {
    const data = await this.request<{
      ad_sets?: Array<{
        ad_set_id?: string; id?: string;
        name?: string; ad_set_name?: string;
        campaign_id?: string;
        status?: string;
      }>;
      data?: Array<{
        ad_set_id?: string; id?: string;
        name?: string; ad_set_name?: string;
        campaign_id?: string;
        status?: string;
      }>;
    }>(`/ad_accounts/${this.creds.adAccountId}/ad_sets`);
    const adSets = data.ad_sets || data.data || [];
    return adSets.map((a) => ({
      id: a.ad_set_id || a.id || "",
      campaignId: a.campaign_id || "",
      name: a.name || a.ad_set_name || "",
      status: a.status || "UNKNOWN",
    }));
  }

  // ─── Ads ──────────────────────────────────────────────────────────────

  async listAds(): Promise<SpotifyAd[]> {
    const data = await this.request<{
      ads?: Array<{
        ad_id?: string; id?: string;
        name?: string; ad_name?: string;
        ad_set_id?: string;
        status?: string; format?: string;
      }>;
      data?: Array<{
        ad_id?: string; id?: string;
        name?: string; ad_name?: string;
        ad_set_id?: string;
        status?: string; format?: string;
      }>;
    }>(`/ad_accounts/${this.creds.adAccountId}/ads`);
    const ads = data.ads || data.data || [];
    return ads.map((a) => ({
      id: a.ad_id || a.id || "",
      adSetId: a.ad_set_id,
      name: a.name || a.ad_name || "",
      status: a.status || "UNKNOWN",
      format: a.format,
    }));
  }

  // ─── Aggregate Reporting ──────────────────────────────────────────────

  async getAggregateReport(
    entityType: "AD" | "AD_SET" | "CAMPAIGN" | "AD_ACCOUNT",
    startDate: string,
    endDate: string,
    granularity: "LIFETIME" | "DAY" | "HOUR" = "LIFETIME",
    entityIds?: string[],
  ): Promise<SpotifyReportRow[]> {
    const params = new URLSearchParams();
    params.set("entity_type", entityType);
    params.set("granularity", granularity);
    params.set("report_start", `${startDate}T00:00:00Z`);
    params.set("report_end", `${endDate}T23:59:59Z`);

    const fields = [
      "IMPRESSIONS", "CLICKS", "SPEND", "REACH", "FREQUENCY",
      "COMPLETION_RATE", "CTR", "LISTENERS", "STREAMS",
      "NEW_LISTENERS", "COMPLETES", "VIDEO_VIEWS",
      "STREAMED_IMPRESSIONS",
    ];
    for (const f of fields) params.append("fields", f);

    if (entityIds && entityIds.length > 0) {
      params.set("entity_ids_type", entityType);
      for (const id of entityIds) params.append("entity_ids", id);
    }

    const allRows: SpotifyReportRow[] = [];
    let continuationToken: string | undefined;

    do {
      if (continuationToken) {
        params.set("continuation_token", continuationToken);
      }

      const data = await this.request<{
        rows?: Array<{
          entity_type: string;
          entity_id: string;
          entity_name: string;
          entity_status: string;
          start_time?: string;
          end_time?: string;
          stats?: Array<{ field_type: string; field_value: string | number }>;
        }>;
        continuation_token?: string;
      }>(`/ad_accounts/${this.creds.adAccountId}/aggregate_reports?${params.toString()}`);

      for (const row of data.rows || []) {
        const statsMap: Record<string, number> = {};
        for (const s of row.stats || []) {
          statsMap[s.field_type] = Number(s.field_value) || 0;
        }

        allRows.push({
          entityType: row.entity_type,
          entityId: row.entity_id,
          entityName: row.entity_name,
          entityStatus: row.entity_status,
          startTime: row.start_time,
          endTime: row.end_time,
          impressions: statsMap["IMPRESSIONS"] || 0,
          clicks: statsMap["CLICKS"] || 0,
          spend: statsMap["SPEND"] || 0,
          reach: statsMap["REACH"] || 0,
          frequency: statsMap["FREQUENCY"] || 0,
          completionRate: statsMap["COMPLETION_RATE"] || 0,
          ctr: statsMap["CTR"] || 0,
          listeners: statsMap["LISTENERS"] || 0,
          streams: statsMap["STREAMS"] || 0,
          newListeners: statsMap["NEW_LISTENERS"] || 0,
          completes: statsMap["COMPLETES"] || 0,
          videoViews: statsMap["VIDEO_VIEWS"] || 0,
        });
      }

      continuationToken = data.continuation_token;
    } while (continuationToken);

    return allRows;
  }

  // ─── Aggregated Totals (account-level summary) ────────────────────────

  async getAccountTotals(
    startDate: string,
    endDate: string,
  ): Promise<SpotifyReportRow | null> {
    const rows = await this.getAggregateReport("AD_ACCOUNT", startDate, endDate);
    return rows[0] || null;
  }

  // ─── Campaign Report with metrics ─────────────────────────────────────

  async getCampaignReport(
    startDate: string,
    endDate: string,
  ): Promise<SpotifyReportRow[]> {
    return this.getAggregateReport("CAMPAIGN", startDate, endDate);
  }

  // ─── Daily breakdown ──────────────────────────────────────────────────

  async getDailyReport(
    startDate: string,
    endDate: string,
    entityType: "AD" | "AD_SET" | "CAMPAIGN" | "AD_ACCOUNT" = "AD_ACCOUNT",
  ): Promise<SpotifyReportRow[]> {
    return this.getAggregateReport(entityType, startDate, endDate, "DAY");
  }
}
