import { KpiCard, AuditCard, StatusBadge } from "./AuditCard";
import type { AuditProps } from "./types";

// Heuristic: infer ABO (Ad-set Budget Optimisation) vs CBO (Campaign Budget Optimisation)
// from campaign name keywords until real budget-strategy API data is wired.
function inferStructure(name: string): "ABO" | "CBO" | "Unknown" {
  const lower = name.toLowerCase();
  if (lower.includes("cbo")) return "CBO";
  if (lower.includes("abo")) return "ABO";
  return "Unknown";
}

export default function AboCboAudit({ campaigns }: AuditProps) {
  const counts = { ABO: 0, CBO: 0, Unknown: 0 };
  for (const c of campaigns) counts[inferStructure(c.name)]++;
  const total = campaigns.length;
  const known = counts.ABO + counts.CBO;
  const structureScore = total === 0 ? 0 : Math.round((known / total) * 100);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label="Structure Score"
          value={`${structureScore}%`}
          subLabel="Campaigns with explicit ABO/CBO labelling"
          tone={structureScore >= 70 ? "good" : structureScore >= 40 ? "warn" : "bad"}
        />
        <KpiCard label="ABO Campaigns" value={counts.ABO} subLabel="Ad-set budget optimisation" />
        <KpiCard label="CBO Campaigns" value={counts.CBO} subLabel="Campaign budget optimisation" />
      </div>

      <AuditCard
        title="ABO vs CBO"
        description="Correct structure usage by budget optimisation strategy"
        badge={{ text: structureScore >= 70 ? "Healthy" : "Review", color: structureScore >= 70 ? "green" : "yellow" }}
      >
        <div className="grid grid-cols-3 gap-3">
          {(["ABO", "CBO", "Unknown"] as const).map((s) => (
            <div key={s} className="border border-gray-200 rounded-lg p-4">
              <div className="text-xs font-semibold text-gray-500 uppercase">{s}</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{counts[s]}</div>
              <div className="mt-2">
                <StatusBadge
                  status={s === "Unknown" ? "warn" : "info"}
                  label={s === "Unknown" ? "Unlabelled" : "Configured"}
                />
              </div>
            </div>
          ))}
        </div>
      </AuditCard>
    </div>
  );
}
