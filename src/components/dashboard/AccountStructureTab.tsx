import { useState, useEffect, useMemo } from "react";
import { useAuthStore } from "@/store/auth";
import { Layers } from "lucide-react";
import type { CampaignData } from "@/types";
import { objectiveMatches } from "./CampaignObjectiveFilter";
import NamingConventionAudit from "./audits/NamingConventionAudit";
import FunnelSeparationAudit from "./audits/FunnelSeparationAudit";
import BudgetAllocationAudit from "./audits/BudgetAllocationAudit";
import LearningPhaseAudit from "./audits/LearningPhaseAudit";
import AboCboAudit from "./audits/AboCboAudit";
import VerificationBanner from "@/components/shared/VerificationBanner";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: string;
  customStart?: string;
  customEnd?: string;
  selectedObjectives: Set<string>;
  setActiveTab: (id: string) => void;
}

type SubTab = "naming" | "funnel-sep" | "budget" | "learning" | "abo-cbo";

const SUB_TABS: Array<{ id: SubTab; label: string; description: string }> = [
  { id: "naming", label: "Naming Convention", description: "Standardized naming Pass/Fail" },
  { id: "funnel-sep", label: "Funnel Separation", description: "TOF/MOF/BOF segmentation" },
  { id: "budget", label: "Budget Allocation", description: "Budget fragmentation %" },
  { id: "learning", label: "Learning Phase", description: "Learning-limited campaigns" },
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
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [active, setActive] = useState<SubTab>("naming");

  // User-defined window override (independent of the global navbar picker).
  // When set, it drives the fetch for ALL sub-audits. Null → global picker.
  const globalRange = rangeToDates(dateRange, customStart, customEnd);
  const [ovStart, setOvStart] = useState<string | null>(null);
  const [ovEnd, setOvEnd] = useState<string | null>(null);
  const winStart = ovStart ?? globalRange.startDate;
  const winEnd = ovEnd ?? globalRange.endDate;
  // Draft values for the inline date inputs before "Apply".
  const [draftStart, setDraftStart] = useState(winStart);
  const [draftEnd, setDraftEnd] = useState(winEnd);

  useEffect(() => {
    let cancelled = false;
    const fetchCampaigns = async () => {
      setLoading(true);
      setFetchError(null);
      const all: CampaignData[] = [];
      const startDate = winStart;
      const endDate = winEnd;
      try {
        if ((platform === "meta" || platform === "both") && metaAccessToken && metaBusinessId) {
          const r = await fetch("/api/naming/campaigns/meta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken: metaAccessToken, businessId: metaBusinessId, startDate, endDate }),
          });
          if (r.ok) {
            all.push(...(await r.json()));
          } else {
            const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
            if (!cancelled) setFetchError(body.error || `Meta API error (HTTP ${r.status})`);
          }
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
          if (r.ok) {
            all.push(...(await r.json()));
          } else {
            const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
            if (!cancelled) setFetchError(body.error || `Google API error (HTTP ${r.status})`);
          }
        }
      } catch (e) {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : "Fetch failed");
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
  }, [platform, winStart, winEnd, metaAccessToken, metaBusinessId, googleAccessToken, googleCustomerId, googleAdsDeveloperToken, googleAdsLoginCustomerId]);

  // Keep draft inputs in sync when the effective window changes (e.g. global picker moves while no override is set).
  useEffect(() => {
    setDraftStart(winStart);
    setDraftEnd(winEnd);
  }, [winStart, winEnd]);

  const filteredCampaigns = useMemo(() => {
    if (!selectedObjectives || selectedObjectives.size === 0) return campaigns;
    return campaigns.filter((c) => objectiveMatches(c.objective, selectedObjectives));
  }, [campaigns, selectedObjectives]);

  // Pass the EFFECTIVE window (override or global) down so sub-audits scope
  // correctly. dateRange="custom" forces sub-components to honor the explicit
  // start/end (their resolveWindow only uses custom dates when range==="custom").
  const auditProps = { campaigns: filteredCampaigns, loading, platform, accountTotal: campaigns.length, dateRange: "custom", customStart: winStart, customEnd: winEnd };

  const windowDays = Math.max(
    1,
    Math.round((new Date(winEnd).getTime() - new Date(winStart).getTime()) / 86_400_000) + 1
  );
  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return iso; }
  };
  const activeCount = filteredCampaigns.filter((c) => c.status?.toUpperCase() === "ACTIVE" || c.status?.toUpperCase() === "ENABLED").length;
  const pausedCount = filteredCampaigns.length - activeCount;
  const acctCurrency = filteredCampaigns.find((c) => c.currency)?.currency || "USD";

  return (
    <div className="space-y-6 section-enter">
      {fetchError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <span className="font-semibold shrink-0">Error loading campaigns:</span>
          <span>{fetchError}</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Layers className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Account Structure Audit</h1>
            <p className="text-gray-600 mt-1">Campaign structure: naming, funnel separation, budget, learning, objective, ABO/CBO</p>
          </div>
        </div>
        <AIExecutiveSummary
          tabName="Account Structure"
          context={{ activeAudit: active, platform, campaignCount: campaigns.length, dateRange }}
          platform={platform === "both" ? "meta" : platform}
          dateRange={dateRange}
          inline
        />
      </div>

      {/* User-defined window — drives the data fetch for ALL sub-audits.
          Like Meta Ads Manager's from→to report range. */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-wrap items-center gap-3 text-xs text-gray-700">
        <span className="font-semibold text-gray-700">Window</span>
        <input
          type="date"
          value={draftStart}
          max={draftEnd}
          onChange={(e) => setDraftStart(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-gray-400">→</span>
        <input
          type="date"
          value={draftEnd}
          min={draftStart}
          onChange={(e) => setDraftEnd(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => { setOvStart(draftStart); setOvEnd(draftEnd); }}
          disabled={draftStart === winStart && draftEnd === winEnd}
          className="px-3 py-1 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40"
        >
          Apply
        </button>
        {(ovStart || ovEnd) && (
          <button
            onClick={() => { setOvStart(null); setOvEnd(null); }}
            className="px-2 py-1 rounded-lg text-gray-600 hover:bg-gray-200 font-semibold"
          >
            Reset to global
          </button>
        )}
        <span className="text-gray-400">·</span>
        <span className="text-gray-500">{windowDays} days</span>
        {filteredCampaigns.length > 0 && (
          <>
            <span className="text-gray-400">·</span>
            <span className="font-semibold text-gray-900">{activeCount} active</span>
            {pausedCount > 0 && <span className="text-gray-500">· {pausedCount} paused/archived</span>}
            <span className="text-gray-400">·</span>
            <span>Currency: <span className="font-semibold text-gray-900">{acctCurrency}</span></span>
          </>
        )}
        {(ovStart || ovEnd) && <span className="text-blue-700 font-semibold">· custom window active</span>}
      </div>

      {/* Passive auto-verification banner — runs in background, surfaces drift. */}
      {filteredCampaigns.length > 0 && (
        <VerificationBanner campaigns={filteredCampaigns} startDate={winStart} endDate={winEnd} />
      )}

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
      {active === "abo-cbo" && <AboCboAudit {...auditProps} />}

    </div>
  );
}
