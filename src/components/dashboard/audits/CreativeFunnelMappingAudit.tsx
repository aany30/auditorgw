import { KpiCard, AuditCard, StatusBadge } from "./AuditCard";
import type { AuditProps } from "./types";

function bucket(objective?: string): "TOF" | "MOF" | "BOF" | "Unknown" {
  if (!objective) return "Unknown";
  const o = objective.toLowerCase();
  if (o.includes("aware") || o.includes("reach") || o.includes("video")) return "TOF";
  if (o.includes("engagement") || o.includes("traffic") || o.includes("consideration")) return "MOF";
  if (o.includes("conversion") || o.includes("sales") || o.includes("lead") || o.includes("catalog")) return "BOF";
  return "Unknown";
}

export default function CreativeFunnelMappingAudit({ campaigns }: AuditProps) {
  const counts = { TOF: 0, MOF: 0, BOF: 0, Unknown: 0 };
  for (const c of campaigns) counts[bucket(c.objective)]++;
  const present = Number(counts.TOF > 0) + Number(counts.MOF > 0) + Number(counts.BOF > 0);
  const coverage = Math.round((present / 3) * 100);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="Coverage Score" value={`${coverage}%`} subLabel="TOF/MOF/BOF creative coverage" tone={coverage >= 66 ? "good" : coverage >= 33 ? "warn" : "bad"} />
        <KpiCard label="Stages With Creatives" value={`${present}/3`} subLabel="Funnel stages represented" />
        <KpiCard label="Unmapped" value={counts.Unknown} subLabel="Creatives not yet mapped" tone={counts.Unknown > 0 ? "warn" : "good"} />
      </div>

      <AuditCard title="Creative Funnel Mapping" description="TOF/MOF/BOF creatives mapped against the customer journey">
        <div className="grid grid-cols-3 gap-3">
          {(["TOF", "MOF", "BOF"] as const).map((stage) => (
            <div key={stage} className="border border-gray-200 rounded-lg p-4">
              <div className="text-xs font-semibold text-gray-500 uppercase">{stage}</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{counts[stage]}</div>
              <div className="mt-2">
                <StatusBadge status={counts[stage] > 0 ? "pass" : "fail"} label={counts[stage] > 0 ? "Covered" : "Missing"} />
              </div>
            </div>
          ))}
        </div>
      </AuditCard>
    </div>
  );
}
