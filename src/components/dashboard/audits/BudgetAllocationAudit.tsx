import React, { useState, useMemo, useEffect, Fragment } from "react";
import type { AuditProps } from "./types";
import type { CampaignData } from "@/types";
import { useAuthStore } from "@/store/auth";
import CampaignDrillTree from "./CampaignDrillTree";
import AttributionInfo from "@/components/shared/AttributionInfo";
import { useSort } from "@/hooks/useSort";
import SortTh from "@/components/shared/SortTh";
import { currencyFor, formatMoney } from "@/lib/currency";
import { TrendingUp, TrendingDown, AlertCircle, CheckCircle2, Sparkles, Loader2, ChevronRight, ChevronDown } from "lucide-react";
import { useDV360Entities, type DV360IoRaw, type DV360LiRaw } from "@/hooks/useDV360Entities";
import { toDisplayCredits } from "@/lib/ai-cost";
import { isDemoCredential } from "@/lib/demo-data";
import ApplyActionButton from "@/components/apply/ApplyActionButton";
import type { ApplyAction } from "@/lib/apply/types";
import { parseSuggestedAction, type AiSuggestedAction } from "@/lib/apply/suggest-from-text";
export { parseSuggestedAction, type AiSuggestedAction };

function fmtInt(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return Math.round(n).toLocaleString("en-IN");
}

const ACTIVE_STATUSES = new Set(["ACTIVE", "ENABLED", "ENTITY_STATUS_ACTIVE", "ENTITY_STATUS_ENABLED"]);
const isActive = (c: CampaignData) => ACTIVE_STATUSES.has((c.status || "").toUpperCase());

const STATUS_META: Record<string, { label: string; color: string }> = {
  ACTIVE:                { label: "Active",   color: "bg-green-100 text-green-700" },
  ENABLED:               { label: "Enabled",  color: "bg-blue-100 text-blue-700" },
  PAUSED:                { label: "Paused",   color: "bg-gray-100 text-gray-500" },
  ENTITY_STATUS_ACTIVE:  { label: "Active",   color: "bg-green-100 text-green-700" },
  ENTITY_STATUS_ENABLED: { label: "Enabled",  color: "bg-blue-100 text-blue-700" },
  ENTITY_STATUS_PAUSED:  { label: "Paused",   color: "bg-yellow-100 text-yellow-700" },
  ENTITY_STATUS_ARCHIVED:{ label: "Archived", color: "bg-gray-100 text-gray-500" },
  ENTITY_STATUS_DRAFT:   { label: "Draft",    color: "bg-gray-100 text-gray-500" },
};

function statusBadge(status: string) {
  const s = (status || "").toUpperCase();
  const m = STATUS_META[s];
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${m?.color || "bg-gray-100 text-gray-500"}`}>
      {m?.label || status || "—"}
    </span>
  );
}

// ── Per-row AI recommendation ────────────────────────────────────────────────
const AI_RECO_ESTIMATE = `~${toDisplayCredits(0.0018).toFixed(2)}`;

interface RowAiRecoProps {
  campaignContext: Record<string, unknown>;
  findingLabel: string;
  findingDetail: string;
  isDemo: boolean;
  platform: string;
}

interface RowAiRecoPropsExt extends RowAiRecoProps {
  /** Called with the parsed AI-suggested action (budget / pause / resume /
   *  frequency cap) so the parent can wire the Apply button to the AI's
   *  exact recommendation instead of a heuristic. */
  onAiSuggestedAction?: (action: AiSuggestedAction) => void;
}

function RowAiReco({ campaignContext, findingLabel, findingDetail, isDemo, platform, onAiSuggestedAction }: RowAiRecoPropsExt) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { addAiCredits } = useAuthStore();

  const ask = async () => {
    if (answer || loading) { setOpen(true); return; }
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const question = `Finding: ${findingLabel} — ${findingDetail}

Give me 2–4 specific next steps for THIS campaign only. Reference the campaign's actual numbers. Each step on its own line starting with "•". Skip generic advice.

APPLY-ABLE RECOMMENDATION: if ANY of your advice can be executed via the Meta/DV360 API (budget change, pause, resume, frequency cap), state it EXPLICITLY in the FIRST bullet using one of these exact phrasings so the dashboard can wire a one-click Apply button:
- Budget: "Reduce daily budget to ₹<number>" or "Increase daily budget to ₹<number>" or "Set daily budget to ₹<number>"
- Pause: "Pause this campaign" or "Turn this off"
- Resume: "Resume this campaign" or "Reactivate this campaign"
- Frequency cap (ad set): "Cap frequency to <X> impressions per <Y> days"
Only include an apply-able phrase when you are confident it's the right action — do not force it.`;
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context: campaignContext, platform, isDemo }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      const text = json.answer || "(no response)";
      setAnswer(text);
      // Parse the AI's reply for any apply-able action and tell the parent so
      // the Apply button can be wired to the AI's exact recommendation.
      const suggested = parseSuggestedAction(text);
      if (suggested && onAiSuggestedAction) onAiSuggestedAction(suggested);
      if (json.creditsUsedUsd) addAiCredits(json.creditsUsedUsd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2">
      {!open && (
        <button
          onClick={ask}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-700 hover:text-violet-900 hover:underline"
        >
          <Sparkles className="w-3 h-3" />
          Ask AI for next steps
          <span className="text-gray-400 font-normal">{AI_RECO_ESTIMATE}</span>
        </button>
      )}
      {open && (
        <div className="mt-1.5 rounded-md border border-violet-200 bg-violet-50/50 p-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-violet-700">
              <Sparkles className="w-3 h-3" /> AI recommendation
            </span>
            <button onClick={() => setOpen(false)} className="text-[10px] text-gray-400 hover:text-gray-600">close</button>
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-[11px] text-gray-600">
              <Loader2 className="w-3 h-3 animate-spin text-violet-600" />
              Analyzing this campaign…
            </div>
          )}
          {error && (
            <div className="text-[11px] text-red-700">Couldn&apos;t generate: {error}</div>
          )}
          {answer && !loading && (
            <div className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">{answer}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tip (recommendation) per row
// ─────────────────────────────────────────────────────────────────────────────
type TipKind = "spike" | "noDelivery" | "overPacing" | "underPacing" | "healthy" | "paused" | "adSetLevel" | "noBudgetTrail";
type Tip = {
  kind: TipKind;
  severity: "high" | "medium" | "info" | "good";
  label: string;
  detail: string;
  isSpike: boolean;
  sevRank: number;
};

function computeMetaTip(
  c: CampaignData,
  trail: Record<string, { avg7d: number; avg14d: number; avg28d: number }>,
  currency: string,
): Tip {
  if (!isActive(c)) {
    return { kind: "paused", severity: "info", label: "Paused", detail: "Campaign is not currently delivering.", isSpike: false, sevRank: 1 };
  }
  const t = trail[c.id];
  if (!t) {
    return { kind: "noBudgetTrail", severity: "info", label: "Loading…", detail: "Fetching last 28 days of daily spend.", isSpike: false, sevRank: 1 };
  }
  const { avg7d, avg14d, avg28d } = t;
  if (avg14d > 0 && avg7d / avg14d > 1.25) {
    const pct = ((avg7d - avg14d) / avg14d) * 100;
    return { kind: "spike", severity: "high", label: "Budget spike", detail: `${formatMoney(avg7d, currency, 0)}/day this week vs ${formatMoney(avg14d, currency, 0)}/day prior · +${Math.round(pct)}%. Verify this was intentional.`, isSpike: true, sevRank: 3 };
  }
  if (avg7d === 0 && avg28d > 0) {
    return { kind: "noDelivery", severity: "high", label: "No delivery", detail: "Active but zero spend in the last 7 days. Check ad approvals, audience, or pixel firing.", isSpike: false, sevRank: 3 };
  }
  if (!c.dailyBudget || c.dailyBudget <= 0) {
    return { kind: "adSetLevel", severity: "info", label: "Ad-set budgets", detail: `Budget is set at the ad-set level (ABO). Currently averaging ${formatMoney(avg7d, currency, 0)}/day across all ad sets.`, isSpike: false, sevRank: 1 };
  }
  if (avg7d / c.dailyBudget > 1.10) {
    const pct = ((avg7d - c.dailyBudget) / c.dailyBudget) * 100;
    return { kind: "overPacing", severity: "medium", label: "Over-pacing", detail: `${formatMoney(avg7d, currency, 0)}/day vs ${formatMoney(c.dailyBudget, currency, 0)}/day budget · +${Math.round(pct)}%. Within Meta tolerance — watch trend.`, isSpike: false, sevRank: 2 };
  }
  if (avg7d > 0 && avg7d < c.dailyBudget * 0.70) {
    const pct = (avg7d / c.dailyBudget) * 100;
    return { kind: "underPacing", severity: "medium", label: "Under-pacing", detail: `${formatMoney(avg7d, currency, 0)}/day vs ${formatMoney(c.dailyBudget, currency, 0)}/day budget · ${Math.round(pct)}% of cap. Consider lowering budget or check delivery limits.`, isSpike: false, sevRank: 2 };
  }
  const pct = c.dailyBudget > 0 ? (avg7d / c.dailyBudget) * 100 : 100;
  return { kind: "healthy", severity: "good", label: "On pace", detail: `Spending ${formatMoney(avg7d, currency, 0)}/day · ${Math.round(pct)}% of the ${formatMoney(c.dailyBudget, currency, 0)}/day budget. No action needed.`, isSpike: false, sevRank: 0 };
}

function fmtFlightDate(iso?: string): string | null {
  if (!iso) return null;
  try { return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
}

function computeDV360Tip(c: CampaignData, currency: string, win?: { startDate: string; endDate: string }): Tip {
  if (!isActive(c)) {
    return { kind: "paused", severity: "info", label: "Paused", detail: "Campaign is not currently delivering.", isSpike: false, sevRank: 1 };
  }
  const spend = c.spend || 0;
  if (spend === 0) {
    // Line-item status (DV360 delivers at the line-item level, NOT the campaign
    // level — a campaign can be "Active" while every line item is paused/ended).
    const lineItems = (c.adSets ?? []).flatMap((io) => io.ads ?? []);
    const activeLis = lineItems.filter((li) => {
      const st = (li.status || "").toUpperCase();
      return st.includes("ACTIVE") || st.includes("ENABLED");
    }).length;
    const liNote = lineItems.length > 0
      ? ` ${activeLis} of ${lineItems.length} line item${lineItems.length === 1 ? "" : "s"} active` +
        (activeLis === 0 ? " — every line item is paused/ended, which is why the campaign isn't delivering despite showing Active." : " — active line items exist but recorded no spend in this window (check budget pacing or creative approvals).")
      : "";

    // Explain WHY an active campaign has zero delivery using its planned flight
    // window vs the selected date range — a flight that ended before (or starts
    // after) the window is the most common, benign cause.
    let detail = `Active but zero spend in the selected window.${liNote || " Check insertion order flight dates and line item status."}`;
    if (win) {
      const winLabel = `${fmtFlightDate(win.startDate)} – ${fmtFlightDate(win.endDate)}`;
      if (c.flightEnd && c.flightEnd < win.startDate) {
        detail = `Flight ended ${fmtFlightDate(c.flightEnd)}, before your selected window (${winLabel}) — so zero delivery here is expected. Widen the date range to its flight period to see its spend.`;
      } else if (c.flightStart && c.flightStart > win.endDate) {
        detail = `Flight starts ${fmtFlightDate(c.flightStart)}, after your selected window (${winLabel}) — it hasn't begun delivering yet.`;
      } else if (c.flightStart || c.flightEnd) {
        const fl = `${fmtFlightDate(c.flightStart) ?? "—"} → ${fmtFlightDate(c.flightEnd) ?? "ongoing"}`;
        detail = `Active with a flight of ${fl} that overlaps your window, but zero spend.${liNote || " Check line-item status, budget pacing, or creative approvals."}`;
      }
    }
    return { kind: "noDelivery", severity: "high", label: "No delivery", detail, isSpike: false, sevRank: 3 };
  }
  if (c.dailyBudget && c.dailyBudget > 0) {
    const days = 7;
    const avgDaily = spend / days;
    if (avgDaily / c.dailyBudget > 1.10) {
      const pct = ((avgDaily - c.dailyBudget) / c.dailyBudget) * 100;
      return { kind: "overPacing", severity: "medium", label: "Over-pacing", detail: `~${formatMoney(avgDaily, currency, 0)}/day avg vs ${formatMoney(c.dailyBudget, currency, 0)}/day budget · +${Math.round(pct)}%.`, isSpike: false, sevRank: 2 };
    }
    if (avgDaily < c.dailyBudget * 0.70) {
      const pct = (avgDaily / c.dailyBudget) * 100;
      return { kind: "underPacing", severity: "medium", label: "Under-pacing", detail: `~${formatMoney(avgDaily, currency, 0)}/day avg vs ${formatMoney(c.dailyBudget, currency, 0)}/day budget · ${Math.round(pct)}% utilisation.`, isSpike: false, sevRank: 2 };
    }
    return { kind: "healthy", severity: "good", label: "On pace", detail: `Spending ~${formatMoney(avgDaily, currency, 0)}/day · within budget tolerance.`, isSpike: false, sevRank: 0 };
  }
  return { kind: "adSetLevel", severity: "info", label: "IO-level budget", detail: `Spend managed at insertion-order level. Total: ${formatMoney(spend, currency, 0)} in window.`, isSpike: false, sevRank: 1 };
}

function buildApplyActionForTip(
  tip: Tip,
  c: CampaignData,
  currency: string,
  budget: number,
  budgetType: string,
  aiSuggested: AiSuggestedAction | null,
): ApplyAction | null {
  // Only Meta campaign/adset-level mutations are supported here right now.
  // (DV360 needs lineItem/IO ids which the row-level campaign doesn't expose.)
  if (c.platform !== "meta") return null;
  const entityType = "campaign" as const;
  const base = {
    id: `apply-${c.platform}-${c.id}-${aiSuggested?.kind ?? tip.kind}`,
    platform: "meta" as const,
    entityType,
    entityId: c.id,
    entityName: c.name,
    reason: aiSuggested
      ? `AI recommendation (${tip.label}): ${tip.detail}`
      : `${tip.label}: ${tip.detail}`,
  };

  // Prefer AI's explicit recommendation when available — it's grounded in the
  // specific campaign data, not a blanket heuristic.
  if (aiSuggested) {
    if (aiSuggested.kind === "set_budget") {
      if (!budget || budgetType === "none") return null;
      const to = Math.max(1, Math.round(aiSuggested.to));
      if (to === Math.round(budget)) return null;
      return {
        ...base,
        kind: "set_budget",
        budgetType: budgetType === "lifetime" ? "lifetime" : "daily",
        from: Math.round(budget * 100),
        to: to * 100,
        currency,
      };
    }
    if (aiSuggested.kind === "set_status") {
      const currentActive = isActive(c);
      // Don't bother returning an action that's a no-op.
      if (aiSuggested.to === "PAUSED" && !currentActive) return null;
      if (aiSuggested.to === "ACTIVE" && currentActive) return null;
      return {
        ...base,
        kind: "set_status",
        from: currentActive ? "ACTIVE" : "PAUSED",
        to: aiSuggested.to,
      };
    }
    // Frequency cap at campaign level is a no-op on Meta (freq caps live on
    // ad sets). Fall through to heuristic in case the tip itself warrants one.
  }

  // Fall-back heuristics driven by the tip kind — used when AI hasn't yet
  // responded or didn't surface an apply-able recommendation.
  if (tip.kind === "spike" || tip.kind === "overPacing") {
    if (!budget || budgetType === "none") return null;
    const to = Math.max(1, Math.round(budget * 0.85));
    if (to === Math.round(budget)) return null;
    return {
      ...base,
      kind: "set_budget",
      budgetType: budgetType === "lifetime" ? "lifetime" : "daily",
      from: Math.round(budget * 100),
      to: to * 100,
      currency,
    };
  }

  if (tip.kind === "underPacing") {
    if (!budget || budgetType === "none") return null;
    const to = Math.max(1, Math.round(budget * 0.80));
    if (to === Math.round(budget)) return null;
    return {
      ...base,
      kind: "set_budget",
      budgetType: budgetType === "lifetime" ? "lifetime" : "daily",
      from: Math.round(budget * 100),
      to: to * 100,
      currency,
    };
  }

  if (tip.kind === "noDelivery") {
    return {
      ...base,
      kind: "set_status",
      from: "ACTIVE",
      to: "PAUSED",
    };
  }

  return null;
}

function TipCell({ tip, campaignContext, isDemo, platform, campaign, currency, budget, budgetType }: {
  tip: Tip;
  campaignContext: Record<string, unknown>;
  isDemo: boolean;
  platform: string;
  campaign: CampaignData;
  currency: string;
  budget: number;
  budgetType: string;
}) {
  // State: an AI-suggested action parsed from the "Ask AI" response. When
  // populated, buildApplyActionForTip prefers it over the heuristic — so the
  // "Set budget" button applies the AI's exact ₹ number (not a ±15% guess),
  // and a pause/resume rec gets wired to its matching Apply.
  const [aiSuggested, setAiSuggested] = useState<AiSuggestedAction | null>(null);
  const applyAction = isDemo
    ? null
    : buildApplyActionForTip(tip, campaign, currency, budget, budgetType, aiSuggested);
  const styles = {
    high:   { ring: "ring-red-200 bg-red-50",       pill: "bg-red-100 text-red-700",       Icon: AlertCircle,   iconClass: "text-red-600" },
    medium: { ring: "ring-yellow-200 bg-yellow-50", pill: "bg-yellow-100 text-yellow-700", Icon: tip.kind === "overPacing" ? TrendingUp : TrendingDown, iconClass: "text-yellow-600" },
    good:   { ring: "ring-green-200 bg-green-50",   pill: "bg-green-100 text-green-700",   Icon: CheckCircle2,  iconClass: "text-green-600" },
    info:   { ring: "ring-gray-200 bg-gray-50",     pill: "bg-gray-100 text-gray-600",     Icon: AlertCircle,   iconClass: "text-gray-400" },
  }[tip.severity];
  const { Icon } = styles;
  return (
    <div className={`flex items-start gap-2.5 rounded-lg px-3 py-2 ring-1 ${styles.ring}`}>
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${styles.iconClass}`} strokeWidth={2.2} />
      <div className="min-w-0 flex-1">
        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${styles.pill}`}>
          {tip.label}
        </span>
        <div className="text-[11px] text-gray-600 leading-snug mt-1">{tip.detail}</div>
        {tip.severity !== "info" && (
          <RowAiReco
            isDemo={isDemo}
            findingLabel={tip.label}
            findingDetail={tip.detail}
            campaignContext={campaignContext}
            platform={platform}
            onAiSuggestedAction={setAiSuggested}
          />
        )}
        {applyAction && (
          <div className="mt-2">
            <ApplyActionButton action={applyAction} compact />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Spend table — shared between Meta and DV360 sections
// ─────────────────────────────────────────────────────────────────────────────
interface SpendTableProps {
  rows: Array<{
    c: CampaignData;
    name: string;
    status: string;
    statusOrder: number;
    objective: string;
    budget: number;
    budgetType: string;
    spend: number;
    impressions: number;
    clicks: number;
    tip: Tip;
    tipSeverity: number;
  }>;
  currency: string;
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalCount: number;
  isDemo: boolean;
  platform: string;
  spikeNotice?: string | null;
  subtitle: string;
  /** When provided, each row gets a chevron that toggles a full-width panel
   *  rendered under the row. Used for DV360 to drill into IOs → LIs. */
  renderDrill?: (c: CampaignData) => React.ReactNode;
}

function SpendTable({ rows, currency, totalSpend, totalImpressions, totalClicks, totalCount, isDemo, platform, spikeNotice, subtitle, renderDrill }: SpendTableProps) {
  const { sorted, sort, toggle } = useSort(rows, "statusOrder", "asc");
  const finalSorted = useMemo(() => {
    if (sort.col !== "statusOrder") return sorted;
    return [...rows].sort((a, b) =>
      a.statusOrder !== b.statusOrder
        ? (sort.dir === "asc" ? a.statusOrder - b.statusOrder : b.statusOrder - a.statusOrder)
        : b.spend - a.spend
    );
  }, [sorted, rows, sort.col, sort.dir]);

  const cur = (n: number) => formatMoney(n, currency, 0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-200">
        <h3 className="text-sm font-bold text-gray-900">Spend by campaign</h3>
        <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>
        {spikeNotice && (
          <div className={`mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-[11px] font-semibold ${
            spikeNotice.startsWith("⚠") ? "bg-red-50 border-red-200 text-red-700" : "bg-green-50 border-green-200 text-green-700"
          }`}>
            {spikeNotice}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
            <tr>
              <SortTh col="name" sort={sort} onToggle={toggle} className="px-4 py-2 min-w-[200px]">Campaign</SortTh>
              <SortTh col="statusOrder" sort={sort} onToggle={toggle} className="px-4 py-2" align="center">Status</SortTh>
              <SortTh col="objective" sort={sort} onToggle={toggle} className="px-4 py-2">Objective</SortTh>
              <SortTh col="budget" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Budget (setting)</SortTh>
              <SortTh col="spend" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Spend</SortTh>
              <SortTh col="impressions" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Impressions</SortTh>
              <SortTh col="clicks" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Clicks</SortTh>
              <SortTh col="tipSeverity" sort={sort} onToggle={toggle} className="px-4 py-2 min-w-[300px]">Recommend</SortTh>
              {renderDrill && <th className="px-2 py-2 w-8"></th>}
            </tr>
          </thead>
          <tbody>
            {finalSorted.map((r) => (
              <Fragment key={`${r.c.platform}-${r.c.id}`}>
              <tr className="border-b border-gray-100 hover:bg-gray-50 align-top">
                <td className="px-4 py-2.5 font-mono text-gray-900 break-words max-w-[280px]" title={r.name}>{r.name}</td>
                <td className="px-4 py-2.5 text-center">{statusBadge(r.status)}</td>
                <td className="px-4 py-2.5 text-gray-700 text-xs">{r.objective}</td>
                <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">
                  {r.budgetType === "none" ? <span className="text-gray-400">—</span> : (
                    <>{cur(r.budget)}<span className="text-[10px] text-gray-400">/{r.budgetType === "daily" ? "day" : "life"}</span></>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">{cur(r.spend)}</td>
                <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">{fmtInt(r.impressions)}</td>
                <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">{fmtInt(r.clicks)}</td>
                <td className="px-4 py-2.5">
                  <TipCell
                    tip={r.tip}
                    isDemo={isDemo}
                    platform={platform}
                    campaign={r.c}
                    currency={currency}
                    budget={r.budget}
                    budgetType={r.budgetType}
                    campaignContext={{
                      name: r.name, status: r.status, objective: r.objective,
                      dailyBudget: r.budget, budgetType: r.budgetType,
                      // Current-window figures (what the picker shows).
                      window: { spend: r.spend, impressions: r.c.impressions ?? 0, clicks: r.c.clicks ?? 0, conversions: r.c.conversions ?? 0 },
                      spend: r.spend, impressions: r.c.impressions ?? 0,
                      clicks: r.c.clicks ?? 0, conversions: r.c.conversions ?? 0,
                      conversionValue: r.c.conversionValue ?? 0, currency,
                      ...(r.c.flightStart ? { flightStart: r.c.flightStart } : {}),
                      ...(r.c.flightEnd ? { flightEnd: r.c.flightEnd } : {}),
                      // Full campaign history (date-range independent) — recommendations
                      // must be based on THIS so advice stays stable across 7d/30d/90d.
                      ...(platform === "dv360" && (r.c.allTimeImpressions !== undefined || r.c.allTimeSpend !== undefined) ? {
                        fullHistory: {
                          note: "All-time delivery over the campaign's full flight (independent of the selected date range). Base the recommendation on this, not the current window.",
                          flightStart: r.c.flightStart, flightEnd: r.c.flightEnd,
                          spend: Math.round(r.c.allTimeSpend ?? 0),
                          impressions: r.c.allTimeImpressions ?? 0,
                          clicks: r.c.allTimeClicks ?? 0,
                          conversions: r.c.allTimeConversions ?? 0,
                          lifetimeBudget: r.c.lifetimeBudget ?? null,
                        },
                      } : {}),
                    }}
                  />
                </td>
                {renderDrill && (
                  <td className="px-2 py-2.5 text-center">
                    <button
                      onClick={() => toggleExpand(r.c.id)}
                      className="p-1 rounded hover:bg-gray-100 text-gray-500"
                      title={expanded.has(r.c.id) ? "Collapse" : "Expand insertion orders"}
                    >
                      {expanded.has(r.c.id)
                        ? <ChevronDown className="w-4 h-4" />
                        : <ChevronRight className="w-4 h-4" />}
                    </button>
                  </td>
                )}
              </tr>
              {renderDrill && expanded.has(r.c.id) && (
                <tr className="bg-gray-50/60 border-b border-gray-100">
                  <td colSpan={9} className="px-6 py-3">
                    {renderDrill(r.c)}
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 border-gray-200">
            <tr className="font-bold text-gray-900">
              <td className="px-4 py-2.5" colSpan={4}>Total ({totalCount} campaigns)</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">{cur(totalSpend)}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">{fmtInt(totalImpressions)}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">{fmtInt(totalClicks)}</td>
              <td className="px-4 py-2.5"></td>
              {renderDrill && <td></td>}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// META section — full pacing, daily trail, 6m avg, today's live spend
// ─────────────────────────────────────────────────────────────────────────────
function MetaBudgetSection({ campaigns, dateRange, currency }: { campaigns: CampaignData[]; dateRange?: string; currency: string }) {
  const { alertEmail, setAlertEmail, metaAccessToken, metaBusinessId } = useAuthStore();
  const isDemo = !metaAccessToken || isDemoCredential(metaAccessToken);
  const cur = (n: number) => formatMoney(n, currency, 0);

  const [statusFilter, setStatusFilter] = useState<"all" | "active">("all");
  const visible = useMemo(
    () => (statusFilter === "active" ? campaigns.filter(isActive) : campaigns),
    [campaigns, statusFilter]
  );

  // ── Rolling daily-spend trail → real 7d / 4w averages (pacing strip) ──────
  const [trail, setTrail] = useState<Record<string, { avg7d: number; avg14d: number; avg28d: number }>>({});
  useEffect(() => {
    if (!metaAccessToken) return;
    const ids = campaigns.filter((c) => c.platform === "meta" && !(c.id in trail)).map((c) => c.id);
    if (ids.length === 0) return;
    fetch("/api/naming/campaigns/daily-trail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, campaignIds: ids, businessId: metaBusinessId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.trails) return;
        const trailMap = data.trails as Record<string, Array<{ date: string; spend: number }>>;
        const dayMs = 86_400_000;
        let anchor: string | null = null;
        for (const days of Object.values(trailMap)) for (const d of days) if (!anchor || d.date > anchor) anchor = d.date;
        const derived: Record<string, { avg7d: number; avg14d: number; avg28d: number }> = {};
        for (const [id, days] of Object.entries(trailMap)) {
          const sumWindow = (startOff: number, endOff: number) => {
            if (!anchor) return 0;
            const a = new Date(`${anchor}T00:00:00Z`).getTime();
            const start = a - startOff * dayMs, end = a - endOff * dayMs;
            return days.reduce((s, d) => {
              const t = new Date(`${d.date}T00:00:00Z`).getTime();
              return t >= end && t <= start ? s + d.spend : s;
            }, 0);
          };
          derived[id] = { avg7d: sumWindow(0, 6) / 7, avg14d: sumWindow(7, 13) / 7, avg28d: sumWindow(0, 27) / 28 };
        }
        setTrail((prev) => ({ ...prev, ...derived }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAccessToken, metaBusinessId, campaigns.map((c) => c.id).join(",")]);

  // ── 6-month total spend → avg per month ─────────────────────────────────────
  const [spend6m, setSpend6m] = useState<number | null>(null);
  useEffect(() => {
    if (!metaAccessToken || !metaBusinessId) return;
    const today = new Date();
    const sixMonthsAgo = new Date(today);
    sixMonthsAgo.setDate(today.getDate() - 182);
    fetch("/api/naming/campaigns/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, businessId: metaBusinessId, startDate: sixMonthsAgo.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) }),
    })
      .then((r) => r.json())
      .then((data: CampaignData[]) => { if (Array.isArray(data)) setSpend6m(data.reduce((s, c) => s + (c.spend || 0), 0)); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAccessToken, metaBusinessId]);

  const avg6mPerMonth = spend6m !== null ? spend6m / 6 : null;

  // ── Today's spend so far ────────────────────────────────────────────────────
  const [spendToday, setSpendToday] = useState<number | null>(null);
  useEffect(() => {
    if (!metaAccessToken || !metaBusinessId) return;
    const today = new Date().toISOString().slice(0, 10);
    fetch("/api/naming/campaigns/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, businessId: metaBusinessId, startDate: today, endDate: today }),
    })
      .then((r) => r.json())
      .then((data: CampaignData[]) => { if (Array.isArray(data)) setSpendToday(data.reduce((s, c) => s + (c.spend || 0), 0)); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAccessToken, metaBusinessId]);

  // ── Last 3 months ──────────────────────────────────────────────────────────
  const [spend3m, setSpend3m] = useState<number | null>(null);
  useEffect(() => {
    if (!metaAccessToken || !metaBusinessId) return;
    const today = new Date();
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setDate(today.getDate() - 91);
    fetch("/api/naming/campaigns/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, businessId: metaBusinessId, startDate: threeMonthsAgo.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) }),
    })
      .then((r) => r.json())
      .then((data: CampaignData[]) => { if (Array.isArray(data)) setSpend3m(data.reduce((s, c) => s + (c.spend || 0), 0)); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAccessToken, metaBusinessId]);

  const totals = useMemo(() => {
    let spend = 0, impressions = 0, clicks = 0;
    for (const c of visible) { spend += c.spend || 0; impressions += c.impressions || 0; clicks += c.clicks || 0; }
    return { spend, impressions, clicks };
  }, [visible]);

  const budgetSetting = useMemo(() => {
    let daily = 0, lifetime = 0;
    for (const c of visible.filter(isActive)) {
      if (c.dailyBudget) daily += c.dailyBudget;
      else if (c.lifetimeBudget) lifetime += c.lifetimeBudget;
    }
    return { daily, lifetime };
  }, [visible]);

  const pacing = useMemo(() => {
    const activeCampaigns = visible.filter(isActive);
    let avg7d = 0, avg14d = 0, avg28d = 0;
    for (const c of activeCampaigns) {
      const t = trail[c.id];
      if (t) { avg7d += t.avg7d; avg14d += t.avg14d; avg28d += t.avg28d; }
    }
    const pacePct = budgetSetting.daily > 0 ? (avg7d / budgetSetting.daily) * 100 : null;
    const hasTrail = activeCampaigns.some((c) => c.id in trail);
    return { avg7d, avg14d, avg28d, pacePct, hasTrail };
  }, [visible, trail, budgetSetting.daily]);

  const rows = useMemo(
    () => visible.map((c) => {
      const spend = c.spend || 0;
      const tip = computeMetaTip(c, trail, currency);
      return {
        c, name: c.name, status: c.status || "—",
        statusOrder: isActive(c) ? 0 : 1,
        objective: c.objective || "—",
        budget: c.lifetimeBudget ?? c.dailyBudget ?? 0,
        budgetType: c.lifetimeBudget !== undefined ? "lifetime" : c.dailyBudget !== undefined ? "daily" : "none",
        spend, impressions: c.impressions || 0, clicks: c.clicks || 0, tip, tipSeverity: tip.sevRank,
      };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, trail, currency]
  );

  // Auto-send budget-spike emails
  const [spikeNotice, setSpikeNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!alertEmail) return;
    const spikes = rows.filter((r) => r.tip.isSpike);
    if (spikes.length === 0) return;
    const now = new Date();
    const yr = now.getUTCFullYear();
    const startOfYear = Date.UTC(yr, 0, 1);
    const wk = Math.ceil(((now.getTime() - startOfYear) / 86_400_000 + new Date(startOfYear).getUTCDay() + 1) / 7);
    const weekKey = `${yr}-W${String(wk).padStart(2, "0")}`;
    const toSend: typeof spikes = [];
    const dedupKeys: string[] = [];
    for (const r of spikes) {
      const k = `spike:${r.c.id}:${weekKey}`;
      try { if (localStorage.getItem(k)) continue; } catch {}
      toSend.push(r);
      dedupKeys.push(k);
    }
    if (toSend.length === 0) return;
    fetch("/api/alerts/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: alertEmail,
        periodLabel: "Budget spike alert",
        campaigns: toSend.map((r) => {
          const t = trail[r.c.id];
          const avg7 = t?.avg7d ?? 0;
          const avg14 = t?.avg14d ?? 0;
          const pct = avg14 > 0 ? Math.round(((avg7 - avg14) / avg14) * 100) : 0;
          return { name: r.c.name, objective: r.c.objective, budget: avg14, spend: avg7, spendPct: pct + 100, currency, status: `Budget spike (+${pct}%)` };
        }),
      }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, data: d })))
      .then(({ ok, data }) => {
        if (ok && data?.sent) {
          for (const k of dedupKeys) { try { localStorage.setItem(k, "1"); } catch {} }
          setSpikeNotice(`✓ Sent budget-spike alert for ${toSend.length} campaign(s) to ${alertEmail}`);
          setTimeout(() => setSpikeNotice(null), 8000);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, alertEmail]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-gray-200">
          {(["all", "active"] as const).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`px-3 py-1.5 text-xs font-semibold transition ${statusFilter === f ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              {f === "all" ? `All campaigns (${campaigns.length})` : `Active only (${campaigns.filter(isActive).length})`}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
          Spend matches Ads Manager for the window <AttributionInfo compact />
        </span>
      </div>

      {/* Spend card */}
      <div className="grid grid-cols-1 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-[11px] text-gray-500">Spend</div>
          <div className="text-xl font-bold text-gray-900 mt-0.5">{cur(totals.spend)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">Real, for the selected window</div>
        </div>
      </div>

      {/* Pacing strip */}
      {pacing.hasTrail && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-sm font-bold text-gray-900">Spend pacing</span>
            <span className="text-[11px] text-gray-400">· rolling 7 / 28-day, anchored to today</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div>
              <div className="text-[11px] text-gray-500">Today (so far)</div>
              {spendToday !== null ? (
                <>
                  <div className="text-xl font-bold text-blue-600">{cur(spendToday)}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">live · {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</div>
                </>
              ) : <div className="text-sm text-gray-400 mt-1">Loading…</div>}
            </div>
            <div>
              <div className="text-[11px] text-gray-500">Last 7-day avg</div>
              <div className="text-xl font-bold text-gray-900">{cur(pacing.avg7d)}<span className="text-xs text-gray-400 font-normal">/day</span></div>
              {pacing.avg14d > 0 && <div className="text-[10px] text-gray-400 mt-0.5">prev 7d: {cur(pacing.avg14d)}/day</div>}
            </div>
            <div>
              <div className="text-[11px] text-gray-500">Last 4-week avg</div>
              <div className="text-xl font-bold text-gray-900">{cur(pacing.avg28d * 7)}<span className="text-xs text-gray-400 font-normal">/wk</span></div>
              <div className="text-[10px] text-gray-400 mt-0.5">{cur(pacing.avg28d)}/day avg</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">6-month avg</div>
              {avg6mPerMonth !== null ? (
                <>
                  <div className="text-xl font-bold text-gray-900">{cur(avg6mPerMonth)}<span className="text-xs text-gray-400 font-normal">/mo</span></div>
                  <div className="text-[10px] text-gray-400 mt-0.5">total spend last 182 days ÷ 6</div>
                </>
              ) : <div className="text-sm text-gray-400 mt-1">Loading…</div>}
            </div>
            <div>
              <div className="text-[11px] text-gray-500">Weekly budget (setting)</div>
              <div className="text-xl font-bold text-gray-900">
                {budgetSetting.daily > 0 ? <>{cur(budgetSetting.daily * 7)}<span className="text-xs text-gray-400 font-normal">/wk</span></> : <span className="text-gray-400 text-sm">ad-set level</span>}
              </div>
              <div className="text-[10px] text-gray-400">live config × 7</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">Pace (7d vs budget)</div>
              {pacing.pacePct !== null ? (
                <>
                  <div className={`text-xl font-bold ${pacing.pacePct > 110 ? "text-red-600" : pacing.pacePct < 70 ? "text-yellow-600" : "text-green-600"}`}>
                    {Math.round(pacing.pacePct)}%
                  </div>
                  <span className={`inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    pacing.pacePct > 110 ? "bg-red-100 text-red-700" : pacing.pacePct < 70 ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"
                  }`}>
                    {pacing.pacePct > 110 ? "Over budget" : pacing.pacePct < 70 ? "Under-pacing" : "On budget"}
                  </span>
                </>
              ) : <div className="text-sm text-gray-400">— no daily budget</div>}
            </div>
          </div>
        </div>
      )}

      {/* Budget setting reference */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-xs text-gray-600">
        <span className="font-semibold text-gray-700">Current budget setting</span> (live config, not date-scoped):{" "}
        {budgetSetting.daily > 0 && <span className="font-semibold text-gray-900">{cur(budgetSetting.daily)}/day</span>}
        {budgetSetting.daily > 0 && budgetSetting.lifetime > 0 && " · "}
        {budgetSetting.lifetime > 0 && <span className="font-semibold text-gray-900">{cur(budgetSetting.lifetime)} lifetime</span>}
        {budgetSetting.daily === 0 && budgetSetting.lifetime === 0 && <span className="text-gray-400">— budgets set at ad-set level</span>}
        <span className="text-gray-400"> · across active campaigns. This is the configured budget, not spend.</span>
      </div>

      {/* Spend table */}
      <SpendTable
        rows={rows}
        currency={currency}
        totalSpend={totals.spend}
        totalImpressions={totals.impressions}
        totalClicks={totals.clicks}
        totalCount={visible.length}
        isDemo={isDemo}
        platform="meta"
        spikeNotice={spikeNotice}
        subtitle="Real per-campaign delivery for the window — mirrors a Meta Ads Manager export."
      />

      {/* Drill tree */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-5 py-3 border-b border-gray-200">
          <h3 className="text-sm font-bold text-gray-900">Drill into campaigns → ad sets → ads</h3>
        </div>
        <CampaignDrillTree campaigns={visible} currency={currency} />
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed px-1">
        This is a spend report — every figure is real data Meta returns for the selected window (spend, impressions, clicks, results via the Insights API). The &ldquo;Budget (setting)&rdquo; column is the live configured budget, not a projection.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DV360 section — spend totals + campaign table (no daily trail API)
// ─────────────────────────────────────────────────────────────────────────────
function resolveDvWindow(range?: string, customStart?: string, customEnd?: string): { startDate: string; endDate: string } {
  if (range === "custom" && customStart && customEnd) return { startDate: customStart, endDate: customEnd };
  const today = new Date();
  const start = new Date(today);
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  start.setDate(today.getDate() - days);
  return { startDate: start.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) };
}

// ── DV360 drill helpers (IO / LI tips + apply actions) ───────────────────────
const DV_ACTIVE = (s: string) => (s || "").toUpperCase() === "ENTITY_STATUS_ACTIVE";

function dateObjToIso(d?: { year?: number; month?: number; day?: number }): string | undefined {
  if (!d?.year || !d?.month || !d?.day) return undefined;
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** Return currently-active budget segment for an IO, else the first one. */
function activeIoSegment(io: DV360IoRaw): { amount: number; index: number; totalSegments: number } | null {
  const segs = io.budget?.budgetSegments ?? [];
  if (segs.length === 0) return null;
  const today = Date.now();
  let idx = segs.findIndex((s) => {
    const start = s.dateRange?.startDate;
    const end = s.dateRange?.endDate;
    if (!start?.year || !end?.year) return false;
    const sMs = new Date(start.year, (start.month ?? 1) - 1, start.day ?? 1).getTime();
    const eMs = new Date(end.year, (end.month ?? 1) - 1, end.day ?? 1).getTime();
    return sMs <= today && today <= eMs;
  });
  if (idx < 0) idx = 0;
  const micros = Number(segs[idx].budgetAmountMicros ?? "0");
  return { amount: micros / 1_000_000, index: idx, totalSegments: segs.length };
}

/** Compute a tip for an IO row from status + budget + spend window. */
function computeIoTip(io: DV360IoRaw, budget: number, spend: number): Tip {
  if (!DV_ACTIVE(io.entityStatus)) {
    return { kind: "paused", severity: "info", label: "Paused", detail: "Insertion order is not currently delivering.", isSpike: false, sevRank: 1 };
  }
  if (spend === 0 && budget > 0) {
    return { kind: "noDelivery", severity: "high", label: "No delivery", detail: "Active IO with budget but zero spend in the window. Check line-item status, flight dates, or creative approvals.", isSpike: false, sevRank: 3 };
  }
  if (budget > 0 && spend > budget * 1.10) {
    const pct = ((spend - budget) / budget) * 100;
    return { kind: "overPacing", severity: "medium", label: "Over-pacing", detail: `Spent past budget by ${Math.round(pct)}% in this window.`, isSpike: false, sevRank: 2 };
  }
  if (budget > 0 && spend > 0 && spend < budget * 0.70) {
    const pct = (spend / budget) * 100;
    return { kind: "underPacing", severity: "medium", label: "Under-pacing", detail: `Only ${Math.round(pct)}% of segment budget used.`, isSpike: false, sevRank: 2 };
  }
  return { kind: "healthy", severity: "good", label: "On pace", detail: budget > 0 ? "Within segment budget tolerance." : "Delivering — no segment budget cap defined.", isSpike: false, sevRank: 0 };
}

function buildIoApplyAction(
  io: DV360IoRaw,
  currency: string,
  reasonLabel: string,
  reasonDetail: string,
  aiSuggested: AiSuggestedAction | null,
): ApplyAction | null {
  const base = {
    id: `apply-dv360-io-${io.insertionOrderId}-${aiSuggested?.kind ?? "default"}`,
    platform: "dv360" as const,
    entityType: "insertion_order" as const,
    entityId: io.insertionOrderId,
    entityName: io.displayName,
    reason: aiSuggested
      ? `AI recommendation (${reasonLabel}): ${reasonDetail}`
      : `${reasonLabel}: ${reasonDetail}`,
  };
  const seg = activeIoSegment(io);
  if (aiSuggested) {
    if (aiSuggested.kind === "set_budget") {
      if (!seg) return null;
      const to = Math.max(1, Math.round(aiSuggested.to));
      if (to === Math.round(seg.amount)) return null;
      return {
        ...base,
        kind: "set_budget",
        budgetType: "lifetime",
        from: Math.round(seg.amount * 100),
        to: to * 100,
        currency,
      };
    }
    if (aiSuggested.kind === "set_status") {
      const currentActive = DV_ACTIVE(io.entityStatus);
      if (aiSuggested.to === "PAUSED" && !currentActive) return null;
      if (aiSuggested.to === "ACTIVE" && currentActive) return null;
      return {
        ...base,
        kind: "set_status",
        from: currentActive ? "ACTIVE" : "PAUSED",
        to: aiSuggested.to,
      };
    }
    // Frequency cap: IO level isn't supported — fall through.
    return null;
  }
  return null;
}

function buildLiApplyActions(
  li: DV360LiRaw,
  currency: string,
  reasonLabel: string,
  reasonDetail: string,
  aiSuggested: AiSuggestedAction | null,
): ApplyAction[] {
  const base = {
    platform: "dv360" as const,
    entityType: "lineitem" as const,
    entityId: li.lineItemId,
    entityName: li.displayName,
    reason: aiSuggested
      ? `AI recommendation (${reasonLabel}): ${reasonDetail}`
      : `${reasonLabel}: ${reasonDetail}`,
  };
  const out: ApplyAction[] = [];
  if (aiSuggested?.kind === "set_status") {
    const currentActive = DV_ACTIVE(li.entityStatus);
    if (!(aiSuggested.to === "PAUSED" && !currentActive) &&
        !(aiSuggested.to === "ACTIVE" && currentActive)) {
      out.push({
        ...base,
        id: `apply-dv360-li-${li.lineItemId}-status`,
        kind: "set_status",
        from: currentActive ? "ACTIVE" : "PAUSED",
        to: aiSuggested.to,
      });
    }
  }
  if (aiSuggested?.kind === "set_frequency_cap") {
    const current = li.frequencyCap?.unlimited
      ? null
      : li.frequencyCap?.maxImpressions && li.frequencyCap?.timeUnitCount
      ? { impressions: li.frequencyCap.maxImpressions, days: li.frequencyCap.timeUnitCount }
      : null;
    out.push({
      ...base,
      id: `apply-dv360-li-${li.lineItemId}-freq`,
      kind: "set_frequency_cap",
      from: current,
      to: { impressions: aiSuggested.impressions, days: aiSuggested.days },
    });
  }
  if (aiSuggested?.kind === "set_budget") {
    const currentMicros = Number(li.budget?.budgetAmountMicros ?? li.budget?.maxAmount ?? "0");
    const currentMajor = currentMicros / 1_000_000;
    const to = Math.max(1, Math.round(aiSuggested.to));
    if (to !== Math.round(currentMajor)) {
      out.push({
        ...base,
        id: `apply-dv360-li-${li.lineItemId}-budget`,
        kind: "set_budget",
        budgetType: "lifetime",
        from: Math.round(currentMajor * 100),
        to: to * 100,
        currency,
      });
    }
  }
  return out;
}

function fmtDvDate(d?: { year?: number; month?: number; day?: number }): string {
  const iso = dateObjToIso(d);
  if (!iso) return "—";
  try { return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
}

function liTypeLabel(t?: string): string {
  if (!t) return "—";
  return t.replace("LINE_ITEM_TYPE_", "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function bidStrategyLabel(bs?: Record<string, unknown>): string {
  if (!bs) return "—";
  if (bs.fixedBid) return "Fixed CPM";
  if (bs.maximizeSpendAutoBid) return "Maximize spend";
  if (bs.performanceGoalAutoBid) return "Performance goal";
  if (bs.youtubeAndPartnersBid) return "YouTube bid";
  return "—";
}

function DV360LiRow({ li, currency, isDemo }: { li: DV360LiRaw; currency: string; isDemo: boolean }) {
  const [aiSuggested, setAiSuggested] = useState<AiSuggestedAction | null>(null);
  const active = DV_ACTIVE(li.entityStatus);
  const freq = li.frequencyCap;
  const freqLabel = freq?.unlimited
    ? "Unlimited"
    : freq?.maxImpressions && freq?.timeUnitCount
    ? `${freq.maxImpressions} / ${freq.timeUnitCount} ${(freq.timeUnit ?? "TIME_UNIT_DAYS").replace("TIME_UNIT_", "").toLowerCase()}`
    : "—";
  const tip: Tip = active
    ? { kind: "healthy", severity: "info", label: liTypeLabel(li.lineItemType), detail: `Bid: ${bidStrategyLabel(li.bidStrategy)} · Freq cap: ${freqLabel}`, isSpike: false, sevRank: 0 }
    : { kind: "paused", severity: "info", label: "Paused", detail: "Line item is not delivering.", isSpike: false, sevRank: 1 };

  const applyActions = isDemo ? [] : buildLiApplyActions(li, currency, tip.label, tip.detail, aiSuggested);

  return (
    <tr className="border-b border-gray-100 hover:bg-white align-top">
      <td className="pl-10 pr-3 py-2 font-mono text-[12px] text-gray-800 max-w-[280px] break-words" title={li.displayName}>{li.displayName}</td>
      <td className="px-3 py-2 text-center">{statusBadge(li.entityStatus)}</td>
      <td className="px-3 py-2 text-[11px] text-gray-700 whitespace-nowrap">{liTypeLabel(li.lineItemType)}</td>
      <td className="px-3 py-2 text-[11px] text-gray-700 whitespace-nowrap">{bidStrategyLabel(li.bidStrategy)}</td>
      <td className="px-3 py-2 text-[11px] text-gray-700 whitespace-nowrap">
        {fmtDvDate(li.flight?.dateRange?.startDate)} → {fmtDvDate(li.flight?.dateRange?.endDate)}
      </td>
      <td className="px-3 py-2 text-[11px] text-gray-700 whitespace-nowrap">{freqLabel}</td>
      <td className="px-3 py-2">
        <div className="space-y-1.5">
          <RowAiReco
            isDemo={isDemo}
            findingLabel={`DV360 Line Item — ${li.displayName}`}
            findingDetail={`Status ${li.entityStatus}. Line item type: ${liTypeLabel(li.lineItemType)}. Bid strategy: ${bidStrategyLabel(li.bidStrategy)}. Frequency cap: ${freqLabel}. For DV360 Line Items the applyable actions are: pause/resume, set a frequency cap (e.g. "Cap frequency to 3 impressions per 7 days"), or adjust the Line Item budget. Use DV360-native terminology — "Line Item", "Frequency Cap", "Bid Strategy" — NOT Meta terms.`}
            campaignContext={{
              platform: "dv360", entityType: "lineitem",
              name: li.displayName, status: li.entityStatus,
              lineItemType: li.lineItemType, bidStrategy: bidStrategyLabel(li.bidStrategy),
              flightStart: dateObjToIso(li.flight?.dateRange?.startDate),
              flightEnd: dateObjToIso(li.flight?.dateRange?.endDate),
              frequencyCap: freqLabel,
              currency,
            }}
            platform="dv360"
            onAiSuggestedAction={setAiSuggested}
          />
          {applyActions.map((a) => (
            <div key={a.id}><ApplyActionButton action={a} compact /></div>
          ))}
        </div>
      </td>
    </tr>
  );
}

function DV360IoDrill({ io, currency, isDemo, lis }: { io: DV360IoRaw; currency: string; isDemo: boolean; lis: DV360LiRaw[] }) {
  const [expanded, setExpanded] = useState(false);
  const [aiSuggested, setAiSuggested] = useState<AiSuggestedAction | null>(null);
  const seg = activeIoSegment(io);
  const budget = seg?.amount ?? 0;
  const spend = 0; // Entity endpoint doesn't return spend; see known gaps below.
  const tip = computeIoTip(io, budget, spend);
  const action = isDemo
    ? null
    : buildIoApplyAction(io, currency, tip.label, tip.detail, aiSuggested);

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-white align-top">
        <td className="pl-4 pr-3 py-2 font-mono text-[12px] text-gray-900 max-w-[280px] break-words" title={io.displayName}>
          <div className="flex items-start gap-2">
            <button onClick={() => setExpanded((v) => !v)} className="p-0.5 rounded hover:bg-gray-100 text-gray-500 mt-0.5">
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            <span>{io.displayName}</span>
          </div>
        </td>
        <td className="px-3 py-2 text-center">{statusBadge(io.entityStatus)}</td>
        <td className="px-3 py-2 text-right text-[11px] text-gray-700 whitespace-nowrap">
          {budget > 0 ? formatMoney(budget, currency, 0) : <span className="text-gray-400">—</span>}
          {seg && seg.totalSegments > 1 && <div className="text-[10px] text-gray-400">seg {seg.index + 1} of {seg.totalSegments}</div>}
        </td>
        <td className="px-3 py-2 text-right text-[11px] text-gray-700 whitespace-nowrap">
          <span className="text-gray-400">—</span>
        </td>
        <td className="px-3 py-2 text-[11px] text-gray-700 whitespace-nowrap">
          {lis.length} line item{lis.length === 1 ? "" : "s"}
        </td>
        <td className="px-3 py-2">
          <div className="space-y-1.5">
            <RowAiReco
              isDemo={isDemo}
              findingLabel={`DV360 Insertion Order — ${io.displayName}`}
              findingDetail={`Status ${io.entityStatus}. Current active budget segment: ${budget > 0 ? formatMoney(budget, currency, 0) : "none"}. Applyable actions on an IO: change the current budget-segment amount, pause, or resume. Frequency caps are set at the Line Item level, not the IO level. Use DV360 UI terminology — "Insertion Order", "budget segment" — NOT Meta terms.`}
              campaignContext={{
                platform: "dv360", entityType: "insertion_order",
                name: io.displayName, status: io.entityStatus,
                currentSegmentBudget: budget, segments: io.budget?.budgetSegments?.length ?? 0,
                lineItemCount: lis.length, currency,
              }}
              platform="dv360"
              onAiSuggestedAction={setAiSuggested}
            />
            {action && <ApplyActionButton action={action} compact />}
          </div>
        </td>
      </tr>
      {expanded && lis.length > 0 && (
        <tr className="bg-white border-b border-gray-100">
          <td colSpan={6} className="p-0">
            <table className="w-full text-[12px]">
              <thead className="bg-gray-100/60 text-[10px] uppercase text-gray-500">
                <tr>
                  <th className="pl-10 pr-3 py-1.5 text-left">Line Item</th>
                  <th className="px-3 py-1.5 text-center">Status</th>
                  <th className="px-3 py-1.5 text-left">Type</th>
                  <th className="px-3 py-1.5 text-left">Bid strategy</th>
                  <th className="px-3 py-1.5 text-left">Flight</th>
                  <th className="px-3 py-1.5 text-left">Freq cap</th>
                  <th className="px-3 py-1.5 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {lis.map((li) => <DV360LiRow key={li.lineItemId} li={li} currency={currency} isDemo={isDemo} />)}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function DV360CampaignDrill({ campaign, currency, isDemo }: { campaign: CampaignData; currency: string; isDemo: boolean }) {
  const { ios, lis, loading, error, iosForCampaign, lisForIo } = useDV360Entities();
  if (isDemo) {
    return <div className="text-[11px] text-gray-500 italic">Insertion-order drill is only available with a live DV360 connection.</div>;
  }
  if (loading && !ios) {
    return <div className="flex items-center gap-2 text-[11px] text-gray-500"><Loader2 className="w-3 h-3 animate-spin" /> Loading insertion orders & line items…</div>;
  }
  if (error) {
    return <div className="text-[11px] text-red-700">Couldn&apos;t load DV360 entities: {error}</div>;
  }
  const campaignIos = iosForCampaign(campaign.id);
  if (campaignIos.length === 0) {
    return <div className="text-[11px] text-gray-500 italic">No insertion orders returned for this campaign{lis ? "" : " (data still loading)"}.</div>;
  }
  return (
    <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
      <table className="w-full text-[12px]">
        <thead className="bg-gray-100 text-[10px] uppercase text-gray-500">
          <tr>
            <th className="pl-4 pr-3 py-2 text-left">Insertion Order</th>
            <th className="px-3 py-2 text-center">Status</th>
            <th className="px-3 py-2 text-right">Active segment budget</th>
            <th className="px-3 py-2 text-right">Spend</th>
            <th className="px-3 py-2 text-left">Line items</th>
            <th className="px-3 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {campaignIos.map((io) => (
            <DV360IoDrill
              key={io.insertionOrderId}
              io={io}
              currency={currency}
              isDemo={isDemo}
              lis={lisForIo(io.insertionOrderId)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DV360BudgetSection({ campaigns, currency, dateRange, customStart, customEnd }: { campaigns: CampaignData[]; currency: string; dateRange?: string; customStart?: string; customEnd?: string }) {
  const { dv360RefreshToken } = useAuthStore();
  const isDemo = !dv360RefreshToken || isDemoCredential(dv360RefreshToken);
  const cur = (n: number) => formatMoney(n, currency, 0);
  const dvWindow = useMemo(() => resolveDvWindow(dateRange, customStart, customEnd), [dateRange, customStart, customEnd]);

  const [statusFilter, setStatusFilter] = useState<"all" | "active">("all");
  const visible = useMemo(
    () => (statusFilter === "active" ? campaigns.filter(isActive) : campaigns),
    [campaigns, statusFilter]
  );

  const totals = useMemo(() => {
    let spend = 0, impressions = 0, clicks = 0, conversions = 0;
    for (const c of visible) {
      spend += c.spend || 0;
      impressions += c.impressions || 0;
      clicks += c.clicks || 0;
      conversions += c.conversions || 0;
    }
    return { spend, impressions, clicks, conversions };
  }, [visible]);

  const budgetSetting = useMemo(() => {
    let daily = 0, lifetime = 0;
    for (const c of visible.filter(isActive)) {
      if (c.dailyBudget) daily += c.dailyBudget;
      else if (c.lifetimeBudget) lifetime += c.lifetimeBudget;
    }
    return { daily, lifetime };
  }, [visible]);

  const rows = useMemo(
    () => visible.map((c) => {
      const spend = c.spend || 0;
      const tip = computeDV360Tip(c, currency, dvWindow);
      return {
        c, name: c.name, status: c.status || "—",
        statusOrder: isActive(c) ? 0 : 1,
        objective: c.objective || "—",
        budget: c.lifetimeBudget ?? c.dailyBudget ?? 0,
        budgetType: c.lifetimeBudget !== undefined ? "lifetime" : c.dailyBudget !== undefined ? "daily" : "none",
        spend, impressions: c.impressions || 0, clicks: c.clicks || 0, tip, tipSeverity: tip.sevRank,
      };
    }),
    [visible, currency, dvWindow]
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-gray-200">
          {(["all", "active"] as const).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`px-3 py-1.5 text-xs font-semibold transition ${statusFilter === f ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              {f === "all" ? `All campaigns (${campaigns.length})` : `Active only (${campaigns.filter(isActive).length})`}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
          Spend from Bid Manager report for the selected window
        </span>
      </div>

      {/* Spend card */}
      <div className="grid grid-cols-1 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-[11px] text-gray-500">Spend</div>
          <div className="text-xl font-bold text-gray-900 mt-0.5">{cur(totals.spend)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">Real, for the selected window</div>
        </div>
      </div>

      {/* Budget setting reference */}
      {(budgetSetting.daily > 0 || budgetSetting.lifetime > 0) && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-xs text-gray-600">
          <span className="font-semibold text-gray-700">Current budget setting</span> (live config):{" "}
          {budgetSetting.daily > 0 && <span className="font-semibold text-gray-900">{cur(budgetSetting.daily)}/day</span>}
          {budgetSetting.daily > 0 && budgetSetting.lifetime > 0 && " · "}
          {budgetSetting.lifetime > 0 && <span className="font-semibold text-gray-900">{cur(budgetSetting.lifetime)} lifetime</span>}
          <span className="text-gray-400"> · across active campaigns.</span>
        </div>
      )}

      {/* Spend table */}
      <SpendTable
        rows={rows}
        currency={currency}
        totalSpend={totals.spend}
        totalImpressions={totals.impressions}
        totalClicks={totals.clicks}
        totalCount={visible.length}
        isDemo={isDemo}
        platform="dv360"
        subtitle="Real per-campaign delivery from Bid Manager for the selected window. Expand a row to drill into insertion orders and line items."
        renderDrill={(c) => <DV360CampaignDrill campaign={c} currency={currency} isDemo={isDemo} />}
      />

      {/* Drill tree */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-5 py-3 border-b border-gray-200">
          <h3 className="text-sm font-bold text-gray-900">Drill into campaigns → insertion orders → line items</h3>
        </div>
        <CampaignDrillTree campaigns={visible} currency={currency} />
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed px-1">
        Every figure is real data from the DV360 Bid Manager API for the selected window. Daily-spend pacing is not available for DV360 — use the DV360 UI for intraday pacing.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export — renders per-platform sections
// ─────────────────────────────────────────────────────────────────────────────
export default function BudgetAllocationAudit({ campaigns, dateRange, customStart, customEnd, platform = "meta" }: AuditProps) {
  const metaCampaigns = campaigns.filter((c) => c.platform === "meta");
  const dv360Campaigns = campaigns.filter((c) => c.platform === "dv360");
  const metaCurrency = currencyFor(campaigns, "meta");
  const dv360Currency = currencyFor(campaigns, "dv360");

  if (campaigns.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
        No campaigns in this window. Adjust the date range above, or connect an ad account.
      </div>
    );
  }

  const showMeta = (platform === "meta" || platform === "both") && metaCampaigns.length > 0;
  const showDV360 = (platform === "dv360" || platform === "both") && dv360Campaigns.length > 0;

  return (
    <div className="space-y-8">
      {showMeta && (
        <section>
          {showDV360 && (
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 bg-blue-600 rounded-full" />
              <h2 className="text-base font-bold text-gray-900">Meta — Budget Allocation</h2>
            </div>
          )}
          <MetaBudgetSection campaigns={metaCampaigns} dateRange={dateRange} currency={metaCurrency} />
        </section>
      )}

      {showMeta && showDV360 && <hr className="border-gray-200" />}

      {showDV360 && (
        <section>
          {showMeta && (
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 bg-emerald-600 rounded-full" />
              <h2 className="text-base font-bold text-gray-900">DV360 — Budget Allocation</h2>
            </div>
          )}
          {!showMeta && platform === "dv360" && (
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 bg-emerald-600 rounded-full" />
              <h2 className="text-base font-bold text-gray-900">DV360 — Budget Allocation</h2>
            </div>
          )}
          <DV360BudgetSection campaigns={dv360Campaigns} currency={dv360Currency} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />
        </section>
      )}
    </div>
  );
}
