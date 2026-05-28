import { KpiCard, AuditCard } from "./AuditCard";
import { TermText } from "@/components/shared/Term";
import type { AuditProps } from "./types";

export default function AudienceQualityAudit({ campaigns }: AuditProps) {
  const highIntentMix = campaigns.filter((c) => {
    const o = c.objective?.toLowerCase() || "";
    return o.includes("conversion") || o.includes("sales") || o.includes("lead");
  }).length;
  const total = campaigns.length;
  const qualityScore = total === 0 ? 0 : Math.round((highIntentMix / total) * 100);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="Audience Quality Score" value={`${qualityScore}%`} subLabel="Share of high-intent campaigns" tone={qualityScore >= 50 ? "good" : qualityScore >= 25 ? "warn" : "bad"} />
        <KpiCard label="High-intent campaigns" value={highIntentMix} subLabel="Lead / Sales / Conversion objectives" />
        <KpiCard label="Total Campaigns" value={total} />
      </div>

      <AuditCard title="Audience Quality" description="High-intent users vs broad reach">
        <p className="text-sm text-gray-700">
          <TermText>{`High-intent campaigns (Conversions, Sales, Leads) consistently deliver better ROAS than broad-reach campaigns. Aim for at least 50% of spend to flow to high-intent objectives once you have enough conversion volume.`}</TermText>
        </p>
      </AuditCard>
    </div>
  );
}
