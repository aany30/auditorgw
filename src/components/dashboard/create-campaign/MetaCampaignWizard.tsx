import { useState, useMemo } from "react";
import { Loader2, CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft, SkipForward, Rocket } from "lucide-react";
import WizardStepper from "./WizardStepper";
import { useAuthStore } from "@/store/auth";
import type { MetaObjective, CreateCampaignResponse } from "@/types/create-campaign";

const OBJECTIVES: { value: MetaObjective; label: string; desc: string }[] = [
  { value: "OUTCOME_AWARENESS", label: "Awareness", desc: "Reach people who are most likely to remember your ads" },
  { value: "OUTCOME_TRAFFIC", label: "Traffic", desc: "Send people to a destination like a website or app" },
  { value: "OUTCOME_ENGAGEMENT", label: "Engagement", desc: "Get more messages, video views, post engagement" },
  { value: "OUTCOME_LEADS", label: "Leads", desc: "Collect leads for your business" },
  { value: "OUTCOME_APP_PROMOTION", label: "App Promotion", desc: "Get people to install or take action in your app" },
  { value: "OUTCOME_SALES", label: "Sales", desc: "Find people likely to purchase your product or service" },
];

const SPECIAL_CATEGORIES = [
  { value: "NONE", label: "None" },
  { value: "EMPLOYMENT", label: "Employment" },
  { value: "HOUSING", label: "Housing" },
  { value: "CREDIT", label: "Credit" },
  { value: "ISSUES_ELECTIONS_POLITICS", label: "Social Issues / Elections / Politics" },
];

const OPT_GOALS: Record<string, { value: string; label: string }[]> = {
  OUTCOME_AWARENESS: [
    { value: "REACH", label: "Reach" },
    { value: "IMPRESSIONS", label: "Impressions" },
  ],
  OUTCOME_TRAFFIC: [
    { value: "LINK_CLICKS", label: "Link Clicks" },
    { value: "LANDING_PAGE_VIEWS", label: "Landing Page Views" },
  ],
  OUTCOME_ENGAGEMENT: [
    { value: "POST_ENGAGEMENT", label: "Post Engagement" },
    { value: "PAGE_LIKES", label: "Page Likes" },
    { value: "THRUPLAY", label: "ThruPlay (Video Views)" },
  ],
  OUTCOME_LEADS: [
    { value: "LEAD_GENERATION", label: "Lead Generation" },
    { value: "LINK_CLICKS", label: "Link Clicks" },
  ],
  OUTCOME_APP_PROMOTION: [
    { value: "APP_INSTALLS", label: "App Installs" },
  ],
  OUTCOME_SALES: [
    { value: "OFFSITE_CONVERSIONS", label: "Conversions" },
    { value: "VALUE", label: "Value" },
    { value: "LINK_CLICKS", label: "Link Clicks" },
  ],
};

const CTA_TYPES = [
  "LEARN_MORE", "SHOP_NOW", "SIGN_UP", "SUBSCRIBE", "CONTACT_US",
  "DOWNLOAD", "GET_OFFER", "BOOK_TRAVEL", "APPLY_NOW", "BUY_NOW",
];

const COUNTRIES = [
  { code: "IN", name: "India" }, { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" }, { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" }, { code: "DE", name: "Germany" },
  { code: "FR", name: "France" }, { code: "JP", name: "Japan" },
  { code: "BR", name: "Brazil" }, { code: "AE", name: "UAE" },
  { code: "SG", name: "Singapore" }, { code: "SA", name: "Saudi Arabia" },
];

const WIZARD_STEPS = [
  { label: "Campaign" },
  { label: "Ad Set", optional: true },
  { label: "Ad", optional: true },
  { label: "Review" },
];

interface CampaignForm {
  name: string;
  objective: MetaObjective;
  specialCategories: string[];
  cbo: boolean;
  dailyBudget: string;
}

interface AdSetForm {
  name: string;
  optGoal: string;
  billingEvent: string;
  dailyBudget: string;
  startDate: string;
  endDate: string;
  countries: string[];
  ageMin: string;
  ageMax: string;
  genders: string;
  bidStrategy: string;
}

interface AdForm {
  name: string;
  pageId: string;
  link: string;
  message: string;
  headline: string;
  description: string;
  imageUrl: string;
  cta: string;
}

export default function MetaCampaignWizard() {
  const { metaAccessToken, metaBusinessId, metaCurrency } = useAuthStore();
  const currency = metaCurrency || "USD";

  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateCampaignResponse | null>(null);

  const [campaign, setCampaign] = useState<CampaignForm>({
    name: "", objective: "OUTCOME_TRAFFIC", specialCategories: ["NONE"], cbo: false, dailyBudget: "",
  });

  const [adset, setAdSet] = useState<AdSetForm>({
    name: "", optGoal: "LINK_CLICKS", billingEvent: "IMPRESSIONS", dailyBudget: "",
    startDate: new Date(Date.now() + 86400000).toISOString().slice(0, 16), endDate: "", countries: ["IN"],
    ageMin: "18", ageMax: "65", genders: "0", bidStrategy: "LOWEST_COST_WITHOUT_CAP",
  });

  const [ad, setAd] = useState<AdForm>({
    name: "", pageId: "", link: "", message: "", headline: "", description: "", imageUrl: "", cta: "LEARN_MORE",
  });

  const optGoals = useMemo(() => OPT_GOALS[campaign.objective] || [], [campaign.objective]);

  const canAdvanceStep0 = campaign.name.trim() && campaign.objective && (!campaign.cbo || campaign.dailyBudget);
  const canAdvanceStep1 = adset.name.trim() && adset.optGoal && adset.startDate && adset.countries.length > 0 && (!campaign.cbo ? adset.dailyBudget : true);
  const canAdvanceStep2 = ad.name.trim() && ad.pageId.trim() && ad.link.trim() && ad.message.trim();

  function skipStep() {
    setSkipped((s) => new Set(s).add(step));
    setStep(step === 1 ? 3 : step + 1); // skip ad set → skip ad too → review; skip ad → review
    if (step === 1) setSkipped((s) => { const n = new Set(s); n.add(1); n.add(2); return n; });
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        accessToken: metaAccessToken,
        businessId: metaBusinessId,
        campaign: {
          name: campaign.name,
          objective: campaign.objective,
          special_ad_categories: campaign.specialCategories,
          buying_type: "AUCTION",
          status: "PAUSED",
          ...(campaign.cbo && campaign.dailyBudget ? { daily_budget: Math.round(parseFloat(campaign.dailyBudget) * 100) } : {}),
        },
      };

      if (!skipped.has(1)) {
        body.adset = {
          name: adset.name,
          optimization_goal: adset.optGoal,
          billing_event: adset.billingEvent,
          start_time: new Date(adset.startDate).toISOString(),
          ...(adset.endDate ? { end_time: new Date(adset.endDate).toISOString() } : {}),
          ...(!campaign.cbo && adset.dailyBudget ? { daily_budget: Math.round(parseFloat(adset.dailyBudget) * 100) } : {}),
          targeting: {
            geo_locations: { countries: adset.countries },
            age_min: parseInt(adset.ageMin) || 18,
            age_max: parseInt(adset.ageMax) || 65,
            ...(adset.genders !== "0" ? { genders: [parseInt(adset.genders)] } : {}),
          },
          bid_strategy: adset.bidStrategy,
        };
      }

      if (!skipped.has(2)) {
        body.ad = {
          name: ad.name,
          creative: {
            name: `${ad.name} Creative`,
            object_story_spec: {
              page_id: ad.pageId,
              link_data: {
                link: ad.link,
                message: ad.message,
                ...(ad.imageUrl ? { picture: ad.imageUrl } : {}),
                ...(ad.headline ? { name: ad.headline } : {}),
                ...(ad.description ? { description: ad.description } : {}),
                ...(ad.cta ? { call_to_action: { type: ad.cta, value: { link: ad.link } } } : {}),
              },
            },
          },
          status: "PAUSED",
        };
      }

      const r = await fetch("/api/campaigns/create/meta", {
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
              {result.adsetId && <div><span className="font-semibold">Ad Set ID:</span> {result.adsetId}</div>}
              {result.adId && <div><span className="font-semibold">Ad ID:</span> {result.adId}</div>}
              <div className="mt-3 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                All entities were created in <strong>PAUSED</strong> state. Activate them from Meta Ads Manager when ready.
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
            <input className={inputCls} value={campaign.name} onChange={(e) => setCampaign({ ...campaign, name: e.target.value })} placeholder="e.g. Summer Sale 2026" />
          </div>
          <div>
            <label className={labelCls}>Objective *</label>
            <div className="grid grid-cols-2 gap-2">
              {OBJECTIVES.map((o) => (
                <button key={o.value} onClick={() => setCampaign({ ...campaign, objective: o.value })}
                  className={`p-3 rounded-lg border-2 text-left transition ${campaign.objective === o.value ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                  <div className="text-xs font-bold">{o.label}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{o.desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>Special Ad Category</label>
            <select className={selectCls} value={campaign.specialCategories[0]} onChange={(e) => setCampaign({ ...campaign, specialCategories: [e.target.value] })}>
              {SPECIAL_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={campaign.cbo} onChange={(e) => setCampaign({ ...campaign, cbo: e.target.checked })} className="rounded" />
              <span className="text-xs font-semibold text-gray-700">Campaign Budget Optimization (CBO)</span>
            </label>
          </div>
          {campaign.cbo && (
            <div>
              <label className={labelCls}>Daily Budget ({currency}) *</label>
              <input className={inputCls} type="number" min="1" value={campaign.dailyBudget} onChange={(e) => setCampaign({ ...campaign, dailyBudget: e.target.value })} placeholder="e.g. 500" />
            </div>
          )}
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg">
            <div className="px-2 py-0.5 bg-yellow-200 text-yellow-800 text-[10px] font-bold rounded">PAUSED</div>
            <span className="text-xs text-gray-600">Campaign will be created in paused state for safety</span>
          </div>
          <div className="flex justify-end">
            <button disabled={!canAdvanceStep0} onClick={() => setStep(1)}
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition">
              Next: Ad Set <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Ad Set */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Ad Set Details</h3>
            <button onClick={skipStep} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
              <SkipForward className="w-3 h-3" /> Skip to Review
            </button>
          </div>
          <div>
            <label className={labelCls}>Ad Set Name *</label>
            <input className={inputCls} value={adset.name} onChange={(e) => setAdSet({ ...adset, name: e.target.value })} placeholder="e.g. IN - 18-45 - Interest" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Optimization Goal *</label>
              <select className={selectCls} value={adset.optGoal} onChange={(e) => setAdSet({ ...adset, optGoal: e.target.value })}>
                {optGoals.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Billing Event</label>
              <select className={selectCls} value={adset.billingEvent} onChange={(e) => setAdSet({ ...adset, billingEvent: e.target.value })}>
                <option value="IMPRESSIONS">Impressions</option>
                <option value="LINK_CLICKS">Link Clicks</option>
              </select>
            </div>
          </div>
          {!campaign.cbo && (
            <div>
              <label className={labelCls}>Daily Budget ({currency}) *</label>
              <input className={inputCls} type="number" min="1" value={adset.dailyBudget} onChange={(e) => setAdSet({ ...adset, dailyBudget: e.target.value })} placeholder="e.g. 200" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Date *</label>
              <input className={inputCls} type="datetime-local" value={adset.startDate} onChange={(e) => setAdSet({ ...adset, startDate: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>End Date</label>
              <input className={inputCls} type="datetime-local" value={adset.endDate} onChange={(e) => setAdSet({ ...adset, endDate: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Target Countries *</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {COUNTRIES.map((c) => (
                <button key={c.code} onClick={() => {
                  setAdSet({ ...adset, countries: adset.countries.includes(c.code) ? adset.countries.filter((x) => x !== c.code) : [...adset.countries, c.code] });
                }}
                  className={`px-2 py-1 text-[11px] font-semibold rounded-md border transition ${adset.countries.includes(c.code) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"}`}>
                  {c.code} — {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Min Age</label>
              <input className={inputCls} type="number" min="13" max="65" value={adset.ageMin} onChange={(e) => setAdSet({ ...adset, ageMin: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Max Age</label>
              <input className={inputCls} type="number" min="13" max="65" value={adset.ageMax} onChange={(e) => setAdSet({ ...adset, ageMax: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Gender</label>
              <select className={selectCls} value={adset.genders} onChange={(e) => setAdSet({ ...adset, genders: e.target.value })}>
                <option value="0">All</option>
                <option value="1">Male</option>
                <option value="2">Female</option>
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Bid Strategy</label>
            <select className={selectCls} value={adset.bidStrategy} onChange={(e) => setAdSet({ ...adset, bidStrategy: e.target.value })}>
              <option value="LOWEST_COST_WITHOUT_CAP">Lowest Cost (Auto)</option>
              <option value="LOWEST_COST_WITH_BID_CAP">Bid Cap</option>
              <option value="COST_CAP">Cost Cap</option>
            </select>
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(0)} className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button disabled={!canAdvanceStep1} onClick={() => setStep(2)}
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition">
              Next: Ad <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Ad */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Ad Details</h3>
            <button onClick={() => { setSkipped((s) => new Set(s).add(2)); setStep(3); }} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
              <SkipForward className="w-3 h-3" /> Skip to Review
            </button>
          </div>
          <div>
            <label className={labelCls}>Ad Name *</label>
            <input className={inputCls} value={ad.name} onChange={(e) => setAd({ ...ad, name: e.target.value })} placeholder="e.g. Image Ad - Summer" />
          </div>
          <div>
            <label className={labelCls}>Facebook Page ID *</label>
            <input className={inputCls} value={ad.pageId} onChange={(e) => setAd({ ...ad, pageId: e.target.value })} placeholder="e.g. 123456789012345" />
            <p className="text-[10px] text-gray-400 mt-1">The Facebook Page that the ad will be published from</p>
          </div>
          <div>
            <label className={labelCls}>Landing Page URL *</label>
            <input className={inputCls} type="url" value={ad.link} onChange={(e) => setAd({ ...ad, link: e.target.value })} placeholder="https://example.com/landing" />
          </div>
          <div>
            <label className={labelCls}>Primary Text *</label>
            <textarea className={`${inputCls} resize-none`} rows={3} value={ad.message} onChange={(e) => setAd({ ...ad, message: e.target.value })} placeholder="Write compelling ad copy..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Headline</label>
              <input className={inputCls} value={ad.headline} onChange={(e) => setAd({ ...ad, headline: e.target.value })} placeholder="e.g. Shop Now - 50% Off" />
            </div>
            <div>
              <label className={labelCls}>Call to Action</label>
              <select className={selectCls} value={ad.cta} onChange={(e) => setAd({ ...ad, cta: e.target.value })}>
                {CTA_TYPES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <input className={inputCls} value={ad.description} onChange={(e) => setAd({ ...ad, description: e.target.value })} placeholder="Optional link description" />
          </div>
          <div>
            <label className={labelCls}>Image URL</label>
            <input className={inputCls} type="url" value={ad.imageUrl} onChange={(e) => setAd({ ...ad, imageUrl: e.target.value })} placeholder="https://example.com/image.jpg" />
            <p className="text-[10px] text-gray-400 mt-1">Direct URL to an image (1200x628 recommended). File upload coming soon.</p>
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
            {/* Campaign summary */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded">CAMPAIGN</div>
                <div className="px-2 py-0.5 bg-yellow-200 text-yellow-800 text-[10px] font-bold rounded">PAUSED</div>
              </div>
              <div className="text-sm font-bold">{campaign.name}</div>
              <div className="text-xs text-gray-500 mt-1">
                {OBJECTIVES.find((o) => o.value === campaign.objective)?.label} &middot; {campaign.cbo ? `CBO ${currency} ${campaign.dailyBudget}/day` : "ABO"} &middot; {campaign.specialCategories[0] === "NONE" ? "No special category" : campaign.specialCategories[0]}
              </div>
            </div>
            {/* Ad Set summary */}
            {!skipped.has(1) && (
              <div className="p-4">
                <div className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded inline-block mb-2">AD SET</div>
                <div className="text-sm font-bold">{adset.name}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {adset.optGoal.replace(/_/g, " ")} &middot; {!campaign.cbo && adset.dailyBudget ? `${currency} ${adset.dailyBudget}/day` : "Budget from CBO"} &middot; {adset.countries.join(", ")} &middot; Ages {adset.ageMin}–{adset.ageMax}
                </div>
              </div>
            )}
            {skipped.has(1) && (
              <div className="p-4 text-xs text-gray-400 italic">Ad Set — skipped</div>
            )}
            {/* Ad summary */}
            {!skipped.has(2) && (
              <div className="p-4">
                <div className="px-2 py-0.5 bg-violet-100 text-violet-700 text-[10px] font-bold rounded inline-block mb-2">AD</div>
                <div className="text-sm font-bold">{ad.name}</div>
                <div className="text-xs text-gray-500 mt-1">
                  Page {ad.pageId} &middot; {ad.cta.replace(/_/g, " ")} &middot; {ad.link}
                </div>
                {ad.message && <div className="text-xs text-gray-600 mt-1 line-clamp-2">&ldquo;{ad.message}&rdquo;</div>}
              </div>
            )}
            {skipped.has(2) && (
              <div className="p-4 text-xs text-gray-400 italic">Ad — skipped</div>
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
