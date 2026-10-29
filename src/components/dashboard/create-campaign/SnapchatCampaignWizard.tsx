import { useState } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Rocket,
} from "lucide-react";
import WizardStepper from "./WizardStepper";
import { useAuthStore } from "@/store/auth";

// ─── Constants ──────────────────────────────────────────────────────────────

const OBJECTIVES: { value: string; label: string; desc: string }[] = [
  { value: "WEB_CONVERSIONS", label: "Web Conversions", desc: "Drive actions on your website" },
  { value: "APP_INSTALLS", label: "App Installs", desc: "Get more app downloads" },
  { value: "BRAND_AWARENESS", label: "Brand Awareness", desc: "Maximize ad recall and reach" },
  { value: "VIDEO_VIEWS", label: "Video Views", desc: "Get more video views" },
  { value: "ENGAGEMENT", label: "Engagement", desc: "Increase interactions with your ads" },
  { value: "LEAD_GENERATION", label: "Lead Generation", desc: "Collect leads through forms" },
];

const BILLING_EVENTS: { value: string; label: string }[] = [
  { value: "IMPRESSION", label: "Impression (CPM)" },
  { value: "SWIPE_UP", label: "Swipe Up (CPC)" },
];

const BID_STRATEGIES: { value: string; label: string; desc: string }[] = [
  { value: "AUTO_BID", label: "Auto Bid", desc: "Let Snapchat optimize your bid" },
  { value: "TARGET_COST", label: "Target Cost", desc: "Target a specific cost per result" },
  { value: "LOWEST_COST_WITH_MAX_BID", label: "Lowest Cost with Max Bid", desc: "Set a bid ceiling" },
];

const OPT_GOALS: { value: string; label: string }[] = [
  { value: "IMPRESSIONS", label: "Impressions" },
  { value: "SWIPES", label: "Swipe Ups" },
  { value: "APP_INSTALLS", label: "App Installs" },
  { value: "VIDEO_VIEWS", label: "Video Views" },
  { value: "CONVERSIONS", label: "Conversions" },
];

const PLACEMENTS: { value: string; label: string }[] = [
  { value: "SNAP_ADS", label: "Snap Ads (Full screen between stories)" },
  { value: "CONTENT", label: "Content (Discover feed)" },
  { value: "USER_STORIES", label: "User Stories" },
];

const WIZARD_STEPS = [
  { label: "Campaign" },
  { label: "Ad Squad" },
  { label: "Review" },
];

// ─── Form state ─────────────────────────────────────────────────────────────

interface CampaignForm {
  name: string;
  objective: string;
  startDate: string;
  endDate: string;
  dailyBudget: string;
}

interface AdSquadForm {
  name: string;
  billingEvent: string;
  bidStrategy: string;
  maxBid: string;
  optimizationGoal: string;
  placement: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function SnapchatCampaignWizard() {
  const {
    snapchatClientId,
    snapchatClientSecret,
    snapchatRefreshToken,
    snapchatAdAccountId,
    snapchatCurrency,
  } = useAuthStore();
  const currency = snapchatCurrency || "USD";

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; campaignId?: string; adSquadId?: string; error?: string } | null>(null);

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const [campaign, setCampaign] = useState<CampaignForm>({
    name: "",
    objective: "WEB_CONVERSIONS",
    startDate: tomorrow,
    endDate: "",
    dailyBudget: "",
  });

  const [adSquad, setAdSquad] = useState<AdSquadForm>({
    name: "",
    billingEvent: "IMPRESSION",
    bidStrategy: "AUTO_BID",
    maxBid: "",
    optimizationGoal: "IMPRESSIONS",
    placement: "SNAP_ADS",
  });

  // ─── Validation ─────────────────────────────────────────────────────────

  const canAdvanceStep0 =
    campaign.name.trim() &&
    campaign.objective &&
    campaign.startDate &&
    campaign.dailyBudget &&
    parseFloat(campaign.dailyBudget) >= 20;

  const canAdvanceStep1 =
    adSquad.name.trim() &&
    adSquad.billingEvent &&
    adSquad.bidStrategy &&
    adSquad.optimizationGoal &&
    (adSquad.bidStrategy !== "LOWEST_COST_WITH_MAX_BID" || (adSquad.maxBid && parseFloat(adSquad.maxBid) > 0));

  // ─── Submit ───────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const dailyBudgetMicro = Math.round(parseFloat(campaign.dailyBudget) * 1_000_000);
      const bidMicro = adSquad.maxBid ? Math.round(parseFloat(adSquad.maxBid) * 1_000_000) : 0;

      const startTime = new Date(campaign.startDate + "T00:00:00Z").toISOString();
      const endTime = campaign.endDate ? new Date(campaign.endDate + "T23:59:59Z").toISOString() : undefined;

      const body = {
        clientId: snapchatClientId,
        clientSecret: snapchatClientSecret,
        refreshToken: snapchatRefreshToken,
        adAccountId: snapchatAdAccountId,
        campaign: {
          name: campaign.name,
          objective: campaign.objective,
          start_time: startTime,
          ...(endTime ? { end_time: endTime } : {}),
          daily_budget_micro: dailyBudgetMicro,
          status: "PAUSED",
        },
        adSquad: {
          name: adSquad.name,
          billing_event: adSquad.billingEvent,
          bid_strategy: adSquad.bidStrategy,
          ...(bidMicro > 0 ? { bid_micro: bidMicro } : {}),
          optimization_goal: adSquad.optimizationGoal,
          placement_v2: {
            config: "CUSTOM",
            platforms: ["SNAPCHAT"],
            snap_positions: adSquad.placement === "SNAP_ADS"
              ? ["INTERSTITIAL"]
              : adSquad.placement === "CONTENT"
              ? ["FEED"]
              : ["USER_STORY"],
          },
        },
      };

      const r = await fetch("/api/campaigns/create/snapchat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      setResult(data);
    } catch (e) {
      setResult({ success: false, error: e instanceof Error ? e.message : "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Styling ──────────────────────────────────────────────────────────────

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 outline-none";
  const labelCls = "block text-xs font-semibold text-gray-700 mb-1";
  const selectCls = inputCls;

  // ─── Result screen ────────────────────────────────────────────────────────

  if (result) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <div
          className={`p-6 rounded-xl border-2 ${
            result.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
          }`}
        >
          <div className="flex items-center gap-3 mb-4">
            {result.success ? (
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            ) : (
              <AlertTriangle className="w-8 h-8 text-red-600" />
            )}
            <h3 className="text-lg font-bold">
              {result.success ? "Campaign Created!" : "Creation Failed"}
            </h3>
          </div>
          {result.success && (
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-semibold">Campaign ID:</span> {result.campaignId}
              </div>
              {result.adSquadId && (
                <div>
                  <span className="font-semibold">Ad Squad ID:</span> {result.adSquadId}
                </div>
              )}
              <div className="mt-3 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                All entities were created in <strong>PAUSED</strong> state. Activate them from
                Snapchat Ads Manager when ready.
              </div>
            </div>
          )}
          {result.error && <p className="text-sm text-red-700 mt-2">{result.error}</p>}
          <button
            onClick={() => {
              setResult(null);
              setStep(0);
            }}
            className="mt-4 px-4 py-2 bg-yellow-500 text-black text-sm font-semibold rounded-lg hover:bg-yellow-600 transition"
          >
            Create Another
          </button>
        </div>
      </div>
    );
  }

  // ─── Wizard ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto">
      <WizardStepper steps={WIZARD_STEPS} current={step} skipped={new Set()} />

      {/* Step 0: Campaign */}
      {step === 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-gray-900">Campaign Details</h3>

          <div>
            <label className={labelCls}>Campaign Name *</label>
            <input
              className={inputCls}
              value={campaign.name}
              onChange={(e) => setCampaign({ ...campaign, name: e.target.value })}
              placeholder="e.g. Holiday Promo - Web Conversions"
            />
          </div>

          <div>
            <label className={labelCls}>Objective *</label>
            <div className="grid grid-cols-2 gap-2">
              {OBJECTIVES.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setCampaign({ ...campaign, objective: o.value })}
                  className={`p-3 rounded-lg border-2 text-left transition ${
                    campaign.objective === o.value
                      ? "border-yellow-500 bg-yellow-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="text-xs font-bold">{o.label}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{o.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Daily Budget ({currency}) * <span className="font-normal text-gray-400">(min 20)</span></label>
            <input
              className={inputCls}
              type="number"
              min="20"
              step="1"
              value={campaign.dailyBudget}
              onChange={(e) => setCampaign({ ...campaign, dailyBudget: e.target.value })}
              placeholder="e.g. 50"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Date *</label>
              <input
                className={inputCls}
                type="date"
                value={campaign.startDate}
                onChange={(e) => setCampaign({ ...campaign, startDate: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>End Date</label>
              <input
                className={inputCls}
                type="date"
                value={campaign.endDate}
                onChange={(e) => setCampaign({ ...campaign, endDate: e.target.value })}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg">
            <div className="px-2 py-0.5 bg-yellow-200 text-yellow-800 text-[10px] font-bold rounded">
              PAUSED
            </div>
            <span className="text-xs text-gray-600">
              Campaign will be created in paused state for safety
            </span>
          </div>

          <div className="flex justify-end">
            <button
              disabled={!canAdvanceStep0}
              onClick={() => setStep(1)}
              className="flex items-center gap-1 px-4 py-2 bg-yellow-500 text-black text-sm font-semibold rounded-lg hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Next: Ad Squad <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Ad Squad */}
      {step === 1 && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-gray-900">Ad Squad Details</h3>

          <div>
            <label className={labelCls}>Ad Squad Name *</label>
            <input
              className={inputCls}
              value={adSquad.name}
              onChange={(e) => setAdSquad({ ...adSquad, name: e.target.value })}
              placeholder="e.g. 18-34 Interest Targeting"
            />
          </div>

          <div>
            <label className={labelCls}>Billing Event *</label>
            <select
              className={selectCls}
              value={adSquad.billingEvent}
              onChange={(e) => setAdSquad({ ...adSquad, billingEvent: e.target.value })}
            >
              {BILLING_EVENTS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Bid Strategy *</label>
            <select
              className={selectCls}
              value={adSquad.bidStrategy}
              onChange={(e) => setAdSquad({ ...adSquad, bidStrategy: e.target.value })}
            >
              {BID_STRATEGIES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label} — {b.desc}
                </option>
              ))}
            </select>
          </div>

          {adSquad.bidStrategy === "LOWEST_COST_WITH_MAX_BID" && (
            <div>
              <label className={labelCls}>Max Bid ({currency}) *</label>
              <input
                className={inputCls}
                type="number"
                min="0.01"
                step="0.01"
                value={adSquad.maxBid}
                onChange={(e) => setAdSquad({ ...adSquad, maxBid: e.target.value })}
                placeholder="e.g. 5.00"
              />
            </div>
          )}

          <div>
            <label className={labelCls}>Optimization Goal *</label>
            <select
              className={selectCls}
              value={adSquad.optimizationGoal}
              onChange={(e) => setAdSquad({ ...adSquad, optimizationGoal: e.target.value })}
            >
              {OPT_GOALS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Placement *</label>
            <div className="grid grid-cols-3 gap-2">
              {PLACEMENTS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setAdSquad({ ...adSquad, placement: p.value })}
                  className={`p-3 rounded-lg border-2 text-left transition ${
                    adSquad.placement === p.value
                      ? "border-yellow-500 bg-yellow-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="text-xs font-bold">{p.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(0)}
              className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              disabled={!canAdvanceStep1}
              onClick={() => setStep(2)}
              className="flex items-center gap-1 px-4 py-2 bg-yellow-500 text-black text-sm font-semibold rounded-lg hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Next: Review <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Review */}
      {step === 2 && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-gray-900">Review & Create</h3>
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {/* Campaign */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-[10px] font-bold rounded">
                  CAMPAIGN
                </div>
                <div className="px-2 py-0.5 bg-yellow-200 text-yellow-800 text-[10px] font-bold rounded">
                  PAUSED
                </div>
              </div>
              <div className="text-sm font-bold">{campaign.name}</div>
              <div className="text-xs text-gray-500 mt-1">
                {OBJECTIVES.find((o) => o.value === campaign.objective)?.label} &middot;{" "}
                {currency} {campaign.dailyBudget}/day &middot; Starts {campaign.startDate}
                {campaign.endDate && ` · Ends ${campaign.endDate}`}
              </div>
            </div>

            {/* Ad Squad */}
            <div className="p-4">
              <div className="px-2 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded inline-block mb-2">
                AD SQUAD
              </div>
              <div className="text-sm font-bold">{adSquad.name}</div>
              <div className="text-xs text-gray-500 mt-1">
                {BILLING_EVENTS.find((b) => b.value === adSquad.billingEvent)?.label} &middot;{" "}
                {BID_STRATEGIES.find((b) => b.value === adSquad.bidStrategy)?.label}
                {adSquad.maxBid && ` · Max bid: ${currency} ${adSquad.maxBid}`} &middot;{" "}
                {OPT_GOALS.find((g) => g.value === adSquad.optimizationGoal)?.label} &middot;{" "}
                {PLACEMENTS.find((p) => p.value === adSquad.placement)?.label}
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              disabled={submitting}
              onClick={handleSubmit}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Rocket className="w-4 h-4" />
              )}
              {submitting ? "Creating…" : "Create Campaign"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
