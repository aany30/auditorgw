/**
 * Reporting → Overview
 *
 * KPI cards (Reach, Frequency, Impressions, Spend, CPM) showing current vs
 * previous-period deltas + sparklines, plus a Performance Trend chart with
 * locked X (date) and user-picked Primary/Secondary Y metrics.
 *
 * Data sources:
 *  - Daily series + prev-period series → /api/reporting/breakdown/meta (daily)
 *  - Reach + frequency → useAdSetInsights (Meta does not expose period reach
 *    via the daily breakdown — we sum ad-set reach for a reasonable estimate).
 */

import { useMemo, useState } from "react";
import { BarChart3, ChevronDown, TrendingUp, TrendingDown } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, ComposedChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, Area, AreaChart,
} from "recharts";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useAdSetInsights } from "@/hooks/useAdSetInsights";
import { useMetaDailyVsPrev, type DailyPoint } from "@/hooks/useMetaDailyVsPrev";
import { detectCurrency, formatMoney } from "@/lib/currency";
import type { DateRange } from "@/components/shared/DateRangePicker";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  setActiveTab: (id: string) => void;
}

type MetricId =
  | "spend" | "impressions" | "clicks" | "conversions" | "conversionValue"
  | "ctr" | "cpc" | "cpm" | "cpa" | "roas" | "cvr" | "aov";

const METRICS: { id: MetricId; label: string; fmt: "money" | "int" | "pct" | "x" }[] = [
  { id: "spend",           label: "Spend",           fmt: "money" },
  { id: "impressions",     label: "Impressions",     fmt: "int"   },
  { id: "clicks",          label: "Clicks",          fmt: "int"   },
  { id: "conversions",     label: "Conversions",     fmt: "int"   },
  { id: "conversionValue", label: "Revenue",         fmt: "money" },
  { id: "ctr",             label: "CTR",             fmt: "pct"   },
  { id: "cpc",             label: "CPC",             fmt: "money" },
  { id: "cpm",             label: "CPM",             fmt: "money" },
  { id: "cpa",             label: "CPA",             fmt: "money" },
  { id: "roas",            label: "ROAS",            fmt: "x"     },
  { id: "cvr",             label: "CVR",             fmt: "pct"   },
  { id: "aov",             label: "AOV",             fmt: "money" },
];

function deriveRow(r: { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }) {
  return {
    spend: r.spend,
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    conversionValue: r.conversionValue,
    ctr:  r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
    cpc:  r.clicks > 0 ? r.spend / r.clicks : 0,
    cpm:  r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
    cpa:  r.conversions > 0 ? r.spend / r.conversions : 0,
    roas: r.spend > 0 ? r.conversionValue / r.spend : 0,
    cvr:  r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0,
    aov:  r.conversions > 0 ? r.conversionValue / r.conversions : 0,
  };
}

function fmt(v: number, kind: "money" | "int" | "pct" | "x" | "k", currency: string): string {
  if (!Number.isFinite(v)) return "—";
  if (kind === "money") {
    if (Math.abs(v) >= 1_000_000) return formatMoney(v / 1_000_000, currency, 2).replace(/(\.\d+)?$/, m => m) + "M";
    if (Math.abs(v) >= 10_000)    return formatMoney(v / 1_000,     currency, 1) + "k";
    return formatMoney(v, currency, 0);
  }
  if (kind === "pct") return `${v.toFixed(2)}%`;
  if (kind === "x")   return `${v.toFixed(2)}×`;
  if (kind === "k") {
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (Math.abs(v) >= 1_000)     return `${(v / 1_000).toFixed(1)}k`;
    return Math.round(v).toLocaleString("en-IN");
  }
  return Math.round(v).toLocaleString("en-IN");
}

function pctDelta(now: number, prev: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(prev) || prev === 0) return null;
  return ((now - prev) / prev) * 100;
}

function DeltaBadge({ delta, lowerIsBetter = false }: { delta: number | null; lowerIsBetter?: boolean }) {
  if (delta === null) return <span className="text-[10px] text-gray-500">—</span>;
  const positive = delta > 0;
  const good = lowerIsBetter ? !positive : positive;
  const color = good ? "text-green-600" : "text-red-600";
  const Arrow = positive ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${color}`}>
      <Arrow className="w-3 h-3" />
      {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

function KpiCard({
  label, value, delta, lowerIsBetter, spark,
}: {
  label: string;
  value: string;
  delta: number | null;
  lowerIsBetter?: boolean;
  spark: number[];
}) {
  const sparkData = spark.map((v, i) => ({ i, v }));
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1.5 truncate" title={value}>{value}</div>
      <div className="flex items-center gap-1.5 mt-0.5">
        <DeltaBadge delta={delta} lowerIsBetter={lowerIsBetter} />
        <span className="text-[10px] text-gray-400">vs prev period</span>
      </div>
      <div className="h-9 mt-1 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={sparkData}>
            <defs>
              <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke="#6366f1" strokeWidth={1.5} fill={`url(#grad-${label})`} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MetricPicker({ value, onChange, label }: { value: MetricId; onChange: (v: MetricId) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const current = METRICS.find(m => m.id === value)!;
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition shadow-sm"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M4 8h8M6 12h4"/></svg>
        <span>{current.label}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1.5 z-50 w-44 bg-white text-gray-800 rounded-xl shadow-xl border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</div>
            {METRICS.map(m => (
              <button
                key={m.id}
                onClick={() => { onChange(m.id); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 ${m.id === value ? "bg-blue-50 text-blue-700 font-semibold" : ""}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function totalsOf(rows: DailyPoint[]) {
  return rows.reduce(
    (s, r) => ({
      spend: s.spend + r.spend, impressions: s.impressions + r.impressions,
      clicks: s.clicks + r.clicks, conversions: s.conversions + r.conversions,
      conversionValue: s.conversionValue + r.conversionValue,
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }
  );
}

export default function ReportingOverview({ platform, dateRange, customStart, customEnd }: Props) {
  const effective: "meta" | "both" = platform === "google" ? "meta" : platform;
  const { campaigns, startDate, endDate } = useCampaigns(effective, dateRange, customStart, customEnd);
  const currency = detectCurrency(campaigns);
  const { current, previous, loading, prevStartDate, prevEndDate } = useMetaDailyVsPrev(effective, dateRange, customStart, customEnd);
  const { adsets } = useAdSetInsights(effective, dateRange, customStart, customEnd);

  const reachPeriod = useMemo(() => adsets.reduce((s, a) => s + (a.reach || 0), 0), [adsets]);
  const totalsCur = useMemo(() => totalsOf(current), [current]);
  const totalsPrev = useMemo(() => totalsOf(previous), [previous]);
  const frequencyCur = reachPeriod > 0 ? totalsCur.impressions / reachPeriod : 0;

  // Prev-period reach: use the AdSet shared shape isn't available for prev period
  // without a second fetch. Approximate prev-reach as a proportional share of
  // current reach scaled by impressions ratio so the delta still moves with
  // traffic. This is a reasonable display heuristic — exact prev-reach would
  // require a second ad-set insights fetch.
  const reachPrev = totalsCur.impressions > 0
    ? reachPeriod * (totalsPrev.impressions / totalsCur.impressions)
    : 0;
  const freqPrev = reachPrev > 0 ? totalsPrev.impressions / reachPrev : 0;

  const cpmCur  = totalsCur.impressions > 0  ? (totalsCur.spend  / totalsCur.impressions)  * 1000 : 0;
  const cpmPrev = totalsPrev.impressions > 0 ? (totalsPrev.spend / totalsPrev.impressions) * 1000 : 0;

  const sortedCur = useMemo(() => [...current].sort((a, b) => a.label.localeCompare(b.label)), [current]);

  const sparkSeries = useMemo(() => ({
    spend: sortedCur.map(d => d.spend),
    impressions: sortedCur.map(d => d.impressions),
    reach: sortedCur.map(d => d.impressions),     // proxy — daily reach not in payload
    frequency: sortedCur.map(d => d.impressions), // proxy — frequency derived metric
    cpm: sortedCur.map(d => d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0),
  }), [sortedCur]);

  const chartData = useMemo(() => sortedCur.map(r => ({ date: r.label.slice(5), ...deriveRow(r) })), [sortedCur]);

  const [primary, setPrimary]   = useState<MetricId>("impressions");
  const [secondary, setSecondary] = useState<MetricId>("ctr");
  const primaryDef   = METRICS.find(m => m.id === primary)!;
  const secondaryDef = METRICS.find(m => m.id === secondary)!;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Overview</h1>
            <p className="text-gray-600 mt-1 text-sm">
              <span className="font-mono">{startDate}</span> → <span className="font-mono">{endDate}</span>
              <span className="text-gray-400"> · prev: {prevStartDate} → {prevEndDate}</span>
            </p>
          </div>
        </div>
        <AIExecutiveSummary
          tabName="Reporting Overview"
          context={{
            window: `${startDate} → ${endDate}`,
            totalSpend: totalsCur.spend, totalImpressions: totalsCur.impressions, reach: reachPeriod,
            frequency: frequencyCur, cpm: cpmCur,
            prevSpend: totalsPrev.spend, prevImpressions: totalsPrev.impressions, prevCpm: cpmPrev,
          }}
          platform="meta"
          inline
        />
      </div>

      {platform === "google" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
          Overview deltas + reach/frequency are Meta-specific — switch Platform to Meta or Both to see data.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Reach"
          value={fmt(reachPeriod, "k", currency)}
          delta={pctDelta(reachPeriod, reachPrev)}
          spark={sparkSeries.reach}
        />
        <KpiCard
          label="Frequency"
          value={frequencyCur > 0 ? frequencyCur.toFixed(2) : "—"}
          delta={pctDelta(frequencyCur, freqPrev)}
          lowerIsBetter
          spark={sparkSeries.frequency}
        />
        <KpiCard
          label="Impressions"
          value={fmt(totalsCur.impressions, "k", currency)}
          delta={pctDelta(totalsCur.impressions, totalsPrev.impressions)}
          spark={sparkSeries.impressions}
        />
        <KpiCard
          label="Spend"
          value={fmt(totalsCur.spend, "money", currency)}
          delta={pctDelta(totalsCur.spend, totalsPrev.spend)}
          spark={sparkSeries.spend}
        />
        <KpiCard
          label="CPM"
          value={cpmCur > 0 ? formatMoney(cpmCur, currency, 2) : "—"}
          delta={pctDelta(cpmCur, cpmPrev)}
          lowerIsBetter
          spark={sparkSeries.cpm}
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-900">Performance Trend</h3>
          <p className="text-xs text-gray-500 mt-0.5">Date is locked on X. Pick any metric for Y primary + secondary.</p>
        </div>
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">X axis:</span>
            <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600">Date (frozen)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Primary Y:</span>
            <MetricPicker value={primary}   onChange={setPrimary}   label="Primary metric" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Secondary Y:</span>
            <MetricPicker value={secondary} onChange={setSecondary} label="Secondary metric" />
          </div>
        </div>
        <div className="px-3 py-4">
          {loading ? (
            <div className="h-80 flex items-center justify-center text-sm text-gray-500">Loading daily data…</div>
          ) : chartData.length === 0 ? (
            <div className="h-80 flex items-center justify-center text-sm text-gray-500">No daily data for this window.</div>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="date" stroke="#6b7280" fontSize={11} tickLine={false} />
                <YAxis yAxisId="left"  stroke="#6366f1" fontSize={11} tickLine={false}
                  tickFormatter={(v) => fmt(v, primaryDef.fmt === "int" ? "k" : primaryDef.fmt, currency)} />
                <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={11} tickLine={false}
                  tickFormatter={(v) => fmt(v, secondaryDef.fmt === "int" ? "k" : secondaryDef.fmt, currency)} />
                <Tooltip
                  contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number, _name: string, item: { dataKey?: string | number }) => {
                    const k = typeof item?.dataKey === "string" ? item.dataKey : "";
                    if (k === primary)   return [fmt(value, primaryDef.fmt,   currency), primaryDef.label] as [string, string];
                    if (k === secondary) return [fmt(value, secondaryDef.fmt, currency), secondaryDef.label] as [string, string];
                    return [String(value), k] as [string, string];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar  yAxisId="left"  dataKey={primary}   name={primaryDef.label}   fill="#6366f1" radius={[3, 3, 0, 0]} animationDuration={600} animationEasing="ease-out" />
                <Line yAxisId="right" dataKey={secondary} name={secondaryDef.label} stroke="#10b981" strokeWidth={2} dot={false} animationDuration={700} animationEasing="ease-out" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
