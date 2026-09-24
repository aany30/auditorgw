import type { CombinedScraperData, RawSocialPost, SocialSnapshot, SourceCounts, ProductContext, InstagramImageAnalysis, InstagramBrandProfile, SocialMarketingPost, CompetitorSocial, SocialPaidAd, AdCampaignAnalysis } from "./types";
import { productContextFromPayload } from "./product-match";
import { extractBrandVisualDna, fetchCdnImageInline, fetchCdnVideoInline, type VisualAsset } from "./brandVisualDna";
import { geminiTextModels, geminiVisionModels, geminiAdVisionModels } from "./gemini-models";
import { callVisionLLM, type VisionUserPart } from "./vision-llm";
import { buildPaidAdBuckets, enrichPaidAd } from "./paid-ad-buckets";
import { hasObviousInfluencerSignal } from "./paid-ad-stats";
import { fetchGoogleAds, type GoogleAdsMode, type GoogleAdsFetchResult } from "./google-ads";
import {
  adLibraryUrlHasTargeting,
  dedupeApifyAds,
  mapApifyAdItem,
  metaAdsActiveStatus,
  parseAdLibraryUrlParams,
  sortApifyItemsByStartTime,
  type SocialPaidAdLike,
} from "./paid-ad-mapper";

export interface MetaAdsFetchResult {
  ads: SocialPaidAdLike[];
  fetchError?: string;
}

/** Max paid ads to surface + analyze (active-first, longest-running). */

// Analyse EVERY ad from the last N months (default 6), not a small top-N slice.
const PAID_AD_ANALYSIS_MONTHS = parseInt(process.env.PAID_AD_ANALYSIS_MONTHS ?? "6", 10) || 6;
// A generous safety ceiling so a runaway brand can't blow up cost/time entirely.
// Keep this >= META_ADS_SCRAPE_MAX or it silently re-caps the count below the scrape.
// Raised to 6000 for large advertisers (Flipkart/Amazon run 5-6k live ads): the
// DETERMINISTIC dashboard (count, formats, CTA, decay, destinations) runs on ALL of
// these for free — only the LLM vision/copy passes below are sampled — so a high cap
// costs scrape time + payload size, not analysis time.
const PAID_AD_HARD_CAP = parseInt(process.env.PAID_AD_HARD_CAP ?? "10000", 10) || 10000;
// How many ads to pull from the Ad Library so the last-6-months window is fully covered.
// 4000 default; the actual count returned is gated by META_ADS_WAIT_SECS + actor speed,
// and best-signal ordering (active first, longest-running) keeps any truncation graceful.
const META_ADS_SCRAPE_MAX = parseInt(process.env.META_ADS_SCRAPE_MAX ?? "8000", 10) || 8000;
// The Ad Library actor's own default run memory is 4096 MB — run it there (not the
// generic 256 MB) or it starves and returns a partial, undercounted ad set.
const META_ADS_ACTOR_MEMORY = parseInt(process.env.META_ADS_ACTOR_MEMORY ?? "4096", 10) || 4096;
// apify/instagram-scraper is Puppeteer-based; the generic 256 MB starves it so the run
// is still RUNNING when we read (→ "reading partial results" warning + undercount).
// 1024 MB lets a ~30-post profile scrape finish inside the wait window.
const PUBLIC_SOCIAL_ACTOR_MEMORY = parseInt(process.env.PUBLIC_SOCIAL_ACTOR_MEMORY ?? "1024", 10) || 1024;
// How long to let the Ad Library run finish before we read its dataset. Too short → we read a
// still-RUNNING (partial) dataset and undercount by the last page(s) — e.g. Flipkart has ~6,900
// ads but 240s only paged ~2,588. Too long → the /api/analyze-product function times out.
// The brand + competitor scrapes now run in PARALLEL (not sequentially), so the wall-clock is
// ONE wait, not N — which is why we can afford a deep 500s here and still leave ~300s of the
// 800s budget for the deterministic build + brief. It's a MAX, not a fixed duration: a small
// brand's actor finishes early and the poll exits, so this never slows small runs.
// Push to 600 via env for the very deepest single-brand scans.
const META_ADS_WAIT_SECS = parseInt(process.env.META_ADS_WAIT_SECS ?? "500", 10) || 500;
// Precise deep scan: how many seconds of the reel's OPENING to analyse (with audio)
// for influencer + spoken language. Small = fast + focuses on the hook. Env-tunable.
const AD_DEEP_CLIP_SECS = parseInt(process.env.AD_DEEP_CLIP_SECS ?? "4", 10) || 4;
// Gemini per-ad passes are bounded to a sample so large ad sets (300-500 ads)
// don't time out. The deterministic metrics (count, formats, CTA, lifespan,
// refresh, destinations) run on ALL scraped ads regardless of these caps; only the
// vision (influencer) + copy (language) ENRICHMENT is sampled — the rest fall back
// to the deterministic heuristics.
// Vision runs per-ad (Gemini image call, batches of 5) for BOTH the main brand and
// every competitor, so this is the most time-expensive sample. 40 covers a brand's
// most-active creatives for the influencer/creative read while keeping a 2-brand run
// inside 800s; the rest fall back to the copy/structural heuristics. Copy is a batched
// text pass (25/call) so it's cheap — 300 gives the language/regional read broad reach.
// For a single-brand solo scan, push VISION to 80-120 and COPY to 600 via env.
// The per-ad AI creative pass runs on a SMALL/fast model (Flash-Lite) so we can afford
// to classify (nearly) EVERY ad instead of a tiny sample: video ads are watched for the
// first few seconds (motion/creator signal), stills use the poster frame. It's bounded
// by a wall-clock budget so a huge set degrades gracefully, and ordered AMBIGUOUS-FIRST
// so the ads that actually need AI are analysed before any budget cutoff.
const PAID_AD_AI_MAX = parseInt(process.env.PAID_AD_AI_MAX ?? process.env.PAID_AD_VISION_MAX ?? "300", 10) || 300;
const PAID_AD_AI_BUDGET_SECS = parseInt(process.env.PAID_AD_AI_BUDGET_SECS ?? "200", 10) || 200;
const PAID_AD_COPY_MAX = parseInt(process.env.PAID_AD_COPY_MAX ?? "300", 10) || 300;

/** True if the ad was running at any point within the last PAID_AD_ANALYSIS_MONTHS. */
function adWithinWindow(ad: { startTime?: string | null; stopTime?: string | null; isActive?: boolean }, now = Date.now()): boolean {
  const cutoff = now - PAID_AD_ANALYSIS_MONTHS * 30 * 86_400_000;
  const t = (s?: string | null) => { if (!s) return null; const d = new Date(s).getTime(); return Number.isNaN(d) ? null : d; };
  if (ad.isActive) return true;                       // still live
  const stop = t(ad.stopTime); if (stop != null) return stop >= cutoff;   // stopped within window
  const start = t(ad.startTime); if (start != null) return start >= cutoff; // started within window
  return true;                                        // unknown dates → keep (best-effort)
}

/**
 * Enrich raw ads → SocialPaidAd, rank active-first then longest-running, and keep
 * EVERY ad launched/active in the last PAID_AD_ANALYSIS_MONTHS (default 6) — no
 * small top-N cap. A hard ceiling guards against pathological brands.
 */
function prepPaidAds(raw: SocialPaidAdLike[]): SocialPaidAd[] {
  return raw
    .map(ad => enrichPaidAd(ad))
    .filter(ad => adWithinWindow(ad))
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return (b.runningDays ?? 0) - (a.runningDays ?? 0);
    })
    .slice(0, PAID_AD_HARD_CAP);
}

export class MetaSocialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaSocialError";
  }
}

interface MetaSocialConfig {
  accessToken: string;
  pageId: string;
  igBusinessId: string;
  apiVersion: string;
  lookbackDays: number;
  maxPostsPerPlatform: number;
}

interface PublicScraperConfig {
  apifyToken: string;
  instagramProfile: string;
  facebookPage: string;
  lookbackDays: number;
  maxPostsPerPlatform: number;
  waitSecs: number;
}

export function getApifyToken(): string {
  return (process.env.SR_APIFY_TOKEN ?? process.env.APIFY_API_TOKEN ?? process.env.APIFY_TOKEN ?? "").trim();
}

function loadMetaSocialConfig(): MetaSocialConfig | null {
  const enabled = (process.env.META_SOCIAL_ENABLED ?? "true").toLowerCase();
  if (["0", "false", "no"].includes(enabled)) return null;
  const token = (process.env.META_ACCESS_TOKEN ?? "").trim();
  const pageId = (process.env.META_PAGE_ID ?? "").trim();
  if (!token || !pageId) return null;
  const lookback = parseInt(process.env.META_SOCIAL_LOOKBACK_DAYS ?? "90", 10) || 90;
  const maxPosts = parseInt(process.env.META_SOCIAL_MAX_POSTS ?? "200", 10) || 200;
  return {
    accessToken: token,
    pageId,
    igBusinessId: (process.env.META_IG_BUSINESS_ID ?? "").trim(),
    apiVersion: (process.env.META_API_VERSION ?? "v21.0").trim() || "v21.0",
    lookbackDays: Math.max(7, lookback),
    maxPostsPerPlatform: Math.max(10, maxPosts),
  };
}

function isMetaSocialConfigured(): boolean {
  return loadMetaSocialConfig() !== null;
}

function loadPublicScraperConfig(): PublicScraperConfig | null {
  const enabled = (process.env.PUBLIC_SOCIAL_ENABLED ?? "true").toLowerCase();
  if (["0", "false", "no"].includes(enabled)) return null;
  const token = getApifyToken();
  if (!token) return null;
  const lookback = parseInt(process.env.PUBLIC_SOCIAL_LOOKBACK_DAYS ?? process.env.META_SOCIAL_LOOKBACK_DAYS ?? "90", 10) || 90;
  const maxPosts = parseInt(process.env.PUBLIC_SOCIAL_MAX_POSTS ?? "200", 10) || 200;
  const wait = parseInt(process.env.PUBLIC_SOCIAL_WAIT_SECS ?? "180", 10) || 180;
  return {
    apifyToken: token,
    instagramProfile: (process.env.BRAND_INSTAGRAM_URL ?? process.env.BRAND_INSTAGRAM_HANDLE ?? "").trim(),
    facebookPage: (process.env.BRAND_FACEBOOK_URL ?? process.env.BRAND_FACEBOOK_PAGE ?? "").trim(),
    lookbackDays: Math.max(7, lookback),
    maxPostsPerPlatform: Math.max(10, maxPosts),
    waitSecs: Math.max(60, wait),
  };
}

function isPublicSocialConfigured(): boolean {
  const enabled = (process.env.PUBLIC_SOCIAL_ENABLED ?? "true").toLowerCase();
  if (["0", "false", "no"].includes(enabled)) return false;
  return Boolean(getApifyToken());
}

export function resolveSocialSource(mode: string): "graph" | "public" | null {
  const m = (mode ?? "auto").trim().toLowerCase();
  const graphOk = isMetaSocialConfigured();
  const publicOk = isPublicSocialConfigured();
  if (m === "graph") return graphOk ? "graph" : null;
  if (m === "public") return publicOk ? "public" : null;
  if (graphOk) return "graph";
  if (publicOk) return "public";
  return null;
}

export function isSocialStepEnabled(mode = "auto"): boolean {
  const m = (mode ?? "auto").trim().toLowerCase();
  if (m === "public" || m === "graph") return true;
  return resolveSocialSource("auto") !== null;
}

async function metaGraphGet(accessToken: string, apiVersion: string, path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const base = `https://graph.facebook.com/${apiVersion}`;
  const url = new URL(`${base}/${path}`);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new MetaSocialError(`Meta Graph API error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

async function metaGraphGetAll(accessToken: string, apiVersion: string, path: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let data = await metaGraphGet(accessToken, apiVersion, path, params);
  while (true) {
    const items = (data.data as Record<string, unknown>[] | undefined) ?? [];
    results.push(...items);
    const nextUrl = (data.paging as Record<string, unknown> | undefined)?.next as string | undefined;
    if (!nextUrl) break;
    const res = await fetch(nextUrl);
    if (!res.ok) break;
    data = await res.json() as Record<string, unknown>;
  }
  return results;
}

function withinLookback(isoTime: string | null | undefined, cutoff: Date): boolean {
  if (!isoTime) return true;
  try {
    const dt = new Date(isoTime.replace("Z", "+00:00"));
    return dt >= cutoff;
  } catch {
    return true;
  }
}

function extractFbImage(post: Record<string, unknown>): string | null {
  const attachments = ((post.attachments as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] | undefined) ?? [];
  for (const att of attachments) {
    const media = att.media as Record<string, unknown> | undefined;
    const image = media?.image as Record<string, unknown> | undefined;
    if (image?.src) return String(image.src);
    const subs = ((att.subattachments as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] | undefined) ?? [];
    for (const sub of subs) {
      const subMedia = sub.media as Record<string, unknown> | undefined;
      const subImg = subMedia?.image as Record<string, unknown> | undefined;
      if (subImg?.src) return String(subImg.src);
    }
  }
  return null;
}

function extractFbLinks(post: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const attachments = ((post.attachments as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] | undefined) ?? [];
  for (const att of attachments) {
    if (att.unshimmed_url) urls.push(String(att.unshimmed_url));
    if (att.url) urls.push(String(att.url));
    const target = att.target as Record<string, unknown> | undefined;
    if (target?.url) urls.push(String(target.url));
    const subs = ((att.subattachments as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] | undefined) ?? [];
    for (const sub of subs) {
      if (sub.unshimmed_url) urls.push(String(sub.unshimmed_url));
    }
  }
  return urls;
}

async function fetchFacebookPagePosts(config: MetaSocialConfig): Promise<RawSocialPost[]> {
  const cutoff = new Date(Date.now() - config.lookbackDays * 86400000);
  const fields = "id,message,created_time,permalink_url,attachments{unshimmed_url,url,title,description,target,subattachments}";
  let rows: Record<string, unknown>[];
  try {
    rows = await metaGraphGetAll(config.accessToken, config.apiVersion, `${config.pageId}/published_posts`, { fields, limit: "50" });
  } catch {
    rows = await metaGraphGetAll(config.accessToken, config.apiVersion, `${config.pageId}/posts`, { fields, limit: "50" });
  }
  const out: RawSocialPost[] = [];
  for (const row of rows.slice(0, config.maxPostsPerPlatform)) {
    if (!withinLookback(row.created_time as string | undefined, cutoff)) continue;
    const img = extractFbImage(row);
    out.push({
      platform: "facebook",
      post_id: String(row.id ?? ""),
      post_url: String(row.permalink_url ?? ""),
      caption: String(row.message ?? ""),
      created_at: row.created_time as string | undefined ?? null,
      media_type: "post",
      likes: 0,
      comments: 0,
      link_urls: extractFbLinks(row),
      image_url: img,
      thumbnail_url: img,
    });
  }
  return out;
}

function igFormat(mediaType: string, children: unknown[]): string {
  const mt = (mediaType ?? "").toUpperCase();
  if (mt === "VIDEO") return "Reel";
  if (mt === "CAROUSEL_ALBUM") return "Carousel";
  if (mt === "IMAGE") return "Static";
  if (children.length) return "Carousel";
  return "Static";
}

async function fetchInstagramMedia(config: MetaSocialConfig): Promise<RawSocialPost[]> {
  if (!config.igBusinessId) return [];
  const cutoff = new Date(Date.now() - config.lookbackDays * 86400000);
  const fields = "id,caption,timestamp,permalink,media_type,media_url,thumbnail_url,like_count,comments_count,children{media_type,media_url,thumbnail_url}";
  const rows = await metaGraphGetAll(config.accessToken, config.apiVersion, `${config.igBusinessId}/media`, { fields, limit: "50" });
  const out: RawSocialPost[] = [];
  for (const row of rows.slice(0, config.maxPostsPerPlatform)) {
    if (!withinLookback(row.timestamp as string | undefined, cutoff)) continue;
    const children = ((row.children as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] | undefined) ?? [];
    const permalink = String(row.permalink ?? "");
    let imageUrl = String(row.media_url ?? row.thumbnail_url ?? "");
    if (!imageUrl && children.length) {
      imageUrl = String(children[0].media_url ?? children[0].thumbnail_url ?? "");
    }
    const thumb = String(row.thumbnail_url ?? imageUrl ?? "") || null;
    out.push({
      platform: "instagram",
      post_id: String(row.id ?? ""),
      post_url: permalink,
      caption: String(row.caption ?? ""),
      created_at: row.timestamp as string | undefined ?? null,
      media_type: igFormat(String(row.media_type ?? ""), children),
      likes: parseInt(String(row.like_count ?? 0), 10),
      comments: parseInt(String(row.comments_count ?? 0), 10),
      link_urls: permalink ? [permalink] : [],
      image_url: imageUrl || null,
      thumbnail_url: thumb,
    });
  }
  return out;
}

const APIFY_BASE = "https://api.apify.com/v2";

async function apifyFetch(token: string, url: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
}

export async function runApifyActor(token: string, actorId: string, input: Record<string, unknown>, waitSecs: number, memoryMbytes = 256): Promise<Record<string, unknown>[]> {
  // Apify REST API uses ~ as separator: "apify/instagram-scraper" → "apify~instagram-scraper"
  const safeId = actorId.replace("/", "~");
  // memoryMbytes matters: the Ad Library scraper's DEFAULT is 4096 MB — forcing 256
  // starves it, so it runs slow and returns only a PARTIAL page of ads (undercount).
  const runUrl = `${APIFY_BASE}/acts/${safeId}/runs?memory=${memoryMbytes}&waitForFinish=${Math.min(waitSecs, 300)}`;
  const res = await apifyFetch(token, runUrl, { method: "POST", body: JSON.stringify(input) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Apify run failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const runData = await res.json() as Record<string, unknown>;
  const run = (runData.data as Record<string, unknown> | undefined) ?? runData;
  const runId = run.id as string | undefined;
  const datasetId = run.defaultDatasetId as string | undefined;
  if (!runId) throw new Error("Apify: no run ID returned");

  // Poll until SUCCEEDED if still running after initial wait
  let status = String(run.status ?? "RUNNING");
  const deadline = Date.now() + waitSecs * 1000;
  while (["RUNNING", "READY"].includes(status) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 8000));
    const pollRes = await apifyFetch(token, `${APIFY_BASE}/actor-runs/${runId}`);
    if (!pollRes.ok) break;
    const pollData = await pollRes.json() as Record<string, unknown>;
    status = String((pollData.data as Record<string, unknown> | undefined)?.status ?? status);
  }

  // If the run hasn't finished, we're about to read a PARTIAL dataset — surface it,
  // because that silently undercounts (e.g. a brand's ad total looks lower than Meta).
  if (["RUNNING", "READY"].includes(status)) {
    console.warn(`[apify] ${actorId} still ${status} after ${waitSecs}s — reading partial results (count may be low). Raise the wait or memory.`);
  }

  // Fetch dataset items — prefer defaultDatasetId, fall back to run dataset endpoint
  const itemsUrl = datasetId
    ? `${APIFY_BASE}/datasets/${datasetId}/items?format=json&clean=true`
    : `${APIFY_BASE}/actor-runs/${runId}/dataset/items`;
  const dataRes = await apifyFetch(token, itemsUrl);
  if (!dataRes.ok) return [];
  const items = await dataRes.json() as Record<string, unknown>[];
  console.log(`[apify] ${actorId} → ${items.length} items (status ${status})`);
  return items;
}


/**
 * Resolve a single Instagram post/reel URL to its direct video (.mp4) URL via the
 * Apify instagram-scraper. Returns null if the link isn't a video or can't be
 * resolved. Used by Clone UGC to feed a reel to the Gemini Files API.
 */
export async function fetchInstagramVideoUrl(url: string): Promise<string | null> {
  const token = getApifyToken();
  if (!token) throw new Error("APIFY_API_TOKEN (or SR_APIFY_TOKEN) is not set — cannot read Instagram reels.");
  const items = await runApifyActor(
    token,
    "apify/instagram-scraper",
    { directUrls: [url], resultsType: "posts", resultsLimit: 1, addParentData: false },
    120,
  );
  for (const item of items) {
    const v = (item.videoUrl ?? item.video_url ?? null) as string | null;
    if (v && /^https?:\/\//i.test(v)) return v;
    // Some payloads put the mp4 in displayUrl for video/reel types.
    const t = String(item.type ?? item.mediaType ?? "").toLowerCase();
    const d = item.displayUrl as string | undefined;
    if ((t.includes("video") || t.includes("reel")) && d && /\.mp4/i.test(d)) return d;
  }
  return null;
}

/**
 * Resolve up to 3 Instagram post/reel URLs to their STILL image URLs via the Apify
 * instagram-scraper. Used by Clone/character generation to ground a creator in a
 * brand's reference aesthetic. Returns https image URLs (deduped, capped ~4).
 */
export async function fetchInstagramImageUrls(urls: string[]): Promise<string[]> {
  const clean = urls.map(u => u.trim()).filter(u => /^https?:\/\//i.test(u)).slice(0, 3);
  if (!clean.length) return [];
  const token = getApifyToken();
  if (!token) throw new Error("APIFY_API_TOKEN (or SR_APIFY_TOKEN) is not set — cannot read Instagram posts.");
  const items = await runApifyActor(
    token,
    "apify/instagram-scraper",
    { directUrls: clean, resultsType: "posts", resultsLimit: clean.length, addParentData: false },
    120,
  );
  const out: string[] = [];
  for (const item of items) {
    const t = String(item.type ?? item.mediaType ?? "").toLowerCase();
    const isVideo = t.includes("video") || t.includes("reel");
    // For video/reel posts the still is the thumbnail; for images use displayUrl.
    const still = isVideo
      ? (item.thumbnailUrl ?? item.displayUrl)
      : (item.displayUrl ?? item.imageUrl ?? item.thumbnailUrl);
    const carousel = Array.isArray(item.images) ? (item.images[0] as string | undefined) : undefined;
    for (const candidate of [still as string | undefined, carousel]) {
      if (candidate && /^https?:\/\//i.test(candidate)) out.push(candidate);
    }
  }
  return Array.from(new Set(out)).slice(0, 4);
}

function parseApifyIgItem(item: Record<string, unknown>): RawSocialPost {
  const mediaType = String(item.type ?? item.mediaType ?? "").toLowerCase();
  const isVideo = mediaType.includes("video") || mediaType.includes("reel");

  // For reels/videos, displayUrl may be the actual video file URL (.mp4) which
  // won't render in an <img> tag. Prefer thumbnailUrl (always a static image).
  const imageUrl = isVideo
    ? (item.thumbnailUrl ?? item.displayUrl ?? item.imageUrl ?? null) as string | null
    : (item.displayUrl ?? item.imageUrl ?? item.thumbnailUrl ?? null) as string | null;

  // Apify returns -1 when like/comment counts are hidden — treat as unknown (0).
  const nonNeg = (v: unknown): number => {
    const n = parseInt(String(v ?? 0), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  return {
    platform: "instagram",
    post_id: String(item.id ?? item.shortCode ?? ""),
    post_url: String(item.url ?? item.permalink ?? `https://www.instagram.com/p/${item.shortCode ?? ""}/`),
    caption: String(item.caption ?? item.text ?? ""),
    created_at: (item.timestamp ?? item.takenAt) as string | undefined ?? null,
    media_type: String(item.type ?? item.mediaType ?? ""),
    likes: nonNeg(item.likesCount ?? item.likes),
    comments: nonNeg(item.commentsCount ?? item.comments),
    views: item.videoViewCount ? parseInt(String(item.videoViewCount), 10) : undefined,
    link_urls: item.url ? [String(item.url)] : [],
    image_url: imageUrl,
    thumbnail_url: (item.thumbnailUrl ?? item.displayUrl ?? null) as string | null,
    owner_username: String(item.ownerUsername ?? item.username ?? "").trim() || null,
    owner_profile_pic: (item.ownerProfilePicUrl ?? item.profilePicUrl ?? item.ownerProfilePicUrlHd ?? null) as string | null,
  };
}

// Known brand → Instagram handle overrides. LLM can't be trusted here, especially for
// regional D2C brands where its training data is thin. This dictionary is the source of truth.
const KNOWN_BRAND_HANDLES: Record<string, string> = {
  // India D2C — skincare/beauty
  "minimalist": "beminimalist",
  "the minimalist": "beminimalist",
  "be minimalist": "beminimalist",
  "mamaearth": "mamaearth.india",
  "the derma co": "thedermacoindia",
  "the derma co.": "thedermacoindia",
  "dermaco": "thedermacoindia",
  "plum": "plumgoodness",
  "plum goodness": "plumgoodness",
  "wow skin science": "wowskinscienceindia",
  "wow": "wowskinscienceindia",
  "biotique": "biotique_india",
  "forest essentials": "forestessentialsindia",
  "kama ayurveda": "kamaayurveda",
  "mcaffeine": "mcaffeineofficial",
  "dot & key": "dotandkey",
  "dot and key": "dotandkey",
  "pilgrim": "discoverpilgrim",
  "sugar cosmetics": "trysugar",
  "sugar": "trysugar",
  "nykaa": "mynykaa",
  "lakme": "lakmeindia",
  "lakmé": "lakmeindia",
  "maybelline india": "maybelline_ind",
  "loreal paris india": "lorealparis",
  "l'oreal paris": "lorealparis",
  // India D2C — wellness/food
  "the man company": "themancompany",
  "bombay shaving company": "bombayshavingcompany",
  "boat": "boat.nirvana",
  "boat lifestyle": "boat.nirvana",
  // Global
  "the ordinary": "theordinary",
  "cerave": "cerave",
  "neutrogena": "neutrogena",
  "olay": "olay",
  "nivea": "niveausa",
};

function checkKnownBrandHandle(brand: string): string | null {
  const key = brand.toLowerCase().trim();
  if (!key) return null;
  // Exact match
  if (KNOWN_BRAND_HANDLES[key]) return KNOWN_BRAND_HANDLES[key];
  // Try without leading "the "
  const without = key.replace(/^the\s+/, "");
  if (KNOWN_BRAND_HANDLES[without]) return KNOWN_BRAND_HANDLES[without];
  // Try with leading "the "
  if (KNOWN_BRAND_HANDLES[`the ${key}`]) return KNOWN_BRAND_HANDLES[`the ${key}`];
  return null;
}

async function discoverBrandInstagramHandle(
  brand: string,
  productTitle: string,
  category: string,
  productUrl?: string,
  footerHandle?: string | null,
): Promise<string | null> {
  // Layer 1: known-brand override — most reliable, zero latency
  const known = checkKnownBrandHandle(brand);
  if (known) {
    console.log(`[social] Known brand override: "${brand}" → @${known}`);
    return known;
  }

  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) {
    console.warn("[social] GEMINI_API_KEY not set — skipping LLM handle discovery");
  } else {
    // Layer 2: Gemini with marketplace context
    let marketplaceContext = "";
    if (productUrl) {
      try {
        const hostname = new URL(productUrl.includes("://") ? productUrl : `https://${productUrl}`).hostname;
        if (hostname.includes(".in")) marketplaceContext = "India (this is an Indian D2C brand sold on amazon.in / flipkart / nykaa / meesho)";
        else if (hostname.includes(".co.uk")) marketplaceContext = "United Kingdom";
        else if (hostname.includes(".de")) marketplaceContext = "Germany";
        else if (hostname.includes("amazon.com")) marketplaceContext = "USA";
      } catch { /* ignore */ }
    }

    const userPrompt = `Find the official Instagram handle for this brand.

Brand: "${brand}"
Product: "${productTitle.slice(0, 150)}"
Category: "${category || "consumer goods"}"${marketplaceContext ? `\nMarket: ${marketplaceContext}` : ""}

CRITICAL: Only respond with a handle if you are highly confident this is the BRAND'S OWN account (not an influencer, not a fan page, not a generic word account).

If unsure, reply "unknown". Better to say unknown than guess.

Reply with ONLY the handle (no @, no explanation) or "unknown".`;

    const GEMINI_HANDLE_MODELS = geminiTextModels();
    for (const model of GEMINI_HANDLE_MODELS) {
      try {
        const fetchPromise = fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 32 },
            }),
          },
        );
        const timeoutPromise = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 12000));
        const res = await Promise.race([fetchPromise, timeoutPromise]) as Response;
        if (!res.ok) {
          console.warn(`[social] Gemini ${model} returned ${res.status} for handle discovery`);
          continue;
        }
        const data = await res.json() as Record<string, unknown>;
        const candidates = (data.candidates as Array<Record<string, unknown>> | undefined) ?? [];
        const parts = (((candidates[0]?.content as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined) ?? []);
        const content = String(parts[0]?.text ?? "").trim();
        const handle = content.toLowerCase().split(/[\s,."'@\n]+/)[0].replace(/[^a-z0-9._]/g, "");
        if (handle && handle !== "unknown" && handle.length >= 2) {
          console.log(`[social] Gemini (${model}) resolved brand "${brand}" → @${handle}`);
          return handle;
        }
        console.warn(`[social] Gemini ${model} returned non-handle for "${brand}": "${content}"`);
        break; // model answered but with low confidence; don't waste calls on fallbacks
      } catch (err) {
        console.warn(`[social] Gemini ${model} handle discovery failed: ${err}`);
        continue;
      }
    }
  }

  // Layer 3 (final fallback): handle scraped from the brand's own website footer.
  // Set by runBrandWebsiteAudit when the user pasted a brand-site URL; for marketplace
  // URLs this is undefined and the function returns null as before.
  if (footerHandle) {
    console.log(`[social] Footer-resolved @${footerHandle} from brand website (last fallback)`);
    return footerHandle;
  }

  return null;
}

// Verify scraped posts actually belong to this brand by checking captions
// contain the brand name or product keywords. Returns true if at least 25% match.
function verifyBrandPosts(posts: RawSocialPost[], brand: string, productTitle: string): boolean {
  if (posts.length === 0) return false;
  const brandTokens = brand.toLowerCase().match(/[a-z]{3,}/g)?.filter(w => !["the", "and"].includes(w)) ?? [];
  const titleTokens = productTitle.toLowerCase().match(/[a-z]{4,}/g)?.filter(w => !["with", "for", "from", "this", "your"].includes(w)).slice(0, 6) ?? [];
  const keywords = [...new Set([...brandTokens, ...titleTokens])];
  if (keywords.length === 0) return true; // can't verify, give benefit of doubt

  let matches = 0;
  for (const p of posts) {
    const blob = `${p.caption.toLowerCase()} ${(p.owner_username ?? "").toLowerCase()}`;
    if (keywords.some(k => blob.includes(k))) matches++;
  }
  const ratio = matches / posts.length;
  console.log(`[social] Verification: ${matches}/${posts.length} posts match brand keywords [${keywords.join(",")}] = ${(ratio*100).toFixed(0)}%`);
  return ratio >= 0.25;
}

async function fetchPublicRawPosts(ecomPayload: CombinedScraperData, productUrl?: string, instagramHandleOverride?: string): Promise<[RawSocialPost[], number, number, string[], string | null]> {
  const config = loadPublicScraperConfig();
  if (!config) return [[], 0, 0, ["Public scraper not configured"], null];
  const warnings: string[] = [];
  const allRaw: RawSocialPost[] = [];
  let igFetched = 0;
  let fbFetched = 0;
  let resolvedAccountHandle: string | null = null;

  const products = ecomPayload.ecom?.products ?? [];
  const product = (products[0] ?? {}) as Record<string, unknown>;
  const brand = String(product.brand ?? "").trim();
  const productTitle = String(product.title ?? product.name ?? "").trim();
  const category = String(product.category ?? product.categories ?? "").trim();

  // Resolution priority for the brand's Instagram account:
  // 1. User-supplied handle (from form) — highest trust, skips verification
  // 2. BRAND_INSTAGRAM_URL env var — also skips verification
  // 3. Known-brand dictionary lookup — high trust
  // 4. Gemini resolution — verified against post content before use
  // 5. Brand-website footer-scraped handle (last resort)
  let profileUrl: string | null = null;
  let userProvidedHandle = false;

  if (instagramHandleOverride) {
    const clean = instagramHandleOverride.replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "").replace(/\/$/, "");
    if (clean) {
      profileUrl = `https://www.instagram.com/${clean}/`;
      resolvedAccountHandle = clean;
      userProvidedHandle = true;
      console.log(`[social] User-provided Instagram handle: @${clean}`);
    }
  }

  if (!profileUrl) profileUrl = config.instagramProfile || null;

  // Pull any footer-scraped IG handle out of the ecom payload (set by runBrandWebsiteAudit).
  // This becomes the LAST fallback inside discoverBrandInstagramHandle — used only if the
  // dictionary and the LLM both fail.
  const footerHandle = (() => {
    const products = ecomPayload.ecom?.products ?? [];
    const social = (products[0] as Record<string, unknown> | undefined)?.socialLinks as Record<string, unknown> | null | undefined;
    const ig = social?.instagram;
    return typeof ig === "string" && ig.trim().length >= 2 ? ig.trim().toLowerCase() : null;
  })();

  if (!profileUrl && brand) {
    const handle = await discoverBrandInstagramHandle(brand, productTitle, category, productUrl, footerHandle);
    if (handle) {
      profileUrl = `https://www.instagram.com/${handle}/`;
      resolvedAccountHandle = handle;
    }
  } else if (profileUrl && !resolvedAccountHandle) {
    resolvedAccountHandle = profileUrl.replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "").replace(/\/$/, "");
  }

  // Derive the brand handle (slug) for hashtag fallback — e.g. "The Minimalist" → "beminimalist"
  const resolvedHandle = profileUrl
    ? profileUrl.replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "").replace(/\/$/, "")
    : null;

  if (profileUrl) {
    // Phase 1: scrape the brand's profile directly (highest quality — own posts only)
    try {
      console.log(`[social] Phase 1 — scraping Instagram profile: ${profileUrl}`);
      const items = await runApifyActor(config.apifyToken, "apify/instagram-scraper", {
        directUrls: [profileUrl],
        resultsType: "posts",
        resultsLimit: Math.min(config.maxPostsPerPlatform, 30),
      }, config.waitSecs, PUBLIC_SOCIAL_ACTOR_MEMORY);
      const scraped: RawSocialPost[] = [];
      for (const item of items) scraped.push(parseApifyIgItem(item));

      // VERIFY: posts must mention brand keywords. If not, this is the WRONG account.
      // Skip verification when user explicitly set the handle (form or env var) — they know what they want.
      const shouldVerify = !userProvidedHandle && !config.instagramProfile && brand;
      const verified = shouldVerify ? verifyBrandPosts(scraped, brand, productTitle) : true;

      if (verified) {
        for (const p of scraped) allRaw.push(p);
        igFetched = allRaw.length;
        if (igFetched > 0) {
          const handle = allRaw[0].owner_username ?? resolvedHandle ?? "unknown";
          console.log(`[social] Phase 1 OK — ${igFetched} posts from @${handle} (verified)`);
        }
      } else {
        warnings.push(`Resolved Instagram handle @${resolvedHandle} did NOT match brand "${brand}" content. Posts discarded.`);
        console.warn(`[social] Phase 1 REJECTED — @${resolvedHandle} content doesn't match brand "${brand}". Discarding ${scraped.length} posts.`);
        resolvedAccountHandle = null; // clear so the UI doesn't show the wrong handle
      }
    } catch (err) {
      console.warn(`[social] Phase 1 profile scrape failed: ${err}`);
    }

    // Phase 2: if profile scrape returned nothing, search the brand handle as a hashtag
    // e.g. #beminimalist gives posts about the brand — far more specific than #minimalist
    if (allRaw.length === 0 && resolvedHandle) {
      try {
        const hashtagUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(resolvedHandle)}/`;
        console.log(`[social] Phase 2 — hashtag fallback: #${resolvedHandle}`);
        const items = await runApifyActor(config.apifyToken, "apify/instagram-scraper", {
          directUrls: [hashtagUrl],
          resultsType: "posts",
          resultsLimit: Math.min(config.maxPostsPerPlatform, 20),
          searchType: "hashtag",
        }, config.waitSecs, PUBLIC_SOCIAL_ACTOR_MEMORY);
        for (const item of items) allRaw.push(parseApifyIgItem(item));
        igFetched = allRaw.length;
        if (igFetched > 0) {
          console.log(`[social] Phase 2 OK — ${igFetched} posts tagged #${resolvedHandle}`);
        } else {
          warnings.push(`Instagram: 0 posts found via profile (${profileUrl}) and hashtag (#${resolvedHandle}). Account may be private or rate-limited.`);
        }
      } catch (err) {
        warnings.push(`Instagram hashtag fallback (#${resolvedHandle}) failed: ${err}`);
      }
    }
  } else {
    warnings.push(
      brand
        ? `Instagram handle unknown for brand "${brand}". Set BRAND_INSTAGRAM_URL=https://www.instagram.com/<handle>/ in env to enable Instagram scraping.`
        : "No brand name in product data — Instagram scraping skipped."
    );
  }

  // --- Facebook: brand page only (requires explicit URL) ---
  if (config.facebookPage) {
    try {
      const before = allRaw.length;
      const items = await runApifyActor(config.apifyToken, "apify/facebook-posts-scraper", {
        startUrls: [{ url: config.facebookPage }],
        resultsLimit: config.maxPostsPerPlatform,
      }, config.waitSecs);
      for (const item of items) {
        allRaw.push({
          platform: "facebook",
          post_id: String(item.postId ?? item.id ?? ""),
          post_url: String(item.url ?? ""),
          caption: String(item.text ?? item.message ?? ""),
          created_at: item.time as string | undefined ?? null,
          media_type: "post",
          likes: parseInt(String(item.likes ?? 0), 10),
          comments: parseInt(String(item.comments ?? 0), 10),
          link_urls: item.link ? [String(item.link)] : [],
          image_url: (Array.isArray(item.media) ? (item.media[0] as Record<string, unknown>)?.thumbnail : null) as string | null,
          thumbnail_url: (Array.isArray(item.media) ? (item.media[0] as Record<string, unknown>)?.thumbnail : null) as string | null,
        });
      }
      fbFetched = allRaw.length - before;
    } catch (err) {
      warnings.push(`Facebook Apify fetch failed: ${err}`);
    }
  }

  return [allRaw, igFetched, fbFetched, warnings, resolvedAccountHandle];
}

function extractBrandNameFromPayload(ecomPayload: CombinedScraperData): string {
  const products = ecomPayload.ecom?.products ?? [];
  const product = (products[0] ?? {}) as Record<string, unknown>;
  return String(product.brand ?? product.name ?? "").trim();
}

function extractIgHandle(urlOrHandle: string): string {
  const s = urlOrHandle.trim().replace(/\/$/, "");
  const match = s.match(/instagram\.com\/([^/?#]+)/i);
  return match ? match[1] : s.replace(/^@/, "");
}

const RESERVED_FACEBOOK_PATHS = new Set([
  "ads", "groups", "watch", "marketplace", "gaming", "events", "people", "pages",
  "login", "help", "share", "sharer", "dialog", "plugins", "photo", "photos",
  "video", "videos", "reel", "reels", "stories", "hashtag", "profile.php",
]);

/** Page slug from facebook.com/PAGENAME (not Ad Library, not reserved paths). */
function extractFacebookPageSlug(url: string): string | null {
  try {
    const u = new URL(url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`);
    if (!u.hostname.includes("facebook.com")) return null;
    if (u.pathname.includes("/ads/library")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length !== 1) return null;
    const slug = parts[0];
    if (RESERVED_FACEBOOK_PATHS.has(slug.toLowerCase())) return null;
    return slug;
  } catch {
    return null;
  }
}

/** Ad Library URL or Facebook Page URL — both work with the Apify actor's `urls` input. */
function isDirectMetaAdsScrapeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed.includes("facebook.com")) return false;
  if (trimmed.includes("facebook.com/ads/library")) return true;
  return !!extractFacebookPageSlug(trimmed);
}

function resolveAdsSearchKeyword(
  ecomPayload: CombinedScraperData,
  instagramHandle?: string,
  adLibraryUrl?: string,
): string {
  if (instagramHandle) return extractIgHandle(instagramHandle);
  if (adLibraryUrl?.trim()) {
    try {
      const u = new URL(adLibraryUrl.trim().startsWith("http") ? adLibraryUrl.trim() : `https://${adLibraryUrl.trim()}`);
      const q = u.searchParams.get("q");
      if (q) return q;
    } catch { /* fall through */ }
    const slug = extractFacebookPageSlug(adLibraryUrl);
    if (slug) return slug;
  }
  const igUrl = (process.env.BRAND_INSTAGRAM_URL ?? process.env.BRAND_INSTAGRAM_HANDLE ?? "").trim();
  if (igUrl) return extractIgHandle(igUrl);
  return extractBrandNameFromPayload(ecomPayload);
}

async function fetchMetaAdsLibraryViaApify(
  apifyToken: string,
  keyword: string,
  country: string,
  limit: number,
  activeStatus = metaAdsActiveStatus(),
): Promise<SocialPaidAdLike[]> {
  if (!keyword) return [];

  console.log(`[ads] Searching Meta Ads Library for: "${keyword}" (country: ${country})`);
  const items = await runApifyActor(apifyToken, "automly/facebook-ad-library-scraper", {
    searchTerms: [keyword],
    country,
    activeStatus,
    mediaType: "all",
    maxAds: Math.max(limit, META_ADS_SCRAPE_MAX),
  }, META_ADS_WAIT_SECS, META_ADS_ACTOR_MEMORY);

  const mapped = sortApifyItemsByStartTime(items as Record<string, unknown>[])
    .map(item => mapApifyAdItem(item, { matchPrefix: "via Apify" }))
    .filter((ad): ad is SocialPaidAdLike => ad !== null);

  return dedupeApifyAds(mapped).slice(0, Math.max(limit, META_ADS_SCRAPE_MAX));
}

// ── Decoupled deep-scrape helpers ────────────────────────────────────────────
// The Ad Library actor runs ON APIFY (not in our function), so for very large
// advertisers (Flipkart ~6.9k ads → 15-25 min) we START the run, POLL it across
// short calls, then FETCH the completed dataset — none of which needs to fit the
// 800s function limit. Used by /api/deep-scrape.

/** Start an Apify actor run WITHOUT waiting. Returns the run + dataset ids. */
export async function startApifyRun(token: string, actorId: string, input: Record<string, unknown>, memoryMbytes = META_ADS_ACTOR_MEMORY): Promise<{ runId: string; datasetId: string | null }> {
  const safeId = actorId.replace("/", "~");
  const res = await apifyFetch(token, `${APIFY_BASE}/acts/${safeId}/runs?memory=${memoryMbytes}`, { method: "POST", body: JSON.stringify(input) });
  if (!res.ok) throw new Error(`Apify start failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const d = await res.json() as Record<string, unknown>;
  const run = (d.data as Record<string, unknown>) ?? d;
  const runId = run.id as string | undefined;
  if (!runId) throw new Error("Apify: no run id returned");
  return { runId, datasetId: (run.defaultDatasetId as string) ?? null };
}

/** Poll one Apify run: status + how many items it has produced so far. */
export async function getApifyRunStatus(token: string, runId: string): Promise<{ status: string; itemCount: number; datasetId: string | null }> {
  const res = await apifyFetch(token, `${APIFY_BASE}/actor-runs/${encodeURIComponent(runId)}`);
  if (!res.ok) throw new Error(`Apify status HTTP ${res.status}`);
  const d = await res.json() as Record<string, unknown>;
  const run = (d.data as Record<string, unknown>) ?? d;
  const stats = (run.stats as Record<string, unknown>) ?? {};
  return { status: String(run.status ?? "UNKNOWN"), itemCount: Number(stats.itemCount ?? 0) || 0, datasetId: (run.defaultDatasetId as string) ?? null };
}

/** Start an Ad Library scrape for a URL without waiting (decoupled deep-scrape). */
export async function startAdLibraryScrapeRun(url: string): Promise<{ runId: string; datasetId: string | null }> {
  const token = getApifyToken();
  if (!token) throw new Error("APIFY token not configured on the server");
  return startApifyRun(token, "automly/facebook-ad-library-scraper", {
    urls: [{ url: withActiveStatus(url, "all") }],
    activeStatus: "all",
    mediaType: "all",
    maxAds: META_ADS_SCRAPE_MAX,
  });
}

/** Fetch RAW Apify dataset items (unmapped) — for inspecting scraper output fields. */
export async function fetchApifyDatasetRaw(datasetId: string, limit = 8): Promise<Record<string, unknown>[]> {
  const token = getApifyToken();
  if (!token) return [];
  const res = await apifyFetch(token, `${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items?format=json&clean=true&limit=${limit}`);
  if (!res.ok) return [];
  return await res.json() as Record<string, unknown>[];
}

/** Fetch a completed Ad Library dataset and map it to paid-ad-likes (decoupled deep-scrape). */
export async function mapAdLibraryDataset(datasetId: string): Promise<SocialPaidAdLike[]> {
  const token = getApifyToken();
  if (!token) return [];
  const res = await apifyFetch(token, `${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items?format=json&clean=true`);
  if (!res.ok) return [];
  const items = await res.json() as Record<string, unknown>[];
  return sortApifyItemsByStartTime(items)
    .map(item => mapApifyAdItem(item, { matchPrefix: "via Ad Library" }))
    .filter((ad): ad is SocialPaidAdLike => ad !== null);
}

async function runApifyAdLibraryScrape(
  apifyToken: string,
  input: Record<string, unknown>,
  activeStatus: "active" | "inactive" | "all",
  waitSecs = META_ADS_WAIT_SECS,
): Promise<SocialPaidAdLike[]> {
  const items = await runApifyActor(apifyToken, "automly/facebook-ad-library-scraper", {
    ...input,
    activeStatus,
    mediaType: "all",
    maxAds: META_ADS_SCRAPE_MAX,
  }, waitSecs, META_ADS_ACTOR_MEMORY);

  return sortApifyItemsByStartTime(items as Record<string, unknown>[])
    .map(item => mapApifyAdItem(item, { matchPrefix: "via Ad Library" }))
    .filter((ad): ad is SocialPaidAdLike => ad !== null);
}

/**
 * Fetch ads from a Meta Ad Library URL.
 *
 * Pass the URL directly to the Apify actor's `urls` input — it scrapes exactly
 * that page (page-specific, keyword, or any Ad Library URL). No lookups, no
 * filtering, no Meta Graph API. Just basic scraping of the link you give it.
 */
export async function fetchAdsFromAdLibraryUrl(
  adLibraryUrl: string,
  limit = 30,
): Promise<{ ads: SocialPaidAdLike[]; label: string; mode: string; error?: string }> {
  const url = adLibraryUrl.trim();
  if (!url || !isDirectMetaAdsScrapeUrl(url)) {
    return {
      ads: [],
      label: "",
      mode: "url",
      error: "Paste a Meta Ad Library URL (facebook.com/ads/library/...) or a Facebook Page URL (facebook.com/BRAND)",
    };
  }

  const apifyToken = getApifyToken();
  if (!apifyToken) {
    return {
      ads: [],
      label: "",
      mode: "url",
      error: "APIFY_API_TOKEN (or SR_APIFY_TOKEN) is not set on the server — paid ads cannot be fetched.",
    };
  }

  const params = parseAdLibraryUrlParams(url);
  // Always scrape ALL statuses (active + inactive). Meta's "~N results" header counts
  // ALL of a page's ads; scraping active-only made our total read low (e.g. 72 vs ~77).
  // We still expose the active subset separately downstream (isActive).
  const activeStatus = "all" as const;
  const scrapeUrl = withActiveStatus(url, "all");
  const country = (params.country ?? process.env.META_AD_LIBRARY_COUNTRY ?? "ALL").toUpperCase();

  // Extract a human-readable label from the URL for display
  let label = params.q ?? params.viewAllPageId ?? "Ad Library";
  if (label === "Ad Library") {
    try {
      const u = new URL(url.startsWith("http") ? url : `https://${url}`);
      label = u.searchParams.get("q") || u.searchParams.get("view_all_page_id") || extractFacebookPageSlug(url) || "Ad Library";
    } catch { /* keep default */ }
  }

  if (!adLibraryUrlHasTargeting(url)) {
    return {
      ads: [],
      label,
      mode: "url",
      error:
        "Ad Library URL is incomplete — open the brand in Meta Ad Library, click their page, and copy the full URL (must include view_all_page_id= or q=).",
    };
  }

  try {
    console.log(`[paid-ads] Scraping Ad Library URL directly (all statuses): ${scrapeUrl.slice(0, 120)}…`);
    let mapped = await runApifyAdLibraryScrape(apifyToken, { urls: [{ url: scrapeUrl }] }, activeStatus);

    // A page-id URL that returns 0 during a busy multi-brand run is almost always a
    // transient miss — the Apify run got queued/starved behind other concurrent scrapes
    // and didn't finish in the wait window (the SAME URL scrapes fine on its own). Retry
    // the URL once before giving up. (Only page-id URLs had no fallback; q-URLs already retry.)
    if (mapped.length === 0 && params.viewAllPageId) {
      console.log(`[paid-ads] URL scrape returned 0 for page ${params.viewAllPageId} — retrying the URL once`);
      mapped = await runApifyAdLibraryScrape(apifyToken, { urls: [{ url: scrapeUrl }] }, activeStatus);
    }

    if (mapped.length === 0 && params.q) {
      console.log(`[paid-ads] URL scrape returned 0 — retrying searchTerms: "${params.q}"`);
      mapped = await runApifyAdLibraryScrape(
        apifyToken,
        { searchTerms: [params.q], country },
        activeStatus,
      );
    }

    const ads = dedupeApifyAds(mapped).slice(0, limit);
    const resolvedLabel = ads[0]?.pageName || label;

    if (ads.length === 0) {
      return {
        ads,
        label: resolvedLabel,
        mode: "url",
        error:
          "Apify returned 0 ads for this URL. Confirm the URL is the full Ad Library link from your browser and that APIFY_API_TOKEN is valid on Vercel.",
      };
    }

    return { ads, label: resolvedLabel, mode: "url" };
  } catch (err) {
    return { ads: [], label, mode: "url", error: String(err) };
  }
}

/** Force a specific `active_status` on a Meta Ad Library URL (so the pasted filter
 *  doesn't limit the scrape — we want the full set and slice active/inactive ourselves). */
function withActiveStatus(url: string, status: "active" | "inactive" | "all"): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    u.searchParams.set("active_status", status);
    return u.toString();
  } catch { return url; }
}

/** Add/replace a `q` keyword on a Meta Ad Library URL to scope the scrape. */
function withAdKeyword(url: string, keyword: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    u.searchParams.set("q", keyword);
    if (!u.searchParams.get("search_type")) u.searchParams.set("search_type", "keyword_unordered");
    return u.toString();
  } catch { return url; }
}

async function fetchMetaAdsLibrary(
  ecomPayload: CombinedScraperData,
  instagramHandle?: string,
  adLibraryUrl?: string,
  adKeyword?: string,
): Promise<MetaAdsFetchResult> {
  const adsEnabled = (process.env.META_ADS_ENABLED ?? "true").toLowerCase();
  if (["0", "false", "no"].includes(adsEnabled)) {
    return { ads: [], fetchError: "Meta paid ads are disabled (META_ADS_ENABLED=false)." };
  }

  const keyword = (adKeyword ?? "").trim();

  // Pull enough ads to cover the last-6-months window (prepPaidAds trims older ones).
  const limit = Math.max(parseInt(process.env.META_ADS_LIMIT ?? "30", 10) || 30, META_ADS_SCRAPE_MAX);

  // If a Meta Ad Library or Facebook Page URL is provided, scrape it directly.
  // A per-competitor keyword scopes that page's scrape (adds ?q=<keyword>).
  if (adLibraryUrl && isDirectMetaAdsScrapeUrl(adLibraryUrl)) {
    const scopedUrl = keyword ? withAdKeyword(adLibraryUrl, keyword) : adLibraryUrl;
    try {
      const { ads, error } = await fetchAdsFromAdLibraryUrl(scopedUrl, limit);
      if (error) console.warn(`[ads] Ad Library URL fetch warning: ${error}`);
      console.log(`[ads] Fetched ${ads.length} ads from provided Ad Library URL`);
      return { ads, fetchError: ads.length === 0 ? error : undefined };
    } catch (err) {
      const msg = String(err);
      console.warn(`[ads] Ad Library URL fetch failed: ${msg}`);
      return { ads: [], fetchError: msg };
    }
  }

  // Otherwise keyword search — by brand name, narrowed by the per-competitor
  // keyword when supplied (e.g. "atomberg fan" instead of all of "atomberg").
  const brandName = resolveAdsSearchKeyword(ecomPayload, instagramHandle, adLibraryUrl);
  if (!brandName && !keyword) {
    return { ads: [], fetchError: "No brand keyword for paid ads — add a product URL, Instagram handle, or Ad Library URL." };
  }
  const searchTerm = [brandName, keyword].filter(Boolean).join(" ").trim();

  const country = (process.env.META_AD_LIBRARY_COUNTRY ?? "IN").toUpperCase();
  const apifyToken = getApifyToken();
  if (!apifyToken) {
    const msg = "APIFY_API_TOKEN (or SR_APIFY_TOKEN) is not set — paid ads cannot be fetched.";
    console.warn(`[ads] ${msg}`);
    return { ads: [], fetchError: msg };
  }

  try {
    const ads = await fetchMetaAdsLibraryViaApify(apifyToken, searchTerm, country, limit);
    console.log(`[ads] Fetched ${ads.length} ads from Meta Ads Library for "${searchTerm}"`);
    return {
      ads,
      fetchError: ads.length === 0 ? `No ads found for keyword "${searchTerm}" in country ${country}.` : undefined,
    };
  } catch (err) {
    const msg = String(err);
    console.warn(`[ads] Meta Ads Library fetch failed: ${msg}`);
    return { ads: [], fetchError: msg };
  }
}

function filterProductPosts(posts: RawSocialPost[], ctx: ProductContext, minScore = 0.35): Array<[RawSocialPost, string, number]> {
  const STOP_WORDS = new Set(["with", "for", "and", "the", "from", "new", "buy", "online", "pack", "set", "ml", "gm", "oz", "free", "off", "offers"]);
  const normalizeUrl = (url: string) => {
    const u = url.trim().toLowerCase().replace(/^(?!https?:\/\/)/, "https://");
    try {
      const parsed = new URL(u);
      const host = parsed.hostname.replace("www.", "");
      const path = parsed.pathname.replace(/\/$/, "");
      const qs = parsed.search || "";
      return `${host}${path}${qs}`;
    } catch {
      return u;
    }
  };

  const urlVariants = new Set<string>();
  if (ctx.product_url) {
    urlVariants.add(normalizeUrl(ctx.product_url));
    try {
      const parsed = new URL(ctx.product_url.includes("://") ? ctx.product_url : `https://${ctx.product_url}`);
      if (parsed.pathname) urlVariants.add(parsed.pathname.replace(/\/$/, "").toLowerCase());
    } catch {}
    if (ctx.asin_or_id) {
      urlVariants.add(ctx.asin_or_id.toLowerCase());
      urlVariants.add(`/dp/${ctx.asin_or_id.toLowerCase()}`);
      urlVariants.add(`/p/${ctx.asin_or_id.toLowerCase()}`);
      urlVariants.add(`pid=${ctx.asin_or_id.toLowerCase()}`);
    }
  }
  const cleanVariants = [...urlVariants].filter(v => v.length > 3);

  const text = `${ctx.title} ${ctx.brand} ${ctx.category} ${(ctx.bullets ?? []).slice(0, 6).join(" ")}`;
  const keywords = new Set(
    text.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter(w => !STOP_WORDS.has(w) && isNaN(Number(w))) ?? []
  );

  const matched: Array<[RawSocialPost, string, number]> = [];
  for (const post of posts) {
    const blob = `${post.caption.toLowerCase()} ${post.post_url.toLowerCase()} ${post.link_urls.join(" ")}`;
    if (!blob.trim()) continue;

    let found = false;
    for (const variant of cleanVariants) {
      if (blob.includes(variant)) {
        matched.push([post, "url", 1.0]);
        found = true;
        break;
      }
    }
    if (found) continue;

    if (keywords.size === 0) continue;
    const hits = [...keywords].filter(k => blob.includes(k)).length;
    const ratio = hits / Math.max(keywords.size, 1);
    const titleTokens = (ctx.title.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(w => !STOP_WORDS.has(w));
    const titleHits = titleTokens.slice(0, 6).filter(w => blob.includes(w)).length;

    if (titleTokens.length && titleHits >= Math.max(2, Math.floor(titleTokens.length / 2))) {
      if (0.85 >= minScore) matched.push([post, "title_keywords", 0.85]);
    } else if (ratio >= 0.35 && hits >= 3) {
      const score = Math.min(0.9, ratio);
      if (score >= minScore) matched.push([post, "keywords", score]);
    } else if (ratio >= 0.5 && hits >= 2 && keywords.size <= 6) {
      if (0.75 >= minScore) matched.push([post, "keywords_short", 0.75]);
    }
  }
  return matched;
}

function buildSocialSnapshot(
  posts: Array<{ post: RawSocialPost; angle: string; hook?: string; cta?: string; analysis?: string; isProductMatch?: boolean }>,
  opts: {
    totalFetched: number;
    igFetched: number;
    fbFetched: number;
    dataSource: string;
    paidAds?: SocialPaidAdLike[];
    paidAdsAnalysis?: string | null;
    paidAdsFetchError?: string | null;
    googleAds?: SocialPaidAdLike[];
    googleAdsAnalysis?: string | null;
    googleAdsFetchError?: string | null;
  }
): [SocialSnapshot, SourceCounts] {
  const allLikes = posts.reduce((s, p) => s + p.post.likes, 0);
  const allComments = posts.reduce((s, p) => s + p.post.comments, 0);
  const totalInteractions = allLikes + allComments;
  const avgEr = posts.length && opts.totalFetched
    ? Math.round((totalInteractions / opts.totalFetched) * 100) / 100
    : null;

  const buckets: Record<string, { posts: number; er: number[] }> = {};
  for (const p of posts) {
    const key = p.angle || "General";
    if (!buckets[key]) buckets[key] = { posts: 0, er: [] };
    buckets[key].posts++;
    // RawSocialPost doesn't have engagementRate; skip for now
  }

  const byContentBucket = Object.entries(buckets)
    .sort((a, b) => b[1].posts - a[1].posts)
    .map(([key, v]) => ({
      key,
      posts: v.posts,
      avgEngagementRate: v.er.length ? Math.round(v.er.reduce((a, b) => a + b, 0) / v.er.length * 100) / 100 : null,
    }));

  const formats: Record<string, number> = {};
  for (const p of posts) {
    const fmt = p.post.media_type || "post";
    formats[fmt] = (formats[fmt] ?? 0) + 1;
  }
  const byFormat = Object.entries(formats).map(([key, count]) => ({ key, posts: count, avgEngagementRate: null }));

  const marketingPosts = posts.map(p => ({
    platform: p.post.platform,
    postUrl: p.post.post_url,
    format: p.post.media_type || "post",
    publishedAt: p.post.created_at ?? null,
    captionSnippet: p.post.caption.slice(0, 200),
    imageUrl: p.post.image_url ?? null,
    thumbnailUrl: p.post.thumbnail_url ?? null,
    likes: p.post.likes,
    comments: p.post.comments,
    views: p.post.views ?? null,
    engagementRate: null,
    marketingAngle: p.angle,
    hook: p.hook ?? null,
    cta: p.cta ?? null,
    postAnalysis: p.analysis ?? null,
    account: p.post.owner_username ?? null,
    productUrlMatched: p.isProductMatch ?? false,
    matchReason: p.isProductMatch ? "product-specific" : "brand-general",
    matchScore: null,
  }));

  const igPosts = marketingPosts.filter(p => p.platform === "instagram");
  const enrichedPaidAds = (opts.paidAds ?? []).map(ad => enrichPaidAd(ad));
  const { groups: paidAdBuckets, summary: paidAdsSummary } = buildPaidAdBuckets(enrichedPaidAds);
  const enrichedGoogleAds = (opts.googleAds ?? []).map(ad => enrichPaidAd(ad));
  const { groups: googleAdBuckets, summary: googleAdsSummary } = buildPaidAdBuckets(enrichedGoogleAds);

  const snapshot: SocialSnapshot = {
    profileCount: 1,
    postCount: posts.length,
    successfulPostCount: posts.length,
    metricCount: posts.length,
    avgEngagementRate: avgEr,
    competitorSetCount: 0,
    competitorRunCount: 0,
    competitorPostCount: 0,
    byFormat,
    byContentBucket,
    topPosts: posts.slice(0, 5).map(p => ({
      platform: p.post.platform,
      format: p.post.media_type || "post",
      contentBucket: p.angle,
      likes: p.post.likes,
      comments: p.post.comments,
      views: p.post.views ?? null,
      engagementRate: null,
    })),
    marketingPosts,
    instagramProductPosts: igPosts,
    paidAds: enrichedPaidAds,
    paidAdBuckets,
    paidAdsSummary,
    paidAdsAnalysis: opts.paidAdsAnalysis ?? null,
    paidAdsFetchError: opts.paidAdsFetchError ?? null,
    googleAds: enrichedGoogleAds,
    googleAdBuckets,
    googleAdsSummary,
    googleAdsAnalysis: opts.googleAdsAnalysis ?? null,
    googleAdsFetchError: opts.googleAdsFetchError ?? null,
    productMatchedCount: posts.length,
    totalFetchedCount: opts.totalFetched,
    instagramFetchedCount: opts.igFetched,
    facebookFetchedCount: opts.fbFetched,
    socialDataSource: opts.dataSource,
    brandProfilePicUrl: posts.map(p => p.post.owner_profile_pic).find(Boolean) ?? null,
    competitorAvgEngagementRate: null,
    competitorAvgFollowers: null,
  };

  const counts: SourceCounts = {
    ecomProjects: 0,
    ecomCompetitors: 0,
    ecomCompetitorsAnalyzed: 0,
    socialPosts: posts.length,
    socialMetrics: posts.length,
    redditReviews: 0,
    competitorRuns: 0,
  };

  return [snapshot, counts];
}

async function generateAdsBrandBook(ads: SocialPaidAdLike[], brandName: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key || ads.length === 0) return "";

  const adSample = ads.slice(0, 20).map((ad, i) => ({
    idx: i + 1,
    title: ad.title || "",
    body: (ad.body || "").slice(0, 300),
    cta: ad.cta || "",
    platforms: ad.matchReason || "",
    mediaType: ad.mediaType ?? (ad.videoUrl ? "VIDEO" : "IMAGE"),
  }));

  // Vision: attach up to 8 unique ad stills / video thumbnails.
  const seenUrls = new Set<string>();
  const imageParts: Array<Record<string, unknown>> = [];
  for (const ad of ads) {
    const url = (ad.imageUrl ?? ad.thumbnailUrl) as string | null;
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const inline = await fetchCdnImageInline(url);
    if (inline) imageParts.push({ inline_data: inline });
    if (imageParts.length >= 8) break;
  }

  const prompt = `You are a brand strategist. Analyze these ${adSample.length} paid ad creatives from "${brandName}" and extract a concise brand book.

${imageParts.length} ad creative image(s) are attached — analyze BOTH the copy below AND the visual language in the images (palette, layout, lighting, typography, mood).

Ad copy sample:
${JSON.stringify(adSample, null, 2)}

Return a JSON object with exactly these fields:
{
  "positioning": "1-sentence brand positioning statement",
  "messagingPillars": ["pillar 1", "pillar 2", "pillar 3"],
  "toneOfVoice": "2-3 adjectives describing the brand voice",
  "valuePropositions": ["value prop 1", "value prop 2", "value prop 3"],
  "ctaPatterns": ["most common CTA type", "second CTA type"],
  "targetAudience": "who the ads target",
  "keyThemes": ["theme 1", "theme 2", "theme 3", "theme 4"],
  "visualStyle": "concrete visual system from the ad images: palette, lighting, composition, typography",
  "avoidancePatterns": "what the brand never says or shows"
}`;

  const visionModel = geminiVisionModels()[0];
  const parts: Array<Record<string, unknown>> = [...imageParts, { text: prompt }];

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${visionModel}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 2048 },
        }),
      }
    );
    if (!res.ok) return "";
    const json = await res.json() as Record<string, unknown>;
    const text = ((json.candidates as Array<Record<string, unknown>>)?.[0]?.content as Record<string, unknown>)?.parts;
    const raw = ((text as Array<Record<string, unknown>>)?.[0]?.text as string) ?? "";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()) as Record<string, unknown>;

    const lines: string[] = ["## Brand Book (from Paid Ads)", ""];
    if (parsed.positioning) lines.push(`**Positioning:** ${parsed.positioning}`, "");
    if (parsed.toneOfVoice) lines.push(`**Tone of Voice:** ${parsed.toneOfVoice}`, "");
    if (parsed.targetAudience) lines.push(`**Target Audience:** ${parsed.targetAudience}`, "");
    if (Array.isArray(parsed.messagingPillars) && parsed.messagingPillars.length) {
      lines.push("**Messaging Pillars:**");
      (parsed.messagingPillars as string[]).forEach(p => lines.push(`- ${p}`));
      lines.push("");
    }
    if (Array.isArray(parsed.valuePropositions) && parsed.valuePropositions.length) {
      lines.push("**Value Propositions:**");
      (parsed.valuePropositions as string[]).forEach(v => lines.push(`- ${v}`));
      lines.push("");
    }
    if (Array.isArray(parsed.keyThemes) && parsed.keyThemes.length) {
      lines.push("**Key Themes:**");
      (parsed.keyThemes as string[]).forEach(t => lines.push(`- ${t}`));
      lines.push("");
    }
    if (Array.isArray(parsed.ctaPatterns) && parsed.ctaPatterns.length) {
      lines.push(`**CTA Patterns:** ${(parsed.ctaPatterns as string[]).join(" · ")}`);
      lines.push("");
    }
    if (parsed.visualStyle) lines.push(`**Visual Style:** ${parsed.visualStyle}`, "");
    if (parsed.avoidancePatterns) lines.push(`**Brand Avoids:** ${parsed.avoidancePatterns}`, "");
    return lines.join("\n");
  } catch {
    return "";
  }
}

async function llmFilterProductPosts(posts: RawSocialPost[], ctx: ProductContext): Promise<RawSocialPost[]> {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key || posts.length === 0) return [];

  const candidates = posts.slice(0, 30).map((p, i) => ({
    idx: i,
    caption: p.caption.slice(0, 250),
  }));

  const prompt = `Brand "${ctx.brand}" sells many products. I'm researching ONE specific product:
Product: "${ctx.title}"
Category: "${ctx.category}"

From this list of recent brand posts, identify ONLY the ones that are about THIS specific product (not other products from the same brand). Be strict.

Posts:
${JSON.stringify(candidates)}

Return JSON: {"matched_indices": [0, 3, 7]}  // array of idx values that mention or feature this specific product
If NO posts are about this product, return {"matched_indices": []}.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 256, responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) return [];
    const data = await res.json() as Record<string, unknown>;
    const candidatesResp = (data.candidates as Array<Record<string, unknown>> | undefined) ?? [];
    const parts = (((candidatesResp[0]?.content as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined) ?? []);
    const content = String(parts[0]?.text ?? "").replace(/```[a-z]*\n?/g, "").trim();
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const indices = (parsed.matched_indices as number[] | undefined) ?? [];
    return indices.filter(i => i >= 0 && i < posts.length).map(i => posts[i]);
  } catch (err) {
    console.warn(`[social] LLM product filter failed: ${err}`);
    return [];
  }
}

async function classifyPostsWithLLM(
  posts: RawSocialPost[],
  ctx: ProductContext
): Promise<Array<{ post: RawSocialPost; angle: string; hook?: string; cta?: string; analysis?: string }>> {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key || posts.length === 0) {
    return posts.map(p => ({ post: p, angle: "General product" }));
  }

  const sample = posts.slice(0, 12).map((p, i) => ({
    idx: i,
    caption: p.caption.slice(0, 400),
    likes: p.likes,
    comments: p.comments,
  }));

  const prompt = `You are a senior brand marketing strategist analyzing Instagram posts for the brand "${ctx.brand}" promoting "${ctx.title}".

For EACH post, output:
- "angle": the marketing angle in 2-4 words (e.g. "Ingredient education", "Before/after proof", "Limited-time offer", "User testimonial")
- "hook": the opening hook in 1 short sentence (≤12 words)
- "cta": the call-to-action used (e.g. "Shop now", "Try free sample"), or null if none
- "analysis": ONE sentence (15-25 words) interpreting WHY this post works strategically — what audience pain it addresses, what funnel stage it targets, or what competitor it counters. Be specific and insightful.

Posts: ${JSON.stringify(sample)}

Return JSON: {"results":[{"idx":0,"angle":"...","hook":"...","cta":"...","analysis":"..."}, ...]}`;

  try {
    // Shared helper: model-fallback loop (pinned → default → gemini-flash-latest),
    // so a decommissioned pinned ID (Gemini 404) can't kill post classification.
    const raw = await geminiText(prompt, 2048);
    if (!raw) throw new Error("Gemini returned no result (all models failed)");
    let parsed: Array<Record<string, string>> = [];
    if (Array.isArray(raw)) {
      parsed = raw;
    } else if (Array.isArray((raw as Record<string, unknown>).results)) {
      parsed = (raw as Record<string, unknown>).results as Array<Record<string, string>>;
    } else {
      const firstArr = Object.values(raw).find(v => Array.isArray(v));
      if (firstArr) parsed = firstArr as Array<Record<string, string>>;
    }
    return posts.map((p, i) => {
      const c = parsed.find(c => parseInt(String(c.idx), 10) === i);
      return {
        post: p,
        angle: c?.angle ?? "General product",
        hook: c?.hook ?? undefined,
        cta: c?.cta ?? undefined,
        analysis: c?.analysis ?? undefined,
      };
    });
  } catch (err) {
    console.warn(`[social] Post classification failed: ${err}`);
    return posts.map(p => ({ post: p, angle: "General product" }));
  }
}

const IMAGE_ANALYSIS_PROMPT = `Analyze this Instagram post image and return JSON with exactly these fields:
{
  "visual_style": one of ["minimalist","bold","editorial","lifestyle","product_only","text_heavy","ugc"],
  "content_type": one of ["product_shot","lifestyle","text_overlay","behind_scenes","ugc","announcement","educational"],
  "dominant_colors": [up to 3 hex codes like "#FF5733"],
  "composition": one of ["centered","rule_of_thirds","flat_lay","portrait","collage"],
  "has_text_overlay": true or false,
  "mood": one of ["energetic","calm","luxurious","playful","professional","warm"],
  "brand_elements": [visible brand elements e.g. "logo","watermark","branded_font"]
}
Return only valid JSON, no markdown fences.`;

// Ad-creative prompt: the dashboard's main per-ad ask is a real description of what
// the creative actually shows (works on a still or a video's poster frame). The
// categorical fields stay for the aggregate "Creative Intelligence" charts.
const AD_CREATIVE_PROMPT = `You are looking at a single Meta ad creative — either a still image, or the FIRST FEW SECONDS of a video ad (watch the motion; if a real person is on screen talking to or presenting to the camera, that is a strong creator/UGC signal). Describe what is actually in it, then classify it. Return ONLY valid JSON, no markdown fences:
{
  "description": "4-5 sentences in plain English describing exactly what is shown: the product/subject, the setting and background, what the person or product is doing, any on-image text or claims, and the overall look. Be concrete and specific to THIS creative — no generic filler.",
  "visual_style": one of ["minimalist","bold","editorial","lifestyle","product_only","text_heavy","ugc"],
  "content_type": one of ["product_shot","lifestyle","text_overlay","behind_scenes","ugc","announcement","educational"],
  "dominant_colors": [up to 3 hex codes like "#FF5733"],
  "composition": one of ["centered","rule_of_thirds","flat_lay","portrait","collage"],
  "has_text_overlay": true or false,
  "mood": one of ["energetic","calm","luxurious","playful","professional","warm"],
  "brand_elements": [visible brand elements e.g. "logo","watermark","branded_font"],
  "is_influencer": true or false — is this CREATOR / UGC / INFLUENCER content? Say TRUE if a real everyday person is presenting, talking about, or acting out a skit around the product in an AUTHENTIC, non-studio way: filmed in a real home / room / street, handheld or selfie style, everyday clothing and setting, a single person addressing the viewer — i.e. what a social-media creator posts. This is TRUE EVEN IF the ad runs from the brand's own page and has NO "paid partnership" label (brands routinely hire creators and run it as a normal ad). Say FALSE only for a polished studio / brand-produced commercial, a product-only or packaging shot, or a graphic / text-only ad with no real person,
  "person_facing_camera": true or false — is a real human visibly present and presenting/acting in the frame (they do NOT have to be looking straight at the lens),
  "real_world_setting": true or false — is it shot in a real, everyday place (home, room, street, handheld/UGC look) rather than a clean studio / product set,
  "influencer_confidence": a number 0.0-1.0 for how confident you are it is an influencer/creator/UGC ad
}`;

async function analyzeOneImage(imageUrl: string, apiKey: string, prompt: string = IMAGE_ANALYSIS_PROMPT, models?: string[]): Promise<Record<string, unknown> | null> {
  try {
    const inline = await fetchCdnImageInline(imageUrl);
    if (!inline) return null;

    // Route through callVisionLLM so the creative pass survives a Gemini 429/503
    // by falling back to OpenRouter/OpenAI — WITHOUT this, a Gemini outage silently
    // drops the whole creative analysis, which zeroes out influencer detection
    // (its strongest signal is the vision tier). Mirrors ad-reel-analysis.ts.
    const parts: VisionUserPart[] = [
      { inline_data: { mime_type: inline.mime_type, data: inline.data } },
      { text: "Analyse this ad creative and return ONLY the JSON described above." },
    ];
    const raw = await callVisionLLM(prompt, parts, apiKey, {
      jsonMode: true,
      maxTokens: 2048,
      ...(models ? { models } : {}),
    });
    let text = raw.trim();
    if (text.startsWith("```")) text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    console.warn(`[ad_analyzer] analyzeOneImage failed: ${String(err).slice(0, 160)}`);
  }
  return null;
}

// DEEP video-ad prompt (used only by the opt-in precise scan): Gemini watches the
// first few seconds of the mp4 — WITH AUDIO — to confirm influencer + the spoken
// language. This is the exact/precise pass, distinct from the fast thumbnail estimate.
const AD_VIDEO_PROMPT = `You are watching the FIRST FEW SECONDS of a Meta video ad — watch AND listen (audio matters). Return ONLY valid JSON, no markdown fences:
{
  "is_influencer": true or false — true if this is CREATOR / UGC / INFLUENCER content: a real everyday person talking to camera or presenting/acting around the product in an authentic, non-studio way (real home/room/street, handheld/selfie, casual). TRUE even if it runs from the brand's own page with no "paid partnership" label. FALSE for a polished studio/brand commercial, a product-only shot, or a graphic/text ad,
  "person_talking": true or false — is a real person speaking to camera in these seconds,
  "influencer_confidence": a number 0.0-1.0,
  "spoken_language": the language SPOKEN in the audio, e.g. "Hindi","Malayalam","Telugu","Tamil","Kannada","Bengali","Marathi","English" — or "none" if no speech,
  "primary_language": the single dominant language of the ad (prefer spoken; else on-screen text). One word,
  "is_regional": true if primary_language is a regional/vernacular language (NOT English)
}`;

/**
 * Upload video bytes to the Gemini File API (resumable) and wait until ACTIVE.
 * Videos can exceed the ~20 MB inline-request limit, so they must go through Files.
 * Returns the file URI to reference in generateContent, or null on failure.
 */
export async function uploadVideoToGemini(bytes: Buffer, mime: string, apiKey: string): Promise<string | null> {
  try {
    // 1) Start a resumable upload — Gemini returns the upload URL in a response header.
    const startRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(bytes.length),
          "X-Goog-Upload-Header-Content-Type": mime,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { display_name: "ad_video" } }),
      }
    );
    const uploadUrl = startRes.headers.get("x-goog-upload-url");
    if (!startRes.ok || !uploadUrl) {
      console.warn(`[ad_analyzer] video upload start → ${startRes.status}`);
      return null;
    }

    // 2) Upload the bytes and finalize in one shot.
    const upRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
        "Content-Length": String(bytes.length),
      },
      // Node's Buffer is a valid fetch body at runtime (undici), but this typings
      // set's BodyInit union excludes Buffer/Uint8Array — cast through unknown.
      body: bytes as unknown as BodyInit,
    });
    if (!upRes.ok) {
      console.warn(`[ad_analyzer] video upload finalize → ${upRes.status}`);
      return null;
    }
    const upJson = await upRes.json() as { file?: { name?: string; uri?: string; state?: string } };
    let file = upJson.file;
    if (!file?.uri || !file?.name) return null;

    // 3) Videos need server-side processing — poll until ACTIVE (or give up).
    for (let i = 0; i < 15 && file.state !== "ACTIVE"; i++) {
      if (file.state === "FAILED") return null;
      await new Promise(r => setTimeout(r, 2000));
      const st = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${apiKey}`);
      if (st.ok) file = await st.json() as typeof file;
    }
    return file.state === "ACTIVE" ? (file.uri ?? null) : null;
  } catch (err) {
    console.warn(`[ad_analyzer] uploadVideoToGemini failed: ${String(err).slice(0, 160)}`);
    return null;
  }
}

/** Analyse a video ad via the Gemini File API; same JSON shape as analyzeOneImage. */
async function analyzeOneVideo(videoUrl: string, apiKey: string, models: string[] = geminiVisionModels(), prompt: string = AD_VIDEO_PROMPT): Promise<Record<string, unknown> | null> {
  try {
    const inline = await fetchCdnVideoInline(videoUrl);
    if (!inline) return null;
    const bytes = Buffer.from(inline.data, "base64");
    const fileUri = await uploadVideoToGemini(bytes, inline.mime_type, apiKey);
    if (!fileUri) return null;

    const VISION_MODELS = models;
    for (const model of VISION_MODELS) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [
              { file_data: { mime_type: inline.mime_type, file_uri: fileUri }, video_metadata: { start_offset: "0s", end_offset: `${AD_DEEP_CLIP_SECS}s` } },
              { text: prompt },
            ] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
          }),
        }
      );
      if (!res.ok) {
        if (res.status === 429 || res.status === 404 || res.status === 400) continue;
        const errBody = await res.text().catch(() => "");
        console.warn(`[ad_analyzer] video ${model} → ${res.status} ${errBody.slice(0, 160)}`);
        continue;
      }
      const data = await res.json() as Record<string, unknown>;
      const candidates = (data.candidates as Array<Record<string, unknown>> | undefined) ?? [];
      const parts = ((candidates[0]?.content as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined) ?? [];
      let text = String(parts[0]?.text ?? "").trim();
      if (text.startsWith("```")) text = text.split("\n").slice(1).join("\n").replace(/```$/, "").trim();
      return JSON.parse(text) as Record<string, unknown>;
    }
  } catch (err) {
    console.warn(`[ad_analyzer] analyzeOneVideo failed: ${String(err).slice(0, 160)}`);
  }
  return null;
}

export interface DeepAdVerdict {
  adId: string;
  isInfluencer: boolean;
  confidence: number;
  personTalking: boolean;
  language: string;
  isRegional: boolean;
}

/**
 * PRECISE pass (opt-in "deep scan"): analyse the first ~5s of each VIDEO ad WITH AUDIO
 * to confirm influencer + the spoken/regional language — the exact numbers behind the
 * fast thumbnail estimate. Batched + time-budgeted so a scoped range finishes cleanly.
 */
export async function deepClassifyAdVideos(
  ads: SocialPaidAd[],
  onProgress?: (done: number, total: number) => void,
  deadlineMs = 0,
): Promise<DeepAdVerdict[]> {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  const videos = ads.filter(a => !!a.videoUrl);
  const out: DeepAdVerdict[] = [];
  if (!apiKey || !videos.length) return out;

  let done = 0;
  const BATCH = 6;
  for (let i = 0; i < videos.length; i += BATCH) {
    if (deadlineMs && Date.now() > deadlineMs) {
      console.warn(`[deep_scan] time budget reached — analysed ${done}/${videos.length} videos`);
      break;
    }
    const batch = videos.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async ad => {
      const r = await analyzeOneVideo(ad.videoUrl as string, apiKey);
      done++;
      onProgress?.(done, videos.length);
      if (!r) return null;
      const lang = (String(r.primary_language ?? r.spoken_language ?? "").trim()) || "English";
      return {
        adId: ad.adId,
        isInfluencer: Boolean(r.is_influencer),
        confidence: typeof r.influencer_confidence === "number" ? r.influencer_confidence : (r.is_influencer ? 0.8 : 0),
        personTalking: Boolean(r.person_talking),
        language: lang,
        isRegional: r.is_regional === true || !/^(english|none|unknown)$/i.test(lang),
      } as DeepAdVerdict;
    }));
    out.push(...results.filter((x): x is DeepAdVerdict => x !== null));
  }
  return out;
}

async function analyzeInstagramImages(posts: SocialMarketingPost[], topN = 30): Promise<InstagramImageAnalysis[]> {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  if (!apiKey) return [];
  const igPosts = posts
    .filter(p => p.platform?.toLowerCase() === "instagram")
    .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0))
    .slice(0, topN);
  if (!igPosts.length) return [];

  console.log(`[image_analyzer] Analyzing ${igPosts.length} Instagram images…`);
  const BATCH = 5;
  const results: InstagramImageAnalysis[] = [];

  for (let i = 0; i < igPosts.length; i += BATCH) {
    const batch = igPosts.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(async p => {
      const imgUrl = p.imageUrl ?? p.thumbnailUrl ?? "";
      const base: InstagramImageAnalysis = { postUrl: p.postUrl ?? "", imageUrl: imgUrl || null, dominantColors: [], brandElements: [], hasTextOverlay: false, engagementRate: p.engagementRate ?? null };
      if (!imgUrl) return base;
      const r = await analyzeOneImage(imgUrl, apiKey);
      if (!r) return base;
      return {
        postUrl: p.postUrl ?? "",
        imageUrl: imgUrl,
        visualStyle: (r.visual_style as string) ?? null,
        contentType: (r.content_type as string) ?? null,
        dominantColors: (Array.isArray(r.dominant_colors) ? r.dominant_colors as string[] : []),
        composition: (r.composition as string) ?? null,
        hasTextOverlay: Boolean(r.has_text_overlay),
        mood: (r.mood as string) ?? null,
        brandElements: (Array.isArray(r.brand_elements) ? r.brand_elements as string[] : []),
        engagementRate: p.engagementRate ?? null,
      } satisfies InstagramImageAnalysis;
    }));
    results.push(...batchResults);
    console.log(`[image_analyzer] ${results.length}/${igPosts.length} done`);
  }
  return results;
}

/**
 * Run the creative-vision prompt on EVERY ad with a fetchable creative (no top-N
 * cap — the input is already limited to the last-6-months window by prepPaidAds).
 * Parallel batches of 5, graceful null on failure.
 * Returns a Map<adId, InstagramImageAnalysis> for O(1) merge back onto ads.
 */
async function analyzeAdCreatives(
  ads: SocialPaidAd[],
  deadlineMs = 0,
): Promise<Map<string, InstagramImageAnalysis>> {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  const result = new Map<string, InstagramImageAnalysis>();
  if (!apiKey || !ads.length) return result;

  // SMALL/fast model (Flash-Lite) so a per-ad pass on (nearly) every ad is affordable.
  // Video ads → watch the first few seconds (motion + creator signal, far stronger than a
  // frozen frame); stills → poster frame. Both return the SAME creative schema.
  const models = geminiAdVisionModels();

  // AMBIGUOUS-FIRST: if the time budget bites, the ads that actually NEED AI (untagged
  // brand-page creatives) are analysed before the obvious/tagged ones (which classify for
  // free anyway). Then active, then longest-running.
  const candidates = [...ads]
    .filter(a => !!(a.imageUrl ?? a.thumbnailUrl ?? a.videoUrl))
    .sort((a, b) => {
      const aObvious = hasObviousInfluencerSignal(a) ? 1 : 0;
      const bObvious = hasObviousInfluencerSignal(b) ? 1 : 0;
      if (aObvious !== bObvious) return aObvious - bObvious;
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return (b.runningDays ?? 0) - (a.runningDays ?? 0);
    })
    .slice(0, PAID_AD_AI_MAX);
  if (!candidates.length) return result;

  // Wall-clock budget so a huge video-heavy set can't run past the function limit. When it
  // trips, the remaining ads keep their deterministic metrics + structural/copy heuristic.
  const deadline = deadlineMs || (Date.now() + PAID_AD_AI_BUDGET_SECS * 1000);
  const ambiguous = candidates.filter(a => !hasObviousInfluencerSignal(a)).length;
  console.log(`[ad_analyzer] per-ad AI on ${candidates.length}/${ads.length} ads (${ambiguous} ambiguous, model=${models[0]}, budget=${PAID_AD_AI_BUDGET_SECS}s)`);

  let viaVideo = 0;
  const BATCH = 8;
  for (let i = 0; i < candidates.length; i += BATCH) {
    if (Date.now() > deadline) {
      console.warn(`[ad_analyzer] time budget reached — analysed ${result.size}/${candidates.length}; the rest fall back to deterministic + copy heuristics`);
      break;
    }
    const batch = candidates.slice(i, i + BATCH);
    await Promise.all(batch.map(async ad => {
      const imgUrl = (ad.imageUrl ?? ad.thumbnailUrl) as string | undefined;
      // Video → few-seconds clip (best creator/motion signal); fall back to the poster
      // still if the mp4 can't be read. Still ads → poster frame.
      let r: Record<string, unknown> | null = null;
      if (ad.videoUrl) {
        r = await analyzeOneVideo(ad.videoUrl as string, apiKey, models, AD_CREATIVE_PROMPT);
        if (r) viaVideo++;
      }
      if (!r && imgUrl) r = await analyzeOneImage(imgUrl, apiKey, AD_CREATIVE_PROMPT, models);
      if (!r) return;
      result.set(ad.adId, {
        postUrl: ad.adSnapshotUrl ?? ad.linkUrl ?? "",
        imageUrl: imgUrl ?? null,
        description: (r.description as string) ?? null,
        visualStyle: (r.visual_style as string) ?? null,
        contentType: (r.content_type as string) ?? null,
        dominantColors: Array.isArray(r.dominant_colors) ? r.dominant_colors as string[] : [],
        composition: (r.composition as string) ?? null,
        hasTextOverlay: Boolean(r.has_text_overlay),
        mood: (r.mood as string) ?? null,
        brandElements: Array.isArray(r.brand_elements) ? r.brand_elements as string[] : [],
        engagementRate: null,
        // Influencer / creator-ad classification. A video reports person_talking; a still
        // reports person_facing_camera — either means a real person is present in-frame.
        isInfluencer: Boolean(r.is_influencer),
        influencerConfidence: typeof r.influencer_confidence === "number" ? r.influencer_confidence : null,
        personFacingCamera: Boolean(r.person_facing_camera ?? r.person_talking),
        realWorldSetting: Boolean(r.real_world_setting),
      });
    }));
    console.log(`[ad_analyzer] ${result.size}/${candidates.length} done (${viaVideo} via video clip)`);
  }
  return result;
}

/**
 * Strategic per-ad analysis derived from each ad's COPY + METADATA (not its image).
 * Works for every scraped ad — video or still — because it needs no image fetch,
 * so it always populates even when the creative image can't be downloaded.
 * One batched Gemini text call returns an analysis per adId.
 */
async function analyzeAdCampaigns(ads: SocialPaidAd[]): Promise<Map<string, AdCampaignAnalysis>> {
  const result = new Map<string, AdCampaignAnalysis>();
  if (!ads.length || !process.env.GEMINI_API_KEY) return result;

  // Bound the batched copy pass so very large sets don't run dozens of chunks.
  // (Language for un-sampled ads falls back to native-script detection.)
  const items = ads.slice(0, PAID_AD_COPY_MAX).map(a => ({
    adId: a.adId,
    pageName: a.pageName || null,
    headline: a.title || null,
    caption: a.body || null,
    cta: a.cta || null,
    mediaType: a.videoUrl ? "video" : "image",
    platforms: a.publisherPlatforms ?? [],
    runningDays: a.runningDays ?? null,
  })).filter(i => i.adId && (i.caption || i.headline));

  if (!items.length) return result;
  console.log(`[ad_campaign] Analyzing ${items.length} ad campaigns…`);

  // Chunk so a large 6-month set stays within the model's output budget.
  const CHUNK = 25;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const prompt = `You are a senior paid-social strategist. For EACH Meta ad below, infer its advertising strategy from the copy and metadata. Be specific and concrete — reference the actual product/offer in the copy, never generic filler.

Return ONLY JSON: {"ads":[{"adId":"<id>","summary":"...","angle":"...","audience":"...","messaging":"...","funnelStage":"...","language":"...","isRegional":true}]}
- summary: one sentence on what this ad is selling and how
- angle: the core marketing angle / positioning hook
- audience: who this ad is targeting (be specific)
- messaging: the persuasion strategy / emotional or rational lever used
- funnelStage: exactly one of "awareness", "consideration", "conversion"
- language: the PRIMARY language of this ad's copy, named in English (e.g. "English", "Hindi", "Hinglish", "Tamil", "Telugu", "Marathi", "Bengali", "Arabic"). Detect romanized regional languages too (e.g. Hindi written in Latin script = "Hinglish"/"Hindi").
- isRegional: true if the primary language is a regional/vernacular language (anything other than plain English), false if it's English

Ads:
${JSON.stringify(chunk, null, 2)}`;

    const json = await geminiText(prompt, 8192);
    const arr = Array.isArray((json as { ads?: unknown[] } | null)?.ads)
      ? (json as { ads: Array<Record<string, unknown>> }).ads
      : [];
    for (const a of arr) {
      const id = a?.adId != null ? String(a.adId) : "";
      if (!id) continue;
      result.set(id, {
        summary: typeof a.summary === "string" ? a.summary : null,
        angle: typeof a.angle === "string" ? a.angle : null,
        audience: typeof a.audience === "string" ? a.audience : null,
        messaging: typeof a.messaging === "string" ? a.messaging : null,
        funnelStage: typeof a.funnelStage === "string" ? a.funnelStage : null,
        // Regional-language classification (ads in a vernacular language).
        language: typeof a.language === "string" ? a.language : null,
        isRegional: typeof a.isRegional === "boolean" ? a.isRegional : undefined,
      });
    }
  }
  console.log(`[ad_campaign] ${result.size}/${items.length} done`);
  return result;
}

/**
 * Run both per-ad passes (visual creative + textual campaign) in parallel and
 * merge them onto each ad. Shared by every paid-ads branch so the wiring stays
 * identical everywhere.
 *
 * OFF BY DEFAULT: the overview's two AI-dependent signals now run deterministically —
 * influencer = collaboration tag (classifyInfluencer), language = caption (languageOf) —
 * so the slow per-ad Gemini passes (reel/creative vision + copy) are skipped, which is
 * what was timing runs out (and stalling on a rate-limited/dead key). Flip
 * PAID_AD_AI_ENABLED=true to re-enable the rich creative/copy detail for the other tabs.
 */
export async function attachAdAnalyses(paidAds: SocialPaidAd[]): Promise<SocialPaidAd[]> {
  if ((process.env.PAID_AD_AI_ENABLED ?? "false").toLowerCase() !== "true") {
    return paidAds;
  }
  const [creativeMap, campaignMap] = await Promise.all([
    analyzeAdCreatives(paidAds),
    analyzeAdCampaigns(paidAds),
  ]);
  return paidAds.map(ad => {
    const creative = creativeMap.get(ad.adId);
    const campaign = campaignMap.get(ad.adId);
    return {
      ...ad,
      ...(creative ? { adCreativeAnalysis: creative } : {}),
      ...(campaign ? { adCampaignAnalysis: campaign } : {}),
    };
  });
}

function pct(count: number, total: number): number {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

function topColors(analyses: InstagramImageAnalysis[], n = 5): string[] {
  const counts = new Map<string, number>();
  for (const a of analyses) {
    for (const c of a.dominantColors ?? []) {
      if (c?.startsWith("#")) counts.set(c.toUpperCase(), (counts.get(c.toUpperCase()) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([c]) => c);
}

function mixOf(analyses: InstagramImageAnalysis[], field: keyof InstagramImageAnalysis): Record<string, number> {
  const counts = new Map<string, number>();
  for (const a of analyses) {
    const v = a[field];
    if (typeof v === "string" && v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  const result: Record<string, number> = {};
  for (const [k, c] of [...counts.entries()].sort((a, b) => b[1] - a[1])) result[k] = pct(c, total);
  return result;
}

function mostCommon(analyses: InstagramImageAnalysis[], field: keyof InstagramImageAnalysis): string | null {
  const counts = new Map<string, number>();
  for (const a of analyses) {
    const v = a[field];
    if (typeof v === "string" && v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function consistencyScore(analyses: InstagramImageAnalysis[]): number | null {
  if (!analyses.length) return null;
  const styles = analyses.map(a => a.visualStyle).filter(Boolean) as string[];
  const moods = analyses.map(a => a.mood).filter(Boolean) as string[];
  if (!styles.length) return null;
  const topStyleFrac = Math.max(...[...new Map(styles.map(s => [s, styles.filter(x => x === s).length])).values()]) / styles.length;
  const topMoodFrac = moods.length ? Math.max(...[...new Map(moods.map(m => [m, moods.filter(x => x === m).length])).values()]) / moods.length : 0.5;
  return Math.round((topStyleFrac * 0.6 + topMoodFrac * 0.4) * 1000) / 10;
}

function topFormats(analyses: InstagramImageAnalysis[], posts: SocialMarketingPost[]): string[] {
  const urlToEr = new Map(posts.filter(p => p.postUrl && p.engagementRate != null).map(p => [p.postUrl, p.engagementRate!]));
  const combos = new Map<string, number[]>();
  for (const a of analyses) {
    const er = urlToEr.get(a.postUrl) ?? a.engagementRate;
    if (er == null) continue;
    const key = `${a.visualStyle ?? "?"} × ${a.contentType ?? "?"}`;
    combos.set(key, [...(combos.get(key) ?? []), er]);
  }
  return [...combos.entries()]
    .sort((a, b) => (b[1].reduce((s, n) => s + n, 0) / b[1].length) - (a[1].reduce((s, n) => s + n, 0) / a[1].length))
    .slice(0, 5)
    .map(([k]) => k);
}

async function geminiText(prompt: string, maxTokens = 2048): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  if (!apiKey) return null;
  const models = geminiTextModels();
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
          }),
        }
      );
      if (!res.ok) {
        // 404 = model decommissioned/renamed; 429/5xx = transient. Either way, try
        // the next model in the list (gemini-flash-latest is always the last resort).
        console.warn(`[gemini] ${model} → HTTP ${res.status}, trying next model`);
        continue;
      }
      const data = await res.json() as Record<string, unknown>;
      const candidates = (data.candidates as Array<Record<string, unknown>> | undefined) ?? [];
      const parts = ((candidates[0]?.content as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined) ?? [];
      let text = String(parts[0]?.text ?? "").trim();
      if (text.startsWith("```")) text = text.split("\n").slice(1).join("\n").replace(/```$/, "").trim();
      return JSON.parse(text) as Record<string, unknown>;
    } catch { continue; }
  }
  return null;
}

function asStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

async function extractBrandVoice(posts: SocialMarketingPost[], brandName: string): Promise<{
  toneOfVoice: string[];
  brandPersonality: string[];
  targetAudience: string | null;
  keyMessages: string[];
  tagline: string | null;
  valueProposition: string | null;
  contentPillarNames: string[];
}> {
  const captions = posts
    .filter(p => p.captionSnippet?.trim())
    .slice(0, 30)
    .map((p, i) => ({ i, caption: p.captionSnippet?.slice(0, 300), angle: p.marketingAngle, likes: p.likes, comments: p.comments }));

  if (!captions.length) return { toneOfVoice: [], brandPersonality: [], targetAudience: null, keyMessages: [], tagline: null, valueProposition: null, contentPillarNames: [] };

  const prompt = `You are a brand strategist. Analyze these ${captions.length} Instagram post captions from the brand "${brandName}" and extract the brand's voice and identity.

Captions:
${JSON.stringify(captions, null, 2)}

Return JSON with exactly these fields:
{
  "toneOfVoice": ["3-5 single words: e.g. conversational, empowering, playful, authoritative, warm"],
  "brandPersonality": ["3-5 single words: e.g. innovative, trustworthy, bold, authentic, approachable"],
  "targetAudience": "1 sentence describing who this brand speaks to",
  "keyMessages": ["3-5 core messaging pillars extracted from captions"],
  "tagline": "a short punchy tagline inferred from the brand's content (or null)",
  "valueProposition": "1 sentence: what unique value this brand promises its audience",
  "contentPillarNames": ["3-6 content categories this brand posts about, e.g. Education, Before/After, Product Showcase, Community, Lifestyle"]
}`;

  const result = await geminiText(prompt, 1024);
  if (!result) return { toneOfVoice: [], brandPersonality: [], targetAudience: null, keyMessages: [], tagline: null, valueProposition: null, contentPillarNames: [] };
  return {
    toneOfVoice: asStrArr(result.toneOfVoice),
    brandPersonality: asStrArr(result.brandPersonality),
    targetAudience: typeof result.targetAudience === "string" ? result.targetAudience : null,
    keyMessages: asStrArr(result.keyMessages),
    tagline: typeof result.tagline === "string" ? result.tagline : null,
    valueProposition: typeof result.valueProposition === "string" ? result.valueProposition : null,
    contentPillarNames: asStrArr(result.contentPillarNames),
  };
}

async function generateCampaignConcepts(brandDNA: {
  brandName: string;
  industry: string | null;
  toneOfVoice: string[];
  brandPersonality: string[];
  targetAudience: string | null;
  keyMessages: string[];
  primaryColors: string[];
  imageryStyle: string | null;
  contentPillarNames: string[];
}): Promise<import("./types").CampaignConcept[]> {
  const prompt = `You are a creative brand strategist. Based on this brand's DNA, generate 4 distinct Instagram campaign concepts.

Brand DNA:
- Brand: ${brandDNA.brandName}
- Industry: ${brandDNA.industry ?? "Consumer"}
- Tone of voice: ${brandDNA.toneOfVoice.join(", ")}
- Brand personality: ${brandDNA.brandPersonality.join(", ")}
- Target audience: ${brandDNA.targetAudience ?? "general audience"}
- Key messages: ${brandDNA.keyMessages.join(" | ")}
- Visual style: ${brandDNA.imageryStyle ?? "lifestyle-forward"}
- Content pillars: ${brandDNA.contentPillarNames.join(", ")}

Return a JSON array of exactly 4 campaign concepts:
[
  {
    "title": "Campaign name (3-5 words)",
    "theme": "1-sentence thematic direction",
    "keyMessage": "The core message this campaign conveys",
    "hook": "Opening hook line for the first post",
    "cta": "Short call-to-action text",
    "recommendedFormats": ["Reel", "Carousel", "Static"],
    "toneNotes": "Specific tone guidance for this campaign",
    "visualDirection": "Visual composition and aesthetic guidance"
  }
]`;

  const result = await geminiText(prompt, 2048);
  if (!Array.isArray(result)) {
    // result might be wrapped: check if it's an object with an array
    const arr = result ? Object.values(result).find(v => Array.isArray(v)) as unknown[] | undefined : undefined;
    if (!arr?.length) return [];
    return arr.slice(0, 4).map(c => c as import("./types").CampaignConcept);
  }
  return result.slice(0, 4).map(c => c as import("./types").CampaignConcept);
}

function visualFieldsFromDna(dna: Record<string, unknown>): {
  primaryColors: string[];
  secondaryColors: string[];
  imageryStyle: string | null;
  layoutStyle: string | null;
  dominantMood: string | null;
  brandConsistencyScore: number | null;
  analyzedPostCount: number;
  textOverlayRate: number;
} {
  const color = dna.color as Record<string, unknown> | undefined;
  const palette = Array.isArray(color?.palette) ? (color.palette as string[]) : [];
  const photography = dna.photography as Record<string, unknown> | undefined;
  const composition = dna.composition as Record<string, unknown> | undefined;
  const mood = dna.mood as Record<string, unknown> | undefined;
  const typography = dna.typography as Record<string, unknown> | undefined;
  const confidence = String(dna.confidence ?? "medium");
  const score = confidence === "high" ? 88 : confidence === "medium" ? 68 : 48;
  const shotTypes = Array.isArray(photography?.shotTypes) ? (photography.shotTypes as string[]).join("/") : "";
  const imageryParts = [dna.summary, shotTypes, photography?.cameraAngle, photography?.depthOfField].filter(Boolean);
  return {
    primaryColors: palette.slice(0, 3),
    secondaryColors: palette.slice(3, 8),
    imageryStyle: imageryParts.length ? imageryParts.map(String).join("; ") : null,
    layoutStyle: composition?.rules ? String(composition.rules) : null,
    dominantMood: mood?.primary ? String(mood.primary) : null,
    brandConsistencyScore: score,
    analyzedPostCount: typeof dna.assetsAnalyzed === "number" ? dna.assetsAnalyzed : 0,
    textOverlayRate: typography?.present === true ? 100 : 0,
  };
}

function topFormatsFromPosts(posts: SocialMarketingPost[]): string[] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    const f = String(p.format ?? "unknown");
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
}

async function buildBrandDNA(
  analyses: InstagramImageAnalysis[],
  posts: SocialMarketingPost[],
  ecomPayload?: CombinedScraperData,
  dnaProfile?: Record<string, unknown> | null,
): Promise<InstagramBrandProfile> {
  const product = ecomPayload?.ecom?.products?.[0];
  const brandName = String(product?.brand ?? product?.name ?? "Brand").trim();
  const industry = String(product?.category ?? "").trim() || null;

  // 1. Visual aggregation — prefer forensic Brand Visual DNA over per-image legacy analysis
  let primaryColors: string[];
  let secondaryColors: string[];
  let imageryStyle: string | null;
  let layoutStyle: string | null;
  let dominantMood: string | null;
  let brandConsistencyScore: number | null;
  let analyzedPostCount: number;
  let textOverlayRate: number;
  let topFormatList: string[];
  let topPerformingFormatList: string[];

  if (dnaProfile) {
    const v = visualFieldsFromDna(dnaProfile);
    primaryColors = v.primaryColors;
    secondaryColors = v.secondaryColors;
    imageryStyle = v.imageryStyle;
    layoutStyle = v.layoutStyle;
    dominantMood = v.dominantMood;
    brandConsistencyScore = v.brandConsistencyScore;
    analyzedPostCount = v.analyzedPostCount || posts.length;
    textOverlayRate = v.textOverlayRate;
    topFormatList = topFormatsFromPosts(posts);
    topPerformingFormatList = topFormatList;
  } else {
    const allColors = topColors(analyses, 8);
    primaryColors = allColors.slice(0, 3);
    secondaryColors = allColors.slice(3, 8);
    const styleMap = mixOf(analyses, "visualStyle");
    const topStyleEntry = Object.entries(styleMap).sort((a, b) => b[1] - a[1])[0];
    dominantMood = mostCommon(analyses, "mood");
    const topComposition = mostCommon(analyses, "composition");
    imageryStyle = topStyleEntry
      ? `${topStyleEntry[0].replace(/_/g, " ")}-forward${topComposition ? `, ${topComposition} composition` : ""}${dominantMood ? `, ${dominantMood} mood` : ""}`
      : null;
    layoutStyle = topComposition
      ? `Primarily ${topComposition.replace(/_/g, " ")} with ${Object.keys(mixOf(analyses, "composition")).slice(0, 2).join(" and ")} layouts`
      : null;
    brandConsistencyScore = consistencyScore(analyses);
    analyzedPostCount = analyses.length;
    textOverlayRate = pct(analyses.filter(a => a.hasTextOverlay).length, analyses.length);
    topFormatList = Object.entries(mixOf(analyses, "contentType")).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    topPerformingFormatList = topFormats(analyses, posts);
  }

  // Content pillars from marketing angles + engagement
  const pillarMap = new Map<string, { count: number; erSum: number; erCount: number }>();
  for (const p of posts) {
    const key = p.marketingAngle || "General";
    const entry = pillarMap.get(key) ?? { count: 0, erSum: 0, erCount: 0 };
    entry.count++;
    if (p.engagementRate != null) { entry.erSum += p.engagementRate; entry.erCount++; }
    pillarMap.set(key, entry);
  }
  const total = posts.length || 1;
  const contentPillars = [...pillarMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
    .map(([name, v]) => ({
      name,
      percentage: pct(v.count, total),
      avgEngagementRate: v.erCount ? Math.round(v.erSum / v.erCount * 10) / 10 : null,
    }));

  // 2. Brand voice extraction from captions
  const voice = await extractBrandVoice(posts, brandName);

  // 3. Campaign concepts
  const concepts = await generateCampaignConcepts({
    brandName,
    industry,
    toneOfVoice: voice.toneOfVoice,
    brandPersonality: voice.brandPersonality,
    targetAudience: voice.targetAudience,
    keyMessages: voice.keyMessages,
    primaryColors,
    imageryStyle,
    contentPillarNames: voice.contentPillarNames.length ? voice.contentPillarNames : contentPillars.map(p => p.name),
  });

  return {
    analyzedPostCount,

    // Identity
    brandName,
    industry,
    tagline: voice.tagline,
    valueProposition: voice.valueProposition,

    // Voice
    toneOfVoice: voice.toneOfVoice,
    brandPersonality: voice.brandPersonality,
    targetAudience: voice.targetAudience,
    keyMessages: voice.keyMessages,

    // Visual
    primaryColors,
    secondaryColors,
    imageryStyle,
    layoutStyle,
    dominantMood,
    brandConsistencyScore,

    // Content
    contentPillars,
    topFormats: topFormatList,
    textOverlayRate,
    topPerformingFormats: topPerformingFormatList,

    // Campaigns
    campaignConcepts: concepts,

    imageAnalyses: dnaProfile ? [] : analyses,
  };
}

export async function buildIgBrandProfile(
  posts: SocialMarketingPost[],
  ecomPayload?: CombinedScraperData,
  dnaProfile?: Record<string, unknown> | null,
): Promise<InstagramBrandProfile | null> {
  try {
    if (!posts.length && !dnaProfile) return null;
    const analyses = dnaProfile ? [] : await analyzeInstagramImages(posts);
    if (!dnaProfile && !analyses.length && !posts.length) return null;
    return buildBrandDNA(analyses, posts, ecomPayload, dnaProfile);
  } catch (err) {
    console.warn(`[meta-social] Brand profile failed: ${err}`);
    return null;
  }
}

// Collect the brand's own creative assets (Instagram stills + reel thumbnails +
// Meta ad images/video thumbnails) for forensic Brand Visual DNA extraction.
function collectBrandVisualAssets(snapshot: SocialSnapshot): VisualAsset[] {
  const assets: VisualAsset[] = [];

  // Instagram organic posts — prioritise by engagement.
  const igPosts = [...(snapshot.marketingPosts ?? [])]
    .filter(p => (p.platform ?? "instagram").toLowerCase().includes("instagram"))
    .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0));
  for (const p of igPosts) {
    const isVideo = /reel|video/i.test(String(p.format ?? ""));
    const url = (isVideo ? p.thumbnailUrl ?? p.imageUrl : p.imageUrl ?? p.thumbnailUrl) as string | null;
    if (url) assets.push({ url, isVideo });
  }

  // Meta paid ads — use the still image, or the video thumbnail as a sampled frame.
  for (const ad of snapshot.paidAds ?? []) {
    const isVideo = Boolean(ad.videoUrl) || String(ad.mediaType ?? "").toUpperCase().includes("VIDEO");
    const url = (ad.imageUrl ?? ad.thumbnailUrl) as string | null;
    if (url) assets.push({ url, isVideo });
  }

  return assets;
}

// Run Brand Visual DNA extraction across all fetched assets and attach the
// reproduction-grade profile + ready-to-use Nano Banana prompts to the snapshot.
async function attachBrandVisualDna(snapshot: SocialSnapshot): Promise<void> {
  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!geminiKey) {
    snapshot.brandVisualDnaStatus = "GEMINI_API_KEY not configured on the server";
    return;
  }
  // OFF by default — the brandbook/visual-DNA feature is no longer used in the audit, and it
  // ran a slow Gemini vision pass on brand images every run. Set BRAND_VISUAL_DNA_ENABLED=true
  // to re-enable. (Flip to "true" only when the brandbook surface actually needs it.)
  const enabled = (process.env.BRAND_VISUAL_DNA_ENABLED ?? "false").toLowerCase();
  if (!["1", "true", "yes"].includes(enabled)) {
    snapshot.brandVisualDnaStatus = "BRAND_VISUAL_DNA_ENABLED is turned off";
    return;
  }

  try {
    const assets = collectBrandVisualAssets(snapshot);
    if (assets.length < 2) {
      snapshot.brandVisualDnaStatus = `only ${assets.length} brand image asset(s) found (need ≥2)`;
      return;
    }
    console.log(`[brand-visual-dna] Extracting visual DNA from ${assets.length} brand assets via Gemini…`);
    const dna = await extractBrandVisualDna(assets, geminiKey);
    if (dna) {
      snapshot.brandVisualProfile = dna.brandVisualProfile as Record<string, unknown>;
      snapshot.reproductionPrompts = dna.reproductionPrompts as SocialSnapshot["reproductionPrompts"];
      snapshot.brandVisualDnaStatus = `ok · confidence=${dna.brandVisualProfile.confidence}`;
      console.log(`[brand-visual-dna] confidence=${dna.brandVisualProfile.confidence}, ${dna.reproductionPrompts.length} reproduction prompts`);
    } else {
      snapshot.brandVisualDnaStatus = "extraction returned nothing — brand images could not be downloaded server-side (CDN blocked) or vision call failed";
    }
  } catch (err) {
    snapshot.brandVisualDnaStatus = `extraction error: ${String(err).slice(0, 160)}`;
    console.warn(`[brand-visual-dna] extraction failed: ${err}`);
  }
}

export async function fetchProductSocialInsights(
  productUrl: string,
  ecomPayload: CombinedScraperData,
  source = "auto",
  instagramHandleOverride?: string,
  adLibraryUrl?: string,
  googleAdsOpts?: { include: boolean; mode: GoogleAdsMode; url?: string; brandName?: string },
): Promise<[SocialSnapshot | null, SourceCounts | null, string | null]> {
  const mode = (source ?? "auto").trim().toLowerCase();
  if (mode === "public" && !isPublicSocialConfigured()) {
    return [null, null, "Apify public scrape is ON but SR_APIFY_TOKEN / APIFY_API_TOKEN is missing in .env."];
  }
  if (mode === "graph" && !isMetaSocialConfigured()) {
    return [null, null, "Meta Graph is selected but META_ACCESS_TOKEN / META_PAGE_ID are not set in .env."];
  }

  const ctx = productContextFromPayload(productUrl, ecomPayload);

  const warnings: string[] = [];

  const brandFromPayload = extractBrandNameFromPayload(ecomPayload);
  const adLibTrimmed = (adLibraryUrl ?? "").trim();
  const adLibraryOnly =
    adLibTrimmed &&
    isDirectMetaAdsScrapeUrl(adLibTrimmed) &&
    !(instagramHandleOverride ?? "").trim() &&
    !brandFromPayload;

  // Google Ads Transparency runs CONCURRENTLY with Meta + IG (started here, awaited per
  // branch below via resolveGoogle) so it adds no sequential wall-time to the 800s budget.
  // The user-typed brand name seeds the Fast search (and labels the brandbook) when there's
  // no scraped product context — the case for a Google-only run.
  const googleBrand = (googleAdsOpts?.brandName ?? "").trim() || brandFromPayload || ctx.brand || ctx.title?.split(" ")[0] || "brand";
  // Google-only run: the user enabled Google Ads with a brand name / Transparency URL and no
  // other source (no product, IG handle, brand-from-payload, or Meta Ad Library URL). Skip IG
  // discovery entirely (mirrors the ad-library-only path) and build a Google-only snapshot.
  const googleOnly =
    !!googleAdsOpts?.include &&
    !adLibTrimmed &&
    !(instagramHandleOverride ?? "").trim() &&
    !brandFromPayload &&
    !(productUrl ?? "").trim();
  const googlePromise: Promise<GoogleAdsFetchResult> = googleAdsOpts?.include
    ? fetchGoogleAds({ brand: googleBrand, googleAdsUrl: googleAdsOpts.url }, googleAdsOpts.mode)
    : Promise.resolve({ ads: [] });
  const resolveGoogle = async (): Promise<{ googleAds: SocialPaidAd[]; googleAdsAnalysis: string | null; googleAdsFetchError: string | null }> => {
    const res = await googlePromise;
    const ads = prepPaidAds(res.ads);
    if (!ads.length) return { googleAds: [], googleAdsAnalysis: null, googleAdsFetchError: res.fetchError ?? null };
    const [analysis, enriched] = await Promise.all([
      ads.length >= 3 ? generateAdsBrandBook(ads, googleBrand) : Promise.resolve(null),
      attachAdAnalyses(ads),
    ]);
    return { googleAds: enriched, googleAdsAnalysis: analysis, googleAdsFetchError: res.fetchError ?? null };
  };

  // Google-only run — the sole source is the Google Ads scan. Skip IG discovery and the
  // Meta ad fetch entirely and build a Google-only snapshot (mirrors the ad-library-only path).
  if (googleOnly) {
    console.log("[social] Google-only run — skipping Instagram + Meta ad discovery");
    const g = await resolveGoogle();
    const [snap, cnts] = buildSocialSnapshot([], {
      totalFetched: 0,
      igFetched: 0,
      fbFetched: 0,
      dataSource: "google_only",
      googleAds: g.googleAds,
      googleAdsAnalysis: g.googleAdsAnalysis,
      googleAdsFetchError: g.googleAdsFetchError,
    });
    await attachBrandVisualDna(snap);
    return [snap, cnts, g.googleAdsFetchError ?? null];
  }

  // Ad-library-only scraping needs ONLY Apify — NOT a resolvable IG social source.
  // This runs BEFORE the resolveSocialSource gate below, so a brand given purely as
  // an Ad Library URL still returns its paid ads (previously it was silently dropped
  // when IG social didn't resolve, leaving the user's brand out of the comparison).
  if (adLibraryOnly) {
    // ADS ONLY — no Instagram scrape, no brand→handle resolution, no brandbook / brand-voice
    // / visual-DNA / IG-brand-profile. Those don't appear in the ad analysis, and resolving
    // the brand to an IG handle was scraping Instagram for a URL the user never gave.
    console.log("[social] Ad-library-only run — ads only (no Instagram / brandbook / DNA)");
    const { ads: rawPaidAds, fetchError: paidAdsFetchError } = await fetchMetaAdsLibrary(
      ecomPayload,
      undefined,
      adLibTrimmed,
    );
    const paidAds = prepPaidAds(rawPaidAds);
    const enrichedAds = await attachAdAnalyses(paidAds); // off by default → returns as-is
    const gA = await resolveGoogle();
    const [snap, cnts] = buildSocialSnapshot([], {
      totalFetched: 0,
      igFetched: 0,
      fbFetched: 0,
      dataSource: "ad_library_only",
      paidAds: enrichedAds,
      paidAdsAnalysis: null,
      paidAdsFetchError,
      googleAds: gA.googleAds,
      googleAdsAnalysis: gA.googleAdsAnalysis,
      googleAdsFetchError: gA.googleAdsFetchError,
    });
    return [snap, cnts, paidAdsFetchError ?? null];
  }

  // Non-ad-library runs need a resolvable IG social source (ad-library-only returned above).
  const resolved = resolveSocialSource(source);
  if (!resolved) return [null, null, null];

  // Start ads fetch immediately in parallel with social scraping
  const adsPromise = fetchMetaAdsLibrary(ecomPayload, instagramHandleOverride || undefined, adLibraryUrl || undefined);

  let allRaw: RawSocialPost[] = [];
  let igN = 0;
  let fbN = 0;
  let dataSource = "meta_graph";

  if (resolved === "graph") {
    const config = loadMetaSocialConfig();
    if (!config) return [null, null, null];
    dataSource = "meta_graph";
    try {
      const fbPosts = await fetchFacebookPagePosts(config);
      allRaw.push(...fbPosts);
      fbN = fbPosts.length;
    } catch (err) {
      warnings.push(`Facebook fetch failed: ${err}`);
    }
    try {
      if (config.igBusinessId) {
        const igPosts = await fetchInstagramMedia(config);
        allRaw.push(...igPosts);
        igN = igPosts.length;
      } else {
        warnings.push("META_IG_BUSINESS_ID not set — Instagram skipped.");
      }
    } catch (err) {
      warnings.push(`Instagram fetch failed: ${err}`);
    }
  } else {
    const [raw, ig, fb, fetchWarnings, igHandle] = await fetchPublicRawPosts(ecomPayload, productUrl, instagramHandleOverride);
    allRaw = raw;
    igN = ig;
    fbN = fb;
    warnings.push(...fetchWarnings);
    // Encode resolved account handle into dataSource so UI can show "Fetched from @handle"
    dataSource = igHandle ? `apify_public:@${igHandle}` : "apify_public";
  }

  const totalFetched = allRaw.length;
  if (totalFetched === 0) {
    // No Instagram posts — still include paid ads fetched in parallel.
    const { ads: rawPaidAds, fetchError: paidAdsFetchError } = await adsPromise.catch(() => ({
      ads: [] as SocialPaidAdLike[],
      fetchError: "Paid ads fetch failed unexpectedly.",
    }));
    const paidAds = prepPaidAds(rawPaidAds);
    const gB = await resolveGoogle();
    const msg = warnings.filter(Boolean).join("; ") || "No Instagram posts found";
    console.warn(`[social] ${msg}; paid ads: ${paidAds.length}; google ads: ${gB.googleAds.length}`);
    if (paidAds.length > 0 || gB.googleAds.length > 0) {
      const brandName = extractBrandNameFromPayload(ecomPayload) || "brand";
      const [paidAdsAnalysis, enrichedAds] = await Promise.all([
        paidAds.length >= 3 ? generateAdsBrandBook(paidAds, brandName) : Promise.resolve(null),
        attachAdAnalyses(paidAds),
      ]);
      const [snap, cnts] = buildSocialSnapshot([], {
        totalFetched: 0,
        igFetched: 0,
        fbFetched: 0,
        dataSource: "ad_library_only",
        paidAds: enrichedAds,
        paidAdsAnalysis,
        paidAdsFetchError: null,
        googleAds: gB.googleAds,
        googleAdsAnalysis: gB.googleAdsAnalysis,
        googleAdsFetchError: gB.googleAdsFetchError,
      });
      await attachBrandVisualDna(snap);
      const igProfile = await buildIgBrandProfile([], ecomPayload, snap.brandVisualProfile as Record<string, unknown> | undefined);
      if (igProfile) snap.instagramBrandProfile = igProfile;
      return [snap, cnts, warnings.length ? warnings.join("; ") : null];
    }
    const [emptySnap, emptyCounts] = buildSocialSnapshot([], {
      totalFetched: 0,
      igFetched: 0,
      fbFetched: 0,
      dataSource: `failed:${msg}`,
      paidAdsFetchError: paidAdsFetchError ?? (adLibTrimmed ? "No paid ads returned for the Ad Library URL." : undefined),
      googleAdsFetchError: gB.googleAdsFetchError,
    });
    return [emptySnap, emptyCounts, paidAdsFetchError ?? msg];
  }

  // No product matching — just take the brand's 30 MOST RECENT posts.
  // Filter out zero-engagement posts first (they signal a wrong/inactive account).
  const withEngagement = allRaw.filter(p => (p.likes + p.comments) > 0);
  const usablePosts = withEngagement.length >= 3 ? withEngagement : allRaw;

  const sourcePosts = [...usablePosts].sort((a, b) => {
    const aDate = a.created_at ? new Date(String(a.created_at)).getTime() : 0;
    const bDate = b.created_at ? new Date(String(b.created_at)).getTime() : 0;
    if (aDate && bDate) return bDate - aDate;
    return (b.likes + b.comments) - (a.likes + a.comments);
  }).slice(0, 30);

  console.log(`[social] Showing latest ${sourcePosts.length} Instagram posts (no product filter)`);

  const [classified, adsResult] = await Promise.all([
    classifyPostsWithLLM(sourcePosts, ctx),
    adsPromise,
  ]);
  const { ads: rawPaidAds, fetchError: paidAdsFetchError } = adsResult;
  const paidAds = prepPaidAds(rawPaidAds);

  const brandName = ctx.brand || ctx.title.split(" ")[0] || "brand";
  const [paidAdsAnalysis, enrichedAds] = await Promise.all([
    paidAds.length >= 3 ? generateAdsBrandBook(paidAds, brandName) : Promise.resolve(null),
    attachAdAnalyses(paidAds),
  ]);
  const classifiedWithMatch = classified.map(c => ({ ...c, isProductMatch: false }));
  const gD = await resolveGoogle();
  const [snapshot, counts] = buildSocialSnapshot(classifiedWithMatch, {
    totalFetched,
    igFetched: igN,
    fbFetched: fbN,
    dataSource,
    paidAds: enrichedAds,
    paidAdsAnalysis,
    paidAdsFetchError: paidAds.length === 0 ? paidAdsFetchError : null,
    googleAds: gD.googleAds,
    googleAdsAnalysis: gD.googleAdsAnalysis,
    googleAdsFetchError: gD.googleAdsFetchError,
  });

  const warnStr = warnings.length ? warnings.join("; ") : null;

  // DNA first (forensic visual system), then brand profile merges DNA + caption voice.
  await attachBrandVisualDna(snapshot);
  const igProfile = await buildIgBrandProfile(
    snapshot.marketingPosts ?? [],
    ecomPayload,
    snapshot.brandVisualProfile as Record<string, unknown> | undefined,
  );
  if (igProfile) snapshot.instagramBrandProfile = igProfile;

  return [snapshot, counts, warnStr];
}

// ── Competitor social (lightweight) ───────────────────────────────────────────
// Fetches up to `maxPosts` Instagram posts + Meta ads for a competitor brand,
// reusing the same Apify fetchers and snapshot mapping as the user's own brand,
// but SKIPPING all heavy enrichment (brand-DNA vision, per-post LLM analysis,
// ad brand-book). Never throws — returns null/warning on failure.
export async function fetchCompetitorSocial(
  brandCtx: { brand: string; category?: string; productTitle?: string; why?: string; instagramHandle?: string; metaAdLibraryUrl?: string; adKeyword?: string; googleAdsUrl?: string },
  opts?: { maxPosts?: number; googleAds?: { include: boolean; mode: GoogleAdsMode } },
): Promise<CompetitorSocial | null> {
  const brand = (brandCtx.brand ?? "").trim();
  if (!brand) return null;
  // Ads need ONLY Apify; IG posts need the public-social path. Scrape whichever is
  // available so a competitor given only a Meta Ad Library URL still returns its ads
  // when public-social/IG scraping is disabled (PUBLIC_SOCIAL_ENABLED=false) — this
  // was silently dropping such competitors from the comparison.
  if (!getApifyToken()) {
    return { brand, handle: null, why: brandCtx.why ?? null, posts: [], ads: [], googleAds: [], postCount: 0, adCount: 0, googleAdCount: 0, warning: "Apify not configured" };
  }
  const publicOk = isPublicSocialConfigured();

  const maxPosts = Math.max(1, Math.min(30, opts?.maxPosts ?? (parseInt(process.env.COMPETITOR_MAX_POSTS ?? "10", 10) || 10)));

  // Minimal stub payload so the existing brand/handle/keyword resolution works.
  const stub = {
    scope: "ecom",
    ecom: { products: [{ brand, name: brand, title: brandCtx.productTitle ?? brand, category: brandCtx.category ?? "" }] },
  } as unknown as CombinedScraperData;

  // Use the Gemini-guessed OR user-provided handle as a trusted override when
  // present; otherwise let fetchPublicRawPosts run its own discovery from the stub.
  const igOverride = (brandCtx.instagramHandle ?? "").trim() || undefined;
  // A user-provided Meta Ad Library / Facebook Page URL is scraped directly.
  const adLibOverride = (brandCtx.metaAdLibraryUrl ?? "").trim() || undefined;
  const adKeyword = (brandCtx.adKeyword ?? "").trim() || undefined;

  try {
    const [postsRes, adsRes, googleRes] = await Promise.allSettled([
      // IG posts ONLY when the user explicitly pinned this competitor's Instagram handle.
      // Without a handle we do NOT run brand→handle discovery + IG scrape — that was scraping
      // Instagram for competitors given only an Ad Library URL (wasted time + a scrape the
      // user never asked for). Ads-only competitor when no handle is provided.
      (publicOk && igOverride)
        ? fetchPublicRawPosts(stub, undefined, igOverride)
        : Promise.resolve([[], 0, 0, [], null] as Awaited<ReturnType<typeof fetchPublicRawPosts>>),
      // Pass the competitor brand as the ads keyword so a stray BRAND_INSTAGRAM_URL
      // env var can't hijack the search toward the user's own brand. When the user
      // supplied an Ad Library URL for this competitor, scrape that URL directly.
      fetchMetaAdsLibrary(stub, igOverride || brand, adLibOverride, adKeyword),
      // Google Ads Transparency — concurrent with Meta + IG (protects the 800s budget).
      opts?.googleAds?.include
        ? fetchGoogleAds({ brand, googleAdsUrl: (brandCtx.googleAdsUrl ?? "").trim() || undefined }, opts.googleAds.mode)
        : Promise.resolve({ ads: [] as SocialPaidAdLike[] } as GoogleAdsFetchResult),
    ]);

    let raw: RawSocialPost[] = [];
    let igN = 0, fbN = 0, igHandle: string | null = null;
    const warnings: string[] = [];
    if (postsRes.status === "fulfilled") {
      const [r, ig, fb, w, handle] = postsRes.value;
      raw = r; igN = ig; fbN = fb; igHandle = handle ?? null;
      if (w?.length) warnings.push(...w);
    } else {
      warnings.push(`posts: ${String(postsRes.reason)}`);
    }

    const ads = adsRes.status === "fulfilled" ? adsRes.value.ads : [];
    if (adsRes.status === "rejected") warnings.push(`ads: ${String(adsRes.reason)}`);

    const capped = raw.slice(0, maxPosts);
    // Window the competitor's ads to the last 6 months (same as the product path).
    const [snapshot] = buildSocialSnapshot(
      capped.map(post => ({ post, angle: "General" })),
      { totalFetched: capped.length, igFetched: igN, fbFetched: fbN, dataSource: `competitor_public:${igHandle ?? brand}`, paidAds: prepPaidAds(ads) },
    );

    // Per-ad Gemini analysis for the competitor's ads too (influencer + regional
    // language classification for the Ad Library breakdown). Best-effort.
    let analyzedAds = (snapshot.paidAds ?? []) as SocialPaidAd[];
    try {
      if (analyzedAds.length) analyzedAds = await attachAdAnalyses(analyzedAds);
    } catch (e) {
      warnings.push(`ad analysis: ${String(e)}`);
    }

    // Competitor Google ads — enrich inline (same as Meta ads above).
    let analyzedGoogle: SocialPaidAd[] = [];
    if (googleRes.status === "fulfilled") {
      const gAds = prepPaidAds(googleRes.value.ads).map(ad => enrichPaidAd(ad));
      if (gAds.length) {
        try { analyzedGoogle = await attachAdAnalyses(gAds); }
        catch (e) { analyzedGoogle = gAds; warnings.push(`google analysis: ${String(e)}`); }
      }
      if (googleRes.value.fetchError) warnings.push(`google: ${googleRes.value.fetchError}`);
    } else {
      warnings.push(`google: ${String(googleRes.reason)}`);
    }

    return {
      brand,
      handle: igHandle,
      why: brandCtx.why ?? null,
      posts: (snapshot.marketingPosts ?? []).slice(0, maxPosts),
      ads: analyzedAds,
      googleAds: analyzedGoogle,
      postCount: (snapshot.marketingPosts ?? []).length,
      adCount: analyzedAds.length,
      googleAdCount: analyzedGoogle.length,
      warning: warnings.length ? warnings.join("; ") : null,
    };
  } catch (e) {
    return { brand, handle: null, why: brandCtx.why ?? null, posts: [], ads: [], googleAds: [], postCount: 0, adCount: 0, googleAdCount: 0, warning: String(e) };
  }
}
