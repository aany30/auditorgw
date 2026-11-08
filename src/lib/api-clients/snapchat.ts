/** Snapchat Marketing API client — OAuth 2.0, base https://adsapi.snapchat.com/v1/ */

const SNAP_BASE = "https://adsapi.snapchat.com/v1";
const TOKEN_URL = "https://accounts.snapchat.com/login/oauth2/access_token";

export interface SnapchatCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  adAccountId: string;
  orgId?: string;
}

export interface SnapchatCampaignRow {
  id: string;
  name: string;
  status: string;
  objective: string;
  dailyBudgetMicro?: number;
  lifetimeSpendCapMicro?: number;
}

export interface SnapchatAdSquadRow {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  type: string;
  dailyBudgetMicro?: number;
}

export interface SnapchatAdRow {
  id: string;
  adSquadId: string;
  name: string;
  status: string;
  type: string;
}

export interface SnapchatStatsRow {
  id: string;
  spend: number;
  impressions: number;
  swipes: number;
  videoViews: number;
  conversions: number;
}

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

/** Snapchat stats endpoint expects RFC3339 datetime strings with timezone. */
function toRFC3339(date: string, endOfDay = false): string {
  // YYYY-MM-DD → YYYY-MM-DDT00:00:00-00:00 (or 23:59:59 for end)
  const time = endOfDay ? "T23:59:59-00:00" : "T00:00:00-00:00";
  return `${date}${time}`;
}

export class SnapchatApiClient {
  private creds: SnapchatCredentials;

  constructor(creds: SnapchatCredentials) {
    this.creds = creds;
  }

  async getAccessToken(): Promise<string> {
    const cached = tokenCache.get(this.creds.refreshToken);
    if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.creds.refreshToken,
        client_id: this.creds.clientId,
        client_secret: this.creds.clientSecret,
      }).toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Snapchat token refresh failed (${res.status}): ${err}`);
    }

    const data = await res.json();
    const accessToken = data.access_token as string;
    const expiresIn = (data.expires_in as number) || 3600;
    tokenCache.set(this.creds.refreshToken, {
      accessToken,
      expiresAt: Date.now() + (expiresIn - 100) * 1000,
    });
    return accessToken;
  }

  async request<T = unknown>(
    path: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    body?: unknown,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = path.startsWith("http") ? path : `${SNAP_BASE}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };
    if (body) init.body = JSON.stringify(body);

    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Snapchat API ${method} ${path} failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
  }

  // ─── Read ────────────────────────────────────────────────────────────────

  async getOrganizations(): Promise<unknown> {
    return this.request("/me/organizations");
  }

  async listAdAccounts(orgId: string): Promise<unknown> {
    return this.request(`/organizations/${orgId}/adaccounts`);
  }

  async getAdAccountInfo(): Promise<{ adaccounts?: Array<{ adaccount?: Record<string, unknown> }> }> {
    return this.request(`/adaccounts/${this.creds.adAccountId}`);
  }

  async listCampaignsRaw(): Promise<{ campaigns?: Array<{ campaign?: Record<string, unknown> }> }> {
    return this.request(`/adaccounts/${this.creds.adAccountId}/campaigns`);
  }

  async listAdSquadsRaw(): Promise<{ adsquads?: Array<{ adsquad?: Record<string, unknown> }> }> {
    return this.request(`/adaccounts/${this.creds.adAccountId}/adsquads`);
  }

  async listAdsRaw(): Promise<{ ads?: Array<{ ad?: Record<string, unknown> }> }> {
    return this.request(`/adaccounts/${this.creds.adAccountId}/ads`);
  }

  async listCampaigns(): Promise<SnapchatCampaignRow[]> {
    const raw = await this.listCampaignsRaw();
    const list = raw.campaigns || [];
    return list.map((entry) => {
      const c = (entry.campaign || entry) as Record<string, unknown>;
      return {
        id: String(c.id || ""),
        name: String(c.name || "Untitled Campaign"),
        status: String(c.status || "UNKNOWN"),
        objective: String(c.objective || "AWARENESS"),
        dailyBudgetMicro: typeof c.daily_budget_micro === "number" ? c.daily_budget_micro : undefined,
        lifetimeSpendCapMicro: typeof c.lifetime_spend_cap_micro === "number" ? c.lifetime_spend_cap_micro : undefined,
      };
    });
  }

  async listAdSquads(): Promise<SnapchatAdSquadRow[]> {
    const raw = await this.listAdSquadsRaw();
    const list = raw.adsquads || [];
    return list.map((entry) => {
      const s = (entry.adsquad || entry) as Record<string, unknown>;
      return {
        id: String(s.id || ""),
        campaignId: String(s.campaign_id || ""),
        name: String(s.name || "Untitled Ad Squad"),
        status: String(s.status || "UNKNOWN"),
        type: String(s.type || ""),
        dailyBudgetMicro: typeof s.daily_budget_micro === "number" ? s.daily_budget_micro : undefined,
      };
    });
  }

  async listAds(): Promise<SnapchatAdRow[]> {
    const raw = await this.listAdsRaw();
    const list = raw.ads || [];
    return list.map((entry) => {
      const a = (entry.ad || entry) as Record<string, unknown>;
      return {
        id: String(a.id || ""),
        adSquadId: String(a.ad_squad_id || ""),
        name: String(a.name || "Untitled Ad"),
        status: String(a.status || "UNKNOWN"),
        type: String(a.type || ""),
      };
    });
  }

  /**
   * Account stats broken down by campaign for a given window.
   * Returns {campaignId → stats} map, with spend converted from micros → currency units.
   */
  async getCampaignBreakdownStats(startDate: string, endDate: string): Promise<Map<string, SnapchatStatsRow>> {
    const params = new URLSearchParams({
      granularity: "TOTAL",
      start_time: toRFC3339(startDate),
      end_time: toRFC3339(endDate, true),
      breakdown: "campaign",
      fields: "spend,impressions,swipes,video_views,conversion_purchases",
    });
    try {
      const data = await this.request<Record<string, unknown>>(
        `/adaccounts/${this.creds.adAccountId}/stats?${params}`,
      );
      const result = new Map<string, SnapchatStatsRow>();
      const totalStats = (data.total_stats || []) as Array<Record<string, unknown>>;
      for (const row of totalStats) {
        const totalStat = (row.total_stat || row) as Record<string, unknown>;
        const breakdownStats = (totalStat.breakdown_stats || {}) as Record<string, unknown>;
        const campaignRows = (breakdownStats.campaign || []) as Array<Record<string, unknown>>;
        for (const camp of campaignRows) {
          const cid = String(camp.id || "");
          if (!cid) continue;
          const stats = (camp.stats || {}) as Record<string, unknown>;
          const spendMicro = Number(stats.spend || 0);
          result.set(cid, {
            id: cid,
            spend: spendMicro / 1_000_000,
            impressions: Number(stats.impressions || 0),
            swipes: Number(stats.swipes || 0),
            videoViews: Number(stats.video_views || 0),
            conversions: Number(stats.conversion_purchases || 0),
          });
        }
      }
      return result;
    } catch (err) {
      console.error("[Snapchat] getCampaignBreakdownStats failed:", err instanceof Error ? err.message : err);
      return new Map();
    }
  }

  /** Fetch stats for a single campaign (fallback when breakdown fails). */
  async getCampaignStats(campaignId: string, startDate: string, endDate: string): Promise<SnapchatStatsRow | null> {
    const params = new URLSearchParams({
      granularity: "TOTAL",
      start_time: toRFC3339(startDate),
      end_time: toRFC3339(endDate, true),
      fields: "spend,impressions,swipes,video_views,conversion_purchases",
    });
    try {
      const data = await this.request<{ total_stats?: unknown[] }>(
        `/campaigns/${campaignId}/stats?${params}`,
      );
      const rows = (data.total_stats || []) as Array<Record<string, unknown>>;
      if (rows.length === 0) return null;
      const first = (rows[0].total_stat || rows[0]) as Record<string, unknown>;
      const stats = (first.stats || {}) as Record<string, unknown>;
      const spendMicro = Number(stats.spend || 0);
      return {
        id: campaignId,
        spend: spendMicro / 1_000_000,
        impressions: Number(stats.impressions || 0),
        swipes: Number(stats.swipes || 0),
        videoViews: Number(stats.video_views || 0),
        conversions: Number(stats.conversion_purchases || 0),
      };
    } catch (err) {
      console.error(`[Snapchat] getCampaignStats(${campaignId}) failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  // ─── Write ───────────────────────────────────────────────────────────────

  async createCampaign(data: Record<string, unknown>): Promise<unknown> {
    return this.request(
      `/adaccounts/${this.creds.adAccountId}/campaigns`,
      "POST",
      { campaigns: [data] },
    );
  }

  async createAdSquad(
    campaignId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/campaigns/${campaignId}/adsquads`, "POST", {
      adsquads: [data],
    });
  }

  async createAd(
    adSquadId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/adsquads/${adSquadId}/ads`, "POST", {
      ads: [data],
    });
  }

  async updateCampaign(
    campaignId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/campaigns/${campaignId}`, "PUT", {
      campaigns: [{ id: campaignId, ...data }],
    });
  }

  async updateAdSquad(
    adSquadId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/adsquads/${adSquadId}`, "PUT", {
      adsquads: [{ id: adSquadId, ...data }],
    });
  }

  async updateAd(
    adId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/ads/${adId}`, "PUT", {
      ads: [{ id: adId, ...data }],
    });
  }
}

/** Map Snapchat objective enum → user-facing label. */
export function snapchatObjectiveLabel(obj: string): string {
  const map: Record<string, string> = {
    AWARENESS: "Awareness",
    APP_INSTALL: "App Install",
    APP_CONVERSION: "App Conversion",
    PROMOTE_PLACES: "Promote Places",
    CATALOG_SALES: "Catalog Sales",
    WEB_CONVERSION: "Web Conversion",
    WEBSITE_TRAFFIC: "Website Traffic",
    LEAD_GENERATION: "Lead Generation",
    ENGAGEMENT: "Engagement",
    VIDEO_VIEW: "Video Views",
    STORY_VIEW: "Story Views",
  };
  return map[obj] || obj.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Snapchat ad account currency. */
export async function getSnapchatAccountCurrency(client: SnapchatApiClient): Promise<string> {
  try {
    const info = await client.getAdAccountInfo();
    const first = (info.adaccounts || [])[0];
    const aa = (first?.adaccount || first || {}) as Record<string, unknown>;
    return (aa.currency as string) || "USD";
  } catch {
    return "USD";
  }
}
