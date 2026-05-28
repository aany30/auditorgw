import { useState, useEffect, useMemo } from "react";
import { useAuthStore } from "@/store/auth";
import { Layers } from "lucide-react";
import type { CampaignData } from "@/types";
import { objectiveMatches } from "./CampaignObjectiveFilter";
import NamingConventionAudit from "./audits/NamingConventionAudit";
import FunnelSeparationAudit from "./audits/FunnelSeparationAudit";
import BudgetAllocationAudit from "./audits/BudgetAllocationAudit";
import LearningPhaseAudit from "./audits/LearningPhaseAudit";
import CampaignObjectiveAudit from "./audits/CampaignObjectiveAudit";
import AboCboAudit from "./audits/AboCboAudit";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: string;
  customStart?: string;
  customEnd?: string;
  selectedObjectives: Set<string>;
  setActiveTab: (id: string) => void;
}

type SubTab = "naming" | "funnel-sep" | "budget" | "learning" | "objective" | "abo-cbo";

const SUB_TABS: Array<{ id: SubTab; label: string; description: string }> = [
  { id: "naming", label: "Naming Convention", description: "Standardized naming Pass/Fail" },
  { id: "funnel-sep", label: "Funnel Separation", description: "TOF/MOF/BOF segmentation" },
  { id: "budget", label: "Budget Allocation", description: "Budget fragmentation %" },
  { id: "learning", label: "Learning Phase", description: "Learning-limited campaigns" },
  { id: "objective", label: "Campaign Objective", description: "Objective mismatch detection" },
  { id: "abo-cbo", label: "ABO vs CBO", description: "Correct structure usage" },
];

// Map the dashboard's DateRange prop → concrete since/until ISO dates Meta
// understands. Falls back to the last 30 days.
function rangeToDates(range: string, customStart?: string, customEnd?: string): { startDate: string; endDate: string } {
  if (range === "custom" && customStart && customEnd) return { startDate: customStart, endDate: customEnd };
  const today = new Date();
  const start = new Date(today);
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  start.setDate(today.getDate() - days);
  return { startDate: start.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) };
}

export default function AccountStructureTab({ platform, dateRange, customStart, customEnd, selectedObjectives, setActiveTab }: Props) {
  const {
    metaAccessToken,
    metaBusinessId,
    googleAccessToken,
    googleCustomerId,
    googleAdsDeveloperToken,
    googleAdsLoginCustomerId,
  } = useAuthStore();
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<SubTab>("naming");

  useEffect(() => {
    let cancelled = false;
    const fetchCampaigns = async () => {
      setLoading(true);
      const all: CampaignData[] = [];
      const { startDate, endDate } = rangeToDates(dateRange, customStart, customEnd);
      try {
        if ((platform === "meta" || platform === "both") && metaAccessToken && metaBusinessId) {
          const r = await fetch("/api/naming/campaigns/meta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken: metaAccessToken, businessId: metaBusinessId, startDate, endDate }),
          });
          if (r.ok) all.push(...(await r.json()));
        }
        if ((platform === "google" || platform === "both") && googleAccessToken && googleCustomerId && googleAdsDeveloperToken) {
          const r = await fetch("/api/naming/campaigns/google", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken: googleAccessToken,
              customerId: googleCustomerId,
              developerToken: googleAdsDeveloperToken,
              loginCustomerId: googleAdsLoginCustomerId || googleCustomerId,
              startDate,
              endDate,
            }),
          });
          if (r.ok) all.push(...(await r.json()));
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) {
          setCampaigns(all);
          setLoading(false);
        }
      }
    };
    fetchCampaigns();
    return () => {
      cancelled = true;
    };
  }, [platform, dateRange, customStart, customEnd, metaAccessToken, metaBusinessId, googleAccessToken, googleCustomerId, googleAdsDeveloperToken, googleAdsLoginCustomerId]);

  const filteredCampaigns = useMemo(() => {
    if (!selectedObjectives || selectedObjectives.size === 0) return campaigns;
    return campaigns.filter((c) => objectiveMatches(c.objective, selectedObjectives));
  }, [campaigns, selectedObjectives]);

  const auditProps = { campaigns: filteredCampaigns, loading, platform, accountTotal: campaigns.length };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Layers className="w-8 h-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Account Structure Audit</h1>
          <p className="text-gray-600 mt-1">Campaign structure: naming, funnel separation, budget, learning, objective, ABO/CBO</p>
        </div>
      </div>

      {selectedObjectives && selectedObjectives.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-900">
          Filtered by objective: <span className="font-semibold">{Array.from(selectedObjectives).filter((s) => s !== "__none__").join(", ") || "(none)"}</span>{" "}
          — {filteredCampaigns.length} of {campaigns.length} campaigns
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`px-4 py-3 font-semibold border-b-2 transition whitespace-nowrap ${
              active === t.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            <div>{t.label}</div>
            <div className="text-xs text-gray-500 font-normal">{t.description}</div>
          </button>
        ))}
      </div>

      {active === "naming" && <NamingConventionAudit {...auditProps} />}
      {active === "funnel-sep" && <FunnelSeparationAudit {...auditProps} />}
      {active === "budget" && <BudgetAllocationAudit {...auditProps} />}
      {active === "learning" && <LearningPhaseAudit {...auditProps} />}
      {active === "objective" && <CampaignObjectiveAudit {...auditProps} />}
      {active === "abo-cbo" && <AboCboAudit {...auditProps} />}
    </div>
  );
}
