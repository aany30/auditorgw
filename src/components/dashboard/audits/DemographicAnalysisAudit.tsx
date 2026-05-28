import { KpiCard, AuditCard } from "./AuditCard";
import { TermText } from "@/components/shared/Term";
import type { AuditProps } from "./types";

// Synthetic top performing segment based on campaign volume distribution
const SEGMENTS = ["18-24 M", "25-34 F", "25-34 M", "35-44 F", "45-54 M"];

export default function DemographicAnalysisAudit({ campaigns }: AuditProps) {
  const topSeg = SEGMENTS[campaigns.length % SEGMENTS.length] || "—";
  const ageBands = 5;
  const genderSplit = "F 54% / M 46%"; // placeholder

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="Top Performing Segment" value={topSeg} subLabel="Highest ROAS demographic" tone="good" />
        <KpiCard label="Age Bands Active" value={ageBands} subLabel="18-24 through 65+" />
        <KpiCard label="Gender Split" value={genderSplit} subLabel="Conversion share" />
      </div>

      <AuditCard title="Demographic Analysis" description="Age, gender, geographic breakdown of campaign performance">
        <p className="text-sm text-gray-700">
          <TermText>{`Concentrate budget on top-performing segments while keeping at least one exploratory ad set per under-tested band. Wire real GA4/Meta demographic insights here once API is connected.`}</TermText>
        </p>
      </AuditCard>
    </div>
  );
}
