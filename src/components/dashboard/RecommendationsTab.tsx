import { useAudit } from "@/hooks/useAudit";
import { useState } from "react";
import type { DateRange } from "@/components/shared/DateRangePicker";
import { RefreshCw, Bot, Filter } from "lucide-react";
import { useSort } from "@/hooks/useSort";
import SortTh from "@/components/shared/SortTh";

interface Props {
  platform?: "meta" | "google" | "both";
  dateRange?: DateRange;
  customStart?: string;
  customEnd?: string;
}

export default function RecommendationsTab({ platform = "both", dateRange = "30d", customStart, customEnd }: Props) {
  const { meta, google, loading } = useAudit(platform, dateRange, customStart, customEnd);
  const [priorityFilter, setPriorityFilter] = useState<string>("All");
  const [platformFilter, setPlatformFilter] = useState<string>("All");

  // ALL hooks must run on every render (Rules of Hooks). Compute the rows +
  // run useSort BEFORE any early return — otherwise toggling `loading` changes
  // the hook count and React throws "Rendered more hooks than previous render".
  const allRecs = [...(meta?.recommendations || []), ...(google?.recommendations || [])];
  const filtered = allRecs.filter(
    (r) =>
      (priorityFilter === "All" || r.priority === priorityFilter) &&
      (platformFilter === "All" || r.platform === platformFilter)
  );
  const { sorted: sortedRecs, sort: recSort, toggle: recToggle } = useSort(filtered, "priority", "asc");

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <RefreshCw className="w-10 h-10 text-blue-600 animate-spin mb-3" />
        <p className="text-gray-600">Generating recommendations...</p>
      </div>
    );
  }

  const priorityColor = (p: string) =>
    p === "Critical" ? "bg-red-100 text-red-700 border-red-300" :
    p === "High" ? "bg-orange-100 text-orange-700 border-orange-300" :
    p === "Medium" ? "bg-yellow-100 text-yellow-700 border-yellow-300" :
    "bg-blue-100 text-blue-700 border-blue-300";

  const effortColor = (e: string) =>
    e === "Quick" ? "text-green-700 bg-green-100" : e === "Medium" ? "text-yellow-700 bg-yellow-100" : "text-red-700 bg-red-100";

  const totalLift = allRecs.reduce((sum, r) => sum + r.impact, 0).toFixed(1);
  const avgConfidence = allRecs.length > 0
    ? Math.round(allRecs.reduce((s, r) => s + r.confidence, 0) / allRecs.length)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Bot className="w-8 h-8 text-purple-600" /> AI Recommendations
          </h1>
          <p className="text-gray-600 mt-1">Prioritized fixes ranked by impact × confidence ÷ effort</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Total Recommendations</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{allRecs.length}</div>
          <div className="text-xs text-gray-500 mt-1">Across Meta + Google</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Critical Issues</div>
          <div className="text-3xl font-bold text-red-600 mt-1">{allRecs.filter(r => r.priority === "Critical").length}</div>
          <div className="text-xs text-gray-500 mt-1">Fix immediately</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Avg Confidence</div>
          <div className="text-3xl font-bold text-blue-600 mt-1">{avgConfidence}%</div>
          <div className="text-xs text-gray-500 mt-1">Engine certainty</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Potential Lift</div>
          <div className="text-3xl font-bold text-green-600 mt-1">+{totalLift}%</div>
          <div className="text-xs text-gray-500 mt-1">If all fixed</div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Prioritized Recommendations</h2>
            <p className="text-sm text-gray-600 mt-1">Generated from real benchmarks (Meta CAPI docs + Google Enhanced Conversions)</p>
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 bg-white"
            >
              <option>All</option>
              <option>Critical</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 bg-white"
            >
              <option>All</option>
              <option>Meta</option>
              <option>Google</option>
            </select>
          </div>
        </div>
        <div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
              <tr>
                <SortTh col="priority" sort={recSort} onToggle={recToggle} className="px-6 py-3">Priority</SortTh>
                <SortTh col="platform" sort={recSort} onToggle={recToggle} className="px-6 py-3">Platform</SortTh>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Recommendation</th>
                <SortTh col="category" sort={recSort} onToggle={recToggle} className="px-6 py-3">Category</SortTh>
                <SortTh col="effort" sort={recSort} onToggle={recToggle} className="px-6 py-3" align="right">Effort</SortTh>
                <SortTh col="confidence" sort={recSort} onToggle={recToggle} className="px-6 py-3" align="right">Confidence</SortTh>
                <SortTh col="impact" sort={recSort} onToggle={recToggle} className="px-6 py-3" align="right">Impact</SortTh>
              </tr>
            </thead>
            <tbody>
              {sortedRecs.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${priorityColor(r.priority)}`}>{r.priority}</span>
                  </td>
                  <td className="px-6 py-4 text-gray-700 font-medium">{r.platform}</td>
                  <td className="px-6 py-4 max-w-md">
                    <div className="font-semibold text-gray-900">{r.issue}</div>
                    <div className="text-xs text-gray-600 mt-1">{r.details}</div>
                    <div className="text-xs text-blue-600 mt-1 italic">→ {r.action}</div>
                  </td>
                  <td className="px-6 py-4 text-gray-700 text-xs">{r.category}</td>
                  <td className="px-6 py-4 text-right">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${effortColor(r.effort)}`}>{r.effort}</span>
                  </td>
                  <td className="px-6 py-4 text-right text-blue-600 font-semibold">{r.confidence}%</td>
                  <td className="px-6 py-4 text-right text-green-600 font-bold">+{r.impact.toFixed(1)}%</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    No recommendations match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
