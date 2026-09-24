/**
 * Focus-Driven Tabs (Phase 1) — re-frame the SAME completed audit through a different
 * analytical lens, generated on demand per tab. Each lens is one LLM pass over a compact
 * snapshot of the audit with a lens-specific system prompt + shared output schema.
 *
 * Phase 2 (later) will back each lens with a domain agent + confidence; for now the
 * "Data Confidence" lens is computed deterministically from what the audit actually collected.
 */

import type { AnalysisResponse } from "@/lib/media-analyser/types";

// ─── Lens catalog (the 4 LLM lenses; Data Confidence is computed, not prompted) ───
export const FOCUS_LENSES = [
  {
    key: "threat_level",
    label: "Threat Level",
    focus: "Rank the competitors by momentum — who should the brand worry about FIRST. Weigh ad volume, publishing cadence/recency, active vs inactive ad counts, and any scaling/spend signals. Name the top threats in priority order and say exactly why each is or isn't a threat.",
  },
  {
    key: "creative_strategy",
    label: "Creative Strategy",
    focus: "Assess creative strategy: video vs static/image mix, format diversity, creative churn/refresh rate, recurring hooks/angles, and audience personas. Judge who is creatively mature vs stale, and what is working.",
  },
  {
    key: "offer_pricing",
    label: "Offer & Pricing",
    focus: "Assess offers & pricing: discount patterns and depth, promo/offer types, CTA mix, and urgency tactics (limited-time, scarcity). Compare the brand against competitors.",
  },
  {
    key: "channel_strategy",
    label: "Channel Strategy",
    focus: "Assess channel strategy: platform mix (Meta / Google / Instagram / LinkedIn), where budget and effort concentrate, quick-commerce or marketplace presence, and any language/regional targeting.",
  },
] as const;

export type FocusLensKey = (typeof FOCUS_LENSES)[number]["key"];

export function isFocusLensKey(k: string): k is FocusLensKey {
  return FOCUS_LENSES.some(l => l.key === k);
}

// ─── LLM output contract (one domain agent's verdict) ───
export interface FocusInsight { title: string; detail: string; evidence?: string }
export interface FocusLensResult {
  verdict: string;          // one-line overall judgment for this domain
  headline: string;
  insights: FocusInsight[];
  watchouts: string[];
  confidence: "high" | "medium" | "low";
  confidence_note: string;
}

/** Gemini responseSchema (OpenAPI subset). */
export const FOCUS_LENS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    verdict: { type: "string" },
    headline: { type: "string" },
    insights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["title", "detail"],
      },
    },
    watchouts: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    confidence_note: { type: "string" },
  },
  required: ["verdict", "headline", "insights", "confidence", "confidence_note"],
};

export function focusLensSystemPrompt(lens: (typeof FOCUS_LENSES)[number]): string {
  return `You are the ${lens.label} domain expert on a competitive-intelligence panel. You are given a JSON snapshot of a COMPLETED audit of a target brand and its competitors (ad libraries, social, Reddit, e-commerce), and possibly a DATA QA CONFIDENCE report. Analyse ONLY through the ${lens.label} lens and produce your independent verdict.

${lens.focus}

Rules:
- Lead with "verdict": your single overall judgment for this domain, in one decisive sentence.
- Be strictly evidence-bound: cite concrete numbers, brand names, formats or dates FROM the data. Never invent figures.
- Return 3–6 insights. Each is a specific title + a 1–2 sentence detail; put the supporting number/brand/date in "evidence".
- "watchouts" = short caveats or things to keep watching.
- If the input includes a DATA QA CONFIDENCE report, HONOUR it: down-weight or explicitly flag any finding that depends on a source marked missing/partial, and reflect that in your "confidence".
- Set "confidence" (high | medium | low) with a one-line "confidence_note" on what's solid vs shaky for THIS domain.
Return ONLY the JSON object.`;
}

// ─── Chief Analyst orchestrator contract (synthesis across all domain agents) ───
export interface ChiefFinding { title: string; detail: string; domain: string; confidence: "high" | "medium" | "low" }
export interface ChiefConflict { topic: string; positions: string[]; resolution: string }
export interface ChiefAnalystResult {
  executiveSummary: string;
  topFindings: ChiefFinding[];
  conflicts: ChiefConflict[];
  overallConfidence: "high" | "medium" | "low";
  prioritizedActions: string[];
}

export const CHIEF_ANALYST_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    executiveSummary: { type: "string" },
    topFindings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          domain: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["title", "detail", "domain", "confidence"],
      },
    },
    conflicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          positions: { type: "array", items: { type: "string" } },
          resolution: { type: "string" },
        },
        required: ["topic", "positions", "resolution"],
      },
    },
    overallConfidence: { type: "string", enum: ["high", "medium", "low"] },
    prioritizedActions: { type: "array", items: { type: "string" } },
  },
  required: ["executiveSummary", "topFindings", "overallConfidence", "prioritizedActions"],
};

export const CHIEF_ANALYST_SYSTEM = `You are the Chief Analyst orchestrating a panel of independent domain experts (Threat Level / media-buying, Creative Strategy, Offer & Pricing, Channel & Positioning) plus a Data QA auditor. You are given: (1) a compact audit snapshot, (2) a DATA QA CONFIDENCE report, and (3) each domain expert's verdict + insights + confidence.

Synthesise the panel into a single executive brief. NON-NEGOTIABLES:
- Surface DISAGREEMENTS between experts explicitly as "conflicts" (topic, each side's position, and how you resolve it). Do not smooth them over.
- HONOUR the Data QA report: down-weight findings that rest on sources marked missing/partial and SAY SO in-line (e.g. "Media Buyer flags aggressive scaling; Data QA flags incomplete platform coverage — treat as directional, not confirmed"). An incomplete-data caveat is a first-class finding, never buried.
- Tag every top finding with its source "domain" and a "confidence".
- Be strictly evidence-bound; never invent numbers.
- Set "overallConfidence" for the brief as a whole and give 3–6 "prioritizedActions" in priority order.
Return ONLY the JSON object.`;

function stripJsonFences(raw: string): string {
  return raw.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
}

/** Tolerant parse of the LLM lens output → a well-formed FocusLensResult. */
export function parseFocusLensResult(raw: string): FocusLensResult {
  const obj = JSON.parse(stripJsonFences(raw)) as Record<string, unknown>;
  const insights = Array.isArray(obj.insights) ? obj.insights : [];
  const conf = String(obj.confidence ?? "").toLowerCase();
  return {
    verdict: String(obj.verdict ?? "").trim(),
    headline: String(obj.headline ?? "").trim(),
    insights: insights
      .map(i => {
        const o = (i ?? {}) as Record<string, unknown>;
        return { title: String(o.title ?? "").trim(), detail: String(o.detail ?? "").trim(), evidence: o.evidence ? String(o.evidence).trim() : undefined };
      })
      .filter(i => i.title || i.detail),
    watchouts: (Array.isArray(obj.watchouts) ? obj.watchouts : []).map(w => String(w).trim()).filter(Boolean),
    confidence: conf === "high" || conf === "low" ? conf : "medium",
    confidence_note: String(obj.confidence_note ?? "").trim(),
  };
}

function normConf(v: unknown): "high" | "medium" | "low" {
  const c = String(v ?? "").toLowerCase();
  return c === "high" || c === "low" ? c : "medium";
}

/** Tolerant parse of the Chief Analyst synthesis output. */
export function parseChiefAnalystResult(raw: string): ChiefAnalystResult {
  const obj = JSON.parse(stripJsonFences(raw)) as Record<string, unknown>;
  const findings = Array.isArray(obj.topFindings) ? obj.topFindings : [];
  const conflicts = Array.isArray(obj.conflicts) ? obj.conflicts : [];
  return {
    executiveSummary: String(obj.executiveSummary ?? "").trim(),
    topFindings: findings.map(f => {
      const o = (f ?? {}) as Record<string, unknown>;
      return { title: String(o.title ?? "").trim(), detail: String(o.detail ?? "").trim(), domain: String(o.domain ?? "").trim(), confidence: normConf(o.confidence) };
    }).filter(f => f.title || f.detail),
    conflicts: conflicts.map(c => {
      const o = (c ?? {}) as Record<string, unknown>;
      return { topic: String(o.topic ?? "").trim(), positions: (Array.isArray(o.positions) ? o.positions : []).map(p => String(p).trim()).filter(Boolean), resolution: String(o.resolution ?? "").trim() };
    }).filter(c => c.topic),
    overallConfidence: normConf(obj.overallConfidence),
    prioritizedActions: (Array.isArray(obj.prioritizedActions) ? obj.prioritizedActions : []).map(a => String(a).trim()).filter(Boolean),
  };
}

// ─── Compact audit snapshot fed to the lens prompt (keeps the request small) ───
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function buildFocusInput(result: AnalysisResponse): Record<string, unknown> {
  const r = result as unknown as Record<string, unknown>;
  const summary = rec(r.summary);
  const social = rec(r.socialSnapshot);
  const ecom = rec(r.ecomSnapshot);
  const reddit = rec(r.redditSnapshot);

  const competitors = arr(r.competitorSocial).map(c => {
    const o = rec(c);
    return {
      brand: o.brand, handle: o.handle, why: o.why,
      postCount: o.postCount, adCount: o.adCount, googleAdCount: o.googleAdCount,
      warning: o.warning ?? undefined,
    };
  });

  return {
    brand: r.brandName ?? summary.brandName,
    headline: summary.headline,
    keyFindings: summary.keyFindings,
    scope: summary.scope,
    sourceCounts: r.sourceCounts,
    social: {
      metaAds: { count: arr(social.paidAds).length, summary: social.paidAdsSummary ?? undefined, buckets: social.paidAdBuckets ?? undefined, analysis: social.paidAdsAnalysis ?? undefined, fetchError: social.paidAdsFetchError ?? undefined },
      googleAds: { count: arr(social.googleAds).length, summary: social.googleAdsSummary ?? undefined, buckets: social.googleAdBuckets ?? undefined, analysis: social.googleAdsAnalysis ?? undefined, fetchError: social.googleAdsFetchError ?? undefined },
      instagram: { marketingPosts: arr(social.marketingPosts).length, productPosts: arr(social.instagramProductPosts).length, fetched: social.instagramFetchedCount, brandProfile: social.instagramBrandProfile ?? undefined },
      linkedInPosts: arr(social.linkedInPosts).length,
    },
    reddit: { reviews: (r.sourceCounts as Record<string, unknown> | undefined)?.redditReviews ?? 0, sentiment: reddit.sentiment ?? reddit.sentimentSummary ?? undefined },
    ecom: { title: ecom.title ?? ecom.productTitle, price: ecom.price, rating: ecom.rating, competitors: ecom.competitors ? arr(ecom.competitors).length : undefined, battleCards: ecom.battleCards ?? undefined },
    competitors,
  };
}

// ─── Data Confidence (deterministic — what the audit actually collected) ───
export interface DataConfidenceSource { name: string; status: "collected" | "partial" | "missing"; detail: string }
export interface DataConfidenceReport {
  overall: "high" | "medium" | "low";
  scorePct: number;
  sources: DataConfidenceSource[];
  notes: string[];
}

export function computeDataConfidence(result: AnalysisResponse): DataConfidenceReport {
  const r = result as unknown as Record<string, unknown>;
  const social = rec(r.socialSnapshot);
  const counts = rec(r.sourceCounts);
  const sources: DataConfidenceSource[] = [];
  const notes: string[] = [];

  const metaN = arr(social.paidAds).length;
  const metaErr = social.paidAdsFetchError as string | undefined;
  sources.push({ name: "Meta Ad Library", status: metaErr ? (metaN ? "partial" : "missing") : metaN ? "collected" : "missing", detail: metaErr ? `Fetch error — ${String(metaErr).slice(0, 120)}` : `${metaN} ad${metaN === 1 ? "" : "s"} collected` });
  if (metaErr) notes.push(`Meta ads: ${metaN ? "partial (fetch error mid-run)" : "not collected — treat Meta findings as directional"}.`);

  const gN = arr(social.googleAds).length;
  const gErr = social.googleAdsFetchError as string | undefined;
  sources.push({ name: "Google Ads Transparency", status: gErr ? (gN ? "partial" : "missing") : gN ? "collected" : "missing", detail: gErr ? `Fetch error — ${String(gErr).slice(0, 120)}` : gN ? `${gN} ads collected` : "not included / none found" });
  if (gErr) notes.push(`Google ads: ${gN ? "partial" : "not collected"}.`);

  const igN = arr(social.marketingPosts).length + arr(social.instagramProductPosts).length;
  sources.push({ name: "Instagram", status: igN ? "collected" : "missing", detail: igN ? `${igN} posts collected` : "no Instagram posts collected" });
  if (!igN) notes.push("Instagram posts were not collected — creative/channel reads on IG are unsupported.");

  const liN = arr(social.linkedInPosts).length;
  sources.push({ name: "LinkedIn", status: liN ? "collected" : "missing", detail: liN ? `${liN} posts collected` : "not included / none found" });

  const redditN = Number(counts.redditReviews ?? 0);
  sources.push({ name: "Reddit reviews", status: redditN ? "collected" : "missing", detail: redditN ? `${redditN} reviews` : "not included / none found" });

  const ecomN = Number(counts.ecomProjects ?? 0);
  const ecomComp = Number(counts.ecomCompetitors ?? 0);
  sources.push({ name: "E-commerce listing", status: ecomN ? "collected" : "missing", detail: ecomN ? `target + ${ecomComp} competitor listing${ecomComp === 1 ? "" : "s"}` : "no marketplace listing audited" });

  const comp = arr(r.competitorSocial);
  const warned = comp.filter(c => rec(c).warning).length;
  sources.push({ name: "Competitor coverage", status: comp.length ? (warned ? "partial" : "collected") : "missing", detail: comp.length ? `${comp.length} competitor${comp.length === 1 ? "" : "s"}${warned ? `, ${warned} with fetch warnings` : ""}` : "no competitors covered" });
  if (comp.length && warned) notes.push(`${warned} of ${comp.length} competitors had fetch warnings — their signals are incomplete.`);

  const collected = sources.filter(s => s.status === "collected").length;
  const partial = sources.filter(s => s.status === "partial").length;
  const scorePct = Math.round(((collected + partial * 0.5) / sources.length) * 100);
  const overall = scorePct >= 70 ? "high" : scorePct >= 40 ? "medium" : "low";
  if (!notes.length) notes.push("All expected sources returned data — findings rest on broad coverage.");

  return { overall, scorePct, sources, notes };
}
