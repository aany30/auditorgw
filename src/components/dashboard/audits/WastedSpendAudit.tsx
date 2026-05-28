import { KpiCard, AuditCard } from "./AuditCard";
import { TermText } from "@/components/shared/Term";
import { buildAccountContext, type AuditProps } from "./types";

export default function WastedSpendAudit({ campaigns }: AuditProps) {
  // Synthetic: count paused + "Unknown" objective campaigns as proxy for wasted spend
  const paused = campaigns.filter((c) => c.status?.toUpperCase() === "PAUSED").length;
  const unclearObj = campaigns.filter((c) => !c.objective).length;
  const total = campaigns.length;
  const wastedPct = total === 0 ? 0 : Math.round(((paused + unclearObj * 0.5) / total) * 100);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label="Wasted Spend %"
          value={`${wastedPct}%`}
          subLabel="Estimated low-impact spend"
          tone={wastedPct < 10 ? "good" : wastedPct < 25 ? "warn" : "bad"}
          fixContext={{
            metric: "wasted_spend_high",
            accountContext: buildAccountContext(campaigns),
            auditContext: {
              module: "Wasted Spend",
              siblingMetrics: { "Wasted Spend %": `${wastedPct}%`, "Paused Campaigns": paused, "Missing Objective": unclearObj },
            },
          }}
        />
        <KpiCard label="Paused Campaigns" value={paused} subLabel="May still incur learning cost" />
        <KpiCard label="Missing Objective" value={unclearObj} subLabel="Hard to optimise without intent" tone={unclearObj > 0 ? "warn" : "good"} />
      </div>

      <AuditCard title="Wasted Spend" description="Low-intent audience and inefficient allocation">
        <p className="text-sm text-gray-700">
          <TermText>{`Wasted spend includes spend on paused/duplicate campaigns and campaigns with mismatched objectives. Reducing wasted spend by 10% typically frees enough budget to fully fund a new high-intent test campaign.`}</TermText>
        </p>
      </AuditCard>
    </div>
  );
}
