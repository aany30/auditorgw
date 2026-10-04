/**
 * ApplyContext — the lightweight shape callers of the shared AI-recommendation
 * components (AIRecommendationButton / FixRecommendation) pass to opt into the
 * one-click Apply button. When the AI's response text parses into an
 * AiSuggestedAction and an ApplyContext is in hand, `buildApplyFromAi`
 * returns the full ApplyAction that ApplyActionButton consumes.
 *
 * No applyContext → the AI panel renders text-only (back-compat).
 */

import type { ApplyAction } from "./types";
import type { AiSuggestedAction } from "./suggest-from-text";

export interface ApplyContext {
  platform: "meta" | "dv360";
  entityType: "campaign" | "adset" | "ad" | "lineitem" | "insertion_order";
  entityId: string;
  entityName: string;
  /** Major currency units (e.g. 3500 for ₹3,500 — not cents/paise). */
  currentBudget?: number;
  budgetType?: "daily" | "lifetime";
  currentStatus?: "ACTIVE" | "PAUSED";
  /** ISO 4217 currency code — defaults to "INR". */
  currency?: string;
  /** Prepended to the Apply action's `reason` so the audit log carries context. */
  reasonPrefix?: string;
}

/**
 * Turn an AI-parsed action plus an ApplyContext into a concrete ApplyAction,
 * or null when the pair can't produce a safe mutation (missing data, no-op,
 * or action kind not supported for this entity level).
 */
export function buildApplyFromAi(
  ai: AiSuggestedAction,
  ctx: ApplyContext,
): ApplyAction | null {
  const currency = ctx.currency || "INR";
  const idSuffix = `${ctx.platform}-${ctx.entityType}-${ctx.entityId}-${ai.kind}`;
  const reason = ctx.reasonPrefix
    ? `${ctx.reasonPrefix} — AI recommendation`
    : "AI recommendation";
  const base = {
    id: `apply-${idSuffix}`,
    platform: ctx.platform,
    entityType: ctx.entityType,
    entityId: ctx.entityId,
    entityName: ctx.entityName,
    reason,
  };

  if (ai.kind === "set_budget") {
    if (ctx.currentBudget === undefined || ctx.currentBudget <= 0 || !ctx.budgetType) return null;
    const to = Math.max(1, Math.round(ai.to));
    const from = Math.round(ctx.currentBudget);
    if (to === from) return null;
    return {
      ...base,
      kind: "set_budget",
      budgetType: ctx.budgetType,
      from: from * 100,
      to: to * 100,
      currency,
    };
  }

  if (ai.kind === "set_status") {
    if (!ctx.currentStatus) return null;
    if (ai.to === ctx.currentStatus) return null;
    return {
      ...base,
      kind: "set_status",
      from: ctx.currentStatus,
      to: ai.to,
    };
  }

  if (ai.kind === "set_frequency_cap") {
    // Meta: freq caps live on ad sets. DV360: on line items. Skip others.
    const isMetaAdset = ctx.platform === "meta" && ctx.entityType === "adset";
    const isDv360LineItem = ctx.platform === "dv360" && ctx.entityType === "lineitem";
    if (!isMetaAdset && !isDv360LineItem) return null;
    return {
      ...base,
      kind: "set_frequency_cap",
      from: null,
      to: { impressions: ai.impressions, days: ai.days },
    };
  }

  return null;
}
