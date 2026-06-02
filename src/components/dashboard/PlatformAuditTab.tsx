import type { ReactNode } from "react";
import { Globe } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import AuditTabShell from "./audits/AuditTabShell";
import MetaPlatformAudit from "./audits/MetaPlatformAudit";
import GooglePlatformAudit from "./audits/GooglePlatformAudit";
import ConnectCta from "@/components/shared/ConnectCta";
import type { CampaignData } from "@/types";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: string;
  customStart?: string;
  customEnd?: string;
  selectedObjectives: Set<string>;
  setActiveTab: (id: string) => void;
}

export default function PlatformAuditTab({ platform, dateRange, customStart, customEnd, selectedObjectives }: Props) {
  const { isMetaConnected, isGoogleConnected } = useAuthStore();
  const metaOn = isMetaConnected();
  const googleOn = isGoogleConnected();

  // Build sub-tab list only from connected platforms.
  const subTabs: Array<{
    id: string;
    label: string;
    description: string;
    render: (p: { campaigns: CampaignData[]; loading: boolean; platform: "meta" | "google" | "both" }) => ReactNode;
  }> = [];

  if (metaOn) {
    subTabs.push({
      id: "meta",
      label: "Meta",
      description: "Pixel, CAPI, Advantage+, placements",
      render: (p) => <MetaPlatformAudit {...p} />,
    });
  }
  if (googleOn) {
    subTabs.push({
      id: "google",
      label: "Google",
      description: "Search terms, PMax, RSA, impression share",
      render: (p) => <GooglePlatformAudit {...p} />,
    });
  }

  // Nothing connected → show CTA, skip the shell entirely.
  if (subTabs.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Globe className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Platform Audit</h1>
            <p className="text-gray-600 mt-1">Meta and Google platform-specific checks</p>
          </div>
        </div>
        <ConnectCta platform="a platform" context="to see platform-specific audits (Meta or Google)" />
      </div>
    );
  }

  return (
    <AuditTabShell
      platform={platform}
      dateRange={dateRange}
      customStart={customStart}
      customEnd={customEnd}
      selectedObjectives={selectedObjectives}
      title="Platform Audit"
      description="Meta and Google platform-specific checks"
      Icon={Globe}
      defaultSubTab={subTabs[0].id}
      subTabs={subTabs}
    />
  );
}
