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

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

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

  async getOrganization(): Promise<unknown> {
    return this.request("/v1/me/organizations");
  }

  async listAdAccounts(orgId: string): Promise<unknown> {
    return this.request(`/v1/organizations/${orgId}/adaccounts`);
  }

  async getAdAccountInfo(): Promise<unknown> {
    return this.request(`/v1/adaccounts/${this.creds.adAccountId}`);
  }

  async listCampaigns(): Promise<unknown> {
    return this.request(`/v1/adaccounts/${this.creds.adAccountId}/campaigns`);
  }

  async listAdSquads(campaignId: string): Promise<unknown> {
    return this.request(`/v1/campaigns/${campaignId}/adsquads`);
  }

  async listAds(adSquadId: string): Promise<unknown> {
    return this.request(`/v1/adsquads/${adSquadId}/ads`);
  }

  async getCampaignStats(
    campaignId: string,
    startDate: string,
    endDate: string,
  ): Promise<unknown> {
    const params = new URLSearchParams({
      granularity: "TOTAL",
      start_time: startDate,
      end_time: endDate,
      fields: "impressions,swipes,spend,video_views",
    });
    return this.request(`/v1/campaigns/${campaignId}/stats?${params}`);
  }

  async getAdAccountStats(startDate: string, endDate: string): Promise<unknown> {
    const params = new URLSearchParams({
      granularity: "TOTAL",
      start_time: startDate,
      end_time: endDate,
      fields: "impressions,swipes,spend,video_views",
    });
    return this.request(
      `/v1/adaccounts/${this.creds.adAccountId}/stats?${params}`,
    );
  }

  // ─── Write ───────────────────────────────────────────────────────────────

  async createCampaign(data: Record<string, unknown>): Promise<unknown> {
    return this.request(
      `/v1/adaccounts/${this.creds.adAccountId}/campaigns`,
      "POST",
      { campaigns: [data] },
    );
  }

  async createAdSquad(
    campaignId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/v1/campaigns/${campaignId}/adsquads`, "POST", {
      adsquads: [data],
    });
  }

  async createAd(
    adSquadId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/v1/adsquads/${adSquadId}/ads`, "POST", {
      ads: [data],
    });
  }

  async updateCampaign(
    campaignId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/v1/campaigns/${campaignId}`, "PUT", {
      campaigns: [{ id: campaignId, ...data }],
    });
  }

  async updateAdSquad(
    adSquadId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/v1/adsquads/${adSquadId}`, "PUT", {
      adsquads: [{ id: adSquadId, ...data }],
    });
  }

  async updateAd(
    adId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/v1/ads/${adId}`, "PUT", {
      ads: [{ id: adId, ...data }],
    });
  }
}
