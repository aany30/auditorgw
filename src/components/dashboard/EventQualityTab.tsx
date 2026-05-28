import { useAuthStore } from "@/store/auth";
import { isDemoCredential } from "@/lib/demo-data";
import { useAudit } from "@/hooks/useAudit";
import type { DateRange } from "@/components/shared/DateRangePicker";
import { Info, ExternalLink, RefreshCw } from "lucide-react";

interface Props {
  platform?: "meta" | "google" | "both";
  dateRange?: DateRange;
  customStart?: string;
  customEnd?: string;
}

// Friendly labels for Meta's match-key codes.
const KEY_LABELS: Record<string, string> = {
  em: "Email (em)",
  ph: "Phone (ph)",
  fn: "First Name (fn)",
  ln: "Last Name (ln)",
  ge: "Gender (ge)",
  db: "Date of Birth (db)",
  ct: "City (ct)",
  st: "State (st)",
  zp: "Zip (zp)",
  country: "Country",
  external_id: "External ID",
  client_ip_address: "Client IP",
  client_user_agent: "User Agent",
  fbc: "FB Click ID (fbc)",
  fbp: "FB Browser ID (fbp)",
};

export default function EventQualityTab({ platform = "both", dateRange = "30d", customStart, customEnd }: Props) {
  const { customBenchmarks, metaAccessToken } = useAuthStore();
  const { meta, loading } = useAudit(platform, dateRange, customStart, customEnd);

  // Exact EMQ score (0–10) + dedup rate are NOT exposed by Meta's Graph API.
  // But REAL match-key coverage + PII coverage ARE (aggregation=match_keys /
  // had_pii). For a real Meta connection we show that real coverage data; the
  // proprietary EMQ score + dedup rate still point to Events Manager.
  const isRealMeta = !!metaAccessToken && !isDemoCredential(metaAccessToken);
  if (isRealMeta) {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-24">
          <RefreshCw className="w-10 h-10 text-blue-600 animate-spin mb-3" />
          <p className="text-gray-600">Loading match-key data…</p>
        </div>
      );
    }

    const pixels = meta?.pixels || [];
    // Aggregate match-key coverage across pixels (average % per key).
    const keyAgg = new Map<string, { sum: number; n: number }>();
    for (const p of pixels) {
      for (const k of p.emq.matchKeys) {
        const cur = keyAgg.get(k.key) || { sum: 0, n: 0 };
        cur.sum += k.coverage;
        cur.n += 1;
        keyAgg.set(k.key, cur);
      }
    }
    const matchKeyRows = Array.from(keyAgg.entries())
      .map(([key, { sum, n }]) => ({ key, label: KEY_LABELS[key] || key, coverage: Math.round(sum / n) }))
      .sort((a, b) => b.coverage - a.coverage);
    const piiPcts = pixels.map((p) => p.emq.piiCoveragePct ?? 0).filter((v) => v > 0);
    const avgPii = piiPcts.length > 0 ? Math.round(piiPcts.reduce((a, b) => a + b, 0) / piiPcts.length) : 0;
    const avgKeyCoverage = matchKeyRows.length > 0 ? Math.round(matchKeyRows.reduce((s, r) => s + r.coverage, 0) / matchKeyRows.length) : 0;

    const covColor = (c: number) => (c >= 70 ? "text-green-700 bg-green-100" : c >= 40 ? "text-yellow-700 bg-yellow-100" : "text-red-700 bg-red-100");

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Event Quality (EMQ) Analysis</h1>
          <p className="text-gray-600 mt-1">Real match-key &amp; PII coverage from your pixel (Meta Graph API)</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
            <div className="text-sm text-gray-600">Avg. Match-Key Coverage</div>
            <div className="text-3xl font-bold text-gray-900 mt-1">{avgKeyCoverage}%</div>
            <div className="text-xs text-gray-500 mt-1">Across {matchKeyRows.length} keys</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
            <div className="text-sm text-gray-600">Events with PII / Match Data</div>
            <div className="text-3xl font-bold text-gray-900 mt-1">{avgPii}%</div>
            <div className="text-xs text-gray-500 mt-1">Higher = better matching</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
            <div className="text-sm text-gray-600">EMQ Score (0–10)</div>
            <div className="text-3xl font-bold text-gray-400 mt-1">—</div>
            <div className="text-xs text-gray-500 mt-1">Events Manager only</div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Match-Key Coverage</h2>
            <p className="text-sm text-gray-600 mt-1">% of events that carried each customer-matching parameter — real data from Meta.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Match Key</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Coverage</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody>
                {matchKeyRows.map((r) => (
                  <tr key={r.key} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-6 py-4 font-semibold text-gray-900">{r.label}</td>
                    <td className="px-6 py-4 text-right text-gray-900 font-semibold">{r.coverage}%</td>
                    <td className="px-6 py-4 text-right">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${covColor(r.coverage)}`}>
                        {r.coverage >= 70 ? "Strong" : r.coverage >= 40 ? "Moderate" : "Low"}
                      </span>
                    </td>
                  </tr>
                ))}
                {matchKeyRows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-gray-500">
                      No match-key data returned for this pixel in the selected range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
          <div className="text-sm text-blue-900">
            <span className="font-semibold">EMQ score (0–10) and deduplication rate</span> aren&apos;t exposed by Meta&apos;s API —
            only the match-key coverage above is. View the official EMQ &amp; dedup numbers in Events Manager.
            <a
              href="https://business.facebook.com/events_manager2/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 ml-2 font-semibold underline"
            >
              Open Events Manager <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  const emqBenchmarks = [
    { event: "PageView", current: 6.8, benchmark: 6.0, status: "Healthy", impact: "+0%" },
    { event: "ViewContent", current: 6.2, benchmark: 6.5, status: "Moderate", impact: "+3%" },
    { event: "AddToCart", current: 6.9, benchmark: 7.0, status: "Moderate", impact: "+4%" },
    { event: "InitiateCheckout", current: 7.8, benchmark: 8.0, status: "Moderate", impact: "+5%" },
    { event: "AddPaymentInfo", current: 7.2, benchmark: 8.5, status: "Critical", impact: "+8%" },
    { event: "Purchase", current: 8.4, benchmark: 9.0, status: "Moderate", impact: "+6%" },
    { event: "Lead", current: 7.9, benchmark: 8.0, status: "Moderate", impact: "+2%" },
  ];

  const matchKeys = [
    { key: "Email Hash", coverage: 65, benchmark: 70, status: "Moderate", gap: -5 },
    { key: "Phone Number Hash", coverage: 45, benchmark: 70, status: "Critical", gap: -25 },
    { key: "External ID", coverage: 78, benchmark: 80, status: "Moderate", gap: -2 },
    { key: "Client IP", coverage: 95, benchmark: 90, status: "Healthy", gap: 5 },
    { key: "User Agent", coverage: 98, benchmark: 90, status: "Healthy", gap: 8 },
    { key: "FB Click ID (fbc)", coverage: 62, benchmark: 70, status: "Moderate", gap: -8 },
    { key: "FB Browser ID (fbp)", coverage: 88, benchmark: 85, status: "Healthy", gap: 3 },
  ];

  const statusColor = (s: string) =>
    s === "Healthy" ? "text-green-700 bg-green-100" : s === "Moderate" ? "text-yellow-700 bg-yellow-100" : "text-red-700 bg-red-100";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Event Quality (EMQ) Analysis</h1>
        <p className="text-gray-600 mt-1">Event Match Quality scores benchmarked against Meta recommendations</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Overall EMQ Score</div>
          <div className="text-3xl font-bold text-yellow-600 mt-1">7.1 / 10</div>
          <div className="text-xs text-gray-500 mt-1">Target: {(customBenchmarks.metaEMQScore * 10).toFixed(1)}+</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Avg. Match Key Coverage</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">75%</div>
          <div className="text-xs text-yellow-600 mt-1">↓ 5% below benchmark</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Est. Lift if Fixed</div>
          <div className="text-3xl font-bold text-green-600 mt-1">+28%</div>
          <div className="text-xs text-gray-500 mt-1">Conversion improvement</div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">EMQ Score vs Meta Benchmarks</h2>
          <p className="text-sm text-gray-600 mt-1">Current scores compared against recommended benchmarks per event</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Event Type</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Current Score</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Benchmark</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Gap</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Status</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Est. Impact</th>
              </tr>
            </thead>
            <tbody>
              {emqBenchmarks.map((e, idx) => {
                const gap = (e.current - e.benchmark).toFixed(1);
                return (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-6 py-4 font-semibold text-gray-900">{e.event}</td>
                    <td className="px-6 py-4 text-right text-gray-900 font-bold">{e.current.toFixed(1)}</td>
                    <td className="px-6 py-4 text-right text-gray-700">{e.benchmark.toFixed(1)}+</td>
                    <td className={`px-6 py-4 text-right font-semibold ${parseFloat(gap) >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {parseFloat(gap) >= 0 ? "+" : ""}
                      {gap}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(e.status)}`}>{e.status}</span>
                    </td>
                    <td className="px-6 py-4 text-right text-green-600 font-semibold">{e.impact}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Match Key Coverage</h2>
          <p className="text-sm text-gray-600 mt-1">Quality of advanced matching parameters passed with each event</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Match Key</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Coverage</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Benchmark</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Gap</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {matchKeys.map((m, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4 font-semibold text-gray-900">{m.key}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-24 bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${m.coverage >= m.benchmark ? "bg-green-500" : m.coverage >= m.benchmark - 10 ? "bg-yellow-500" : "bg-red-500"}`}
                          style={{ width: `${m.coverage}%` }}
                        ></div>
                      </div>
                      <span className="text-gray-900 font-semibold w-12 text-right">{m.coverage}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right text-gray-700">{m.benchmark}%+</td>
                  <td className={`px-6 py-4 text-right font-semibold ${m.gap >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {m.gap >= 0 ? "+" : ""}
                    {m.gap}%
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(m.status)}`}>{m.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
