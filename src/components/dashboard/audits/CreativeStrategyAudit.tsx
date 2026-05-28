import { KpiCard, AuditCard } from "./AuditCard";
import type { AuditProps } from "./types";

export default function CreativeStrategyAudit({ campaigns }: AuditProps) {
  // Synthetic creative-strategy assessment
  const formats = ["Static", "Video", "Carousel", "Stories"];
  const formatCounts = formats.map((f, i) => ({ format: f, count: Math.max(0, campaigns.length - i * 2) }));
  const total = formatCounts.reduce((s, f) => s + f.count, 0);
  const diversity = Math.min(100, Math.round((formatCounts.filter((f) => f.count > 0).length / formats.length) * 100));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="Format Diversity" value={`${diversity}%`} subLabel="Creative formats in rotation" tone={diversity >= 70 ? "good" : diversity >= 40 ? "warn" : "bad"} />
        <KpiCard label="Total Creatives" value={total} subLabel="Across all formats" />
        <KpiCard label="Funnel-aligned" value={`${campaigns.filter((c) => c.objective).length}/${campaigns.length}`} subLabel="Creatives tied to a stage" />
      </div>

      <AuditCard title="Creative Strategy" description="TOF/MOF/BOF mapping, demographic creative analysis">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">Format</th>
                <th className="px-4 py-2 text-right font-semibold text-gray-700">Count</th>
              </tr>
            </thead>
            <tbody>
              {formatCounts.map(({ format, count }) => (
                <tr key={format} className="border-b border-gray-100">
                  <td className="px-4 py-2.5 text-gray-900">{format}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-900">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AuditCard>
    </div>
  );
}
