import { useAuthStore } from "@/store/auth";
import ConnectCta from "@/components/shared/ConnectCta";
import { TermText } from "@/components/shared/Term";

export default function AttributionTab() {
  const { isMetaConnected, isGoogleConnected } = useAuthStore();
  const metaOn = isMetaConnected();
  const googleOn = isGoogleConnected();

  const metaChecks = [
    { check: "Aggregated Event Measurement", status: "Pass", value: "Configured", note: "All events prioritized" },
    { check: "Domain Verification", status: "Pass", value: "Verified", note: "DNS verified" },
    { check: "Priority Event Configuration", status: "Warn", value: "Partial", note: "2 of 8 events unprioritized" },
    { check: "Attribution Settings", status: "Pass", value: "7-day click, 1-day view", note: "Standard" },
    { check: "Consent Mode (GDPR)", status: "Fail", value: "Not Configured", note: "Required for EU traffic" },
    { check: "iOS Tracking (SKAdNetwork)", status: "Warn", value: "Limited", note: "ATT prompt not optimized" },
  ];

  const googleChecks = [
    { check: "Enhanced Conversions", status: "Pass", value: "Active", note: "Email + Phone hashed" },
    { check: "Consent Mode v2", status: "Warn", value: "Partial", note: "ad_user_data missing" },
    { check: "Attribution Model", status: "Pass", value: "Data-Driven", note: "Recommended" },
    { check: "Conversion Lookback", status: "Pass", value: "30 days", note: "Aligned with sales cycle" },
    { check: "Cross-Domain Tracking", status: "Pass", value: "Configured", note: "linker active" },
    { check: "Referral Exclusions", status: "Warn", value: "Incomplete", note: "Payment gateways missing" },
  ];

  const beforeAfter = [
    { metric: "Match Rate", before: "65%", after: "82%", lift: "+17pp" },
    { metric: "Reported Conversions", before: "8,500", after: "10,200", lift: "+20%" },
    { metric: "Attribution Window Coverage", before: "70%", after: "92%", lift: "+22pp" },
    { metric: "iOS Conversions", before: "1,200", after: "1,800", lift: "+50%" },
    { metric: "EU GDPR Compliance", before: "Partial", after: "Full", lift: "✓" },
  ];

  const statusColor = (s: string) =>
    s === "Pass" ? "text-green-700 bg-green-100" : s === "Warn" ? "text-yellow-700 bg-yellow-100" : "text-red-700 bg-red-100";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Attribution Readiness</h1>
        <p className="text-gray-600 mt-1">Setup checks for accurate attribution and signal preservation</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Attribution Score</div>
          <div className="text-3xl font-bold text-yellow-600 mt-1">81</div>
          <div className="text-xs text-gray-500 mt-1">Moderate readiness</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Checks Passed</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">8/12</div>
          <div className="text-xs text-yellow-600 mt-1">3 warnings, 1 failure</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Est. Lift After Fixes</div>
          <div className="text-3xl font-bold text-green-600 mt-1">+20%</div>
          <div className="text-xs text-gray-500 mt-1">Reported conversions</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {metaOn ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Meta Attribution Checks</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Check</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Value</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {metaChecks.map((c, idx) => (
                    <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{c.check}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{c.note}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{c.value}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(c.status)}`}>{c.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <ConnectCta platform="Meta" context="to see Meta attribution checks" />
        )}

        {googleOn ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Google Attribution Checks</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Check</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Value</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody>
                {googleChecks.map((c, idx) => (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900"><TermText>{c.check}</TermText></div>
                      <div className="text-xs text-gray-500 mt-0.5"><TermText>{c.note}</TermText></div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{c.value}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(c.status)}`}>{c.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        ) : (
          <ConnectCta platform="Google" context="to see Google attribution checks" />
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Projected Improvements — Before vs After Fixes</h2>
          <p className="text-sm text-gray-600 mt-1">Estimated impact if all warnings and failures are resolved</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Metric</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Before</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">After</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Lift</th>
              </tr>
            </thead>
            <tbody>
              {beforeAfter.map((b, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4 font-semibold text-gray-900"><TermText>{b.metric}</TermText></td>
                  <td className="px-6 py-4 text-right text-gray-700">{b.before}</td>
                  <td className="px-6 py-4 text-right text-gray-900 font-semibold">{b.after}</td>
                  <td className="px-6 py-4 text-right text-green-600 font-bold">{b.lift}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
