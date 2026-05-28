import { KpiCard, AuditCard, StatusBadge } from "./AuditCard";
import { buildAccountContext, type AuditProps } from "./types";

// Placeholder: bucket campaigns by status + objective. Real implementation would
// call Meta/Google API endpoints that return learning phase data per ad set.
function fakeLearning(status: string, idx: number): "Active" | "Limited" | "Out" {
  const s = status?.toUpperCase();
  if (s !== "ACTIVE" && s !== "ENABLED") return "Out";
  return idx % 4 === 0 ? "Limited" : "Active";
}

export default function LearningPhaseAudit({ campaigns }: AuditProps) {
  const phases = campaigns.map((c, i) => ({ campaign: c, phase: fakeLearning(c.status, i) }));
  const limited = phases.filter((p) => p.phase === "Limited").length;
  const active = phases.filter((p) => p.phase === "Active").length;
  const out = phases.filter((p) => p.phase === "Out").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="Active learning" value={active} subLabel="Optimising normally" tone="good" />
        <KpiCard
          label="Learning Limited"
          value={limited}
          subLabel="Below 50 conversions / 7d"
          tone={limited > 0 ? "warn" : "good"}
          fixContext={{
            metric: "learning_limited",
            platform: "meta",
            accountContext: buildAccountContext(campaigns),
            auditContext: {
              module: "Learning Phase",
              siblingMetrics: { "Active": active, "Learning Limited": limited, "Out of learning": out },
            },
          }}
        />
        <KpiCard label="Out of learning" value={out} subLabel="Paused or completed" />
      </div>

      <AuditCard title="Learning Phase" description="Learning-limited campaigns indicate insufficient conversion volume">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">Campaign</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">Platform</th>
                <th className="px-4 py-2 text-center font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {phases.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                    No campaigns to analyse.
                  </td>
                </tr>
              ) : (
                phases.slice(0, 12).map(({ campaign, phase }) => (
                  <tr key={`${campaign.platform}-${campaign.id}`} className="border-b border-gray-100">
                    <td className="px-4 py-2.5 font-mono text-gray-900 truncate max-w-md">{campaign.name}</td>
                    <td className="px-4 py-2.5 text-gray-700 capitalize">{campaign.platform}</td>
                    <td className="px-4 py-2.5 text-center">
                      <StatusBadge
                        status={phase === "Active" ? "pass" : phase === "Limited" ? "warn" : "info"}
                        label={phase}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AuditCard>
    </div>
  );
}
