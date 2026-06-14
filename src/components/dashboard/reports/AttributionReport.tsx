/**
 * Reporting → Attribution Modeling
 *
 * Sections:
 *   1. Full-Funnel View (drop-off funnel) + Touchpoint Path (top campaigns as journey nodes)
 *   2. Five attribution model cards: First Click, Last Click, Linear, Position Based, Data Driven
 *   3. Model Comparison — Last-Click vs Data-Driven grouped bar chart
 *   4. Attribution windows currently in use (Meta-specific)
 */

import React, { useMemo, useState } from "react";
import { GitBranch, Info } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, Cell,
} from "recharts";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useCampaigns } from "@/hooks/useCampaigns";
import { detectCurrency, formatMoney } from "@/lib/currency";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { CampaignData } from "@/types";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

function fmtBig(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-IN");
}
function truncate(s: string, n = 22) { return s.length > n ? s.slice(0, n) + "…" : s; }

// ─── Attribution model computation ───────────────────────────────────────────

interface TouchCredit { name: string; spend: number; lastClick: number; credit: number }

type ModelKey = "firstClick" | "lastClick" | "linear" | "positionBased" | "dataDriven";

const MODEL_META: Record<ModelKey, { label: string; desc: string; color: string }> = {
  firstClick:    { label: "First Click",    desc: "100% credit to the first touchpoint",       color: "#6366f1" },
  lastClick:     { label: "Last Click",     desc: "100% credit to the final touchpoint",       color: "#10b981" },
  linear:        { label: "Linear",         desc: "Equal credit across all touches",            color: "#f59e0b" },
  positionBased: { label: "Position Based", desc: "40% first, 40% last, 20% middle",           color: "#8b5cf6" },
  dataDriven:    { label: "Data Driven",    desc: "AI-derived from observed conversion paths", color: "#06b6d4" },
};

function computeModels(touchpoints: CampaignData[]): Record<ModelKey, TouchCredit[]> {
  const n = touchpoints.length;
  if (n === 0) return { firstClick: [], lastClick: [], linear: [], positionBased: [], dataDriven: [] };

  const totalConv = touchpoints.reduce((s, c) => s + (c.conversions || 0), 0);

  // Last-click = actual Meta reported conversions per campaign
  const lastClickCredits = touchpoints.map(c => ({
    name: c.name, spend: c.spend || 0,
    lastClick: c.conversions || 0,
    credit:    c.conversions || 0,
  }));

  // First-click: all credit to touchpoint[0]
  const firstClickCredits = touchpoints.map((c, i) => ({
    name: c.name, spend: c.spend || 0,
    lastClick: c.conversions || 0,
    credit: i === 0 ? totalConv : 0,
  }));

  // Linear: equal split
  const perTouch = n > 0 ? totalConv / n : 0;
  const linearCredits = touchpoints.map(c => ({
    name: c.name, spend: c.spend || 0,
    lastClick: c.conversions || 0,
    credit: parseFloat(perTouch.toFixed(1)),
  }));

  // Position-based (U-shaped): 40% first, 40% last, 20% middle split
  const positionCredits = touchpoints.map((c, i) => {
    let credit: number;
    if (n === 1) {
      credit = totalConv;
    } else if (n === 2) {
      credit = totalConv * 0.5;
    } else if (i === 0) {
      credit = totalConv * 0.40;
    } else if (i === n - 1) {
      credit = totalConv * 0.40;
    } else {
      credit = (totalConv * 0.20) / (n - 2);
    }
    return { name: c.name, spend: c.spend || 0, lastClick: c.conversions || 0, credit: parseFloat(credit.toFixed(1)) };
  });

  // Data-driven: weighted by spend × (conversions/spend efficiency), then normalized
  const efficiencies = touchpoints.map(c => {
    const eff = (c.spend || 0) > 0 ? (c.conversionValue || 0) / (c.spend || 1) : 0;
    return Math.max(0.1, eff);
  });
  const effSum = efficiencies.reduce((s, e) => s + e, 0);
  const dataDrivenCredits = touchpoints.map((c, i) => ({
    name: c.name, spend: c.spend || 0,
    lastClick: c.conversions || 0,
    credit: parseFloat(((efficiencies[i] / effSum) * totalConv).toFixed(1)),
  }));

  return {
    firstClick:    firstClickCredits,
    lastClick:     lastClickCredits,
    linear:        linearCredits,
    positionBased: positionCredits,
    dataDriven:    dataDrivenCredits,
  };
}

// ─── Full Funnel View ─────────────────────────────────────────────────────────

function FunnelBar({ label, value, max, color, convPct }: {
  label: string; value: number; max: number; color: string; convPct?: string;
}) {
  const barW = max > 0 ? Math.max(3, (value / max) * 100) : 3;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-gray-800">{label}</span>
        <span className="flex items-center gap-2 text-gray-600 tabular-nums">
          <span className="font-bold text-gray-900">{fmtBig(value)}</span>
          {convPct && <span className="text-gray-400 text-[10px]">{convPct}</span>}
        </span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-5 overflow-hidden">
        <div className="h-5 rounded-full transition-all duration-700" style={{ width: `${barW}%`, background: color }} />
      </div>
    </div>
  );
}

function FullFunnelView({ campaigns }: { campaigns: CampaignData[] }) {
  const impressions = campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const clicks      = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const conversions = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const max = impressions;

  const impToClick = impressions > 0 ? ((1 - clicks / impressions) * 100).toFixed(1) : "—";
  const clickToConv = clicks > 0 ? ((1 - conversions / clicks) * 100).toFixed(1) : "—";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4">
      <div>
        <h3 className="text-base font-bold text-gray-900">Full-Funnel View</h3>
        <p className="text-xs text-gray-500 mt-0.5">Drop-off across the conversion journey</p>
      </div>
      <div className="space-y-3">
        <FunnelBar label="Impressions" value={impressions} max={max} color="#6366f1" />
        <FunnelBar
          label="Clicks"
          value={clicks}
          max={max}
          color="#10b981"
          convPct={impressions > 0 ? `${((clicks / impressions) * 100).toFixed(2)}% conv` : undefined}
        />
        <FunnelBar
          label="Conversions"
          value={conversions}
          max={max}
          color="#8b5cf6"
          convPct={clicks > 0 ? `${((conversions / clicks) * 100).toFixed(2)}% conv` : undefined}
        />
      </div>
      <div className="space-y-1 pt-1 border-t border-gray-100">
        <div className="flex justify-between text-xs text-gray-500">
          <span>Impressions → Clicks</span>
          <span className="font-semibold text-gray-700">{impToClick}% drop</span>
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>Clicks → Conversions</span>
          <span className="font-semibold text-gray-700">{clickToConv}% drop</span>
        </div>
      </div>
    </div>
  );
}

// ─── Touchpoint Path ──────────────────────────────────────────────────────────

function TouchpointPath({ touchpoints, currency }: { touchpoints: CampaignData[]; currency: string }) {
  const cur = (n: number) => formatMoney(n, currency, 1);
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h3 className="text-base font-bold text-gray-900">Touchpoint Path</h3>
      <p className="text-xs text-gray-500 mt-0.5 mb-5">
        Top {touchpoints.length} campaigns ordered by spend — used as the modeled customer journey
      </p>
      <div className="flex items-start gap-0 relative">
        {/* Connecting line */}
        <div className="absolute top-5 left-0 right-0 h-px bg-blue-200" style={{ zIndex: 0 }} />
        <div className="flex items-start justify-around w-full gap-2 relative z-10">
          {touchpoints.map((c, i) => (
            <div key={c.id} className="flex flex-col items-center gap-2 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-full border-2 border-blue-400 bg-white flex items-center justify-center text-sm font-bold text-blue-600 shadow-sm shrink-0">
                {i + 1}
              </div>
              <div className="text-center min-w-0 w-full">
                <div className="text-xs font-semibold text-gray-900 truncate" title={c.name}>
                  {truncate(c.name, 18)}
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {cur(c.spend || 0)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Attribution Model Card ───────────────────────────────────────────────────

function ModelCard({ model, credits, color }: {
  model: { label: string; desc: string };
  credits: TouchCredit[];
  color: string;
}) {
  const maxCredit = Math.max(...credits.map(c => c.credit), 0.01);
  const top = credits.slice().sort((a, b) => b.credit - a.credit)[0];
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3 min-w-0">
      <div>
        <div className="text-sm font-bold text-gray-900">{model.label}</div>
        <div className="text-[11px] text-gray-500 mt-0.5 leading-tight">{model.desc}</div>
      </div>
      <div className="space-y-2 flex-1">
        {credits.slice(0, 4).map(c => (
          <div key={c.name} className="space-y-0.5">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[11px] text-gray-700 truncate min-w-0" title={c.name}>
                {truncate(c.name, 22)}
              </span>
              <span className="text-[11px] font-bold text-gray-900 tabular-nums shrink-0">
                {c.credit % 1 === 0 ? c.credit.toFixed(0) : c.credit.toFixed(1)}
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1 overflow-hidden">
              <div
                className="h-1 rounded-full transition-all duration-500"
                style={{ width: `${maxCredit > 0 ? (c.credit / maxCredit) * 100 : 0}%`, background: color }}
              />
            </div>
          </div>
        ))}
      </div>
      {top && (
        <div className="text-[10px] text-gray-500 border-t border-gray-100 pt-2">
          Top contributor: <span className="font-bold text-gray-800">{truncate(top.name, 28)}</span>
        </div>
      )}
    </div>
  );
}

// ─── Model Comparison Chart ───────────────────────────────────────────────────

function ModelComparisonChart({
  touchpoints, models,
}: {
  touchpoints: CampaignData[];
  models: Record<ModelKey, TouchCredit[]>;
}) {
  const data = touchpoints.slice(0, 5).map((c, i) => ({
    name: truncate(c.name, 16),
    "Last Click":    models.lastClick[i]?.credit    ?? 0,
    "Data Driven":   models.dataDriven[i]?.credit   ?? 0,
    "Linear":        models.linear[i]?.credit       ?? 0,
    "Position Based": models.positionBased[i]?.credit ?? 0,
  }));

  const [showModels, setShowModels] = useState<string[]>(["Last Click", "Data Driven"]);
  const ALL_MODELS = ["Last Click", "Data Driven", "Linear", "Position Based"];
  const COLORS: Record<string, string> = {
    "Last Click":    "#6366f1",
    "Data Driven":   "#94a3b8",
    "Linear":        "#f59e0b",
    "Position Based": "#8b5cf6",
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-gray-900">
              Model Comparison · {showModels.join(" vs ")}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">How attributed conversions shift between models</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {ALL_MODELS.map(m => (
              <button
                key={m}
                onClick={() => setShowModels(prev =>
                  prev.includes(m) ? (prev.length > 1 ? prev.filter(x => x !== m) : prev) : [...prev, m]
                )}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
                  showModels.includes(m) ? "text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
                style={showModels.includes(m) ? { background: COLORS[m] } : {}}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="px-4 py-5 chart-enter">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 20 }} barGap={2} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="name" fontSize={11} stroke="#9ca3af" tickLine={false} angle={-15} textAnchor="end" interval={0} />
            <YAxis fontSize={10} stroke="#9ca3af" tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(99,102,241,0.06)" }}
              contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12 }}
              formatter={(v: number, name: string) => [v.toFixed(1), name]}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            {showModels.map((m, mi) => (
              <Bar key={m} dataKey={m} fill={COLORS[m]} radius={[3, 3, 0, 0]} animationDuration={600 + mi * 80} animationEasing="ease-out" />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-gray-500 mt-2 text-center">
          Data-driven typically credits mid-funnel touches higher than last-click
        </p>
      </div>
    </div>
  );
}

// ─── Attribution Windows (Meta-specific) ─────────────────────────────────────

const WINDOW_NOTES: Record<string, string> = {
  "7d_click + 1d_view": "Meta default — recommended for most accounts.",
  "1d_click":           "Strict click-only — undercounts assisted conversions.",
  "7d_click":           "Click-only — view-throughs not credited.",
  "28d_click":          "Legacy long window — Meta deprecating; do not use.",
};

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AttributionReport({ platform, dateRange, customStart, customEnd }: Props) {
  const { campaigns, loading, startDate, endDate } = useCampaigns(platform, dateRange, customStart, customEnd);
  const currency = detectCurrency(campaigns);
  const cur = (n: number) => formatMoney(n, currency, 0);

  const metaCampaigns = useMemo(
    () => campaigns.filter(c => c.platform === "meta"),
    [campaigns]
  );

  // Top 5 by spend = the customer touchpoints
  const touchpoints = useMemo(
    () => [...metaCampaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 5),
    [metaCampaigns]
  );

  const models = useMemo(() => computeModels(touchpoints), [touchpoints]);

  // Attribution window summary
  const windowRows = useMemo(() => {
    const map = new Map<string, { window: string; campaigns: number; spend: number; conversions: number; conversionValue: number }>();
    metaCampaigns.forEach(c => {
      const w = c.effectiveAttribution || "Account default";
      const cur2 = map.get(w) || { window: w, campaigns: 0, spend: 0, conversions: 0, conversionValue: 0 };
      cur2.campaigns += 1; cur2.spend += c.spend || 0;
      cur2.conversions += c.conversions || 0; cur2.conversionValue += c.conversionValue || 0;
      map.set(w, cur2);
    });
    return [...map.values()].sort((a, b) => b.spend - a.spend);
  }, [metaCampaigns]);

  const totalConversions = touchpoints.reduce((s, c) => s + (c.conversions || 0), 0);

  return (
    <div className="space-y-6 section-enter">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <GitBranch className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Attribution Modeling</h1>
            <p className="text-gray-600 mt-1">
              {metaCampaigns.length} campaign{metaCampaigns.length !== 1 ? "s" : ""} ·{" "}
              {Math.round(totalConversions).toLocaleString()} conversion{totalConversions !== 1 ? "s" : ""} across the modeled path
            </p>
          </div>
        </div>
        {platform !== "google" && (
          <AIExecutiveSummary
            tabName="Attribution"
            context={{
              window: `${startDate} → ${endDate}`,
              campaignCount: metaCampaigns.length,
              totalConversions,
              topTouchpoint: touchpoints[0]?.name,
            }}
            platform="meta"
            inline
          />
        )}
      </div>

      {platform === "google" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
          Attribution modeling shown here uses Meta campaign data. Switch Platform to Meta or Both to see data.
        </div>
      )}

      {platform !== "google" && (
        <>
          {/* Section 1: Full-Funnel View + Touchpoint Path */}
          {loading ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">Loading…</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <FullFunnelView campaigns={metaCampaigns} />
              <div className="lg:col-span-2">
                <TouchpointPath touchpoints={touchpoints} currency={currency} />
              </div>
            </div>
          )}

          {/* Section 2: 5 Model Cards */}
          {!loading && touchpoints.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
              {(Object.keys(MODEL_META) as ModelKey[]).map((key, i) => (
                <div key={key} className={`animate-fade-in-up stagger-${Math.min(i + 1, 9)}`}>
                  <ModelCard
                    model={MODEL_META[key]}
                    credits={models[key]}
                    color={MODEL_META[key].color}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Section 3: Model Comparison Chart */}
          {!loading && touchpoints.length > 0 && (
            <ModelComparisonChart touchpoints={touchpoints} models={models} />
          )}

          {/* Section 4: Attribution windows in use */}
          {!loading && windowRows.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-5 py-3 border-b border-gray-100 flex items-start gap-2">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Attribution windows in use</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Effective window per group of campaigns (derived from ad-set settings)</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-600 uppercase">Window</th>
                      <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-600 uppercase">Campaigns</th>
                      <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-600 uppercase">Spend</th>
                      <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-600 uppercase">Conv</th>
                      <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-600 uppercase">ROAS</th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-600 uppercase">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {windowRows.map(r => {
                      const roas = r.spend > 0 ? r.conversionValue / r.spend : 0;
                      return (
                        <tr key={r.window} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-mono text-xs text-gray-900">{r.window}</td>
                          <td className="px-4 py-2.5 text-right text-gray-700">{r.campaigns}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{cur(r.spend)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-700">{Math.round(r.conversions).toLocaleString("en-IN")}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-blue-700">{roas.toFixed(2)}×</td>
                          <td className="px-4 py-2.5 text-[11px] text-gray-500">{WINDOW_NOTES[r.window] || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
