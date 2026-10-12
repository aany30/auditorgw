import { useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft, SkipForward, Rocket } from "lucide-react";
import WizardStepper from "./WizardStepper";
import { useAuthStore } from "@/store/auth";
import type { DV360DateObj, CreateCampaignResponse } from "@/types/create-campaign";

const GOAL_TYPES = [
  { value: "CAMPAIGN_GOAL_TYPE_BRAND_AWARENESS", label: "Brand Awareness" },
  { value: "CAMPAIGN_GOAL_TYPE_ONLINE_ACTION", label: "Online Action" },
  { value: "CAMPAIGN_GOAL_TYPE_OFFLINE_ACTION", label: "Offline Action" },
  { value: "CAMPAIGN_GOAL_TYPE_APP_INSTALL", label: "App Install" },
];

const PACING_PERIODS = [
  { value: "PACING_PERIOD_DAILY", label: "Daily" },
  { value: "PACING_PERIOD_FLIGHT", label: "Flight" },
];

const PACING_TYPES = [
  { value: "PACING_TYPE_EVEN", label: "Even" },
  { value: "PACING_TYPE_AHEAD", label: "Ahead" },
  { value: "PACING_TYPE_ASAP", label: "ASAP" },
];

const PERF_GOAL_TYPES = [
  { value: "PERFORMANCE_GOAL_TYPE_CPM", label: "CPM" },
  { value: "PERFORMANCE_GOAL_TYPE_CPC", label: "CPC" },
  { value: "PERFORMANCE_GOAL_TYPE_CPA", label: "CPA" },
  { value: "PERFORMANCE_GOAL_TYPE_CPIAVC", label: "CPIAVC" },
  { value: "PERFORMANCE_GOAL_TYPE_CTR", label: "CTR" },
  { value: "PERFORMANCE_GOAL_TYPE_VIEWABILITY", label: "Viewability" },
];

const LINE_ITEM_TYPES = [
  { value: "LINE_ITEM_TYPE_DISPLAY_DEFAULT", label: "Display" },
  { value: "LINE_ITEM_TYPE_VIDEO_DEFAULT", label: "Video" },
  { value: "LINE_ITEM_TYPE_YOUTUBE_AND_PARTNERS_ACTION", label: "YouTube & Partners (Action)" },
  { value: "LINE_ITEM_TYPE_YOUTUBE_AND_PARTNERS_REACH", label: "YouTube & Partners (Reach)" },
];

const WIZARD_STEPS = [
  { label: "Campaign" },
  { label: "Insertion Order", optional: true },
  { label: "Line Item", optional: true },
  { label: "Review" },
];

function isoToDateObj(iso: string): DV360DateObj | null {
  if (!iso) return null;
  const d = new Date(iso);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function dateObjToLabel(d: DV360DateObj | null): string {
  if (!d) return "—";
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

interface CampaignForm {
  name: string;
  goalType: string;
  perfGoalType: string;
  perfGoalValue: string;
  startDate: string;
  endDate: string;
}

// Percentage-based goals use performanceGoalPercentageMicros (1% = 10,000);
// all others use performanceGoalAmountMicros (currency × 1,000,000).
const PERCENTAGE_GOALS = new Set(["PERFORMANCE_GOAL_TYPE_CTR", "PERFORMANCE_GOAL_TYPE_VIEWABILITY"]);

function buildPerformanceGoal(type: string, value: string): Record<string, unknown> {
  const num = parseFloat(value || "0") || 0;
  if (PERCENTAGE_GOALS.has(type)) {
    return { performanceGoalType: type, performanceGoalPercentageMicros: String(Math.round(num * 10_000)) };
  }
  return { performanceGoalType: type, performanceGoalAmountMicros: String(Math.round(num * 1_000_000)) };
}

// Insertion Orders use a `kpi` object (not performanceGoal). Map the perf-goal
// enum to its KPI_TYPE_* equivalent and attach the right value field.
const KPI_TYPE_MAP: Record<string, string> = {
  PERFORMANCE_GOAL_TYPE_CPM: "KPI_TYPE_CPM",
  PERFORMANCE_GOAL_TYPE_CPC: "KPI_TYPE_CPC",
  PERFORMANCE_GOAL_TYPE_CPA: "KPI_TYPE_CPA",
  PERFORMANCE_GOAL_TYPE_CPIAVC: "KPI_TYPE_CPIAVC",
  PERFORMANCE_GOAL_TYPE_CTR: "KPI_TYPE_CTR",
  PERFORMANCE_GOAL_TYPE_VIEWABILITY: "KPI_TYPE_VIEWABILITY",
};

function buildKpi(perfGoalType: string, value: string): Record<string, unknown> {
  const kpiType = KPI_TYPE_MAP[perfGoalType] || "KPI_TYPE_CPM";
  const num = parseFloat(value || "0") || 0;
  if (PERCENTAGE_GOALS.has(perfGoalType)) {
    return { kpiType, kpiPercentageMicros: String(Math.round(num * 10_000)) };
  }
  return { kpiType, kpiAmountMicros: String(Math.round(num * 1_000_000)) };
}

interface IOForm {
  name: string;
  pacingPeriod: string;
  pacingType: string;
  budgetAmount: string;
  perfGoalType: string;
  perfGoalAmount: string;
}

interface LIForm {
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  budgetAmount: string;
  freqCapImpressions: string;
  freqCapDays: string;
}

export default function DV360CampaignWizard() {
  const { dv360ClientId, dv360ClientSecret, dv360RefreshToken, dv360AdvertiserId } = useAuthStore();

  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateCampaignResponse | null>(null);

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const monthLater = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [campaign, setCampaign] = useState<CampaignForm>({
    name: "", goalType: "CAMPAIGN_GOAL_TYPE_BRAND_AWARENESS", perfGoalType: "PERFORMANCE_GOAL_TYPE_CPM", perfGoalValue: "", startDate: tomorrow, endDate: monthLater,
  });

  const [io, setIO] = useState<IOForm>({
    name: "", pacingPeriod: "PACING_PERIOD_DAILY", pacingType: "PACING_TYPE_EVEN",
    budgetAmount: "", perfGoalType: "PERFORMANCE_GOAL_TYPE_CPM", perfGoalAmount: "",
  });

  const [li, setLI] = useState<LIForm>({
    name: "", type: "LINE_ITEM_TYPE_DISPLAY_DEFAULT", startDate: tomorrow, endDate: monthLater,
    budgetAmount: "", freqCapImpressions: "3", freqCapDays: "1",
  });

  const canAdvanceStep0 = campaign.name.trim() && campaign.startDate && campaign.endDate && parseFloat(campaign.perfGoalValue) > 0;
  const canAdvanceStep1 = io.name.trim() && io.budgetAmount;
  const canAdvanceStep2 = li.name.trim();

  function skipStep() {
    if (step === 1) {
      setSkipped((s) => { const n = new Set(s); n.add(1); n.add(2); return n; });
      setStep(3);
    } else {
      setSkipped((s) => new Set(s).add(step));
      setStep(step + 1);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const startObj = isoToDateObj(campaign.startDate)!;
      const endObj = isoToDateObj(campaign.endDate)!;

      const body: Record<string, unknown> = {
        clientId: dv360ClientId,
        clientSecret: dv360ClientSecret,
        refreshToken: dv360RefreshToken,
        advertiserId: dv360AdvertiserId,
        campaign: {
          displayName: campaign.name,
          entityStatus: "ENTITY_STATUS_PAUSED",
          campaignGoal: {
            campaignGoalType: campaign.goalType,
            performanceGoal: buildPerformanceGoal(campaign.perfGoalType, campaign.perfGoalValue),
          },
          campaignFlight: { plannedDates: { startDate: startObj, endDate: endObj } },
          frequencyCap: { unlimited: true },
        },
      };

      if (!skipped.has(1)) {
        const ioStart = isoToDateObj(campaign.startDate)!;
        const ioEnd = isoToDateObj(campaign.endDate)!;
        const micros = String(Math.round(parseFloat(io.budgetAmount || "0") * 1_000_000));
        body.insertionOrder = {
          displayName: io.name,
          entityStatus: "ENTITY_STATUS_PAUSED",
          pacing: { pacingPeriod: io.pacingPeriod, pacingType: io.pacingType },
          frequencyCap: { unlimited: true },
          kpi: buildKpi(io.perfGoalType, io.perfGoalAmount || campaign.perfGoalValue),
          budget: {
            budgetUnit: "BUDGET_UNIT_CURRENCY",
            budgetSegments: [{ dateRange: { startDate: ioStart, endDate: ioEnd }, budgetAmountMicros: micros }],
          },
        };
      }

      if (!skipped.has(2)) {
        const liStart = isoToDateObj(li.startDate || campaign.startDate)!;
        const liEnd = isoToDateObj(li.endDate || campaign.endDate)!;
        body.lineItem = {
          displayName: li.name,
          entityStatus: "ENTITY_STATUS_PAUSED",
          lineItemType: li.type,
          flight: { dateRange: { startDate: liStart, endDate: liEnd } },
          budget: {
            budgetAllocationType: "LINE_ITEM_BUDGET_ALLOCATION_TYPE_FIXED",
            budgetUnit: "BUDGET_UNIT_CURRENCY",
            ...(li.budgetAmount ? { maxAmount: String(Math.round(parseFloat(li.budgetAmount) * 1_000_000)) } : {}),
          },
          bidStrategy: { maximizeSpendAutoBid: { performanceGoalType: io.perfGoalType || "PERFORMANCE_GOAL_TYPE_CPM" } },
          ...(li.freqCapImpressions ? {
            frequencyCap: {
              maxImpressions: parseInt(li.freqCapImpressions) || 3,
              timeUnit: "TIME_UNIT_DAYS",
              timeUnitCount: parseInt(li.freqCapDays) || 1,
              unlimited: false,
            },
          } : {}),
        };
      }

      const r = await fetch("/api/campaigns/create/dv360", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json()) as CreateCampaignResponse;
      setResult(data);
    } catch (e) {
      setResult({ success: false, error: e instanceof Error ? e.message : "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";
  const labelCls = "block text-xs font-semibold text-gray-700 mb-1";
  const selectCls = inputCls;

  if (result) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <div className={`p-6 rounded-xl border-2 ${result.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
          <div className="flex items-center gap-3 mb-4">
            {result.success ? <CheckCircle2 className="w-8 h-8 text-green-600" /> : <AlertTriangle className="w-8 h-8 text-red-600" />}
            <h3 className="text-lg font-bold">{result.success ? "Campaign Created!" : "Creation Failed"}</h3>
          </div>
          {result.success && (
            <div className="space-y-2 text-sm">
              <div><span className="font-semibold">Campaign ID:</span> {result.campaignId}</div>
              {result.insertionOrderId && <div><span className="font-semibold">Insertion Order ID:</span> {result.insertionOrderId}</div>}
              {result.lineItemId && <div><span className="font-semibold">Line Item ID:</span> {result.lineItemId}</div>}
              <div className="mt-3 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                All entities were created in <strong>PAUSED</strong> state. Activate them from the DV360 UI when ready.
              </div>
            </div>
          )}
          {result.error && <p className="text-sm text-red-700 mt-2">{result.error}</p>}
          {result.partialErrors?.map((e, i) => (
            <div key={i} className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              <AlertTriangle className="w-3 h-3 inline mr-1" />{e}
            </div>
          ))}
          <button onClick={() => { setResult(null); setStep(0); setSkipped(new Set()); }} className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition">
            Create Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <WizardStepper steps={WIZARD_STEPS} current={step} skipped={skipped} />

      {/* Step 0: Campaign */}
      {step === 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-gray-900">Campaign Details</h3>
          <div>
            <label className={labelCls}>Campaign Name *</label>
            <input className={inputCls} value={campaign.name} onChange={(e) => setCampaign({ ...campaign, name: e.target.value })} placeholder="e.g. Q4 Brand Campaign" />
          </div>
          <div>
            <label className={labelCls}>Campaign Goal *</label>
            <div className="grid grid-cols-2 gap-2">
              {GOAL_TYPES.map((g) => (
                <button key={g.value} onClick={() => setCampaign({ ...campaign, goalType: g.value })}
                  className={`p-3 rounded-lg border-2 text-left transition ${campaign.goalType === g.value ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                  <div className="text-xs font-bold">{g.label}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Performance Goal *</label>
              <select className={selectCls} value={campaign.perfGoalType} onChange={(e) => setCampaign({ ...campaign, perfGoalType: e.target.value })}>
                {PERF_GOAL_TYPES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>
                Goal Value * {PERCENTAGE_GOALS.has(campaign.perfGoalType) ? "(%)" : "(in currency)"}
              </label>
              <input className={inputCls} type="number" min="0" step="0.01" value={campaign.perfGoalValue}
                onChange={(e) => setCampaign({ ...campaign, perfGoalValue: e.target.value })}
                placeholder={PERCENTAGE_GOALS.has(campaign.perfGoalType) ? "e.g. 50" : "e.g. 150"} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Date *</label>
              <input className={inputCls} type="date" value={campaign.startDate} onChange={(e) => setCampaign({ ...campaign, startDate: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>End Date *</label>
              <input className={inputCls} type="date" value={campaign.endDate} onChange={(e) => setCampaign({ ...campaign, endDate: e.target.value })} />
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg">
            <div className="px-2 py-0.5 bg-yellow-200 text-yellow-800 text-[10px] font-bold rounded">PAUSED</div>
            <span className="text-xs text-gray-600">Campaign will be created in paused state for safety</span>
          </div>
          <div className="flex justify-end">
            <button disabled={!canAdvanceStep0} onClick={() => setStep(1)}
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition">
              Next: Insertion Order <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Insertion Order */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Insertion Order Details</h3>
            <button onClick={skipStep} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
              <SkipForward className="w-3 h-3" /> Skip to Review
            </button>
          </div>
          <div>
            <label className={labelCls}>IO Name *</label>
            <input className={inputCls} value={io.name} onChange={(e) => setIO({ ...io, name: e.target.value })} placeholder="e.g. Q4 Brand IO" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Pacing Period</label>
              <select className={selectCls} value={io.pacingPeriod} onChange={(e) => setIO({ ...io, pacingPeriod: e.target.value })}>
                {PACING_PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Pacing Type</label>
              <select className={selectCls} value={io.pacingType} onChange={(e) => setIO({ ...io, pacingType: e.target.value })}>
                {PACING_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Budget Amount (in currency) *</label>
            <input className={inputCls} type="number" min="1" value={io.budgetAmount} onChange={(e) => setIO({ ...io, budgetAmount: e.target.value })} placeholder="e.g. 50000" />
            <p className="text-[10px] text-gray-400 mt-1">Total budget for the flight period ({campaign.startDate} to {campaign.endDate})</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Performance Goal Type</label>
              <select className={selectCls} value={io.perfGoalType} onChange={(e) => setIO({ ...io, perfGoalType: e.target.value })}>
                {PERF_GOAL_TYPES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Goal Amount (in currency)</label>
              <input className={inputCls} type="number" min="0" step="0.01" value={io.perfGoalAmount} onChange={(e) => setIO({ ...io, perfGoalAmount: e.target.value })} placeholder="e.g. 5.00" />
            </div>
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(0)} className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button disabled={!canAdvanceStep1} onClick={() => setStep(2)}
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition">
              Next: Line Item <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Line Item */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Line Item Details</h3>
            <button onClick={() => { setSkipped((s) => new Set(s).add(2)); setStep(3); }} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
              <SkipForward className="w-3 h-3" /> Skip to Review
            </button>
          </div>
          <div>
            <label className={labelCls}>Line Item Name *</label>
            <input className={inputCls} value={li.name} onChange={(e) => setLI({ ...li, name: e.target.value })} placeholder="e.g. Display - Broad Audience" />
          </div>
          <div>
            <label className={labelCls}>Line Item Type *</label>
            <div className="grid grid-cols-2 gap-2">
              {LINE_ITEM_TYPES.map((t) => (
                <button key={t.value} onClick={() => setLI({ ...li, type: t.value })}
                  className={`p-3 rounded-lg border-2 text-left transition ${li.type === t.value ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                  <div className="text-xs font-bold">{t.label}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Date</label>
              <input className={inputCls} type="date" value={li.startDate} onChange={(e) => setLI({ ...li, startDate: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>End Date</label>
              <input className={inputCls} type="date" value={li.endDate} onChange={(e) => setLI({ ...li, endDate: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Budget (in currency)</label>
            <input className={inputCls} type="number" min="0" value={li.budgetAmount} onChange={(e) => setLI({ ...li, budgetAmount: e.target.value })} placeholder="e.g. 10000" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Frequency Cap (impressions)</label>
              <input className={inputCls} type="number" min="1" value={li.freqCapImpressions} onChange={(e) => setLI({ ...li, freqCapImpressions: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Per N days</label>
              <input className={inputCls} type="number" min="1" value={li.freqCapDays} onChange={(e) => setLI({ ...li, freqCapDays: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button disabled={!canAdvanceStep2} onClick={() => setStep(3)}
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition">
              Next: Review <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-gray-900">Review & Create</h3>
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded">CAMPAIGN</div>
                <div className="px-2 py-0.5 bg-yellow-200 text-yellow-800 text-[10px] font-bold rounded">PAUSED</div>
              </div>
              <div className="text-sm font-bold">{campaign.name}</div>
              <div className="text-xs text-gray-500 mt-1">
                {GOAL_TYPES.find((g) => g.value === campaign.goalType)?.label} &middot; {dateObjToLabel(isoToDateObj(campaign.startDate))} to {dateObjToLabel(isoToDateObj(campaign.endDate))}
              </div>
            </div>
            {!skipped.has(1) ? (
              <div className="p-4">
                <div className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded inline-block mb-2">INSERTION ORDER</div>
                <div className="text-sm font-bold">{io.name}</div>
                <div className="text-xs text-gray-500 mt-1">
                  Budget: {io.budgetAmount} &middot; {PACING_TYPES.find((p) => p.value === io.pacingType)?.label} pacing &middot; Goal: {PERF_GOAL_TYPES.find((g) => g.value === io.perfGoalType)?.label}
                </div>
              </div>
            ) : (
              <div className="p-4 text-xs text-gray-400 italic">Insertion Order — skipped</div>
            )}
            {!skipped.has(2) ? (
              <div className="p-4">
                <div className="px-2 py-0.5 bg-violet-100 text-violet-700 text-[10px] font-bold rounded inline-block mb-2">LINE ITEM</div>
                <div className="text-sm font-bold">{li.name}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {LINE_ITEM_TYPES.find((t) => t.value === li.type)?.label} &middot; {li.budgetAmount ? `Budget: ${li.budgetAmount}` : "No budget"} &middot; Freq cap: {li.freqCapImpressions}/{li.freqCapDays}d
                </div>
              </div>
            ) : (
              <div className="p-4 text-xs text-gray-400 italic">Line Item — skipped</div>
            )}
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(skipped.has(1) ? 0 : skipped.has(2) ? 1 : 2)} className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button disabled={submitting} onClick={handleSubmit}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 transition">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              {submitting ? "Creating…" : "Create Campaign"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
