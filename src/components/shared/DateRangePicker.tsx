import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown } from "lucide-react";

export type DateRange = "7d" | "30d" | "90d" | "custom";

interface DateRangePickerProps {
  range: DateRange;
  startDate?: string;
  endDate?: string;
  onChange: (range: DateRange, startDate?: string, endDate?: string) => void;
}

const PRESETS: { value: DateRange; label: string }[] = [
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "custom", label: "Custom Range" },
];

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function DateRangePicker({ range, startDate, endDate, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [tempStart, setTempStart] = useState(startDate || formatDate(new Date(Date.now() - 30 * 86400000)));
  const [tempEnd, setTempEnd] = useState(endDate || formatDate(new Date()));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const label =
    range === "custom" && startDate && endDate
      ? `${startDate} to ${endDate}`
      : PRESETS.find((p) => p.value === range)?.label || "Select range";

  const handlePreset = (preset: DateRange) => {
    if (preset === "custom") {
      onChange("custom", tempStart, tempEnd);
    } else {
      onChange(preset);
      setOpen(false);
    }
  };

  const handleApplyCustom = () => {
    if (new Date(tempEnd) < new Date(tempStart)) return;
    onChange("custom", tempStart, tempEnd);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 bg-white hover:border-gray-400 flex items-center gap-2 min-w-[180px] justify-between"
      >
        <span className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500" />
          {label}
        </span>
        <ChevronDown className="w-4 h-4 text-gray-500" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-2">
          <div className="space-y-1">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => handlePreset(p.value)}
                className={`w-full text-left px-3 py-2 rounded text-sm font-medium transition ${
                  range === p.value
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {range === "custom" && (
            <div className="border-t border-gray-200 mt-2 pt-3 px-2 pb-2 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Start Date</label>
                <input
                  type="date"
                  value={tempStart}
                  max={tempEnd}
                  onChange={(e) => setTempStart(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">End Date</label>
                <input
                  type="date"
                  value={tempEnd}
                  min={tempStart}
                  max={formatDate(new Date())}
                  onChange={(e) => setTempEnd(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <button
                onClick={handleApplyCustom}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm py-2 rounded-lg transition"
              >
                Apply Date Range
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
