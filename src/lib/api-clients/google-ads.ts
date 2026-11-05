/**
 * Google Ads API client — Google Ads API v26 (REST).
 *
 * Auth: Google OAuth refresh-token grant (same as DV360) plus a developer
 * token header on every request. The developer token belongs to the API
 * project (server env var), not to each end-user.
 *
 * All entity + metric queries go through GAQL searchStream.
 */

import { getGoogleAccessToken } from "./google-token-cache";

const GADS_BASE = "https://googleads.googleapis.com/v26";

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface GoogleAdsCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;
  developerToken: string;
  loginCustomerId?: string;
}

// ─── Entity shapes ──────────────────────────────────────────────────────────

export interface GAdsCampaign {
  id: string;
  name: string;
  status: string;
  advertisingChannelType: string;
  biddingStrategyType?: string;
  startDate?: string;
  endDate?: string;
  budgetAmountMicros?: string;
  impressions?: number;
  clicks?: number;
  costMicros?: number;
  conversions?: number;
  conversionsValue?: number;
  videoViews?: number;
  allConversions?: number;
}

export interface GAdsAdGroup {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  type?: string;
  impressions?: number;
  clicks?: number;
  costMicros?: number;
  conversions?: number;
}

export interface GAdsAd {
  id: string;
  adGroupId: string;
  name: string;
  status: string;
  type: string;
  headlines?: string[];
  descriptions?: string[];
  finalUrls?: string[];
  impressions?: number;
  clicks?: number;
  costMicros?: number;
  conversions?: number;
}

export interface GAdsKeyword {
  id: string;
  adGroupId: string;
  keyword: string;
  matchType: string;
  status: string;
  qualityScore?: number;
  impressions?: number;
  clicks?: number;
  costMicros?: number;
  conversions?: number;
}

export interface GAdsConversionAction {
  id: string;
  name: string;
  type: string;
  status: string;
  category?: string;
  countingType?: string;
  conversions?: number;
  allConversions?: number;
  conversionsValue?: number;
}

export interface GAdsCustomerInfo {
  id: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
  manager?: boolean;
}

export interface GAdsChildAccount {
  id: string;
  name: string;
  isManager: boolean;
  currencyCode: string;
  level: number;
}

export class GoogleAdsApiClient {
  constructor(private creds: GoogleAdsCredentials) {}

  private get custId() {
    return this.creds.customerId.replace(/-/g, "");
  }

  async getAccessToken(): Promise<string> {
    return getGoogleAccessToken(
      this.creds.clientId,
      this.creds.clientSecret,
      this.creds.refreshToken,
    );
  }

  private authHeaders(token: string): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "developer-token": this.creds.developerToken,
      "Content-Type": "application/json",
    };
    if (this.creds.loginCustomerId) {
      h["login-customer-id"] = this.creds.loginCustomerId.replace(/-/g, "");
    }
    return h;
  }

  async search<T = Record<string, unknown>>(query: string): Promise<T[]> {
    const token = await this.getAccessToken();
    const url = `${GADS_BASE}/customers/${this.custId}/googleAds:searchStream`;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: this.authHeaders(token),
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Google Ads API error (${res.status}): ${errBody}`);
    }
    const data: Array<{ results?: T[] }> = await res.json();
    return data.flatMap((batch) => batch.results || []);
  }

  // ─── Mutate (write) ─────────────────────────────────────────────────────

  /**
   * Execute a mutate operation against the Google Ads API.
   * All writes in Google Ads go through:
   *   POST /customers/{customerId}/{resource}:mutate
   * Each operation is a create / update / remove.
   */
  async mutate<T = Record<string, unknown>>(
    resource: string,
    operations: Array<Record<string, unknown>>,
  ): Promise<{ results: T[]; partialFailureError?: string }> {
    const token = await this.getAccessToken();
    const url = `${GADS_BASE}/customers/${this.custId}/${resource}:mutate`;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: this.authHeaders(token),
      body: JSON.stringify({ operations }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      // Extract a user-friendly message from Google Ads error JSON
      let msg = `Google Ads API error (${res.status})`;
      try {
        const parsed = JSON.parse(errBody);
        const details = parsed?.error?.details;
        if (Array.isArray(details)) {
          for (const d of details) {
            const errs = d.errors as Array<{ message?: string }> | undefined;
            if (errs?.[0]?.message) { msg = errs[0].message; break; }
          }
        }
        if (msg.includes("API error") && parsed?.error?.message) {
          msg = parsed.error.message;
        }
      } catch { /* use default */ }
      throw new Error(msg);
    }
    const data = await res.json();
    return {
      results: data.results || [],
      partialFailureError: data.partialFailureError?.message,
    };
  }

  /**
   * Create a campaign budget. Returns the resource name.
   */
  async createCampaignBudget(budget: {
    name: string;
    amountMicros: string;
    deliveryMethod?: string;
    explicitlyShared?: boolean;
  }): Promise<string> {
    const { results } = await this.mutate<{ resourceName: string }>(
      "campaignBudgets",
      [{
        create: {
          name: budget.name,
          amountMicros: budget.amountMicros,
          deliveryMethod: budget.deliveryMethod || "STANDARD",
          explicitlyShared: budget.explicitlyShared ?? false,
        },
      }],
    );
    return results[0].resourceName;
  }

  /**
   * Create a campaign. Returns the resource name.
   */
  async createCampaign(campaign: {
    name: string;
    advertisingChannelType: string;
    status?: string;
    campaignBudget: string; // resource name from createCampaignBudget
    biddingStrategyType?: string;
    startDate?: string; // YYYY-MM-DD
    endDate?: string;
    networkSettings?: Record<string, boolean>;
  }): Promise<string> {
    const { results } = await this.mutate<{ resourceName: string }>(
      "campaigns",
      [{
        create: {
          name: campaign.name,
          advertisingChannelType: campaign.advertisingChannelType,
          status: campaign.status || "PAUSED",
          campaignBudget: campaign.campaignBudget,
          biddingStrategyType: campaign.biddingStrategyType || "MAXIMIZE_CLICKS",
          ...(campaign.startDate ? { startDate: campaign.startDate } : {}),
          ...(campaign.endDate ? { endDate: campaign.endDate } : {}),
          networkSettings: campaign.networkSettings || {
            targetGoogleSearch: true,
            targetSearchNetwork: true,
            targetContentNetwork: false,
            targetPartnerSearchNetwork: false,
          },
        },
      }],
    );
    return results[0].resourceName;
  }

  /**
   * Create an ad group. Returns the resource name.
   */
  async createAdGroup(adGroup: {
    name: string;
    campaign: string; // resource name
    type?: string;
    status?: string;
    cpcBidMicros?: string;
  }): Promise<string> {
    const { results } = await this.mutate<{ resourceName: string }>(
      "adGroups",
      [{
        create: {
          name: adGroup.name,
          campaign: adGroup.campaign,
          type: adGroup.type || "SEARCH_STANDARD",
          status: adGroup.status || "PAUSED",
          ...(adGroup.cpcBidMicros ? { cpcBidMicros: adGroup.cpcBidMicros } : {}),
        },
      }],
    );
    return results[0].resourceName;
  }

  /**
   * Create a responsive search ad. Returns the resource name.
   */
  async createResponsiveSearchAd(ad: {
    adGroup: string; // resource name
    finalUrls: string[];
    headlines: string[];
    descriptions: string[];
    status?: string;
  }): Promise<string> {
    const { results } = await this.mutate<{ resourceName: string }>(
      "adGroupAds",
      [{
        create: {
          adGroup: ad.adGroup,
          status: ad.status || "PAUSED",
          ad: {
            responsiveSearchAd: {
              headlines: ad.headlines.map((h) => ({ text: h })),
              descriptions: ad.descriptions.map((d) => ({ text: d })),
            },
            finalUrls: ad.finalUrls,
          },
        },
      }],
    );
    return results[0].resourceName;
  }

  /**
   * Update a single field on an entity via mutate.
   * `resourceName` is the full resource name (e.g. customers/123/campaigns/456).
   * `fields` is the set of fields to update.
   */
  async updateEntity(
    resource: string,
    resourceName: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const updateMask = Object.keys(fields).join(",");
    await this.mutate(resource, [{
      update: { resourceName, ...fields },
      updateMask,
    }]);
  }

  // ─── Convenience methods ────────────────────────────────────────────────

  async getCustomerInfo(): Promise<GAdsCustomerInfo> {
    // Query the `customer` resource via GAQL (searchStream) rather than a plain
    // GET on /customers/{id} — the REST GET 404s for accounts reached through a
    // manager (login-customer-id), while searchStream honors the header.
    const rows = await this.search<{
      customer: {
        id: string;
        descriptiveName?: string;
        currencyCode?: string;
        timeZone?: string;
        manager?: boolean;
      };
    }>(`
      SELECT
        customer.id, customer.descriptive_name,
        customer.currency_code, customer.time_zone,
        customer.manager
      FROM customer
      LIMIT 1
    `);
    const c = rows[0]?.customer;
    return {
      id: c?.id || this.custId,
      descriptiveName: c?.descriptiveName || "",
      currencyCode: c?.currencyCode || "USD",
      timeZone: c?.timeZone || "UTC",
      manager: !!c?.manager,
    };
  }

  /**
   * List every account visible under this customer ID. Queried via
   * customer_client, which works on manager accounts (unlike metric queries).
   * - On a manager account: returns the full tree (managers + leaf accounts).
   * - On a leaf account: returns just itself.
   * Leaf accounts (isManager=false) are the ones that hold campaigns/metrics.
   */
  async listChildAccounts(): Promise<GAdsChildAccount[]> {
    const rows = await this.search<{
      customerClient: {
        id: string;
        descriptiveName?: string;
        manager?: boolean;
        currencyCode?: string;
        level?: string;
      };
    }>(`
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.manager,
        customer_client.currency_code,
        customer_client.level
      FROM customer_client
      WHERE customer_client.status = 'ENABLED'
    `);

    return rows.map((r) => ({
      id: r.customerClient.id,
      name: r.customerClient.descriptiveName || `Account ${r.customerClient.id}`,
      isManager: !!r.customerClient.manager,
      currencyCode: r.customerClient.currencyCode || "USD",
      level: Number(r.customerClient.level) || 0,
    }));
  }

  async listCampaigns(
    startDate: string,
    endDate: string,
  ): Promise<GAdsCampaign[]> {
    const rows = await this.search<{
      campaign: {
        id: string;
        name: string;
        status: string;
        advertisingChannelType: string;
        biddingStrategyType?: string;
      };
      campaignBudget?: { amountMicros?: string };
      metrics: {
        impressions: string;
        clicks: string;
        costMicros: string;
        conversions: string;
        conversionsValue: string;
        allConversions: string;
      };
    }>(`
      SELECT
        campaign.id, campaign.name, campaign.status,
        campaign.advertising_channel_type,
        campaign.bidding_strategy_type,
        campaign_budget.amount_micros,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value,
        metrics.all_conversions
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status != 'REMOVED'
    `);

    return rows.map((r) => ({
      id: r.campaign.id,
      name: r.campaign.name,
      status: r.campaign.status,
      advertisingChannelType: r.campaign.advertisingChannelType,
      biddingStrategyType: r.campaign.biddingStrategyType,
      budgetAmountMicros: r.campaignBudget?.amountMicros,
      impressions: Number(r.metrics.impressions) || 0,
      clicks: Number(r.metrics.clicks) || 0,
      costMicros: Number(r.metrics.costMicros) || 0,
      conversions: Number(r.metrics.conversions) || 0,
      conversionsValue: Number(r.metrics.conversionsValue) || 0,
      allConversions: Number(r.metrics.allConversions) || 0,
    }));
  }

  async listAdGroups(
    startDate: string,
    endDate: string,
  ): Promise<GAdsAdGroup[]> {
    const rows = await this.search<{
      adGroup: {
        id: string;
        campaign: string;
        name: string;
        status: string;
        type: string;
      };
      metrics: {
        impressions: string;
        clicks: string;
        costMicros: string;
        conversions: string;
      };
    }>(`
      SELECT
        ad_group.id, ad_group.campaign, ad_group.name,
        ad_group.status, ad_group.type,
        metrics.impressions, metrics.clicks,
        metrics.cost_micros, metrics.conversions
      FROM ad_group
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND ad_group.status != 'REMOVED'
    `);

    return rows.map((r) => ({
      id: r.adGroup.id,
      campaignId:
        r.adGroup.campaign?.replace(/^customers\/\d+\/campaigns\//, "") || "",
      name: r.adGroup.name,
      status: r.adGroup.status,
      type: r.adGroup.type,
      impressions: Number(r.metrics.impressions) || 0,
      clicks: Number(r.metrics.clicks) || 0,
      costMicros: Number(r.metrics.costMicros) || 0,
      conversions: Number(r.metrics.conversions) || 0,
    }));
  }

  async listAds(startDate: string, endDate: string): Promise<GAdsAd[]> {
    const rows = await this.search<{
      adGroupAd: {
        ad: {
          id: string;
          type: string;
          name?: string;
          responsiveSearchAd?: {
            headlines?: Array<{ text: string }>;
            descriptions?: Array<{ text: string }>;
          };
          finalUrls?: string[];
        };
        adGroup: string;
        status: string;
      };
      metrics: {
        impressions: string;
        clicks: string;
        costMicros: string;
        conversions: string;
      };
    }>(`
      SELECT
        ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.name,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad_group, ad_group_ad.status,
        metrics.impressions, metrics.clicks,
        metrics.cost_micros, metrics.conversions
      FROM ad_group_ad
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND ad_group_ad.status != 'REMOVED'
    `);

    return rows.map((r) => ({
      id: r.adGroupAd.ad.id,
      adGroupId:
        r.adGroupAd.adGroup?.replace(/^customers\/\d+\/adGroups\//, "") || "",
      name: r.adGroupAd.ad.name || "",
      status: r.adGroupAd.status,
      type: r.adGroupAd.ad.type,
      headlines: r.adGroupAd.ad.responsiveSearchAd?.headlines?.map(
        (h) => h.text,
      ),
      descriptions: r.adGroupAd.ad.responsiveSearchAd?.descriptions?.map(
        (d) => d.text,
      ),
      finalUrls: r.adGroupAd.ad.finalUrls,
      impressions: Number(r.metrics.impressions) || 0,
      clicks: Number(r.metrics.clicks) || 0,
      costMicros: Number(r.metrics.costMicros) || 0,
      conversions: Number(r.metrics.conversions) || 0,
    }));
  }

  async listKeywords(
    startDate: string,
    endDate: string,
  ): Promise<GAdsKeyword[]> {
    const rows = await this.search<{
      adGroupCriterion: {
        criterionId: string;
        adGroup: string;
        keyword: { text: string; matchType: string };
        status: string;
        qualityInfo?: { qualityScore?: number };
      };
      metrics: {
        impressions: string;
        clicks: string;
        costMicros: string;
        conversions: string;
      };
    }>(`
      SELECT
        ad_group_criterion.criterion_id, ad_group_criterion.ad_group,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.quality_info.quality_score,
        metrics.impressions, metrics.clicks,
        metrics.cost_micros, metrics.conversions
      FROM keyword_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND ad_group_criterion.status != 'REMOVED'
    `);

    return rows.map((r) => ({
      id: r.adGroupCriterion.criterionId,
      adGroupId:
        r.adGroupCriterion.adGroup?.replace(
          /^customers\/\d+\/adGroups\//,
          "",
        ) || "",
      keyword: r.adGroupCriterion.keyword.text,
      matchType: r.adGroupCriterion.keyword.matchType,
      status: r.adGroupCriterion.status,
      qualityScore: r.adGroupCriterion.qualityInfo?.qualityScore,
      impressions: Number(r.metrics.impressions) || 0,
      clicks: Number(r.metrics.clicks) || 0,
      costMicros: Number(r.metrics.costMicros) || 0,
      conversions: Number(r.metrics.conversions) || 0,
    }));
  }

  async getConversionActions(): Promise<GAdsConversionAction[]> {
    const rows = await this.search<{
      conversionAction: {
        id: string;
        name: string;
        type: string;
        status: string;
        category?: string;
        countingType?: string;
      };
      metrics: {
        conversions: string;
        allConversions: string;
        conversionsValue: string;
      };
    }>(`
      SELECT
        conversion_action.id, conversion_action.name,
        conversion_action.type, conversion_action.status,
        conversion_action.category, conversion_action.counting_type,
        metrics.conversions, metrics.all_conversions,
        metrics.conversions_value
      FROM conversion_action
      WHERE conversion_action.status != 'REMOVED'
    `);

    return rows.map((r) => ({
      id: r.conversionAction.id,
      name: r.conversionAction.name,
      type: r.conversionAction.type,
      status: r.conversionAction.status,
      category: r.conversionAction.category,
      countingType: r.conversionAction.countingType,
      conversions: Number(r.metrics.conversions) || 0,
      allConversions: Number(r.metrics.allConversions) || 0,
      conversionsValue: Number(r.metrics.conversionsValue) || 0,
    }));
  }

  // ─── Demographic / audience breakdowns ──────────────────────────────────

  /**
   * Age breakdown via age_range_view.
   * Returns one row per age bucket with spend/impressions/clicks/conversions.
   */
  async getAgeBreakdown(startDate: string, endDate: string) {
    const rows = await this.search<{
      adGroupCriterion: { ageRange?: { type?: string } };
      metrics: {
        costMicros: string;
        impressions: string;
        clicks: string;
        conversions: string;
        conversionsValue: string;
      };
    }>(`
      SELECT
        ad_group_criterion.age_range.type,
        metrics.cost_micros, metrics.impressions, metrics.clicks,
        metrics.conversions, metrics.conversions_value
      FROM age_range_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);

    // Aggregate by age bucket (multiple ad groups contribute)
    const byAge = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }>();
    for (const r of rows) {
      const label = friendlyAge(r.adGroupCriterion.ageRange?.type || "UNSPECIFIED");
      const cur = byAge.get(label) ?? { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
      cur.spend += (Number(r.metrics.costMicros) || 0) / 1_000_000;
      cur.impressions += Number(r.metrics.impressions) || 0;
      cur.clicks += Number(r.metrics.clicks) || 0;
      cur.conversions += Number(r.metrics.conversions) || 0;
      cur.conversionValue += Number(r.metrics.conversionsValue) || 0;
      byAge.set(label, cur);
    }
    return [...byAge.entries()].map(([label, d]) => ({ label, ...d }));
  }

  /**
   * Gender breakdown via gender_view.
   */
  async getGenderBreakdown(startDate: string, endDate: string) {
    const rows = await this.search<{
      adGroupCriterion: { gender?: { type?: string } };
      metrics: {
        costMicros: string;
        impressions: string;
        clicks: string;
        conversions: string;
        conversionsValue: string;
      };
    }>(`
      SELECT
        ad_group_criterion.gender.type,
        metrics.cost_micros, metrics.impressions, metrics.clicks,
        metrics.conversions, metrics.conversions_value
      FROM gender_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);

    const byGender = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }>();
    for (const r of rows) {
      const label = friendlyGender(r.adGroupCriterion.gender?.type || "UNSPECIFIED");
      const cur = byGender.get(label) ?? { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
      cur.spend += (Number(r.metrics.costMicros) || 0) / 1_000_000;
      cur.impressions += Number(r.metrics.impressions) || 0;
      cur.clicks += Number(r.metrics.clicks) || 0;
      cur.conversions += Number(r.metrics.conversions) || 0;
      cur.conversionValue += Number(r.metrics.conversionsValue) || 0;
      byGender.set(label, cur);
    }
    return [...byGender.entries()].map(([label, d]) => ({ label, ...d }));
  }

  /**
   * Geographic breakdown via user_location_view (country level).
   * Uses country_criterion_id which maps to Google Ads geo target constants.
   */
  async getGeoBreakdown(startDate: string, endDate: string) {
    const rows = await this.search<{
      userLocationView: { countryCriterionId?: string };
      metrics: {
        costMicros: string;
        impressions: string;
        clicks: string;
        conversions: string;
        conversionsValue: string;
      };
    }>(`
      SELECT
        user_location_view.country_criterion_id,
        metrics.cost_micros, metrics.impressions, metrics.clicks,
        metrics.conversions, metrics.conversions_value
      FROM user_location_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);

    const byCountry = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }>();
    for (const r of rows) {
      const raw = String(r.userLocationView.countryCriterionId || "Unknown");
      const label = friendlyCountry(raw);
      const cur = byCountry.get(label) ?? { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
      cur.spend += (Number(r.metrics.costMicros) || 0) / 1_000_000;
      cur.impressions += Number(r.metrics.impressions) || 0;
      cur.clicks += Number(r.metrics.clicks) || 0;
      cur.conversions += Number(r.metrics.conversions) || 0;
      cur.conversionValue += Number(r.metrics.conversionsValue) || 0;
      byCountry.set(label, cur);
    }
    return [...byCountry.entries()].map(([label, d]) => ({ label, ...d }));
  }

  /**
   * Device breakdown via segments.device on the campaign resource.
   */
  async getDeviceBreakdown(startDate: string, endDate: string) {
    const rows = await this.search<{
      segments: { device?: string };
      metrics: {
        costMicros: string;
        impressions: string;
        clicks: string;
        conversions: string;
        conversionsValue: string;
      };
    }>(`
      SELECT
        segments.device,
        metrics.cost_micros, metrics.impressions, metrics.clicks,
        metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status != 'REMOVED'
    `);

    const byDevice = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }>();
    for (const r of rows) {
      const label = friendlyDevice(r.segments.device || "UNSPECIFIED");
      const cur = byDevice.get(label) ?? { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
      cur.spend += (Number(r.metrics.costMicros) || 0) / 1_000_000;
      cur.impressions += Number(r.metrics.impressions) || 0;
      cur.clicks += Number(r.metrics.clicks) || 0;
      cur.conversions += Number(r.metrics.conversions) || 0;
      cur.conversionValue += Number(r.metrics.conversionsValue) || 0;
      byDevice.set(label, cur);
    }
    return [...byDevice.entries()].map(([label, d]) => ({ label, ...d }));
  }
}

// ─── Label helpers ──────────────────────────────────────────────────────────

function friendlyAge(raw: string): string {
  const map: Record<string, string> = {
    AGE_RANGE_18_24: "18-24",
    AGE_RANGE_25_34: "25-34",
    AGE_RANGE_35_44: "35-44",
    AGE_RANGE_45_54: "45-54",
    AGE_RANGE_55_64: "55-64",
    AGE_RANGE_65_UP: "65+",
    AGE_RANGE_UNDETERMINED: "Undetermined",
  };
  return map[raw] || raw;
}

function friendlyGender(raw: string): string {
  const map: Record<string, string> = {
    MALE: "Male",
    FEMALE: "Female",
    UNDETERMINED: "Undetermined",
  };
  return map[raw] || raw;
}

/** Map Google Ads geo target criterion IDs to country labels. */
function friendlyCountry(raw: string): string {
  // raw is either a bare numeric ID (from user_location_view.country_criterion_id)
  // or a resource name like "geoTargetConstants/2356"
  const id = raw.replace(/^geoTargetConstants\//, "");
  return GEO_TARGET_COUNTRIES[id] || `Country ${id}`;
}

// Top 50 Google Ads geo target constant IDs → country names.
// Full list: https://developers.google.com/google-ads/api/data/geotargets
const GEO_TARGET_COUNTRIES: Record<string, string> = {
  "2004": "Afghanistan", "2008": "Albania", "2012": "Algeria", "2032": "Argentina",
  "2036": "Australia", "2040": "Austria", "2050": "Bangladesh", "2056": "Belgium",
  "2076": "Brazil", "2100": "Bulgaria", "2116": "Cambodia", "2124": "Canada",
  "2144": "Sri Lanka", "2152": "Chile", "2156": "China", "2158": "Taiwan",
  "2170": "Colombia", "2196": "Cyprus", "2203": "Czech Republic", "2208": "Denmark",
  "2218": "Ecuador", "2233": "Estonia", "2246": "Finland", "2250": "France",
  "2276": "Germany", "2300": "Greece", "2344": "Hong Kong", "2348": "Hungary",
  "2356": "India", "2360": "Indonesia", "2372": "Ireland", "2376": "Israel",
  "2380": "Italy", "2392": "Japan", "2398": "Kazakhstan", "2400": "Jordan",
  "2404": "Kenya", "2410": "South Korea", "2422": "Lebanon", "2428": "Latvia",
  "2440": "Lithuania", "2458": "Malaysia", "2484": "Mexico", "2504": "Morocco",
  "2528": "Netherlands", "2554": "New Zealand", "2566": "Nigeria", "2578": "Norway",
  "2586": "Pakistan", "2604": "Peru", "2608": "Philippines", "2616": "Poland",
  "2620": "Portugal", "2634": "Qatar", "2642": "Romania", "2643": "Russia",
  "2682": "Saudi Arabia", "2702": "Singapore", "2710": "South Africa", "2724": "Spain",
  "2752": "Sweden", "2756": "Switzerland", "2764": "Thailand", "2784": "UAE",
  "2792": "Turkey", "2804": "Ukraine", "2818": "Egypt", "2826": "United Kingdom",
  "2840": "United States", "2862": "Venezuela", "2704": "Vietnam",
};

function friendlyDevice(raw: string): string {
  const map: Record<string, string> = {
    MOBILE: "Mobile",
    DESKTOP: "Desktop",
    TABLET: "Tablet",
    CONNECTED_TV: "Connected TV",
    OTHER: "Other",
  };
  return map[raw] || raw;
}
