import { useAuthStore } from "@/store/auth";
import FixRecommendation from "@/components/shared/FixRecommendation";
import ConnectCta from "@/components/shared/ConnectCta";
import { TermText } from "@/components/shared/Term";
import BenchmarkSourceSwitcher from "@/components/dashboard/BenchmarkSourceSwitcher";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";

export default function FunnelAuditTab() {
  const { customBenchmarks, isMetaConnected, isGoogleConnected, benchmarkSnapshots, activeBenchmarkId } = useAuthStore();
  const metaOn = isMetaConnected();
  const googleOn = isGoogleConnected();
  const activeSnapshot = benchmarkSnapshots.find((s) => s.id === activeBenchmarkId);

  // Resolve a benchmark value for a stage. Falls back to the hardcoded value
  // baked into the funnel data when the active source doesn't define this stage.
  const benchFor = (stage: string, fallback: number): number => {
    const v = activeSnapshot?.values?.[stage];
    return typeof v === "number" ? v : fallback;
  };

  const dropOffThreshold = customBenchmarks.funnelDropOffThreshold * 100;
  const dropOffWarningThreshold = dropOffThreshold * 0.7;

  const getDropOffStatus = (dropOff: number) => {
    if (dropOff === 0) return "Healthy";
    if (dropOff <= dropOffWarningThreshold) return "Healthy";
    if (dropOff <= dropOffThreshold) return "Moderate";
    return "Critical";
  };

  const funnelMeta = [
    { stage: "PageView", count: 125000, rate: 100, dropOff: 0, benchmark: benchFor("PageView", 100), status: getDropOffStatus(0) },
    { stage: "ViewContent", count: 95000, rate: 76, dropOff: 24, benchmark: benchFor("ViewContent", 80), status: getDropOffStatus(24) },
    { stage: "AddToCart", count: 45000, rate: 36, dropOff: 52, benchmark: benchFor("AddToCart", 25), status: getDropOffStatus(52) },
    { stage: "InitiateCheckout", count: 15000, rate: 12, dropOff: 67, benchmark: benchFor("InitiateCheckout", 10), status: getDropOffStatus(67) },
    { stage: "AddPaymentInfo", count: 11000, rate: 8.8, dropOff: 27, benchmark: benchFor("AddPaymentInfo", 7), status: getDropOffStatus(27) },
    { stage: "Purchase", count: 8500, rate: 6.8, dropOff: 23, benchmark: benchFor("Purchase", 3), status: getDropOffStatus(23) },
  ];

  const funnelGoogle = [
    { stage: "view_item", count: 125000, rate: 100, dropOff: 0, benchmark: benchFor("view_item", 100), status: getDropOffStatus(0) },
    { stage: "add_to_cart", count: 42000, rate: 33.6, dropOff: 66, benchmark: benchFor("add_to_cart", 35), status: getDropOffStatus(66) },
    { stage: "begin_checkout", count: 14200, rate: 11.4, dropOff: 66, benchmark: benchFor("begin_checkout", 12), status: getDropOffStatus(66) },
    { stage: "purchase", count: 8500, rate: 6.8, dropOff: 40, benchmark: benchFor("purchase", 3), status: getDropOffStatus(40) },
  ];

  const recommendations: Array<{
    stage: string;
    title: string;
    severity: "Critical" | "High" | "Medium";
    impact: string;
    metric: string;
    platform: "meta" | "google" | "both";
    value: string;
    siblingMetrics: Record<string, string | number>;
  }> = [
    {
      stage: "InitiateCheckout",
      title: "InitiateCheckout drop-off is 63% — well above the 35% benchmark",
      severity: "Critical",
      impact: "+8% conversion",
      metric: "funnel_leakage_severe",
      platform: "meta",
      value: "63%",
      siblingMetrics: { Stage: "InitiateCheckout", "Drop-off": "63%", Benchmark: "35%", "Conversion Rate": "6.8%" },
    },
    {
      stage: "Purchase",
      title: "12% of Purchase events are missing event_id",
      severity: "High",
      impact: "+3% match rate",
      metric: "capi_low_dedup",
      platform: "meta",
      value: "12%",
      siblingMetrics: { Stage: "Purchase", "Missing event_id %": "12%", "Match Rate impact": "+3%" },
    },
    {
      stage: "AddToCart",
      title: "Duplicate AddToCart events firing (2.8% of total)",
      severity: "Medium",
      impact: "+1.5%",
      metric: "capi_low_dedup",
      platform: "meta",
      value: "2.8%",
      siblingMetrics: { Stage: "AddToCart", "Duplicate rate": "2.8%" },
    },
  ];

  const statusColor = (s: string) =>
    s === "Healthy" ? "text-green-700 bg-green-100" : s === "Moderate" ? "text-yellow-700 bg-yellow-100" : "text-red-700 bg-red-100";

  const severityIcon = (severity: "Critical" | "High" | "Medium") => {
    if (severity === "Critical") return { Icon: AlertCircle, ring: "bg-red-100 text-red-600", chip: "bg-red-100 text-red-700" };
    if (severity === "High") return { Icon: AlertTriangle, ring: "bg-orange-100 text-orange-600", chip: "bg-orange-100 text-orange-700" };
    return { Icon: Info, ring: "bg-yellow-100 text-yellow-600", chip: "bg-yellow-100 text-yellow-700" };
  };

  const severityToStatus = (s: "Critical" | "High" | "Medium"): "critical" | "bad" | "warn" => {
    if (s === "Critical") return "critical";
    if (s === "High") return "bad";
    return "warn";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Funnel Audit</h1>
        <p className="text-gray-600 mt-1">Conversion funnel validation and drop-off analysis</p>
      </div>

      {(metaOn || googleOn) && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
            <div className="text-sm text-gray-600">Funnel Health</div>
            <div className="text-3xl font-bold text-yellow-600 mt-1">72</div>
            <div className="text-xs text-gray-500 mt-1">Moderate — needs attention</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
            <div className="text-sm text-gray-600">Conversion Rate</div>
            <div className="text-3xl font-bold text-gray-900 mt-1">6.8%</div>
            <div className="text-xs text-green-600 mt-1">↑ 0.4% vs last month</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
            <div className="text-sm text-gray-600">Biggest Drop-off</div>
            <div className="text-3xl font-bold text-red-600 mt-1">67%</div>
            <div className="text-xs text-gray-500 mt-1">Cart → Checkout</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
            <div className="text-sm text-gray-600">Critical Issues</div>
            <div className="text-3xl font-bold text-red-600 mt-1">3</div>
            <div className="text-xs text-gray-500 mt-1">Requires immediate fix</div>
          </div>
        </div>
      )}

      {metaOn ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Meta Funnel — Pixel Events</h2>
            <p className="text-sm text-gray-600 mt-1"><TermText>Conversion stages and drop-off rates vs. benchmarks</TermText></p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Stage</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Users</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Rate</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Drop-off</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">
                    <span className="inline-flex items-center justify-end">
                      Benchmark
                      <BenchmarkSourceSwitcher
                        stages={["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "AddPaymentInfo", "Purchase", "view_item", "add_to_cart", "begin_checkout", "purchase"]}
                        platform="both"
                      />
                    </span>
                  </th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody>
                {funnelMeta.map((f, idx) => (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-6 py-4 font-semibold text-gray-900">{f.stage}</td>
                    <td className="px-6 py-4 text-right text-gray-900">{f.count.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-gray-900 font-semibold">{f.rate}%</td>
                    <td className="px-6 py-4 text-right text-red-600 font-semibold">{f.dropOff > 0 ? `-${f.dropOff}%` : "—"}</td>
                    <td className="px-6 py-4 text-right text-gray-700">{f.benchmark}%</td>
                    <td className="px-6 py-4 text-right">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(f.status)}`}>{f.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <ConnectCta platform="Meta" />
      )}

      {googleOn ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Google GA4 Funnel — Ecommerce Events</h2>
            <p className="text-sm text-gray-600 mt-1"><TermText>GA4 standard ecommerce conversion path</TermText></p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Stage</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Users</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Rate</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Drop-off</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">
                    <span className="inline-flex items-center justify-end">
                      Benchmark
                      <BenchmarkSourceSwitcher
                        stages={["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "AddPaymentInfo", "Purchase", "view_item", "add_to_cart", "begin_checkout", "purchase"]}
                        platform="both"
                      />
                    </span>
                  </th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody>
                {funnelGoogle.map((f, idx) => (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-6 py-4 font-semibold text-gray-900 font-mono">{f.stage}</td>
                    <td className="px-6 py-4 text-right text-gray-900">{f.count.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-gray-900 font-semibold">{f.rate}%</td>
                    <td className="px-6 py-4 text-right text-red-600 font-semibold">{f.dropOff > 0 ? `-${f.dropOff}%` : "—"}</td>
                    <td className="px-6 py-4 text-right text-gray-700">{f.benchmark}%</td>
                    <td className="px-6 py-4 text-right">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(f.status)}`}>{f.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <ConnectCta platform="Google" />
      )}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Recommendations</h2>
          <p className="text-sm text-gray-600 mt-0.5">
            Prioritised actions to fix funnel leakage. Click "How to fix this" on any row for step-by-step instructions.
          </p>
        </div>
        <div className="divide-y divide-gray-100">
          {recommendations
            .filter((rec) => (rec.platform === "google" ? googleOn : metaOn))
            .map((rec, idx) => {
            const { Icon, ring, chip } = severityIcon(rec.severity);
            return (
              <div key={idx} className="p-5">
                <div className="flex items-start gap-3">
                  <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${ring}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <h3 className="font-bold text-gray-900">{rec.title}</h3>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${chip}`}>
                          {rec.severity}
                        </span>
                        <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                          Est. impact: {rec.impact}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">
                      Stage: <span className="font-semibold">{rec.stage}</span>
                    </p>
                    <FixRecommendation
                      metric={rec.metric}
                      value={rec.value}
                      status={severityToStatus(rec.severity)}
                      platform={rec.platform}
                      auditContext={{
                        module: "Funnel Audit",
                        siblingMetrics: rec.siblingMetrics,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
