import type { MetaPixelStats } from "@/lib/api-clients/meta";
import { useAuthStore } from "@/store/auth";
import { Server, ShieldCheck, Clock, AlertTriangle, KeyRound } from "lucide-react";

export default function CapiHealthCard({ pixel }: { pixel: MetaPixelStats }) {
  const { customBenchmarks } = useAuthStore();
  const c = pixel.capi;
  const score = c.capiHealthScore;
  const scoreColor =
    score >= 85 ? "text-green-600" : score >= 65 ? "text-yellow-600" : "text-red-600";

  const breakdownRows = [
    { label: "Deduplication", value: c.capiBreakdown.deduplication, suffix: "%", target: customBenchmarks.metaDedupRate * 100 },
    { label: "event_id consistency", value: c.capiBreakdown.eventIdConsistency, suffix: "%", target: 90 },
    { label: "Payload completeness", value: c.capiBreakdown.payloadCompleteness, suffix: "%", target: customBenchmarks.metaPayloadCompleteness * 100 },
    { label: "Authentication status", value: c.capiBreakdown.authStatus, suffix: "%", target: 95 },
    { label: "Avg server latency", value: c.capiBreakdown.avgServerLatencyMs, suffix: "ms", target: customBenchmarks.metaEventLatencyMs, inverse: true },
    { label: "API failure rate", value: c.capiBreakdown.apiFailureRate, suffix: "%", target: 1, inverse: true },
  ];

  const status = (row: typeof breakdownRows[0]) => {
    const passes = row.inverse ? row.value <= row.target : row.value >= row.target;
    return passes ? "Healthy" : "Below benchmark";
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="p-5 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-bold text-gray-900">CAPI Health — {pixel.name}</h3>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold ${scoreColor}`}>{score}</div>
          <div className="text-xs text-gray-500">CAPI Score / 100</div>
        </div>
      </div>
      <div className="p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="bg-gray-50 rounded p-2">
            <div className="text-gray-600">Server share</div>
            <div className="font-bold text-gray-900 text-base">{c.serverShare}%</div>
          </div>
          <div className="bg-gray-50 rounded p-2">
            <div className="text-gray-600">Browser share</div>
            <div className="font-bold text-gray-900 text-base">{c.browserShare}%</div>
          </div>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {breakdownRows.map((row) => {
              const passes = row.inverse ? row.value <= row.target : row.value >= row.target;
              return (
                <tr key={row.label} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 text-gray-700">{row.label}</td>
                  <td className="py-2 text-right font-semibold text-gray-900">
                    {typeof row.value === "number" ? row.value.toFixed(row.suffix === "%" ? 0 : 0) : row.value}{row.suffix}
                  </td>
                  <td className="py-2 text-right">
                    <span className={`text-xs font-semibold ${passes ? "text-green-600" : "text-red-600"}`}>
                      {status(row)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {c.authIssues.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mt-2 space-y-2">
            <div className="text-xs font-semibold text-yellow-900 flex items-center gap-1">
              <KeyRound className="w-3.5 h-3.5" /> Authentication issues
            </div>
            {c.authIssues.map((a, i) => (
              <div key={i} className="text-xs text-yellow-800 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>{a.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
