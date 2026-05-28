import { KpiCard, AuditCard, StatusBadge } from "./AuditCard";
import { TermText } from "@/components/shared/Term";
import FunnelStagePerformance from "./FunnelStagePerformance";
import type { AuditProps } from "./types";

// Heuristic: bucket campaigns into TOF / MOF / BOF based on objective keywords
function bucket(objective?: string): "TOF" | "MOF" | "BOF" | "Unknown" {
  if (!objective) return "Unknown";
  const o = objective.toLowerCase();
  if (o.includes("aware") || o.includes("reach") || o.includes("video")) return "TOF";
  if (o.includes("engagement") || o.includes("traffic") || o.includes("consideration")) return "MOF";
  if (o.includes("conversion") || o.includes("sales") || o.includes("lead") || o.includes("catalog")) return "BOF";
  return "Unknown";
}

export default function FunnelSeparationAudit({ campaigns, accountTotal }: AuditProps) {
  const counts = { TOF: 0, MOF: 0, BOF: 0, Unknown: 0 };
  for (const c of campaigns) counts[bucket(c.objective)]++;

  // Denominator is the overall ad-account campaign count, not the filtered
  // subset — so each stage reads as "N of <all account campaigns>".
  const total = accountTotal ?? campaigns.length;
  const present = Number(counts.TOF > 0) + Number(counts.MOF > 0) + Number(counts.BOF > 0);
  const segScore = total === 0 ? 0 : Math.round((present / 3) * 100);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label="Segmentation Score"
          value={`${segScore}%`}
          subLabel="3 funnel stages represented"
          tone={segScore >= 66 ? "good" : segScore >= 33 ? "warn" : "bad"}
        />
        <KpiCard label="TOF / MOF / BOF" value={`${counts.TOF} / ${counts.MOF} / ${counts.BOF}`} subLabel="Campaign counts" />
        <KpiCard label="Unclassified" value={counts.Unknown} subLabel="Missing or unclear objective" tone={counts.Unknown > 0 ? "warn" : "good"} />
      </div>

      <AuditCard
        title="Funnel Separation"
        description={`TOF/MOF/BOF segmentation across ${total} total campaign${total === 1 ? "" : "s"}`}
        badge={{ text: `Score ${segScore}`, color: segScore >= 66 ? "green" : segScore >= 33 ? "yellow" : "red" }}
      >
        {/* How we classify campaigns into funnel stages */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-gray-700 leading-relaxed">
          <div className="font-semibold text-blue-900 mb-1">How campaigns are bucketed</div>
          <TermText>
            Stages are defined by the bid-type the platform uses to charge you, which mirrors how
            far down the customer journey the user is:
          </TermText>
          <ul className="mt-1.5 space-y-0.5">
            <li>
              <span className="font-semibold text-gray-900">TOF</span> (Top of Funnel) ·{" "}
              <TermText>Awareness, Reach, Video Views — billed by CPM or CPV / CPCV.</TermText>
            </li>
            <li>
              <span className="font-semibold text-gray-900">MOF</span> (Middle of Funnel) ·{" "}
              <TermText>Engagement, Traffic, Consideration — billed by CPC or CPE.</TermText>
            </li>
            <li>
              <span className="font-semibold text-gray-900">BOF</span> (Bottom of Funnel) ·{" "}
              <TermText>Sales, Conversions, Lead Generation, Catalog Sales — billed by CPL, CPS, or CPA.</TermText>
            </li>
          </ul>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(["TOF", "MOF", "BOF"] as const).map((stage) => {
            const count = counts[stage];
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            const stageLabel = stage === "TOF" ? "Top of Funnel" : stage === "MOF" ? "Middle of Funnel" : "Bottom of Funnel";
            return (
              <div key={stage} className="border border-gray-200 rounded-lg p-4">
                <div className="text-xs font-semibold text-gray-500 uppercase">{stage}</div>
                <div className="text-[10px] text-gray-400 -mt-0.5">{stageLabel}</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">{count}</div>
                <div className="text-xs text-gray-600 mt-0.5">
                  {count} of {total} <span className="text-gray-400">({pct}%)</span>
                </div>
                {/* progress bar — visual share of the total */}
                <div className="w-full h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full ${count > 0 ? "bg-blue-500" : "bg-gray-200"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-2">
                  <StatusBadge status={count > 0 ? "pass" : "fail"} label={count > 0 ? "Present" : "Missing"} />
                </div>
              </div>
            );
          })}
          {/* Unclassified — surface so the user sees what % of campaigns we couldn't bucket */}
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="text-xs font-semibold text-gray-500 uppercase">Unclassified</div>
            <div className="text-[10px] text-gray-400 -mt-0.5">Missing / unclear objective</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{counts.Unknown}</div>
            <div className="text-xs text-gray-600 mt-0.5">
              {counts.Unknown} of {total}{" "}
              <span className="text-gray-400">
                ({total > 0 ? Math.round((counts.Unknown / total) * 100) : 0}%)
              </span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
              <div
                className={`h-full ${counts.Unknown > 0 ? "bg-yellow-500" : "bg-gray-200"}`}
                style={{
                  width: `${total > 0 ? Math.round((counts.Unknown / total) * 100) : 0}%`,
                }}
              />
            </div>
            <div className="mt-2">
              <StatusBadge
                status={counts.Unknown === 0 ? "pass" : "warn"}
                label={counts.Unknown === 0 ? "Clean" : "Review"}
              />
            </div>
          </div>
        </div>

        {/* Single-line summary at the bottom — total breakdown */}
        <div className="mt-4 pt-3 border-t border-gray-100 text-sm text-gray-700">
          <span className="font-semibold">Breakdown:</span>{" "}
          <span className="font-mono">{counts.TOF}</span> TOF
          {" · "}
          <span className="font-mono">{counts.MOF}</span> MOF
          {" · "}
          <span className="font-mono">{counts.BOF}</span> BOF
          {counts.Unknown > 0 && (
            <>
              {" · "}
              <span className="font-mono">{counts.Unknown}</span> Unclassified
            </>
          )}
          {" "}
          <span className="text-gray-500">out of {total} total campaigns</span>
        </div>
      </AuditCard>

      {/* TOF/MOF/BOF distribution + dual-axis performance chart */}
      <FunnelStagePerformance campaigns={campaigns} accountTotal={total} />
    </div>
  );
}
