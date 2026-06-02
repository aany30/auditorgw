import { Users } from "lucide-react";
import AuditTabShell from "./audits/AuditTabShell";
import IntentAnalysisAudit from "./audits/IntentAnalysisAudit";
import AudienceQualityAudit from "./audits/AudienceQualityAudit";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: string;
  customStart?: string;
  customEnd?: string;
  selectedObjectives: Set<string>;
  setActiveTab: (id: string) => void;
}

export default function AudienceAuditTab({ platform, dateRange, customStart, customEnd, selectedObjectives }: Props) {
  return (
    <AuditTabShell
      platform={platform}
      dateRange={dateRange}
      customStart={customStart}
      customEnd={customEnd}
      selectedObjectives={selectedObjectives}
      title="Audience Audit"
      description="Intent classification + audience quality from real campaign data"
      Icon={Users}
      defaultSubTab="intent"
      subTabs={[
        { id: "intent", label: "Intent Analysis", description: "Cold/Warm/Hot mix", render: (p) => <IntentAnalysisAudit {...p} /> },
        { id: "quality", label: "Audience Quality", description: "High-intent share", render: (p) => <AudienceQualityAudit {...p} /> },
      ]}
    />
  );
}
