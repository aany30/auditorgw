import type { SocialPaidAd } from "@/lib/media-analyser/types";
import type { BrandAds } from "@/lib/media-analyser/paid-ad-intel";
import { adDestination, ctaBucket, platformReach, platformLabel } from "@/lib/media-analyser/paid-ad-intel";
import { computeRunningDays } from "@/lib/media-analyser/paid-ad-buckets";
import { classifyInfluencer, adFormatKey, adLanguageLabel } from "@/lib/media-analyser/paid-ad-stats";

/**
 * Competitor Analysis Report — one competitor brand's Meta Ad Library, laid out to
 * match the "Total Ads" report template. Every panel is derived ONLY from scraped
 * Ad Library fields (no spend, no audience targeting — that isn't published for
 * commercial ads). Audience A/B is intentionally absent: Meta only exposes
 * demographic/targeting breakdowns for political/social-issue ads.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MARKET_RE = /amazon|flipkart|myntra|nykaa|croma|ajio|meesho|tatacliq|jiomart|snapdeal|shopee|lazada|\bnoon\b|reliancedigital|1mg|pharmeasy|walmart|target\.com|ebay|etsy|bigbasket|blinkit|zepto/i;
const SOCIAL_RE = /instagram|facebook|youtube|tiktok|\bfb\b/i;
const OTHER_RE = /whatsapp|telegram|app store|play store/i;
// "25% off", "flat 50%", "upto 60% off", "save 30%"
const DISCOUNT_PCT_RE = /(\d{1,3})\s*%\s*(?:off|discount|deal)|(?:flat|upto|up\s*to|save|extra|get)\s*(?:rs\.?\s*\d+\s*&\s*)?(\d{1,3})\s*%/gi;
const LIMITED_RE = /\blimited time\b|\bends (soon|today|tonight)\b|\bhurry\b|\blast chance\b|\bwhile stocks last\b|\bonly \d+ left\b|\btoday only\b|\blimited (period|offer|stock)\b/i;

// Named festive / sale campaigns detected in ad copy — brand-specific banners + the generic
// Indian retail calendar. First list is checked against every ad's copy; a brand "owns" an
// event if any of its ads mention it. "Live" if any matching ad is still active.
const FESTIVE_RES: [RegExp, string][] = [
  [/\bgreat freedom sale\b/i, "Great Freedom Sale"],
  [/\bprime day\b/i, "Prime Day"],
  [/\bgreat indian festival\b/i, "Great Indian Festival"],
  [/\bgrand gadget days?\b/i, "Grand Gadget Days"],
  [/\bbig billion days?\b|\bthe big billion\b|\bbbd\b/i, "Big Billion Days"],
  [/\bflipkart minutes\b/i, "Flipkart Minutes"],
  [/\bnational technology day\b/i, "National Technology Day"],
  [/\brakhi\b|\braksha[\s-]?bandhan\b/i, "Rakhi"],
  [/\bdiwali\b|\bdeepavali\b|\bfestival of lights\b/i, "Diwali"],
  [/\bholi\b/i, "Holi"],
  [/\bindependence day\b|\bazadi\b/i, "Independence Day"],
  [/\brepublic day\b/i, "Republic Day"],
  [/\bnavratri\b|\bnavaratri\b/i, "Navratri"],
  [/\bdussehra\b|\bdasara\b/i, "Dussehra"],
  [/\bnew year\b/i, "New Year"],
  [/\bvalentine'?s?\b/i, "Valentine's Day"],
  [/\bchristmas\b|\bxmas\b/i, "Christmas"],
  [/\beid\b/i, "Eid"],
  [/\bonam\b/i, "Onam"],
  [/\bpongal\b/i, "Pongal"],
  [/\bmonsoon sale\b/i, "Monsoon Sale"],
  [/\bend of season sale\b|\beoss\b/i, "End of Season Sale"],
];

// "under ₹499", "starting at ₹300", "₹200 only", "just ₹99" → a low-price psychological anchor.
const PRICE_ANCHOR_RE = /(?:\bunder\b|\bbelow\b|\bstarting(?:\s+(?:at|from))?\b|\bfrom\b|\bjust\b|\bonly\b|@|\bat\b)\s*(?:₹|rs\.?|inr)\s*(\d{2,5})|(?:₹|rs\.?|inr)\s*(\d{2,5})\s*(?:only|onwards?)\b/gi;
// Contiguous emoji runs (a "group") — emoji + ZWJ sequences + variation selectors.
const EMOJI_RUN_RE = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)+/gu;

export type ReportChannel = "Website" | "Social" | "Marketplace" | "Other";

function channelOf(ad: SocialPaidAd): ReportChannel {
  const dest = adDestination(ad);
  if (!dest) return "Other";
  if (SOCIAL_RE.test(dest)) return "Social";
  if (OTHER_RE.test(dest)) return "Other";
  if (MARKET_RE.test(dest)) return "Marketplace";
  return "Website"; // a resolvable brand-owned domain
}

/** Mutually-exclusive creative bucket, precedence Collab > Influencer > UGC > Product. */
function contentBucket(ad: SocialPaidAd): "Collab" | "Influencer" | "UGC" | "Product" {
  const o = ad as Record<string, unknown>;
  const label = String(o.partnershipLabel ?? "");
  if (o.brandedContent === true || /partnership|collaboration|collab/i.test(label)) return "Collab";
  const v = classifyInfluencer(ad);
  if (v.isInfluencer) return /ugc look/i.test(v.reason) ? "UGC" : "Influencer";
  return "Product";
}

// Real discounts almost never exceed 90%. A captured "%" above this is overwhelmingly a
// product spec the regex misread as an offer — e.g. "100% charge", "100% cotton",
// "100% natural" — so we reject it. This makes max/min/avg fall back to the nearest
// PLAUSIBLE discount instead of signalling a bogus 100% deal.
const MAX_PLAUSIBLE_DISCOUNT = 90;

/** Largest plausible discount % (≤90) mentioned in an ad's copy, or null. */
export function extractDiscountPct(ad: SocialPaidAd): number | null {
  const text = `${ad.title ?? ""} ${ad.body ?? ""}`;
  let max: number | null = null;
  for (const m of text.matchAll(DISCOUNT_PCT_RE)) {
    const n = Number(m[1] ?? m[2]);
    if (Number.isFinite(n) && n > 0 && n <= MAX_PLAUSIBLE_DISCOUNT) max = Math.max(max ?? 0, n);
  }
  return max;
}

// Offer TYPES beyond a raw % — the promo *mechanics* a brand leans on (no-cost EMI,
// card/bank offers, cashback, flat ₹ off, free shipping, BOGO, coupon codes).
const OFFER_TYPE_RES: [RegExp, string][] = [
  [/\b(?:no|zero)[-\s]?cost\s?emi\b/i, "No-cost EMI"],
  [/\bcashback\b|\bcash\s?back\b/i, "Cashback"],
  [/\b(?:credit|debit)\s?card\b|\bcard offer\b|\bbank offer\b|\b(?:hdfc|icici|axis|sbi|kotak|amex|visa|mastercard|rupay|paytm|upi)\b/i, "Card / bank offer"],
  [/\bemi\b/i, "EMI"],
  [/\bflat\s*(?:₹|rs\.?|inr)?\s?\d+/i, "Flat ₹ off"],
  [/\bfree\s?(?:delivery|shipping)\b/i, "Free shipping"],
  [/\bbuy\s?\d?\s?get\b|\bbogo\b|\bbuy one get one\b/i, "Buy X get Y"],
  [/\buse code\b|\bcoupon\b|\bpromo code\b/i, "Coupon code"],
];

/** Which offer mechanics an ad's copy mentions (an ad can carry several). */
function detectOfferTypes(ad: SocialPaidAd): string[] {
  const text = `${ad.title ?? ""} ${ad.body ?? ""}`;
  const found = new Set<string>();
  for (const [re, label] of OFFER_TYPE_RES) if (re.test(text)) found.add(label);
  if (found.has("No-cost EMI")) found.delete("EMI"); // no-cost EMI supersedes generic EMI
  if (extractDiscountPct(ad) != null) found.add("% discount");
  return [...found];
}

// Marketplace product categories — keyword-matched from ad copy/hashtags. First match wins
// (one category per ad → a clean stacked series). Order = precedence.
const CATEGORY_RES: [RegExp, string][] = [
  [/\bfashion\b|\bapparel\b|\bclothing\b|\bkurt[ai]\b|\bsar(ee|i)\b|\blehenga\b|\bdress(es)?\b|\bfootwear\b|\bshoes?\b|\bsneakers?\b|\bwatch(es)?\b|\bjewell?ery\b|\bhandbags?\b|\bsunglass|\boutfit\b|\bethnic\b|\bwestern wear\b|\bt-?shirts?\b|\bjeans\b|\btops?\b|\bfashionfinds?\b/i, "Fashion"],
  [/\bbeauty\b|\bskin ?care\b|\bmake ?up\b|\bcosmetic\b|\bgrooming\b|\bfragrance\b|\bperfume\b|\bhair ?care\b|\blipstick\b|\bserum\b|\bmoisturi|\bhydration\b/i, "Beauty & Grooming"],
  [/\bhome\b|\bdecor\b|\bfurnishing\b|\bfurniture\b|\bkitchen\b|\bcookware\b|\bbed ?(sheet|ding)?\b|\bcurtains?\b|\bhousehold\b|\binterior\b|\bhome improvement\b/i, "Home & Living"],
  [/\bappliances?\b|\bwashing machine\b|\brefrigerator\b|\bfridge\b|\bmicrowave\b|\bair ?conditioner\b|\bmixer\b|\bgrinder\b|\bgeyser\b|\bchimney\b/i, "Appliances"],
  [/\belectronics?\b|\bsmart ?phones?\b|\bmobiles?\b|\blaptops?\b|\bhead ?phones?\b|\bear ?(buds?|phones?)\b|\btvs?\b|\btelevisions?\b|\bcameras?\b|\bgadgets?\b|\btablets?\b|\bspeakers?\b|\bpower ?banks?\b/i, "Electronics"],
  [/\bgrocery\b|\bgroceries\b|\bsupermarket\b|\bsupermart\b|\bkirana\b|\bstaples\b|\bhousehold essentials\b|\borganic\b|\bfruits?\b|\bvegetables?\b|\bveggies\b|\bproduce\b|\bdairy\b|\bsnacks?\b|\bpulses\b|\bfarm.?fresh\b|\bfresh (?:produce|fruits?|vegetables?)\b/i, "Grocery"],
  [/\bbab(y|ies)\b|\btoys?\b|\bkids?\b|\bdiapers?\b/i, "Baby & Toys"],
  [/\bsports?\b|\bfitness\b|\bgym\b|\byoga\b|\boutdoor\b/i, "Sports & Fitness"],
];

/** Best-guess marketplace product category for an ad (first keyword match), else "Other". */
function detectCategory(ad: SocialPaidAd): string {
  const text = `${ad.title ?? ""} ${ad.body ?? ""}`;
  for (const [re, label] of CATEGORY_RES) if (re.test(text)) return label;
  return "Other";
}

/**
 * Public Ad Library URL for an ad. The scraped `adSnapshotUrl` is Meta's internal
 * `/ads/archive/render_ad/?id=…` endpoint (needs an access token — doesn't open as a
 * page), so prefer the public `/ads/library/?id=<archiveId>` form built from the ad id.
 */
function adLibraryLink(ad: SocialPaidAd): string | undefined {
  const id = String(ad.adId ?? "").trim();
  if (id && id !== "—") return `https://www.facebook.com/ads/library/?id=${id}`;
  const snap = ad.adSnapshotUrl ?? undefined;
  return snap && !/\/render_ad\//.test(snap) ? snap : undefined;
}

/** Best-effort influencer/creator name for an ad (IG actor, then the partnership byline). */
function influencerName(ad: SocialPaidAd): string {
  const o = ad as Record<string, unknown>;
  const actor = String(o.igActor ?? "").trim();
  if (actor) return actor;
  const label = String(o.partnershipLabel ?? "").trim();
  const m = label.match(/(?:partnership|collaboration|collab)\s+with\s+(.+)$/i) || label.match(/with\s+(.+)$/i);
  if (m) return m[1].trim();
  if (label && !/^paid partnership$/i.test(label)) return label;
  return "—";
}

/** The influencer's handle — Meta's whitelisted igActor (@-stripped) when present, else the
 *  creator name parsed from the "with <brand>" byline. Meta only exposes igActor for
 *  branded-content-whitelisted ads, so byline-detected collabs fall back to the name. */
function influencerHandle(ad: SocialPaidAd): string {
  const raw = String((ad as Record<string, unknown>).igActor ?? "").trim().replace(/^@+/, "");
  return raw || influencerName(ad).replace(/^—$/, "");
}

export interface CompetitorReport {
  brand: string;
  // header stats
  total: number; active: number; inactive: number; newPerWeek: number; newThisMonth: number; refreshPct: number;
  windowStart: string; windowEnd: string;
  versionsOnMeta: number;                 // ≈ total creative versions (sum of collationCount)
  earliestAdMonth: string | null;         // oldest ad in the library (for the history footnote)
  // ── "Signals you wouldn't have seen" (mined from raw copy / dates) ──
  festiveEvents: { name: string; count: number; live: boolean; year: number | null }[];
  launchCadence: number[];                // Mon..Sun — fraction of dated ads started that weekday
  churnBuckets: { label: string; pct: number }[];   // lifespan distribution (0-3d … 60d+)
  concentration: { concepts: number; variantsPerConcept: number; topConceptPct: number };
  emojiPerAd: number;                     // avg emoji groups per ad (full body copy)
  priceAnchors: { anchor: string; count: number }[]; // "under ₹X" hooks, most-used first
  // panels
  adsPerMonth: { label: string; count: number }[];       // ad decay · ads/month (12 mo)
  formats: { video: number; static: number; carousel: number; videoPct: number; staticPct: number; carouselPct: number; videoMedianDays: number; staticMedianDays: number };
  contentFormatsVideo: { label: string; count: number }[]; // Influencer / UGC / Product / Collab
  contentFormatsImage: { label: string; count: number }[]; // Influencer / Carousel / Product / Collab
  ctaMix: { label: string; count: number; pct: number; medianDays: number }[];
  destinations: { label: ReportChannel; count: number; pct: number }[];
  destinationsDetailed: { label: string; count: number; pct: number }[]; // actual resolved destinations
  platforms: { label: string; count: number; pct: number }[]; // where the ads run (Facebook/Instagram/Messenger/Audience Network — overlapping)

  advertisers: { label: string; count: number; pct: number }[];
  offerSignal: {
    mentionDiscountPct: number; limitedOfferPct: number; maxDiscountPct: number | null;
    avgDiscountPct: number | null; minDiscountPct: number | null; mostRepeatedDiscountPct: number | null;
    maxDiscountUrl: string | null; minDiscountUrl: string | null;
    limitedOfferCount: number; maxLimitedOfferDays: number | null; mostActiveLimitedMonth: string;
    // Promo MECHANICS mix (overlapping): no-cost EMI, card/bank offer, cashback, % discount, flat ₹ off, free shipping…
    offerTypes: { label: string; count: number; pct: number }[];
  };
  discountHistory: { adId: string; pct: number; start: string | null; end: string | null; url?: string }[];
  regionalAds: { label: string; count: number }[];
  // Ad Runway — monthly series for the 7 dropdown metrics (per this brand).
  runway: {
    months: string[];
    count: number[];
    brandOwn: number[]; partner: number[];
    video: number[]; staticc: number[]; carousel: number[];
    website: number[]; marketplace: number[]; others: number[];
    english: number[]; vernacular: number[];
    native: number[]; influencer: number[];
    ctaBuckets: string[]; ctas: Record<string, number[]>;
    // Actual resolved destinations (Play Store / App Store / Amazon / brand domain …),
    // not the hardcoded Website/Marketplace/Others buckets.
    destBuckets: string[]; dests: Record<string, number[]>;
  };
  survival: { day: number; pct: number }[];              // 5 / 10 / 30 / 60 / 90
  // Marketplace category mix over time — Fashion / Home & Living / Electronics / … per month.
  // Meaningful only for multi-category advertisers (marketplaces); the UI shows it when ≥2
  // real (non-"Other") categories are present.
  categoryTrend: {
    categories: string[];  // categories present, ordered by total desc
    years: number[];       // years with data, most recent first
    cells: { year: number; month: number; category: string; count: number }[]; // month 0-11
  };
  // Influencer ads — share of the brand's ads that are creator-led, plus a per-ad list.
  influencerPct: number; influencerCount: number;
  influencerAds: { adId: string; start: string | null; influencerName: string; igHandle: string; format: string; cta: string | null; channel: ReportChannel; language: string; discountPct: number | null; days: number | null; url?: string }[];
  adsTable: { adId: string; format: string; cta: string | null; channel: ReportChannel; language: string; influencer: boolean; start: string | null; days: number | null; active: boolean; discountPct: number | null; offerTypes: string; platforms: string; url?: string }[];
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const monthLabel = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;

export function buildCompetitorReport(brand: BrandAds, now = new Date()): CompetitorReport | null {
  const ads = brand.ads;
  if (!ads.length) return null;

  const rows = ads.map(ad => ({
    ad,
    days: computeRunningDays(ad, now),
    fmt: adFormatKey(ad),
    active: ad.isActive !== false && String((ad as Record<string, unknown>).status ?? "").toUpperCase() !== "INACTIVE",
    startMs: ad.startTime ? new Date(ad.startTime).getTime() : NaN,
  }));
  const daysList = rows.map(r => r.days).filter((d): d is number => d != null);

  const total = ads.length;
  const active = rows.filter(r => r.active).length;
  const newPerWeek = daysList.filter(d => d <= 7).length;
  const newThisMonth = daysList.filter(d => d <= 30).length;
  // Refresh = share of ALL ads that are fresh (started in the last 30 days) = fresh ads / total.
  const refreshPct = total ? newThisMonth / total : 0;

  // window bounds
  const validMs = rows.map(r => r.startMs).filter(ms => !Number.isNaN(ms)).sort((a, b) => a - b);
  const windowStart = validMs.length ? monthLabel(new Date(validMs[0])) : "";
  const windowEnd = validMs.length ? monthLabel(new Date(validMs[validMs.length - 1])) : "";

  // ── ads per month (last 12) ──
  const monthCount = new Map<string, number>();
  for (const r of rows) if (!Number.isNaN(r.startMs)) { const k = monthKey(new Date(r.startMs)); monthCount.set(k, (monthCount.get(k) ?? 0) + 1); }
  const adsPerMonth: { label: string; count: number }[] = [];
  const runway: CompetitorReport["runway"] = {
    months: [], count: [], brandOwn: [], partner: [], video: [], staticc: [], carousel: [],
    website: [], marketplace: [], others: [], english: [], vernacular: [],
    native: [], influencer: [], ctaBuckets: [], ctas: {}, destBuckets: [], dests: {},
  };
  const isPartnerAd = (ad: SocialPaidAd) => ad.brandedContent === true || !!(ad.partnershipLabel && String(ad.partnershipLabel).trim());
  for (let k = 11; k >= 0; k--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    const key = monthKey(d);
    const lbl = MONTHS[d.getUTCMonth()];
    adsPerMonth.push({ label: lbl, count: monthCount.get(key) ?? 0 });
    const inMonth = rows.filter(r => !Number.isNaN(r.startMs) && monthKey(new Date(r.startMs)) === key);
    const mi = runway.months.length;
    runway.months.push(lbl);
    runway.count.push(inMonth.length);
    let partner = 0, video = 0, carousel = 0, website = 0, marketplace = 0, others = 0, english = 0, influencer = 0;
    for (const r of inMonth) {
      if (isPartnerAd(r.ad)) partner++;
      if (r.fmt === "video") video++; else if (r.fmt === "carousel") carousel++;
      const ch = channelOf(r.ad);
      if (ch === "Website") website++; else if (ch === "Marketplace") marketplace++; else others++;
      const dl = adDestination(r.ad);
      if (dl) (runway.dests[dl] ??= Array(12).fill(0))[mi]++;
      if (adLanguageLabel(r.ad).toLowerCase() === "english") english++;
      if (classifyInfluencer(r.ad).isInfluencer) influencer++;
      const cb = ctaBucket(r.ad.cta ?? "");
      if (cb !== "No button") { (runway.ctas[cb] ??= Array(12).fill(0))[mi]++; }
    }
    runway.partner.push(partner); runway.brandOwn.push(inMonth.length - partner);
    runway.video.push(video); runway.carousel.push(carousel); runway.staticc.push(inMonth.length - video - carousel);
    runway.website.push(website); runway.marketplace.push(marketplace); runway.others.push(others);
    runway.english.push(english); runway.vernacular.push(inMonth.length - english);
    runway.influencer.push(influencer); runway.native.push(inMonth.length - influencer);
  }
  runway.ctaBuckets = Object.entries(runway.ctas)
    .sort((a, b) => b[1].reduce((s, n) => s + n, 0) - a[1].reduce((s, n) => s + n, 0))
    .slice(0, 4).map(([k]) => k);
  runway.destBuckets = Object.entries(runway.dests)
    .sort((a, b) => b[1].reduce((s, n) => s + n, 0) - a[1].reduce((s, n) => s + n, 0))
    .slice(0, 6).map(([k]) => k);

  // ── formats × lifespan (video / static / carousel — a "static video", i.e. an image run
  //    as a reel, classifies as static, not video) ──
  const videoRows = rows.filter(r => r.fmt === "video");
  const carouselRows = rows.filter(r => r.fmt === "carousel");
  const staticRows = rows.filter(r => r.fmt !== "video" && r.fmt !== "carousel");
  const formats = {
    video: videoRows.length,
    static: staticRows.length,
    carousel: carouselRows.length,
    videoPct: total ? videoRows.length / total : 0,
    staticPct: total ? staticRows.length / total : 0,
    carouselPct: total ? carouselRows.length / total : 0,
    videoMedianDays: median(videoRows.map(r => r.days).filter((d): d is number => d != null)),
    staticMedianDays: median(staticRows.map(r => r.days).filter((d): d is number => d != null)),
  };

  // ── content formats (video / image) ──
  const vb = { Influencer: 0, UGC: 0, Product: 0, Collab: 0 };
  for (const r of videoRows) vb[contentBucket(r.ad)]++;
  const contentFormatsVideo = [
    { label: "Influencer", count: vb.Influencer }, { label: "UGC", count: vb.UGC },
    { label: "Product video", count: vb.Product }, { label: "Collab", count: vb.Collab },
  ].filter(x => x.count > 0);

  // static: Collab > Carousel(format) > Influencer > Product
  const ib = { Influencer: 0, Carousel: 0, Product: 0, Collab: 0 };
  for (const r of staticRows) {
    const b = contentBucket(r.ad);
    if (b === "Collab") ib.Collab++;
    else if (r.fmt === "carousel") ib.Carousel++;
    else if (b === "Influencer" || b === "UGC") ib.Influencer++;
    else ib.Product++;
  }
  const contentFormatsImage = [
    { label: "Influencer", count: ib.Influencer }, { label: "Carousel", count: ib.Carousel },
    { label: "Product static", count: ib.Product }, { label: "Collab", count: ib.Collab },
  ].filter(x => x.count > 0);

  // ── CTA mix ──
  const ctaCount = new Map<string, number>();
  const ctaDays = new Map<string, number[]>();
  for (const r of rows) {
    const raw = String((r.ad as Record<string, unknown>).cta ?? "").trim();
    if (!raw) continue;
    const label = raw.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    ctaCount.set(label, (ctaCount.get(label) ?? 0) + 1);
    if (r.days != null) ctaDays.set(label, [...(ctaDays.get(label) ?? []), r.days]);
  }
  const ctaMix = [...ctaCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([label, count]) => ({ label, count, pct: total ? count / total : 0, medianDays: median(ctaDays.get(label) ?? []) }));

  // ── destinations (Website / Social / Marketplace / Other) ──
  const chanCount = { Website: 0, Social: 0, Marketplace: 0, Other: 0 } as Record<ReportChannel, number>;
  let chanKnown = 0;
  for (const r of rows) { const c = channelOf(r.ad); if (adDestination(r.ad)) { chanCount[c]++; chanKnown++; } }
  const destinations = (["Website", "Social", "Marketplace", "Other"] as ReportChannel[])
    .filter(c => chanCount[c] > 0)
    .map(c => ({ label: c, count: chanCount[c], pct: chanKnown ? chanCount[c] / chanKnown : 0 }));
  // Actual resolved destinations (Play Store / App Store / Amazon / brand domain …).
  const destDetail = new Map<string, number>();
  let destDetailKnown = 0;
  for (const r of rows) { const d = adDestination(r.ad); if (d) { destDetail.set(d, (destDetail.get(d) ?? 0) + 1); destDetailKnown++; } }
  const destinationsDetailed = [...destDetail.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([label, count]) => ({ label, count, pct: destDetailKnown ? count / destDetailKnown : 0 }));

  // ── advertisers (which pages run these ads) ──
  const pageCount = new Map<string, number>();
  for (const ad of ads) { const p = String(ad.pageName ?? "").trim(); if (p) pageCount.set(p, (pageCount.get(p) ?? 0) + 1); }
  const advertisers = [...pageCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([label, count]) => ({ label, count, pct: total ? count / total : 0 }));

  // ── offer signal + discount history ──
  let mention = 0, maxDiscount: number | null = null;
  const discountPcts: number[] = [];
  const limitedAds: { days: number | null; month: string }[] = [];
  const discountHistory: CompetitorReport["discountHistory"] = [];
  const offerTypeMap = new Map<string, number>();
  for (const r of rows) {
    const text = `${r.ad.title ?? ""} ${r.ad.body ?? ""}`;
    const pct = extractDiscountPct(r.ad);
    if (pct != null) { mention++; maxDiscount = Math.max(maxDiscount ?? 0, pct); discountPcts.push(pct); discountHistory.push({ adId: r.ad.adId || "—", pct, start: r.ad.startTime ?? null, end: (r.ad as Record<string, unknown>).stopTime as string ?? null, url: adLibraryLink(r.ad) }); }
    else if (/\bdiscount\b|\bsale\b|\bcoupon\b|\bpromo\b|\boffer\b|\bdeal\b/i.test(text)) mention++;
    if (LIMITED_RE.test(text)) limitedAds.push({ days: r.days, month: Number.isNaN(r.startMs) ? "" : monthLabel(new Date(r.startMs)) });
    for (const t of detectOfferTypes(r.ad)) offerTypeMap.set(t, (offerTypeMap.get(t) ?? 0) + 1);
  }
  const offerTypes = [...offerTypeMap.entries()].sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, pct: total ? count / total : 0 }));
  discountHistory.sort((a, b) => b.pct - a.pct);
  // sorted desc → [0] is the max-discount ad, last is the min-discount ad
  const maxDiscountUrl = discountHistory[0]?.url ?? null;
  const minDiscountUrl = discountHistory.length ? (discountHistory[discountHistory.length - 1].url ?? null) : null;
  const limited = limitedAds.length;
  // discount distribution
  const avgDiscountPct = discountPcts.length ? Math.round(discountPcts.reduce((a, b) => a + b, 0) / discountPcts.length) : null;
  const minDiscountPct = discountPcts.length ? Math.min(...discountPcts) : null;
  const discFreq = new Map<number, number>();
  for (const p of discountPcts) discFreq.set(p, (discFreq.get(p) ?? 0) + 1);
  let mostRepeatedDiscountPct: number | null = null, mrBest = 0;
  for (const [p, c] of discFreq) if (c > mrBest) { mrBest = c; mostRepeatedDiscountPct = p; }
  // limited-offer distribution
  const maxLimitedOfferDays = limitedAds.length ? Math.max(...limitedAds.map(a => a.days ?? 0)) : null;
  const loMonthFreq = new Map<string, number>();
  for (const a of limitedAds) if (a.month) loMonthFreq.set(a.month, (loMonthFreq.get(a.month) ?? 0) + 1);
  let mostActiveLimitedMonth = "—", loBest = 0;
  for (const [m, c] of loMonthFreq) if (c > loBest) { loBest = c; mostActiveLimitedMonth = m; }
  const offerSignal = {
    mentionDiscountPct: total ? mention / total : 0,
    limitedOfferPct: total ? limited / total : 0,
    maxDiscountPct: maxDiscount,
    avgDiscountPct, minDiscountPct, mostRepeatedDiscountPct, maxDiscountUrl, minDiscountUrl,
    limitedOfferCount: limited, maxLimitedOfferDays, mostActiveLimitedMonth,
    offerTypes,
  };

  // ── marketplace category mix over time (Fashion / Home / Electronics …) ──
  const catTotal = new Map<string, number>();
  const catCell = new Map<string, number>(); // `${year}|${month}|${category}` → count
  const catYears = new Set<number>();
  for (const r of rows) {
    if (Number.isNaN(r.startMs)) continue;
    const d = new Date(r.startMs);
    const y = d.getUTCFullYear(), mo = d.getUTCMonth();
    const cat = detectCategory(r.ad);
    catYears.add(y);
    catTotal.set(cat, (catTotal.get(cat) ?? 0) + 1);
    const k = `${y}|${mo}|${cat}`;
    catCell.set(k, (catCell.get(k) ?? 0) + 1);
  }
  const categoryTrend = {
    categories: [...catTotal.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
    years: [...catYears].sort((a, b) => b - a),
    cells: [...catCell.entries()].map(([k, count]) => {
      const [y, mo, category] = k.split("|");
      return { year: Number(y), month: Number(mo), category, count };
    }),
  };

  // ── regional ads (language mix) ──
  const langCount = new Map<string, number>();
  for (const ad of ads) { const l = adLanguageLabel(ad); langCount.set(l, (langCount.get(l) ?? 0) + 1); }
  const regionalAds = [...langCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => ({ label, count }));

  // ── survival 5/10/30/60/90 ──
  const survival = [5, 10, 30, 60, 90].map(day => ({ day, pct: daysList.length ? daysList.filter(d => d >= day).length / daysList.length : 0 }));

  // ── ads table ──
  const adsTable = rows
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
    .map(r => ({
      adId: r.ad.adId || "—", format: r.fmt,
      cta: r.ad.cta ? String(r.ad.cta).replace(/_/g, " ") : null,
      channel: channelOf(r.ad), language: adLanguageLabel(r.ad), influencer: classifyInfluencer(r.ad).isInfluencer,
      start: r.ad.startTime ?? null, days: r.days, active: r.active,
      discountPct: extractDiscountPct(r.ad),
      offerTypes: detectOfferTypes(r.ad).join(", "),
      platforms: [...new Set((r.ad.publisherPlatforms ?? []).map(platformLabel).filter(Boolean))].join(", ") || "All platforms",
      url: adLibraryLink(r.ad),
    }));

  // ── influencer ads (creator-led) ──
  const influencerRows = rows.filter(r => classifyInfluencer(r.ad).isInfluencer);
  const influencerCount = influencerRows.length;
  const influencerPct = total ? influencerCount / total : 0;
  const influencerAds = influencerRows
    .sort((a, b) => (b.startMs || 0) - (a.startMs || 0))
    .map(r => ({
      adId: r.ad.adId || "—", start: r.ad.startTime ?? null, influencerName: influencerName(r.ad),
      igHandle: influencerHandle(r.ad),
      format: r.fmt, cta: r.ad.cta ? String(r.ad.cta).replace(/_/g, " ") : null,
      channel: channelOf(r.ad), language: adLanguageLabel(r.ad),
      discountPct: extractDiscountPct(r.ad), days: r.days, url: adLibraryLink(r.ad),
    }));

  // ── versions on Meta (sum of collapsed variants) + earliest ad in the library ──
  const versionsOnMeta = ads.reduce((s, ad) => s + Math.max(1, Number((ad as Record<string, unknown>).collationCount ?? 1) || 1), 0);
  const earliestAdMonth = validMs.length ? monthLabel(new Date(validMs[0])) : null;

  // ── festive & sale event log (named campaigns in copy) ──
  const fev = new Map<string, { count: number; live: boolean; year: number | null }>();
  for (const r of rows) {
    const text = `${r.ad.title ?? ""} ${r.ad.body ?? ""}`;
    const yr = Number.isNaN(r.startMs) ? null : new Date(r.startMs).getUTCFullYear();
    for (const [re, name] of FESTIVE_RES) {
      if (!re.test(text)) continue;
      const e = fev.get(name) ?? { count: 0, live: false, year: null };
      e.count++;
      if (r.active) e.live = true;
      if (yr != null && (e.year == null || yr > e.year)) e.year = yr;
      fev.set(name, e);
    }
  }
  const festiveEvents = [...fev.entries()]
    .map(([name, e]) => ({ name, count: e.count, live: e.live, year: e.year }))
    .sort((a, b) => Number(b.live) - Number(a.live) || b.count - a.count);

  // ── launch cadence — % of dated ads started on each weekday (Mon..Sun) ──
  const wd = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
  let datedCount = 0;
  for (const r of rows) {
    if (Number.isNaN(r.startMs)) continue;
    datedCount++;
    const js = new Date(r.startMs).getUTCDay();       // 0=Sun..6=Sat
    wd[(js + 6) % 7]++;                                 // → 0=Mon..6=Sun
  }
  const launchCadence = wd.map(c => (datedCount ? c / datedCount : 0));

  // ── creative churn profile — lifespan buckets, % of ads with a known lifespan ──
  const CHURN: [string, (d: number) => boolean][] = [
    ["0–3d", d => d <= 3], ["4–7d", d => d > 3 && d <= 7], ["8–14d", d => d > 7 && d <= 14],
    ["15–30d", d => d > 14 && d <= 30], ["31–60d", d => d > 30 && d <= 60], ["60d+", d => d > 60],
  ];
  const churnBuckets = CHURN.map(([label, test]) => ({
    label, pct: daysList.length ? daysList.filter(test).length / daysList.length : 0,
  }));

  // ── creative concentration — near-duplicate opening copy → one "concept" ──
  const conceptMap = new Map<string, number>();
  for (const r of rows) {
    const norm = String(r.ad.body ?? r.ad.title ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
    const key = norm || `__${r.ad.adId ?? Math.random()}`;   // empty-copy ads are their own concept
    conceptMap.set(key, (conceptMap.get(key) ?? 0) + 1);
  }
  const concepts = conceptMap.size;
  const topConcept = Math.max(0, ...conceptMap.values());
  const concentration = {
    concepts,
    variantsPerConcept: concepts ? total / concepts : 0,
    topConceptPct: total ? topConcept / total : 0,
  };

  // ── emoji density (groups per ad) + price-anchor psychology ──
  let emojiGroups = 0;
  const anchorMap = new Map<string, number>();
  for (const r of rows) {
    const text = `${r.ad.title ?? ""} ${r.ad.body ?? ""}`;
    emojiGroups += (text.match(EMOJI_RUN_RE) ?? []).length;
    for (const m of text.matchAll(PRICE_ANCHOR_RE)) {
      const n = Number(m[1] ?? m[2]);
      if (Number.isFinite(n) && n >= 10 && n <= 99999) anchorMap.set(`₹${n}`, (anchorMap.get(`₹${n}`) ?? 0) + 1);
    }
  }
  const emojiPerAd = total ? emojiGroups / total : 0;
  const priceAnchors = [...anchorMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([anchor, count]) => ({ anchor, count }));

  return {
    brand: brand.brand, total, active, inactive: total - active, newPerWeek, newThisMonth, refreshPct, windowStart, windowEnd,
    versionsOnMeta, earliestAdMonth,
    festiveEvents, launchCadence, churnBuckets, concentration, emojiPerAd, priceAnchors,
    adsPerMonth, formats, contentFormatsVideo, contentFormatsImage, ctaMix, destinations, destinationsDetailed, advertisers,
    platforms: platformReach(ads),
    offerSignal, discountHistory, regionalAds, runway, survival, categoryTrend,
    influencerPct, influencerCount, influencerAds, adsTable,
  };
}

/** Report for the whole set (you first, then competitors). Empty brands skipped. */
export function buildCompetitorReportSet(you: BrandAds | null, competitors: BrandAds[], now = new Date()): CompetitorReport[] {
  const out: CompetitorReport[] = [];
  if (you && you.ads.length) { const r = buildCompetitorReport({ ...you, brand: you.brand || "You" }, now); if (r) out.push(r); }
  for (const c of competitors) { if (!c.ads.length) continue; const r = buildCompetitorReport({ ...c, brand: c.brand || "Competitor" }, now); if (r) out.push(r); }
  return out;
}
