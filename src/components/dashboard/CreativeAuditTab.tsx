import { Image as ImageIcon } from "lucide-react";
import AuditTabShell from "./audits/AuditTabShell";
import CreativeFunnelMappingAudit from "./audits/CreativeFunnelMappingAudit";
import DemographicAnalysisAudit from "./audits/DemographicAnalysisAudit";
import CreativeStrategyAudit from "./audits/CreativeStrategyAudit";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: string;
  customStart?: string;
  customEnd?: string;
  selectedObjectives: Set<string>;
  setActiveTab: (id: string) => void;
}

export default function CreativeAuditTab({ platform, selectedObjectives }: Props) {
  return (
    <AuditTabShell
      platform={platform}
      selectedObjectives={selectedObjectives}
      title="Creative Audit"
      description="Creative funnel mapping, demographic analysis, creative strategy"
      Icon={ImageIcon}
      defaultSubTab="funnel-mapping"
      subTabs={[
        { id: "funnel-mapping", label: "Creative Funnel Mapping", description: "TOF/MOF/BOF coverage", render: (p) => <CreativeFunnelMappingAudit {...p} /> },
        { id: "demographic", label: "Demographic Analysis", description: "Age/Gender/Geo", render: (p) => <DemographicAnalysisAudit {...p} /> },
        { id: "strategy", label: "Creative Strategy", description: "Format diversity", render: (p) => <CreativeStrategyAudit {...p} /> },
      ]}
    />
  );
}
