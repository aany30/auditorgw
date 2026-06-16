/**
 * Campaign → Audience Overlap (doc §4)
 *
 * Uses ad sets from useAdSetInsights (always available) instead of the
 * deprecated Meta Custom Audiences API. Overlap is estimated heuristically
 * from audience-type similarity and funnel-stage proximity.
 */

import React, { useState, useMemo } from "react";
import { Users, ExternalLink, AlertCircle, Info } from "lucide-react";
import type { DateRange } from "@/components/shared/DateRangePicker";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useAdSetInsights, type AdSetRow } from "@/hooks/useAdSetInsights";
import { formatMoney } from "@/lib/currency";
import {
  classifyAdSet, AUDIENCE_COLORS, STAGE_COLORS,
  type AudienceClassification, type AudienceClass, type CustomAudienceDetail,
} from "@/lib/audience-classifier";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  selectedObjectives?: Set<string>;
  setActiveTab?: (id: string) => void;
}

// ─── Audience / funnel helpers — delegate to the shared classifier ──────────

type FunnelStage = "TOF" | "MOF" | "BOF" | "Loyalty";

// Overlap heuristic: 0–1 score based on audience class + funnel-stage proximity.
// Uses the marketing-meaning AudienceClass keys (real Meta-targeting categories).
const STAGE_ORDER: Record<FunnelStage, number> = { TOF: 0, MOF: 1, BOF: 2, Loyalty: 3 };

const TYPE_BASE: Partial<Record<AudienceClass, Partial<Record<AudienceClass, number>>>> = {
  Broad:                       { Broad: 0.65, Interest: 0.40, Lookalike: 0.30, "Advantage+ Audience": 0.55, "ASC / Shopping": 0.55, Unclassified: 0.35 },
  "Advantage+ Audience":       { "Advantage+ Audience": 0.62, Broad: 0.55, Interest: 0.35, Lookalike: 0.28, "ASC / Shopping": 0.50, Unclassified: 0.30 },
  Interest:                    { Broad: 0.40, Interest: 0.55, Lookalike: 0.30, "Advantage+ Audience": 0.35, Unclassified: 0.25 },
  Lookalike:                   { Broad: 0.30, Interest: 0.30, Lookalike: 0.55, "Advantage+ Audience": 0.28, Unclassified: 0.20 },
  "ASC / Shopping":            { Broad: 0.55, Interest: 0.35, Lookalike: 0.25, "ASC / Shopping": 0.60, "Advantage+ Audience": 0.45, Unclassified: 0.30 },
  "Retargeting — Website":     { "Retargeting — Website": 0.75, "Retargeting — Engagement": 0.45, "Retargeting — App": 0.35, "Mixed Custom": 0.55, "Catalog/DPA": 0.45, Unclassified: 0.25 },
  "Retargeting — Engagement":  { "Retargeting — Engagement": 0.70, "Retargeting — Website": 0.45, "Retargeting — App": 0.35, "Mixed Custom": 0.55, Unclassified: 0.20 },
  "Retargeting — App":         { "Retargeting — App": 0.70, "Retargeting — Engagement": 0.35, "Retargeting — Website": 0.30, "Mixed Custom": 0.45, Unclassified: 0.20 },
  "Customer List":             { "Customer List": 0.75, "Mixed Custom": 0.40, Unclassified: 0.10 },
  "Mixed Custom":              { "Mixed Custom": 0.55, "Retargeting — Website": 0.50, "Retargeting — Engagement": 0.45, "Customer List": 0.40, Unclassified: 0.20 },
  "Catalog/DPA":               { "Catalog/DPA": 0.70, "Retargeting — Website": 0.45, "Customer List": 0.30, Unclassified: 0.20 },
  Unclassified:                { Unclassified: 0.20 },
};

function estimateOverlapPct(clsA: AudienceClass, stageA: FunnelStage, clsB: AudienceClass, stageB: FunnelStage): number {
  const baseAB = TYPE_BASE[clsA]?.[clsB] ?? TYPE_BASE[clsB]?.[clsA] ?? 0.15;
  const stageDiff = Math.abs(STAGE_ORDER[stageA] - STAGE_ORDER[stageB]);
  const stageMod = stageDiff === 0 ? 1.0 : stageDiff === 1 ? 0.7 : stageDiff === 2 ? 0.4 : 0.2;
  return Math.min(0.95, baseAB * stageMod) * 100;
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

function fmtSize(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString("en-IN");
}

function OverlapBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const color = clamped > 50 ? "bg-red-500" : clamped > 25 ? "bg-orange-400" : "bg-green-500";
  return (
    <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
      <div className={`h-3 rounded-full transition-all duration-500 ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function riskLabel(pct: number): { label: string; color: string } {
  if (pct > 50) return { label: "High cannibalization risk",  color: "text-red-700 bg-red-50 border-red-200" };
  if (pct > 25) return { label: "Moderate overlap",           color: "text-orange-700 bg-orange-50 border-orange-200" };
  return            { label: "Low overlap",                   color: "text-green-700 bg-green-50 border-green-200" };
}

function audienceBadge(cls: AudienceClassification) {
  const color = AUDIENCE_COLORS[cls.cls] ?? "bg-gray-100 text-gray-600";
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${color} ${cls.source === "name-fallback" ? "border border-dashed border-gray-400" : ""}`}
      title={cls.source === "name-fallback"
        ? "Inferred from ad-set name — Meta didn't return targeting (likely Advantage+ Shopping)."
        : (cls.detail || "Classified from Meta targeting setup")}
    >
      {cls.cls}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AudienceOverlapTab({ platform, dateRange, customStart, customEnd }: Props) {
  const { adsets, audienceMap, loading, currency } = useAdSetInsights(
    platform === "both" ? "meta" : platform,
    dateRange, customStart, customEnd
  );
  // Classify every ad set once, reused below.
  const classifyRow = (a: AdSetRow): AudienceClassification =>
    classifyAdSet(a.targeting, audienceMap, a.campaignObjective, a.name);
  const cur = (n: number) => formatMoney(n, currency, 0);

  const [adSetA, setAdSetA] = useState("");
  const [adSetB, setAdSetB] = useState("");


  const adSetMap = useMemo(() => new Map(adsets.map((a) => [a.id, a])), [adsets]);

  const result = useMemo(() => {
    if (!adSetA || !adSetB || adSetA === adSetB) return null;
    const a = adSetMap.get(adSetA);
    const b = adSetMap.get(adSetB);
    if (!a || !b) return null;

    const sizeA = a.reach || a.impressions || 0;
    const sizeB = b.reach || b.impressions || 0;
    const cA = classifyRow(a);
    const cB = classifyRow(b);
    const overlapPct = estimateOverlapPct(cA.cls, cA.funnelStage, cB.cls, cB.funnelStage);
    const overlap = Math.round(Math.min(sizeA, sizeB) * (overlapPct / 100));
    const unionReach = sizeA + sizeB - overlap;

    return { sizeA, sizeB, unionReach, overlap, overlapPct };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adSetA, adSetB, adSetMap, audienceMap]);

  const adA = adSetMap.get(adSetA);
  const adB = adSetMap.get(adSetB);
  const nameA = adA?.name ?? "";
  const nameB = adB?.name ?? "";
  const classA = adA ? classifyRow(adA) : null;
  const classB = adB ? classifyRow(adB) : null;
  const stageA: FunnelStage | null = classA?.funnelStage ?? null;
  const stageB: FunnelStage | null = classB?.funnelStage ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Users className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Audience Overlap</h1>
            <p className="text-gray-600 mt-1">Compare two ad sets to estimate audience cannibalization.</p>
          </div>
        </div>
        {platform !== "google" && (
          <AIExecutiveSummary
            tabName="Audience Overlap"
            context={{
              adSetCount: adsets.length,
              lastCompared: adSetA && adSetB ? { a: nameA, b: nameB } : null,
              lastResult: result ? { overlapPct: result.overlapPct } : null,
            }}
            platform="meta"
            inline
          />
        )}
      </div>

      {platform === "google" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          Audience Overlap is Meta-specific — not applicable to Google Ads keyword targeting.
        </div>
      )}

      {platform !== "google" && (
        <>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2 text-xs text-blue-800">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Overlap estimated from audience type and funnel stage similarity.{" "}
              For an exact audience-level check,{" "}
              <a href="https://www.facebook.com/adsmanager/audiences" target="_blank" rel="noopener noreferrer"
                className="underline font-semibold inline-flex items-center gap-0.5">
                open Audience Manager <ExternalLink className="w-3 h-3" />
              </a>
            </span>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
            <h3 className="text-sm font-bold text-gray-900">Select two ad sets to compare</h3>

            {loading ? (
              <div className="text-sm text-gray-500">Loading ad sets…</div>
            ) : adsets.length === 0 ? (
              <div className="text-sm text-gray-500">No ad sets found. Connect a Meta account or widen the date range.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {([["A", adSetA, setAdSetA, adSetB], ["B", adSetB, setAdSetB, adSetA]] as const).map(([label, val, setter, other]) => (
                  <div key={label}>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Ad Set {label}</label>
                    <select
                      value={val}
                      onChange={(e) => setter(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">— Select ad set —</option>
                      {[...adsets].sort((a, b) => (b.spend || 0) - (a.spend || 0)).map((a) => (
                        <option key={a.id} value={a.id} disabled={a.id === other}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    {val && (
                      <div className="mt-1.5 flex items-center gap-2">
                        {stageA && label === "A" && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STAGE_COLORS[stageA]}`}>{stageA}</span>}
                        {stageB && label === "B" && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STAGE_COLORS[stageB]}`}>{stageB}</span>}
                        {(() => {
                          const c = label === "A" ? classA : classB;
                          return c ? audienceBadge(c) : null;
                        })()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {result && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900">Overlap Estimate</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold uppercase border border-blue-200">Heuristic</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-100">
                {[
                  { label: nameA || "Ad Set A", value: result.sizeA > 0 ? fmtSize(result.sizeA) : "—", sub: "reach (period)" },
                  { label: nameB || "Ad Set B", value: result.sizeB > 0 ? fmtSize(result.sizeB) : "—", sub: "reach (period)" },
                  { label: "Est. Overlap",       value: result.sizeA > 0 ? fmtSize(result.overlap) : "—", sub: "shared users" },
                  { label: "Overlap %",           value: `${result.overlapPct.toFixed(1)}%`, sub: "of smaller ad set" },
                ].map((c) => (
                  <div key={c.label} className="bg-white px-5 py-4">
                    <div className="text-2xl font-bold text-gray-900">{c.value}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{c.sub}</div>
                    <div className="text-[11px] text-gray-400 mt-1 truncate" title={c.label}>{c.label}</div>
                  </div>
                ))}
              </div>

              <div className="px-5 py-4 space-y-3">
                <OverlapBar pct={result.overlapPct} />
                <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${riskLabel(result.overlapPct).color}`}>
                  {riskLabel(result.overlapPct).label} — {result.overlapPct.toFixed(1)}% overlap
                </div>
                <p className="text-[11px] text-gray-400">
                  Estimated from audience class ({classA?.cls ?? "?"} vs {classB?.cls ?? "?"}) and funnel stage ({stageA} vs {stageB}) similarity.
                  {result.overlapPct > 30 && " High overlap means these ad sets may be bidding against each other — consider adding exclusions."}
                </p>
              </div>

              {(() => {
                const rowA = adSetMap.get(adSetA)!;
                const rowB = adSetMap.get(adSetB)!;
                const fmt = (n: number | null, suffix = "") => n !== null ? `${n.toFixed(suffix === "x" ? 2 : suffix === "%" ? 2 : 0)}${suffix}` : "—";
                const cpm  = (r: typeof rowA) => r.impressions > 0 ? (r.spend / r.impressions) * 1000 : null;
                const ctr  = (r: typeof rowA) => r.impressions > 0 ? (r.clicks  / r.impressions) * 100 : null;
                const cpc  = (r: typeof rowA) => r.clicks > 0 ? r.spend / r.clicks : null;
                const roas = (r: typeof rowA) => r.spend > 0 ? r.conversionValue / r.spend : null;
                const cpa  = (r: typeof rowA) => r.conversions > 0 ? r.spend / r.conversions : null;
                const cvr  = (r: typeof rowA) => r.clicks > 0 ? (r.conversions / r.clicks) * 100 : null;
                const rows: { label: string; a: React.ReactNode; b: React.ReactNode; combined: React.ReactNode; muted?: boolean }[] = [
                  { label: "Funnel Stage",   a: stageA ? <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STAGE_COLORS[stageA]}`}>{stageA}</span> : "—", b: stageB ? <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STAGE_COLORS[stageB]}`}>{stageB}</span> : "—", combined: "—" },
                  { label: "Audience Type",  a: classA ? audienceBadge(classA) : "—", b: classB ? audienceBadge(classB) : "—", combined: "—" },
                  { label: "Spend",          a: cur(rowA.spend), b: cur(rowB.spend), combined: cur(rowA.spend + rowB.spend) },
                  { label: "Impressions",    a: fmtSize(rowA.impressions), b: fmtSize(rowB.impressions), combined: fmtSize(rowA.impressions + rowB.impressions) },
                  { label: "Reach (period)", a: result.sizeA > 0 ? fmtSize(result.sizeA) : "—", b: result.sizeB > 0 ? fmtSize(result.sizeB) : "—", combined: result.unionReach > 0 ? fmtSize(result.unionReach) : "—" },
                  { label: "Frequency",      a: rowA.frequency?.toFixed(1) ?? "—", b: rowB.frequency?.toFixed(1) ?? "—", combined: "—" },
                  { label: "CPM",            a: cpm(rowA) !== null ? cur(cpm(rowA)!) : "—", b: cpm(rowB) !== null ? cur(cpm(rowB)!) : "—", combined: "—" },
                  { label: "CTR",            a: fmt(ctr(rowA), "%"), b: fmt(ctr(rowB), "%"), combined: "—" },
                  { label: "CPC",            a: cpc(rowA) !== null ? cur(cpc(rowA)!) : "—", b: cpc(rowB) !== null ? cur(cpc(rowB)!) : "—", combined: "—" },
                  { label: "Conversions",    a: rowA.conversions.toLocaleString(), b: rowB.conversions.toLocaleString(), combined: (rowA.conversions + rowB.conversions).toLocaleString() },
                  { label: "Conv. Value",    a: cur(rowA.conversionValue), b: cur(rowB.conversionValue), combined: cur(rowA.conversionValue + rowB.conversionValue) },
                  { label: "CPA",            a: cpa(rowA) !== null ? cur(cpa(rowA)!) : "—", b: cpa(rowB) !== null ? cur(cpa(rowB)!) : "—", combined: "—" },
                  { label: "CVR",            a: fmt(cvr(rowA), "%"), b: fmt(cvr(rowB), "%"), combined: "—" },
                  { label: "ROAS",           a: fmt(roas(rowA), "x"), b: fmt(roas(rowB), "x"), combined: "—" },
                  { label: "Est. Overlap",   a: "—", b: "—", combined: result.sizeA > 0 ? fmtSize(result.overlap) : "—", muted: true },
                  { label: "Overlap %",      a: "—", b: "—", combined: `${result.overlapPct.toFixed(1)}%`, muted: true },
                ];
                return (
                  <div className="border-t border-gray-100 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">Metric</th>
                          <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase max-w-[140px] truncate" title={nameA}>{nameA || "Ad Set A"}</th>
                          <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase max-w-[140px] truncate" title={nameB}>{nameB || "Ad Set B"}</th>
                          <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Combined</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.label} className="border-b border-gray-100 last:border-0">
                            <td className="px-4 py-2.5 text-gray-700 font-medium">{r.label}</td>
                            <td className="px-4 py-2.5 text-right text-gray-900">{r.a}</td>
                            <td className="px-4 py-2.5 text-right text-gray-900">{r.b}</td>
                            <td className="px-4 py-2.5 text-right font-bold text-blue-700">{r.combined}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}

        </>
      )}
    </div>
  );
}
