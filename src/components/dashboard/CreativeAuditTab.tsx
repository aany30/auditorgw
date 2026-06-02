import { Image as ImageIcon } from "lucide-react";
import AuditTabShell from "./audits/AuditTabShell";
import CreativeFunnelMappingAudit from "./audits/CreativeFunnelMappingAudit";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: string;
  customStart?: string;
  customEnd?: string;
  selectedObjectives: Set<string>;
  setActiveTab: (id: string) => void;
}

export default function CreativeAuditTab({ platform, dateRange, customStart, customEnd, selectedObjectives }: Props) {
  return (
    <AuditTabShell
      platform={platform}
      dateRange={dateRange}
      customStart={customStart}
      customEnd={customEnd}
      selectedObjectives={selectedObjectives}
      title="Creative Audit"
      description="Creative funnel mapping derived from campaign objectives"
      Icon={ImageIcon}
      defaultSubTab="funnel-mapping"
      subTabs={[
        { id: "funnel-mapping", label: "Creative Funnel Mapping", description: "TOF/MOF/BOF coverage", render: (p) => <CreativeFunnelMappingAudit {...p} /> },
      ]}
    />
  );
}
