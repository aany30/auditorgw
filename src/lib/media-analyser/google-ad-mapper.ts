/**
 * Google Ads Transparency Center item → SocialPaidAdLike mapping.
 *
 * Mirrors paid-ad-mapper.ts but for the two Apify Google-ads actors. Reuses the
 * existing SocialPaidAdLike shape (platform "google") so all downstream machinery
 * — enrichPaidAd, buildPaidAdBuckets, attachAdAnalyses, buildAdIntel, the
 * PaidAdsDashboard UI — works unchanged.
 *
 * Google's Transparency Center exposes NO spend/impressions and NO is_active flag,
 * so `isActive` is inferred from `lastShown` recency (see inferGoogleIsActive).
 *
 * Two actors, two mappers (field names differ; read defensively with ?? fallbacks):
 *  - Fast: automation-lab/google-ads-scraper — advertiserName, creativeId, adFormat,
 *          firstShown, lastShown, previewUrl, imageUrl, region. NO ad copy / CTA.
 *  - Rich: scrapers-hub/google-ads-transparency-scraper — advertiser_name, ad_id,
 *          format, ad_copy, cta_label, ad_preview_link, source_url, first_shown, last_shown.
 */

import type { SocialPaidAdLike } from "./paid-ad-mapper";

/** isActive inference window (days) — Google has no active flag, so recency stands in. */
function activeDays(): number {
  return parseInt(process.env.GOOGLE_ADS_ACTIVE_DAYS ?? "7", 10) || 7;
}

function str(v: unknown): string | null {
  return v != null && String(v).trim() ? String(v) : null;
}

/** First non-empty string across a set of candidate keys on the raw item. */
function pick(item: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const s = str(item[k]);
    if (s) return s;
  }
  return null;
}

/** Map the actor's ad format label (Text/Image/Video) → { format, mediaType }. */
export function googleAdFormat(raw: string | null): { format: string; mediaType: string | null } {
  const f = (raw ?? "").toLowerCase();
  if (f.includes("video")) return { format: "video", mediaType: "VIDEO" };
  if (f.includes("image")) return { format: "image", mediaType: "IMAGE" };
  if (f.includes("text")) return { format: "text", mediaType: "TEXT" };
  return { format: "other", mediaType: raw ? raw.toUpperCase() : null };
}

/**
 * Infer whether a Google ad is still running. Transparency Center has no is_active,
 * so an ad is treated active when it has no lastShown (still delivering) OR its
 * lastShown is within GOOGLE_ADS_ACTIVE_DAYS of now.
 */
export function inferGoogleIsActive(lastShown: string | null, now = new Date()): boolean {
  if (!lastShown) return true;
  const t = new Date(lastShown).getTime();
  if (Number.isNaN(t)) return true;
  const days = (now.getTime() - t) / 86_400_000;
  return days <= activeDays();
}

/** Map one Fast actor (automation-lab/google-ads-scraper) item → SocialPaidAdLike. */
export function mapGoogleFastItem(
  item: Record<string, unknown>,
  opts?: { matchPrefix?: string },
): SocialPaidAdLike | null {
  const adId = pick(item, "creativeId", "creative_id", "adId", "ad_id") ?? "";
  const advertiser = pick(item, "advertiserName", "advertiser_name", "advertiser") ?? "";
  const imageUrl = pick(item, "imageUrl", "image_url");
  const previewUrl = pick(item, "previewUrl", "preview_url", "adPreviewLink", "ad_preview_link");
  const firstShown = pick(item, "firstShown", "first_shown");
  const lastShown = pick(item, "lastShown", "last_shown");
  const region = pick(item, "region");
  const { format, mediaType } = googleAdFormat(pick(item, "adFormat", "format"));

  // Drop items with no identity at all.
  if (!adId && !imageUrl && !previewUrl) return null;

  const isActive = inferGoogleIsActive(lastShown);
  return {
    adId,
    adName: adId.slice(-6) || "Ad",
    platform: "google",
    pageName: advertiser,
    title: "",
    body: "",
    imageUrl,
    thumbnailUrl: imageUrl ?? previewUrl,
    videoUrl: null,
    mediaType,
    startTime: firstShown,
    stopTime: lastShown,
    linkUrl: previewUrl,
    cta: "",
    status: isActive ? "ACTIVE" : "INACTIVE",
    isActive,
    instagramUrl: null,
    matchReason: opts?.matchPrefix ? `${opts.matchPrefix} · google` : "Google Ads Transparency",
    publisherPlatforms: ["google"],
    adSnapshotUrl: previewUrl,
    pageId: null,
    categories: region ? [region] : [],
    audienceSizeMin: null,
    audienceSizeMax: null,
    format,
    destinationUrl: previewUrl,
  };
}

/** Map one Rich actor (scrapers-hub/google-ads-transparency-scraper) item → SocialPaidAdLike. */
export function mapGoogleRichItem(
  item: Record<string, unknown>,
  opts?: { matchPrefix?: string },
): SocialPaidAdLike | null {
  const adId = pick(item, "ad_id", "adId", "creativeId", "creative_id") ?? "";
  const advertiser = pick(item, "advertiser_name", "advertiserName", "advertiser") ?? "";
  const previewLink = pick(item, "ad_preview_link", "adPreviewLink", "previewUrl", "preview_url");
  const imageUrl = pick(item, "imageUrl", "image_url");
  const body = pick(item, "ad_copy", "adCopy", "copy") ?? "";
  const cta = pick(item, "cta_label", "ctaLabel", "cta") ?? "";
  const source = pick(item, "source_url", "sourceUrl", "destination_url", "destinationUrl");
  const firstShown = pick(item, "first_shown", "firstShown");
  const lastShown = pick(item, "last_shown", "lastShown");
  const region = pick(item, "region");
  const { format, mediaType } = googleAdFormat(pick(item, "format", "adFormat"));

  if (!adId && !body && !previewLink && !imageUrl) return null;

  const isActive = inferGoogleIsActive(lastShown);
  return {
    adId,
    adName: adId.slice(-6) || "Ad",
    platform: "google",
    pageName: advertiser,
    title: "",
    body,
    imageUrl,
    thumbnailUrl: imageUrl ?? previewLink,
    videoUrl: null,
    mediaType,
    startTime: firstShown,
    stopTime: lastShown,
    linkUrl: source ?? previewLink,
    cta,
    status: isActive ? "ACTIVE" : "INACTIVE",
    isActive,
    instagramUrl: null,
    matchReason: opts?.matchPrefix ? `${opts.matchPrefix} · google` : "Google Ads Transparency",
    publisherPlatforms: ["google"],
    adSnapshotUrl: previewLink,
    pageId: null,
    categories: region ? [region] : [],
    audienceSizeMin: null,
    audienceSizeMax: null,
    format,
    destinationUrl: source ?? previewLink,
  };
}

/** Sort raw items newest-first by first-shown date (mirror sortApifyItemsByStartTime). */
export function sortGoogleItemsByFirstShown(items: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...items].sort((a, b) => {
    const aT = new Date(String(a.firstShown ?? a.first_shown ?? 0)).getTime() || 0;
    const bT = new Date(String(b.firstShown ?? b.first_shown ?? 0)).getTime() || 0;
    return bT - aT;
  });
}

/** Dedupe mapped ads by adId (mirror dedupeApifyAds). */
export function dedupeGoogleAds(ads: SocialPaidAdLike[]): SocialPaidAdLike[] {
  const seen = new Set<string>();
  const out: SocialPaidAdLike[] = [];
  for (const ad of ads) {
    const id = ad.adId ?? "";
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push(ad);
  }
  return out;
}
