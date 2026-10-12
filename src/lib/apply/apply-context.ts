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
import { parseSuggestedAction, type AiSuggestedAction } from "./suggest-from-text";

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

/**
 * Convenience wrapper: parse one step/bullet of AI text and build a concrete
 * ApplyAction from it in a single call. Returns null when the text implies no
 * writable action, or when the action can't be safely built for this entity
 * (no-op, missing budget, unsupported level). Used by every surface that wants
 * a per-step Apply button.
 */
export function buildApplyFromText(text: string, ctx: ApplyContext): ApplyAction | null {
  const suggested = parseSuggestedAction(text);
  return suggested ? buildApplyFromAi(suggested, ctx) : null;
}

/**
 * Build one ApplyAction per step, deduped so at most one button of each kind
 * (budget, status, …) renders across the whole step list. Returns an array
 * aligned 1:1 with `steps` (null where a step has no — or a duplicate — action).
 */
export function buildStepActions(
  steps: Array<{ action: string }>,
  ctx: ApplyContext | undefined,
): Array<ApplyAction | null> {
  const seen = new Set<string>();
  const out: Array<ApplyAction | null> = [];
  for (const step of steps) {
    let action = ctx ? buildApplyFromText(step.action, ctx) : null;
    if (action && seen.has(action.kind)) action = null;
    if (action) seen.add(action.kind);
    out.push(action);
  }
  return out;
}
