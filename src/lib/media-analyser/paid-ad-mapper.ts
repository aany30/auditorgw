/** Unified Apify Meta Ad Library item → SocialPaidAd mapping. */

export interface SocialPaidAdLike {
  adId?: string;
  adName?: string;
  platform?: string;
  pageName?: string;
  title?: string;
  body?: string;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  videoUrl?: string | null;
  mediaType?: string | null;
  startTime?: string | null;
  stopTime?: string | null;
  linkUrl?: string | null;
  cta?: string | null;
  status?: string | null;
  isActive?: boolean;
  instagramUrl?: string | null;
  matchReason?: string | null;
  publisherPlatforms?: string[];
  adSnapshotUrl?: string | null;
  pageId?: string | null;
  categories?: string[];
  audienceSizeMin?: number | null;
  audienceSizeMax?: number | null;
  /** Creative format: image | video | carousel | other (from media_type + snapshot cards). */
  format?: string | null;
  /** The real click destination (link_url only — never the ad-library snapshot). */
  destinationUrl?: string | null;
  // ── Tier-0 influencer signals (structural, from the Ad Library data itself) ──
  /** Meta "Paid partnership" / branded-content ad — near-definitive influencer signal. */
  brandedContent?: boolean | null;
  /** The partnership byline text, when present ("Paid partnership with …"). */
  partnershipLabel?: string | null;
  /** The advertiser PAGE's categories (e.g. "Digital creator", "Public figure"). */
  pageCategories?: string[];
  /** Advertiser entity type ("PERSON_PROFILE" ⇒ a creator, vs "PAGE" ⇒ a brand). */
  advertiserEntityType?: string | null;
  /** Instagram creator/actor name the ad is associated with, when whitelisted. */
  igActor?: string | null;
  /** How many near-identical ad VERSIONS Meta collated into this one card.
   *  Meta's "~N results" header counts versions; the list shows collated cards. */
  collationCount?: number | null;
}

// Log the available raw field keys ONCE per isolate so we can confirm which
// influencer signals the Apify actor actually returns (visible in Vercel logs).
let _loggedAdShape = false;

export function metaAdsActiveStatus(): "active" | "inactive" | "all" {
  const raw = (process.env.META_ADS_ACTIVE_STATUS ?? "all").toLowerCase();
  if (raw === "active" || raw === "inactive") return raw;
  return "all";
}

export interface AdLibraryUrlParams {
  q: string | null;
  viewAllPageId: string | null;
  country: string | null;
  activeStatus: "active" | "inactive" | "all" | null;
  searchType: string | null;
}

/** Parse Meta Ad Library URL query params for Apify + fallback keyword search. */
export function parseAdLibraryUrlParams(url: string): AdLibraryUrlParams {
  try {
    const trimmed = url.trim();
    const u = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const activeRaw = (u.searchParams.get("active_status") ?? "").toLowerCase();
    let activeStatus: AdLibraryUrlParams["activeStatus"] = null;
    if (activeRaw === "active" || activeRaw === "inactive") activeStatus = activeRaw;
    else if (activeRaw === "all") activeStatus = "all";

    return {
      q: u.searchParams.get("q")?.trim() || null,
      viewAllPageId: u.searchParams.get("view_all_page_id")?.trim() || null,
      country: u.searchParams.get("country")?.trim() || null,
      activeStatus,
      searchType: u.searchParams.get("search_type")?.trim() || null,
    };
  } catch {
    return { q: null, viewAllPageId: null, country: null, activeStatus: null, searchType: null };
  }
}

export function adLibraryUrlHasTargeting(url: string): boolean {
  const p = parseAdLibraryUrlParams(url);
  return Boolean(p.q || p.viewAllPageId);
}

function normalizePlatforms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(p => String(p).toLowerCase().trim()).filter(Boolean);
}

function parseAudienceBounds(raw: unknown): { min: number | null; max: number | null } {
  if (!raw || typeof raw !== "object") return { min: null, max: null };
  const o = raw as Record<string, unknown>;
  const min = o.lower_bound != null ? Number(o.lower_bound) : null;
  const max = o.upper_bound != null ? Number(o.upper_bound) : null;
  return {
    min: min != null && !Number.isNaN(min) ? min : null,
    max: max != null && !Number.isNaN(max) ? max : null,
  };
}

function str(v: unknown): string | null {
  return v != null && String(v).trim() ? String(v) : null;
}

/**
 * Resolve a still image and a thumbnail/poster for an ad.
 *
 * - `imageUrl`  → a true still image (rendered in the card AND sent to Gemini vision).
 * - `thumbnailUrl` → a poster for video ads (Meta exposes `video_preview_image_url`),
 *   used as the card poster and as the Gemini-analysable frame for video creatives.
 *
 * NOTE: we deliberately never fall back `imageUrl` to a *video* URL — a video URL
 * can't render in an <img> nor be analysed as a still, which left video cards blank
 * and excluded from per-ad analysis.
 */
function resolveMedia(item: Record<string, unknown>): { imageUrl: string | null; thumbnailUrl: string | null } {
  const imageStrings = (item.images as string[] | undefined) ?? [];
  const snapshot = (item.snapshot as Record<string, unknown> | undefined) ?? {};
  const snapshotImgs = (snapshot.images as Array<Record<string, unknown> | string> | undefined) ?? [];
  const snapshotCards = (snapshot.cards as Array<Record<string, unknown>> | undefined) ?? [];
  const snapshotVideos = (snapshot.videos as Array<Record<string, unknown>> | undefined) ?? [];

  const firstSnapshotImg = snapshotImgs[0];
  const snapshotImgUrl = typeof firstSnapshotImg === "string"
    ? firstSnapshotImg
    : str((firstSnapshotImg as Record<string, unknown> | undefined)?.original_image_url) ??
      str((firstSnapshotImg as Record<string, unknown> | undefined)?.resized_image_url) ??
      str((firstSnapshotImg as Record<string, unknown> | undefined)?.url);

  const imageUrl =
    str(imageStrings[0]) ??
    str(snapshotImgUrl) ??
    str(snapshotCards[0]?.original_image_url) ??
    str(snapshotCards[0]?.resized_image_url) ??
    str(snapshotCards[0]?.url) ??
    null;

  // Poster frame for video ads, in preference order across snapshot + card shapes.
  const videoPreview =
    str(snapshotVideos[0]?.video_preview_image_url) ??
    str(snapshotVideos[0]?.video_preview_url) ??
    str(snapshotCards[0]?.video_preview_image_url) ??
    str((item as Record<string, unknown>).video_preview_image_url) ??
    null;

  return { imageUrl, thumbnailUrl: imageUrl ?? videoPreview };
}

/**
 * Map one Apify `automly/facebook-ad-library-scraper` dataset item to SocialPaidAdLike.
 * Returns null for template/dynamic ads or empty creatives.
 */
export function mapApifyAdItem(
  item: Record<string, unknown>,
  opts?: { matchPrefix?: string },
): SocialPaidAdLike | null {
  const bodies = (item.ad_creative_bodies as string[] | undefined) ?? [];
  const titles = (item.ad_creative_link_titles as string[] | undefined) ?? [];
  const captions = (item.ad_creative_link_captions as string[] | undefined) ?? [];
  const videoStrings = (item.videos as string[] | undefined) ?? [];
  const platforms = normalizePlatforms(item.publisher_platforms);
  const archiveId = String(item.ad_archive_id ?? item.ad_id ?? "");
  const snapshotUrl = String(item.ad_snapshot_url ?? "") || (archiveId ? `https://www.facebook.com/ads/library/?id=${archiveId}` : "");
  const mediaType = String(item.media_type ?? "").toUpperCase();
  const startTime = item.ad_delivery_start_time ? String(item.ad_delivery_start_time) : null;
  const stopTime = item.ad_delivery_stop_time ? String(item.ad_delivery_stop_time) : null;
  const isActive = item.is_active !== false && String(item.is_active) !== "false";
  const audience = parseAudienceBounds(item.estimated_audience_size);

  // ── Tier-0 influencer signals — structural, straight from the Ad Library payload ──
  const snapshot = (item.snapshot as Record<string, unknown> | undefined) ?? {};
  if (!_loggedAdShape) {
    _loggedAdShape = true;
    console.log(`[ad_mapper] item keys: ${Object.keys(item).join(",")}`);
    console.log(`[ad_mapper] snapshot keys: ${Object.keys(snapshot).join(",")}`);
  }
  const brandedRaw = snapshot.branded_content ?? (item as Record<string, unknown>).branded_content ?? null;
  const byline = String(snapshot.byline ?? (item as Record<string, unknown>).byline ?? "").trim();
  const partnershipLabel =
    /paid partnership|branded content|in partnership with|in collaboration with|sponsored/i.test(byline)
      ? byline
      : (brandedRaw && typeof brandedRaw === "object" ? "Paid partnership" : "");
  const brandedContent = !!brandedRaw || !!partnershipLabel;
  const pageCatsRaw = snapshot.page_categories ?? (item as Record<string, unknown>).page_categories ?? snapshot.page_category ?? [];
  const pageCategories = Array.isArray(pageCatsRaw)
    ? pageCatsRaw.map(c => String(c)).filter(Boolean)
    : (typeof pageCatsRaw === "string" && pageCatsRaw ? [pageCatsRaw] : []);
  const advertiserEntityType = String((item as Record<string, unknown>).entity_type ?? snapshot.entity_type ?? "").trim() || null;
  const igActor = String(snapshot.instagram_actor_name ?? (item as Record<string, unknown>).instagram_actor_name ?? snapshot.instagram_handle ?? "").trim() || null;
  // Meta collates near-identical ad versions into one library card; the "~N results"
  // header counts VERSIONS while the list (and this dataset) shows collated cards.
  // Capture the group size so totals can be reconciled against Meta's header.
  const collationRaw = Number(
    (item as Record<string, unknown>).collation_count ??
    (item as Record<string, unknown>).collationCount ??
    snapshot.collation_count ??
    0,
  );
  const collationCount = Number.isFinite(collationRaw) && collationRaw > 1 ? Math.round(collationRaw) : null;

  const { imageUrl, thumbnailUrl } = resolveMedia(item);
  const videoUrl = videoStrings[0] ? String(videoStrings[0]) : null;

  // Creative format:
  //  - carousel: >1 snapshot card
  //  - video: a REAL video file is present (videoUrl)
  //  - image (static): a still image, INCLUDING a "static video" — an image run as a
  //    reel/video ad (Meta marks media_type VIDEO but there's no actual video file)
  //  - video (fallback): media_type VIDEO with no media captured at all
  const snapshotCards = ((item.snapshot as Record<string, unknown> | undefined)?.cards as unknown[] | undefined) ?? [];
  const format = (Array.isArray(snapshotCards) && snapshotCards.length > 1)
    ? "carousel"
    : videoUrl ? "video"
      : imageUrl ? "image"
        : mediaType === "VIDEO" ? "video" : "other";

  // Dynamic / DCO catalog ads use {{...}} placeholders in their copy (e.g.
  // "{{product.name}}"). These are REAL, running ads — very common for ecom — but
  // the old code dropped every ad whose copy contained "{{", silently undercounting
  // a competitor's ad volume (a 200-ad brand came back as ~160). Strip the
  // placeholders and KEEP the ad: it still carries an archive id, start date,
  // format, CTA and platforms — everything the ad-intelligence metrics need.
  const stripTpl = (s: string) => s.replace(/\{\{[^}]*\}\}/g, "").replace(/\s{2,}/g, " ").trim();
  const rawBody = bodies[0] ?? captions[0] ?? "";
  const rawTitle = titles[0] ?? "";
  const isDynamic = rawBody.includes("{{") || rawTitle.includes("{{");
  let body = stripTpl(rawBody);
  const title = stripTpl(rawTitle);
  if (isDynamic && !body && !title) body = "Dynamic / catalog ad";
  // Only drop items with NO identity at all — a genuine ad always has an archive id.
  if (!archiveId && !body && !title && !imageUrl && !videoUrl) return null;

  const igPlatform = platforms.some(p => p.includes("instagram"));
  const platformLabel = platforms.length
    ? platforms.map(p => p.replace(/_/g, " ")).join(", ")
    : "all";

  return {
    adId: archiveId,
    adName: archiveId.slice(-6) || "Ad",
    platform: "meta",
    pageName: String(item.page_name ?? ""),
    title,
    body,
    imageUrl,
    thumbnailUrl,
    videoUrl,
    mediaType: mediaType || (videoUrl ? "VIDEO" : imageUrl ? "IMAGE" : null),
    startTime,
    stopTime,
    linkUrl: String(item.link_url ?? snapshotUrl ?? "") || null,
    cta: String(item.cta_text ?? item.cta_type ?? ""),
    status: isActive ? "ACTIVE" : "INACTIVE",
    isActive,
    instagramUrl: igPlatform ? (snapshotUrl || null) : null,
    matchReason: opts?.matchPrefix
      ? `${opts.matchPrefix} · ${platformLabel}`
      : `Platforms: ${platformLabel}`,
    publisherPlatforms: platforms,
    adSnapshotUrl: snapshotUrl || null,
    pageId: item.page_id != null ? String(item.page_id) : null,
    categories: Array.isArray(item.categories)
      ? (item.categories as unknown[]).map(c => String(c)).filter(Boolean)
      : [],
    audienceSizeMin: audience.min,
    audienceSizeMax: audience.max,
    format,
    destinationUrl: item.link_url ? String(item.link_url) : null,
    brandedContent,
    partnershipLabel: partnershipLabel || null,
    pageCategories,
    advertiserEntityType,
    igActor,
    collationCount,
  };
}

export function sortApifyItemsByStartTime(items: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...items].sort((a, b) => {
    const aT = new Date(String(a.ad_delivery_start_time ?? 0)).getTime() || 0;
    const bT = new Date(String(b.ad_delivery_start_time ?? 0)).getTime() || 0;
    return bT - aT;
  });
}

export function dedupeApifyAds(ads: SocialPaidAdLike[]): SocialPaidAdLike[] {
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
