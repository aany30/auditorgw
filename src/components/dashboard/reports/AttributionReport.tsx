/**
 * Reporting → Attribution
 *
 * Shows ONLY data fetchable from Meta's Insights API:
 *   1. Full-Funnel View  — impressions → clicks → conversions (drop-off rates)
 *   2. Campaign Performance — Meta-reported last-click conversions per campaign
 *   3. Attribution Windows in use — which window each campaign group uses
 *
 * Removed: First-Click / Linear / Position-Based / Data-Driven model cards
 * and the Model Comparison chart — all were client-side math, not Meta data.
 */

import React, { useMemo, useState } from "react";
import { GitBranch, Info, TrendingUp, ArrowRight } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
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
function truncate(s: string, n = 28) { return s.length > n ? s.slice(0, n) + "…" : s; }

const WINDOW_NOTES: Record<string, string> = {
  "7d_click + 1d_view": "Meta default — recommended for most accounts.",
  "1d_click":           "Strict click-only — may undercount assisted conversions.",
  "7d_click":           "Click-only — view-through not credited.",
  "28d_click":          "Legacy long window — Meta is deprecating this.",
  "Account default":    "Using the account-level default attribution setting.",
};

// ─── §1 Full-Funnel View ──────────────────────────────────────────────────────

function FunnelStep({ label, value, pct, color, isLast }: {
  label: string; value: number; pct?: string; color: string; isLast?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-gray-800">{label}</span>
          <span className="text-sm font-bold text-gray-900 tabular-nums">{fmtBig(value)}</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
          <div className="h-3 rounded-full" style={{ width: pct ? "100%" : "100%", background: color }} />
        </div>
        {pct && (
          <div className="text-[10px] text-gray-400 mt-1">{pct} conversion rate</div>
        )}
      </div>
      {!isLast && <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />}
    </div>
  );
}

function FullFunnelView({ campaigns }: { campaigns: CampaignData[] }) {
  const impressions = campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const clicks      = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const conversions = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);

  const ctr  = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cvr  = clicks > 0 ? (conversions / clicks) * 100 : 0;
  const end2end = impressions > 0 ? (conversions / impressions) * 100 : 0;

  const steps = [
    { label: "Impressions", value: impressions, color: "#6366f1", barPct: 100 },
    { label: "Clicks",      value: clicks,      color: "#10b981", barPct: impressions > 0 ? (clicks / impressions) * 100 : 0 },
    { label: "Conversions", value: conversions, color: "#8b5cf6", barPct: impressions > 0 ? (conversions / impressions) * 100 : 0 },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="mb-4">
        <h3 className="text-base font-bold text-gray-900">Full-Funnel View</h3>
        <p className="text-xs text-gray-500 mt-0.5">Drop-off across the conversion journey — from Meta Insights API</p>
      </div>

      <div className="space-y-3">
        {steps.map((s) => (
          <div key={s.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-gray-800">{s.label}</span>
              <span className="text-sm font-bold text-gray-900 tabular-nums">{fmtBig(s.value)}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
              <div
                className="h-3 rounded-full transition-all duration-700"
                style={{ width: `${Math.max(s.barPct, 1)}%`, background: s.color }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-3">
        {[
          { label: "CTR",          value: `${ctr.toFixed(2)}%`,     sub: "Impr → Click" },
          { label: "CVR",          value: `${cvr.toFixed(2)}%`,     sub: "Click → Conv" },
          { label: "End-to-end",   value: `${end2end.toFixed(3)}%`, sub: "Impr → Conv"  },
        ].map(m => (
          <div key={m.label} className="text-center">
            <div className="text-base font-bold text-gray-900">{m.value}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{m.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── §2 Campaign Performance (Last-Click, Meta Reported) ─────────────────────

type SortKey = "spend" | "conversions" | "roas" | "cpa" | "ctr";

function CampaignPerformanceTable({ campaigns, currency }: { campaigns: CampaignData[]; currency: string }) {
  const [sort, setSort] = useState<SortKey>("spend");
  const [dir, setDir]   = useState<"desc" | "asc">("desc");
  const cur = (n: number) => formatMoney(n, currency, 0);

  const sorted = useMemo(() => {
    return [...campaigns].sort((a, b) => {
      const val = (c: CampaignData): number => {
        if (sort === "spend")       return c.spend || 0;
        if (sort === "conversions") return c.conversions || 0;
        if (sort === "roas")        return (c.spend || 0) > 0 ? (c.conversionValue || 0) / (c.spend || 1) : 0;
        if (sort === "cpa")         return (c.conversions || 0) > 0 ? (c.spend || 0) / (c.conversions || 1) : Infinity;
        if (sort === "ctr")         return (c.impressions || 0) > 0 ? (c.clicks || 0) / (c.impressions || 1) : 0;
        return 0;
      };
      return dir === "desc" ? val(b) - val(a) : val(a) - val(b);
    });
  }, [campaigns, sort, dir]);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDir(d => d === "desc" ? "asc" : "desc");
    else { setSort(key); setDir("desc"); }
  };

  const SortTh = ({ id, label }: { id: SortKey; label: string }) => (
    <th
      onClick={() => toggleSort(id)}
      className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap"
    >
      {label}{sort === id ? (dir === "desc" ? " ↓" : " ↑") : ""}
    </th>
  );

  const maxSpend = Math.max(...campaigns.map(c => c.spend || 0), 1);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Campaign Performance</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Conversions as reported by Meta (last-click, account default window) · Click headers to sort
          </p>
        </div>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 shrink-0">
          Meta API
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Campaign</th>
              <SortTh id="spend"       label="Spend" />
              <SortTh id="conversions" label="Conv." />
              <SortTh id="roas"        label="ROAS" />
              <SortTh id="cpa"         label="CPA" />
              <SortTh id="ctr"         label="CTR" />
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Window</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(c => {
              const roas = (c.spend || 0) > 0 ? (c.conversionValue || 0) / (c.spend || 1) : 0;
              const cpa  = (c.conversions || 0) > 0 ? (c.spend || 0) / (c.conversions || 1) : 0;
              const ctr  = (c.impressions || 0) > 0 ? ((c.clicks || 0) / (c.impressions || 1)) * 100 : 0;
              const spendPct = maxSpend > 0 ? ((c.spend || 0) / maxSpend) * 100 : 0;
              return (
                <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 max-w-[260px]">
                    <div className="font-mono text-xs text-gray-900 truncate" title={c.name}>{c.name}</div>
                    <div className="w-full bg-gray-100 rounded-full h-1 mt-1 overflow-hidden">
                      <div className="h-1 rounded-full bg-blue-400" style={{ width: `${spendPct}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900 tabular-nums">{cur(c.spend || 0)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">{Math.round(c.conversions || 0).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums" style={{ color: roas >= 2 ? "#059669" : roas >= 1 ? "#d97706" : "#dc2626" }}>
                    {roas > 0 ? `${roas.toFixed(2)}×` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">{cpa > 0 ? cur(cpa) : "—"}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">{ctr > 0 ? `${ctr.toFixed(2)}%` : "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-100 text-gray-600">
                      {c.effectiveAttribution || "acct default"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── §3 Attribution Windows ───────────────────────────────────────────────────

function AttributionWindowsSection({ campaigns, currency }: { campaigns: CampaignData[]; currency: string }) {
  const cur = (n: number) => formatMoney(n, currency, 0);

  const windowRows = useMemo(() => {
    const map = new Map<string, { window: string; campaigns: number; spend: number; conversions: number; conversionValue: number }>();
    campaigns.forEach(c => {
      const w = c.effectiveAttribution || "Account default";
      const row = map.get(w) || { window: w, campaigns: 0, spend: 0, conversions: 0, conversionValue: 0 };
      row.campaigns++; row.spend += c.spend || 0;
      row.conversions += c.conversions || 0; row.conversionValue += c.conversionValue || 0;
      map.set(w, row);
    });
    return [...map.values()].sort((a, b) => b.spend - a.spend);
  }, [campaigns]);

  const chartData = windowRows.map(r => ({ name: r.window, Spend: r.spend, Conversions: r.conversions }));

  if (windowRows.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Attribution Windows in Use</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Effective attribution window per campaign group — from Meta campaign settings
          </p>
        </div>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 shrink-0">
          Meta API
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Window</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Camps</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Spend</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Conv.</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {windowRows.map(r => {
                const roas = r.spend > 0 ? r.conversionValue / r.spend : 0;
                return (
                  <tr key={r.window} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <div className="font-mono text-xs text-gray-900">{r.window}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{WINDOW_NOTES[r.window] || "—"}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700">{r.campaigns}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{cur(r.spend)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-700">{Math.round(r.conversions).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-blue-700">{roas > 0 ? `${roas.toFixed(2)}×` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Bar chart */}
        <div className="p-5">
          <p className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">Spend by Window</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="name" fontSize={10} stroke="#9ca3af" tickLine={false} angle={-20} textAnchor="end" interval={0} />
              <YAxis fontSize={10} stroke="#9ca3af" tickLine={false} axisLine={false} tickFormatter={v => fmtBig(v)} />
              <Tooltip
                cursor={{ fill: "rgba(99,102,241,0.06)" }}
                contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number) => [fmtBig(v), "Spend"]}
              />
              <Bar dataKey="Spend" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─── §4 Conversion Window Comparison ─────────────────────────────────────────

function ConversionWindowComparison({ campaigns, currency }: { campaigns: CampaignData[]; currency: string }) {
  const cur = (n: number) => formatMoney(n, currency, 0);

  const rows = useMemo(() => {
    return campaigns
      .filter(c => c.conv1dClick !== undefined || c.conv7dClick !== undefined || c.conv1dView !== undefined)
      .map(c => ({
        id: c.id,
        name: c.name,
        spend: c.spend || 0,
        conv1dClick: c.conv1dClick ?? 0,
        conv7dClick: c.conv7dClick ?? 0,
        conv1dView:  c.conv1dView  ?? 0,
        reported:    c.conversions  ?? 0,
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [campaigns]);

  if (rows.length === 0) return null;

  const totals = rows.reduce((acc, r) => ({
    conv1dClick: acc.conv1dClick + r.conv1dClick,
    conv7dClick: acc.conv7dClick + r.conv7dClick,
    conv1dView:  acc.conv1dView  + r.conv1dView,
    reported:    acc.reported    + r.reported,
  }), { conv1dClick: 0, conv7dClick: 0, conv1dView: 0, reported: 0 });

  const chartData = rows.slice(0, 8).map(r => ({
    name: truncate(r.name, 20),
    "1d Click": r.conv1dClick,
    "7d Click": r.conv7dClick,
    "1d View":  r.conv1dView,
  }));

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Conversion Window Comparison</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            How many conversions Meta attributes depending on the window — from{" "}
            <span className="font-mono">action_attribution_windows</span> API · same campaign, different credit rules
          </p>
        </div>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 shrink-0">
          Meta API
        </span>
      </div>

      {/* Summary totals */}
      <div className="grid grid-cols-4 divide-x divide-gray-100 border-b border-gray-100">
        {[
          { label: "1-Day Click", value: totals.conv1dClick, color: "#6366f1", note: "Strictest — only same-day click" },
          { label: "7-Day Click", value: totals.conv7dClick, color: "#10b981", note: "Most common default window" },
          { label: "1-Day View",  value: totals.conv1dView,  color: "#f59e0b", note: "View-through only" },
          { label: "Reported",    value: totals.reported,    color: "#3b82f6", note: "Account window (in use)" },
        ].map(m => (
          <div key={m.label} className="px-4 py-3 text-center">
            <div className="text-lg font-bold tabular-nums" style={{ color: m.color }}>
              {Math.round(m.value).toLocaleString("en-IN")}
            </div>
            <div className="text-[11px] font-semibold text-gray-700 mt-0.5">{m.label}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{m.note}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="p-5 border-b border-gray-100">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="name" fontSize={9} stroke="#9ca3af" tickLine={false} angle={-30} textAnchor="end" interval={0} />
            <YAxis fontSize={10} stroke="#9ca3af" tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(99,102,241,0.06)" }}
              contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 11 }}
            />
            <Bar dataKey="1d Click" fill="#6366f1" radius={[2, 2, 0, 0]} />
            <Bar dataKey="7d Click" fill="#10b981" radius={[2, 2, 0, 0]} />
            <Bar dataKey="1d View"  fill="#f59e0b" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Per-campaign table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Campaign</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Spend</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-indigo-600 uppercase">1d Click</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-emerald-600 uppercase">7d Click</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-amber-600 uppercase">1d View</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-blue-600 uppercase">Reported</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">7d/1d ratio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const ratio = r.conv1dClick > 0 ? r.conv7dClick / r.conv1dClick : null;
              return (
                <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 max-w-[240px]">
                    <div className="text-xs text-gray-800 truncate font-mono" title={r.name}>{r.name}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums text-xs">{cur(r.spend)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-indigo-700 tabular-nums">{r.conv1dClick}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-emerald-700 tabular-nums">{r.conv7dClick}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-amber-700 tabular-nums">{r.conv1dView}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-blue-700 tabular-nums">{r.reported}</td>
                  <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                    {ratio !== null ? (
                      <span className={ratio > 1.5 ? "text-orange-600 font-semibold" : "text-gray-500"}>
                        {ratio.toFixed(2)}×
                        {ratio > 1.5 && <span className="ml-1 text-[9px]">↑</span>}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 border-gray-300">
            <tr>
              <td className="px-4 py-2.5 text-xs font-bold text-gray-700">Total</td>
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5 text-right font-bold text-indigo-700 tabular-nums">{Math.round(totals.conv1dClick).toLocaleString("en-IN")}</td>
              <td className="px-4 py-2.5 text-right font-bold text-emerald-700 tabular-nums">{Math.round(totals.conv7dClick).toLocaleString("en-IN")}</td>
              <td className="px-4 py-2.5 text-right font-bold text-amber-700 tabular-nums">{Math.round(totals.conv1dView).toLocaleString("en-IN")}</td>
              <td className="px-4 py-2.5 text-right font-bold text-blue-700 tabular-nums">{Math.round(totals.reported).toLocaleString("en-IN")}</td>
              <td className="px-4 py-2.5 text-right text-xs text-gray-400">
                {totals.conv1dClick > 0 ? `${(totals.conv7dClick / totals.conv1dClick).toFixed(2)}× avg` : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="px-5 py-3 bg-amber-50 border-t border-amber-100 rounded-b-xl text-xs text-amber-800">
        <strong>What the ratio means:</strong> A 7d/1d ratio above 1.5× means many conversions are credited between day 2 and day 7 after the click.
        If you switched to a 1d window, your reported conversions would drop significantly — your budget decisions may be based on 7d-inflated numbers.
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AttributionReport({ platform, dateRange, customStart, customEnd }: Props) {
  const { campaigns, loading, startDate, endDate } = useCampaigns(platform, dateRange, customStart, customEnd);
  const currency = detectCurrency(campaigns);

  const metaCampaigns = useMemo(
    () => campaigns.filter(c => c.platform === "meta"),
    [campaigns]
  );

  const totalConversions = metaCampaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const totalSpend       = metaCampaigns.reduce((s, c) => s + (c.spend || 0), 0);

  return (
    <div className="space-y-6 section-enter">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <GitBranch className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Attribution</h1>
            <p className="text-gray-600 mt-1">
              {metaCampaigns.length} campaign{metaCampaigns.length !== 1 ? "s" : ""} ·{" "}
              {Math.round(totalConversions).toLocaleString()} conversions · all values from Meta Insights API
            </p>
          </div>
        </div>
        {platform !== "google" && (
          <AIExecutiveSummary
            tabName="Attribution"
            context={{ window: `${startDate} → ${endDate}`, campaignCount: metaCampaigns.length, totalConversions, totalSpend }}
            platform="meta"
            inline
          />
        )}
      </div>

      {platform === "google" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
          Attribution data shown here uses Meta campaign data. Switch platform to Meta or Both.
        </div>
      )}

      {/* Data source notice */}
      {platform !== "google" && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-start gap-2 text-xs text-blue-800">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            All numbers on this page are <strong>fetched directly from Meta&apos;s Insights API</strong>.
            Conversions use Meta&apos;s default last-click attribution window for each campaign.
            Multi-touch models (First Click, Linear, Position-Based) require cross-session journey data that Meta does not expose via API and have been removed.
          </span>
        </div>
      )}

      {platform !== "google" && (
        <>
          {loading ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">Loading…</div>
          ) : metaCampaigns.length === 0 ? (
            <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
              No Meta campaign data for this date range.
            </div>
          ) : (
            <>
              {/* §1 Full-Funnel View */}
              <FullFunnelView campaigns={metaCampaigns} />

              {/* §2 Campaign Performance */}
              <CampaignPerformanceTable campaigns={metaCampaigns} currency={currency} />

              {/* §3 Attribution Windows */}
              <AttributionWindowsSection campaigns={metaCampaigns} currency={currency} />

              {/* §4 Conversion Window Comparison */}
              <ConversionWindowComparison campaigns={metaCampaigns} currency={currency} />
            </>
          )}
        </>
      )}
    </div>
  );
}
