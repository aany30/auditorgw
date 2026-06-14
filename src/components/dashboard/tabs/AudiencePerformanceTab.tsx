/**
 * Campaign → Audience Performance (doc §5)
 *
 * Aggregates ad sets by audience type label (Broad, Interest, LAL, etc.)
 * — one row per audience type, sortable. Individual ad sets visible via
 * expandable drill-down per row.
 */

import { useMemo, useState } from "react";
import { BarChart2, AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useColPicker, ColumnPickerButton, ColHeader, ALL_STANDARD_KPIS, STD_KPI_MAP } from "@/components/shared/ColumnPicker";
import { useAdSetInsights } from "@/hooks/useAdSetInsights";
import { formatMoney } from "@/lib/currency";
import type { DateRange } from "@/components/shared/DateRangePicker";
import type { AdSetRow } from "@/pages/api/audience/adset-insights/meta";

// ─── Label parsing ─────────────────────────────────────────────────────────

export function parseAudienceLabel(name: string): string {
  const n = name.toLowerCase();
  if (/\blal\b|lookalike/.test(n)) return "LAL";
  if (/interest/.test(n)) return "Interest";
  if (/\bbroad\b|gw_all|gw-all|_all_/.test(n)) return "Broad";
  if (/video/.test(n)) return "Video Viewers";
  if (/\batc\b|add.to.cart/.test(n)) return "ATC";
  if (/checkout|abandon/.test(n)) return "Checkout";
  if (/\bbuyer/.test(n)) return "Buyers";
  if (/ig\b|instagram|engaged/.test(n)) return "IG Engaged";
  if (/visitor|website|\bweb\b|app visitor/.test(n)) return "Web Visitors";
  if (/customer|loyal|existing/.test(n)) return "Customers";
  if (/prosp|cold/.test(n)) return "Prospecting";
  if (/catalog|dpa|dynamic.product/.test(n)) return "Catalog/DPA";
  if (/\basc\b|advantage.shopping/.test(n)) return "ASC";
  if (/\bopen\b/.test(n)) return "Broad";
  if (/retarget|remark/.test(n)) return "Retargeting";
  if (/\bsales\b/.test(n)) return "Sales";
  if (/\btest\b/.test(n)) return "Test";
  if (/skinca|plenaire|brand/.test(n)) return "Brand";
  if (/premium|vip|high.value/.test(n)) return "High Value";
  if (/creative|cci/.test(n)) return "Creative Test";
  // Date-only names
  if (/^\d{2}[\/\-]\d{2}$/.test(name.trim())) return "—";
  // Fallback: split and discard date/numeric segments
  const parts = name.split(/[\s\-|–_/]+/).filter(p => p.length > 1 && !/^\d+$/.test(p));
  const meaningful = parts.filter(p =>
    !/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4]|w\d+)\d*/i.test(p) &&
    !/^\d{4}$/.test(p) &&
    !/^\d+(st|nd|rd|th)$/i.test(p) &&
    !/^\d{1,2}[\/\-]\d{2}$/.test(p)
  );
  const last = meaningful[meaningful.length - 1];
  return last ? last.slice(0, 22) : "—";
}

// ─── Aggregation ────────────────────────────────────────────────────────────

interface AggRow {
  label: string;
  adSets: AdSetRow[];
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

function aggregate(adsets: AdSetRow[]): AggRow[] {
  const map = new Map<string, AdSetRow[]>();
  for (const a of adsets) {
    const lbl = parseAudienceLabel(a.name);
    if (!map.has(lbl)) map.set(lbl, []);
    map.get(lbl)!.push(a);
  }
  return [...map.entries()].map(([label, rows]) => ({
    label,
    adSets: rows,
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

// ─── KPI config ─────────────────────────────────────────────────────────────

type SortKey = "spend" | "impressions" | "clicks" | "ctr" | "cpc" | "conversions" | "conversionValue" | "roas" | "cpa" | "cvr" | "aov" | "cpm";

const SORT_KEY_MAP: Record<string, SortKey | undefined> = {
  spend: "spend", impressions: "impressions", clicks: "clicks",
  ctr: "ctr", cpc: "cpc", orders: "conversions", revenue: "conversionValue",
  roas: "roas", cpa: "cpa", cvr: "cvr", aov: "aov", cpm: "cpm",
};

const DEFAULT_KPIS = ["spend", "revenue", "orders", "roas", "cpa", "impressions", "ctr", "clicks", "cpc"];

function fmtKpi(id: string, r: AggRow, m: ReturnType<typeof deriveAgg>, cur: (n: number) => string, cur2: (n: number) => string): string {
  const acos = r.conversionValue > 0 ? (r.spend / r.conversionValue) * 100 : 0;
  switch (id) {
    case "spend":          return cur(r.spend);
    case "revenue":        return cur(r.conversionValue);
    case "orders":
    case "sales":          return Math.round(r.conversions).toLocaleString("en-IN");
    case "roas":           return m.roas > 0 ? `${m.roas.toFixed(2)}×` : "—";
    case "cpa":
    case "cps":            return m.cpa > 0 ? cur(m.cpa) : "—";
    case "cvr":
    case "convRate":
    case "saleConvRate":   return m.cvr > 0 ? `${m.cvr.toFixed(2)}%` : "—";
    case "aov":            return m.aov > 0 ? cur(m.aov) : "—";
    case "impressions":    return Math.round(r.impressions).toLocaleString("en-IN");
    case "cpm":            return m.cpm > 0 ? cur2(m.cpm) : "—";
    case "ctr":            return m.ctr > 0 ? `${m.ctr.toFixed(2)}%` : "—";
    case "clicks":         return Math.round(r.clicks).toLocaleString("en-IN");
    case "cpc":            return m.cpc > 0 ? cur2(m.cpc) : "—";
    case "acos":           return acos > 0 ? `${acos.toFixed(1)}%` : "—";
    default:               return "—";
  }
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  selectedObjectives?: Set<string>;
  setActiveTab?: (id: string) => void;
}

// ─── Drill-down row ─────────────────────────────────────────────────────────

function DrillDown({ adSets, currency, colCount }: { adSets: AdSetRow[]; currency: string; colCount: number }) {
  const cur = (n: number) => formatMoney(n, currency, 0);
  const sorted = [...adSets].sort((a, b) => b.spend - a.spend);
  return (
    <tr>
      <td colSpan={colCount + 2} className="px-0 py-0 bg-blue-50/40">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-t border-blue-100">
            <thead>
              <tr className="bg-blue-50 border-b border-blue-100">
                <th className="px-6 py-1.5 text-left font-semibold text-blue-700 uppercase text-[10px]">Ad Set Name</th>
                <th className="px-4 py-1.5 text-right font-semibold text-blue-700 uppercase text-[10px]">Spend</th>
                <th className="px-4 py-1.5 text-right font-semibold text-blue-700 uppercase text-[10px]">Impressions</th>
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
                    <td className="px-4 py-1.5 text-right text-gray-700 font-semibold">{cur(a.spend)}</td>
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

// ─── Main component ─────────────────────────────────────────────────────────

export default function AudiencePerformanceTab({ platform, dateRange, customStart, customEnd }: Props) {
  const { adsets, loading, error, currency, startDate, endDate } = useAdSetInsights(platform, dateRange, customStart, customEnd);
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { cols, pickerOpen, setPickerOpen, pickerRef, swapIdx, setSwapIdx, tableRef, toggleCol, swapCol, resetCols } = useColPicker(DEFAULT_KPIS);

  const rows = useMemo(() => {
    const agg = aggregate(adsets);
    return [...agg].sort((a, b) => {
      const ma = deriveAgg(a); const mb = deriveAgg(b);
      const va = (sortKey in ma ? (ma as unknown as Record<string, number>)[sortKey] : (a as unknown as Record<string, number>)[sortKey]) ?? 0;
      const vb = (sortKey in mb ? (mb as unknown as Record<string, number>)[sortKey] : (b as unknown as Record<string, number>)[sortKey]) ?? 0;
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [adsets, sortKey, sortDir]);

  const cur  = (n: number) => formatMoney(n, currency, 0);
  const cur2 = (n: number) => formatMoney(n, currency, 2);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const toggleExpand = (label: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <BarChart2 className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Audience Performance</h1>
            <p className="text-gray-600 mt-1">Spend, Impressions, Clicks, CTR, CPC, Orders, Revenue, ROAS, CPA — grouped by audience type. Click a row to see individual ad sets.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
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
      </div>

      {platform === "google" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          Showing Meta ad-set data. Switch platform to Meta or Both.
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {loading && <div className="text-sm text-gray-500">Loading ad-set data…</div>}

      {!loading && adsets.length === 0 && (
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
          No ad set data. Connect a Meta account or widen the date range.
        </div>
      )}

      {!loading && adsets.length > 0 && (
        <div className="space-y-2">
          <ColumnPickerButton
            cols={cols} allDefs={ALL_STANDARD_KPIS} defaultIds={DEFAULT_KPIS}
            pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} pickerRef={pickerRef}
            toggleCol={toggleCol} resetCols={resetCols}
          />
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm" ref={tableRef}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase w-8" />
                    <th
                      onClick={() => toggleSort("spend")}
                      className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 select-none"
                    >
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
                        <tr key={r.label}
                          onClick={() => toggleExpand(r.label)}
                          className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                          <td className="px-4 py-2.5 text-gray-400">
                            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="font-semibold text-gray-900">{r.label}</div>
                            <div className="text-[10px] text-gray-400">{r.adSets.length} ad set{r.adSets.length !== 1 ? "s" : ""}</div>
                          </td>
                          {cols.map((id) => (
                            <td key={id} className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">
                              {fmtKpi(id, r, m, cur, cur2)}
                            </td>
                          ))}
                        </tr>
                        {isOpen && <DrillDown key={`${r.label}-drill`} adSets={r.adSets} currency={currency} colCount={cols.length} />}
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
      )}
    </div>
  );
}
