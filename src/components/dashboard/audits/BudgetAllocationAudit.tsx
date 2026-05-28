import { useState, useMemo } from "react";
import { Settings, Mail, MessageCircle, Send, CheckCircle2, AlertCircle } from "lucide-react";
import { KpiCard, AuditCard, StatusBadge } from "./AuditCard";
import { buildAccountContext, type AuditProps } from "./types";
import type { CampaignData } from "@/types";
import { useAuthStore } from "@/store/auth";

// ---------- helpers ----------

function formatCurrency(value: number | undefined, currency = "USD"): string {
  if (value === undefined || value === null || isNaN(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$${Math.round(value).toLocaleString()}`;
  }
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

function toneForSpendPct(pct: number): "good" | "warn" | "bad" {
  if (pct >= 70 && pct <= 95) return "good";
  if (pct >= 50 && pct < 70) return "warn";
  if (pct > 95 && pct <= 105) return "warn";
  return "bad";
}

function paceLabel(forecastPct: number): { label: string; tone: "good" | "warn" | "bad" } {
  if (forecastPct >= 95 && forecastPct <= 105) return { label: "On track", tone: "good" };
  if (forecastPct > 105) {
    return { label: `Overpacing by ${Math.round(forecastPct - 100)}%`, tone: "bad" };
  }
  return { label: `Underpacing by ${Math.round(100 - forecastPct)}%`, tone: "warn" };
}

function statusForCampaign(spendPct: number, pacePct: number): {
  label: string;
  status: "pass" | "warn" | "fail" | "info";
} {
  if (pacePct > 110) return { label: "Overspending", status: "fail" };
  if (pacePct < 80) return { label: "Underspending", status: "warn" };
  if (spendPct >= 95) return { label: "Near cap", status: "warn" };
  return { label: "On track", status: "pass" };
}

// ---------- period selector config (from the wireframe) ----------

type Granularity = "daily" | "weekly" | "monthly";

interface PeriodOption {
  label: string;
  days: number;
}

const PERIOD_OPTIONS: Record<Granularity, PeriodOption[]> = {
  daily: [
    { label: "7 Days", days: 7 },
    { label: "15 Days", days: 15 },
    { label: "30 Days", days: 30 },
    { label: "90 Days", days: 90 },
    { label: "Half a year", days: 182 },
    { label: "365 Days", days: 365 },
  ],
  weekly: [
    { label: "4 Weeks", days: 28 },
    { label: "12 Weeks", days: 84 },
    { label: "21 Weeks", days: 147 },
    { label: "52 Weeks", days: 364 },
  ],
  monthly: [
    { label: "Last Quarter", days: 90 },
    { label: "Last half Year", days: 182 },
    { label: "Last year", days: 365 },
  ],
};

const GRANULARITY_LABEL: Record<Granularity, string> = {
  daily: "Daily Budget",
  weekly: "Weekly Budget",
  monthly: "Monthly Budget",
};

// ---------- per-campaign budget row computation ----------

function campaignBudget(c: CampaignData, periodDays: number): number {
  if (c.lifetimeBudget !== undefined) return c.lifetimeBudget;
  if (c.dailyBudget !== undefined) return c.dailyBudget * periodDays;
  return 0;
}

// ---------- component ----------

export default function BudgetAllocationAudit({ campaigns }: AuditProps) {
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [periodIdx, setPeriodIdx] = useState(2); // default "30 Days"

  // Alert email state (persisted in store) + send-status for the button.
  const { alertEmail, setAlertEmail } = useAuthStore();
  const [emailDraft, setEmailDraft] = useState(alertEmail || "");
  const [sendStatus, setSendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sendMessage, setSendMessage] = useState<string>("");

  const periodOptions = PERIOD_OPTIONS[granularity];
  const safeIdx = Math.min(periodIdx, periodOptions.length - 1);
  const periodDays = periodOptions[safeIdx].days;
  const periodLabel = periodOptions[safeIdx].label;

  // We're (proxy) halfway through the cycle → forecast = spend × 2.
  const ELAPSED_FRACTION = 0.5;

  const activeCampaigns = useMemo(
    () => campaigns.filter((c) => c.status === "ACTIVE" || c.status === "ENABLED"),
    [campaigns]
  );

  const totalBudget = activeCampaigns.reduce((sum, c) => sum + campaignBudget(c, periodDays), 0);
  const totalSpend = activeCampaigns.reduce((sum, c) => sum + (c.spend || 0), 0);
  const totalConversionValue = activeCampaigns.reduce((sum, c) => sum + (c.conversionValue || 0), 0);

  const spendPct = totalBudget > 0 ? (totalSpend / totalBudget) * 100 : 0;
  const remainingBudget = totalBudget - totalSpend;
  const forecastedSpend = ELAPSED_FRACTION > 0 ? totalSpend / ELAPSED_FRACTION : 0;
  const forecastPctOfBudget = totalBudget > 0 ? (forecastedSpend / totalBudget) * 100 : 0;
  const avgDailySpend = periodDays > 0 ? totalSpend / (periodDays * ELAPSED_FRACTION) : 0;

  // Budget Efficiency Score = Σ(ROAS_i × spend_i) / Σ(spend_i), normalised to 0–100.
  let weightedRoas = 0;
  let spendForEfficiency = 0;
  for (const c of activeCampaigns) {
    if (c.spend && c.spend > 0 && c.conversionValue !== undefined) {
      const roas = c.conversionValue / c.spend;
      weightedRoas += roas * c.spend;
      spendForEfficiency += c.spend;
    }
  }
  const efficiencyRaw = spendForEfficiency > 0 ? weightedRoas / spendForEfficiency : 0;
  const efficiencyScore = Math.min(100, Math.round((efficiencyRaw / 5) * 100));

  const roasValues = activeCampaigns
    .filter((c) => c.spend && c.conversionValue !== undefined)
    .map((c) => (c.conversionValue || 0) / (c.spend || 1))
    .sort((a, b) => a - b);
  const medianRoas = roasValues.length > 0 ? roasValues[Math.floor(roasValues.length / 2)] : 0;

  const scalable = activeCampaigns.filter((c) => {
    if (!c.spend || c.conversionValue === undefined) return false;
    const roas = c.conversionValue / c.spend;
    if (roas <= medianRoas) return false;
    if (c.impressionShare !== undefined && c.impressionShare >= 80) return false;
    return true;
  }).length;
  const scalingScore = activeCampaigns.length > 0 ? Math.round((scalable / activeCampaigns.length) * 100) : 0;

  const currency = activeCampaigns.find((c) => c.currency)?.currency || "USD";
  const pace = paceLabel(forecastPctOfBudget);

  const hasBudgetData = activeCampaigns.some(
    (c) => c.dailyBudget !== undefined || c.lifetimeBudget !== undefined || c.spend !== undefined
  );

  const accountContext = buildAccountContext(campaigns);
  const siblingMetricsAccount: Record<string, string | number> = {
    "Period": `${periodLabel} (${periodDays}d)`,
    "Total Budget": formatCurrency(totalBudget, currency),
    "Spend %": `${Math.round(spendPct)}%`,
    "Remaining Budget": formatCurrency(remainingBudget, currency),
    "Forecasted Spend": formatCurrency(forecastedSpend, currency),
    "Forecast vs Budget": `${Math.round(forecastPctOfBudget)}%`,
    "Budget Efficiency Score": `${efficiencyScore}/100`,
    "Scaling Opportunity": `${scalingScore}%`,
    "Active Campaigns": activeCampaigns.length,
    "Currency": currency,
  };

  // ---------- campaign rows (shared shape for both tables) ----------
  const allRows = useMemo(() => {
    const now = Date.now();
    const periodMs = periodDays * 24 * 60 * 60 * 1000;
    return campaigns
      .map((c) => {
        const budget = campaignBudget(c, periodDays);
        const spend = c.spend || 0;
        const campSpendPct = budget > 0 ? (spend / budget) * 100 : 0;
        const campPacePct = ELAPSED_FRACTION > 0 ? campSpendPct / ELAPSED_FRACTION : 0;
        const isPaused = c.status !== "ACTIVE" && c.status !== "ENABLED";
        const status = isPaused
          ? { label: "Paused", status: "info" as const }
          : statusForCampaign(campSpendPct, campPacePct);
        const created = c.createdTime ? new Date(c.createdTime).getTime() : NaN;
        const isNew = !isNaN(created) && now - created <= periodMs;
        return { campaign: c, budget, spend, spendPct: campSpendPct, pacePct: campPacePct, status, isNew };
      })
      .sort((a, b) => b.spendPct - a.spendPct);
  }, [campaigns, periodDays]);

  const newRows = allRows.filter((r) => r.isNew);

  // Critical = campaigns whose status the audit flags as "fail" (Overspending).
  // These are the rows that justify firing an alert email.
  const criticalRows = allRows.filter((r) => r.status.status === "fail");

  // Save email + fire the alert email via /api/alerts/budget.
  const handleSendAlerts = async () => {
    const trimmed = emailDraft.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setSendStatus("error");
      setSendMessage("Please enter a valid email address.");
      return;
    }
    if (criticalRows.length === 0) {
      setSendStatus("error");
      setSendMessage("No critical campaigns to alert on.");
      return;
    }
    setAlertEmail(trimmed);
    setSendStatus("sending");
    setSendMessage("");
    try {
      const r = await fetch("/api/alerts/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: trimmed,
          periodLabel: `${GRANULARITY_LABEL[granularity]} · ${periodLabel}`,
          campaigns: criticalRows.map(({ campaign, budget, spend, spendPct, status }) => ({
            name: campaign.name,
            objective: campaign.objective,
            budget,
            spend,
            spendPct,
            currency: campaign.currency || currency,
            status: status.label,
          })),
        }),
      });
      const data = await r.json();
      if (r.ok && data.sent) {
        setSendStatus("sent");
        setSendMessage(`Alert sent to ${trimmed}.`);
      } else {
        setSendStatus("error");
        setSendMessage(data.error || `HTTP ${r.status}`);
      }
    } catch (e) {
      setSendStatus("error");
      setSendMessage(e instanceof Error ? e.message : String(e));
    }
  };

  // ---------- reusable table renderer ----------
  const renderTable = (rows: typeof allRows, emptyMsg: string) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-2 text-left font-semibold text-gray-700">Campaign Name</th>
            <th className="px-4 py-2 text-left font-semibold text-gray-700">Objective</th>
            <th className="px-4 py-2 text-left font-semibold text-gray-700">Start / End</th>
            <th className="px-4 py-2 text-left font-semibold text-gray-700">Budget Allocated vs Spend</th>
            <th className="px-4 py-2 text-left font-semibold text-gray-700">Remarks</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-gray-500">{emptyMsg}</td>
            </tr>
          ) : (
            rows.slice(0, 30).map(({ campaign, budget, spend, spendPct: sPct, status }) => (
              <tr key={`${campaign.platform}-${campaign.id}`} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                <td className="px-4 py-3 font-mono text-gray-900 max-w-[220px] truncate" title={campaign.name}>
                  {campaign.name}
                </td>
                <td className="px-4 py-3 text-gray-700">{campaign.objective || "—"}</td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                  {formatDate(campaign.createdTime)}
                  <span className="text-gray-400"> → </span>
                  <span className={campaign.endTime ? "text-gray-700" : "text-gray-500"}>
                    {campaign.endTime ? formatDate(campaign.endTime) : "Ongoing"}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-900 min-w-[180px]">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">{budget > 0 ? formatCurrency(budget, campaign.currency || currency) : "—"}</span>
                    <span className="text-gray-500">{spend > 0 ? formatCurrency(spend, campaign.currency || currency) : "—"}</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
                    <div
                      className={`h-full ${sPct > 105 ? "bg-red-500" : sPct >= 70 ? "bg-green-500" : "bg-yellow-400"}`}
                      style={{ width: `${Math.min(100, Math.round(sPct))}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{budget > 0 ? `${Math.round(sPct)}% spent` : "no budget data"}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={status.status} label={status.label} />
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-400">
                    <span className="inline-flex items-center gap-0.5"><Mail className="w-3 h-3" /> Email</span>
                    <span className="inline-flex items-center gap-0.5"><MessageCircle className="w-3 h-3" /> WhatsApp</span>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      {!hasBudgetData && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-900">
          No budget data available. Connect a real Meta or Google Ads account to see live numbers — demo campaigns below illustrate the layout.
        </div>
      )}

      {/* ---------- Period selector (Daily / Weekly / Monthly + range dropdown) ---------- */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Settings className="w-4 h-4 text-gray-500" />
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
          {(["daily", "weekly", "monthly"] as Granularity[]).map((g) => (
            <button
              key={g}
              onClick={() => { setGranularity(g); setPeriodIdx(0); }}
              className={`px-3 py-1.5 text-sm font-semibold ${
                granularity === g ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {GRANULARITY_LABEL[g]}
            </button>
          ))}
        </div>
        <select
          value={safeIdx}
          onChange={(e) => setPeriodIdx(Number(e.target.value))}
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 bg-white"
        >
          {periodOptions.map((opt, i) => (
            <option key={opt.label} value={i}>{opt.label}</option>
          ))}
        </select>
        <span className="text-xs text-gray-400">Window: {periodDays} days</span>
      </div>

      {/* ---------- Email Alerts ---------- */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-gray-600" />
            <span className="text-sm font-semibold text-gray-900">Email alerts</span>
          </div>
          <input
            type="email"
            placeholder="your.email@example.com"
            value={emailDraft}
            onChange={(e) => { setEmailDraft(e.target.value); if (sendStatus !== "idle") { setSendStatus("idle"); setSendMessage(""); } }}
            className="flex-1 min-w-[220px] px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
          />
          <button
            onClick={handleSendAlerts}
            disabled={sendStatus === "sending" || criticalRows.length === 0 || !emailDraft.trim()}
            className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold ${
              sendStatus === "sending" || criticalRows.length === 0 || !emailDraft.trim()
                ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                : "bg-red-600 text-white hover:bg-red-700"
            }`}
            title={criticalRows.length === 0 ? "No critical campaigns" : `Send alert for ${criticalRows.length} critical campaign(s)`}
          >
            <Send className="w-4 h-4" />
            {sendStatus === "sending"
              ? "Sending…"
              : criticalRows.length === 0
              ? "No critical alerts"
              : `Send ${criticalRows.length} critical alert${criticalRows.length === 1 ? "" : "s"}`}
          </button>
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
            <MessageCircle className="w-3 h-3" /> WhatsApp coming soon
          </span>
        </div>
        {sendStatus === "sent" && (
          <div className="mt-2 flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1.5">
            <CheckCircle2 className="w-4 h-4" /> {sendMessage}
          </div>
        )}
        {sendStatus === "error" && (
          <div className="mt-2 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{sendMessage}</span>
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-2">
          Fires an email to this address listing every campaign flagged Overspending/Critical in the selected window.
        </p>
      </div>

      {/* Top 6 KPIs — 2 rows × 3 cols */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label="Total Budget"
          value={formatCurrency(totalBudget, currency)}
          subLabel={`${activeCampaigns.length} active · ${periodLabel}`}
        />
        <KpiCard
          label="Spend %"
          value={`${Math.round(spendPct)}%`}
          subLabel={`${formatCurrency(totalSpend, currency)} of ${formatCurrency(totalBudget, currency)}`}
          tone={toneForSpendPct(spendPct)}
          fixContext={{ metric: "budget_overspending", accountContext, auditContext: { module: "Budget Allocation", siblingMetrics: siblingMetricsAccount } }}
        />
        <KpiCard
          label="Remaining Budget"
          value={formatCurrency(remainingBudget, currency)}
          subLabel={remainingBudget < 0 ? "Overspent" : "Available to spend"}
          tone={remainingBudget < 0 ? "bad" : "good"}
          fixContext={{ metric: "budget_overspending", accountContext, auditContext: { module: "Budget Allocation", siblingMetrics: siblingMetricsAccount } }}
        />
        <KpiCard
          label="Forecasted Spend"
          value={formatCurrency(forecastedSpend, currency)}
          subLabel={pace.label}
          tone={pace.tone}
          fixContext={{ metric: forecastPctOfBudget > 105 ? "budget_overspending" : "budget_low_efficiency", accountContext, auditContext: { module: "Budget Allocation", siblingMetrics: siblingMetricsAccount } }}
        />
        <KpiCard
          label="Budget Efficiency Score"
          value={`${efficiencyScore}/100`}
          subLabel={`Spend-weighted ROAS · ${efficiencyRaw.toFixed(2)}x`}
          tone={efficiencyScore >= 70 ? "good" : efficiencyScore >= 40 ? "warn" : "bad"}
          fixContext={{ metric: "budget_low_efficiency", accountContext, auditContext: { module: "Budget Allocation", siblingMetrics: siblingMetricsAccount } }}
        />
        <KpiCard
          label="Scaling Opportunity"
          value={`${scalingScore}%`}
          subLabel={`${scalable} campaign${scalable === 1 ? "" : "s"} with headroom`}
          tone={scalingScore >= 30 ? "good" : scalingScore >= 10 ? "warn" : "bad"}
          fixContext={{ metric: "budget_no_scaling_opportunity", accountContext, auditContext: { module: "Budget Allocation", siblingMetrics: siblingMetricsAccount } }}
        />
      </div>

      {/* ---------- Budget pacing graph (allocated vs spend vs forecast) ---------- */}
      <AuditCard title="Budget Pacing" description={`${GRANULARITY_LABEL[granularity]} · ${periodLabel}`}>
        <div className="space-y-3">
          {([
            { label: "Allocated", value: totalBudget, color: "bg-blue-500" },
            { label: "Spend (to date)", value: totalSpend, color: "bg-green-500" },
            { label: "Forecast (full period)", value: forecastedSpend, color: forecastPctOfBudget > 105 ? "bg-red-500" : "bg-indigo-400" },
          ] as const).map((bar) => {
            const max = Math.max(totalBudget, forecastedSpend, totalSpend, 1);
            return (
              <div key={bar.label}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-gray-700">{bar.label}</span>
                  <span className="text-gray-600">{formatCurrency(bar.value, currency)}</span>
                </div>
                <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full ${bar.color}`} style={{ width: `${Math.min(100, Math.round((bar.value / max) * 100))}%` }} />
                </div>
              </div>
            );
          })}
          <div className="flex items-center gap-4 text-xs text-gray-500 pt-1 border-t border-gray-100">
            <span>Avg / day: <span className="font-semibold text-gray-700">{formatCurrency(avgDailySpend, currency)}</span></span>
            <span>Today pace: <span className={`font-semibold ${pace.tone === "bad" ? "text-red-600" : pace.tone === "warn" ? "text-yellow-600" : "text-green-600"}`}>{pace.label}</span></span>
          </div>
        </div>
      </AuditCard>

      {/* ---------- New Campaigns table ---------- */}
      <AuditCard title="New Campaigns" description={`Created within the selected ${periodLabel} window`}>
        {renderTable(newRows, `No campaigns created in the last ${periodLabel.toLowerCase()}.`)}
      </AuditCard>

      {/* ---------- All Campaigns drill table ---------- */}
      <AuditCard title="Campaign Drill — All Campaigns" description="Campaign / IO / Line · sorted by spend % descending">
        {renderTable(allRows, "No campaigns to analyse.")}
      </AuditCard>

      {activeCampaigns.length > 0 && (
        <div className="text-xs text-gray-500 italic">
          Total conversion value tracked: {formatCurrency(totalConversionValue, currency)} · Median ROAS: {medianRoas.toFixed(2)}x
        </div>
      )}
    </div>
  );
}
