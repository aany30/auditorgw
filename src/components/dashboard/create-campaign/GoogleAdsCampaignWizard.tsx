import { useState, useMemo } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  SkipForward,
  Rocket,
  Plus,
  Trash2,
} from "lucide-react";
import WizardStepper from "./WizardStepper";
import { useAuthStore } from "@/store/auth";
import type {
  GAdsChannelType,
  GAdsBiddingStrategy,
  CreateCampaignResponse,
} from "@/types/create-campaign";

// ─── Constants ──────────────────────────────────────────────────────────────

const CHANNEL_TYPES: { value: GAdsChannelType; label: string; desc: string }[] = [
  { value: "SEARCH", label: "Search", desc: "Text ads on Google Search results" },
  { value: "DISPLAY", label: "Display", desc: "Image/banner ads across the Google Display Network" },
  { value: "VIDEO", label: "Video", desc: "Video ads on YouTube and partners" },
  { value: "SHOPPING", label: "Shopping", desc: "Product listing ads from your feed" },
  { value: "PERFORMANCE_MAX", label: "Performance Max", desc: "AI-driven ads across all Google channels" },
];

const BIDDING_STRATEGIES: { value: GAdsBiddingStrategy; label: string; desc: string }[] = [
  { value: "MAXIMIZE_CLICKS", label: "Maximize Clicks", desc: "Get as many clicks as possible" },
  { value: "MAXIMIZE_CONVERSIONS", label: "Maximize Conversions", desc: "Get the most conversions" },
  { value: "MAXIMIZE_CONVERSION_VALUE", label: "Max Conversion Value", desc: "Highest total conversion value" },
  { value: "TARGET_CPA", label: "Target CPA", desc: "Target a specific cost per acquisition" },
  { value: "TARGET_ROAS", label: "Target ROAS", desc: "Target return on ad spend" },
  { value: "TARGET_IMPRESSION_SHARE", label: "Target Impression Share", desc: "Show on a target % of impressions" },
  { value: "MANUAL_CPC", label: "Manual CPC", desc: "Set your own max CPC bids" },
];

const AD_GROUP_TYPES: Record<string, { value: string; label: string }[]> = {
  SEARCH: [{ value: "SEARCH_STANDARD", label: "Standard Search" }],
  DISPLAY: [{ value: "DISPLAY_STANDARD", label: "Standard Display" }],
  VIDEO: [
    { value: "VIDEO_RESPONSIVE", label: "Responsive Video" },
    { value: "VIDEO_TRUE_VIEW_IN_STREAM", label: "TrueView In-Stream" },
  ],
  SHOPPING: [{ value: "SHOPPING_PRODUCT_ADS", label: "Product Ads" }],
  PERFORMANCE_MAX: [{ value: "SEARCH_STANDARD", label: "Auto-managed" }],
};

const WIZARD_STEPS = [
  { label: "Campaign" },
  { label: "Ad Group", optional: true },
  { label: "Ad", optional: true },
  { label: "Review" },
];

// ─── Form state ─────────────────────────────────────────────────────────────

interface CampaignForm {
  name: string;
  channelType: GAdsChannelType;
  biddingStrategy: GAdsBiddingStrategy;
  dailyBudget: string;
  startDate: string;
  endDate: string;
  targetGoogleSearch: boolean;
  targetSearchNetwork: boolean;
  targetContentNetwork: boolean;
}

interface AdGroupForm {
  name: string;
  type: string;
  maxCpc: string;
}

interface AdForm {
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function GoogleAdsCampaignWizard() {
  const {
    dv360ClientId,
    dv360ClientSecret,
    dv360RefreshToken,
    googleAdsCustomerId,
    googleAdsLoginCustomerId,
    googleAdsCurrency,
  } = useAuthStore();
  const currency = googleAdsCurrency || "USD";

  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateCampaignResponse | null>(null);

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const [campaign, setCampaign] = useState<CampaignForm>({
    name: "",
    channelType: "SEARCH",
    biddingStrategy: "MAXIMIZE_CLICKS",
    dailyBudget: "",
    startDate: tomorrow,
    endDate: "",
    targetGoogleSearch: true,
    targetSearchNetwork: true,
    targetContentNetwork: false,
  });

  const [adGroup, setAdGroup] = useState<AdGroupForm>({
    name: "",
    type: "SEARCH_STANDARD",
    maxCpc: "",
  });

  const [ad, setAd] = useState<AdForm>({
    headlines: ["", "", ""],
    descriptions: ["", ""],
    finalUrl: "",
  });

  const adGroupTypes = useMemo(
    () => AD_GROUP_TYPES[campaign.channelType] || AD_GROUP_TYPES.SEARCH,
    [campaign.channelType],
  );

  // Sync ad group type when channel changes
  const syncedAdGroupType = useMemo(() => {
    const types = AD_GROUP_TYPES[campaign.channelType] || [];
    return types.find((t) => t.value === adGroup.type) ? adGroup.type : types[0]?.value || "SEARCH_STANDARD";
  }, [campaign.channelType, adGroup.type]);

  // ─── Validation ─────────────────────────────────────────────────────────

  const canAdvanceStep0 =
    campaign.name.trim() &&
    campaign.channelType &&
    campaign.dailyBudget &&
    parseFloat(campaign.dailyBudget) > 0;

  const canAdvanceStep1 = adGroup.name.trim();

  const filledHeadlines = ad.headlines.filter((h) => h.trim()).length;
  const filledDescriptions = ad.descriptions.filter((d) => d.trim()).length;
  const canAdvanceStep2 =
    filledHeadlines >= 3 && filledDescriptions >= 2 && ad.finalUrl.trim();

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function addHeadline() {
    if (ad.headlines.length < 15) setAd({ ...ad, headlines: [...ad.headlines, ""] });
  }
  function removeHeadline(i: number) {
    if (ad.headlines.length > 3) setAd({ ...ad, headlines: ad.headlines.filter((_, idx) => idx !== i) });
  }
  function setHeadline(i: number, v: string) {
    const copy = [...ad.headlines];
    copy[i] = v;
    setAd({ ...ad, headlines: copy });
  }

  function addDescription() {
    if (ad.descriptions.length < 4) setAd({ ...ad, descriptions: [...ad.descriptions, ""] });
  }
  function removeDescription(i: number) {
    if (ad.descriptions.length > 2) setAd({ ...ad, descriptions: ad.descriptions.filter((_, idx) => idx !== i) });
  }
  function setDescription(i: number, v: string) {
    const copy = [...ad.descriptions];
    copy[i] = v;
    setAd({ ...ad, descriptions: copy });
  }

  function skipStep() {
    setSkipped((s) => new Set(s).add(step));
    if (step === 1) {
      setSkipped((s) => { const n = new Set(s); n.add(1); n.add(2); return n; });
      setStep(3);
    } else {
      setStep(step + 1);
    }
  }

  // ─── Submit ───────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        clientId: dv360ClientId,
        clientSecret: dv360ClientSecret,
        refreshToken: dv360RefreshToken,
        customerId: googleAdsCustomerId,
        loginCustomerId: googleAdsLoginCustomerId,
        campaign: {
          name: campaign.name,
          advertisingChannelType: campaign.channelType,
          status: "PAUSED",
          biddingStrategyType: campaign.biddingStrategy,
          dailyBudget: parseFloat(campaign.dailyBudget),
          startDate: campaign.startDate.replace(/-/g, ""),
          ...(campaign.endDate ? { endDate: campaign.endDate.replace(/-/g, "") } : {}),
          networkSettings: {
            targetGoogleSearch: campaign.targetGoogleSearch,
            targetSearchNetwork: campaign.targetSearchNetwork,
            targetContentNetwork: campaign.targetContentNetwork,
            targetPartnerSearchNetwork: false,
          },
        },
      };

      if (!skipped.has(1)) {
        body.adGroup = {
          name: adGroup.name,
          type: syncedAdGroupType,
          ...(adGroup.maxCpc
            ? { cpcBidMicros: String(Math.round(parseFloat(adGroup.maxCpc) * 1_000_000)) }
            : {}),
        };
      }

      if (!skipped.has(2)) {
        body.ad = {
          headlines: ad.headlines.filter((h) => h.trim()),
          descriptions: ad.descriptions.filter((d) => d.trim()),
          finalUrls: [ad.finalUrl],
        };
      }

      const r = await fetch("/api/campaigns/create/google-ads", {
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

  // ─── Styling ──────────────────────────────────────────────────────────────

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";
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
              {result.adGroupId && (
                <div>
                  <span className="font-semibold">Ad Group ID:</span> {result.adGroupId}
                </div>
              )}
              {result.adGroupAdId && (
                <div>
                  <span className="font-semibold">Ad ID:</span> {result.adGroupAdId}
                </div>
              )}
              <div className="mt-3 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                All entities were created in <strong>PAUSED</strong> state. Activate them from
                Google Ads when ready.
              </div>
            </div>
          )}
          {result.error && <p className="text-sm text-red-700 mt-2">{result.error}</p>}
          {result.partialErrors?.map((e, i) => (
            <div
              key={i}
              className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2"
            >
              <AlertTriangle className="w-3 h-3 inline mr-1" />
              {e}
            </div>
          ))}
          <button
            onClick={() => {
              setResult(null);
              setStep(0);
              setSkipped(new Set());
            }}
            className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition"
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
      <WizardStepper steps={WIZARD_STEPS} current={step} skipped={skipped} />

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
              placeholder="e.g. Search - Brand Terms Q4"
            />
          </div>

          <div>
            <label className={labelCls}>Campaign Type *</label>
            <div className="grid grid-cols-2 gap-2">
              {CHANNEL_TYPES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCampaign({ ...campaign, channelType: c.value })}
                  className={`p-3 rounded-lg border-2 text-left transition ${
                    campaign.channelType === c.value
                      ? "border-blue-600 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="text-xs font-bold">{c.label}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{c.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Bidding Strategy *</label>
            <select
              className={selectCls}
              value={campaign.biddingStrategy}
              onChange={(e) =>
                setCampaign({ ...campaign, biddingStrategy: e.target.value as GAdsBiddingStrategy })
              }
            >
              {BIDDING_STRATEGIES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label} — {b.desc}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Daily Budget ({currency}) *</label>
            <input
              className={inputCls}
              type="number"
              min="1"
              step="0.01"
              value={campaign.dailyBudget}
              onChange={(e) => setCampaign({ ...campaign, dailyBudget: e.target.value })}
              placeholder="e.g. 500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Date</label>
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

          {campaign.channelType === "SEARCH" && (
            <div>
              <label className={labelCls}>Network Settings</label>
              <div className="space-y-2 mt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={campaign.targetGoogleSearch}
                    onChange={(e) =>
                      setCampaign({ ...campaign, targetGoogleSearch: e.target.checked })
                    }
                    className="rounded"
                  />
                  <span className="text-xs text-gray-700">Google Search</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={campaign.targetSearchNetwork}
                    onChange={(e) =>
                      setCampaign({ ...campaign, targetSearchNetwork: e.target.checked })
                    }
                    className="rounded"
                  />
                  <span className="text-xs text-gray-700">Search Partners</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={campaign.targetContentNetwork}
                    onChange={(e) =>
                      setCampaign({ ...campaign, targetContentNetwork: e.target.checked })
                    }
                    className="rounded"
                  />
                  <span className="text-xs text-gray-700">Display Network</span>
                </label>
              </div>
            </div>
          )}

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
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Next: Ad Group <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Ad Group */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Ad Group Details</h3>
            <button
              onClick={skipStep}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
            >
              <SkipForward className="w-3 h-3" /> Skip to Review
            </button>
          </div>

          <div>
            <label className={labelCls}>Ad Group Name *</label>
            <input
              className={inputCls}
              value={adGroup.name}
              onChange={(e) => setAdGroup({ ...adGroup, name: e.target.value })}
              placeholder="e.g. Brand Keywords - Exact"
            />
          </div>

          <div>
            <label className={labelCls}>Ad Group Type</label>
            <select
              className={selectCls}
              value={syncedAdGroupType}
              onChange={(e) => setAdGroup({ ...adGroup, type: e.target.value })}
            >
              {adGroupTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {campaign.biddingStrategy === "MANUAL_CPC" && (
            <div>
              <label className={labelCls}>Max CPC ({currency})</label>
              <input
                className={inputCls}
                type="number"
                min="0.01"
                step="0.01"
                value={adGroup.maxCpc}
                onChange={(e) => setAdGroup({ ...adGroup, maxCpc: e.target.value })}
                placeholder="e.g. 2.50"
              />
            </div>
          )}

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
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Next: Ad <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Responsive Search Ad */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Responsive Search Ad</h3>
            <button
              onClick={() => {
                setSkipped((s) => new Set(s).add(2));
                setStep(3);
              }}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
            >
              <SkipForward className="w-3 h-3" /> Skip to Review
            </button>
          </div>

          <div>
            <label className={labelCls}>
              Headlines * (min 3, max 15 — each up to 30 characters)
            </label>
            <div className="space-y-2">
              {ad.headlines.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className={inputCls}
                    maxLength={30}
                    value={h}
                    onChange={(e) => setHeadline(i, e.target.value)}
                    placeholder={`Headline ${i + 1}`}
                  />
                  <span className="text-[10px] text-gray-400 w-8 text-right tabular-nums">
                    {h.length}/30
                  </span>
                  {ad.headlines.length > 3 && (
                    <button
                      onClick={() => removeHeadline(i)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {ad.headlines.length < 15 && (
                <button
                  onClick={addHeadline}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                >
                  <Plus className="w-3 h-3" /> Add headline
                </button>
              )}
            </div>
          </div>

          <div>
            <label className={labelCls}>
              Descriptions * (min 2, max 4 — each up to 90 characters)
            </label>
            <div className="space-y-2">
              {ad.descriptions.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <textarea
                    className={`${inputCls} resize-none`}
                    maxLength={90}
                    rows={2}
                    value={d}
                    onChange={(e) => setDescription(i, e.target.value)}
                    placeholder={`Description ${i + 1}`}
                  />
                  <span className="text-[10px] text-gray-400 w-8 text-right tabular-nums">
                    {d.length}/90
                  </span>
                  {ad.descriptions.length > 2 && (
                    <button
                      onClick={() => removeDescription(i)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {ad.descriptions.length < 4 && (
                <button
                  onClick={addDescription}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                >
                  <Plus className="w-3 h-3" /> Add description
                </button>
              )}
            </div>
          </div>

          <div>
            <label className={labelCls}>Final URL *</label>
            <input
              className={inputCls}
              type="url"
              value={ad.finalUrl}
              onChange={(e) => setAd({ ...ad, finalUrl: e.target.value })}
              placeholder="https://example.com/landing-page"
            />
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              disabled={!canAdvanceStep2}
              onClick={() => setStep(3)}
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
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
            {/* Campaign */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded">
                  CAMPAIGN
                </div>
                <div className="px-2 py-0.5 bg-yellow-200 text-yellow-800 text-[10px] font-bold rounded">
                  PAUSED
                </div>
              </div>
              <div className="text-sm font-bold">{campaign.name}</div>
              <div className="text-xs text-gray-500 mt-1">
                {CHANNEL_TYPES.find((c) => c.value === campaign.channelType)?.label} &middot;{" "}
                {BIDDING_STRATEGIES.find((b) => b.value === campaign.biddingStrategy)?.label}{" "}
                &middot; {currency} {campaign.dailyBudget}/day
                {campaign.startDate && ` · Starts ${campaign.startDate}`}
              </div>
            </div>

            {/* Ad Group */}
            {!skipped.has(1) ? (
              <div className="p-4">
                <div className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded inline-block mb-2">
                  AD GROUP
                </div>
                <div className="text-sm font-bold">{adGroup.name}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {adGroupTypes.find((t) => t.value === syncedAdGroupType)?.label}
                  {adGroup.maxCpc && ` · Max CPC: ${currency} ${adGroup.maxCpc}`}
                </div>
              </div>
            ) : (
              <div className="p-4 text-xs text-gray-400 italic">Ad Group — skipped</div>
            )}

            {/* Ad */}
            {!skipped.has(2) ? (
              <div className="p-4">
                <div className="px-2 py-0.5 bg-violet-100 text-violet-700 text-[10px] font-bold rounded inline-block mb-2">
                  RESPONSIVE SEARCH AD
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  <div>
                    <span className="font-semibold">{filledHeadlines} headlines:</span>{" "}
                    {ad.headlines
                      .filter((h) => h.trim())
                      .map((h, i) => (
                        <span key={i}>
                          {i > 0 && " | "}
                          {h}
                        </span>
                      ))}
                  </div>
                  <div className="mt-1">
                    <span className="font-semibold">{filledDescriptions} descriptions</span>
                  </div>
                  <div className="mt-1">
                    <span className="font-semibold">URL:</span> {ad.finalUrl}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 text-xs text-gray-400 italic">Ad — skipped</div>
            )}
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(skipped.has(1) ? 0 : skipped.has(2) ? 1 : 2)}
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
