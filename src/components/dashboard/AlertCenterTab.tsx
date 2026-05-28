import { AlertCircle, AlertTriangle, Info, CheckCircle2 } from "lucide-react";

export default function AlertCenterTab() {
  const alerts = [
    { time: "2 min ago", severity: "Critical", platform: "Meta", title: "Purchase event drop detected", desc: "Purchase events dropped 38% in the last hour vs. 30-day baseline.", status: "Active" },
    { time: "12 min ago", severity: "High", platform: "Google", title: "GA4 conversion API returning 4xx", desc: "12 enhanced conversion uploads failed authentication.", status: "Active" },
    { time: "1 hour ago", severity: "Medium", platform: "Meta", title: "Match rate below threshold", desc: "Email match rate dropped to 62% (benchmark 70%).", status: "Acknowledged" },
    { time: "3 hours ago", severity: "Low", platform: "Google", title: "GTM container published", desc: "Container GTM-DEMO published v47 by admin@example.com.", status: "Resolved" },
    { time: "5 hours ago", severity: "Critical", platform: "Meta", title: "Pixel firing inconsistency", desc: "Checkout pixel missed 8% of expected events over 30 minutes.", status: "Resolved" },
    { time: "Yesterday", severity: "High", platform: "Meta", title: "Domain verification expiring", desc: "DNS verification will expire in 14 days.", status: "Acknowledged" },
    { time: "2 days ago", severity: "Medium", platform: "Google", title: "Referrer spam detected", desc: "Unusual referrer traffic from 3 unknown domains.", status: "Resolved" },
  ];

  const sevColor = (s: string) =>
    s === "Critical" ? "text-red-700 bg-red-100" :
    s === "High" ? "text-orange-700 bg-orange-100" :
    s === "Medium" ? "text-yellow-700 bg-yellow-100" :
    "text-blue-700 bg-blue-100";

  const statusColor = (s: string) =>
    s === "Active" ? "text-red-700 bg-red-100" :
    s === "Acknowledged" ? "text-yellow-700 bg-yellow-100" :
    "text-green-700 bg-green-100";

  const sevIcon = (s: string) => {
    const cls = "w-3.5 h-3.5";
    if (s === "Critical") return <AlertCircle className={`${cls} text-red-600`} />;
    if (s === "High") return <AlertTriangle className={`${cls} text-orange-600`} />;
    if (s === "Medium") return <AlertTriangle className={`${cls} text-yellow-600`} />;
    return <Info className={`${cls} text-blue-600`} />;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Alert Center</h1>
        <p className="text-gray-600 mt-1">Real-time tracking issues and anomalies</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Active Alerts</div>
          <div className="text-3xl font-bold text-red-600 mt-1">{alerts.filter(a => a.status === "Active").length}</div>
          <div className="text-xs text-gray-500 mt-1">Needs immediate action</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Acknowledged</div>
          <div className="text-3xl font-bold text-yellow-600 mt-1">{alerts.filter(a => a.status === "Acknowledged").length}</div>
          <div className="text-xs text-gray-500 mt-1">Being investigated</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Resolved (24h)</div>
          <div className="text-3xl font-bold text-green-600 mt-1">{alerts.filter(a => a.status === "Resolved").length}</div>
          <div className="text-xs text-gray-500 mt-1">Auto + manual</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">MTTR</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">2.4h</div>
          <div className="text-xs text-green-600 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> 18% faster vs last week
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Alert Timeline</h2>
            <p className="text-sm text-gray-600 mt-1">Latest alerts across Meta and Google platforms</p>
          </div>
          <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 bg-white">
            <option>All Severities</option>
            <option>Critical</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Severity</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Platform</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Alert</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Time</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 ${sevColor(a.severity)}`}>
                      {sevIcon(a.severity)}
                      {a.severity}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-700 font-medium">{a.platform}</td>
                  <td className="px-6 py-4 max-w-md">
                    <div className="font-semibold text-gray-900">{a.title}</div>
                    <div className="text-xs text-gray-600 mt-1">{a.desc}</div>
                  </td>
                  <td className="px-6 py-4 text-gray-600 text-xs">{a.time}</td>
                  <td className="px-6 py-4 text-right">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(a.status)}`}>{a.status}</span>
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
