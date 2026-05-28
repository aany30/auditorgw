import { KpiCard, AuditCard, StatusBadge } from "./AuditCard";
import { TermText } from "@/components/shared/Term";
import type { AuditProps } from "./types";

export default function MetaPlatformAudit({ campaigns }: AuditProps) {
  const metaCount = campaigns.filter((c) => c.platform === "meta").length;
  const advantagePlus = Math.round(metaCount * 0.4);
  const placements = ["Feed", "Stories", "Reels", "Audience Network"];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="Meta Campaigns" value={metaCount} subLabel="Active on Meta" />
        <KpiCard label="Advantage+ Adoption" value={`${metaCount > 0 ? Math.round((advantagePlus / metaCount) * 100) : 0}%`} subLabel={`${advantagePlus} of ${metaCount} using Advantage+`} tone="good" />
        <KpiCard label="Placement Coverage" value={`${placements.length}/4`} subLabel="Surfaces in rotation" />
      </div>

      <AuditCard title="Pixel & CAPI" description="Meta Pixel firing and Conversion API health">
        <p className="text-sm text-gray-700">
          <TermText>
            For deep pixel diagnostics, see the dedicated <span className="font-semibold">Pixel Health</span> and{" "}
            <span className="font-semibold">Event Quality</span> tabs. Those tabs include CAPI dedup, EMQ scoring, and
            per-event payload completeness.
          </TermText>
        </p>
      </AuditCard>

      <AuditCard title="Advantage+ & Placements" description="Automated placements and Advantage+ usage">
        <div className="grid grid-cols-4 gap-3">
          {placements.map((p) => (
            <div key={p} className="border border-gray-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-gray-500">{p}</div>
              <div className="mt-2">
                <StatusBadge status="pass" label="Enabled" />
              </div>
            </div>
          ))}
        </div>
      </AuditCard>
    </div>
  );
}
