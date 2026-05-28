import { KpiCard, AuditCard } from "./AuditCard";
import { TermText } from "@/components/shared/Term";
import { buildAccountContext, type AuditProps } from "./types";

export default function AudienceSaturationAudit({ campaigns }: AuditProps) {
  // Synthetic frequency/fatigue model until real impression-frequency data is wired
  const fakeFreq = Math.min(6, 1.4 + campaigns.length * 0.1);
  const fatigueScore = Math.max(0, Math.min(100, Math.round(100 - (fakeFreq - 1.5) * 25)));
  const status = fatigueScore >= 70 ? "Healthy" : fatigueScore >= 40 ? "Watch" : "Fatigued";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label="Fatigue Score"
          value={`${fatigueScore}/100`}
          subLabel="Higher = fresher audience"
          tone={fatigueScore >= 70 ? "good" : fatigueScore >= 40 ? "warn" : "bad"}
          fixContext={{
            metric: "audience_fatigue",
            platform: "meta",
            accountContext: buildAccountContext(campaigns),
            auditContext: {
              module: "Audience Saturation",
              siblingMetrics: { "Fatigue Score": `${fatigueScore}/100`, "Avg Frequency": fakeFreq.toFixed(1), "Status": status },
            },
          }}
        />
        <KpiCard
          label="Avg Frequency"
          value={fakeFreq.toFixed(1)}
          subLabel="Impressions per user / 7d"
          tone={fakeFreq < 3 ? "good" : fakeFreq < 4.5 ? "warn" : "bad"}
          fixContext={{
            metric: "audience_fatigue",
            platform: "meta",
            accountContext: buildAccountContext(campaigns),
            auditContext: {
              module: "Audience Saturation",
              siblingMetrics: { "Avg Frequency": fakeFreq.toFixed(1), "Fatigue Score": `${fatigueScore}/100` },
            },
          }}
        />
        <KpiCard
          label="Status"
          value={status}
          subLabel="Audience saturation"
          tone={status === "Healthy" ? "good" : status === "Watch" ? "warn" : "bad"}
          fixContext={{
            metric: "audience_fatigue",
            platform: "meta",
            accountContext: buildAccountContext(campaigns),
            auditContext: {
              module: "Audience Saturation",
              siblingMetrics: { "Status": status, "Fatigue Score": `${fatigueScore}/100`, "Avg Frequency": fakeFreq.toFixed(1) },
            },
          }}
        />
      </div>

      <AuditCard title="Audience Saturation" description="Frequency and fatigue analysis">
        <p className="text-sm text-gray-700">
          <TermText>{`Frequency above 3.0 typically signals creative fatigue. Refresh creatives or expand the audience when fatigue score drops below 40.`}</TermText>
        </p>
      </AuditCard>
    </div>
  );
}
