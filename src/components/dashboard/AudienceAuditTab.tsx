import { Users } from "lucide-react";
import AuditTabShell from "./audits/AuditTabShell";
import AudienceOverlapAudit from "./audits/AudienceOverlapAudit";
import IntentAnalysisAudit from "./audits/IntentAnalysisAudit";
import AudienceSaturationAudit from "./audits/AudienceSaturationAudit";
import AudienceQualityAudit from "./audits/AudienceQualityAudit";
import WastedSpendAudit from "./audits/WastedSpendAudit";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: string;
  customStart?: string;
  customEnd?: string;
  selectedObjectives: Set<string>;
  setActiveTab: (id: string) => void;
}

export default function AudienceAuditTab({ platform, selectedObjectives }: Props) {
  return (
    <AuditTabShell
      platform={platform}
      selectedObjectives={selectedObjectives}
      title="Audience Audit"
      description="Audience overlap, intent, saturation, quality, and wasted spend"
      Icon={Users}
      defaultSubTab="overlap"
      subTabs={[
        { id: "overlap", label: "Audience Overlap", description: "Ad set overlap %", render: (p) => <AudienceOverlapAudit {...p} /> },
        { id: "intent", label: "Intent Analysis", description: "Cold/Warm/Hot mix", render: (p) => <IntentAnalysisAudit {...p} /> },
        { id: "saturation", label: "Audience Saturation", description: "Frequency & fatigue", render: (p) => <AudienceSaturationAudit {...p} /> },
        { id: "quality", label: "Audience Quality", description: "High-intent share", render: (p) => <AudienceQualityAudit {...p} /> },
        { id: "wasted", label: "Wasted Spend", description: "Low-intent allocation", render: (p) => <WastedSpendAudit {...p} /> },
      ]}
    />
  );
}
