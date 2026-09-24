/**
 * Ad Intelligence — competitive media-intelligence over Meta ads (the "Outpost" view).
 *
 * Scores each brand ONLY on signals that are actually in the Ad Library data:
 * volume (active ads), cadence (new ads this week) and longevity (median days
 * live). These roll up into a 0-100 PRESSURE INDEX that ranks the whole set
 * (you + competitors). Everything is deterministic — no inferred/spend metrics,
 * no LLM — so the read is always truthful to what was scraped.
 */

import type { SocialPaidAd } from "@/lib/media-analyser/types";
import { computeRunningDays } from "@/lib/media-analyser/paid-ad-buckets";
import { isInfluencerAd, classifyInfluencer } from "@/lib/media-analyser/paid-ad-stats";

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** One ad's longevity marker for the spectrum viz. proven = has survived 3+ weeks. */
export interface AdBar { days: number; proven: boolean }

/** Ads launched in one calendar month (for the decay / month-ads read). */
export interface MonthCount { month: string; label: string; count: number }
export type DecayTrend = "rising" | "flat" | "cooling";

export interface BrandAdMetrics {
  brand: string;
  isYou: boolean;
  totalAds: number;
  activeAds: number;
  /** Ad VERSIONS incl. Meta's collated variants — reconciles with Meta's "~N results" header. */
  totalVersions: number;
  newThisWeek: number;
  medianDaysLive: number;
  pressureIndex: number; // 0..100 (filled after cross-set normalization)
  rank: number; // filled after ranking
  bars: AdBar[]; // up to 10, for the spectrum
  read: string; // one-sentence per-brand read
  topAds: { id: string; days: number; url?: string }[]; // longest-running, for verdict refs
  // ── Ad Library breakdown (all from real fields) ──
  archetype: Archetype; // advertising style classification
  formats: { image: number; video: number; carousel: number; other: number };
  // Nested creative-format breakdown: static vs video, then static → image/carousel
  // and video → influencer reel / UGC reel / brand video.
  formatBreakdown: {
    video: number; static: number;
    staticImage: number; staticCarousel: number; staticOther: number;
    videoInfluencer: number; videoUgc: number; videoBrand: number;
  };
  formatLifespans: { key: string; count: number; medianDays: number }[]; // format × median lifespan
  ctas: { label: string; count: number; pct: number; medianDays: number }[]; // CTA bucket × share × median lifespan
  destinations: { label: string; count: number; pct: number }[]; // where the ads lead (platform/domain)
  monthly: MonthCount[]; // ads/month over a FIXED trailing window (0-filled, aligned)
  survival: { day: number; pct: number }[]; // % of ads still live at day 5/10/20/30
  decayTrend: DecayTrend; // launch cadence trending over time
  momDelta: number; // month-over-month change in ads launched (fraction, e.g. +0.38)
  momReliable: boolean; // false when the prior-month base is too thin to trust the %
  coldStart: boolean; // no prior baseline (nearly every ad reads as "new this week")
  refreshRate: number; // 0..1 — share of active ads that are fresh (<30d): creative churn
  refreshNote: string; // "{total} ads in window · {active} active now"
  offerDiscountPct: number; // 0..1 — share of ads whose copy mentions a discount/sale/offer
  offerUrgencyPct: number; // 0..1 — share mentioning urgency ("limited time", "last chance"…)
  // Adstock / carryover model  A_t = T_t + λ·A_{t-1}  (ad decay factor).
  decayLambda: number; // λ — per-day decay rate, = ln(2)/half-life (distinct per brand)
  adstockHalfLifeDays: number; // the observed median lifespan used as the half-life
  adstock: { label: string; a: number }[]; // modeled cumulative ad presence A_t per month
  influencerAds: number; // creator/UGC/influencer-style ads (Gemini vision + copy)
  regionalAds: number; // ads in a regional/vernacular language (Gemini + script)
  languages: { label: string; count: number }[]; // language mix, most-used first
  platforms: { label: string; count: number; pct: number }[]; // ad reach per publisher platform (overlapping — an ad can run on several)
}

export type Archetype = "Volume Scaler" | "Quality Tester" | "Steady Operator";

// Offer / promo copy signals (honest copy-frequency stats, not funnel claims).
const DISCOUNT_RE = /\b\d+%\s*off\b|\bdiscount\b|\bsale\b|\bcoupon\b|\bpromo\b|\boffer\b|\bdeal\b|\buse code\b|\bflat \d+\b/i;
const URGENCY_RE = /\blimited time\b|\bends (soon|today|tonight)\b|\bhurry\b|\blast chance\b|\bwhile stocks last\b|\bonly \d+ left\b|\bdon'?t miss\b|\bselling fast\b/i;

/**
 * Classify a brand's advertising style from the COMBINED signals — volume, churn
 * (refresh), longevity, and cadence trend — not a single threshold. This is the
 * fix for "three very different brands all tagged Volume Scaler": a high-refresh
 * brand whose ads still last long is a Quality Tester, not a Scaler.
 */
function classifyArchetype(m: { activeAds: number; refreshRate: number; medianDaysLive: number; newThisWeek: number; decayTrend: DecayTrend }): Archetype {
  const highVolume = m.activeAds >= 25 || m.newThisWeek >= 6;
  const highChurn = m.refreshRate >= 0.45;          // constantly cycling creatives
  const longLived = m.medianDaysLive >= 21;          // winners stick (3+ weeks)
  const cooling = m.decayTrend === "cooling";        // pulling cadence back
  const rising = m.decayTrend === "rising";

  // Winners that stick, without pure churn → Quality Tester.
  if (longLived && !highChurn) return "Quality Tester";
  // Scaling: high volume + churn + short-lived creatives, and NOT pulling back.
  if (highVolume && highChurn && !longLived && !cooling) return "Volume Scaler";
  // Pulling back, or low/flat cadence → Steady Operator (uses trend, not one metric).
  if ((cooling || m.newThisWeek <= 3) && !highVolume) return "Steady Operator";
  // Tie-breaks on the dominant combined signal + trend.
  if (highVolume && highChurn && rising) return "Volume Scaler";
  if (longLived) return "Quality Tester";
  if (highVolume && highChurn) return "Volume Scaler";
  return "Steady Operator";
}

// Native-script ranges → the regional language they signal (definitive when present).
const SCRIPT_LANGS: [RegExp, string][] = [
  [/[ऀ-ॿ]/, "Hindi"], [/[஀-௿]/, "Tamil"], [/[ఀ-౿]/, "Telugu"],
  [/[ಀ-೿]/, "Kannada"], [/[ഀ-ൿ]/, "Malayalam"], [/[ঀ-৿]/, "Bengali"],
  [/[઀-૿]/, "Gujarati"], [/[਀-੿]/, "Punjabi"], [/[଀-୿]/, "Odia"],
  [/[؀-ۿ]/, "Arabic/Urdu"],
];
function scriptLanguage(text: string): string | null {
  for (const [re, name] of SCRIPT_LANGS) if (re.test(text)) return name;
  return null;
}

// Publisher-platform raw value → display label (Meta exposes facebook/instagram/messenger/
// audience_network; also handle threads/whatsapp). Unknown values are title-cased.
const PLATFORM_DISPLAY: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", messenger: "Messenger",
  audience_network: "Audience Network", threads: "Threads", whatsapp: "WhatsApp",
};
export function platformLabel(p: string): string {
  const k = String(p ?? "").toLowerCase().trim().replace(/\s+/g, "_");
  if (!k) return "";
  return PLATFORM_DISPLAY[k] ?? (k[0].toUpperCase() + k.slice(1));
}

/** Per-brand publisher-platform reach from raw ads (overlapping — an ad can run on several). */
export function platformReach(ads: { publisherPlatforms?: string[] }[]): { label: string; count: number; pct: number }[] {
  const map = new Map<string, number>();
  for (const ad of ads) {
    const plats = [...new Set((ad.publisherPlatforms ?? []).map(platformLabel).filter(Boolean))];
    for (const p of plats) map.set(p, (map.get(p) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, pct: ads.length ? count / ads.length : 0 }));
}

/**
 * Language straight from the CAPTION — deterministic, no AI/audio pass. If the caption is
 * written in a native regional script we name that language; otherwise (Latin script,
 * including romanized Hindi/Hinglish) we call it English. Good enough for the language mix
 * and instant on every ad.
 */
function languageOf(ad: SocialPaidAd): { name: string; regional: boolean } {
  const text = `${ad.title ?? ""} ${ad.body ?? ""}`;
  const script = scriptLanguage(text);
  if (script) return { name: script, regional: true };
  return { name: "English", regional: false };
}


const PROVEN_DAYS = 21;
const WINDOW_MONTHS = 6; // fixed trailing window so MoM is comparable across brands
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Real creative format for an ad (persisted by the mapper; falls back to media type). */
function formatOf(ad: SocialPaidAd): "image" | "video" | "carousel" | "other" {
  const f = String((ad as Record<string, unknown>).format ?? "").toLowerCase();
  if (f === "image" || f === "video" || f === "carousel") return f;
  if (ad.videoUrl || String(ad.mediaType ?? "").toUpperCase() === "VIDEO") return "video";
  if (ad.imageUrl || String(ad.mediaType ?? "").toUpperCase() === "IMAGE") return "image";
  return "other";
}

/** Consolidate the many raw CTA values into a few meaningful buckets. */
export function ctaBucket(cta: string): string {
  const c = cta.replace(/_/g, " ").trim().toLowerCase();
  if (!c) return "No button";
  if (/learn more|view details|see details|see more|read more|watch more|get info/.test(c)) return "Learn More / Details";
  if (/instagram|visit profile|view profile|open link|visit page|visit site|view website|open website/.test(c)) return "Visit Instagram / Site";
  if (/shop now|buy now|order now|get offer|get deal|add to cart|purchase|\bshop\b/.test(c)) return "Buy Now / Shop";
  if (/sign up|subscribe|download|apply now|install|use app|register|\bjoin\b/.test(c)) return "Sign Up / Subscribe";
  if (/contact|send message|whats ?app|\bmessage\b|get quote|book now|call now|inquire/.test(c)) return "Message / Contact";
  return "Other";
}

/** Where an ad's click leads → a platform label or the destination domain. */
export function adDestination(ad: SocialPaidAd): string | null {
  const o = ad as Record<string, unknown>;
  // Prefer the real click destination; never the ad-library snapshot URL.
  let raw = String(o.destinationUrl ?? "").trim();
  if (!raw) {
    const link = String(ad.linkUrl ?? "").trim();
    if (link && !/\/ads\/library/i.test(link)) raw = link;
  }
  if (!raw) return null;
  let host = "";
  try { host = new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
  if (!host) return null;
  if (/instagram\.com/.test(host)) return "Instagram";
  if (/facebook\.com|fb\.com|fb\.me/.test(host)) return "Facebook";
  if (/wa\.me|whatsapp/.test(host)) return "WhatsApp";
  if (/apps\.apple\.com|itunes\.apple/.test(host)) return "App Store";
  if (/play\.google\.com/.test(host)) return "Play Store";
  if (/t\.me|telegram/.test(host)) return "Telegram";
  if (/(^|\.)youtu(\.be|be\.com)/.test(host)) return "YouTube";
  if (/(^|\.)amazon\./.test(host)) return "Amazon";
  return host; // the brand's own site, e.g. "nike.com"
}

function rawMetrics(brand: string, ads: SocialPaidAd[], isYou: boolean, now: Date): BrandAdMetrics {
  const withDays = ads.map(ad => ({ ad, days: computeRunningDays(ad, now) }));
  const daysList = withDays.map(x => x.days).filter((d): d is number => d != null);
  const active = ads.filter(ad => ad.isActive !== false && String(ad.status ?? "").toUpperCase() !== "INACTIVE").length;
  const newThisWeek = daysList.filter(d => d <= 7).length;

  const sortedByDays = withDays
    .filter(x => x.days != null)
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));

  const bars: AdBar[] = sortedByDays.slice(0, 10).map(x => ({ days: x.days ?? 0, proven: (x.days ?? 0) >= PROVEN_DAYS }));
  const topAds = sortedByDays.slice(0, 3).map(x => ({ id: x.ad.adId || "—", days: x.days ?? 0, url: x.ad.adSnapshotUrl ?? undefined }));

  // Formats × median lifespan
  const formats = { image: 0, video: 0, carousel: 0, other: 0 };
  const fmtDays: Record<string, number[]> = { image: [], video: [], carousel: [], other: [] };
  for (const x of withDays) {
    const f = formatOf(x.ad);
    formats[f]++;
    if (x.days != null) fmtDays[f].push(x.days);
  }
  const formatLifespans = (["video", "image", "carousel", "other"] as const)
    .filter(k => formats[k] > 0)
    .map(k => ({ key: k[0].toUpperCase() + k.slice(1), count: formats[k], medianDays: median(fmtDays[k]) }));

  // Nested format breakdown. Each VIDEO ad is split into influencer reel / UGC reel /
  // brand video via the influencer classifier's winning reason: a paid-partnership,
  // creator-page, person-advertiser, or #ad/partnership-copy signal ⇒ influencer reel;
  // a vision "creator / UGC look" ⇒ UGC reel; no creator signal ⇒ brand/product video.
  let videoInfluencer = 0, videoUgc = 0, videoBrand = 0;
  for (const x of withDays) {
    if (formatOf(x.ad) !== "video") continue;
    const v = classifyInfluencer(x.ad);
    if (!v.isInfluencer) videoBrand++;
    else if (/ugc look/i.test(v.reason)) videoUgc++;
    else videoInfluencer++;
  }
  const formatBreakdown = {
    video: formats.video,
    static: formats.image + formats.carousel + formats.other,
    staticImage: formats.image,
    staticCarousel: formats.carousel,
    staticOther: formats.other,
    videoInfluencer, videoUgc, videoBrand,
  };

  // CTAs — consolidated into buckets, as a SHARE of ads (%), with median lifespan.
  const ctaCount = new Map<string, number>();
  const ctaDays = new Map<string, number[]>();
  for (const x of withDays) {
    const bucket = ctaBucket(String(x.ad.cta ?? ""));
    if (bucket === "No button") continue; // don't clutter with button-less ads
    ctaCount.set(bucket, (ctaCount.get(bucket) ?? 0) + 1);
    if (x.days != null) { const arr = ctaDays.get(bucket) ?? []; arr.push(x.days); ctaDays.set(bucket, arr); }
  }
  const ctas = [...ctaCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([label, count]) => ({ label, count, pct: ads.length ? count / ads.length : 0, medianDays: median(ctaDays.get(label) ?? []) }));

  // Where the ads lead — platform/domain share (the ad's click destination).
  const destCount = new Map<string, number>();
  let destKnown = 0;
  for (const ad of ads) {
    const d = adDestination(ad);
    if (!d) continue;
    destKnown++;
    destCount.set(d, (destCount.get(d) ?? 0) + 1);
  }
  const destinations = [...destCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([label, count]) => ({ label, count, pct: destKnown ? count / destKnown : 0 }));

  // Refresh rate — share of ACTIVE ads that are fresh (<30d live): creative churn.
  const activeList = withDays.filter(x => x.ad.isActive !== false && String(x.ad.status ?? "").toUpperCase() !== "INACTIVE");
  const freshActive = activeList.filter(x => (x.days ?? 999) < 30).length;
  const refreshRate = activeList.length ? freshActive / activeList.length : 0;

  // Offer / promo signal in copy (frequency, not a funnel claim).
  let disc = 0, urg = 0;
  for (const ad of ads) {
    const t = `${ad.title ?? ""} ${ad.body ?? ""}`;
    if (DISCOUNT_RE.test(t)) disc++;
    if (URGENCY_RE.test(t)) urg++;
  }
  const offerDiscountPct = ads.length ? disc / ads.length : 0;
  const offerUrgencyPct = ads.length ? urg / ads.length : 0;

  // Monthly launch cadence (ads-per-month by start date) → the decay / month-ads read.
  // FIXED observation window: the SAME trailing WINDOW_MONTHS calendar months for
  // every brand, 0-filled, so charts align and MoM % is comparable across the set
  // (rather than each brand starting at its own earliest scrape date).
  const monthMap = new Map<string, number>();
  for (const ad of ads) {
    if (!ad.startTime) continue;
    const d = new Date(ad.startTime);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    monthMap.set(key, (monthMap.get(key) ?? 0) + 1);
  }
  const monthly: MonthCount[] = [];
  for (let k = WINDOW_MONTHS - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    monthly.push({ month: key, label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, count: monthMap.get(key) ?? 0 });
  }

  // Survival curve — % of ads still live at day 5/10/20/30 (shape of how ads get
  // killed, not just volume). Uses each ad's days-live; older/inactive ads count.
  const survival = [5, 10, 20, 30].map(day => ({
    day,
    pct: daysList.length ? daysList.filter(d => d >= day).length / daysList.length : 0,
  }));

  // Decay trend — recent half of the monthly series vs the earlier half.
  let decayTrend: DecayTrend = "flat";
  if (monthly.length >= 2) {
    const half = Math.floor(monthly.length / 2);
    const earlier = monthly.slice(0, half).reduce((n, x) => n + x.count, 0) / Math.max(1, half);
    const recent = monthly.slice(monthly.length - half).reduce((n, x) => n + x.count, 0) / Math.max(1, half);
    if (recent >= earlier * 1.2) decayTrend = "rising";
    else if (recent <= earlier * 0.8) decayTrend = "cooling";
  }

  // Month-over-month change in ads launched (last month vs the one before).
  // MoM is only reliable with a real prior-month base and enough history in the
  // window — otherwise it's cold-start noise (1 → 12 reading as +1100%). When the
  // base is thin, momReliable=false and displays show "baseline" instead of a %.
  const monthsWithAds = monthly.filter(m => m.count > 0).length;
  let momDelta = 0;
  let momReliable = false;
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1].count;
    const prev = monthly[monthly.length - 2].count;
    momDelta = prev > 0 ? (last - prev) / prev : 0;
    momReliable = prev >= 3 && monthsWithAds >= 3;
  }

  // Cold-start / no-baseline signature: on a first scrape every active ad can read
  // as "new this week" (e.g. 113/113) because there's no prior week to compare —
  // this is a data-baseline artifact, not a real cadence spike. Flag it so displays
  // don't present "N new this week" + the derived MoM as two dramatic findings.
  const activeForNew = ads.filter(ad => ad.isActive !== false && String(ad.status ?? "").toUpperCase() !== "INACTIVE").length || ads.length;
  const coldStart = newThisWeek >= 15 && newThisWeek >= activeForNew * 0.95;

  // Influencer + regional-language classification, plus publisher-platform reach.
  let influencerAds = 0, regionalAds = 0;
  const langMap = new Map<string, number>();
  const platMap = new Map<string, number>();
  for (const ad of ads) {
    if (isInfluencerAd(ad)) influencerAds++;
    const { name, regional } = languageOf(ad);
    if (regional) regionalAds++;
    langMap.set(name, (langMap.get(name) ?? 0) + 1);
    // publisherPlatforms is a list per ad (facebook/instagram/messenger/audience_network);
    // count each platform an ad runs on (membership overlaps, so shares can exceed 100%).
    const plats = [...new Set((ad.publisherPlatforms ?? []).map(platformLabel).filter(Boolean))];
    for (const p of plats) platMap.set(p, (platMap.get(p) ?? 0) + 1);
  }
  const languages = [...langMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, count]) => ({ label, count }));
  const platforms = [...platMap.entries()].sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, pct: ads.length ? count / ads.length : 0 }));

  // ── Ad-decay model:  half-life = ln(2)/λ  ──────────────────────────────────
  // The brand's HALF-LIFE is its observed median ad lifespan (days). The decay
  // factor λ is the per-day decay RATE consistent with that half-life: λ =
  // ln(2)/half-life. This is a real per-brand value (three different half-lives →
  // three different λ) — the earlier version floored λ at 0.1, which collapsed
  // every short-lived brand to a hardcoded-looking 0.10. Meta exposes no spend, so
  // longevity is the honest proxy for decay; λ is a rate, not fit to response.
  const medianDays = median(daysList);
  const halfLifeDays = Math.max(1, medianDays || 14);
  const decayLambda = Math.log(2) / halfLifeDays; // per-day decay rate
  // Adstock presence A_t = T_t + carry·A_{t-1}, carry = fraction retained per month
  // = e^(-λ·30) = 0.5^(30/half-life). (Distinct from the displayed daily λ.)
  const monthlyCarry = Math.pow(0.5, 30 / halfLifeDays);
  let prevA = 0;
  const adstock = monthly.map(mm => {
    const a = mm.count + monthlyCarry * prevA;
    prevA = a;
    return { label: mm.label, a: Math.round(a * 10) / 10 };
  });

  const activeCount = active || ads.length;
  const archetype = classifyArchetype({ activeAds: activeCount, refreshRate, medianDaysLive: medianDays, newThisWeek, decayTrend });

  // Ad VERSIONS: Meta's "~N results" header counts each collated variant, while the
  // library list (and our dataset) shows grouped cards. Summing the collation sizes
  // reconciles our total with the header number a human sees on Meta.
  const totalVersions = ads.reduce((s, ad) => s + Math.max(1, ad.collationCount ?? 1), 0);

  return {
    brand, isYou,
    totalAds: ads.length,
    activeAds: activeCount,
    totalVersions,
    newThisWeek,
    medianDaysLive: medianDays,
    pressureIndex: 0, rank: 0, bars, read: "", topAds,
    archetype, formats, formatBreakdown, formatLifespans, ctas, destinations, monthly, survival, decayTrend, momDelta, momReliable, coldStart,
    refreshRate, refreshNote: `${ads.length} ads in window · ${activeCount} active now`,
    offerDiscountPct, offerUrgencyPct,
    decayLambda, adstockHalfLifeDays: halfLifeDays, adstock,
    influencerAds, regionalAds, languages, platforms,
  };
}

/** Min-max normalize a metric across the set → 0..1 (flat set → 0.5). */
function norm(values: number[], v: number): number {
  const min = Math.min(...values), max = Math.max(...values);
  if (max === min) return 0.5;
  return (v - min) / (max - min);
}

function brandRead(m: BrandAdMetrics, set: BrandAdMetrics[]): string {
  if (m.isYou) {
    const ahead = set.filter(b => !b.isYou && b.pressureIndex > m.pressureIndex).length;
    return ahead
      ? `${ahead} competitor${ahead > 1 ? "s are" : " is"} applying more media pressure than you right now — ${m.activeAds} active ads, ${m.newThisWeek} launched this week.`
      : `You lead the set on media pressure — ${m.activeAds} active ads, ${m.newThisWeek} launched this week.`;
  }
  if (m.rank === 1) return `Highest-pressure brand in your set — ${m.activeAds} active ads and ${m.newThisWeek} launched this week. Watch weekly, not monthly.`;
  const maxLong = Math.max(...set.map(b => b.medianDaysLive));
  if (m.medianDaysLive === maxLong && m.medianDaysLive >= PROVEN_DAYS) return `Longest staying power in the set — a median of ${m.medianDaysLive} days live points to a high hit rate over raw volume.`;
  if (m.rank === set.length) return `Lowest pressure index in the set — low near-term threat, worth a monthly check rather than a weekly one.`;
  return `Steady cadence — ${m.activeAds} active ads, ${m.newThisWeek} new this week, ${m.medianDaysLive}-day median lifespan.`;
}

export interface AdVerdict {
  kind: "Gap" | "Longevity" | "Opportunity";
  brand?: string;
  headline: string;
  refs: { label: string; url?: string }[];
}

export interface AdIntelResult {
  brands: BrandAdMetrics[]; // ranked, incl. "You"
  you?: BrandAdMetrics;
  verdicts: AdVerdict[];
  hasData: boolean;
}

export interface BrandAds { brand: string; ads: SocialPaidAd[] }

/** Build the full competitive ad-intelligence read from you + competitors. */
export function buildAdIntel(
  you: BrandAds | null,
  competitors: BrandAds[],
  now = new Date(),
): AdIntelResult {
  const set: BrandAdMetrics[] = [];
  if (you && you.ads.length) set.push(rawMetrics(you.brand || "You", you.ads, true, now));
  for (const c of competitors) if (c.ads.length) set.push(rawMetrics(c.brand || "Competitor", c.ads, false, now));

  if (!set.length) return { brands: [], verdicts: [], hasData: false };

  // Pressure index = weighted, cross-set-normalized composite (0-100) over the
  // three real signals only: cadence, longevity, volume.
  const cadence = set.map(m => m.newThisWeek);
  const longevity = set.map(m => m.medianDaysLive);
  const volume = set.map(m => m.activeAds);
  for (const m of set) {
    const score =
      0.40 * norm(cadence, m.newThisWeek) +
      0.35 * norm(longevity, m.medianDaysLive) +
      0.25 * norm(volume, m.activeAds);
    m.pressureIndex = Math.round(score * 100);
  }

  set.sort((a, b) => b.pressureIndex - a.pressureIndex);
  set.forEach((m, i) => { m.rank = i + 1; });
  for (const m of set) m.read = brandRead(m, set);

  const youM = set.find(m => m.isYou);
  const comps = set.filter(m => !m.isYou);
  const verdicts: AdVerdict[] = [];

  // Gap — the highest-volume/cadence competitor vs you.
  const topActive = [...comps].sort((a, b) => (b.activeAds + b.newThisWeek) - (a.activeAds + a.newThisWeek))[0];
  if (topActive && youM && (topActive.activeAds > youM.activeAds || topActive.newThisWeek > youM.newThisWeek)) {
    verdicts.push({
      kind: "Gap", brand: topActive.brand,
      headline: `${topActive.brand} is running ${topActive.activeAds} active ads (${topActive.newThisWeek} new this week) — you're at ${youM.activeAds} active, ${youM.newThisWeek} new. They're out-shipping you on volume and cadence.`,
      refs: topActive.topAds.map(a => ({ label: `ad ${a.id.slice(0, 10)} · ${a.days}d`, url: a.url })),
    });
  }

  // Longevity — the brand whose ads survive longest (the closest thing to a win rate).
  const topLong = [...comps].sort((a, b) => b.medianDaysLive - a.medianDaysLive)[0];
  if (topLong && topLong.medianDaysLive >= PROVEN_DAYS && (!youM || topLong.medianDaysLive > youM.medianDaysLive)) {
    verdicts.push({
      kind: "Longevity", brand: topLong.brand,
      headline: `${topLong.brand}'s ads survive a median of ${topLong.medianDaysLive} days — the strongest staying power in the set. Long-runners are the closest public signal of what's working.`,
      refs: topLong.topAds.slice(0, 2).map(a => ({ label: `ad ${a.id.slice(0, 10)} · ${a.days}d live`, url: a.url })),
    });
  }

  // Opportunity — the genuinely LOWEST-pressure competitor(s), by rank. (Fixes the
  // bug where a rank-#2 brand got labelled "lowest threat".) A second laggard is
  // only added when there are 3+ competitors and it's also near the bottom.
  const byPressureAsc = [...comps].sort((a, b) => a.pressureIndex - b.pressureIndex || b.rank - a.rank);
  const lowest = byPressureAsc[0];
  if (lowest && lowest.rank === Math.max(...set.map(b => b.rank))) {
    const laggards = [lowest];
    const second = byPressureAsc[1];
    if (second && comps.length >= 3 && second.pressureIndex <= lowest.pressureIndex + 10) laggards.push(second);
    verdicts.push({
      kind: "Opportunity",
      headline: `${laggards.map(l => l.brand).join(" and ")} ${laggards.length > 1 ? "sit" : "sits"} at the bottom of the set (pressure ${laggards.map(l => l.pressureIndex).join(", ")}) — lowest near-term threat, safe to deprioritize this cycle.`,
      refs: laggards.map(l => ({ label: `${l.brand} · rank ${String(l.rank).padStart(2, "0")} · pressure ${l.pressureIndex}` })),
    });
  }

  return { brands: set, you: youM, verdicts, hasData: true };
}
