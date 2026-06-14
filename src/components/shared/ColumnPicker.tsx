/**
 * Shared column-picker utilities.
 * - useColPicker: hook for ordered column state + picker/swap open state
 * - ColumnPickerButton: top-right "Columns N" button + grouped dropdown
 * - ColHeader: per-column <th> inner content with swap chevron + dropdown
 */

import { useState, useRef, useEffect } from "react";

export interface ColDef {
  id: string;
  label: string;
  group: string;
  defaultOn?: boolean;
}

/** Full canonical KPI list — same 32 options shown across all tables. */
export const ALL_STANDARD_KPIS: ColDef[] = [
  // Core
  { id: "spend",          label: "Spend",           group: "Core" },
  { id: "revenue",        label: "Revenue",         group: "Core" },
  { id: "orders",         label: "Orders",          group: "Core" },
  { id: "roas",           label: "ROAS",            group: "Core" },
  { id: "cpa",            label: "CPA",             group: "Core" },
  { id: "cvr",            label: "CVR",             group: "Core" },
  { id: "aov",            label: "AOV",             group: "Core" },
  // Awareness
  { id: "impressions",    label: "Impressions",     group: "Awareness" },
  { id: "reach",          label: "Reach",           group: "Awareness" },
  { id: "cpm",            label: "CPM",             group: "Awareness" },
  { id: "frequency",      label: "Frequency",       group: "Awareness" },
  { id: "views",          label: "Views",           group: "Awareness" },
  { id: "cpv",            label: "CPV",             group: "Awareness" },
  // Creative Quality
  { id: "vtr",            label: "VTR",             group: "Creative Quality" },
  { id: "ctr",            label: "CTR",             group: "Creative Quality" },
  // Consideration
  { id: "clicks",         label: "Clicks",          group: "Consideration" },
  { id: "cpc",            label: "CPC",             group: "Consideration" },
  { id: "engagements",    label: "Engagements",     group: "Consideration" },
  { id: "engagementRate", label: "Engagement Rate", group: "Consideration" },
  { id: "cpe",            label: "CPE",             group: "Consideration" },
  // Preference
  { id: "leads",          label: "Leads",           group: "Preference" },
  { id: "convRate",       label: "Conv. Rate",      group: "Preference" },
  { id: "cpl",            label: "CPL",             group: "Preference" },
  { id: "traffic",        label: "Traffic",         group: "Preference" },
  { id: "addToCart",      label: "Add to Cart",     group: "Preference" },
  { id: "atcConvRate",    label: "ATC Conv. Rate",  group: "Preference" },
  { id: "install",        label: "Install",         group: "Preference" },
  { id: "cpi",            label: "CPI",             group: "Preference" },
  // Purchase
  { id: "sales",          label: "Sales",           group: "Purchase" },
  { id: "saleConvRate",   label: "Sale Conv. Rate", group: "Purchase" },
  { id: "cps",            label: "CPS",             group: "Purchase" },
  { id: "acos",           label: "ACOS",            group: "Purchase" },
];

export const STD_KPI_MAP = new Map(ALL_STANDARD_KPIS.map((k) => [k.id, k]));

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useColPicker(defaultIds: string[]) {
  const [cols, setCols] = useState<string[]>([...defaultIds]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [swapIdx, setSwapIdx] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function h(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [pickerOpen]);

  useEffect(() => {
    if (swapIdx === null) return;
    function h(e: MouseEvent) {
      if (tableRef.current && !tableRef.current.contains(e.target as Node)) setSwapIdx(null);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [swapIdx]);

  const toggleCol = (id: string) => {
    setCols((prev) => prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]);
  };

  const swapCol = (idx: number, newId: string) => {
    setCols((prev) => {
      const next = [...prev];
      const existingIdx = next.indexOf(newId);
      if (existingIdx !== -1) {
        [next[existingIdx], next[idx]] = [next[idx], next[existingIdx]];
      } else {
        next[idx] = newId;
      }
      return next;
    });
    setSwapIdx(null);
  };

  return {
    cols, setCols,
    pickerOpen, setPickerOpen, pickerRef,
    swapIdx, setSwapIdx, tableRef,
    toggleCol, swapCol,
    resetCols: (ids: string[]) => setCols([...ids]),
  };
}

// ─── Top-right picker button ─────────────────────────────────────────────────

interface PickerBtnProps {
  cols: string[];
  allDefs: ColDef[];
  defaultIds: string[];
  pickerOpen: boolean;
  setPickerOpen: (v: boolean) => void;
  pickerRef: React.RefObject<HTMLDivElement>;
  toggleCol: (id: string) => void;
  resetCols: (ids: string[]) => void;
}

export function ColumnPickerButton({
  cols, allDefs, defaultIds, pickerOpen, setPickerOpen, pickerRef, toggleCol, resetCols,
}: PickerBtnProps) {
  const groups = Array.from(new Set(allDefs.map((k) => k.group)));
  return (
    <div className="flex justify-end mb-2" ref={pickerRef}>
      <div className="relative">
        <button
          onClick={() => setPickerOpen(!pickerOpen)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition shadow-sm"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 4h12M4 8h8M6 12h4" />
          </svg>
          Columns
          <span className="ml-0.5 bg-gray-200 text-gray-700 rounded-full text-[10px] font-bold px-1.5 py-0.5 leading-none">
            {cols.length}
          </span>
        </button>

        {pickerOpen && (
          <div className="absolute right-0 top-full mt-1.5 z-50 w-60 bg-gray-900 text-white rounded-xl shadow-2xl overflow-hidden border border-gray-700">
            <div className="px-4 py-2.5 border-b border-gray-700 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-300">Columns</span>
              <button onClick={() => resetCols(defaultIds)} className="text-[10px] text-gray-400 hover:text-white transition">
                Reset defaults
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto py-1">
              {groups.map((group) => (
                <div key={group}>
                  <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">{group}</div>
                  {allDefs.filter((k) => k.group === group).map((k) => {
                    const on = cols.includes(k.id);
                    return (
                      <button
                        key={k.id}
                        onClick={() => toggleCol(k.id)}
                        className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition ${on ? "bg-blue-600/20 text-blue-300" : "text-gray-200 hover:bg-gray-800"}`}
                      >
                        <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? "bg-blue-600 border-blue-500" : "border-gray-600"}`}>
                          {on && (
                            <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M1.5 5l2.5 2.5 4.5-4.5" />
                            </svg>
                          )}
                        </span>
                        {k.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-gray-700 text-[10px] text-gray-500">{cols.length} selected</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Per-column header with swap dropdown ─────────────────────────────────────

interface ColHeaderProps {
  colIdx: number;
  currentId: string;
  label: string;
  allDefs: ColDef[];
  swapIdx: number | null;
  setSwapIdx: (idx: number | null) => void;
  swapCol: (idx: number, newId: string) => void;
  /** Optional: render label as a clickable sort button */
  onSortClick?: () => void;
  sortIndicator?: string;
}

export function ColHeader({
  colIdx, currentId, label, allDefs, swapIdx, setSwapIdx, swapCol, onSortClick, sortIndicator,
}: ColHeaderProps) {
  const groups = Array.from(new Set(allDefs.map((k) => k.group)));
  const isOpen = swapIdx === colIdx;
  return (
    <div className="relative flex items-center justify-end gap-0.5">
      {onSortClick ? (
        <button
          onClick={onSortClick}
          className="text-[11px] font-semibold text-gray-600 uppercase cursor-pointer select-none whitespace-nowrap hover:text-gray-900"
        >
          {label}{sortIndicator ?? ""}
        </button>
      ) : (
        <span className="text-[11px] font-semibold text-gray-600 uppercase whitespace-nowrap">{label}</span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); setSwapIdx(isOpen ? null : colIdx); }}
        className="text-gray-400 hover:text-gray-700 transition shrink-0 ml-1"
        title="Change column"
      >
        <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M5 2v6M2 5l3 3 3-3" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-gray-900 text-white rounded-xl shadow-2xl overflow-hidden border border-gray-700">
          <div className="px-3 py-2 border-b border-gray-700 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Change column
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {groups.map((group) => (
              <div key={group}>
                <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">{group}</div>
                {allDefs.filter((kk) => kk.group === group).map((kk) => {
                  const isCurrent = kk.id === currentId;
                  return (
                    <button
                      key={kk.id}
                      onClick={() => !isCurrent && swapCol(colIdx, kk.id)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition ${isCurrent ? "text-blue-400 font-semibold bg-blue-600/10 cursor-default" : "text-gray-200 hover:bg-gray-800"}`}
                    >
                      {isCurrent && (
                        <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1.5 5l2.5 2.5 4.5-4.5" />
                        </svg>
                      )}
                      {kk.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
