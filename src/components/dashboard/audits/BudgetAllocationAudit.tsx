import { useState, useMemo } from "react";
import type { AuditProps } from "./types";
import type { CampaignData } from "@/types";
import { useAuthStore } from "@/store/auth";
import CampaignDrillTree from "./CampaignDrillTree";
import AttributionInfo from "@/components/shared/AttributionInfo";
import { useSort } from "@/hooks/useSort";
import SortTh from "@/components/shared/SortTh";
import { detectCurrency, formatMoney } from "@/lib/currency";

/**
 * Budget Allocation = honest, date-range-scoped SPEND REPORT (Meta-export style).
 *
 * Shows ONLY data Meta actually returns for the selected window — real spend +
 * delivery metrics per campaign — plus the current budget SETTING as a labelled
 * reference. No projected "allocated" number, no Forecast, no Efficiency/Scaling
 * scores (all dropped — they weren't directly retrievable from Meta).
 *
 * The window is owned by the parent (AccountStructureTab's editable date range);
 * the `campaigns` prop already carries spend/impressions/clicks/conversions
 * scoped to that window via the reliable Insights edge.
 */

function fmtInt(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return Math.round(n).toLocaleString("en-IN");
}
function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function BudgetAllocationAudit({ campaigns, dateRange }: AuditProps) {
  const { alertEmail, setAlertEmail, monthlyBudget, setMonthlyBudget } = useAuthStore();
  const currency = detectCurrency(campaigns);

  const [statusFilter, setStatusFilter] = useState<"all" | "active">("all");
  const [emailDraft, setEmailDraft] = useState(alertEmail || "");
  const [budgetDraft, setBudgetDraft] = useState<string>(monthlyBudget ? String(monthlyBudget) : "");
  const [sendStatus, setSendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sendMessage, setSendMessage] = useState("");

  const isActive = (c: CampaignData) => {
    const s = (c.status || "").toUpperCase();
    return s === "ACTIVE" || s === "ENABLED";
  };

  const visible = useMemo(
    () => (statusFilter === "active" ? campaigns.filter(isActive) : campaigns),
    [campaigns, statusFilter]
  );

  // ── Real window totals (everything below is straight from Meta Insights) ──
  const totals = useMemo(() => {
    let spend = 0, impressions = 0, clicks = 0, conversions = 0, convValue = 0;
    for (const c of visible) {
      spend += c.spend || 0;
      impressions += c.impressions || 0;
      clicks += c.clicks || 0;
      conversions += c.conversions || 0;
      convValue += c.conversionValue || 0;
    }
    return {
      spend, impressions, clicks, conversions, convValue,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpr: conversions > 0 ? spend / conversions : 0,
    };
  }, [visible]);

  // Current budget SETTING (config snapshot, NOT date-scoped, NOT projected).
  const budgetSetting = useMemo(() => {
    let daily = 0, lifetime = 0;
    for (const c of visible.filter(isActive)) {
      if (c.dailyBudget) daily += c.dailyBudget;
      else if (c.lifetimeBudget) lifetime += c.lifetimeBudget;
    }
    return { daily, lifetime };
  }, [visible]);

  // Per-campaign rows for the Meta-export table.
  const rows = useMemo(
    () => visible.map((c) => {
      const spend = c.spend || 0;
      const impressions = c.impressions || 0;
      const clicks = c.clicks || 0;
      const conversions = c.conversions || 0;
      return {
        c,
        name: c.name,
        status: c.status || "—",
        objective: c.objective || "—",
        budget: c.lifetimeBudget ?? c.dailyBudget ?? 0,
        budgetType: c.lifetimeBudget !== undefined ? "lifetime" : c.dailyBudget !== undefined ? "daily" : "none",
        spend, impressions, clicks, conversions,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        results: conversions,
        cpr: conversions > 0 ? spend / conversions : 0,
      };
    }),
    [visible]
  );
  const { sorted, sort, toggle } = useSort(rows, "spend", "desc");

  const cur = (n: number) => formatMoney(n, currency, 0);

  // ── Email the spend summary (top spenders) via the existing alerts endpoint ──
  const handleSend = async () => {
    const email = emailDraft.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSendStatus("error"); setSendMessage("Enter a valid email address.");
      return;
    }
    const spenders = [...rows].filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend);
    if (spenders.length === 0) {
      setSendStatus("error"); setSendMessage("No spend in this window to report.");
      return;
    }
    setAlertEmail(email);
    setSendStatus("sending"); setSendMessage("");
    try {
      const r = await fetch("/api/alerts/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: email,
          periodLabel: "Spend report",
          campaigns: spenders.map((s) => ({
            name: s.name, objective: s.objective,
            budget: s.budget, spend: s.spend,
            spendPct: s.budget > 0 ? Math.round((s.spend / s.budget) * 100) : 0,
            currency: s.c.currency || currency,
            status: s.status,
          })),
        }),
      });
      const data = await r.json();
      if (r.ok && data.sent) { setSendStatus("sent"); setSendMessage(`Sent to ${email}.`); }
      else { setSendStatus("error"); setSendMessage(data.error || `HTTP ${r.status}`); }
    } catch (e) {
      setSendStatus("error"); setSendMessage(e instanceof Error ? e.message : String(e));
    }
  };

  if (campaigns.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
        No campaigns in this window. Adjust the date range above, or connect an ad account.
      </div>
    );
  }

  // Summary metric tiles — all REAL, date-scoped.
  const tiles: Array<{ label: string; value: string; sub?: string }> = [
    { label: "Spend", value: cur(totals.spend), sub: "Real, for the selected window" },
    { label: "Impressions", value: fmtInt(totals.impressions) },
    { label: "Clicks", value: fmtInt(totals.clicks), sub: `CTR ${totals.ctr.toFixed(2)}%` },
    { label: "Results (conversions)", value: fmtInt(totals.conversions), sub: totals.cpr > 0 ? `${cur(totals.cpr)} / result` : undefined },
    { label: "CPM", value: cur(totals.cpm) },
    { label: "CPC", value: totals.cpc > 0 ? formatMoney(totals.cpc, currency, 2) : "—" },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar: status filter + attribution chip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
          {(["all", "active"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 text-xs font-semibold transition ${statusFilter === f ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              {f === "all" ? `All campaigns (${campaigns.length})` : `Active only (${campaigns.filter(isActive).length})`}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
          Spend matches Ads Manager for the window <AttributionInfo compact />
        </span>
      </div>

      {/* Summary row — real window totals */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-[11px] text-gray-500">{t.label}</div>
            <div className="text-xl font-bold text-gray-900 mt-0.5">{t.value}</div>
            {t.sub && <div className="text-[10px] text-gray-400 mt-0.5">{t.sub}</div>}
          </div>
        ))}
      </div>

      {/* Budget SETTING reference — explicitly NOT a projection */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-xs text-gray-600">
        <span className="font-semibold text-gray-700">Current budget setting</span> (live config, not date-scoped):{" "}
        {budgetSetting.daily > 0 && <span className="font-semibold text-gray-900">{cur(budgetSetting.daily)}/day</span>}
        {budgetSetting.daily > 0 && budgetSetting.lifetime > 0 && " · "}
        {budgetSetting.lifetime > 0 && <span className="font-semibold text-gray-900">{cur(budgetSetting.lifetime)} lifetime</span>}
        {budgetSetting.daily === 0 && budgetSetting.lifetime === 0 && <span className="text-gray-400">— budgets set at ad-set level</span>}
        <span className="text-gray-400"> · across active campaigns. This is the configured budget, not spend.</span>
      </div>

      {/* Per-campaign Meta-export table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200">
          <h3 className="text-sm font-bold text-gray-900">Spend by campaign</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">Real per-campaign delivery for the window — mirrors a Meta Ads Manager export.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <SortTh col="name" sort={sort} onToggle={toggle} className="px-4 py-2 min-w-[200px]">Campaign</SortTh>
                <SortTh col="status" sort={sort} onToggle={toggle} className="px-4 py-2" align="center">Status</SortTh>
                <SortTh col="objective" sort={sort} onToggle={toggle} className="px-4 py-2">Objective</SortTh>
                <SortTh col="budget" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Budget (setting)</SortTh>
                <SortTh col="spend" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Spend</SortTh>
                <SortTh col="impressions" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Impressions</SortTh>
                <SortTh col="clicks" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Clicks</SortTh>
                <SortTh col="cpm" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">CPM</SortTh>
                <SortTh col="cpc" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">CPC</SortTh>
                <SortTh col="results" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Results</SortTh>
                <SortTh col="cpr" sort={sort} onToggle={toggle} className="px-4 py-2" align="right">Cost/result</SortTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={`${r.c.platform}-${r.c.id}`} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-gray-900 truncate max-w-[240px]" title={r.name}>{r.name}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${isActive(r.c) ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {isActive(r.c) ? "Active" : r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 text-xs">{r.objective}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">
                    {r.budgetType === "none" ? <span className="text-gray-400">ad-set</span> : (
                      <>{cur(r.budget)}<span className="text-[10px] text-gray-400">/{r.budgetType === "daily" ? "day" : "life"}</span></>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">{cur(r.spend)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{fmtInt(r.impressions)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{fmtInt(r.clicks)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">{r.impressions > 0 ? cur(r.cpm) : "—"}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">{r.clicks > 0 ? formatMoney(r.cpc, currency, 2) : "—"}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{r.results > 0 ? fmtInt(r.results) : "—"}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">{r.cpr > 0 ? cur(r.cpr) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr className="font-bold text-gray-900">
                <td className="px-4 py-2.5" colSpan={4}>Total ({visible.length} campaigns)</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">{cur(totals.spend)}</td>
                <td className="px-4 py-2.5 text-right">{fmtInt(totals.impressions)}</td>
                <td className="px-4 py-2.5 text-right">{fmtInt(totals.clicks)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">{totals.impressions > 0 ? cur(totals.cpm) : "—"}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">{totals.clicks > 0 ? formatMoney(totals.cpc, currency, 2) : "—"}</td>
                <td className="px-4 py-2.5 text-right">{fmtInt(totals.conversions)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">{totals.cpr > 0 ? cur(totals.cpr) : "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Campaign → ad set → ad drill (real hierarchy) */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200">
          <h3 className="text-sm font-bold text-gray-900">Drill into campaigns → ad sets → ads</h3>
        </div>
        <CampaignDrillTree campaigns={visible} currency={currency} />
      </div>

      {/* Monthly cap + email the spend report (kept config) */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Monthly cap &amp; email report</h3>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-gray-600">Monthly budget cap ({currency})</label>
            <input
              type="number" min={0} placeholder="e.g. 500000"
              value={budgetDraft}
              onChange={(e) => setBudgetDraft(e.target.value)}
              onBlur={() => { const n = parseFloat(budgetDraft); setMonthlyBudget(!isNaN(n) && n > 0 ? n : null); }}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {monthlyBudget ? (
              <span className="text-[10px] text-gray-500">
                Window spend is {Math.round((totals.spend / monthlyBudget) * 100)}% of the {cur(monthlyBudget)} cap.
              </span>
            ) : <span className="text-[10px] text-gray-400">Set a cap to track spend against it.</span>}
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
            <label className="text-[11px] font-semibold text-gray-600">Email this spend report</label>
            <div className="flex gap-2">
              <input
                type="email" placeholder="you@email.com"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSend}
                disabled={sendStatus === "sending"}
                className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
              >
                {sendStatus === "sending" ? "Sending…" : "Send report"}
              </button>
            </div>
            {sendMessage && (
              <span className={`text-[11px] ${sendStatus === "sent" ? "text-green-700" : sendStatus === "error" ? "text-red-600" : "text-gray-500"}`}>{sendMessage}</span>
            )}
          </div>
        </div>
      </div>

      {/* Honest footer */}
      <p className="text-[11px] text-gray-400 leading-relaxed px-1">
        This is a spend report — every figure is real data Meta returns for the selected window{dateRange === "custom" ? "" : ""} (spend, impressions, clicks, results via the Insights API). The &ldquo;Budget (setting)&rdquo; column is the live configured budget, not a projection. Projected &ldquo;allocated&rdquo;, forecast, efficiency and scaling scores were removed because Meta doesn&apos;t return them directly.
      </p>
    </div>
  );
}
