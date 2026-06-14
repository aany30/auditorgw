/**
 * Campaign → Demographics (doc §9, §10, §11)
 *
 * §9  Age Analysis  — breakdown=age from Meta Insights API
 * §10 Gender        — breakdown=gender
 * §11 Geo           — breakdown=country
 *
 * Reuses the existing /api/reporting/breakdown/meta endpoint (same one used
 * by Reporting → Breakdowns). Each sub-tab fetches its own breakdown.
 */

import { useEffect, useState } from "react";
import { Globe, AlertCircle } from "lucide-react";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import { useAuthStore } from "@/store/auth";
import { formatMoney } from "@/lib/currency";
import { rangeToDates } from "@/lib/date-range";
import type { DateRange } from "@/components/shared/DateRangePicker";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  selectedObjectives?: Set<string>;
  setActiveTab?: (id: string) => void;
}

const SUB_TABS = [
  { id: "age",    label: "Age Analysis",  desc: "Spend, revenue, orders, ROAS by age group (§9)" },
  { id: "gender", label: "Gender",         desc: "Performance split by gender (§10)" },
  { id: "geo",    label: "Geo",            desc: "Country-level spend and ROAS (§11)" },
];

interface BreakdownRow {
  label: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

function useBreakdown(breakdown: string, platform: string, dateRange: DateRange, customStart?: string, customEnd?: string) {
  const { metaAccessToken, metaBusinessId, demoMode } = useAuthStore();
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("INR");

  const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);

  useEffect(() => {
    if (platform === "google") { setRows([]); return; }
    const effectiveToken = demoMode ? "demo-meta-token" : metaAccessToken;
    const effectiveBiz = demoMode ? "demo-business-123" : metaBusinessId;
    if (!effectiveToken || !effectiveBiz) { setRows([]); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/reporting/breakdown/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: effectiveToken, businessId: effectiveBiz, breakdown, startDate, endDate }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) { setError(data.error); return; }
        setRows(data.rows || []);
        if (data.currency) setCurrency(data.currency);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdown, platform, startDate, endDate, metaAccessToken, metaBusinessId, demoMode]);

  return { rows, loading, error, currency };
}

// ─── Shared table ───────────────────────────────────────────────────────────

function DemoTable({
  rows, loading, error, currency, labelHeader, showAov,
}: {
  rows: BreakdownRow[];
  loading: boolean;
  error: string | null;
  currency: string;
  labelHeader: string;
  showAov?: boolean;
}) {
  const cur = (n: number) => formatMoney(n, currency, 0);
  const sorted = [...rows].sort((a, b) => b.spend - a.spend);

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 flex items-center gap-2">
      <AlertCircle className="w-4 h-4 shrink-0" /> {error}
    </div>
  );
  if (!rows.length) return (
    <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-500">
      No breakdown data. Connect a Meta account or widen the date range.
    </div>
  );

  return (
    <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
          <tr>
            <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase">{labelHeader}</th>
            <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Spend</th>
            <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Revenue</th>
            <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">Orders</th>
            <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">ROAS</th>
            <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">CPA</th>
            {showAov && <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase">AOV</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const roas = r.spend > 0 ? r.conversionValue / r.spend : 0;
            const cpa = r.conversions > 0 ? r.spend / r.conversions : 0;
            const aov = r.conversions > 0 ? r.conversionValue / r.conversions : 0;
            return (
              <tr key={r.label} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5 text-gray-900 font-medium">{r.label}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{cur(r.spend)}</td>
                <td className="px-4 py-2.5 text-right text-gray-700">{cur(r.conversionValue)}</td>
                <td className="px-4 py-2.5 text-right text-gray-700">{Math.round(r.conversions).toLocaleString("en-IN")}</td>
                <td className="px-4 py-2.5 text-right text-gray-700">{roas > 0 ? `${roas.toFixed(2)}×` : "—"}</td>
                <td className="px-4 py-2.5 text-right text-gray-700">{cpa > 0 ? cur(cpa) : "—"}</td>
                {showAov && <td className="px-4 py-2.5 text-right text-gray-700">{aov > 0 ? cur(aov) : "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Sub-tabs ───────────────────────────────────────────────────────────────

function AgeAnalysis({ platform, dateRange, customStart, customEnd }: Props) {
  const { rows, loading, error, currency } = useBreakdown("age", platform, dateRange, customStart, customEnd);
  return <DemoTable rows={rows} loading={loading} error={error} currency={currency} labelHeader="Age Group" showAov />;
}

function GenderAnalysis({ platform, dateRange, customStart, customEnd }: Props) {
  const { rows, loading, error, currency } = useBreakdown("gender", platform, dateRange, customStart, customEnd);
  return <DemoTable rows={rows} loading={loading} error={error} currency={currency} labelHeader="Gender" />;
}

function GeoAnalysis({ platform, dateRange, customStart, customEnd }: Props) {
  const { rows, loading, error, currency } = useBreakdown("country", platform, dateRange, customStart, customEnd);
  return <DemoTable rows={rows} loading={loading} error={error} currency={currency} labelHeader="Country" showAov />;
}

// ─── Main tab ───────────────────────────────────────────────────────────────

export default function DemographicsTab(props: Props) {
  const [active, setActive] = useState("age");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Globe className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Demographics</h1>
            <p className="text-gray-600 mt-1">Age, Gender, and Geo performance — pulled from Meta Insights API breakdowns.</p>
          </div>
        </div>
        <AIExecutiveSummary
          tabName="Demographics"
          context={{ activeBreakdown: active, platform: props.platform, dateRange: String(props.dateRange) }}
          platform={props.platform === "both" ? "meta" : props.platform}
          dateRange={String(props.dateRange)}
          inline
        />
      </div>

      {props.platform === "google" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          Showing Meta breakdown data. Google Ads demographic segments (age_range_view, gender_view, geographic_view) are coming in v1.1.
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {SUB_TABS.map((t) => (
          <button key={t.id} onClick={() => setActive(t.id)}
            className={`px-4 py-3 font-semibold border-b-2 transition whitespace-nowrap ${active === t.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900"}`}>
            <div>{t.label}</div>
            <div className="text-xs text-gray-500 font-normal">{t.desc}</div>
          </button>
        ))}
      </div>

      {active === "age"    && <AgeAnalysis    {...props} />}
      {active === "gender" && <GenderAnalysis {...props} />}
      {active === "geo"    && <GeoAnalysis    {...props} />}

    </div>
  );
}
