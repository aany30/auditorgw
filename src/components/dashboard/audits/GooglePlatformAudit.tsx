import { KpiCard, AuditCard, StatusBadge } from "./AuditCard";
import { TermText } from "@/components/shared/Term";
import type { AuditProps } from "./types";

export default function GooglePlatformAudit({ campaigns }: AuditProps) {
  const googleCount = campaigns.filter((c) => c.platform === "google").length;
  // Synthetic numbers — wire real Search Term / PMax / RSA APIs in follow-up
  const impressionShare = googleCount > 0 ? 64 : 0;
  const pmaxAssetCoverage = googleCount > 0 ? 78 : 0;
  const rsaStrength = googleCount > 0 ? "Good" : "—";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="Google Campaigns" value={googleCount} subLabel="Active on Google" />
        <KpiCard label="Impression Share" value={`${impressionShare}%`} subLabel="Search auction visibility" tone={impressionShare >= 60 ? "good" : impressionShare >= 35 ? "warn" : "bad"} />
        <KpiCard label="PMax Asset Coverage" value={`${pmaxAssetCoverage}%`} subLabel="Filled asset groups" tone={pmaxAssetCoverage >= 70 ? "good" : "warn"} />
      </div>

      <AuditCard title="Search Term Quality" description="Wasteful query mapping and negative keyword hygiene">
        <div className="grid grid-cols-3 gap-3">
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase">High-intent</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">62%</div>
            <StatusBadge status="pass" label="OK" />
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase">Brand</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">23%</div>
            <StatusBadge status="info" label="Tracked" />
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase">Wasted</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">15%</div>
            <StatusBadge status="warn" label="Add negatives" />
          </div>
        </div>
      </AuditCard>

      <AuditCard title="RSA & PMax" description="Responsive Search Ad strength and Performance Max coverage">
        <div className="text-sm text-gray-700">
          <TermText>
            RSA Strength: <span className="font-semibold">{rsaStrength}</span> · PMax asset groups have{" "}
            <span className="font-semibold">{pmaxAssetCoverage}%</span> of recommended assets filled.
          </TermText>
        </div>
      </AuditCard>
    </div>
  );
}
