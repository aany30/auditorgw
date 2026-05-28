/**
 * AI Recommendation Engine — covers every line item in the requirements doc.
 * Rules grouped by spec section:
 *   META: Pixel Health, EMQ, CAPI, Funnel, Attribution, Event Manager Diagnostics
 *   GOOGLE: Google Ads Conversion, Enhanced Conversions, GA4, GTM, Ecommerce Funnel
 *   AI Intelligence: anomaly detection, predicted impact, data-loss estimation
 */

import type { MetaPixelStats } from "../api-clients/meta";
import type { GoogleAuditResult } from "../api-clients/google";

export interface Recommendation {
  id: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  platform: "Meta" | "Google" | "Both";
  category:
    | "Pixel Health" | "EMQ" | "Funnel" | "Attribution" | "GA4" | "GTM" | "CAPI"
    | "Anomaly" | "Ecommerce" | "Event Manager" | "Google Ads" | "Enhanced Conversions"
    | "Consent" | "UTM" | "Cross-Domain";
  issue: string;
  details: string;
  action: string;
  impact: number;
  effort: "Quick" | "Medium" | "High";
  confidence: number;
  estimatedDataLoss?: number;
}

// Benchmarks (from official Meta + Google docs)
export const META_BENCHMARKS = {
  emq: { PageView: 6.0, ViewContent: 6.5, AddToCart: 7.0, InitiateCheckout: 8.0, AddPaymentInfo: 8.5, Purchase: 9.0, Lead: 8.0 } as Record<string, number>,
  matchKeys: {
    em: { benchmark: 70, weight: 1.5 }, ph: { benchmark: 70, weight: 1.5 },
    external_id: { benchmark: 80, weight: 1.0 }, client_ip: { benchmark: 90, weight: 0.5 },
    client_user_agent: { benchmark: 90, weight: 0.3 }, fbc: { benchmark: 70, weight: 1.0 },
    fbp: { benchmark: 85, weight: 0.7 },
  } as Record<string, { benchmark: number; weight: number }>,
  dedupRate: { target: 95, minimum: 85 },
  eventIdCoverage: { minimum: 90 },
  payloadCompleteness: { minimum: 85 },
  serverLatencyMs: { warning: 1000, critical: 2000 },
  capiFailureRate: { warning: 1, critical: 5 },
  dataFreshnessMins: { stale: 60, critical: 720 },
};

export const FUNNEL_BENCHMARKS = {
  ecommerce: {
    PageView_to_ViewContent: 80, ViewContent_to_AddToCart: 50,
    AddToCart_to_InitiateCheckout: 30, InitiateCheckout_to_Purchase: 50,
  },
};

export const GOOGLE_BENCHMARKS = {
  enhancedConversions: { email: 70, phone: 70, overall: 80 },     // spec: 70%+ good
  attributionModel: "data-driven",
  dataRetention: "14 months",
  utmConsistency: 90,
  customEvents: { warning: 10 },
};

function priorityFromImpact(impact: number): Recommendation["priority"] {
  if (impact >= 7) return "Critical";
  if (impact >= 4) return "High";
  if (impact >= 2) return "Medium";
  return "Low";
}

/** META: full analysis — covers every spec line for Meta */
export function analyzeMetaPixel(stats: MetaPixelStats): Recommendation[] {
  const recs: Recommendation[] = [];

  // 1. Pixel Health Monitoring
  if (stats.status === "inactive" || stats.totalEvents === 0) {
    recs.push({
      id: `meta-${stats.pixelId}-offline`, priority: "Critical", platform: "Meta", category: "Pixel Health",
      issue: `Pixel "${stats.name}" inactive`,
      details: `Pixel ${stats.pixelId} reported 0 events. Indicates broken implementation or removed snippet.`,
      action: "Verify base pixel code on every page and that GTM tag is published.",
      impact: 9.5, effort: "Medium", confidence: 95, estimatedDataLoss: 100,
    });
    return recs;
  }

  // Anomaly detection (spec: sudden drops/spikes)
  for (const a of stats.anomalies) {
    recs.push({
      id: `meta-${stats.pixelId}-anom-${a.event}`, priority: a.severity, platform: "Meta", category: "Anomaly",
      issue: `${a.type === "drop" ? "Sudden drop" : "Unusual spike"} in ${a.event} events`,
      details: `${a.event} dropped to ${a.currentValue.toLocaleString()} in last 24h vs 7-day baseline of ${a.baseline.toLocaleString()} (${a.deviation > 0 ? "+" : ""}${a.deviation}% deviation).`,
      action: a.type === "drop"
        ? "Verify the event still fires correctly. Check if a recent GTM publish, code deploy, or attribution window change broke firing."
        : "Investigate for duplicate firing, bot traffic, or recent campaign launches that explain the spike.",
      impact: a.severity === "Critical" ? 8 : a.severity === "High" ? 6 : 3.5,
      effort: "Medium", confidence: 90, estimatedDataLoss: Math.abs(a.deviation),
    });
  }

  // Data freshness (spec: data freshness)
  if (stats.diagnostics.dataFreshnessMins > META_BENCHMARKS.dataFreshnessMins.stale) {
    recs.push({
      id: `meta-${stats.pixelId}-freshness`,
      priority: stats.diagnostics.dataFreshnessMins > META_BENCHMARKS.dataFreshnessMins.critical ? "Critical" : "Medium",
      platform: "Meta", category: "Pixel Health",
      issue: "Stale tracking data",
      details: `Last event received ${stats.diagnostics.dataFreshnessMins} minutes ago — Meta updates pixel stats in near real-time so prolonged silence often means tracking is broken.`,
      action: "Open the page in Meta Pixel Helper and confirm events fire. Check for blocking errors in console.",
      impact: 6, effort: "Quick", confidence: 88,
    });
  }

  // 2. EMQ per event
  for (const event of stats.eventBreakdown) {
    const benchmark = META_BENCHMARKS.emq[event.event];
    if (benchmark && event.matchScore < benchmark - 1) {
      const gap = benchmark - event.matchScore;
      recs.push({
        id: `meta-${stats.pixelId}-emq-${event.event}`,
        priority: gap > 2 ? "Critical" : gap > 1 ? "High" : "Medium",
        platform: "Meta", category: "EMQ",
        issue: `Low Event Match Quality for ${event.event}`,
        details: `EMQ ${event.matchScore.toFixed(1)} vs Meta benchmark ${benchmark}+. Each 0.5 point lift correlates with ~3-5% reported conversion improvement.`,
        action: "Add hashed em, ph, external_id parameters. SHA256 + lowercase normalize before send.",
        impact: Math.min(7.5, gap * 1.5), effort: "Medium", confidence: 88,
        estimatedDataLoss: Math.round(gap * 3),
      });
    }
  }

  // Match key coverage (advanced matching setup, missing identifiers, IP/UA)
  for (const mk of stats.emq.matchKeys) {
    const config = META_BENCHMARKS.matchKeys[mk.key];
    if (config && mk.coverage < config.benchmark - 5) {
      const gap = config.benchmark - mk.coverage;
      recs.push({
        id: `meta-${stats.pixelId}-mk-${mk.key}`,
        priority: gap > 20 ? "Critical" : gap > 10 ? "High" : "Medium",
        platform: "Meta", category: "EMQ",
        issue: `${mk.key} coverage below benchmark`,
        details: `${mk.coverage}% of events include ${mk.key} (benchmark ${config.benchmark}%+). ${mk.key === "em" || mk.key === "ph" ? "Highest-value match signal." : ""}`,
        action: `Capture ${mk.key} on customer touchpoints. Use Advanced Matching in pixel base code or pass server-side.`,
        impact: (gap / 10) * config.weight, effort: "Medium", confidence: 85,
      });
    }
  }

  if (!stats.emq.serverSideEnrichment) {
    recs.push({
      id: `meta-${stats.pixelId}-no-enrichment`, priority: "Medium", platform: "Meta", category: "EMQ",
      issue: "Server-side signal enrichment disabled",
      details: "Automatic Advanced Matching not enabled — Meta cannot auto-detect emails/phones from forms.",
      action: "Enable Automatic Advanced Matching in Events Manager > Settings.",
      impact: 3, effort: "Quick", confidence: 90,
    });
  }

  // 3. CAPI Audit
  if (stats.capi.serverShare < 10) {
    recs.push({
      id: `meta-${stats.pixelId}-no-capi`, priority: "Critical", platform: "Meta", category: "CAPI",
      issue: "Conversion API not enabled",
      details: `Only ${stats.capi.serverShare.toFixed(1)}% of events are server-side. CAPI recovers ~10-20% of conversions lost to iOS 14.5+ and ad blockers.`,
      action: "Implement CAPI via your server, GTM Server-Side, or a CAPI partner. Mirror browser events with matching event_id.",
      impact: 8, effort: "High", confidence: 92, estimatedDataLoss: 15,
    });
  }
  if (stats.capi.capiBreakdown.eventIdConsistency < META_BENCHMARKS.eventIdCoverage.minimum) {
    recs.push({
      id: `meta-${stats.pixelId}-event-id`, priority: "Critical", platform: "Meta", category: "CAPI",
      issue: "event_id missing on many events",
      details: `Only ${stats.capi.capiBreakdown.eventIdConsistency.toFixed(0)}% of events carry event_id. Without it Meta cannot dedupe browser+server events, inflating conversion costs.`,
      action: "Generate a UUID per event and send the same value on browser pixel AND CAPI payload.",
      impact: 6.5, effort: "Medium", confidence: 92,
    });
  }
  if (stats.capi.capiBreakdown.payloadCompleteness < META_BENCHMARKS.payloadCompleteness.minimum) {
    recs.push({
      id: `meta-${stats.pixelId}-payload`, priority: "High", platform: "Meta", category: "CAPI",
      issue: "Missing required CAPI payload parameters",
      details: `${(100 - stats.capi.capiBreakdown.payloadCompleteness).toFixed(0)}% of events missing required fields (action_source, event_source_url, value, currency).`,
      action: "Audit your server code and include all required parameters from Meta's CAPI spec.",
      impact: 4.5, effort: "Medium", confidence: 88,
    });
  }
  if (stats.capi.capiBreakdown.avgServerLatencyMs > META_BENCHMARKS.serverLatencyMs.warning) {
    recs.push({
      id: `meta-${stats.pixelId}-latency`,
      priority: stats.capi.capiBreakdown.avgServerLatencyMs > META_BENCHMARKS.serverLatencyMs.critical ? "Critical" : "High",
      platform: "Meta", category: "CAPI",
      issue: "High CAPI server latency",
      details: `Server events take ${stats.capi.capiBreakdown.avgServerLatencyMs.toFixed(0)}ms — Meta recommends < 1000ms. Slow events risk being discarded for attribution.`,
      action: "Move CAPI from synchronous to async/queued. Cache fbp/fbc. Use Meta's regional endpoints.",
      impact: 4, effort: "Medium", confidence: 80,
    });
  }
  if (stats.capi.capiBreakdown.apiFailureRate > META_BENCHMARKS.capiFailureRate.warning) {
    recs.push({
      id: `meta-${stats.pixelId}-api-fail`,
      priority: stats.capi.capiBreakdown.apiFailureRate > META_BENCHMARKS.capiFailureRate.critical ? "Critical" : "High",
      platform: "Meta", category: "CAPI",
      issue: "CAPI API failure rate elevated",
      details: `${stats.capi.capiBreakdown.apiFailureRate.toFixed(1)}% of CAPI calls return non-2xx. Failed events are lost — no retry.`,
      action: "Add retry-with-backoff for 5xx errors. Inspect 4xx errors for malformed payloads. Monitor token expiry.",
      impact: 5, effort: "Medium", confidence: 90,
    });
  }
  for (const auth of stats.capi.authIssues) {
    recs.push({
      id: `meta-${stats.pixelId}-auth-${auth.type}`,
      priority: auth.severity === "error" ? "Critical" : "High",
      platform: "Meta", category: "CAPI",
      issue: "Authentication issue detected",
      details: auth.message,
      action: "Generate a new System User token from Business Settings and rotate before expiry.",
      impact: auth.severity === "error" ? 7 : 4, effort: "Quick", confidence: 95,
    });
  }

  // 4. Funnel Validation — duplicates + sequencing + broken chains
  if (stats.funnelIntegrity.duplicatePurchaseRate > 3) {
    recs.push({
      id: `meta-${stats.pixelId}-dup-purchase`, priority: "Critical", platform: "Meta", category: "Funnel",
      issue: "Duplicate Purchase events detected",
      details: `${stats.funnelIntegrity.duplicatePurchases.toLocaleString()} duplicate purchases (${stats.funnelIntegrity.duplicatePurchaseRate.toFixed(1)}%). Inflates revenue and breaks ROAS calculations.`,
      action: "Confirm event_id is identical on browser + CAPI. Add idempotency at server. Check thank-you page reloads.",
      impact: 7, effort: "Medium", confidence: 92,
    });
  }
  for (const s of stats.funnelIntegrity.sequencingIssues) {
    recs.push({
      id: `meta-${stats.pixelId}-seq-${s.event}`, priority: "High", platform: "Meta", category: "Funnel",
      issue: `Event sequencing broken on ${s.event}`,
      details: s.issue,
      action: "Audit GTM trigger order. Ensure prior funnel events fire before downstream events.",
      impact: 4, effort: "Medium", confidence: 80,
    });
  }
  if (stats.funnelIntegrity.brokenAttributionChains > 0) {
    recs.push({
      id: `meta-${stats.pixelId}-broken-attribution`, priority: "High", platform: "Meta", category: "Attribution",
      issue: "Broken attribution chains",
      details: `${stats.funnelIntegrity.brokenAttributionChains} sessions have purchases without matching campaign click_id — attribution model can't credit campaigns.`,
      action: "Ensure fbc/fbp are persisted across pages. Capture click_id from URL parameters on landing.",
      impact: 4.5, effort: "Medium", confidence: 82,
    });
  }

  // 6. Event Manager Diagnostics
  for (const issue of stats.diagnostics.issues) {
    recs.push({
      id: `meta-${stats.pixelId}-em-${issue.code}`,
      priority: issue.severity === "error" ? "High" : "Medium",
      platform: "Meta", category: "Event Manager",
      issue: `Event Manager: ${issue.code.replace(/_/g, " ")}`,
      details: issue.message + (issue.affectedEvent ? ` (Event: ${issue.affectedEvent})` : ""),
      action: "Open Meta Events Manager > Diagnostics and resolve the flagged issue. Most are auto-fixable from the dashboard.",
      impact: issue.severity === "error" ? 5 : 3, effort: "Quick", confidence: 90,
    });
  }

  return recs;
}

/** GOOGLE: full analysis — covers every spec line for Google */
export function analyzeGoogleAudit(audit: GoogleAuditResult): Recommendation[] {
  const recs: Recommendation[] = [];

  // 1. Google Ads Conversion Audit
  if (audit.ads.missingConversionTags.length > 0) {
    recs.push({
      id: `gads-missing-tags`, priority: "Critical", platform: "Google", category: "Google Ads",
      issue: "Missing conversion tags",
      details: `${audit.ads.missingConversionTags.length} conversion(s) not firing: ${audit.ads.missingConversionTags.join(", ")}. Google Ads cannot bid to them.`,
      action: "Add gtag conversion tags in GTM or directly on site. Validate with Google Tag Assistant.",
      impact: 7, effort: "Medium", confidence: 95,
    });
  }
  if (audit.ads.duplicateConversions > 0) {
    recs.push({
      id: `gads-dup-conversions`, priority: "High", platform: "Google", category: "Google Ads",
      issue: "Duplicate conversions detected",
      details: `${audit.ads.duplicateConversions} duplicate conversions counted. Likely cause: same action tagged in multiple conversion actions.`,
      action: "Audit conversion_action list for overlap. Disable redundant actions and verify de-duplication settings.",
      impact: 4, effort: "Quick", confidence: 88,
    });
  }
  const primaryActions = audit.ads.conversionActions.filter((a) => a.category === "PRIMARY" && a.status === "ENABLED");
  const secondaryActions = audit.ads.conversionActions.filter((a) => a.category === "SECONDARY" && a.status === "ENABLED");
  if (primaryActions.length > 3) {
    recs.push({
      id: `gads-too-many-primary`, priority: "Medium", platform: "Google", category: "Google Ads",
      issue: "Too many primary conversion actions",
      details: `${primaryActions.length} primary conversions enabled. Best practice: 1-3 primary (revenue/lead) and the rest secondary.`,
      action: "Move lower-funnel actions (Add to Cart, Newsletter) to Secondary in Google Ads > Goals.",
      impact: 2.5, effort: "Quick", confidence: 82,
    });
  }
  for (const action of audit.ads.conversionActions) {
    if (action.countingType === "EVERY" && (action.name.toLowerCase().includes("purchase") || action.name.toLowerCase().includes("lead"))) {
      recs.push({
        id: `gads-counting-${action.name}`, priority: "Medium", platform: "Google", category: "Google Ads",
        issue: `Wrong counting method on ${action.name}`,
        details: `Counting method is "EVERY" but ${action.name} should typically be "ONE_PER_CLICK" to avoid inflating bids.`,
        action: "Change counting method to One in Google Ads > Conversions > Settings.",
        impact: 2, effort: "Quick", confidence: 85,
      });
    }
    if (action.missingValue) {
      recs.push({
        id: `gads-missing-value-${action.name}`, priority: "High", platform: "Google", category: "Google Ads",
        issue: `Conversion value missing on ${action.name}`,
        details: `${action.name} has no value passed. Smart Bidding (Target ROAS) cannot work without it.`,
        action: "Pass a dynamic value parameter on the conversion tag (transaction value or estimated LTV).",
        impact: 5, effort: "Medium", confidence: 90,
      });
    }
    if (action.status === "REMOVED") {
      recs.push({
        id: `gads-removed-${action.name}`, priority: "Low", platform: "Google", category: "Google Ads",
        issue: `Disabled conversion action still referenced`,
        details: `${action.name} is marked REMOVED but may still be referenced in GTM tags.`,
        action: "Remove orphaned tags referencing this conversion from GTM.",
        impact: 1, effort: "Quick", confidence: 80,
      });
    }
  }

  // 2. Enhanced Conversions Audit
  const ec = audit.ads.enhancedConversions;
  if (!ec.enabled) {
    recs.push({
      id: `gads-ec-disabled`, priority: "Critical", platform: "Google", category: "Enhanced Conversions",
      issue: "Enhanced Conversions not enabled",
      details: "EC recovers 5-15% of conversions lost to cookie restrictions and improves Smart Bidding accuracy.",
      action: "Enable in Google Ads > Tools > Conversions > Settings, then pass hashed email/phone via gtag or GTM.",
      impact: 7.5, effort: "Medium", confidence: 93, estimatedDataLoss: 10,
    });
  } else {
    if (ec.emailMatchRate < GOOGLE_BENCHMARKS.enhancedConversions.email) {
      const gap = GOOGLE_BENCHMARKS.enhancedConversions.email - ec.emailMatchRate;
      recs.push({
        id: `gads-ec-email`,
        priority: gap > 20 ? "Critical" : "High",
        platform: "Google", category: "Enhanced Conversions",
        issue: "Enhanced Conversions email match rate low",
        details: `Email match rate ${ec.emailMatchRate}% vs benchmark 70%. Status: ${ec.emailMatchRate >= 70 ? "Good" : ec.emailMatchRate >= 50 ? "Moderate" : "Poor"}.`,
        action: "Capture email on more conversion pages. Normalize (lowercase, trim) before SHA256.",
        impact: gap / 8, effort: "Medium", confidence: 88,
      });
    }
    if (ec.phoneMatchRate < GOOGLE_BENCHMARKS.enhancedConversions.phone) {
      const gap = GOOGLE_BENCHMARKS.enhancedConversions.phone - ec.phoneMatchRate;
      recs.push({
        id: `gads-ec-phone`,
        priority: gap > 20 ? "Critical" : "High",
        platform: "Google", category: "Enhanced Conversions",
        issue: "Enhanced Conversions phone match rate low",
        details: `Phone match rate ${ec.phoneMatchRate}% vs benchmark 70%. Status: ${ec.phoneMatchRate >= 70 ? "Good" : ec.phoneMatchRate >= 50 ? "Moderate" : "Poor"}.`,
        action: "Capture phone numbers on more pages. Normalize to E.164 and SHA256.",
        impact: gap / 8, effort: "Medium", confidence: 87,
      });
    }
    if (!ec.consentCompatible) {
      recs.push({
        id: `gads-ec-consent`, priority: "High", platform: "Google", category: "Consent",
        issue: "Enhanced Conversions not consent-compatible",
        details: "EC tags fire before consent is granted, violating GDPR and risking suspended ad serving in EU.",
        action: "Wrap EC tags with Consent Mode triggers (ad_storage and ad_user_data must be granted).",
        impact: 5.5, effort: "Medium", confidence: 90,
      });
    }
  }

  // Attribution model
  if (audit.ads.attributionModel !== GOOGLE_BENCHMARKS.attributionModel) {
    recs.push({
      id: `gads-attribution-model`, priority: "Medium", platform: "Google", category: "Attribution",
      issue: "Suboptimal attribution model",
      details: `Currently "${audit.ads.attributionModel}". Data-Driven Attribution typically improves campaign performance 5-10%.`,
      action: "Switch to Data-Driven Attribution in Google Ads > Tools > Conversions.",
      impact: 4, effort: "Quick", confidence: 80,
    });
  }

  // 3. GA4 Audit
  if (!audit.ga4.ecommerceConfigured) {
    recs.push({
      id: `ga4-ecommerce-missing`, priority: "Critical", platform: "Google", category: "Ecommerce",
      issue: "GA4 e-commerce events missing",
      details: "Standard events (view_item, add_to_cart, begin_checkout, purchase) incomplete. Prevents GA4 funnel metrics and Smart Bidding signals.",
      action: "Implement the GA4 recommended e-commerce event schema with items array, currency, value parameters.",
      impact: 8.5, effort: "High", confidence: 95,
    });
  }
  if (audit.ga4.conversionEvents.length === 0) {
    recs.push({
      id: `ga4-no-conversions`, priority: "Critical", platform: "Google", category: "GA4",
      issue: "No conversion events marked",
      details: "Without GA4 conversions, Google Ads cannot optimize bidding, audiences, or attribution.",
      action: "Mark key events (purchase, generate_lead, begin_checkout) as conversions in GA4 Admin > Events.",
      impact: 7, effort: "Quick", confidence: 95,
    });
  }
  // UTM consistency
  if (audit.ga4.utm.consistencyScore < GOOGLE_BENCHMARKS.utmConsistency) {
    recs.push({
      id: `ga4-utm-consistency`, priority: "Medium", platform: "Google", category: "UTM",
      issue: "UTM tagging inconsistent",
      details: `UTM consistency score ${audit.ga4.utm.consistencyScore}%. ${audit.ga4.utm.missingSources} sessions missing utm_source, ${audit.ga4.utm.inconsistentCampaigns} duplicate-variant campaign names detected.`,
      action: "Enforce a UTM naming convention. Use Google's URL Builder. Audit Looker dashboards for spelling variants.",
      impact: 3, effort: "Quick", confidence: 88,
    });
  }
  // Cross-domain
  if (!audit.ga4.crossDomainTracking.enabled) {
    recs.push({
      id: `ga4-no-cross-domain`, priority: "High", platform: "Google", category: "Cross-Domain",
      issue: "Cross-domain tracking not enabled",
      details: "Users moving across subdomains/checkout domains get re-attributed as direct, killing UTM and referral data.",
      action: "Enable Cross-domain measurement in GA4 Admin > Data Streams > Configure tag settings.",
      impact: 5, effort: "Quick", confidence: 92,
    });
  } else if (audit.ga4.crossDomainTracking.brokenLinks > 0) {
    recs.push({
      id: `ga4-cross-domain-broken`, priority: "Medium", platform: "Google", category: "Cross-Domain",
      issue: "Cross-domain links broken",
      details: `${audit.ga4.crossDomainTracking.brokenLinks} cross-domain transitions are not passing client_id correctly.`,
      action: "Verify auto-link rules cover all destination domains. Add domains to GA4 cross-domain configuration.",
      impact: 3, effort: "Medium", confidence: 85,
    });
  }
  // Referral exclusions
  if (audit.ga4.referralExclusions.missingPaymentGateways.length > 0) {
    recs.push({
      id: `ga4-referral-exclusions`, priority: "High", platform: "Google", category: "GA4",
      issue: "Missing referral exclusions for payment gateways",
      details: `${audit.ga4.referralExclusions.missingPaymentGateways.join(", ")} not excluded — checkout returners are attributed to the gateway, breaking acquisition data.`,
      action: "Add these domains in GA4 Admin > Data Streams > Configure tag settings > List unwanted referrals.",
      impact: 4.5, effort: "Quick", confidence: 95,
    });
  }
  // Custom events ratio
  if (audit.ga4.customEventsCount > GOOGLE_BENCHMARKS.customEvents.warning) {
    recs.push({
      id: `ga4-too-many-custom`, priority: "Low", platform: "Google", category: "GA4",
      issue: "Many custom events detected",
      details: `${audit.ga4.customEventsCount} non-standard events tracked. Hits the 50-event-name cap; lower priority for Smart Bidding signals.`,
      action: "Audit custom events. Map to GA4 recommended event names where possible.",
      impact: 1.5, effort: "Medium", confidence: 70,
    });
  }
  // Consent Mode v2
  if (!audit.ga4.consentMode.v2Enabled) {
    recs.push({
      id: `ga4-consent-v2`, priority: "Critical", platform: "Google", category: "Consent",
      issue: "Consent Mode v2 not configured",
      details: "Mandatory in EEA since March 2024. Missing ad_user_data + ad_personalization signals disable Google Ads bidding optimization in EU.",
      action: "Update CMP/GTM to send Consent Mode v2 signals. Test in DebugView.",
      impact: 6.5, effort: "Medium", confidence: 95, estimatedDataLoss: 12,
    });
  }

  // 4. GTM Container Audit
  if (audit.gtm.brokenTags > 0) {
    recs.push({
      id: `gtm-broken-tags`, priority: "Critical", platform: "Google", category: "GTM",
      issue: `${audit.gtm.brokenTags} broken tag(s) in container`,
      details: "Tags reference triggers that no longer exist. They fail silently.",
      action: "Open GTM > Tags > filter by 'Fires on: undefined'. Fix triggers or remove obsolete tags.",
      impact: 5.5, effort: "Medium", confidence: 95,
    });
  }
  if (audit.gtm.duplicateTags > 0) {
    recs.push({
      id: `gtm-duplicate-tags`, priority: "High", platform: "Google", category: "GTM",
      issue: `${audit.gtm.duplicateTags} duplicate tag(s) detected`,
      details: "Identical tags fire twice, inflating counts and bid signals.",
      action: "Audit container for tags with matching type+parameters. Consolidate and republish.",
      impact: 2.5, effort: "Quick", confidence: 92,
    });
  }
  if (audit.gtm.missingVariables > 0) {
    recs.push({
      id: `gtm-missing-vars`, priority: "High", platform: "Google", category: "GTM",
      issue: `${audit.gtm.missingVariables} variable reference(s) unresolved`,
      details: "Tags reference {{variable}} that doesn't exist — values render as empty strings.",
      action: "GTM > Variables > create the referenced variables or fix the tag references.",
      impact: 3.5, effort: "Quick", confidence: 90,
    });
  }
  if (audit.gtm.triggerConflicts > 0) {
    recs.push({
      id: `gtm-trigger-conflicts`, priority: "Medium", platform: "Google", category: "GTM",
      issue: `${audit.gtm.triggerConflicts} overlapping trigger(s)`,
      details: "Multiple triggers fire on the same selector — risk of duplicate analytics events.",
      action: "Consolidate triggers. Use Trigger Groups for compound conditions.",
      impact: 2.5, effort: "Medium", confidence: 80,
    });
  }
  for (const err of audit.gtm.jsErrors) {
    recs.push({
      id: `gtm-js-${err.tag}`,
      priority: err.severity === "error" ? "High" : "Medium",
      platform: "Google", category: "GTM",
      issue: `JS error in ${err.tag}`,
      details: err.message,
      action: "Open the tag in GTM, inspect the Custom HTML/JS for the referenced error, fix and republish.",
      impact: err.severity === "error" ? 4 : 2, effort: "Medium", confidence: 88,
    });
  }
  if (audit.gtm.unusedTags > 5) {
    recs.push({
      id: `gtm-unused-tags`, priority: "Low", platform: "Google", category: "GTM",
      issue: `${audit.gtm.unusedTags} unused tags`,
      details: "Unused tags add page weight and slow container parsing.",
      action: "Pause or remove tags with no firing triggers.",
      impact: 0.8, effort: "Quick", confidence: 90,
    });
  }

  return recs;
}

/** Funnel analysis (also used for GA4 ecommerce + Meta funnel) */
export function analyzeFunnel(events: Array<{ event: string; count: number }>): Recommendation[] {
  const recs: Recommendation[] = [];
  const map = Object.fromEntries(events.map((e) => [e.event, e.count]));

  const stages = [
    { from: "PageView", to: "ViewContent", benchmark: 80, key: "PageView_to_ViewContent" },
    { from: "ViewContent", to: "AddToCart", benchmark: 50, key: "ViewContent_to_AddToCart" },
    { from: "AddToCart", to: "InitiateCheckout", benchmark: 30, key: "AddToCart_to_InitiateCheckout" },
    { from: "InitiateCheckout", to: "Purchase", benchmark: 50, key: "InitiateCheckout_to_Purchase" },
  ];

  for (const s of stages) {
    const fromCount = map[s.from];
    const toCount = map[s.to];
    if (!fromCount || !toCount) continue;
    const rate = (toCount / fromCount) * 100;
    if (rate < s.benchmark * 0.6) {
      const gap = s.benchmark - rate;
      recs.push({
        id: `funnel-${s.key}`,
        priority: gap > 30 ? "Critical" : "High",
        platform: "Meta", category: "Funnel",
        issue: `Severe drop-off: ${s.from} -> ${s.to}`,
        details: `Conversion ${rate.toFixed(1)}% vs benchmark ${s.benchmark}%. Likely cause: tracking gap rather than UX.`,
        action: `Verify ${s.to} fires using Meta Pixel Helper and check GTM trigger conditions.`,
        impact: Math.min(8, gap / 5), effort: "Medium", confidence: 82,
      });
    }
  }
  return recs;
}

/** Rank by impact × confidence ÷ effort */
export function rankRecommendations(recs: Recommendation[]): Recommendation[] {
  const effortWeight = { Quick: 1.0, Medium: 1.5, High: 2.5 };
  return [...recs]
    .map((r) => ({ ...r, priority: priorityFromImpact(r.impact) }))
    .sort((a, b) => {
      const scoreA = (a.impact * (a.confidence / 100)) / effortWeight[a.effort];
      const scoreB = (b.impact * (b.confidence / 100)) / effortWeight[b.effort];
      return scoreB - scoreA;
    });
}
