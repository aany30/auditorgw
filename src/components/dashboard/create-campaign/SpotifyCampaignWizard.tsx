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

const DELIVERY_GOALS: { value: string; label: string; desc: string }[] = [
  { value: "AWARENESS", label: "Awareness", desc: "Maximize reach and ad recall" },
  { value: "WEBSITE_TRAFFIC", label: "Website Traffic", desc: "Drive visits to your website" },
  { value: "ENGAGEMENT_ON_SPOTIFY", label: "Engagement", desc: "Increase streams and saves on Spotify" },
  { value: "VIDEO_VIEWS", label: "Video Views", desc: "Get more video ad views" },
  { value: "APP_PROMOTION", label: "App Promotion", desc: "Drive app installs and usage" },
  { value: "LEAD_GEN", label: "Lead Generation", desc: "Collect leads through forms" },
];

const AD_SET_GOALS: { value: string; label: string }[] = [
  { value: "IMPRESSIONS", label: "Impressions" },
  { value: "REACH", label: "Reach" },
  { value: "CLICKS", label: "Clicks" },
  { value: "VIDEO_VIEWS", label: "Video Views" },
  { value: "STREAMS", label: "Streams" },
  { value: "LEADS", label: "Leads" },
];

const BID_STRATEGIES: { value: string; label: string; desc: string }[] = [
  { value: "AUTOBID", label: "Auto Bid", desc: "Spotify optimizes your bid automatically" },
  { value: "COST_PER_RESULT", label: "Cost Per Result", desc: "Target a specific cost per result" },
  { value: "MAX_BID", label: "Max Bid", desc: "Set a maximum bid ceiling" },
];

const PLACEMENTS: { value: string; label: string }[] = [
  { value: "MUSIC", label: "Music (between songs)" },
  { value: "PODCAST", label: "Podcast (host-read + inserted)" },
];

const PLATFORMS: { value: string; label: string }[] = [
  { value: "ANDROID", label: "Android" },
  { value: "IOS", label: "iOS" },
  { value: "DESKTOP", label: "Desktop" },
];

const COUNTRIES: { value: string; label: string }[] = [
  { value: "IN", label: "India" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "CA", label: "Canada" },
  { value: "AU", label: "Australia" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "BR", label: "Brazil" },
  { value: "MX", label: "Mexico" },
  { value: "JP", label: "Japan" },
];

const WIZARD_STEPS = [
  { label: "Campaign" },
  { label: "Ad Set" },
  { label: "Review" },
];

// ─── Form state ─────────────────────────────────────────────────────────────

interface CampaignForm {
  name: string;
  deliveryGoalGroup: string;
}

interface AdSetForm {
  name: string;
  deliveryGoal: string;
  bidStrategy: string;
  budgetType: "DAILY" | "LIFETIME";
  budgetAmount: string;
  startDate: string;
  endDate: string;
  placements: string[];
  platforms: string[];
  countries: string[];
  ageMin: string;
  ageMax: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function SpotifyCampaignWizard() {
  const {
    spotifyClientId,
    spotifyClientSecret,
    spotifyRefreshToken,
    spotifyAdAccountId,
    spotifyCurrency,
  } = useAuthStore();
  const currency = spotifyCurrency || "INR";

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean; campaignId?: string; adsetId?: string; error?: string; partialErrors?: string[];
  } | null>(null);

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const [campaign, setCampaign] = useState<CampaignForm>({
    name: "",
    deliveryGoalGroup: "AWARENESS",
  });

  const [adSet, setAdSet] = useState<AdSetForm>({
    name: "",
    deliveryGoal: "IMPRESSIONS",
    bidStrategy: "AUTOBID",
    budgetType: "DAILY",
    budgetAmount: "",
    startDate: tomorrow,
    endDate: "",
    placements: ["MUSIC"],
    platforms: ["ANDROID", "IOS", "DESKTOP"],
    countries: ["IN"],
    ageMin: "18",
    ageMax: "65",
  });

  // ─── Validation ─────────────────────────────────────────────────────────

  const canAdvanceStep0 = campaign.name.trim().length >= 2 && campaign.deliveryGoalGroup;

  const canAdvanceStep1 =
    adSet.name.trim().length >= 2 &&
    adSet.budgetAmount &&
    parseFloat(adSet.budgetAmount) > 0 &&
    adSet.startDate &&
    adSet.placements.length > 0 &&
    adSet.countries.length > 0;

  // ─── Submit ───────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const microAmount = Math.round(parseFloat(adSet.budgetAmount) * 1_000_000);
      const startTime = new Date(adSet.startDate + "T00:00:00Z").toISOString();
      const endTime = adSet.endDate ? new Date(adSet.endDate + "T23:59:59Z").toISOString() : undefined;

      const body = {
        clientId: spotifyClientId,
        clientSecret: spotifyClientSecret,
        refreshToken: spotifyRefreshToken,
        adAccountId: spotifyAdAccountId,
        campaign: {
          name: campaign.name,
          delivery_goal_group: campaign.deliveryGoalGroup,
        },
        adSet: {
          name: adSet.name,
          start_time: startTime,
          ...(endTime ? { end_time: endTime } : {}),
          budget: { micro_amount: microAmount, type: adSet.budgetType },
          delivery_goal: adSet.deliveryGoal,
          bid_strategy: adSet.bidStrategy,
          targets: {
            placements: adSet.placements,
            platforms: adSet.platforms,
            age_ranges: [`${adSet.ageMin}-${adSet.ageMax}`],
            geo_targets: adSet.countries.map((c) => ({ country_code: c })),
          },
        },
      };

      const r = await fetch("/api/campaigns/create/spotify", {
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
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none";
  const labelCls = "block text-xs font-semibold text-gray-700 mb-1";

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function toggleArrayItem(arr: string[], item: string): string[] {
    return arr.includes(item) ? arr.filter((i) => i !== item) : [...arr, item];
  }

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
              {result.adsetId && (
                <div>
                  <span className="font-semibold">Ad Set ID:</span> {result.adsetId}
                </div>
              )}
              {result.partialErrors && result.partialErrors.length > 0 && (
                <div className="mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  <strong>Partial issues:</strong>
                  {result.partialErrors.map((e, i) => (
                    <div key={i} className="mt-1">• {e}</div>
                  ))}
                </div>
              )}
              <div className="mt-3 px-3 py-2 bg-green-100 border border-green-200 rounded-lg text-xs text-green-800">
                Campaign was created in your Spotify Ad Manager account. It will appear in
                your campaigns list. Activate it from Spotify Ad Studio when ready.
              </div>
            </div>
          )}
          {result.error && <p className="text-sm text-red-700 mt-2">{result.error}</p>}
          <button
            onClick={() => {
              setResult(null);
              setStep(0);
            }}
            className="mt-4 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition"
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
              placeholder="e.g. Epic Brand Awareness - November"
            />
          </div>

          <div>
            <label className={labelCls}>Delivery Goal *</label>
            <div className="grid grid-cols-2 gap-2">
              {DELIVERY_GOALS.map((g) => (
                <button
                  key={g.value}
                  onClick={() => setCampaign({ ...campaign, deliveryGoalGroup: g.value })}
                  className={`p-3 rounded-lg border-2 text-left transition ${
                    campaign.deliveryGoalGroup === g.value
                      ? "border-green-500 bg-green-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="text-xs font-bold">{g.label}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{g.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg">
            <div className="px-2 py-0.5 bg-green-200 text-green-800 text-[10px] font-bold rounded">
              NOTE
            </div>
            <span className="text-xs text-gray-600">
              Campaign will appear in your Spotify Ad Manager once created
            </span>
          </div>

          <div className="flex justify-end">
            <button
              disabled={!canAdvanceStep0}
              onClick={() => setStep(1)}
              className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Next: Ad Set <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Ad Set */}
      {step === 1 && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-gray-900">Ad Set Details</h3>

          <div>
            <label className={labelCls}>Ad Set Name *</label>
            <input
              className={inputCls}
              value={adSet.name}
              onChange={(e) => setAdSet({ ...adSet, name: e.target.value })}
              placeholder="e.g. India 18-34 Music Listeners"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Budget Type *</label>
              <select
                className={inputCls}
                value={adSet.budgetType}
                onChange={(e) => setAdSet({ ...adSet, budgetType: e.target.value as "DAILY" | "LIFETIME" })}
              >
                <option value="DAILY">Daily</option>
                <option value="LIFETIME">Lifetime</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Budget Amount ({currency}) *</label>
              <input
                className={inputCls}
                type="number"
                min="1"
                step="1"
                value={adSet.budgetAmount}
                onChange={(e) => setAdSet({ ...adSet, budgetAmount: e.target.value })}
                placeholder="e.g. 500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Date *</label>
              <input
                className={inputCls}
                type="date"
                value={adSet.startDate}
                onChange={(e) => setAdSet({ ...adSet, startDate: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>End Date {adSet.budgetType === "LIFETIME" && "*"}</label>
              <input
                className={inputCls}
                type="date"
                value={adSet.endDate}
                onChange={(e) => setAdSet({ ...adSet, endDate: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Delivery Goal</label>
            <select
              className={inputCls}
              value={adSet.deliveryGoal}
              onChange={(e) => setAdSet({ ...adSet, deliveryGoal: e.target.value })}
            >
              {AD_SET_GOALS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Bid Strategy</label>
            <select
              className={inputCls}
              value={adSet.bidStrategy}
              onChange={(e) => setAdSet({ ...adSet, bidStrategy: e.target.value })}
            >
              {BID_STRATEGIES.map((b) => (
                <option key={b.value} value={b.value}>{b.label} — {b.desc}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Placements *</label>
            <div className="flex gap-2 flex-wrap">
              {PLACEMENTS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setAdSet({ ...adSet, placements: toggleArrayItem(adSet.placements, p.value) })}
                  className={`px-3 py-2 rounded-lg border-2 text-xs font-semibold transition ${
                    adSet.placements.includes(p.value)
                      ? "border-green-500 bg-green-50 text-green-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Platforms</label>
            <div className="flex gap-2 flex-wrap">
              {PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setAdSet({ ...adSet, platforms: toggleArrayItem(adSet.platforms, p.value) })}
                  className={`px-3 py-2 rounded-lg border-2 text-xs font-semibold transition ${
                    adSet.platforms.includes(p.value)
                      ? "border-green-500 bg-green-50 text-green-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Target Countries *</label>
            <div className="flex gap-2 flex-wrap">
              {COUNTRIES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setAdSet({ ...adSet, countries: toggleArrayItem(adSet.countries, c.value) })}
                  className={`px-3 py-1.5 rounded-lg border-2 text-xs font-semibold transition ${
                    adSet.countries.includes(c.value)
                      ? "border-green-500 bg-green-50 text-green-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Min Age</label>
              <input
                className={inputCls}
                type="number"
                min="13"
                max="65"
                value={adSet.ageMin}
                onChange={(e) => setAdSet({ ...adSet, ageMin: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>Max Age</label>
              <input
                className={inputCls}
                type="number"
                min="13"
                max="99"
                value={adSet.ageMax}
                onChange={(e) => setAdSet({ ...adSet, ageMax: e.target.value })}
              />
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
              className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
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
                <div className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded">
                  CAMPAIGN
                </div>
              </div>
              <div className="text-sm font-bold">{campaign.name}</div>
              <div className="text-xs text-gray-500 mt-1">
                {DELIVERY_GOALS.find((g) => g.value === campaign.deliveryGoalGroup)?.label || campaign.deliveryGoalGroup}
              </div>
            </div>

            {/* Ad Set */}
            <div className="p-4">
              <div className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded inline-block mb-2">
                AD SET
              </div>
              <div className="text-sm font-bold">{adSet.name}</div>
              <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                <div>
                  {currency} {adSet.budgetAmount}/{adSet.budgetType === "DAILY" ? "day" : "lifetime"} &middot;{" "}
                  {AD_SET_GOALS.find((g) => g.value === adSet.deliveryGoal)?.label} &middot;{" "}
                  {BID_STRATEGIES.find((b) => b.value === adSet.bidStrategy)?.label}
                </div>
                <div>
                  Starts {adSet.startDate}
                  {adSet.endDate && ` · Ends ${adSet.endDate}`}
                </div>
                <div>
                  Placements: {adSet.placements.map((p) => PLACEMENTS.find((pl) => pl.value === p)?.label || p).join(", ")}
                </div>
                <div>
                  Platforms: {adSet.platforms.join(", ")} &middot;{" "}
                  Countries: {adSet.countries.join(", ")} &middot;{" "}
                  Age: {adSet.ageMin}–{adSet.ageMax}
                </div>
              </div>
            </div>
          </div>

          <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <strong>Note:</strong> This creates a campaign and ad set only. You will need to add
            creatives (audio/video ads) in Spotify Ad Studio to complete the ad and start delivery.
            The campaign is created in your connected Spotify Ad Manager account.
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
