import { useState, useRef, useEffect } from "react";
import { Target, ChevronDown, Check } from "lucide-react";

export const CAMPAIGN_OBJECTIVES = [
  "Awareness",
  "Reach",
  "Traffic",
  "Engagement",
  "App Promotion",
  "Video Views",
  "Lead Generation",
  "Conversions",
  "Sales",
  "Store Visits",
  "Brand Consideration",
  "Catalog Sales",
];

interface Props {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

export default function CampaignObjectiveFilter({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [open]);

  const allSelected = selected.size === 0;
  const label = allSelected
    ? "All Objectives"
    : selected.size === 1
    ? Array.from(selected)[0]
    : `${selected.size} selected`;

  const toggle = (objective: string) => {
    const next = new Set(selected);
    if (next.has(objective)) {
      next.delete(objective);
    } else {
      next.add(objective);
    }
    onChange(next);
  };

  const selectAll = () => onChange(new Set());

  const selectNone = () => onChange(new Set(["__none__"])); // sentinel "nothing matches"

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
        title="Filter by campaign objective"
      >
        <Target className="w-4 h-4 text-blue-600" />
        <span className="max-w-[140px] truncate">{label}</span>
        <ChevronDown className={`w-4 h-4 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
          <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Campaign Objective
            </span>
            <div className="flex gap-2 text-xs">
              <button
                onClick={selectAll}
                className="text-blue-600 hover:text-blue-700 font-semibold"
              >
                All
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={selectNone}
                className="text-gray-500 hover:text-gray-700 font-semibold"
              >
                None
              </button>
            </div>
          </div>
          <div className="py-1">
            {CAMPAIGN_OBJECTIVES.map((obj) => {
              const isChecked = allSelected || (selected.has(obj) && !selected.has("__none__"));
              return (
                <button
                  key={obj}
                  onClick={() => toggle(obj)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center ${
                      isChecked ? "bg-blue-600 border-blue-600" : "border-gray-300 bg-white"
                    }`}
                  >
                    {isChecked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </div>
                  <span>{obj}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Helper: does this campaign objective pass the filter?
 * - Empty set = "All" → always passes
 * - Set containing "__none__" → nothing passes (force-empty state)
 * - Otherwise: case-insensitive match against any selected objective
 */
export function objectiveMatches(
  campaignObjective: string | undefined,
  selected: Set<string>
): boolean {
  if (selected.size === 0) return true;
  if (selected.has("__none__")) return false;
  if (!campaignObjective) return false;
  const lower = campaignObjective.toLowerCase();
  for (const sel of selected) {
    if (lower.includes(sel.toLowerCase()) || sel.toLowerCase().includes(lower)) {
      return true;
    }
  }
  return false;
}
