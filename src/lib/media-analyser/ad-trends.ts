/**
 * Ad trends — one consolidated per-brand, per-month time series across every
 * dimension the "you vs them" analysis cares about. Powers the single AdTrendGraph
 * (metric dropdown + brand checkboxes) that replaces the old stack of separate
 * charts/cards. Counts only — no spend. All classifiers are reused from the
 * existing ad-intelligence helpers so the numbers agree with the rest of the app.
 */

import type { SocialPaidAd } from "@/lib/media-analyser/types";
import type { BrandAds } from "@/lib/media-analyser/paid-ad-intel";
import { adDestination, ctaBucket } from "@/lib/media-analyser/paid-ad-intel";
import { adFormatKey, adLanguageLabel, isInfluencerAd } from "@/lib/media-analyser/paid-ad-stats";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key: string) => MONTH_LABELS[Number(key.split("-")[1]) - 1] ?? key;

// ── per-ad classifiers (channel copied here so ad-trends is self-contained) ──
const MARKET_RE = /amazon|flipkart|myntra|nykaa|croma|ajio|meesho|tatacliq|jiomart|snapdeal|shopee|lazada|\bnoon\b|reliancedigital|1mg|pharmeasy|walmart|target\.com|ebay|etsy|bigbasket|blinkit|zepto/i;
const SOCIAL_RE = /instagram|facebook|youtube|tiktok|\bfb\b/i;

/** Website/App (owned) vs Marketplace vs Others — from the click destination. */
function channelOf(ad: SocialPaidAd): "ownedSite" | "marketplace" | "otherChannel" {
  const dest = adDestination(ad);
  if (!dest) return "otherChannel";
  if (MARKET_RE.test(dest)) return "marketplace";
  if (SOCIAL_RE.test(dest)) return "otherChannel";
  return "ownedSite";
}

/** Partner ad = Meta branded-content / paid-partnership (vs the brand's own creative). */
function isPartnerAd(ad: SocialPaidAd): boolean {
  return ad.brandedContent === true || !!(ad.partnershipLabel && ad.partnershipLabel.trim());
}

export interface MonthTrend {
  key: string; label: string; total: number;
  partner: number; brandOwn: number;
  video: number; staticc: number;
  ownedSite: number; marketplace: number; otherChannel: number;
  english: number; vernacular: number;
  influencer: number; native: number;
  ctas: Record<string, number>;
}

export interface BrandTrend {
  brand: string;
  isYou: boolean;
  total: number;
  monthly: MonthTrend[];
}

export interface AdTrendSet {
  brands: BrandTrend[];
  months: { key: string; label: string }[];
  /** CTA buckets present across the set, most-used first (for the CTAs metric). */
  ctaBuckets: string[];
  hasData: boolean;
}

const emptyMonth = (key: string): MonthTrend => ({
  key, label: monthLabel(key), total: 0,
  partner: 0, brandOwn: 0, video: 0, staticc: 0,
  ownedSite: 0, marketplace: 0, otherChannel: 0,
  english: 0, vernacular: 0, influencer: 0, native: 0,
  ctas: {},
});

/** Build the consolidated trend set for you + competitors, on a shared 6-month axis. */
export function buildAdTrends(you: BrandAds | null, competitors: BrandAds[]): AdTrendSet {
  const raw: { brand: string; isYou: boolean; ads: SocialPaidAd[] }[] = [];
  if (you && you.ads.length) raw.push({ brand: you.brand || "You", isYou: true, ads: you.ads });
  for (const c of competitors) if (c.ads.length) raw.push({ brand: c.brand || "Competitor", isYou: false, ads: c.ads });

  if (!raw.length) return { brands: [], months: [], ctaBuckets: [], hasData: false };

  // Shared month axis: the last 6 months ending at the set-wide latest launch month.
  const adMonth = (ad: SocialPaidAd): string | null => {
    if (!ad.startTime) return null;
    const d = new Date(ad.startTime);
    return Number.isNaN(d.getTime()) ? null : monthKey(d);
  };
  const allKeys = raw.flatMap(r => r.ads.map(adMonth)).filter((k): k is string => !!k).sort();
  const months: { key: string; label: string }[] = [];
  if (allKeys.length) {
    const [ey, em] = allKeys[allKeys.length - 1].split("-").map(Number);
    const cursor = new Date(ey, em - 1, 1);
    const seq: string[] = [];
    for (let i = 0; i < 6; i++) { seq.unshift(monthKey(cursor)); cursor.setMonth(cursor.getMonth() - 1); }
    for (const k of seq) months.push({ key: k, label: monthLabel(k) });
  }
  const axis = new Set(months.map(m => m.key));
  const ctaTotals = new Map<string, number>();

  const brands: BrandTrend[] = raw.map(r => {
    const byMonth = new Map<string, MonthTrend>(months.map(m => [m.key, emptyMonth(m.key)]));
    let total = 0;
    for (const ad of r.ads) {
      const mk = adMonth(ad);
      if (!mk || !axis.has(mk)) continue;
      const m = byMonth.get(mk)!;
      m.total++; total++;
      // 2 — brand vs partner
      if (isPartnerAd(ad)) m.partner++; else m.brandOwn++;
      // 3 — video vs static
      if (adFormatKey(ad) === "video") m.video++; else m.staticc++;
      // 4 — website/app vs marketplace vs others
      m[channelOf(ad)]++;
      // 5 — english vs vernacular
      if (adLanguageLabel(ad).toLowerCase() === "english") m.english++; else m.vernacular++;
      // 6 — native vs influencer
      if (isInfluencerAd(ad)) m.influencer++; else m.native++;
      // 7 — CTAs
      const cta = ctaBucket(ad.cta ?? "");
      m.ctas[cta] = (m.ctas[cta] ?? 0) + 1;
      ctaTotals.set(cta, (ctaTotals.get(cta) ?? 0) + 1);
    }
    return { brand: r.brand, isYou: r.isYou, total, monthly: months.map(m => byMonth.get(m.key)!) };
  });

  const ctaBuckets = [...ctaTotals.entries()]
    .filter(([k]) => k !== "No button")
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  return { brands, months, ctaBuckets, hasData: brands.length > 0 && months.length > 0 };
}
