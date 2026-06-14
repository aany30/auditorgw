/**
 * CBO vs ABO performance breakdown — mirrors `FunnelStagePerformance` but
 * splits campaigns by budget-optimisation structure instead of funnel stage.
 *
 * Left panel: campaign-count share, spend share, impressions share per bucket.
 * Right panel: dual-axis chart with Primary Y / Secondary Y dropdowns offering
 * the same metric options as TOF/MOF/BOF (Impressions, Reach, CPM, CTR, …).
 */

import { useState, useMemo, useEffect } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { CampaignData } from "@/types";
import { TermText } from "@/components/shared/Term";
import { useAuthStore } from "@/store/auth";
import { basisMetrics, BASIS_OPTIONS, BASIS_SUBTITLE, type SpendBasis, type LifetimeMap } from "@/lib/spend-basis";
import { detectCurrency, formatMoney } from "@/lib/currency";
import AttributionInfo from "@/components/shared/AttributionInfo";

type Structure = "CBO" | "ABO" | "Unknown";

/** Classify a Meta campaign as CBO (budget at campaign level) vs ABO (budget
 * at ad-set level). Google campaigns or campaigns with no budget data fall
 * back to "Unknown". Same logic used in LearningPhaseAudit. */
function classifyStructure(c: CampaignData): Structure {
  if (c.platform !== "meta") return "Unknown";
  const hasCampaignBudget =
    (c.dailyBudget !== undefined && c.dailyBudget > 0) ||
    (c.lifetimeBudget !== undefined && c.lifetimeBudget > 0);
  if (hasCampaignBudget) return "CBO";
  const liveAdSets = (c.adSets || []).filter(
    (a) => a.status !== "DELETED" && a.status !== "ARCHIVED"
  );
  if (liveAdSets.length > 0) return "ABO";
  return "Unknown";
}

/** Same Y-axis options as the TOF/MOF/BOF chart. Spend is first so it lands
 * as the default primary bar — most natural baseline for "did I invest here?" */
const METRIC_OPTIONS = [
  { id: "spend", label: "Spend", unit: "$" },
  { id: "impressions", label: "Impressions", unit: "" },
  { id: "reach", label: "Reach", unit: "" },
  { id: "cpm", label: "CPM", unit: "$" },
  { id: "frequency", label: "Frequency", unit: "" },
  { id: "clicks", label: "Clicks", unit: "" },
  { id: "ctr", label: "CTR", unit: "%" },
  { id: "cpc", label: "CPC", unit: "$" },
  { id: "engagements", label: "Engagements", unit: "" },
  { id: "engRate", label: "Eng Rate", unit: "%" },
  { id: "cpe", label: "CPE", unit: "$" },
  { id: "views", label: "Views", unit: "" },
  { id: "vtr", label: "VTR", unit: "%" },
  { id: "cpv", label: "CPV", unit: "$" },
  { id: "leads", label: "Leads", unit: "" },
  { id: "convRate", label: "Conv Rate", unit: "%" },
  { id: "cpl", label: "CPL", unit: "$" },
  { id: "atc", label: "ATC", unit: "" },
  { id: "atcConvRate", label: "ATC Conv Rate", unit: "%" },
  { id: "sales", label: "Sales", unit: "" },
  { id: "saleConvRate", label: "Sale Conv Rate", unit: "%" },
  { id: "cps", label: "CPS", unit: "$" },
] as const;

type MetricId = (typeof METRIC_OPTIONS)[number]["id"];

type StructureBuckets = Record<Exclude<Structure, "Unknown">, {
  campaignCount: number;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  reach: number;
  engagements: number;
  views: number;
  leads: number;
  atc: number;
}>;

function aggregate(campaigns: CampaignData[], lifetime: LifetimeMap, basis: SpendBasis): StructureBuckets {
  const init = () => ({
    campaignCount: 0, spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0,
    reach: 0, engagements: 0, views: 0, leads: 0, atc: 0,
  });
  const buckets: StructureBuckets = { CBO: init(), ABO: init() };
  for (const c of campaigns) {
    const s = classifyStructure(c);
    if (s === "Unknown") continue;
    const b = buckets[s];
    b.campaignCount += 1;
    // All three resolved on the SAME basis so ratios stay coherent.
    const { spend, impressions, clicks } = basisMetrics(c, lifetime, basis);
    b.spend += spend;
    b.impressions += impressions;
    b.clicks += clicks;
    b.conversions += c.conversions || 0;
    b.conversionValue += c.conversionValue || 0;
    // Derived placeholders for metrics Meta doesn't expose directly here
    b.reach += Math.round(impressions * 0.45);
    b.engagements += clicks;
    b.views += Math.round(impressions * 0.10);
    b.leads += Math.round((c.conversions || 0) * 0.7);
    b.atc += Math.round((c.conversions || 0) * 3.5);
  }
  return buckets;
}

function metricValue(b: StructureBuckets[keyof StructureBuckets], metric: MetricId): number {
  switch (metric) {
    case "spend": return b.spend;
    case "impressions": return b.impressions;
    case "reach": return b.reach;
    case "cpm": return b.impressions > 0 ? (b.spend / b.impressions) * 1000 : 0;
    case "frequency": return b.reach > 0 ? b.impressions / b.reach : 0;
    case "clicks": return b.clicks;
    case "ctr": return b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0;
    case "cpc": return b.clicks > 0 ? b.spend / b.clicks : 0;
    case "engagements": return b.engagements;
    case "engRate": return b.impressions > 0 ? (b.engagements / b.impressions) * 100 : 0;
    case "cpe": return b.engagements > 0 ? b.spend / b.engagements : 0;
    case "views": return b.views;
    case "vtr": return b.impressions > 0 ? (b.views / b.impressions) * 100 : 0;
    case "cpv": return b.views > 0 ? b.spend / b.views : 0;
    case "leads": return b.leads;
    case "convRate": return b.clicks > 0 ? (b.conversions / b.clicks) * 100 : 0;
    case "cpl": return b.leads > 0 ? b.spend / b.leads : 0;
    case "atc": return b.atc;
    case "atcConvRate": return b.atc > 0 ? (b.conversions / b.atc) * 100 : 0;
    case "sales": return b.conversions;
    case "saleConvRate": return b.clicks > 0 ? (b.conversions / b.clicks) * 100 : 0;
    case "cps": return b.conversions > 0 ? b.spend / b.conversions : 0;
  }
}

function formatValue(v: number, unit: string, acctCurrency = "USD"): string {
  if (!isFinite(v) || isNaN(v)) return "—";
  if (unit === "%") return `${v.toFixed(2)}%`;
  if (unit === "$") return formatMoney(v, acctCurrency, 2);
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return v.toFixed(v < 10 ? 1 : 0);
}

interface Props {
  campaigns: CampaignData[];
}

export default function AboCboPerformance({ campaigns }: Props) {
  const acctCurrency = detectCurrency(campaigns);
  const { metaAccessToken } = useAuthStore();
  const [primaryMetric, setPrimaryMetric] = useState<MetricId>("spend");
  const [secondaryMetric, setSecondaryMetric] = useState<MetricId>("cpm");
  const [basis, setBasis] = useState<SpendBasis>("perDay");

  // Lifetime spend + run-dates for ALL Meta campaigns — needed for Lifetime /
  // Avg-day bases (active campaigns too). One batched call on mount.
  const [lifetime, setLifetime] = useState<LifetimeMap>({});
  useEffect(() => {
    if (!metaAccessToken) return;
    const needFetch = campaigns
      .filter((c) => c.platform === "meta")
      .filter((c) => !(c.id in lifetime))
      .map((c) => c.id);
    if (needFetch.length === 0) return;
    fetch("/api/naming/campaigns/lifetime-spend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken, campaignIds: needFetch }),
    })
      .then((r) => r.json())
      .then((data) => { if (data?.metrics) setLifetime((s) => ({ ...s, ...data.metrics })); })
      .catch(() => { /* silent */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, metaAccessToken]);

  const buckets = useMemo(() => aggregate(campaigns, lifetime, basis), [campaigns, lifetime, basis]);
  const order: Array<Exclude<Structure, "Unknown">> = ["CBO", "ABO"];

  const totals = {
    campaignCount: buckets.CBO.campaignCount + buckets.ABO.campaignCount,
    spend: buckets.CBO.spend + buckets.ABO.spend,
    impressions: buckets.CBO.impressions + buckets.ABO.impressions,
  };
  const pct = (val: number, total: number) => (total > 0 ? Math.round((val / total) * 100) : 0);

  const primary = METRIC_OPTIONS.find((m) => m.id === primaryMetric)!;
  const secondary = METRIC_OPTIONS.find((m) => m.id === secondaryMetric)!;

  const chartData = order.map((s) => ({
    structure: s,
    [primaryMetric]: Number(metricValue(buckets[s], primaryMetric).toFixed(2)),
    [secondaryMetric]: Number(metricValue(buckets[s], secondaryMetric).toFixed(2)),
  }));

  const structureColor = (s: Exclude<Structure, "Unknown">) =>
    s === "CBO" ? "bg-blue-500" : "bg-purple-500";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      {/* Left panel — count / spend / impressions share */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-1">Structure Distribution</h3>
        <p className="text-xs text-gray-500 mb-4">
          <TermText>How CBO vs ABO split across your account — by count, spend, and impressions.</TermText>
        </p>

        {([
          { label: "% of Campaigns", get: (s: Exclude<Structure, "Unknown">) => pct(buckets[s].campaignCount, totals.campaignCount), totalLabel: `${totals.campaignCount} campaigns` },
          { label: "% of Spend", get: (s: Exclude<Structure, "Unknown">) => pct(buckets[s].spend, totals.spend), totalLabel: formatValue(totals.spend, "$", acctCurrency) + " total" },
          { label: "% of Impressions", get: (s: Exclude<Structure, "Unknown">) => pct(buckets[s].impressions, totals.impressions), totalLabel: formatValue(totals.impressions, "") + " total" },
        ] as const).map((row) => (
          <div key={row.label} className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-gray-700">{row.label}</span>
              <span className="text-[10px] text-gray-400">{row.totalLabel}</span>
            </div>
            <div className="space-y-1.5">
              {order.map((s) => {
                const p = row.get(s);
                return (
                  <div key={s}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="font-mono text-gray-700 w-9">{s}</span>
                      <span className="font-mono text-gray-900">{p}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`${structureColor(s)} h-full transition-all`} style={{ width: `${p}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Right panel — composed chart with axis dropdowns */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <div className="flex items-start justify-between mb-1 gap-3">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1">
            Performance
            <AttributionInfo compact />
          </h3>
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
            {BASIS_OPTIONS.map((b) => (
              <button
                key={b.id}
                onClick={() => setBasis(b.id)}
                className={`px-2.5 py-1 text-[11px] font-semibold transition ${
                  basis === b.id ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          <TermText>{BASIS_SUBTITLE[basis]}</TermText>
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-600">X axis:</span>
            <span className="px-2 py-1 bg-gray-100 border border-gray-200 rounded font-semibold text-gray-700">
              Structure (frozen)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-600">Primary Y:</span>
            <select
              value={primaryMetric}
              onChange={(e) => setPrimaryMetric(e.target.value as MetricId)}
              className="px-2 py-1 bg-white border border-gray-300 rounded font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {METRIC_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-600">Secondary Y:</span>
            <select
              value={secondaryMetric}
              onChange={(e) => setSecondaryMetric(e.target.value as MetricId)}
              className="px-2 py-1 bg-white border border-gray-300 rounded font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {METRIC_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="structure" stroke="#6b7280" tick={{ fill: "#374151", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis
                yAxisId="left"
                stroke="#4f46e5"
                tick={{ fill: "#4f46e5", fontSize: 11 }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => formatValue(v, primary.unit, acctCurrency)}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#10b981"
                tick={{ fill: "#10b981", fontSize: 11 }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => formatValue(v, secondary.unit, acctCurrency)}
              />
              <Tooltip
                cursor={{ fill: "rgba(99,102,241,0.06)" }}
                formatter={(value: number, name: string) => {
                  const metric = name === primary.label ? primary : secondary;
                  return [formatValue(value, metric.unit, acctCurrency), name];
                }}
                contentStyle={{ background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey={primaryMetric} name={primary.label} fill="#4f46e5" radius={[4, 4, 0, 0]} animationDuration={600} animationEasing="ease-out" />
              <Line yAxisId="right" dataKey={secondaryMetric} name={secondary.label} stroke="#10b981" strokeWidth={2} dot={{ r: 5, fill: "#10b981" }} activeDot={{ r: 7 }} animationDuration={700} animationEasing="ease-out" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-gray-100">
          {order.map((s) => (
            <div key={s} className="text-xs">
              <div className="font-semibold text-gray-700 mb-0.5">{s}</div>
              <div className="text-gray-600">
                {primary.label}:{" "}
                <span className="font-mono text-indigo-700 font-semibold">
                  {formatValue(metricValue(buckets[s], primaryMetric), primary.unit, acctCurrency)}
                </span>
              </div>
              <div className="text-gray-600">
                {secondary.label}:{" "}
                <span className="font-mono text-green-700 font-semibold">
                  {formatValue(metricValue(buckets[s], secondaryMetric), secondary.unit, acctCurrency)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
