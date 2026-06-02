import { useState, useMemo, useEffect, useRef } from "react";
import { Settings, Mail, MessageCircle, Send, CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
import { KpiCard, AuditCard, StatusBadge } from "./AuditCard";
import { buildAccountContext, type AuditProps } from "./types";
import type { CampaignData } from "@/types";
import { useAuthStore } from "@/store/auth";
import CampaignDrillTree from "./CampaignDrillTree";
import AttributionInfo from "@/components/shared/AttributionInfo";
import { useSort } from "@/hooks/useSort";
import SortTh from "@/components/shared/SortTh";

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
  // Healthy band widened to account for Meta's ±25% daily delivery tolerance.
  if (pct >= 70 && pct <= 105) return "good";
  if (pct >= 50 && pct < 70) return "warn";
  if (pct > 105 && pct <= 125) return "warn";
  return "bad";
}

function paceLabel(forecastPct: number): { label: string; tone: "good" | "warn" | "bad" } {
  if (forecastPct >= 95 && forecastPct <= 105) return { label: "On track", tone: "good" };
  if (forecastPct > 125) {
    return { label: `Overspending by ${Math.round(forecastPct - 100)}%`, tone: "bad" };
  }
  if (forecastPct > 105) {
    return { label: `Slightly over by ${Math.round(forecastPct - 100)}%`, tone: "warn" };
  }
  return { label: `Underpacing by ${Math.round(100 - forecastPct)}%`, tone: "warn" };
}

/**
 * Decide a campaign's spending status.
 *
 * For daily-budget campaigns: uses the 7d-vs-14d rolling ratio when available
 * (week-over-2-week trend). Falls back to simple window-based rate if no trail.
 * For lifetime-budget campaigns: total spend vs cap (real hard ceiling).
 */
function statusForCampaign(args: {
  isLifetime: boolean;
  spendPct: number;
  dailyRatePct: number; // fallback: avgDailySpend/dailyBudget (NaN if unavailable)
  rollingRatioPct?: number; // 7d avg / 14d avg × 100 (preferred for daily)
}): { label: string; status: "pass" | "warn" | "fail" | "info" } {
  if (args.isLifetime) {
    if (args.spendPct > 105) return { label: "Overspending", status: "fail" };
    if (args.spendPct >= 95) return { label: "Near cap", status: "warn" };
    if (args.spendPct < 70) return { label: "Underspending", status: "warn" };
    return { label: "On track", status: "pass" };
  }
  // Prefer the 7d-vs-14d rolling ratio; fall back to simple rate.
  const r = args.rollingRatioPct ?? args.dailyRatePct;
  if (!isFinite(r) || r <= 0) {
    if (args.spendPct < 70) return { label: "Underspending", status: "warn" };
    return { label: "On track", status: "pass" };
  }
  if (r > 125) return { label: "Overspending", status: "fail" };
  if (r > 110) return { label: "Slightly over", status: "warn" };
  if (r < 70) return { label: "Underspending", status: "warn" };
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

  // ---------- Select Campaigns filter ----------
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string> | null>(null); // null = all
  const [campaignPickerOpen, setCampaignPickerOpen] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setCampaignPickerOpen(false);
      }
    };
    if (campaignPickerOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [campaignPickerOpen]);

  // ---------- Per-campaign spend-threshold alert ----------
  const [spendThreshold, setSpendThreshold] = useState<number>(25); // % above daily budget
  const [thresholdEmail, setThresholdEmail] = useState("");
  const [alertSendState, setAlertSendState] = useState<Record<string, "idle" | "sending" | "sent" | "error">>({});

  // Alert email + monthly-cap state (both persisted in store).
  const { alertEmail, setAlertEmail, monthlyBudget, setMonthlyBudget, metaAccessToken } = useAuthStore();
  const [emailDraft, setEmailDraft] = useState(alertEmail || "");
  const [budgetDraft, setBudgetDraft] = useState<string>(monthlyBudget ? String(monthlyBudget) : "");
  const [sendStatus, setSendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sendMessage, setSendMessage] = useState<string>("");

  // Rolling 7d / 14d daily-spend trail fetched on mount for Meta campaigns.
  // Allows us to compare avg 7d vs avg 14d spend — a meaningful trend —
  // instead of the meaningless (window total ÷ days) vs current-daily-budget.
  const [dailyTrail, setDailyTrail] = useState<
    // avg7d  = last 7 calendar days ÷ 7    (matches Ads Manager "Last 7 days")
    // avg14d = days 8..14 ago ÷ 7          (previous-7d baseline for delta)
    // avg28d = last 28 calendar days ÷ 28  (true 4-week daily avg)
    Record<string, { avg7d: number; avg14d: number; avg28d: number }>
  >({});
  useEffect(() => {
    if (!metaAccessToken) return;
    const metaIds = campaigns
      .filter((c) => c.platform === "meta" && !(c.id in dailyTrail))
      .map((c) => c.id);
    if (metaIds.length === 0) return;
    fetch("/api/naming/campaigns/daily-trail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, campaignIds: metaIds }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.trails) {
          const derived: Record<string, { avg7d: number; avg14d: number; avg28d: number }> = {};
          const trailMap = data.trails as Record<string, Array<{ date: string; spend: number }>>;
          for (const [id, days] of Object.entries(trailMap)) {
            const sorted = [...days].sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date));
            // Calendar-day averages over the trailing 28 days.
            // Meta's time_increment(1) OMITS rows for zero-spend days, so
            // summing rows and dividing by row count over-states the average
            // for paused / intermittent campaigns. Fix: divide by a FIXED
            // calendar-day count. Missing days = ₹0.
            //   avg7d  = sum of last 7 calendar days   ÷ 7
            //   avg14d = sum of days 8..14 ago         ÷ 7   (prev-7 baseline)
            //   avg28d = sum of last 28 calendar days  ÷ 28  (true 4-week)
            const anchor = sorted.length > 0 ? sorted[sorted.length - 1].date : null;
            const dayMs = 86_400_000;
            const sumWindow = (startOffset: number, endOffset: number): number => {
              if (!anchor) return 0;
              const anchorMs = new Date(`${anchor}T00:00:00Z`).getTime();
              const startMs = anchorMs - startOffset * dayMs;
              const endMs = anchorMs - endOffset * dayMs;
              return sorted.reduce((s, d) => {
                const t = new Date(`${d.date}T00:00:00Z`).getTime();
                return t >= endMs && t <= startMs ? s + d.spend : s;
              }, 0);
            };
            derived[id] = {
              avg7d: sumWindow(0, 6) / 7,
              avg14d: sumWindow(7, 13) / 7,
              avg28d: sumWindow(0, 27) / 28,
            };
          }
          setDailyTrail((prev) => ({ ...prev, ...derived }));
        }
      })
      .catch(() => { /* silent — falls back to window-based cell */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, metaAccessToken]);

  const periodOptions = PERIOD_OPTIONS[granularity];
  const safeIdx = Math.min(periodIdx, periodOptions.length - 1);
  const periodDays = periodOptions[safeIdx].days;
  const periodLabel = periodOptions[safeIdx].label;

  // All campaigns filtered by selection (null = all selected)
  const visibleCampaigns = useMemo(() => {
    if (!selectedCampaignIds) return campaigns;
    return campaigns.filter((c) => selectedCampaignIds.has(c.id));
  }, [campaigns, selectedCampaignIds]);

  const activeCampaigns = useMemo(
    () => visibleCampaigns.filter((c) => c.status === "ACTIVE" || c.status === "ENABLED"),
    [visibleCampaigns]
  );

  const totalBudget = activeCampaigns.reduce((sum, c) => sum + campaignBudget(c, periodDays), 0);
  const totalSpend = activeCampaigns.reduce((sum, c) => sum + (c.spend || 0), 0);
  const totalConversionValue = activeCampaigns.reduce((sum, c) => sum + (c.conversionValue || 0), 0);

  const spendPct = totalBudget > 0 ? (totalSpend / totalBudget) * 100 : 0;
  const remainingBudget = totalBudget - totalSpend;
  // The dashboard's date range is a backward-looking window (Last N Days), so
  // the period IS complete — forecast == actualSpend, no extrapolation. The
  // earlier `forecast = spend × 2` (assuming we were halfway through) caused
  // false "Overpacing 100%" alarms even when spend matched budget perfectly.
  const forecastedSpend = totalSpend;
  const forecastPctOfBudget = spendPct;
  const avgDailySpend = periodDays > 0 ? totalSpend / periodDays : 0;

  // ---------- Monthly-cap pacing (real calendar-month math) ----------
  // Uses the user's stored monthly cap + today's day-of-month to detect
  // whether they are over- or under-pacing for the CURRENT calendar month.
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);
  // MTD-equivalent spend from the visible window, normalised to a month.
  const spendPerDay = periodDays > 0 ? totalSpend / periodDays : 0;
  const mtdSpendEstimate = spendPerDay * daysElapsed;
  const expectedMtdSpend = monthlyBudget ? (monthlyBudget * daysElapsed) / daysInMonth : 0;
  const mtdPaceRatio = expectedMtdSpend > 0 ? mtdSpendEstimate / expectedMtdSpend : 0;
  const mtdPaceLabel: { label: string; tone: "good" | "warn" | "bad" } =
    !monthlyBudget
      ? { label: "Set a monthly cap to track pacing", tone: "warn" }
      : mtdPaceRatio >= 0.95 && mtdPaceRatio <= 1.05
      ? { label: "On pace", tone: "good" }
      : mtdPaceRatio > 1.05
      ? { label: `Over-pacing by ${Math.round((mtdPaceRatio - 1) * 100)}%`, tone: "bad" }
      : { label: `Under-pacing by ${Math.round((1 - mtdPaceRatio) * 100)}%`, tone: "warn" };

  // Headroom for new campaigns this month
  const projectedMonthEnd = spendPerDay * daysInMonth;
  const headroomForNew = monthlyBudget ? Math.max(0, monthlyBudget - projectedMonthEnd) : 0;

  // Safe daily cap given remaining days
  const safeDailyCap = monthlyBudget && daysRemaining > 0
    ? Math.max(0, (monthlyBudget - mtdSpendEstimate) / daysRemaining)
    : 0;
  const sumActiveDailyBudgets = activeCampaigns.reduce(
    (s, c) => s + (c.dailyBudget || 0),
    0
  );
  const dailyCapBreached = monthlyBudget !== null && sumActiveDailyBudgets > safeDailyCap * 1.1 && safeDailyCap > 0;

  // ---------- Duplicate-campaign detection ----------
  // Normalises out copy/version suffixes and groups campaigns whose normalised
  // names collide. Catches the "team duplicates a campaign and accidentally
  // burns the entire monthly budget in one day" failure mode.
  const normaliseName = (n: string) =>
    n
      .toLowerCase()
      .replace(/\s*[-_]?\s*(copy(\s*of)?|\(?\d{1,2}\)?|v\d+|version\s*\d+)\s*$/i, "")
      .replace(/^copy of\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
  const dupGroups = useMemo(() => {
    const groups = new Map<string, CampaignData[]>();
    for (const c of campaigns) {
      const k = normaliseName(c.name);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(c);
    }
    return Array.from(groups.entries()).filter(([, list]) => list.length > 1);
  }, [campaigns]);

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
    return visibleCampaigns
      .map((c) => {
        const budget = campaignBudget(c, periodDays);
        const spend = c.spend || 0;
        const campSpendPct = budget > 0 ? (spend / budget) * 100 : 0;
        const avgDaily = periodDays > 0 ? spend / periodDays : 0;
        const dailyRatePct =
          c.dailyBudget && c.dailyBudget > 0 ? (avgDaily / c.dailyBudget) * 100 : NaN;
        const campPacePct =
          c.lifetimeBudget !== undefined && c.lifetimeBudget > 0 ? campSpendPct : dailyRatePct || 0;
        // Prefer rolling 7d-vs-14d ratio for status when trail is available.
        const trail = dailyTrail[c.id];
        const rollingRatioPct =
          trail && trail.avg14d > 0 ? (trail.avg7d / trail.avg14d) * 100 : undefined;
        const isPaused = c.status !== "ACTIVE" && c.status !== "ENABLED";
        const status = isPaused
          ? { label: "Paused", status: "info" as const }
          : statusForCampaign({
              isLifetime: c.lifetimeBudget !== undefined && c.lifetimeBudget > 0,
              spendPct: campSpendPct,
              dailyRatePct,
              rollingRatioPct,
            });
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
  const { sorted: sortedRows, sort: budgetSort, toggle: budgetToggle } = useSort(allRows, "spendPct", "desc");

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
            <SortTh col="campaign" sort={budgetSort} onToggle={budgetToggle} className="px-4 py-2">Campaign Name</SortTh>
            <th className="px-4 py-2 text-left font-semibold text-gray-700">Objective</th>
            <th className="px-4 py-2 text-left font-semibold text-gray-700">Start / End</th>
            <th
              className="px-4 py-2 text-left font-semibold text-gray-700"
              title={`"Budget allocated" = current daily budget × period days (assumes the daily budget was constant for the whole period). Meta's daily budget is an average — they can spend up to 25% over on any given day to optimise delivery, then rebalance over a 7-day week. Spend > 100% typically means the daily budget was raised earlier in the period, or a lifetime/ABO budget exists at the ad-set level.`}
            >
              Budget Allocated vs Spend ⓘ
            </th>
            <SortTh col="spendPct" sort={budgetSort} onToggle={budgetToggle} className="px-4 py-2">Remarks</SortTh>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-gray-500">{emptyMsg}</td>
            </tr>
          ) : (
            sortedRows.filter(r => rows.includes(r)).slice(0, 30).map(({ campaign, budget, spend, spendPct: sPct, status }) => (
              <tr key={`${campaign.platform}-${campaign.id}`} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                <td className="px-4 py-3 font-mono text-gray-900 max-w-[220px] truncate" title={campaign.name}>
                  {campaign.name}
                </td>
                <td className="px-4 py-3 text-gray-700">{campaign.objective || "—"}</td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                  {formatDate(campaign.createdTime)}
                  <span className="text-gray-400"> → </span>
                  {campaign.endTime ? (
                    <span className="text-gray-700">{formatDate(campaign.endTime)}</span>
                  ) : (
                    <span
                      className="text-orange-600 font-semibold text-[11px] cursor-help"
                      title="No end date set in Meta Ads Manager. Go to the campaign → Edit → Schedule → add an End Date to avoid uncontrolled spend."
                    >
                      No end date ⚠
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-900 min-w-[200px]">
                  {(() => {
                    // For lifetime-budget campaigns: lifetime IS the real hard cap.
                    // Show total vs total. For daily-budget campaigns: total isn't a
                    // cap (Meta averages over the week), so compare daily-rate instead
                    // — that's the meaningful "are we within Meta's tolerance?" check.
                    const hasLifetime = campaign.lifetimeBudget !== undefined && campaign.lifetimeBudget > 0;
                    const dailyBudget = campaign.dailyBudget;
                    const avgDaily = periodDays > 0 ? spend / periodDays : 0;
                    const cur = campaign.currency || currency;

                    if (hasLifetime) {
                      // Lifetime budget = hard cap; show total comparison.
                      return (
                        <>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold">{formatCurrency(campaign.lifetimeBudget!, cur)}</span>
                            <span className="text-gray-500">{formatCurrency(spend, cur)}</span>
                          </div>
                          <div className="w-full h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
                            <div
                              className={`h-full ${sPct > 105 ? "bg-red-500" : sPct >= 70 ? "bg-green-500" : "bg-yellow-400"}`}
                              style={{ width: `${Math.min(100, Math.round(sPct))}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{Math.round(sPct)}% of lifetime cap · hard cap</div>
                        </>
                      );
                    }

                    if (dailyBudget && dailyBudget > 0) {
                      const trail = dailyTrail[campaign.id];
                      const avg7d = trail?.avg7d ?? 0;
                      const avg14d = trail?.avg14d ?? 0;
                      const hasTrail = avg7d > 0 || avg14d > 0;
                      // Rolling delta: how is this week trending vs the past 2 weeks?
                      const rollingDelta =
                        avg14d > 0 ? ((avg7d - avg14d) / avg14d) * 100 : null;
                      // Progress bar: 7d avg vs the higher of (14d avg, daily budget)
                      const barMax = Math.max(avg14d, dailyBudget, 1);
                      const barPct = Math.min(100, (avg7d / barMax) * 100);
                      return (
                        <>
                          <div className="grid grid-cols-3 gap-1 text-[11px]">
                            <div>
                              <div className="text-gray-500">Daily budget</div>
                              <div className="font-semibold text-gray-900">{formatCurrency(dailyBudget, cur)}/day</div>
                            </div>
                            <div className="text-center">
                              <div className="text-gray-500">Avg 7d</div>
                              <div className="font-semibold text-gray-900">
                                {hasTrail ? `${formatCurrency(avg7d, cur)}/day` : <span className="text-gray-400">—</span>}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-gray-500">Prev 7d avg</div>
                              <div className="font-semibold text-gray-900">
                                {hasTrail ? `${formatCurrency(avg14d, cur)}/day` : <span className="text-gray-400">—</span>}
                              </div>
                            </div>
                          </div>
                          {hasTrail && (
                            <>
                              <div className="w-full h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
                                <div
                                  className={`h-full ${avg7d > avg14d * 1.1 ? "bg-red-400" : avg7d > avg14d * 1.0 ? "bg-yellow-400" : "bg-green-500"}`}
                                  style={{ width: `${barPct}%` }}
                                />
                              </div>
                              {rollingDelta !== null && (
                                <div className="text-[10px] mt-0.5 flex items-center gap-1">
                                  <span className={rollingDelta > 10 ? "text-red-600 font-semibold" : rollingDelta > 0 ? "text-yellow-700" : "text-green-700"}>
                                    {rollingDelta >= 0 ? "+" : ""}{Math.round(rollingDelta)}% vs prev 7d
                                  </span>
                                  <span className="text-gray-300">·</span>
                                  <span className="text-gray-400">
                                    {rollingDelta > 10 ? "spend accelerating" : rollingDelta < -10 ? "spend slowing" : "stable trend"}
                                  </span>
                                </div>
                              )}
                              {avg7d > dailyBudget * 1.05 && (
                                <div className="text-[10px] text-yellow-700 mt-0.5">
                                  7d avg exceeds daily setting — budget was likely higher recently (Meta API returns current setting only).
                                </div>
                              )}
                            </>
                          )}
                          {!hasTrail && (
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              Loading 7d/14d trend…
                            </div>
                          )}
                        </>
                      );
                    }

                    // No budget data at all.
                    return (
                      <>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold">—</span>
                          <span className="text-gray-500">{spend > 0 ? formatCurrency(spend, cur) : "—"}</span>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5">no budget data (budget likely set at ad-set level)</div>
                      </>
                    );
                  })()}
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

      {/* ========== NEW WIREFRAME LAYOUT ========== */}

      {/* ---------- Toolbar: Select Campaigns + Spend Alert ---------- */}
      <div className="flex flex-wrap items-start gap-3">

        {/* Select Campaigns picker */}
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setCampaignPickerOpen((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 shadow-sm"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
            {selectedCampaignIds === null
              ? "All campaigns"
              : `${selectedCampaignIds.size} selected`}
            <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>

          {campaignPickerOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl w-80">
              {/* Search */}
              <div className="p-3 border-b border-gray-100">
                <input
                  autoFocus
                  type="text"
                  placeholder="Search campaigns..."
                  value={campaignSearch}
                  onChange={(e) => setCampaignSearch(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-blue-500 rounded-lg text-sm focus:outline-none"
                />
              </div>
              {/* Campaign list */}
              <div className="max-h-60 overflow-y-auto py-1">
                {campaigns
                  .filter((c) => c.name.toLowerCase().includes(campaignSearch.toLowerCase()))
                  .map((c) => {
                    const checked = selectedCampaignIds === null || selectedCampaignIds.has(c.id);
                    const dotColor = c.status === "ACTIVE" || c.status === "ENABLED"
                      ? "bg-green-500" : c.status === "PAUSED" ? "bg-yellow-400" : "bg-gray-400";
                    return (
                      <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const cur = selectedCampaignIds ?? new Set(campaigns.map((x) => x.id));
                            const next = new Set(cur);
                            next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                            setSelectedCampaignIds(next.size === campaigns.length ? null : next);
                          }}
                          className="w-4 h-4 rounded accent-blue-600"
                        />
                        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                        <span className="text-sm text-gray-800 truncate flex-1">{c.name}</span>
                      </label>
                    );
                  })}
              </div>
              {/* Footer */}
              <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100">
                <button onClick={() => setSelectedCampaignIds(null)} className="text-xs font-semibold text-blue-600 hover:text-blue-800">Select all</button>
                <button onClick={() => setSelectedCampaignIds(new Set())} className="text-xs font-semibold text-gray-500 hover:text-gray-700">Clear</button>
              </div>
            </div>
          )}
        </div>

        {/* Spend threshold email alert */}
        <div className="flex flex-wrap items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm flex-1 min-w-[300px]">
          <Mail className="w-4 h-4 text-gray-500 shrink-0" />
          <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">Alert if spend &gt;</span>
          <input
            type="number" min={1} max={500}
            value={spendThreshold}
            onChange={(e) => setSpendThreshold(Number(e.target.value))}
            className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-600 whitespace-nowrap">% above daily budget → email</span>
          <input
            type="email" placeholder="your@email.com"
            value={thresholdEmail}
            onChange={(e) => setThresholdEmail(e.target.value)}
            className="flex-1 min-w-[140px] px-2.5 py-1 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={async () => {
              if (!thresholdEmail.trim()) return;
              // Find campaigns breaching threshold
              const breaching = visibleCampaigns.filter((c) => {
                if (!c.dailyBudget) return false;
                const trail = dailyTrail[c.id];
                const avg7d = trail?.avg7d ?? 0;
                if (avg7d === 0) return false;
                return ((avg7d / c.dailyBudget) - 1) * 100 > spendThreshold;
              });
              if (breaching.length === 0) return alert("No campaigns currently exceed the threshold.");
              setSendStatus("sending");
              try {
                const r = await fetch("/api/alerts/budget", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    recipient: thresholdEmail.trim(),
                    periodLabel: `Spend > ${spendThreshold}% above daily budget`,
                    campaigns: breaching.map((c) => ({
                      name: c.name,
                      objective: c.objective,
                      budget: c.dailyBudget || 0,
                      spend: (dailyTrail[c.id]?.avg7d || 0),
                      spendPct: c.dailyBudget ? Math.round(((dailyTrail[c.id]?.avg7d || 0) / c.dailyBudget) * 100) : 0,
                      currency: c.currency || currency,
                      status: `+${Math.round(((dailyTrail[c.id]?.avg7d || 0) / (c.dailyBudget || 1) - 1) * 100)}% vs daily budget`,
                    })),
                  }),
                });
                const data = await r.json();
                setSendStatus(r.ok && data.sent ? "sent" : "error");
                setSendMessage(r.ok && data.sent ? `Alert sent to ${thresholdEmail.trim()}` : data.error || "Failed");
              } catch { setSendStatus("error"); setSendMessage("Network error"); }
            }}
            disabled={!thresholdEmail.trim() || sendStatus === "sending"}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 whitespace-nowrap"
          >
            {sendStatus === "sending" ? "Sending…" : "Send Alert"}
          </button>
          {sendStatus === "sent" && <span className="text-[11px] text-green-700">✓ {sendMessage}</span>}
          {sendStatus === "error" && <span className="text-[11px] text-red-600">✗ {sendMessage}</span>}
        </div>
      </div>

      {/* ---------- 3 Budget Header Cards (Daily / Weekly / Monthly) ---------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(["daily", "weekly", "monthly"] as Granularity[]).map((g) => {
          const opts = PERIOD_OPTIONS[g];
          const isActive = granularity === g;
          const gIdx = isActive ? safeIdx : 0;
          const gPeriodDays = opts[Math.min(gIdx, opts.length - 1)].days;
          // Budget for this granularity: sum of active daily budgets × period
          const gBudget = activeCampaigns.reduce((sum, c) => {
            if (c.lifetimeBudget) return sum + c.lifetimeBudget;
            return sum + (c.dailyBudget || 0) * gPeriodDays;
          }, 0);
          const gSpend = activeCampaigns.reduce((s, c) => s + (c.spend || 0), 0);
          const gSpendPct = gBudget > 0 ? Math.round((gSpend / gBudget) * 100) : 0;
          // Spend aggregates must include ALL campaigns that spent in the
          // window — not just currently-active ones. Ads Manager's last-7-days
          // total includes spend from campaigns that have since been paused or
          // hit their lifetime cap. Restricting to activeCampaigns silently
          // dropped that spend (caused the ~50% undercount vs Ads Manager).
          const allAvg7 = visibleCampaigns.reduce((s, c) => s + (dailyTrail[c.id]?.avg7d || 0), 0);
          const allPrev7 = visibleCampaigns.reduce((s, c) => s + (dailyTrail[c.id]?.avg14d || 0), 0);
          const allAvg28 = visibleCampaigns.reduce((s, c) => s + (dailyTrail[c.id]?.avg28d || 0), 0);
          // Daily card → last 7d daily avg (×1); Weekly card → 4-week daily avg
          // × 7 (true 4-week-derived weekly); Monthly card → 4-week daily avg
          // × 30 (4-week-derived monthly projection).
          const periodAvg =
            g === "daily" ? allAvg7 : g === "weekly" ? allAvg28 * 7 : allAvg28 * 30;
          // Delta on the daily card is week-over-week (7d vs prev 7d).
          // On weekly / monthly cards the meaningful comparison is "this week
          // running hotter or cooler than the 4-week baseline" — i.e. avg7d vs
          // avg28d (positive = spend accelerating recently).
          const delta =
            g === "daily"
              ? allPrev7 > 0
                ? Math.round(((allAvg7 - allPrev7) / allPrev7) * 100)
                : null
              : allAvg28 > 0
                ? Math.round(((allAvg7 - allAvg28) / allAvg28) * 100)
                : null;
          const avgLabel =
            g === "daily" ? "Last 7d avg" : g === "weekly" ? "Last 4w avg" : "Last 4w avg";
          // Explicit unit suffix so the comparison can't be misread.
          // Daily card values are PER DAY; Weekly card values are PER WEEK
          // (₹/wk = daily × 7); Monthly card values are PER 30 DAYS (₹/mo =
          // daily × 30). To convert any of these to a per-day rate, divide by
          // the suffix's period — e.g. ₹724,026/mo ÷ 30 = ₹24,134/day.
          const unitSuffix = g === "daily" ? "/day" : g === "weekly" ? "/wk" : "/mo";
          return (
            <div
              key={g}
              onClick={() => { setGranularity(g); }}
              className={`bg-white rounded-xl border-2 cursor-pointer transition-all p-5 ${isActive ? "border-blue-500 shadow-md" : "border-gray-200 hover:border-gray-300"}`}
            >
              {/* Header with title + period selector */}
              <div className="flex items-start justify-between mb-3">
                <div className="text-sm font-bold text-gray-700">{GRANULARITY_LABEL[g]}</div>
                <select
                  value={isActive ? safeIdx : 0}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { setGranularity(g); setPeriodIdx(Number(e.target.value)); }}
                  className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5 text-gray-600 bg-white font-semibold"
                >
                  {opts.map((opt, i) => (
                    <option key={opt.label} value={i}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {/* Big budget number — for the period shown in the dropdown */}
              <div className="text-3xl font-bold text-gray-900 mb-1">
                {formatCurrency(isActive ? totalBudget : gBudget, currency)}
                <span className="text-base text-gray-400 font-medium ml-1">
                  {g === "daily" ? `/ ${gPeriodDays}d` : g === "weekly" ? `/ ${Math.round(gPeriodDays / 7)}wk` : `/ ${Math.round(gPeriodDays / 30)}mo`}
                </span>
              </div>
              {/* Last X avg comparison — same period unit as the big number above */}
              <div className="text-xs text-gray-500 flex items-center gap-2">
                <span>
                  {avgLabel}:{" "}
                  <span className="font-semibold text-gray-700">
                    {formatCurrency(periodAvg, currency)}
                    <span className="text-gray-400">{unitSuffix}</span>
                  </span>
                </span>
                {delta !== null && (
                  <span className={`font-bold ${delta > 0 ? "text-red-600" : delta < 0 ? "text-green-600" : "text-gray-400"}`}>
                    {delta >= 0 ? "+" : ""}{delta}%
                  </span>
                )}
              </div>
              {/* Mini progress bar */}
              <div className="w-full h-1 bg-gray-100 rounded-full mt-2 overflow-hidden">
                <div className={`h-full ${isActive ? "bg-blue-500" : "bg-gray-300"}`} style={{ width: `${Math.min(100, gSpendPct)}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------- Summary row: Remaining Budget + Expected Forecast + Select Campaigns ---------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Remaining Budget */}
        <div className="bg-white rounded-xl border-2 border-gray-200 p-5">
          <div className="text-sm font-bold text-gray-600 mb-2">Remaining Budget</div>
          <div className={`text-3xl font-bold mb-1 ${remainingBudget < 0 ? "text-red-600" : "text-gray-900"}`}>
            {formatCurrency(Math.abs(remainingBudget), currency)}
          </div>
          <div className="text-xs text-gray-500">
            <span className="font-semibold text-gray-700">{Math.round(spendPct)}% Spend</span>
            {" | "}
            <span className="font-semibold text-gray-700">{Math.max(0, Math.round(100 - spendPct))}% Remaining</span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full ${spendPct > 105 ? "bg-red-500" : spendPct >= 70 ? "bg-blue-500" : "bg-yellow-400"}`}
              style={{ width: `${Math.min(100, Math.round(spendPct))}%` }}
            />
          </div>
        </div>

        {/* Expected Forecast */}
        <div className="bg-white rounded-xl border-2 border-gray-200 p-5">
          <div className="text-sm font-bold text-gray-600 mb-2">Expected Forecast</div>
          <div className="text-3xl font-bold text-gray-900 mb-1">
            {formatCurrency(forecastedSpend, currency)}
          </div>
          <div className="space-y-0.5 text-[11px] text-gray-500">
            <div>Budget allocated: <span className="font-semibold text-gray-700">{formatCurrency(totalBudget, currency)}</span></div>
            <div>
              Efficiency Score: <span className={`font-semibold ${efficiencyScore >= 70 ? "text-green-700" : efficiencyScore >= 40 ? "text-yellow-700" : "text-red-700"}`}>{efficiencyScore}%</span>
              <AttributionInfo compact />
            </div>
            <div>
              Scaling Opportunity: <span className="font-semibold text-gray-700">{scalingScore}% <span className="text-gray-400">({scalable} campaign{scalable !== 1 ? "s" : ""} with headroom)</span></span>
              <AttributionInfo compact />
            </div>
          </div>
        </div>

        {/* Monthly budget cap + email alert */}
        <div className="bg-white rounded-xl border-2 border-gray-200 p-5">
          <div className="text-sm font-bold text-gray-600 mb-2">Monthly Cap & Alerts</div>
          <div className="space-y-2">
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">Monthly budget cap ({currency})</label>
              <input
                type="number" min={0} placeholder="e.g. 300000"
                value={budgetDraft}
                onChange={(e) => setBudgetDraft(e.target.value)}
                onBlur={() => { const n = parseFloat(budgetDraft); setMonthlyBudget(!isNaN(n) && n > 0 ? n : null); }}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="email" placeholder="Alert email"
                value={emailDraft}
                onChange={(e) => { setEmailDraft(e.target.value); if (sendStatus !== "idle") { setSendStatus("idle"); setSendMessage(""); } }}
                className="flex-1 min-w-[130px] px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs"
              />
              <button
                onClick={handleSendAlerts}
                disabled={sendStatus === "sending" || criticalRows.length === 0 || !emailDraft.trim()}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${
                  criticalRows.length === 0 || !emailDraft.trim() ? "bg-gray-200 text-gray-500 cursor-not-allowed" : "bg-red-600 text-white hover:bg-red-700"
                }`}
              >
                <Send className="w-3 h-3" /> {sendStatus === "sending" ? "…" : `Alert (${criticalRows.length})`}
              </button>
            </div>
            {sendStatus === "sent" && <div className="text-[10px] text-green-700">✓ {sendMessage}</div>}
            {sendStatus === "error" && <div className="text-[10px] text-red-700">✗ {sendMessage}</div>}
          </div>
        </div>
      </div>

      {/* Monthly Budget Tracking moved into summary row above */}
      {false && /* ---------- Monthly Budget Tracking (cap + MTD pacing) ---------- */
      <AuditCard title="Monthly Budget Tracking" description={`Day ${daysElapsed} of ${daysInMonth} — ${daysRemaining} days left this month`}>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-semibold text-gray-700 mb-1">Monthly budget cap ({currency})</label>
            <input
              type="number"
              min={0}
              placeholder="e.g. 300000"
              value={budgetDraft}
              onChange={(e) => setBudgetDraft(e.target.value)}
              onBlur={() => {
                const n = parseFloat(budgetDraft);
                setMonthlyBudget(!isNaN(n) && n > 0 ? n : null);
              }}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          {monthlyBudget !== null && (
            <button
              onClick={() => { setMonthlyBudget(null); setBudgetDraft(""); }}
              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded"
            >
              Clear
            </button>
          )}
        </div>

        {monthlyBudget === null ? (
          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-3">
            Set a monthly cap above to see MTD pace, daily-budget cap maths, headroom for new campaigns, and over-pacing alerts.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <KpiCard
                label="Monthly Cap"
                value={formatCurrency(monthlyBudget ?? undefined, currency)}
                subLabel={`${daysElapsed}/${daysInMonth} days elapsed`}
              />
              <KpiCard
                label="Spend So Far (est. MTD)"
                value={formatCurrency(mtdSpendEstimate, currency)}
                subLabel={`vs ${formatCurrency(expectedMtdSpend, currency)} expected by day ${daysElapsed}`}
                tone={mtdPaceLabel.tone}
              />
              <KpiCard
                label="Pace"
                value={`${Math.round(mtdPaceRatio * 100)}%`}
                subLabel={mtdPaceLabel.label}
                tone={mtdPaceLabel.tone}
              />
            </div>

            {/* Pacing visual: actual vs expected line */}
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-semibold text-gray-700">Month progress</span>
                <span className="text-gray-500">
                  {formatCurrency(mtdSpendEstimate, currency)} / {formatCurrency(monthlyBudget ?? undefined, currency)} ({Math.round((mtdSpendEstimate / (monthlyBudget ?? 1)) * 100)}% used · {Math.round((daysElapsed / daysInMonth) * 100)}% time)
                </span>
              </div>
              <div className="relative w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                {/* expected pace marker */}
                <div className="absolute top-0 bottom-0 w-0.5 bg-gray-400 z-10" style={{ left: `${Math.min(100, (daysElapsed / daysInMonth) * 100)}%` }} title="Expected pace" />
                {/* actual spend bar */}
                <div className={`h-full ${mtdPaceLabel.tone === "bad" ? "bg-red-500" : mtdPaceLabel.tone === "warn" ? "bg-yellow-400" : "bg-green-500"}`} style={{ width: `${Math.min(100, (mtdSpendEstimate / (monthlyBudget ?? 1)) * 100)}%` }} />
              </div>
              <div className="text-[10px] text-gray-400 mt-1">Grey line = expected pace by today. Coloured bar = actual.</div>
            </div>

            {/* Daily Budget Cap */}
            <div className={`border rounded-lg p-3 ${dailyCapBreached ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-200"}`}>
              <div className="flex items-center gap-2 mb-1">
                {dailyCapBreached ? <AlertCircle className="w-4 h-4 text-red-600" /> : <CheckCircle2 className="w-4 h-4 text-blue-600" />}
                <span className="text-sm font-bold text-gray-900">Daily Budget Cap</span>
              </div>
              <div className="text-xs text-gray-700">
                Safe daily spend to stay within cap: <span className="font-semibold text-gray-900">{formatCurrency(safeDailyCap, currency)}/day</span>{" "}
                · Sum of active daily budgets: <span className={`font-semibold ${dailyCapBreached ? "text-red-700" : "text-gray-900"}`}>{formatCurrency(sumActiveDailyBudgets, currency)}/day</span>
              </div>
              {dailyCapBreached && (
                <div className="text-xs text-red-700 mt-1.5">
                  ⚠ Active campaigns' combined daily budgets are <strong>{Math.round((sumActiveDailyBudgets / safeDailyCap - 1) * 100)}%</strong> over the safe cap. Risk of exhausting the monthly budget early.
                </div>
              )}
            </div>

            {/* Headroom for new campaigns */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-gray-700 mb-1">Available for new campaigns this month</div>
              <div className="text-2xl font-bold text-gray-900">{formatCurrency(headroomForNew, currency)}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                Projected end-of-month spend at current pace: {formatCurrency(projectedMonthEnd, currency)}. New-campaign budget shouldn&apos;t exceed the headroom above without raising the cap.
              </div>
            </div>
          </div>
        )}
      </AuditCard>}

      {/* ---------- Duplicate Campaign Prevention ---------- */}
      {dupGroups.length > 0 && (
        <AuditCard title="Duplicate Campaigns Detected" description="Campaigns with near-identical names — risk of doubled spend if both are active.">
          <div className="space-y-2">
            {dupGroups.map(([normalisedName, list]) => {
              const totalDailyBudget = list.reduce((s, c) => s + (c.dailyBudget || 0), 0);
              const anyActive = list.some((c) => c.status === "ACTIVE" || c.status === "ENABLED");
              return (
                <div key={normalisedName} className={`border rounded-lg p-3 ${anyActive ? "bg-yellow-50 border-yellow-300" : "bg-gray-50 border-gray-200"}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <AlertTriangle className={`w-4 h-4 ${anyActive ? "text-yellow-700" : "text-gray-500"}`} />
                    <span className="text-sm font-semibold text-gray-900">
                      {list.length} duplicates of "{normalisedName}"
                    </span>
                    {anyActive && <span className="text-[10px] font-bold uppercase bg-yellow-200 text-yellow-900 px-1.5 py-0.5 rounded">{list.filter((c) => c.status === "ACTIVE" || c.status === "ENABLED").length} active</span>}
                  </div>
                  <div className="space-y-0.5">
                    {list.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-xs font-mono text-gray-700">
                        <span className={`w-1.5 h-1.5 rounded-full ${c.status === "ACTIVE" || c.status === "ENABLED" ? "bg-green-500" : "bg-gray-300"}`} />
                        <span className="truncate flex-1" title={c.name}>{c.name}</span>
                        <span className="text-gray-400">{c.dailyBudget ? `${formatCurrency(c.dailyBudget, c.currency || currency)}/day` : "—"}</span>
                        <span className="text-gray-400 text-[10px]">{c.status}</span>
                      </div>
                    ))}
                  </div>
                  {anyActive && totalDailyBudget > 0 && (
                    <div className="text-[11px] text-yellow-800 mt-1.5">
                      Combined daily spend if both run: <strong>{formatCurrency(totalDailyBudget, currency)}/day</strong>
                      {monthlyBudget && totalDailyBudget * daysInMonth > monthlyBudget * 0.5 && (
                        <span> · &gt;50% of monthly cap if both run all month</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </AuditCard>
      )}

      {/* Email Alerts moved into Monthly Cap & Alerts card above */}
      {false && <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
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
      </div>}

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

      {/* Explainer: be honest that "Allocated total" is just an estimate for
          daily-budget campaigns — there's no hard total cap, only a daily one.
          So "Overspending" is judged on DAILY rate, not on total %. */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-blue-700" />
        <div>
          <strong>How &ldquo;Overspending&rdquo; is decided:</strong> For <strong>daily-budget</strong> campaigns we compare
          <em> avg daily spend vs daily budget</em> (Meta&apos;s actual cap is per-day, not total). 110%+ over daily = &ldquo;Slightly over&rdquo;,
          125%+ over = &ldquo;Overspending&rdquo;. For <strong>lifetime-budget</strong> campaigns we compare total spend vs lifetime cap (real hard cap).
          <br />
          <span className="text-blue-700">If you see total spend &gt; <code className="bg-blue-100 px-1 rounded">dailyBudget × days</code> for a campaign with daily budget,
          it usually means the daily budget was changed mid-period or a lifetime/ABO budget is set at the ad-set level — not that Meta over-charged.</span>
        </div>
      </div>

      {/* ---------- New Campaigns table ---------- */}
      <AuditCard title="New Campaigns" description={`Created within the selected ${periodLabel} window`}>
        {renderTable(newRows, `No campaigns created in the last ${periodLabel.toLowerCase()}.`)}
      </AuditCard>

      {/* ---------- All Campaigns drill table — hierarchical CAMP → AS → AD ---------- */}
      <AuditCard title="Campaign Drill — All Campaigns" description="Click ▶ to expand ad sets and ads. Rename any level inline.">
        <CampaignDrillTree campaigns={visibleCampaigns} currency={currency} />
      </AuditCard>

      {activeCampaigns.length > 0 && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs text-gray-500 italic">
            Total conversion value tracked: {formatCurrency(totalConversionValue, currency)} · Median ROAS: {medianRoas.toFixed(2)}x
          </div>
          <AttributionInfo />
        </div>
      )}
    </div>
  );
}
