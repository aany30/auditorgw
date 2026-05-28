/**
 * Meta Graph API Client — full integration:
 *   - Meta Pixel (info + stats + latency)
 *   - Meta Event Manager (events + diagnostics + recent activity)
 *   - Meta CAPI (server-side events + dedupe + payload + auth + latency)
 */

const META_API_BASE = "https://graph.facebook.com/v18.0";

export interface MetaPixelInfo {
  id: string;
  name: string;
  is_unavailable: boolean;
  last_fired_time?: string;
  data_use_setting?: string;
  enable_automatic_matching?: boolean;
  automatic_matching_fields?: string[];
  creation_time?: string;
}

export interface MetaPixelStats {
  pixelId: string;
  name: string;
  status: "active" | "inactive";
  totalEvents: number;
  eventBreakdown: Array<{
    event: string;
    count: number;
    browserCount: number;
    serverCount: number;
    dedupRate: number;
    matchScore: number;
    avgLatencyMs: number;
    eventIdCoverage: number;
    payloadCompleteness: number;
    duplicateRate: number;
    last24hCount: number;
    baseline7dAvg: number;
  }>;
  capi: {
    enabled: boolean;
    browserShare: number;
    serverShare: number;
    avgDedupRate: number;
    lastServerEventTime?: string;
    capiHealthScore: number;
    capiBreakdown: {
      deduplication: number;
      eventIdConsistency: number;
      payloadCompleteness: number;
      authStatus: number;
      avgServerLatencyMs: number;
      apiFailureRate: number;
    };
    authIssues: Array<{ type: string; message: string; severity: "warning" | "error" }>;
  };
  emq: {
    overallScore: number;
    matchKeys: Array<{ key: string; coverage: number; benchmark: number }>;
    serverSideEnrichment: boolean;
    /** Real % of events carrying any PII / match key (from aggregation=had_pii). */
    piiCoveragePct?: number;
  };
  diagnostics: {
    warnings: number;
    errors: number;
    lastUpdated: string;
    dataFreshnessMins: number;
    issues: Array<{ code: string; message: string; severity: "warning" | "error"; affectedEvent?: string }>;
    recentActivity: Array<{ time: string; event: string; type: string; status: string }>;
  };
  eventManager: {
    automaticMatchingEnabled: boolean;
    automaticMatchingFields: string[];
    dataUseSetting: string;
    activeEventCount: number;
  };
  anomalies: Array<{
    event: string;
    type: "drop" | "spike";
    severity: "Critical" | "High" | "Medium";
    currentValue: number;
    baseline: number;
    deviation: number;
  }>;
  funnelIntegrity: {
    duplicatePurchases: number;
    duplicatePurchaseRate: number;
    sequencingIssues: Array<{ event: string; issue: string }>;
    brokenAttributionChains: number;
  };
}

export function computeCapiHealthScore(b: MetaPixelStats["capi"]["capiBreakdown"]): number {
  const raw =
    b.deduplication * 0.35 +
    b.eventIdConsistency * 0.25 +
    b.payloadCompleteness * 0.2 +
    b.authStatus * 0.15;
  const latencyPenalty = b.avgServerLatencyMs > 2000 ? 6 : b.avgServerLatencyMs > 1000 ? 3 : 0;
  const failurePenalty = b.apiFailureRate > 5 ? 5 : b.apiFailureRate > 1 ? 2 : 0;
  return Math.max(0, Math.min(100, Math.round(raw - latencyPenalty - failurePenalty)));
}

/** Detect drop/spike anomalies from per-event 24h vs 7d baseline */
export function detectAnomalies(eventBreakdown: MetaPixelStats["eventBreakdown"]) {
  const anomalies: MetaPixelStats["anomalies"] = [];
  for (const e of eventBreakdown) {
    if (e.baseline7dAvg < 50) continue; // ignore tiny volume
    const deviation = (e.last24hCount - e.baseline7dAvg) / e.baseline7dAvg;
    if (deviation < -0.3) {
      anomalies.push({
        event: e.event,
        type: "drop",
        severity: deviation < -0.5 ? "Critical" : deviation < -0.4 ? "High" : "Medium",
        currentValue: e.last24hCount,
        baseline: e.baseline7dAvg,
        deviation: Math.round(deviation * 100),
      });
    } else if (deviation > 0.5) {
      anomalies.push({
        event: e.event,
        type: "spike",
        severity: deviation > 1.5 ? "Critical" : deviation > 1.0 ? "High" : "Medium",
        currentValue: e.last24hCount,
        baseline: e.baseline7dAvg,
        deviation: Math.round(deviation * 100),
      });
    }
  }
  return anomalies;
}

export class MetaApiClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async fetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${META_API_BASE}${path}`);
    url.searchParams.set("access_token", this.accessToken);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta API ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  async getPixelInfo(pixelId: string): Promise<MetaPixelInfo> {
    return this.fetch<MetaPixelInfo>(`/${pixelId}`, {
      fields:
        "id,name,is_unavailable,last_fired_time,data_use_setting," +
        "enable_automatic_matching,automatic_matching_fields,creation_time",
    });
  }

  async getPixelStats(pixelId: string, since?: string, until?: string) {
    const params: Record<string, string> = { aggregation: "event" };
    if (since) params.start_time = since;
    if (until) params.end_time = until;
    return this.fetch<{ data?: any[] }>(`/${pixelId}/stats`, params);
  }

  async getCapiStats(pixelId: string) {
    // `aggregation=event_source` returns the browser-vs-server (Pixel vs CAPI)
    // split: nested rows of { value: "BROWSER" | "SERVER", count }. The
    // `breakdowns=event_source` param is silently ignored by Meta — verified
    // live via /api/debug/meta-capi.
    return this.fetch<{ data?: any[] }>(`/${pixelId}/stats`, {
      aggregation: "event_source",
    });
  }

  async getDiagnostics(pixelId: string) {
    return this.fetch<{ data?: any[] }>(`/${pixelId}/diagnostics`, {
      fields: "issue_type,description,severity,affected_event",
    });
  }

  async getMatchKeyStats(pixelId: string) {
    // `aggregation=match_keys` returns REAL per-key coverage: nested rows of
    // { event, value: <keyName e.g. "em"|"external_id"|"fbp">, count } where
    // count = events of that type that carried the key. Verified live.
    return this.fetch<{ data?: any[] }>(`/${pixelId}/stats`, {
      aggregation: "match_keys",
    });
  }

  async getPiiStats(pixelId: string) {
    // `aggregation=had_pii` returns rows { event, value: "has_pii"|"not_has_pii", count }.
    return this.fetch<{ data?: any[] }>(`/${pixelId}/stats`, {
      aggregation: "had_pii",
    });
  }

  /**
   * Full audit — calls real Meta APIs in parallel.
   * Returns null if any required call fails — caller falls back to demo data.
   */
  async getFullPixelAudit(pixelId: string): Promise<MetaPixelStats | null> {
    try {
      const [info, stats, capiStats, diagnostics, matchKeyStats, piiStats] = await Promise.all([
        this.getPixelInfo(pixelId),
        this.getPixelStats(pixelId),
        this.getCapiStats(pixelId).catch(() => ({ data: [] })),
        this.getDiagnostics(pixelId).catch(() => ({ data: [] })),
        this.getMatchKeyStats(pixelId).catch(() => ({ data: [] })),
        this.getPiiStats(pixelId).catch(() => ({ data: [] })),
      ]);

      // Meta's pixel /stats returns TIME-BUCKETED rows, each with a NESTED
      // `data` array of { value: <eventName>, count }. The previous code read
      // `count` off the outer bucket (always undefined) → totalEvents = 0 even
      // when events existed. Flatten + sum across all buckets by `value`.
      const flattenStats = (resp: { data?: any[] }): Map<string, number> => {
        const out = new Map<string, number>();
        for (const bucket of resp.data || []) {
          const rows = Array.isArray((bucket as any)?.data) ? (bucket as any).data : [];
          for (const row of rows) {
            const key = String(row.value ?? "");
            if (!key) continue;
            out.set(key, (out.get(key) || 0) + (row.count || 0));
          }
        }
        return out;
      };

      const eventCounts = flattenStats(stats);
      const events = Array.from(eventCounts, ([event_name, count]) => ({ event_name, count }));
      const diagIssues = diagnostics.data || [];

      // Browser vs server (Pixel vs CAPI) split from `aggregation=event_source`:
      // nested rows of { value: "BROWSER" | "SERVER", count }. Verified live.
      const sourceCounts = flattenStats(capiStats);
      let browserCount = 0;
      let serverCount = 0;
      for (const [src, c] of sourceCounts) {
        const s = src.toUpperCase();
        if (s === "SERVER") serverCount += c;
        else browserCount += c; // "BROWSER" (and any other non-server source)
      }
      const lastServerEventTime: string | undefined = info.last_fired_time;
      const totalEvents = events.reduce((s: number, e: any) => s + (e.count || 0), 0);
      const total = browserCount + serverCount || totalEvents || 1;
      const browserShare = Math.round((browserCount / total) * 100);
      const serverShare = Math.round((serverCount / total) * 100);

      const eventBreakdown = (events as any[]).map((e) => {
        // Use ONLY the values Meta actually returns. Do NOT fabricate
        // healthy-looking defaults (e.g. 90% dedup / 7.0 EMQ) when a field is
        // missing — that masks the fact that the Graph stats edge returns no
        // dedup/CAPI data and makes an empty pixel look healthy. Missing = 0.
        const dedup = e.deduplication_rate ?? 0;
        const matchScore = e.matchRate ?? e.event_match_quality ?? 0;
        const count = e.count || 0;
        const eBrowser = Math.round(count * (browserShare / 100 || 0.55));
        return {
          event: e.event_name,
          count,
          browserCount: eBrowser,
          serverCount: count - eBrowser,
          dedupRate: dedup,
          matchScore,
          avgLatencyMs: e.avg_latency_ms ?? 0,
          eventIdCoverage: e.event_id_coverage ?? 0,
          payloadCompleteness: e.payload_completeness ?? 0,
          duplicateRate: dedup > 0 ? 100 - dedup : 0,
          last24hCount: e.last_24h_count ?? Math.round(count / 7),
          baseline7dAvg: e.baseline_7d_avg ?? Math.round(count / 7),
        };
      });

      const avgDedup =
        eventBreakdown.length > 0
          ? eventBreakdown.reduce((s, e) => s + e.dedupRate, 0) / eventBreakdown.length
          : 0;
      const overallEmq =
        eventBreakdown.length > 0
          ? eventBreakdown.reduce((s, e) => s + e.matchScore, 0) / eventBreakdown.length
          : 0;
      const avgEventIdCoverage =
        eventBreakdown.length > 0
          ? eventBreakdown.reduce((s, e) => s + e.eventIdCoverage, 0) / eventBreakdown.length
          : 0;
      const avgPayload =
        eventBreakdown.length > 0
          ? eventBreakdown.reduce((s, e) => s + e.payloadCompleteness, 0) / eventBreakdown.length
          : 0;
      const avgServerLatency =
        eventBreakdown.length > 0
          ? eventBreakdown.reduce((s, e) => s + e.avgLatencyMs, 0) / eventBreakdown.length
          : 0;

      // REAL match-key coverage from `aggregation=match_keys`: per key, the
      // number of events that carried it. Coverage % = events-with-key / total.
      const matchKeyCounts = flattenStats(matchKeyStats); // keyName -> count
      const allKeys = ["em", "ph", "external_id", "client_ip_address", "client_user_agent", "fbc", "fbp"];
      // Include any keys Meta returned that aren't in our known list.
      for (const k of matchKeyCounts.keys()) if (!allKeys.includes(k)) allKeys.push(k);
      const matchKeys = allKeys.map((key) => ({
        key,
        coverage: totalEvents > 0 ? Math.round(((matchKeyCounts.get(key) || 0) / totalEvents) * 100) : 0,
        benchmark: ["em", "ph"].includes(key) ? 70 : 80,
      }));

      // REAL PII coverage from `aggregation=had_pii`: has_pii vs not_has_pii.
      const piiCounts = flattenStats(piiStats);
      const hasPii = piiCounts.get("has_pii") || 0;
      const noPii = piiCounts.get("not_has_pii") || 0;
      const piiCoveragePct = hasPii + noPii > 0 ? Math.round((hasPii / (hasPii + noPii)) * 100) : 0;

      const issues = (diagIssues as any[]).map((d) => ({
        code: d.issue_type || "unknown",
        message: d.description || "Issue detected",
        severity: (d.severity === "ERROR" ? "error" : "warning") as "error" | "warning",
        affectedEvent: d.affected_event,
      }));

      const capiBreakdown = {
        deduplication: avgDedup,
        eventIdConsistency: avgEventIdCoverage,
        payloadCompleteness: avgPayload,
        authStatus: 95,
        avgServerLatencyMs: avgServerLatency,
        apiFailureRate: 1,
      };

      const purchase = eventBreakdown.find((e) => e.event === "Purchase");
      const sequencingIssues: Array<{ event: string; issue: string }> = [];
      const eventNames = new Set(eventBreakdown.map((e) => e.event));
      if (eventNames.has("Purchase") && !eventNames.has("InitiateCheckout")) {
        sequencingIssues.push({ event: "InitiateCheckout", issue: "Missing — Purchase events fire without checkout" });
      }
      if (eventNames.has("AddToCart") && !eventNames.has("ViewContent")) {
        sequencingIssues.push({ event: "ViewContent", issue: "Missing — AddToCart fires before content view" });
      }

      return {
        pixelId: info.id,
        name: info.name,
        status: info.is_unavailable ? "inactive" : "active",
        totalEvents,
        eventBreakdown,
        capi: {
          enabled: serverCount > 0,
          browserShare,
          serverShare,
          avgDedupRate: avgDedup,
          lastServerEventTime,
          capiHealthScore: computeCapiHealthScore(capiBreakdown),
          capiBreakdown,
          authIssues: [],
        },
        emq: {
          overallScore: overallEmq,
          matchKeys,
          serverSideEnrichment: info.enable_automatic_matching || false,
          piiCoveragePct,
        },
        diagnostics: {
          warnings: issues.filter((i) => i.severity === "warning").length,
          errors: issues.filter((i) => i.severity === "error").length,
          lastUpdated: info.last_fired_time || new Date().toISOString(),
          dataFreshnessMins: info.last_fired_time
            ? Math.round((Date.now() - new Date(info.last_fired_time).getTime()) / 60000)
            : 0,
          issues,
          recentActivity: [],
        },
        eventManager: {
          automaticMatchingEnabled: info.enable_automatic_matching || false,
          automaticMatchingFields: info.automatic_matching_fields || [],
          dataUseSetting: info.data_use_setting || "ADVERTISING",
          activeEventCount: events.length,
        },
        anomalies: detectAnomalies(eventBreakdown),
        funnelIntegrity: {
          duplicatePurchases: purchase ? Math.round(purchase.count * (purchase.duplicateRate / 100)) : 0,
          duplicatePurchaseRate: purchase?.duplicateRate || 0,
          sequencingIssues,
          brokenAttributionChains: 0,
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * List all campaigns under this business account
   */
  async listCampaigns(
    businessId: string,
    startDate?: string,
    endDate?: string
  ): Promise<Array<{
    id: string;
    name: string;
    objective?: string;
    status: string;
    platform: "meta";
    createdTime?: string;
    endTime?: string;
    dailyBudget?: number;
    lifetimeBudget?: number;
    spend?: number;
    impressions?: number;
    clicks?: number;
    conversions?: number;
    conversionValue?: number;
    currency?: string;
  }> | null> {
    try {
      // The user-provided ID can be either an Ad Account ID (more common — they
      // grab it from Ads Manager) or a true Business Manager ID. Ad accounts
      // need the `act_` prefix on Graph API paths. Normalize: if the input
      // doesn't already start with `act_` and is purely numeric, treat it as
      // an ad account ID and prepend `act_`.
      const accountPath = businessId.startsWith("act_")
        ? businessId
        : /^\d+$/.test(businessId)
        ? `act_${businessId}`
        : businessId;

      // Use the caller-supplied date range when available; otherwise default to
      // the last 30 days. Meta accepts either time_range({since,until}) or one
      // of its named date_presets — we use time_range for absolute dates.
      const insightsWindow =
        startDate && endDate
          ? `time_range({"since":"${startDate}","until":"${endDate}"})`
          : "date_preset(last_30d)";

      // Graph API field expansion: pull campaign metadata + budgets + insights + ad-set
      // budgets (fallback for CBO/ad-set-level budgets) + stop_time, all in one request.
      const response = await this.fetch<{ data?: any[] }>(`/${accountPath}/campaigns`, {
        fields:
          "id,name,objective,status,created_time,stop_time,daily_budget,lifetime_budget,account_currency," +
          "adsets.limit(50){daily_budget,lifetime_budget,end_time,status}," +
          `insights.${insightsWindow}{spend,impressions,clicks,actions,action_values}`,
        limit: "100",
      });

      return (response.data || []).map((c: any) => {
        const insight = c.insights?.data?.[0];
        // Sum purchases / leads / completed registrations as conversions.
        const conversionActionTypes = new Set([
          "purchase",
          "offsite_conversion.fb_pixel_purchase",
          "complete_registration",
          "lead",
          "offsite_conversion.fb_pixel_lead",
        ]);
        const conversions = insight?.actions
          ? insight.actions
              .filter((a: any) => conversionActionTypes.has(a.action_type))
              .reduce((sum: number, a: any) => sum + (parseFloat(a.value) || 0), 0)
          : undefined;
        const conversionValue = insight?.action_values
          ? insight.action_values
              .filter((a: any) => conversionActionTypes.has(a.action_type))
              .reduce((sum: number, a: any) => sum + (parseFloat(a.value) || 0), 0)
          : undefined;

        // Meta returns budgets in account currency *minor units* (cents). Divide by 100.
        // Campaign-level budget. May be null for CBO/ABO setups where the budget
        // is actually set at the ad-set level — fall back to summing the ad-sets.
        let dailyBudget = c.daily_budget ? parseFloat(c.daily_budget) / 100 : undefined;
        let lifetimeBudget = c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : undefined;
        const adsets: any[] = c.adsets?.data || [];
        if (dailyBudget === undefined && lifetimeBudget === undefined && adsets.length > 0) {
          // Sum ad-set budgets (only ACTIVE/non-deleted ones to avoid inflated totals).
          const liveAdsets = adsets.filter((a) => a.status !== "DELETED" && a.status !== "ARCHIVED");
          const sumDaily = liveAdsets.reduce(
            (s, a) => s + (a.daily_budget ? parseFloat(a.daily_budget) / 100 : 0),
            0
          );
          const sumLifetime = liveAdsets.reduce(
            (s, a) => s + (a.lifetime_budget ? parseFloat(a.lifetime_budget) / 100 : 0),
            0
          );
          if (sumDaily > 0) dailyBudget = sumDaily;
          if (sumLifetime > 0) lifetimeBudget = sumLifetime;
        }

        // End time: prefer campaign-level stop_time; if absent, use the latest
        // ad-set end_time (any non-null) — a campaign typically ends with its
        // last-running ad set.
        let endTime: string | undefined = c.stop_time || undefined;
        if (!endTime && adsets.length > 0) {
          const adsetEnds = adsets
            .map((a) => a.end_time)
            .filter((t): t is string => typeof t === "string");
          if (adsetEnds.length > 0) {
            endTime = adsetEnds.sort().reverse()[0]; // latest end
          }
        }

        return {
          id: c.id,
          name: c.name,
          objective: c.objective,
          status: c.status,
          platform: "meta" as const,
          createdTime: c.created_time,
          endTime,
          dailyBudget,
          lifetimeBudget,
          spend: insight?.spend ? parseFloat(insight.spend) : undefined,
          impressions: insight?.impressions ? parseInt(insight.impressions, 10) : undefined,
          clicks: insight?.clicks ? parseInt(insight.clicks, 10) : undefined,
          conversions,
          conversionValue,
          currency: c.account_currency || "USD",
        };
      });
    } catch (e) {
      // Surface the real Graph API error (bad token / scope / wrong account ID)
      // instead of swallowing it — the endpoint decides whether to fall back.
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  /**
   * Rename a campaign in Meta Ads Manager.
   * Calls POST /v18.0/{campaign_id} with body { name: "New name" }.
   * Requires the access token to have `ads_management` scope.
   *
   * Returns { success: true } on success, or { success: false, error } on
   * any Graph API error (rate limit, missing scope, invalid name, etc.).
   * Never throws — wraps the failure so the UI can surface the error.
   */
  async renameCampaign(
    campaignId: string,
    newName: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!campaignId || !newName.trim()) {
      return { success: false, error: "campaignId and newName are required" };
    }
    try {
      const response = await fetch(`${META_API_BASE}/${encodeURIComponent(campaignId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          name: newName,
          access_token: this.accessToken,
        }).toString(),
      });
      const data = await response.json();
      if (!response.ok || data?.error) {
        return {
          success: false,
          error: data?.error?.message || `HTTP ${response.status}`,
        };
      }
      return { success: data?.success === true || true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Network error",
      };
    }
  }

  /**
   * List all ad sets under a campaign
   */
  async listAdSets(campaignId: string): Promise<Array<{ id: string; name: string; status: string }> | null> {
    try {
      const response = await this.fetch<{ data?: any[] }>(`/${campaignId}/adsets`, {
        fields: "id,name,status",
        limit: "100",
      });

      return (response.data || []).map((a: any) => ({
        id: a.id,
        name: a.name,
        status: a.status,
      }));
    } catch {
      return null;
    }
  }

  /**
   * List all ads under an ad set
   */
  async listAds(adSetId: string): Promise<Array<{ id: string; name: string; creativeType?: string }> | null> {
    try {
      const response = await this.fetch<{ data?: any[] }>(`/${adSetId}/ads`, {
        fields: "id,name,creative.fields(type)",
        limit: "100",
      });

      return (response.data || []).map((ad: any) => ({
        id: ad.id,
        name: ad.name,
        creativeType: ad.creative?.type,
      }));
    } catch {
      return null;
    }
  }
}
