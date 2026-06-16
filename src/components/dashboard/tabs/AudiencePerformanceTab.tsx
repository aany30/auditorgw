/**
 * Tracking → Audience Performance
 *
 * Four sub-tabs:
 *   1. By Audience  — aggregated by audience-type label (Broad, LAL, etc.)
 *   2. Intent       — per-ad-set table classified by intent bucket
 *   3. New vs Existing — prospecting vs retargeting split
 *   4. Funnel Stage — TOF / MOF / BOF / Loyalty grouped breakdown
 */

import { useMemo, useState, useRef, useEffect } from "react";
import { BarChart2, AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useColPicker, ColumnPickerButton, ColHeader, ALL_STANDARD_KPIS, STD_KPI_MAP } from "@/components/shared/ColumnPicker";
import { useAdSetInsights, type AdSetRow } from "@/hooks/useAdSetInsights";
import { formatMoney } from "@/lib/currency";
import type { DateRange } from "@/components/shared/DateRangePicker";
import {
  classifyAdSet,
  AUDIENCE_COLORS, STAGE_COLORS, INTENT_COLORS, TYPE_COLORS,
  type AudienceClassification, type FunnelStage, type IntentBucket, type NewVsExisting,
  type CustomAudienceDetail,
} from "@/lib/audience-classifier";

// ─── Per-row classification helper ───────────────────────────────────────────
// All four sub-tabs derive their dimensions from the same classifyAdSet() call,
// so audience label / funnel stage / intent / new-vs-existing never disagree.

type AudienceType = NewVsExisting;

function classify(a: AdSetRow, audienceMap: Map<string, CustomAudienceDetail>): AudienceClassification {
  return classifyAdSet(a.targeting, audienceMap, a.campaignObjective, a.name);
}

function audienceBadge(cls: AudienceClassification) {
  const color = AUDIENCE_COLORS[cls.cls] ?? "bg-gray-100 text-gray-600";
  const badge = (
    <span
      className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${color} ${cls.source === "name-fallback" ? "border border-dashed border-gray-400" : ""}`}
      title={cls.source === "name-fallback"
        ? "Inferred from ad-set name — Meta didn't return targeting (likely Advantage+ Shopping)."
        : (cls.detail || "Classified from Meta targeting setup")}
    >
      {cls.cls}
    </span>
  );
  return badge;
}

// ─── Shared formatters ───────────────────────────────────────────────────────

function fmtMoney(n: number, cur: string) { return formatMoney(n, cur, 0); }
function fmtInt(n: number) { return Math.round(n).toLocaleString("en-IN"); }

// ─── KPI defs shared across funnel sub-tabs ──────────────────────────────────

type KpiId =
  | "spend" | "revenue" | "orders" | "roas" | "cpa" | "cvr" | "aov"
  | "impressions" | "reach" | "cpm" | "frequency"
  | "ctr" | "clicks" | "cpc" | "acos" | "sales" | "saleConvRate" | "cps" | "convRate";

interface KpiDef { id: KpiId; label: string; group: string; defaultOn?: boolean; fmt: (a: AdSetRow, currency: string) => string }

const FUNNEL_KPIS: KpiDef[] = [
  { id: "spend",       label: "Spend",    group: "Core",        defaultOn: true, fmt: (a, c) => fmtMoney(a.spend, c) },
  { id: "revenue",     label: "Revenue",  group: "Core",        defaultOn: true, fmt: (a, c) => fmtMoney(a.conversionValue, c) },
  { id: "orders",      label: "Orders",   group: "Core",        defaultOn: true, fmt: (a) => fmtInt(a.conversions) },
  { id: "roas",        label: "ROAS",     group: "Core",        defaultOn: true, fmt: (a) => a.spend > 0 ? `${(a.conversionValue / a.spend).toFixed(2)}×` : "—" },
  { id: "cpa",         label: "CPA",      group: "Core",        defaultOn: true, fmt: (a, c) => a.conversions > 0 ? fmtMoney(a.spend / a.conversions, c) : "—" },
  { id: "cvr",         label: "CVR",      group: "Core",        defaultOn: true, fmt: (a) => a.clicks > 0 ? `${((a.conversions / a.clicks) * 100).toFixed(2)}%` : "—" },
  { id: "aov",         label: "AOV",      group: "Core",        defaultOn: true, fmt: (a, c) => a.conversions > 0 ? fmtMoney(a.conversionValue / a.conversions, c) : "—" },
  { id: "impressions", label: "Impr.",    group: "Awareness",   fmt: (a) => fmtInt(a.impressions) },
  { id: "reach",       label: "Reach",    group: "Awareness",   fmt: (a) => fmtInt(a.reach) },
  { id: "cpm",         label: "CPM",      group: "Awareness",   fmt: (a, c) => a.impressions > 0 ? fmtMoney((a.spend / a.impressions) * 1000, c) : "—" },
  { id: "frequency",   label: "Freq.",    group: "Awareness",   fmt: (a) => a.frequency > 0 ? `${a.frequency.toFixed(1)}×` : "—" },
  { id: "ctr",         label: "CTR",      group: "Engagement",  fmt: (a) => a.impressions > 0 ? `${((a.clicks / a.impressions) * 100).toFixed(2)}%` : "—" },
  { id: "clicks",      label: "Clicks",   group: "Engagement",  fmt: (a) => fmtInt(a.clicks) },
  { id: "cpc",         label: "CPC",      group: "Engagement",  fmt: (a, c) => a.clicks > 0 ? fmtMoney(a.spend / a.clicks, c) : "—" },
];

const DEFAULT_KPI_ORDER: KpiId[] = FUNNEL_KPIS.filter(k => k.defaultOn).map(k => k.id);
const KPI_GROUPS = Array.from(new Set(FUNNEL_KPIS.map(k => k.group)));
const KPI_MAP = new Map(FUNNEL_KPIS.map(k => [k.id, k]));
const NVE_DEFAULTS: KpiId[] = ["spend", "revenue", "orders", "roas", "cpa", "aov"];
const FSA_DEFAULTS: KpiId[] = ["reach", "spend", "orders", "revenue", "roas", "cpa"];

type AggMetricRow = { spend: number; impressions: number; clicks: number; reach: number; conversions: number; conversionValue: number };

function fmtAggKpi(id: KpiId, r: AggMetricRow, currency: string): string {
  const roas  = r.spend > 0 ? r.conversionValue / r.spend : 0;
  const cpa   = r.conversions > 0 ? r.spend / r.conversions : 0;
  const cvr   = r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0;
  const aov   = r.conversions > 0 ? r.conversionValue / r.conversions : 0;
  const cpm   = r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0;
  const ctr   = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
  const cpc   = r.clicks > 0 ? r.spend / r.clicks : 0;
  const acos  = r.conversionValue > 0 ? (r.spend / r.conversionValue) * 100 : 0;
  switch (id) {
    case "spend":        return fmtMoney(r.spend, currency);
    case "revenue":      return fmtMoney(r.conversionValue, currency);
    case "orders": case "sales": return fmtInt(r.conversions);
    case "roas":         return roas > 0 ? `${roas.toFixed(2)}×` : "—";
    case "cpa": case "cps": return cpa > 0 ? fmtMoney(cpa, currency) : "—";
    case "cvr": case "convRate": case "saleConvRate": return cvr > 0 ? `${cvr.toFixed(2)}%` : "—";
    case "aov":          return aov > 0 ? fmtMoney(aov, currency) : "—";
    case "impressions":  return fmtInt(r.impressions);
    case "reach":        return fmtInt(r.reach);
    case "cpm":          return cpm > 0 ? fmtMoney(cpm, currency) : "—";
    case "ctr":          return ctr > 0 ? `${ctr.toFixed(2)}%` : "—";
    case "clicks":       return fmtInt(r.clicks);
    case "cpc":          return cpc > 0 ? fmtMoney(cpc, currency) : "—";
    case "acos":         return acos > 0 ? `${acos.toFixed(1)}%` : "—";
    default:             return "—";
  }
}

// ─── Mini column picker used by funnel sub-tabs ──────────────────────────────

function FunnelColPicker({
  cols, setCols,
}: {
  cols: KpiId[];
  setCols: React.Dispatch<React.SetStateAction<KpiId[]>>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const toggle = (id: KpiId) => setCols(prev => prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id]);
  return (
    <div className="flex justify-end" ref={ref}>
      <div className="relative">
        <button onClick={() => setOpen(v => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition shadow-sm">
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M4 8h8M6 12h4"/></svg>
          Columns
          <span className="ml-0.5 bg-gray-200 text-gray-700 rounded-full text-[10px] font-bold px-1.5 py-0.5 leading-none">{cols.length}</span>
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1.5 z-50 w-56 bg-gray-900 text-white rounded-xl shadow-2xl overflow-hidden border border-gray-700">
            <div className="px-4 py-2.5 border-b border-gray-700 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-300">Columns</span>
              <button onClick={() => setCols([...DEFAULT_KPI_ORDER])} className="text-[10px] text-gray-400 hover:text-white transition">Reset</button>
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
              {KPI_GROUPS.map(group => (
                <div key={group}>
                  <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">{group}</div>
                  {FUNNEL_KPIS.filter(k => k.group === group).map(k => {
                    const on = cols.includes(k.id);
                    return (
                      <button key={k.id} onClick={() => toggle(k.id)}
                        className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition ${on ? "bg-blue-600/20 text-blue-300" : "text-gray-200 hover:bg-gray-800"}`}>
                        <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? "bg-blue-600 border-blue-500" : "border-gray-600"}`}>
                          {on && <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1.5 5l2.5 2.5 4.5-4.5"/></svg>}
                        </span>
                        {k.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-tab: By Audience (aggregated by label) ──────────────────────────────

interface AggRow {
  label: string; adSets: AdSetRow[];
  classification: AudienceClassification;
  spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number;
}

function aggregate(adsets: AdSetRow[], audienceMap: Map<string, CustomAudienceDetail>): AggRow[] {
  const map = new Map<string, { rows: AdSetRow[]; cls: AudienceClassification }>();
  for (const a of adsets) {
    const cls = classify(a, audienceMap);
    if (!map.has(cls.cls)) map.set(cls.cls, { rows: [], cls });
    const entry = map.get(cls.cls)!;
    entry.rows.push(a);
    // If any ad set has api-sourced classification, promote the group to api
    if (cls.source === "api") entry.cls = { ...entry.cls, source: "api" };
  }
  return [...map.entries()].map(([label, { rows, cls }]) => ({
    label, adSets: rows, classification: cls,
    spend: rows.reduce((s, r) => s + r.spend, 0),
    impressions: rows.reduce((s, r) => s + r.impressions, 0),
    clicks: rows.reduce((s, r) => s + r.clicks, 0),
    conversions: rows.reduce((s, r) => s + r.conversions, 0),
    conversionValue: rows.reduce((s, r) => s + r.conversionValue, 0),
  }));
}

function deriveAgg(r: AggRow) {
  return {
    ctr:  r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0,
    cpc:  r.clicks > 0 ? r.spend / r.clicks : 0,
    roas: r.spend > 0 ? r.conversionValue / r.spend : 0,
    cpa:  r.conversions > 0 ? r.spend / r.conversions : 0,
    cvr:  r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0,
    aov:  r.conversions > 0 ? r.conversionValue / r.conversions : 0,
    cpm:  r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
  };
}

type SortKey = "spend" | "impressions" | "clicks" | "ctr" | "cpc" | "conversions" | "conversionValue" | "roas" | "cpa" | "cvr" | "aov" | "cpm";
const SORT_KEY_MAP: Record<string, SortKey | undefined> = {
  spend: "spend", impressions: "impressions", clicks: "clicks",
  ctr: "ctr", cpc: "cpc", orders: "conversions", revenue: "conversionValue",
  roas: "roas", cpa: "cpa", cvr: "cvr", aov: "aov", cpm: "cpm",
};
const BY_AUD_DEFAULTS = ["spend", "revenue", "orders", "roas", "cpa", "impressions", "ctr", "clicks", "cpc"];

function fmtKpi(id: string, r: AggRow, m: ReturnType<typeof deriveAgg>, cur: (n: number) => string, cur2: (n: number) => string): string {
  const acos = r.conversionValue > 0 ? (r.spend / r.conversionValue) * 100 : 0;
  switch (id) {
    case "spend":    return cur(r.spend);
    case "revenue":  return cur(r.conversionValue);
    case "orders": case "sales": return Math.round(r.conversions).toLocaleString("en-IN");
    case "roas":     return m.roas > 0 ? `${m.roas.toFixed(2)}×` : "—";
    case "cpa": case "cps": return m.cpa > 0 ? cur(m.cpa) : "—";
    case "cvr": case "convRate": case "saleConvRate": return m.cvr > 0 ? `${m.cvr.toFixed(2)}%` : "—";
    case "aov":      return m.aov > 0 ? cur(m.aov) : "—";
    case "impressions": return Math.round(r.impressions).toLocaleString("en-IN");
    case "cpm":      return m.cpm > 0 ? cur2(m.cpm) : "—";
    case "ctr":      return m.ctr > 0 ? `${m.ctr.toFixed(2)}%` : "—";
    case "clicks":   return Math.round(r.clicks).toLocaleString("en-IN");
    case "cpc":      return m.cpc > 0 ? cur2(m.cpc) : "—";
    case "acos":     return acos > 0 ? `${acos.toFixed(1)}%` : "—";
    default:         return "—";
  }
}

function DrillDownRow({ adSets, currency, colCount }: { adSets: AdSetRow[]; currency: string; colCount: number }) {
  const cur = (n: number) => formatMoney(n, currency, 0);
  const sorted = [...adSets].sort((a, b) => b.spend - a.spend);
  return (
    <tr>
      <td colSpan={colCount + 2} className="px-0 py-0 bg-blue-50/40">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-t border-blue-100">
            <thead>
              <tr className="bg-blue-50 border-b border-blue-100">
                <th className="px-6 py-1.5 text-left font-semibold text-blue-700 uppercase text-[10px]">Ad Set</th>
                <th className="px-4 py-1.5 text-right font-semibold text-blue-700 uppercase text-[10px]">Spend</th>
                <th className="px-4 py-1.5 text-right font-semibold text-blue-700 uppercase text-[10px]">Impr.</th>
                <th className="px-4 py-1.5 text-right font-semibold text-blue-700 uppercase text-[10px]">Clicks</th>
                <th className="px-4 py-1.5 text-right font-semibold text-blue-700 uppercase text-[10px]">CTR</th>
                <th className="px-4 py-1.5 text-right font-semibold text-blue-700 uppercase text-[10px]">Orders</th>
                <th className="px-4 py-1.5 text-right font-semibold text-blue-700 uppercase text-[10px]">Revenue</th>
                <th className="px-4 py-1.5 text-right font-semibold text-blue-700 uppercase text-[10px]">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => {
                const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
                const roas = a.spend > 0 ? a.conversionValue / a.spend : 0;
                return (
                  <tr key={a.id} className="border-b border-blue-50 hover:bg-blue-50">
                    <td className="px-6 py-1.5 text-gray-700 font-mono truncate max-w-[280px]" title={a.name}>{a.name}</td>
                    <td className="px-4 py-1.5 text-right font-semibold text-gray-700">{cur(a.spend)}</td>
                    <td className="px-4 py-1.5 text-right text-gray-600">{Math.round(a.impressions).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-1.5 text-right text-gray-600">{Math.round(a.clicks).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-1.5 text-right text-gray-600">{ctr > 0 ? `${ctr.toFixed(2)}%` : "—"}</td>
                    <td className="px-4 py-1.5 text-right text-gray-600">{Math.round(a.conversions).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-1.5 text-right text-gray-600">{cur(a.conversionValue)}</td>
                    <td className="px-4 py-1.5 text-right text-gray-600">{roas > 0 ? `${roas.toFixed(2)}×` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  );
}

function ByAudienceTab({ adsets, audienceMap, loading, currency, startDate, endDate, platform, dateRange }: {
  adsets: AdSetRow[]; audienceMap: Map<string, CustomAudienceDetail>;
  loading: boolean; currency: string;
  startDate: string; endDate: string;
  platform: Props["platform"]; dateRange: DateRange;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { cols, pickerOpen, setPickerOpen, pickerRef, swapIdx, setSwapIdx, tableRef, toggleCol, swapCol, resetCols } = useColPicker(BY_AUD_DEFAULTS);

  const rows = useMemo(() => {
    const agg = aggregate(adsets, audienceMap);
    return [...agg].sort((a, b) => {
      const ma = deriveAgg(a); const mb = deriveAgg(b);
      const va = (sortKey in ma ? (ma as Record<string, number>)[sortKey] : (a as unknown as Record<string, number>)[sortKey]) ?? 0;
      const vb = (sortKey in mb ? (mb as Record<string, number>)[sortKey] : (b as unknown as Record<string, number>)[sortKey]) ?? 0;
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [adsets, audienceMap, sortKey, sortDir]);

  const cur  = (n: number) => formatMoney(n, currency, 0);
  const cur2 = (n: number) => formatMoney(n, currency, 2);
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };
  const toggleExpand = (label: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  });

  if (loading) return <div className="text-sm text-gray-500">Loading ad-set data…</div>;
  if (adsets.length === 0) return (
    <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
      No ad set data. Connect a Meta account or widen the date range.
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">
          <span className="font-mono text-gray-700">{startDate}</span> → <span className="font-mono text-gray-700">{endDate}</span>
          {adsets.length > 0 && <> · <span className="font-semibold">{adsets.length} ad sets · {rows.length} audience types</span></>}
        </div>
        <AIExecutiveSummary
          tabName="Audience Performance"
          context={{
            audienceTypes: rows.length,
            adSetCount: adsets.length,
            totalSpend: adsets.reduce((s, a) => s + a.spend, 0),
            totalRevenue: adsets.reduce((s, a) => s + a.conversionValue, 0),
            topAudiences: rows.slice(0, 5).map(r => {
              const m = deriveAgg(r);
              return { label: r.label, spend: r.spend, roas: +m.roas.toFixed(2), cpa: +m.cpa.toFixed(2) };
            }),
          }}
          platform={platform === "both" ? "meta" : platform}
          dateRange={String(dateRange)}
          inline
        />
      </div>
      <ColumnPickerButton
        cols={cols} allDefs={ALL_STANDARD_KPIS} defaultIds={BY_AUD_DEFAULTS}
        pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} pickerRef={pickerRef}
        toggleCol={toggleCol} resetCols={resetCols}
      />
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm" ref={tableRef}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase w-8" />
                <th onClick={() => toggleSort("spend")}
                  className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 select-none">
                  Audience
                </th>
                {cols.map((id, colIdx) => {
                  const k = STD_KPI_MAP.get(id)!;
                  const sk = SORT_KEY_MAP[id];
                  return (
                    <th key={id} className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">
                      <ColHeader
                        colIdx={colIdx} currentId={id} label={k?.label ?? id}
                        allDefs={ALL_STANDARD_KPIS} swapIdx={swapIdx} setSwapIdx={setSwapIdx} swapCol={swapCol}
                        onSortClick={sk ? () => toggleSort(sk) : undefined}
                        sortIndicator={sk && sortKey === sk ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = deriveAgg(r);
                const isOpen = expanded.has(r.label);
                return (
                  <>
                    <tr key={r.label} onClick={() => toggleExpand(r.label)}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                      <td className="px-4 py-2.5 text-gray-400">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                      <td className="px-4 py-2.5">
                        <div>{audienceBadge(r.classification)}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{r.adSets.length} ad set{r.adSets.length !== 1 ? "s" : ""}</div>
                      </td>
                      {cols.map((id) => (
                        <td key={id} className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">
                          {fmtKpi(id, r, m, cur, cur2)}
                        </td>
                      ))}
                    </tr>
                    {isOpen && <DrillDownRow key={`${r.label}-drill`} adSets={r.adSets} currency={currency} colCount={cols.length} />}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-2.5 bg-gray-50 rounded-b-lg text-[11px] text-gray-500">
          Click any row to expand individual ad sets. Click column headers to sort.
        </div>
      </div>
    </div>
  );
}

// ─── Sub-tab: Intent Buckets ─────────────────────────────────────────────────

function IntentTab({ adsets, audienceMap, loading, currency }: { adsets: AdSetRow[]; audienceMap: Map<string, CustomAudienceDetail>; loading: boolean; currency: string }) {
  const rows = useMemo(() => [...adsets].sort((a, b) => b.spend - a.spend), [adsets]);
  const [cols, setCols] = useState<KpiId[]>([...DEFAULT_KPI_ORDER]);

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (!adsets.length) return <EmptyState />;

  return (
    <div className="space-y-2">
      <FunnelColPicker cols={cols} setCols={setCols} />
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase whitespace-nowrap">Campaign / Ad Set</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase whitespace-nowrap">Intent</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase whitespace-nowrap">Audience</th>
              {cols.map((id) => {
                const k = KPI_MAP.get(id)!;
                return <th key={id} className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase whitespace-nowrap">{k.label}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const cls = classify(a, audienceMap);
              return (
                <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 max-w-[220px]" title={a.name}>
                    <div className="font-mono text-gray-900 truncate text-xs">{a.name}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${INTENT_COLORS[cls.intent]}`}>{cls.intent}</span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{audienceBadge(cls)}</td>
                  {cols.map((id) => {
                    const k = KPI_MAP.get(id)!;
                    return <td key={id} className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">{k.fmt(a, currency)}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sub-tab: New vs Existing ────────────────────────────────────────────────

function NewVsExistingTab({ adsets, audienceMap, loading, currency }: { adsets: AdSetRow[]; audienceMap: Map<string, CustomAudienceDetail>; loading: boolean; currency: string }) {
  const rows = useMemo(() => {
    const map = new Map<AudienceType, AdSetRow[]>();
    for (const a of adsets) {
      const k = classify(a, audienceMap).newVsExisting;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    // Always emit all three buckets so an empty group surfaces as a 0 row
    // rather than disappearing — useful to see "no Existing audiences running".
    return (["New", "Engaged", "Existing"] as AudienceType[]).map(k => {
      const g = map.get(k) ?? [];
      return {
        group: k, adSetNames: g.map(r => r.name),
        spend: g.reduce((s, r) => s + r.spend, 0),
        conversions: g.reduce((s, r) => s + r.conversions, 0),
        conversionValue: g.reduce((s, r) => s + r.conversionValue, 0),
        impressions: g.reduce((s, r) => s + r.impressions, 0),
        clicks: g.reduce((s, r) => s + r.clicks, 0),
        reach: g.reduce((s, r) => s + r.reach, 0),
      };
    });
  }, [adsets, audienceMap]);

  const [cols, setCols] = useState<KpiId[]>([...NVE_DEFAULTS]);

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (!adsets.length) return <EmptyState />;

  return (
    <div className="space-y-2">
      <FunnelColPicker cols={cols} setCols={setCols} />
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase whitespace-nowrap">Audience Type</th>
              {cols.map((id) => {
                const k = KPI_MAP.get(id)!;
                return <th key={id} className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase whitespace-nowrap">{k.label}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.group} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${TYPE_COLORS[r.group as AudienceType]}`}>{r.group}</span>
                  <span className="ml-2 text-xs text-gray-500">{r.adSetNames.length} ad set{r.adSetNames.length !== 1 ? "s" : ""}</span>
                </td>
                {cols.map((id) => (
                  <td key={id} className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">
                    {fmtAggKpi(id, r, currency)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sub-tab: Funnel Stage ───────────────────────────────────────────────────

interface FunnelGroupRow {
  stage: FunnelStage; audienceLabel: string; classification: AudienceClassification;
  adSetNames: string[]; campaignNames: string[];
  spend: number; conversions: number; conversionValue: number; impressions: number; clicks: number; reach: number;
}
interface FunnelStageGroup {
  stage: FunnelStage; children: FunnelGroupRow[];
  spend: number; conversions: number; conversionValue: number; impressions: number; clicks: number; reach: number;
}

function buildFunnelGroups(adsets: AdSetRow[], audienceMap: Map<string, CustomAudienceDetail>): FunnelStageGroup[] {
  const pairMap = new Map<string, { rows: AdSetRow[]; classification: AudienceClassification }>();
  for (const a of adsets) {
    const cls = classify(a, audienceMap);
    const key = `${cls.funnelStage}|||${cls.cls}`;
    if (!pairMap.has(key)) pairMap.set(key, { rows: [], classification: cls });
    pairMap.get(key)!.rows.push(a);
  }
  const stageMap = new Map<FunnelStage, FunnelGroupRow[]>();
  for (const stage of ["TOF", "MOF", "BOF", "Loyalty"] as FunnelStage[]) {
    const entries = [...pairMap.entries()].filter(([k]) => k.startsWith(`${stage}|||`));
    entries.sort(([, a], [, b]) => b.rows.reduce((s, r) => s + r.spend, 0) - a.rows.reduce((s, r) => s + r.spend, 0));
    for (const [key, entry] of entries) {
      const audienceLabel = key.split("|||")[1];
      const rows = entry.rows;
      const uniqueCampaigns = [...new Set(rows.map(r => r.campaignName).filter(Boolean) as string[])];
      if (!stageMap.has(stage)) stageMap.set(stage, []);
      stageMap.get(stage)!.push({
        stage, audienceLabel, classification: entry.classification,
        adSetNames: rows.map(r => r.name), campaignNames: uniqueCampaigns,
        spend: rows.reduce((s, r) => s + r.spend, 0),
        conversions: rows.reduce((s, r) => s + r.conversions, 0),
        conversionValue: rows.reduce((s, r) => s + r.conversionValue, 0),
        impressions: rows.reduce((s, r) => s + r.impressions, 0),
        clicks: rows.reduce((s, r) => s + r.clicks, 0),
        reach: rows.reduce((s, r) => s + r.reach, 0),
      });
    }
  }
  return (["TOF", "MOF", "BOF", "Loyalty"] as FunnelStage[]).filter(s => stageMap.has(s)).map(stage => {
    const children = stageMap.get(stage)!;
    return {
      stage, children,
      spend: children.reduce((s, r) => s + r.spend, 0),
      conversions: children.reduce((s, r) => s + r.conversions, 0),
      conversionValue: children.reduce((s, r) => s + r.conversionValue, 0),
      impressions: children.reduce((s, r) => s + r.impressions, 0),
      clicks: children.reduce((s, r) => s + r.clicks, 0),
      reach: children.reduce((s, r) => s + r.reach, 0),
    };
  });
}

function FunnelStageTab({ adsets, audienceMap, loading, currency }: { adsets: AdSetRow[]; audienceMap: Map<string, CustomAudienceDetail>; loading: boolean; currency: string }) {
  const groups = useMemo(() => buildFunnelGroups(adsets, audienceMap), [adsets, audienceMap]);
  const [expanded, setExpanded] = useState<Set<FunnelStage>>(new Set());
  const [cols, setCols] = useState<KpiId[]>([...FSA_DEFAULTS]);

  const toggle = (stage: FunnelStage) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(stage)) next.delete(stage); else next.add(stage);
    return next;
  });

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (!adsets.length) return <EmptyState />;

  return (
    <div className="space-y-2">
      <FunnelColPicker cols={cols} setCols={setCols} />
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-2.5 w-8" />
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase whitespace-nowrap">Stage</th>
              {cols.map((id) => {
                const k = KPI_MAP.get(id)!;
                return <th key={id} className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase whitespace-nowrap">{k.label}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const isOpen = expanded.has(g.stage);
              return (
                <>
                  <tr key={g.stage} onClick={() => toggle(g.stage)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-2.5 text-gray-400">
                      {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${STAGE_COLORS[g.stage]}`}>{g.stage}</span>
                      <span className="ml-2 text-xs text-gray-400">{g.children.length} audience{g.children.length !== 1 ? "s" : ""}</span>
                    </td>
                    {cols.map((id) => (
                      <td key={id} className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">
                        {fmtAggKpi(id, g, currency)}
                      </td>
                    ))}
                  </tr>
                  {isOpen && g.children.map((r, i) => (
                    <tr key={`${g.stage}-${i}`} className="border-b border-blue-50 bg-blue-50/30 hover:bg-blue-50">
                      <td className="px-4 py-2" />
                      <td className="px-6 py-2">
                        <div>{audienceBadge(r.classification)}</div>
                        {r.campaignNames.length > 0 && (
                          <div className="text-[10px] text-gray-500 mt-0.5 truncate max-w-[200px]" title={r.campaignNames.join(", ")}>
                            {r.campaignNames[0]}{r.campaignNames.length > 1 ? ` +${r.campaignNames.length - 1}` : ""}
                          </div>
                        )}
                        {r.adSetNames.length > 1 && <div className="text-[10px] text-gray-400">{r.adSetNames.length} ad sets</div>}
                      </td>
                      {cols.map((id) => (
                        <td key={id} className="px-3 py-2 text-right text-gray-600 text-xs whitespace-nowrap">
                          {fmtAggKpi(id, r, currency)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              );
            })}
          </tbody>
        </table>
        <div className="px-5 py-2.5 bg-gray-50 rounded-b-lg text-[11px] text-gray-500">
          Click a stage to expand audience types. Stage is inferred from ad-set name keywords.
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
      No ad set data found. Connect a Meta account or widen the date range.
    </div>
  );
}

// ─── Main tab ────────────────────────────────────────────────────────────────

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  selectedObjectives?: Set<string>;
  setActiveTab?: (id: string) => void;
}

const SUB_TABS = [
  { id: "by-audience", label: "By Audience",    desc: "Aggregated by audience type" },
  { id: "intent",      label: "Intent Buckets",  desc: "Per-ad-set intent classification" },
  { id: "new-exist",   label: "New vs Existing", desc: "Prospecting vs retargeting split" },
  { id: "funnel",      label: "Funnel Stage",     desc: "TOF / MOF / BOF / Loyalty" },
];

export default function AudiencePerformanceTab({ platform, dateRange, customStart, customEnd }: Props) {
  const [active, setActive] = useState("by-audience");
  const { adsets, audienceMap, loading, error, currency, startDate, endDate } = useAdSetInsights(platform, dateRange, customStart, customEnd);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <BarChart2 className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Audience Performance</h1>
            <p className="text-gray-600 mt-1">
              Spend, ROAS, CPA and funnel breakdown by audience type — grouped from ad-set name conventions.
            </p>
          </div>
        </div>
      </div>

      {platform === "google" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          Showing Meta ad-set data. Switch platform to Meta or Both to see results.
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Sub-tab bar */}
      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {SUB_TABS.map((t) => (
          <button key={t.id} onClick={() => setActive(t.id)}
            className={`px-4 py-3 font-semibold border-b-2 transition whitespace-nowrap ${active === t.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900"}`}>
            <div>{t.label}</div>
            <div className="text-xs text-gray-500 font-normal">{t.desc}</div>
          </button>
        ))}
      </div>

      {active === "by-audience" && (
        <ByAudienceTab
          adsets={adsets} audienceMap={audienceMap} loading={loading} currency={currency}
          startDate={startDate} endDate={endDate}
          platform={platform} dateRange={dateRange}
        />
      )}
      {active === "intent"    && <IntentTab    adsets={adsets} audienceMap={audienceMap} loading={loading} currency={currency} />}
      {active === "new-exist" && <NewVsExistingTab adsets={adsets} audienceMap={audienceMap} loading={loading} currency={currency} />}
      {active === "funnel"    && <FunnelStageTab adsets={adsets} audienceMap={audienceMap} loading={loading} currency={currency} />}

      {active !== "by-audience" && (
        <p className="text-[11px] text-gray-400">
          Classification reads Meta&apos;s actual targeting setup (interests, custom audiences, Advantage+ flags). Badges with a dotted border were inferred from the ad-set name because Meta didn&apos;t expose the targeting (typically Advantage+ Shopping).
        </p>
      )}
    </div>
  );
}
