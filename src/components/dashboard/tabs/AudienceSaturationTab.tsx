/**
 * Campaign → Saturation (doc §7, §8)
 *
 * §7 Audience Saturation  — frequency, CTR, CPM, reach%, fatigue score per ad set.
 * §8 Expansion Opportunity — spend share%, revenue share%, ROAS, opportunity score.
 *
 * Both use ad-set insights (frequency + reach available from Meta Insights API).
 */

import { useMemo, useState } from "react";
import { Zap, AlertCircle, Info } from "lucide-react";
import AIRecommendationButton from "@/components/shared/AIRecommendationButton";
import { useAdSetInsights } from "@/hooks/useAdSetInsights";
import { formatMoney } from "@/lib/currency";
import type { DateRange } from "@/components/shared/DateRangePicker";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  selectedObjectives?: Set<string>;
  setActiveTab?: (id: string) => void;
}

const SUB_TABS = [
  { id: "saturation", label: "Saturation",          desc: "Frequency, reach%, fatigue score (§7)" },
  { id: "expansion",  label: "Expansion Opportunity", desc: "Spend share vs ROAS opportunity (§8)" },
];

// ─── Fatigue score & status ─────────────────────────────────────────────────

function fatigueLabel(freq: number, ctr: number): { label: string; color: string } {
  if (freq >= 5 || ctr < 0.5)  return { label: "Critical", color: "bg-red-100 text-red-800" };
  if (freq >= 3 || ctr < 1.0)  return { label: "Fatigued",  color: "bg-orange-100 text-orange-800" };
  return { label: "Healthy", color: "bg-green-100 text-green-800" };
}

// ─── §7 Saturation ──────────────────────────────────────────────────────────

function SaturationAnalysis({ adsets, loading, currency }: { adsets: ReturnType<typeof useAdSetInsights>["adsets"]; loading: boolean; currency: string }) {
  const totalReach = useMemo(() => adsets.reduce((s, a) => s + a.reach, 0), [adsets]);
  const sorted = useMemo(() => [...adsets].sort((a, b) => b.frequency - a.frequency), [adsets]);
  const cur = (n: number) => formatMoney(n, currency, 0);

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (!adsets.length) return (
    <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
      No ad set data. Connect a Meta account or widen the date range.
    </div>
  );

  const critical = sorted.filter((a) => fatigueLabel(a.frequency, a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0).label === "Critical").length;

  return (
    <div className="space-y-4">
      {critical > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-xs text-red-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <strong>{critical} ad set{critical !== 1 ? "s" : ""} showing critical fatigue</strong> — frequency ≥ 5 or CTR &lt; 0.5%. Consider refreshing creatives or expanding audiences.
        </div>
      )}
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Audience (Ad Set)</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Frequency</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">CTR</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">CPM</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Reach</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Reach %</th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-600 uppercase">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
              const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
              const reachPct = totalReach > 0 ? (a.reach / totalReach) * 100 : 0;
              const { label, color } = fatigueLabel(a.frequency, ctr);
              return (
                <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-gray-900 truncate max-w-[220px]" title={a.name}>{a.name}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`font-bold ${a.frequency >= 5 ? "text-red-600" : a.frequency >= 3 ? "text-orange-600" : "text-gray-900"}`}>
                      {a.frequency.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{ctr > 0 ? `${ctr.toFixed(2)}%` : "—"}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{cpm > 0 ? cur(cpm) : "—"}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{Math.round(a.reach).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{reachPct > 0 ? `${reachPct.toFixed(1)}%` : "—"}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>{label}</span>
                    {label !== "Healthy" && (
                      <div className="mt-1">
                        <AIRecommendationButton
                          metric={`Audience fatigue — ${a.name}`}
                          value={a.frequency}
                          status={label === "Critical" ? "critical" : "warn"}
                          platform="meta"
                          auditContext={{ module: "Audience Saturation", siblingMetrics: { frequency: a.frequency, ctr: +ctr.toFixed(2), cpm: +cpm.toFixed(2) } }}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">
        Fatigue thresholds: Frequency ≥ 5 or CTR &lt; 0.5% → Critical · Frequency ≥ 3 or CTR &lt; 1% → Fatigued. Reach % = ad set reach as a share of total account reach.
      </p>
    </div>
  );
}

// ─── §8 Expansion Opportunity ───────────────────────────────────────────────

type OpportunityLabel = "Scale up" | "Maintain" | "Review" | "Reduce";

function opportunityLabel(roas: number, spendSharePct: number): { label: OpportunityLabel; color: string } {
  if (roas >= 3 && spendSharePct < 20) return { label: "Scale up", color: "bg-green-100 text-green-800" };
  if (roas >= 2 && spendSharePct < 30) return { label: "Maintain",  color: "bg-blue-100 text-blue-800" };
  if (roas < 1)                         return { label: "Reduce",    color: "bg-red-100 text-red-800" };
  return { label: "Review", color: "bg-yellow-100 text-yellow-800" };
}

function ExpansionOpportunity({ adsets, loading, currency }: { adsets: ReturnType<typeof useAdSetInsights>["adsets"]; loading: boolean; currency: string }) {
  const totalSpend   = useMemo(() => adsets.reduce((s, a) => s + a.spend, 0), [adsets]);
  const totalRevenue = useMemo(() => adsets.reduce((s, a) => s + a.conversionValue, 0), [adsets]);
  const sorted = useMemo(() => [...adsets].sort((a, b) => b.spend - a.spend), [adsets]);
  const cur = (n: number) => formatMoney(n, currency, 0);

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (!adsets.length) return (
    <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
      No ad set data. Connect a Meta account or widen the date range.
    </div>
  );

  const scaleUp = sorted.filter((a) => {
    const spendPct = totalSpend > 0 ? (a.spend / totalSpend) * 100 : 0;
    const roas = a.spend > 0 ? a.conversionValue / a.spend : 0;
    return opportunityLabel(roas, spendPct).label === "Scale up";
  }).length;

  return (
    <div className="space-y-4">
      {scaleUp > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2 text-xs text-green-800">
          <Info className="w-4 h-4 shrink-0" />
          <strong>{scaleUp} ad set{scaleUp !== 1 ? "s" : ""} flagged for scaling</strong> — high ROAS with low spend share. Increase budget here.
        </div>
      )}
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Audience (Ad Set)</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Spend</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Spend Share</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Revenue</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Rev Share</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">ROAS</th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-600 uppercase">Opportunity</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const spendPct = totalSpend > 0 ? (a.spend / totalSpend) * 100 : 0;
              const revPct = totalRevenue > 0 ? (a.conversionValue / totalRevenue) * 100 : 0;
              const roas = a.spend > 0 ? a.conversionValue / a.spend : 0;
              const { label, color } = opportunityLabel(roas, spendPct);
              return (
                <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-gray-900 truncate max-w-[220px]" title={a.name}>{a.name}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{cur(a.spend)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{spendPct.toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{cur(a.conversionValue)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{revPct.toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{roas > 0 ? `${roas.toFixed(2)}×` : "—"}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>{label}</span>
                    {(label === "Reduce" || label === "Review") && (
                      <div className="mt-1">
                        <AIRecommendationButton
                          metric={`Expansion opportunity — ${a.name}`}
                          value={`ROAS ${roas.toFixed(2)}x, spend share ${spendPct.toFixed(1)}%`}
                          status={label === "Reduce" ? "critical" : "warn"}
                          platform="meta"
                          auditContext={{ module: "Expansion Opportunity", siblingMetrics: { roas: +roas.toFixed(2), spendSharePct: +spendPct.toFixed(1), revSharePct: +revPct.toFixed(1) } }}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">
        Scale up: ROAS ≥ 3× + spend share &lt; 20% · Maintain: ROAS ≥ 2× + spend share &lt; 30% · Reduce: ROAS &lt; 1×.
      </p>
    </div>
  );
}

// ─── Main tab ───────────────────────────────────────────────────────────────

export default function AudienceSaturationTab({ platform, dateRange, customStart, customEnd }: Props) {
  const [active, setActive] = useState("saturation");
  const { adsets, loading, error, currency } = useAdSetInsights(platform, dateRange, customStart, customEnd);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Zap className="w-8 h-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Saturation &amp; Expansion</h1>
          <p className="text-gray-600 mt-1">Frequency, reach%, and fatigue scoring per ad set — plus which audiences to scale vs reduce based on ROAS and spend share.</p>
        </div>
      </div>

      {platform === "google" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          Meta ad-set data shown. Frequency / reach are Meta-specific metrics not directly available in Google Ads.
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {SUB_TABS.map((t) => (
          <button key={t.id} onClick={() => setActive(t.id)}
            className={`px-4 py-3 font-semibold border-b-2 transition whitespace-nowrap ${active === t.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900"}`}>
            <div>{t.label}</div>
            <div className="text-xs text-gray-500 font-normal">{t.desc}</div>
          </button>
        ))}
      </div>

      {active === "saturation" && <SaturationAnalysis adsets={adsets} loading={loading} currency={currency} />}
      {active === "expansion"  && <ExpansionOpportunity adsets={adsets} loading={loading} currency={currency} />}
    </div>
  );
}
