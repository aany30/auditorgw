import { KpiCard, AuditCard, StatusBadge } from "./AuditCard";
import type { AuditProps } from "./types";

function intentForObjective(objective?: string): "Cold" | "Warm" | "Hot" {
  if (!objective) return "Cold";
  const o = objective.toLowerCase();
  if (o.includes("aware") || o.includes("reach") || o.includes("video")) return "Cold";
  if (o.includes("traffic") || o.includes("engagement") || o.includes("consideration")) return "Warm";
  return "Hot";
}

export default function IntentAnalysisAudit({ campaigns }: AuditProps) {
  const counts = { Cold: 0, Warm: 0, Hot: 0 };
  for (const c of campaigns) counts[intentForObjective(c.objective)]++;
  const total = campaigns.length;
  // Intent score: weighted average toward higher intent
  const score = total === 0 ? 0 : Math.round(((counts.Cold * 1 + counts.Warm * 2 + counts.Hot * 3) / (total * 3)) * 100);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="Intent Score" value={`${score}/100`} subLabel="Weighted toward high-intent" tone={score >= 60 ? "good" : score >= 35 ? "warn" : "bad"} />
        <KpiCard label="Cold / Warm / Hot" value={`${counts.Cold} / ${counts.Warm} / ${counts.Hot}`} subLabel="Audience temperature mix" />
        <KpiCard label="Coverage" value={`${Number(counts.Cold > 0) + Number(counts.Warm > 0) + Number(counts.Hot > 0)}/3`} subLabel="Funnel stages covered" />
      </div>

      <AuditCard title="Intent Analysis" description="Cold/Warm/Hot audience analysis and intent scoring">
        <div className="grid grid-cols-3 gap-3">
          {(["Cold", "Warm", "Hot"] as const).map((bucket) => (
            <div key={bucket} className="border border-gray-200 rounded-lg p-4">
              <div className="text-xs font-semibold text-gray-500 uppercase">{bucket}</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{counts[bucket]}</div>
              <div className="mt-2">
                <StatusBadge status={counts[bucket] > 0 ? "info" : "warn"} label={counts[bucket] > 0 ? "Active" : "Missing"} />
              </div>
            </div>
          ))}
        </div>
      </AuditCard>
    </div>
  );
}
