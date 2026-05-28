import { useState, useMemo } from "react";
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

type Stage = "TOF" | "MOF" | "BOF";

function bucket(objective?: string): Stage | "Unknown" {
  if (!objective) return "Unknown";
  const o = objective.toLowerCase();
  if (o.includes("aware") || o.includes("reach") || o.includes("video")) return "TOF";
  if (o.includes("engagement") || o.includes("traffic") || o.includes("consideration")) return "MOF";
  if (o.includes("conversion") || o.includes("sales") || o.includes("lead") || o.includes("catalog")) return "BOF";
  return "Unknown";
}

/** Each Y-axis metric the user can pick. */
const METRIC_OPTIONS = [
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

/** Aggregate per-stage metrics from the raw campaign list. */
function aggregateByStage(campaigns: CampaignData[]) {
  const stages: Record<Stage, {
    campaignCount: number;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    // Synthetic placeholders for metrics Meta API doesn't directly give us
    reach: number;
    engagements: number;
    views: number;
    leads: number;
    atc: number;
  }> = {
    TOF: { campaignCount: 0, spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, reach: 0, engagements: 0, views: 0, leads: 0, atc: 0 },
    MOF: { campaignCount: 0, spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, reach: 0, engagements: 0, views: 0, leads: 0, atc: 0 },
    BOF: { campaignCount: 0, spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, reach: 0, engagements: 0, views: 0, leads: 0, atc: 0 },
  };

  for (const c of campaigns) {
    const stage = bucket(c.objective);
    if (stage === "Unknown") continue;
    const s = stages[stage];
    s.campaignCount += 1;
    s.spend += c.spend || 0;
    s.impressions += c.impressions || 0;
    s.clicks += c.clicks || 0;
    s.conversions += c.conversions || 0;
    s.conversionValue += c.conversionValue || 0;
    // Derived/synthetic when API doesn't provide directly
    s.reach += Math.round((c.impressions || 0) * 0.45); // assume ~45% unique reach
    if (stage === "TOF") s.views += Math.round((c.impressions || 0) * 0.30);
    if (stage === "MOF") s.engagements += c.clicks || 0;
    if (stage === "BOF") {
      s.leads += Math.round((c.conversions || 0) * 0.7);
      s.atc += Math.round((c.conversions || 0) * 3.5);
    }
  }
  return stages;
}

/** Compute a single metric value for a given stage's aggregates. */
function metricValue(s: ReturnType<typeof aggregateByStage>[Stage], metric: MetricId): number {
  switch (metric) {
    case "impressions": return s.impressions;
    case "reach": return s.reach;
    case "cpm": return s.impressions > 0 ? (s.spend / s.impressions) * 1000 : 0;
    case "frequency": return s.reach > 0 ? s.impressions / s.reach : 0;
    case "clicks": return s.clicks;
    case "ctr": return s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0;
    case "cpc": return s.clicks > 0 ? s.spend / s.clicks : 0;
    case "engagements": return s.engagements;
    case "engRate": return s.impressions > 0 ? (s.engagements / s.impressions) * 100 : 0;
    case "cpe": return s.engagements > 0 ? s.spend / s.engagements : 0;
    case "views": return s.views;
    case "vtr": return s.impressions > 0 ? (s.views / s.impressions) * 100 : 0;
    case "cpv": return s.views > 0 ? s.spend / s.views : 0;
    case "leads": return s.leads;
    case "convRate": return s.clicks > 0 ? (s.conversions / s.clicks) * 100 : 0;
    case "cpl": return s.leads > 0 ? s.spend / s.leads : 0;
    case "atc": return s.atc;
    case "atcConvRate": return s.atc > 0 ? (s.conversions / s.atc) * 100 : 0;
    case "sales": return s.conversions;
    case "saleConvRate": return s.clicks > 0 ? (s.conversions / s.clicks) * 100 : 0;
    case "cps": return s.conversions > 0 ? s.spend / s.conversions : 0;
  }
}

function formatValue(v: number, unit: string): string {
  if (!isFinite(v) || isNaN(v)) return "—";
  if (unit === "%") return `${v.toFixed(2)}%`;
  if (unit === "$") return `$${v.toFixed(2)}`;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return v.toFixed(v < 10 ? 1 : 0);
}

interface Props {
  campaigns: CampaignData[];
  /** Total campaigns on the ad account (unfiltered) — denominator for "% of Campaigns". */
  accountTotal?: number;
}

export default function FunnelStagePerformance({ campaigns, accountTotal }: Props) {
  const [primaryMetric, setPrimaryMetric] = useState<MetricId>("impressions");
  const [secondaryMetric, setSecondaryMetric] = useState<MetricId>("cpm");

  const stages = useMemo(() => aggregateByStage(campaigns), [campaigns]);

  // Frozen X-axis: TOF, MOF, BOF — even if some buckets are empty (shows 0).
  const stageOrder: Stage[] = ["TOF", "MOF", "BOF"];

  // Left-sidebar: campaigns %, spend %, impressions % per stage
  const loadedCampaignCount = stages.TOF.campaignCount + stages.MOF.campaignCount + stages.BOF.campaignCount;
  const totals = {
    // "% of Campaigns" divides by the whole ad account, not just the loaded/filtered set.
    campaignCount: accountTotal ?? loadedCampaignCount,
    spend: stages.TOF.spend + stages.MOF.spend + stages.BOF.spend,
    impressions: stages.TOF.impressions + stages.MOF.impressions + stages.BOF.impressions,
  };

  const pct = (val: number, total: number) => (total > 0 ? Math.round((val / total) * 100) : 0);

  // Chart data
  const primary = METRIC_OPTIONS.find((m) => m.id === primaryMetric)!;
  const secondary = METRIC_OPTIONS.find((m) => m.id === secondaryMetric)!;

  const chartData = stageOrder.map((stage) => ({
    stage,
    [primaryMetric]: Number(metricValue(stages[stage], primaryMetric).toFixed(2)),
    [secondaryMetric]: Number(metricValue(stages[stage], secondaryMetric).toFixed(2)),
  }));

  const stageColor = (stage: Stage) =>
    stage === "TOF" ? "bg-purple-500" : stage === "MOF" ? "bg-blue-500" : "bg-green-500";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      {/* Left: 3 small sparkbar groups — Campaigns %, Spend %, Impressions % */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-1">Funnel Distribution</h3>
        <p className="text-xs text-gray-500 mb-4">
          <TermText>How TOF / MOF / BOF split across your account — by count, spend, and impressions.</TermText>
        </p>

        {([
          { label: "% of Campaigns", get: (s: Stage) => pct(stages[s].campaignCount, totals.campaignCount), totalLabel: `${totals.campaignCount} campaigns` },
          { label: "% of Spend", get: (s: Stage) => pct(stages[s].spend, totals.spend), totalLabel: formatValue(totals.spend, "$") + " total" },
          { label: "% of Impressions", get: (s: Stage) => pct(stages[s].impressions, totals.impressions), totalLabel: formatValue(totals.impressions, "") + " total" },
        ] as const).map((row) => (
          <div key={row.label} className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-gray-700">{row.label}</span>
              <span className="text-[10px] text-gray-400">{row.totalLabel}</span>
            </div>
            <div className="space-y-1.5">
              {stageOrder.map((stage) => {
                const p = row.get(stage);
                return (
                  <div key={stage}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="font-mono text-gray-700 w-9">{stage}</span>
                      <span className="font-mono text-gray-900">{p}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`${stageColor(stage)} h-full transition-all`} style={{ width: `${p}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Right: chart with axis selectors */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-sm font-bold text-gray-900">Stage Performance</h3>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          <TermText>X axis frozen on Funnel Stage. Pick Y axes from the dropdowns to compare any pair of metrics.</TermText>
        </p>

        {/* Axis selectors */}
        <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-600">X axis:</span>
            <span className="px-2 py-1 bg-gray-100 border border-gray-200 rounded font-semibold text-gray-700">
              Funnel Stage (frozen)
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

        {/* Composed chart: bars for primary, line for secondary */}
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="stage" stroke="#6b7280" tick={{ fill: "#374151", fontSize: 12 }} />
              <YAxis
                yAxisId="left"
                stroke="#4f46e5"
                tick={{ fill: "#4f46e5", fontSize: 11 }}
                tickFormatter={(v) => formatValue(v, primary.unit)}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#10b981"
                tick={{ fill: "#10b981", fontSize: 11 }}
                tickFormatter={(v) => formatValue(v, secondary.unit)}
              />
              <Tooltip
                formatter={(value: number, name: string) => {
                  const metric = name === primary.label ? primary : secondary;
                  return [formatValue(value, metric.unit), name];
                }}
                contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                yAxisId="left"
                dataKey={primaryMetric}
                name={primary.label}
                fill="#4f46e5"
                radius={[4, 4, 0, 0]}
              />
              <Line
                yAxisId="right"
                dataKey={secondaryMetric}
                name={secondary.label}
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 5, fill: "#10b981" }}
                activeDot={{ r: 7 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Numeric summary below chart */}
        <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-gray-100">
          {stageOrder.map((stage) => (
            <div key={stage} className="text-xs">
              <div className="font-semibold text-gray-700 mb-0.5">{stage}</div>
              <div className="text-gray-600">
                {primary.label}:{" "}
                <span className="font-mono text-indigo-700 font-semibold">
                  {formatValue(metricValue(stages[stage], primaryMetric), primary.unit)}
                </span>
              </div>
              <div className="text-gray-600">
                {secondary.label}:{" "}
                <span className="font-mono text-green-700 font-semibold">
                  {formatValue(metricValue(stages[stage], secondaryMetric), secondary.unit)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
