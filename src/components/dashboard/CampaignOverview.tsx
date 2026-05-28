import { Layers, Users, Image as ImageIcon, Globe, Briefcase } from "lucide-react";
import SectionOverview from "./SectionOverview";

interface Props {
  platform: "meta" | "google" | "both";
  setActiveTab: (id: string) => void;
}

export default function CampaignOverview({ setActiveTab }: Props) {
  return (
    <SectionOverview
      title="Campaign"
      description="Account structure, audience, creative, naming and per-platform campaign audits"
      Icon={Briefcase}
      onTileClick={setActiveTab}
      tiles={[
        {
          id: "account-structure",
          label: "Account Structure",
          description: "Naming, funnel separation, budget, learning, ABO vs CBO",
          Icon: Layers,
          tone: "neutral",
        },
        {
          id: "audience-audit",
          label: "Audience Audit",
          description: "Overlap %, intent, saturation, audience quality, wasted spend",
          Icon: Users,
          tone: "neutral",
        },
        {
          id: "creative-audit",
          label: "Creative Audit",
          description: "Creative funnel mapping, demographic analysis, creative strategy",
          Icon: ImageIcon,
          tone: "neutral",
        },
        {
          id: "platform-audit",
          label: "Platform Audit",
          description: "Meta (Pixel, CAPI, Advantage+) and Google (Search, PMax, RSA)",
          Icon: Globe,
          tone: "neutral",
        },
      ]}
    />
  );
}
