import type { SocialPaidAd } from "./types";
import type { DurationBucket, PlatformBucket, StatusBucket } from "./paid-ad-buckets";

export type MediaFilter = "still" | "video";
export type TimelineSort = "longest" | "newest" | "platform";
export type PlatformOn = "all" | "facebook" | "instagram" | "audience_network" | "messenger";
export type FormatFilter = "all" | "image" | "video" | "carousel" | "text";

export interface PaidAdFilters {
  status: StatusBucket | "all";
  platform: PlatformBucket | "all";
  duration: DurationBucket | "all";
  media: MediaFilter | "all";
  // ── Meta Ad Library filters ──
  platformOn: PlatformOn;   // ad runs on this platform (from publisherPlatforms)
  format: FormatFilter;     // media type: image / video / carousel
  language: string;         // "all" or a detected language name
  dateFrom: string;         // "" or YYYY-MM-DD (ad start date ≥)
  dateTo: string;           // "" or YYYY-MM-DD (ad start date ≤)
  influencer: boolean;      // only ads that read as influencer/creator ads
}

export const DEFAULT_PAID_AD_FILTERS: PaidAdFilters = {
  status: "all",
  platform: "all",
  duration: "all",
  media: "all",
  platformOn: "all",
  format: "all",
  language: "all",
  dateFrom: "",
  dateTo: "",
  influencer: false,
};

// Native-script → language (mirrors paid-ad-intel; kept local to avoid a cycle).
const SCRIPT_LANGS: [RegExp, string][] = [
  [/[ऀ-ॿ]/, "Hindi"], [/[஀-௿]/, "Tamil"], [/[ఀ-౿]/, "Telugu"],
  [/[ಀ-೿]/, "Kannada"], [/[ഀ-ൿ]/, "Malayalam"], [/[ঀ-৿]/, "Bengali"],
  [/[઀-૿]/, "Gujarati"], [/[਀-੿]/, "Punjabi"], [/[଀-୿]/, "Odia"], [/[؀-ۿ]/, "Arabic/Urdu"],
];

/** Detected language label for an ad (native script, else Gemini copy pass, else English). */
export function adLanguageLabel(ad: SocialPaidAd): string {
  const text = `${ad.title ?? ""} ${ad.body ?? ""}`;
  for (const [re, name] of SCRIPT_LANGS) if (re.test(text)) return name;
  const camp = (ad as Record<string, unknown>).adCampaignAnalysis as Record<string, unknown> | undefined;
  const llm = String(camp?.language ?? "").trim();
  if (llm && !/^(none|unknown|n\/?a)$/i.test(llm)) return llm;
  return "English";
}

// Influencer / creator signals in copy — PRECISE only. We deliberately do NOT guess
// names from "with X Y" / "by X Y" — that mislabelled product copy like "…with Coarse
// Mode" as a creator. Real creator ads are caught by the vision tier.
// NOTE: a bare @mention is NOT included — brand ads routinely tag their own or a
// partner handle (e.g. "@atomberg", "Follow us @…"), which wrongly flagged pure
// product/offer ads as influencer. Only explicit partnership language counts here.
const INFLUENCER_COPY_RE = /\bpaid partnership\b|\bbranded content\b|\b#ad\b|\bin collaboration with\b|\bcollab with\b|\bambassador\b|\binfluencer\b/i;
// (b) an explicit "ft./featuring <Name>" credit — cue any-case, name must be Capitalised:
const CREDIT_RE = /\b(?:[Ff]t\.?|[Ff]eat\.?|[Ff]eaturing|[Ss]tarring)\s+[A-Z][a-z]+/;

// Advertiser PAGE categories that mean the page IS a creator (so its ads are creator content).
const CREATOR_PAGE_RE = /\b(digital creator|content creator|video creator|creator|blogger|vlogger|public figure|influencer|artist|musician|youtuber|personal blog|entrepreneur|comedian|actor|model)\b/i;
const PARTNERSHIP_TEXT_RE = /paid partnership|branded content|in partnership with|in collaboration with|sponsored/i;

export interface InfluencerVerdict {
  isInfluencer: boolean;
  confidence: number;   // 0..1
  reason: string;       // the winning signal, for the UI
}

/**
 * Influencer/creator-ad classifier — COLLABORATION-based, fully deterministic (no reel/
 * vision AI). "In collaboration" IS an influencer ad, so we read it straight from the Ad
 * Library metadata + caption, which is instant and reliable on every ad:
 *  Tier 0 — STRUCTURAL: "Paid partnership" / branded content, a creator PAGE category, or a
 *           person-entity advertiser (near-definitive collaboration signals).
 *  Tier 1 — COPY: explicit partnership language, or a named "ft./featuring" creator.
 * (The per-ad vision/reel pass was removed here — it was slow and the collaboration tag
 * already captures the overwhelming majority of influencer ads.)
 */
export function classifyInfluencer(ad: SocialPaidAd): InfluencerVerdict {
  const o = ad as Record<string, unknown>;

  // Tier 0 — structural collaboration signals (free, strongest)
  if (o.brandedContent === true) return { isInfluencer: true, confidence: 0.97, reason: "Meta “Paid partnership” label" };
  const label = String(o.partnershipLabel ?? "");
  if (label && PARTNERSHIP_TEXT_RE.test(label)) return { isInfluencer: true, confidence: 0.95, reason: "Paid-partnership byline" };
  const cats = Array.isArray(o.pageCategories) ? (o.pageCategories as string[]).join(" · ") : "";
  const catMatch = cats.match(CREATOR_PAGE_RE);
  if (catMatch) return { isInfluencer: true, confidence: 0.85, reason: `Creator page (${catMatch[0]})` };
  if (String(o.advertiserEntityType ?? "").toUpperCase().includes("PERSON")) return { isInfluencer: true, confidence: 0.8, reason: "Advertiser is a person" };

  // Tier 1 — collaboration cues in the caption (partnership language / @mention / ft.<Name>)
  const text = `${ad.title ?? ""} ${ad.body ?? ""}`;
  if (INFLUENCER_COPY_RE.test(text) || CREDIT_RE.test(text)) return { isInfluencer: true, confidence: 0.6, reason: "Collaboration cue in caption" };

  return { isInfluencer: false, confidence: 0, reason: "Not a collaboration" };
}

/** Is this an influencer/creator ad? (boolean shorthand over classifyInfluencer.) */
export function isInfluencerAd(ad: SocialPaidAd): boolean {
  return classifyInfluencer(ad).isInfluencer;
}

/**
 * The creator's handle for a collaboration/influencer ad — Meta's whitelisted igActor
 * (@-stripped) when present, else the creator name parsed from a "<creator> with <brand>"
 * byline. "" when there's no creator identity (not a collab, or Meta didn't expose one).
 */
export function influencerHandleOf(ad: SocialPaidAd): string {
  const o = ad as Record<string, unknown>;
  const actor = String(o.igActor ?? "").trim().replace(/^@+/, "");
  if (actor) return actor;
  const label = String(o.partnershipLabel ?? "").trim();
  const m = label.match(/^(.+?)\s+with\s+.+$/i);
  if (m && !/^paid partnership$/i.test(m[1].trim())) return m[1].trim();
  return "";
}

/**
 * Does this ad ALREADY carry a definitive, no-image influencer signal — a paid-partnership
 * tag, a creator page category, a person advertiser, or explicit partnership copy? Such ads
 * are "obvious": classifyInfluencer resolves them for free from the Ad Library metadata, so a
 * per-ad Gemini vision call adds nothing to the verdict. The AMBIGUOUS ads — a plain image/
 * video run from the brand's own page with no tag — are the ones that actually need vision to
 * tell a creator/UGC ad from a product/offer shot. `analyzeAdCreatives` uses this to spend the
 * vision budget on the ambiguous ads first instead of wasting it on already-obvious ones.
 */
export function hasObviousInfluencerSignal(ad: SocialPaidAd): boolean {
  const o = ad as Record<string, unknown>;
  if (o.brandedContent === true) return true;
  const label = String(o.partnershipLabel ?? "");
  if (label && PARTNERSHIP_TEXT_RE.test(label)) return true;
  const cats = Array.isArray(o.pageCategories) ? (o.pageCategories as string[]).join(" · ") : "";
  if (CREATOR_PAGE_RE.test(cats)) return true;
  if (String(o.advertiserEntityType ?? "").toUpperCase().includes("PERSON")) return true;
  const text = `${ad.title ?? ""} ${ad.body ?? ""}`;
  if (INFLUENCER_COPY_RE.test(text) || CREDIT_RE.test(text)) return true;
  return false;
}

/** Creative format key for an ad (image / video / carousel / other). */
export function adFormatKey(ad: SocialPaidAd): "image" | "video" | "carousel" | "text" | "other" {
  const f = String((ad as Record<string, unknown>).format ?? "").toLowerCase();
  if (f === "image" || f === "video" || f === "carousel" || f === "text") return f;
  // A real video file ⇒ video. An image with no video file ⇒ static image, EVEN when
  // media_type says VIDEO (a "static video" — an image run as a reel/video ad).
  if (ad.videoUrl) return "video";
  if (ad.imageUrl) return "image";
  if (String(ad.mediaType ?? "").toUpperCase() === "VIDEO") return "video";
  return "other";
}

export interface PaidAdKpis {
  total: number;
  active: number;
  inactive: number;
  avgRunningDays: number | null;
  stillCount: number;
  videoCount: number;
  longestRunning: { days: number; label: string } | null;
  newestAd: { startTime: string; label: string } | null;
}

export interface TimelineItem {
  ad: SocialPaidAd;
  adId: string;
  label: string;
  startMs: number | null;
  endMs: number;
  runningDays: number | null;
  isActive: boolean;
  platformBucket: PlatformBucket;
}

export interface PaidAdDashboardStats {
  kpis: PaidAdKpis;
  timeline: TimelineItem[];
  rangeStartMs: number;
  rangeEndMs: number;
  maxRunningDays: number;
}

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function isAdVideo(ad: SocialPaidAd): boolean {
  // Honour the explicit `format` field first (same as adFormatKey / formatOf), so the
  // video count agrees everywhere — a video ad tagged format:"video" but missing a
  // videoUrl was previously undercounted here but counted in the VIDEO/STATIC column.
  if (String((ad as Record<string, unknown>).format ?? "").toLowerCase() === "video") return true;
  if (ad.videoUrl) return true;
  const mt = String(ad.mediaType ?? "").toUpperCase();
  return mt.includes("VIDEO");
}

export function computePaidAdDashboardStats(ads: SocialPaidAd[], now = new Date()): PaidAdDashboardStats {
  const nowMs = now.getTime();
  let stillCount = 0;
  let videoCount = 0;
  let runningSum = 0;
  let runningCount = 0;
  let maxRunningDays = 0;
  let longestRunning: PaidAdKpis["longestRunning"] = null;
  let newestAd: PaidAdKpis["newestAd"] = null;
  let active = 0;
  let inactive = 0;

  const timeline: TimelineItem[] = [];
  let rangeStartMs = nowMs;
  let rangeEndMs = nowMs;

  for (const ad of ads) {
    if (isAdVideo(ad)) videoCount++;
    else stillCount++;

    if (ad.isActive) active++;
    else inactive++;

    if (ad.runningDays != null && ad.isActive) {
      runningSum += ad.runningDays;
      runningCount++;
      if (ad.runningDays > maxRunningDays) {
        maxRunningDays = ad.runningDays;
        longestRunning = {
          days: ad.runningDays,
          label: ad.title || ad.pageName || ad.adName || "Ad",
        };
      }
    } else if (ad.runningDays != null && ad.runningDays > maxRunningDays) {
      maxRunningDays = ad.runningDays;
    }

    const startMs = parseMs(ad.startTime);
    if (startMs != null) {
      if (!newestAd || startMs > parseMs(newestAd.startTime)!) {
        newestAd = {
          startTime: ad.startTime!,
          label: ad.title || ad.pageName || ad.adName || "Ad",
        };
      }
      rangeStartMs = Math.min(rangeStartMs, startMs);
    }

    const endMs = ad.isActive ? nowMs : (parseMs(ad.stopTime) ?? nowMs);
    rangeEndMs = Math.max(rangeEndMs, endMs);

    timeline.push({
      ad,
      adId: ad.adId || ad.adName || String(timeline.length),
      label: ad.title || ad.pageName || ad.adName || "Paid ad",
      startMs,
      endMs,
      runningDays: ad.runningDays ?? null,
      isActive: ad.isActive,
      platformBucket: (ad.platformBucket ?? "other") as PlatformBucket,
    });
  }

  if (rangeStartMs >= rangeEndMs) {
    rangeStartMs = nowMs - 90 * 86_400_000;
    rangeEndMs = nowMs;
  }

  return {
    kpis: {
      total: ads.length,
      active,
      inactive,
      avgRunningDays: runningCount ? Math.round(runningSum / runningCount) : null,
      stillCount,
      videoCount,
      longestRunning,
      newestAd,
    },
    timeline,
    rangeStartMs,
    rangeEndMs,
    maxRunningDays: maxRunningDays || 1,
  };
}

export function sortTimelineItems(items: TimelineItem[], sort: TimelineSort): TimelineItem[] {
  const copy = [...items];
  if (sort === "longest") {
    return copy.sort((a, b) => (b.runningDays ?? 0) - (a.runningDays ?? 0));
  }
  if (sort === "newest") {
    return copy.sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0));
  }
  return copy.sort((a, b) => a.platformBucket.localeCompare(b.platformBucket));
}

export function filterPaidAds(ads: SocialPaidAd[], filters: PaidAdFilters): SocialPaidAd[] {
  return ads.filter(ad => {
    if (filters.status !== "all") {
      const status: StatusBucket = ad.isActive ? "active" : "inactive";
      if (status !== filters.status) return false;
    }
    if (filters.platform !== "all" && ad.platformBucket !== filters.platform) return false;
    if (filters.duration !== "all" && ad.durationBucket !== filters.duration) return false;
    if (filters.media === "still" && isAdVideo(ad)) return false;
    if (filters.media === "video" && !isAdVideo(ad)) return false;
    // Meta Ad Library filters
    if (filters.platformOn !== "all" && !(ad.publisherPlatforms ?? []).some(p => p.toLowerCase().includes(filters.platformOn))) return false;
    if (filters.format !== "all" && adFormatKey(ad) !== filters.format) return false;
    if (filters.language !== "all" && adLanguageLabel(ad) !== filters.language) return false;
    const start = (ad.startTime ?? "").slice(0, 10);
    if (filters.dateFrom && (!start || start < filters.dateFrom)) return false;
    if (filters.dateTo && (!start || start > filters.dateTo)) return false;
    if (filters.influencer && !isInfluencerAd(ad)) return false;
    return true;
  });
}

export function countActiveFilters(filters: PaidAdFilters): number {
  let n = 0;
  if (filters.status !== "all") n++;
  if (filters.platform !== "all") n++;
  if (filters.duration !== "all") n++;
  if (filters.media !== "all") n++;
  if (filters.platformOn !== "all") n++;
  if (filters.format !== "all") n++;
  if (filters.language !== "all") n++;
  if (filters.dateFrom) n++;
  if (filters.dateTo) n++;
  if (filters.influencer) n++;
  return n;
}

export interface BrandBookSection {
  title: string;
  body: string;
  items?: string[];
}

/** Parse markdown brand book from generateAdsBrandBook into structured sections. */
export function parseBrandBookMarkdown(markdown: string): BrandBookSection[] {
  if (!markdown.trim()) return [];

  const sections: BrandBookSection[] = [];
  const lines = markdown.split("\n");
  let current: BrandBookSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("## ")) continue;

    const boldMatch = trimmed.match(/^\*\*(.+?):\*\*\s*(.*)$/);
    if (boldMatch) {
      if (current) sections.push(current);
      current = { title: boldMatch[1], body: boldMatch[2], items: [] };
      continue;
    }

    if (trimmed.startsWith("- ") && current) {
      current.items = current.items ?? [];
      current.items.push(trimmed.slice(2));
      continue;
    }

    if (current && trimmed) {
      current.body = current.body ? `${current.body} ${trimmed}` : trimmed;
    }
  }
  if (current) sections.push(current);
  return sections;
}
