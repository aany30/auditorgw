import { KpiCard, AuditCard, StatusBadge } from "./AuditCard";
import { TermText } from "@/components/shared/Term";
import { buildAccountContext, type AuditProps } from "./types";

// Placeholder overlap calculation: derive from campaign count concentration.
// Real implementation calls Meta's audience overlap API.
function computeOverlap(n: number): number {
  if (n <= 1) return 0;
  if (n <= 3) return 12;
  if (n <= 6) return 28;
  if (n <= 10) return 42;
  return 58;
}

export default function AudienceOverlapAudit({ campaigns }: AuditProps) {
  const overlap = computeOverlap(campaigns.length);
  const dup = Math.round(campaigns.length * 0.15);
  const cpmInflation = overlap > 30 ? "High" : overlap > 15 ? "Medium" : "Low";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label="Overlap %"
          value={`${overlap}%`}
          subLabel="Across ad sets"
          tone={overlap < 15 ? "good" : overlap < 30 ? "warn" : "bad"}
          fixContext={{
            metric: "audience_overlap_high",
            platform: "meta",
            accountContext: buildAccountContext(campaigns),
            auditContext: {
              module: "Audience Overlap",
              siblingMetrics: { "Overlap %": `${overlap}%`, "Duplicate Ad Sets": dup, "CPM Inflation Risk": cpmInflation },
            },
          }}
        />
        <KpiCard label="Duplicate Ad Sets" value={dup} subLabel="Estimated audience duplication" tone={dup > 0 ? "warn" : "good"} />
        <KpiCard
          label="CPM Inflation Risk"
          value={cpmInflation}
          subLabel="Auction self-competition"
          tone={cpmInflation === "Low" ? "good" : cpmInflation === "Medium" ? "warn" : "bad"}
          fixContext={{
            metric: "audience_overlap_high",
            platform: "meta",
            accountContext: buildAccountContext(campaigns),
            auditContext: {
              module: "Audience Overlap",
              siblingMetrics: { "Overlap %": `${overlap}%`, "CPM Inflation Risk": cpmInflation },
            },
          }}
        />
      </div>

      <AuditCard title="Audience Overlap" description="Ad set overlap analysis" badge={{ text: `${overlap}% overlap`, color: overlap < 15 ? "green" : overlap < 30 ? "yellow" : "red" }}>
        <p className="text-sm text-gray-700">
          <TermText>{`High audience overlap means your campaigns bid against each other, inflating CPM and degrading ROAS. Aim for <15% overlap between ad sets within the same campaign objective.`}</TermText>
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { label: "Acceptable (<15%)", status: "pass" as const },
            { label: "Caution (15-30%)", status: "warn" as const },
            { label: "Critical (>30%)", status: "fail" as const },
          ].map((t) => (
            <div key={t.label} className="border border-gray-200 rounded-lg p-3 flex items-center justify-between">
              <span className="text-xs text-gray-700">{t.label}</span>
              <StatusBadge status={t.status} label={t.status === "pass" ? "OK" : t.status === "warn" ? "Warn" : "Bad"} />
            </div>
          ))}
        </div>
      </AuditCard>
    </div>
  );
}
