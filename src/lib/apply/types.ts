/**
 * Apply-Action infrastructure types.
 *
 * An ApplyAction represents a single mutation that can be written back to
 * Meta Marketing API or DV360 API. The discriminated union is intentionally
 * narrow — only four operations are supported today. Any recommendation that
 * doesn't map onto one of these kinds is treated as non-apply-able at the
 * call site.
 */

interface BaseAction {
  /** uuid for audit log */
  id: string;
  platform: "meta" | "dv360";
  entityType: "campaign" | "adset" | "ad" | "lineitem" | "insertion_order";
  entityId: string;
  /** for the confirm modal + audit log display */
  entityName: string;
  /** the recommendation text that led to this */
  reason: string;
}

export interface SetBudgetAction extends BaseAction {
  kind: "set_budget";
  budgetType: "daily" | "lifetime";
  /** in minor currency units (cents / paise) */
  from: number;
  to: number;
  /** "USD", "INR", etc. — for display only */
  currency: string;
}

export interface SetStatusAction extends BaseAction {
  kind: "set_status";
  from: "ACTIVE" | "PAUSED";
  to: "ACTIVE" | "PAUSED";
}

export interface SetFrequencyCapAction extends BaseAction {
  kind: "set_frequency_cap";
  from: { impressions: number; days: number } | null;
  to: { impressions: number; days: number };
}

export interface SetDeviceTargetingAction extends BaseAction {
  kind: "set_device_targeting";
  /** ["mobile", "desktop"] etc. */
  from: string[];
  to: string[];
}

export type ApplyAction =
  | SetBudgetAction
  | SetStatusAction
  | SetFrequencyCapAction
  | SetDeviceTargetingAction;

export interface ApplyResult {
  success: boolean;
  action: ApplyAction;
  /** ISO timestamp */
  appliedAt: string;
  /** present when success=false */
  error?: string;
  /** the API's response body for debugging */
  rawResponse?: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMoney(amount: number, currency: string): string {
  // amount is in minor units — divide by 100 for display.
  const major = amount / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

/** Human-readable summary for the confirm modal and audit log. */
export function describeAction(a: ApplyAction): string {
  switch (a.kind) {
    case "set_budget": {
      const label = a.budgetType === "daily" ? "daily budget" : "lifetime budget";
      return `Change ${label} on ${a.entityName} from ${formatMoney(a.from, a.currency)} → ${formatMoney(a.to, a.currency)}`;
    }
    case "set_status": {
      const verb = a.to === "PAUSED" ? "Pause" : "Resume";
      return `${verb} ${a.entityType.replace("_", " ")} ${a.entityName}`;
    }
    case "set_frequency_cap": {
      return `Set frequency cap: ${a.to.impressions} impressions per ${a.to.days} day${a.to.days === 1 ? "" : "s"} on ${a.entityName}`;
    }
    case "set_device_targeting": {
      return `Change device targeting on ${a.entityName} to [${a.to.join(", ")}]`;
    }
  }
}

/**
 * Risk level based on magnitude of change.
 * - High: >50% budget change, pausing an ACTIVE entity, or targeting that
 *   drops platforms (narrower than before).
 * - Medium: 20–50% budget change, resuming a paused entity, or any targeting
 *   change that isn't a strict widening.
 * - Low: smaller tweaks and frequency cap adjustments.
 */
export function actionRisk(a: ApplyAction): "low" | "medium" | "high" {
  switch (a.kind) {
    case "set_budget": {
      if (a.from <= 0) return "medium";
      const pct = Math.abs(a.to - a.from) / a.from;
      if (pct > 0.5) return "high";
      if (pct > 0.2) return "medium";
      return "low";
    }
    case "set_status": {
      if (a.from === "ACTIVE" && a.to === "PAUSED") return "high";
      return "medium";
    }
    case "set_frequency_cap":
      return "low";
    case "set_device_targeting": {
      const dropped = a.from.filter((d) => !a.to.includes(d));
      if (dropped.length > 0) return "high";
      return "medium";
    }
  }
}
