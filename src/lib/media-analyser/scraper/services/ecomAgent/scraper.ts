/**
 * Amazon product scraper for Ecom Agent.
 * Uses Rainforest API with Firecrawl fallback.
 * Port of Amazon-scraper-GW/server/src/lib/scraper.ts — CF Worker compatible.
 */

export interface ReviewScored {
  body: string;
  rating: number;
  sentiment?: string;
  source?: string;
}

export type ProductPlatform = 'amazon' | 'flipkart' | 'myntra' | 'nykaa' | 'croma';

export interface ProductData {
  asin: string;
  platform?: ProductPlatform;
  title: string;
  brand: string;
  categories_flat: string;
  generic_category?: string;
  url: string;
  description: string;
  bullets: string[];
  rating: number | null;
  ratings_total?: number;
  reviews_total?: number;
  rating_breakdown?: Record<string, number>;
  price: string;
  thumbnails: Array<{ url: string; ocr_description: string }>;
  headline: string;
  winning_hook: string;
  a_plus: Array<{ type: string; visual_desc: string; text_content: string; image_url?: string }>;
  top_10_positive_reviews: string[];
  top_10_negative_reviews: string[];
  reviews_scored?: ReviewScored[];
  reviews_fetched_count?: number;
  amazon_domain?: string;
  sentiment_tags?: unknown[];
  b_plus?: Array<Record<string, unknown>>;
  /** ASINs from Rainforest similar / frequently-bought-together (competitor discovery fallback). */
  related_asins?: string[];
}

export interface ScraperOptions {
  customScraperUrl?: string;
  customScraperKey?: string;
  enrichReviews?: boolean;
  reviewPages?: number;
  productTimeoutMs?: number;         // CUSTOM_PRODUCT_TIMEOUT * 1000 — target product fetch
  competitorTimeoutMs?: number;      // CUSTOM_COMPETITOR_PRODUCT_TIMEOUT * 1000 — competitor fetch
  requestRetries?: number;           // CUSTOM_COMPETITOR_PRODUCT_REQUEST_RETRIES (retry count)
  scanBatchSize?: number;            // CUSTOM_COMPETITOR_SCAN_BATCH_SIZE (concurrent ASINs)
  scanMaxSeconds?: number;           // CUSTOM_COMPETITOR_SCAN_MAX_SECONDS (total scan wall-clock limit)
  candidateMultiplier?: number;      // COMPETITOR_CANDIDATE_MULTIPLIER — over-sample factor (default 3)
  candidateExtra?: number;           // COMPETITOR_CANDIDATE_EXTRA — extra candidates beyond limit*multiplier (default 20)
  // Per-call Rainforest usage sink — fired after every Rainforest API response so the caller
  // can persist credit consumption. Synchronous; caller batches/inserts as needed.
  onRainforestUsage?: (u: RainforestUsage) => void;
  // Per-call custom scraper usage sink — fired after every successful/failed custom scraper call.
  onCustomScraperUsage?: (u: CustomScraperUsage) => void;
}

export interface RainforestUsage {
  callType: 'search' | 'product' | 'reviews' | 'critical_reviews';
  asin?: string;
  creditsUsed: number;
  creditsRemaining?: number;
  success: boolean;
}

export interface CustomScraperUsage {
  callType: 'custom_search' | 'custom_product' | 'custom_review';
  asin?: string;
  success: boolean;
}

export interface CompetitorCandidate {
  asin: string;
  title?: string;
  imageUrl?: string;
  listingUrl?: string;
  avgRating?: number;
  numRatings?: number;
  price?: string;
  rank: number;
}

// Extract Rainforest request_info from a parsed response body and fire the usage sink.
function recordRainforestUsage(
  opts: ScraperOptions,
  callType: RainforestUsage['callType'],
  asin: string | undefined,
  body: unknown,
): void {
  if (!opts.onRainforestUsage) return;
  const ri = (body as { request_info?: Record<string, unknown> })?.request_info;
  if (!ri) return;
  opts.onRainforestUsage({
    callType,
    asin,
    creditsUsed: Number(ri.credits_used_this_request ?? 0),
    creditsRemaining: ri.credits_remaining != null ? Number(ri.credits_remaining) : undefined,
    success: ri.success !== false,
  });
}

// ─── Rainforest quota pause state (module-level, per-isolate) ─────────────────
let _rainforestQuotaUnavailableUntil = 0;
let _rainforestQuotaUnavailableReason = '';

function rainforestQuotaIsPaused(): boolean {
  return Date.now() < _rainforestQuotaUnavailableUntil;
}

function markRainforestQuotaPaused(responseText = '', stage = 'rainforest', ttlSeconds = 900): void {
  _rainforestQuotaUnavailableReason = responseText.slice(0, 180) || 'quota/credits unavailable';
  _rainforestQuotaUnavailableUntil  = Date.now() + ttlSeconds * 1000;
  console.warn(`[Rainforest] ${stage} quota paused for ${ttlSeconds}s: ${_rainforestQuotaUnavailableReason}`);
}

async function recoverRainforestSearchWithCustom(
  query: string,
  amazonDomain: string,
  opts: ScraperOptions,
): Promise<string[]> {
  if (!opts.customScraperUrl) return [];
  console.log(`[Rainforest] Search quota recovery via custom scraper for "${query}"`);
  return (await customScraperSearch(query, amazonDomain, opts)) ?? [];
}

async function recoverRainforestProductWithCustom(
  asin: string,
  amazonDomain: string,
  firecrawlKey: string,
  opts: ScraperOptions,
): Promise<ProductData | null> {
  if (!opts.customScraperUrl) return null;
  console.log(`[Rainforest] Product quota recovery via custom scraper for ${asin}`);
  const raw = await customScraperProduct(asin, amazonDomain, opts);
  if (!raw) return null;
  const out = parseCustomProductResponse(asin, amazonDomain, raw);
  await enrichCompetitorContent(out, firecrawlKey, amazonDomain);
  return out;
}

/**
 * Recover an Amazon product WITHOUT Rainforest (whenever Rainforest is down: 402/
 * email-not-verified/quota/HTTP error). Tries the custom scraper, then falls back to
 * NORMAL SCRAPING (Firecrawl LLM extraction) — the same path used when no Rainforest
 * key is set. Only if both come up empty do we hand back the local placeholder.
 */
async function recoverProductWithoutRainforest(
  asin: string,
  amazonDomain: string,
  firecrawlKey: string,
  opts: ScraperOptions,
): Promise<ProductData | null> {
  const viaCustom = await recoverRainforestProductWithCustom(asin, amazonDomain, firecrawlKey, opts);
  if (viaCustom) return viaCustom;
  console.log(`[Scraper] product asin=${asin} — Rainforest unavailable, trying normal scraping (Firecrawl)`);
  const fc = await firecrawlProduct(asin, firecrawlKey, amazonDomain);
  if (fc) {
    deriveGenericCategory(fc);
    try { await enrichCompetitorContent(fc, firecrawlKey, amazonDomain); } catch { /* non-fatal */ }
    return fc;
  }
  return null;
}

export function extractAsinFromUrl(url: string): string | null {
  // Match canonical Amazon URL patterns: /dp/ASIN or /gp/product/ASIN
  const m = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

export function extractAmazonDomain(url: string, defaultDomain = 'amazon.com'): string {
  const m = url.match(/amazon\.([a-z.]+)/i);
  if (m) return `amazon.${m[1].toLowerCase()}`;
  const normalized = (defaultDomain || 'amazon.com').replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\/$/, '');
  return normalized.startsWith('amazon.') ? normalized : `amazon.${normalized}`;
}

/**
 * Pick marketplace: explicit `amazon.XX` in the user's pasted input wins;
 * otherwise use AMAZON_DOMAIN from .env (so bare ASINs / amzn short links use amazon.com).
 */
export function resolveAmazonMarket(
  userInput: string,
  resolvedUrlAfterRedirect: string,
  configuredDomain?: string,
): string {
  const explicit = userInput.trim().match(/amazon\.([a-z.]+)/i);
  if (explicit) {
    return `amazon.${explicit[1].toLowerCase()}`;
  }
  const cfg = (configuredDomain || process.env.AMAZON_DOMAIN || '').trim();
  if (cfg) {
    return extractAmazonDomain(cfg, 'amazon.com');
  }
  return extractAmazonDomain(resolvedUrlAfterRedirect, 'amazon.com');
}

/** Pull competitor ASIN hints from a Rainforest/custom product payload. */
export function extractRelatedAsinsFromProduct(product: Record<string, unknown>, targetAsin: string): string[] {
  const target = targetAsin.toUpperCase();
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (asin: unknown) => {
    const a = String(asin ?? '').toUpperCase().match(/[A-Z0-9]{10}/)?.[0];
    if (!a || a === target || seen.has(a)) return;
    seen.add(a);
    out.push(a);
  };

  for (const key of [
    'frequently_bought_together',
    'similar_products',
    'compare_with_similar',
    'sponsored_products',
    'also_viewed',
  ]) {
    const pool = product[key];
    if (!Array.isArray(pool)) continue;
    for (const item of pool) {
      if (typeof item === 'string') add(item);
      else if (item && typeof item === 'object') add((item as Record<string, unknown>).asin);
    }
  }
  return out;
}

function customScraperHeaders(key?: string): Record<string, string> {
  return key ? { 'X-API-Key': key } : {};
}

async function customScraperSearch(
  query: string,
  amazonDomain: string,
  opts: ScraperOptions,
): Promise<string[] | null> {
  const candidates = await customScraperSearchCandidates(query, amazonDomain, opts);
  if (!candidates) return null;
  const asins = candidates.map(c => c.asin);
  return asins.length ? asins : null;
}

async function customScraperSearchCandidates(
  query: string,
  amazonDomain: string,
  opts: ScraperOptions,
): Promise<CompetitorCandidate[] | null> {
  const baseUrl = opts.customScraperUrl?.replace(/\/$/, '');
  if (!baseUrl) return null;
  try {
    const params = new URLSearchParams({ type: 'search', search_term: query, amazon_domain: amazonDomain });
    const signal = opts.productTimeoutMs ? AbortSignal.timeout(opts.productTimeoutMs) : undefined;
    const res = await fetch(`${baseUrl}/request?${params}`, {
      headers: customScraperHeaders(opts.customScraperKey),
      signal,
    });
    if (!res.ok) {
      console.warn(`[CustomScraper] Search HTTP ${res.status} for "${query}" — will fall back to Rainforest`);
      opts.onCustomScraperUsage?.({ callType: 'custom_search', success: false });
      return null;
    }
    const body = await res.json() as {
      search_results?: Array<{
        asin?: string;
        title?: string;
        image?: string;
        link?: string;
        rating?: number;
        ratings_total?: number;
        price?: { raw?: string; value?: number };
      }>;
    };
    const results = body.search_results ?? [];
    const candidates: CompetitorCandidate[] = results
      .filter(r => r.asin)
      .map((r, i) => ({
        asin: r.asin!,
        title: r.title,
        imageUrl: r.image,
        listingUrl: r.link,
        avgRating: r.rating,
        numRatings: r.ratings_total,
        price: r.price?.raw,
        rank: i,
      }));
    const found = candidates.length > 0;
    opts.onCustomScraperUsage?.({ callType: 'custom_search', success: found });
    return found ? candidates : null;
  } catch (e) {
    console.warn(`[CustomScraper] Search failed for "${query}": ${e}`);
    opts.onCustomScraperUsage?.({ callType: 'custom_search', success: false });
    return null;
  }
}

async function customScraperProduct(
  asin: string,
  amazonDomain: string,
  opts: ScraperOptions,
): Promise<Record<string, unknown> | null> {
  const baseUrl = opts.customScraperUrl?.replace(/\/$/, '');
  if (!baseUrl) return null;
  const maxAttempts = 1 + (opts.requestRetries ?? 0);
  const timeoutMs = opts.productTimeoutMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const params = new URLSearchParams({ type: 'product', asin, amazon_domain: amazonDomain });
      const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
      const res = await fetch(`${baseUrl}/request?${params}`, {
        headers: customScraperHeaders(opts.customScraperKey),
        signal,
      });
      if (!res.ok) {
        // 4xx = client error (bad ASIN, auth) — no point retrying; 5xx = server error — retry
        const retriable = res.status >= 500;
        console.warn(`[CustomScraper] Product HTTP ${res.status} for ${asin}${retriable && attempt < maxAttempts ? ' — retrying' : ' — falling back to Rainforest'}`);
        if (retriable && attempt < maxAttempts) continue;
        opts.onCustomScraperUsage?.({ callType: 'custom_product', asin, success: false });
        return null;
      }
      const body = await res.json() as { product?: Record<string, unknown> };
      const product = (body.product ?? body) as Record<string, unknown>;
      if (product?.title) {
        opts.onCustomScraperUsage?.({ callType: 'custom_product', asin, success: true });
        return product;
      }
      // 200 OK but no title — malformed response, retry if attempts remain
      console.warn(`[CustomScraper] Product ${asin} returned 200 but no title${attempt < maxAttempts ? ' — retrying' : ' — falling back to Rainforest'}`);
      if (attempt < maxAttempts) continue;
      opts.onCustomScraperUsage?.({ callType: 'custom_product', asin, success: false });
      return null;
    } catch (e) {
      if (attempt === maxAttempts) {
        console.warn(`[CustomScraper] Product failed for ${asin} after ${maxAttempts} attempt(s): ${e} — falling back to Rainforest`);
        opts.onCustomScraperUsage?.({ callType: 'custom_product', asin, success: false });
        return null;
      }
      console.warn(`[CustomScraper] Product attempt ${attempt}/${maxAttempts} failed for ${asin}: ${e} — retrying`);
    }
  }
  return null;
}

async function customScraperReviews(
  asin: string,
  amazonDomain: string,
  opts: ScraperOptions,
  page: number,
  reviewStars?: string,
): Promise<{ reviews: Array<Record<string, unknown>>; hasNextPage?: boolean } | null> {
  const baseUrl = opts.customScraperUrl?.replace(/\/$/, '');
  if (!baseUrl) return null;
  try {
    const params = new URLSearchParams({ type: 'reviews', asin, amazon_domain: amazonDomain, page: String(page) });
    if (reviewStars) params.set('review_stars', reviewStars);
    const timeoutMs = opts.competitorTimeoutMs ?? opts.productTimeoutMs;
    const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
    const res = await fetch(`${baseUrl}/request?${params}`, {
      headers: customScraperHeaders(opts.customScraperKey),
      signal,
    });
    if (!res.ok) {
      console.warn(`[CustomScraper] Reviews HTTP ${res.status} for ${asin} page=${page} — will fall back to Rainforest`);
      opts.onCustomScraperUsage?.({ callType: 'custom_review', asin, success: false });
      return null;
    }
    const body = await res.json() as { reviews?: Array<Record<string, unknown>>; pagination?: { has_next_page?: boolean } };
    opts.onCustomScraperUsage?.({ callType: 'custom_review', asin, success: true });
    return { reviews: body.reviews ?? [], hasNextPage: body.pagination?.has_next_page };
  } catch (e) {
    console.warn(`[CustomScraper] Reviews failed for ${asin}: ${e}`);
    opts.onCustomScraperUsage?.({ callType: 'custom_review', asin, success: false });
    return null;
  }
}

function classifyReviewSentiment(rating: unknown): 'positive' | 'neutral' | 'negative' {
  const score = Number(rating);
  if ((Number.isFinite(score) ? score : 3) >= 3.5) return 'positive';
  if ((Number.isFinite(score) ? score : 3) >= 2.5) return 'neutral';
  return 'negative';
}

function normalizeReview(r: Record<string, unknown>, fallbackRating = 3): { body: string; rating: number } | null {
  const body = String(r.body ?? r.text ?? '');
  const rating = Number(r.rating ?? r.star_rating ?? fallbackRating);
  return body.trim() ? { body, rating: Number.isFinite(rating) ? rating : fallbackRating } : null;
}

function deriveGenericCategory(out: ProductData): void {
  const categoryTree = out.categories_flat ?? '';
  const title = out.title ?? '';
  const brand = out.brand ?? '';
  let genericCategory: string;

  if (!categoryTree || ['general', 'direct scrape', 'fallback data'].includes(categoryTree.toLowerCase())) {
    const shortTitle = title.split(/ with | for | - | \( | \| /i)[0];
    const titleClean = brand ? shortTitle.replace(new RegExp(brand, 'i'), '') : shortTitle;
    const words = titleClean.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    genericCategory = words.length >= 4 ? words.slice(-2).join(' ') : words.join(' ') || 'product';
  } else {
    const parts = categoryTree.split('>').map((c: string) => c.trim()).filter(Boolean);
    genericCategory = parts[2] ?? parts[1] ?? parts[0] ?? 'product';
  }

  if (!genericCategory || (genericCategory.toLowerCase() === 'luggage' && !title.toLowerCase().includes('luggage'))) {
    const words = title.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    genericCategory = words.slice(0, 2).join(' ') || 'item';
  }

  out.generic_category = genericCategory;
}

function localFallbackProduct(asin: string, amazonDomain = 'amazon.com'): ProductData {
  return {
    asin,
    title: `Product ${asin}`,
    brand: '',
    categories_flat: 'Fallback Data',
    generic_category: 'product',
    url: `https://www.${amazonDomain}/dp/${asin}`,
    description: '',
    bullets: [],
    rating: null,
    ratings_total: 0,
    reviews_total: 0,
    rating_breakdown: {},
    price: 'N/A',
    thumbnails: [],
    headline: `Product ${asin}`,
    winning_hook: 'Standard Utility',
    a_plus: [],
    top_10_positive_reviews: [],
    top_10_negative_reviews: [],
    reviews_scored: [],
    reviews_fetched_count: 0,
    amazon_domain: amazonDomain,
  };
}

function parseCustomProductResponse(asin: string, amazonDomain: string, product: Record<string, unknown>): ProductData {
  // Uncomment block below to audit exactly what the custom scraper returned for any ASIN.
  // Grep terminal for [CustomScraper][parse] to trace per-module drop reasons.
  // console.log(`[CustomScraper][parse] ${asin} — title: "${String(product.title ?? '').slice(0, 60)}" brand: "${String(product.brand ?? '')}"`);

  const bullets = (product.feature_bullets as string[] | undefined) ?? (product.bullets as string[] | undefined) ?? [];
  const images = (product.images as Array<Record<string, unknown>> | undefined) ?? [];
  const thumbnails = images.slice(0, 7).flatMap(img => {
    const url = String(img.link ?? img.url ?? img.src ?? '');
    return url ? [{ url, ocr_description: `Gallery: ${String(product.title ?? asin).slice(0, 50)}` }] : [];
  });
  // console.log(`[CustomScraper][parse] ${asin} — gallery images: ${images.length}, thumbnails kept: ${thumbnails.length}`);

  // Merge a_plus array and body_modules, then strip brand story modules by type up-front.
  // isBrandStoryModule catches Rainforest BRAND_STORY_* types and custom scraper's apm-brand-story-card.
  const aPlusRawAll =
    ((product.a_plus as Array<Record<string, unknown>> | undefined) ?? [])
      .concat(((product.a_plus_content as Record<string, unknown> | undefined)?.body_modules as Array<Record<string, unknown>> | undefined) ?? []);

  // Per-module dump — uncomment to see every raw mod type/text before filtering
  // console.log(`[CustomScraper][parse] ${asin} — raw A+ modules before filtering: ${aPlusRawAll.length}`);
  // aPlusRawAll.forEach((mod, i) => {
  //   const t = String(mod.module_type ?? mod.type ?? 'unknown');
  //   const iu = String(mod.image_url ?? '').slice(0, 60);
  //   const tx = String(mod.text ?? mod.body ?? mod.text_content ?? mod.headline ?? '').slice(0, 80);
  //   console.log(`[CustomScraper][parse]   mod[${i}] type="${t}" image_url="${iu}" text="${tx}"`);
  // });

  const aPlusRaw = aPlusRawAll.filter(mod => {
    const t = String(mod.module_type ?? mod.type ?? '');
    if (isBrandStoryModule(t)) {
      // console.log(`[CustomScraper][parse] ${asin} — DROPPED (brand story module type): "${t}"`);
      return false;
    }
    return true;
  });

  const aPlus = aPlusRaw.flatMap((mod) => {
    // Secondary brand story filter by text — custom scraper uses "aplus-v2" for everything
    // including brand story navigation cards, so type-based filtering alone isn't enough.
    const rawText = String(mod.text ?? mod.body ?? mod.text_content ?? mod.headline ?? '');
    if (isBrandStoryText(rawText)) {
      // console.log(`[CustomScraper][parse] ${asin} — DROPPED (brand story text): "${rawText.slice(0, 80)}"`);
      return [];
    }

    // Collect images across all nesting patterns the custom scraper and Rainforest use:
    //   mod.images[]       — most common (array of image objects)
    //   mod.image          — single image (STANDARD_SINGLE_SIDE_IMAGE etc.)
    //   mod.block.image    — STANDARD_IMAGE_CAPTION_BLOCK (singular block wrapper)
    //   mod.blocks[].image — STANDARD_FOUR_IMAGE_TEXT_QUADRANT, THREE_IMAGE_TEXT etc.
    const imgArr: Array<Record<string, unknown>> = [];
    if (Array.isArray(mod.images)) imgArr.push(...(mod.images as Array<Record<string, unknown>>));
    if (mod.image && typeof mod.image === 'object') imgArr.push(mod.image as Record<string, unknown>);
    if (mod.block && typeof mod.block === 'object') {
      const b = mod.block as Record<string, unknown>;
      if (b.image && typeof b.image === 'object') imgArr.push(b.image as Record<string, unknown>);
    }
    for (const blk of (mod.blocks as Array<Record<string, unknown>>) ?? []) {
      if (blk.image && typeof blk.image === 'object') imgArr.push(blk.image as Record<string, unknown>);
    }

    if (imgArr.length) {
      return imgArr.flatMap(img => {
        const imageUrl = String(img.link ?? img.src ?? img.url ?? '');
        const vd = String(img.name ?? img.alt ?? mod.visual_desc ?? 'A+ Content');
        // console.log(`[CustomScraper][parse] ${asin} — A+ image accepted: visual_desc="${vd.slice(0, 60)}" url="${imageUrl.slice(0, 60)}"`);
        return imageUrl ? [{
          type: String(mod.module_type ?? mod.type ?? 'image_module'),
          visual_desc: vd,
          text_content: String(mod.text ?? mod.body ?? mod.text_content ?? '').slice(0, 200),
          image_url: imageUrl,
        }] : [];
      });
    }

    // Drop pure UI layout wrappers that have no image and no real content.
    // These inflate a_plus.length and falsely suppress the Firecrawl enrichment call.
    const modType = String(mod.module_type ?? mod.type ?? '').toLowerCase();
    const WRAPPER_TYPES = new Set(['aplus-module-wrapper', 'aplus-content-wrapper', 'apm-spacing', 'aplus-module']);
    const hasImageUrl = String(mod.image_url ?? '').trim() !== '';
    if (!hasImageUrl && WRAPPER_TYPES.has(modType)) {
      // console.log(`[CustomScraper][parse] ${asin} — DROPPED (empty wrapper type): "${modType}"`);
      return [];
    }

    // Text-only module — keep but no image_url
    return [{
      type: String(mod.module_type ?? mod.type ?? 'text_module'),
      visual_desc: String(mod.visual_desc ?? mod.headline ?? 'A+ Content'),
      text_content: String(mod.text ?? mod.body ?? mod.text_content ?? mod.headline ?? '').slice(0, 200),
      image_url: String(mod.image_url ?? ''),
    }];
  });

  console.log(`[CustomScraper] ${asin} — parsed: a_plus=${aPlus.length} (${aPlus.filter(m => m.image_url).length} with image_url) thumbnails=${thumbnails.length}`);

  const out: ProductData = {
    asin,
    title: String(product.title ?? ''),
    brand: String(product.brand ?? ''),
    categories_flat: String(product.categories_flat ?? 'Direct Scrape'),
    url: String(product.link ?? product.url ?? `https://www.${amazonDomain}/dp/${asin}`),
    description: String(product.description ?? ''),
    bullets,
    rating: product.rating == null ? null : Number(product.rating),
    ratings_total: Number(product.ratings_total ?? 0),
    reviews_total: Number(product.reviews_total ?? 0),
    rating_breakdown: (product.rating_breakdown as Record<string, number>) ?? {},
    price: String(((product.buybox_winner as Record<string, any> | undefined)?.price?.raw) ?? product.price ?? 'N/A'),
    thumbnails,
    headline: String(product.title ?? ''),
    winning_hook: bullets[0] ?? 'Standard Utility',
    a_plus: aPlus,
    top_10_positive_reviews: [],
    top_10_negative_reviews: [],
    reviews_scored: [],
    amazon_domain: amazonDomain,
    related_asins: extractRelatedAsinsFromProduct(product, asin),
  };

  for (const review of ((product.top_reviews as Array<Record<string, unknown>>) ?? []).slice(0, 8)) {
    const normalized = normalizeReview(review);
    if (!normalized) continue;
    out.reviews_scored!.push({ ...normalized, sentiment: classifyReviewSentiment(normalized.rating), source: String(review.source ?? 'amazon_product_page') });
    if (normalized.rating >= 4) out.top_10_positive_reviews.push(normalized.body);
    else out.top_10_negative_reviews.push(normalized.body);
  }
  out.reviews_fetched_count = out.top_10_positive_reviews.length + out.top_10_negative_reviews.length;
  deriveGenericCategory(out);
  return out;
}

async function firecrawlSearch(
  query: string,
  apiKey: string,
  amazonDomain = 'amazon.com',
): Promise<string[]> {
  console.log(`[EcomDebug] firecrawlSearch: Called for query "${query}" on domain ${amazonDomain}`);
  if (!apiKey) {
    console.warn(`[EcomDebug] firecrawlSearch: Skipped because no firecrawlKey provided.`);
    return [];
  }
  try {
    const searchUrl = `https://www.${amazonDomain}/s?k=${query.replace(/ /g, '+')}`;
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: searchUrl, formats: ['markdown'], onlyMainContent: false }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: { markdown?: string } };
    const text = data.data?.markdown ?? '';
    const contextual = [...text.matchAll(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/g)].map(m => m[1]);
    const asins = [...new Set(contextual)];
    if (!asins.length) {
      const potential = [...text.matchAll(/([A-Z0-9]{10})/g)]
        .map(m => m[1])
        .filter(a => !/^\d+$/.test(a));
      return [...new Set(potential)].slice(0, 10);
    }
    return asins.slice(0, 10);
  } catch (e) {
    console.error(`[Firecrawl] Search error: ${e}`);
    return [];
  }
}

// Detect brand story text from custom scraper which labels all A+ as "aplus-v2" without
// distinguishing brand story. Pattern: "BRAND APPLIANCES Previous page For over X years..."
function isBrandStoryText(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes('previous page') ||
    t.includes('visit the store') ||
    t.includes('visit the brand') ||
    /for over \d+ years/.test(t) ||
    (t.includes('pioneer') && t.includes('innovative')) ||
    t.includes('our brand story') ||
    t.includes('committed to excellence') ||
    t.includes('committed to sustainability')
  );
}

// "From the brand" / brand story module types from Rainforest API — brand-level banners that
// show the entire product range, not the specific product being audited. Always excluded.
const BRAND_STORY_MODULE_TYPES = new Set([
  'BRAND_STORY_HALF_SHEET',
  'BRAND_STORY_FULL_SHEET',
  'BRAND_STORY_LOGO_WITH_BACKGROUND',
]);
function isBrandStoryModule(moduleType: string): boolean {
  const t = moduleType.toUpperCase();
  return BRAND_STORY_MODULE_TYPES.has(t) || t.startsWith('BRAND_STORY') || t.includes('BRAND-STORY') || t.includes('BRAND_STORY');
}

async function firecrawlProduct(
  asin: string,
  apiKey: string,
  amazonDomain = 'amazon.com',
): Promise<ProductData | null> {
  console.log(`[EcomDebug] firecrawlProduct: Starting LLM extraction for ASIN ${asin} on domain ${amazonDomain}`);
  if (!apiKey) {
    console.warn(`[EcomDebug] firecrawlProduct: Skipped for ASIN ${asin} because no firecrawlKey provided.`);
    return null;
  }
  const targetUrl = `https://www.${amazonDomain}/dp/${asin}`;
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        url: targetUrl,
        formats: ['json'],
        jsonOptions: {
          prompt: 'Extract only content that belongs to THIS specific product listing. ' +
            'product_images: only the main gallery images of this product (the image carousel at the top of the page). ' +
            'a_plus_modules: only from the "Product Description" / A+ content section (rich imagery and text blocks in the middle of the page, NOT sponsored, NOT related products, NOT recommendations, NOT "Customers also bought"). ' +
            'brand_story_modules: ONLY the "From the brand" section if present (the banner/carousel showing the brand range). ' +
            'Do NOT include images from: sponsored products, recommended products, related items, "customers also bought", "customers also viewed", or any other product listings.',
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' }, brand: { type: 'string' }, price: { type: 'string' },
              rating: { type: 'number' }, bullets: { type: 'array', items: { type: 'string' } },
              description: { type: 'string' },
              product_images: {
                type: 'array',
                description: 'Only the main gallery/carousel images of this specific product at the top of the page',
                items: { type: 'string' },
              },
              a_plus_modules: {
                type: 'array',
                description: 'Rich content modules from the Product Description / A+ section only — NOT from recommendations or other products',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' }, image_url: { type: 'string' },
                    headline: { type: 'string' }, body: { type: 'string' },
                  },
                },
              },
              brand_story_modules: {
                type: 'array',
                description: 'Only the "From the brand" section — brand-level banner/carousel showing brand product range',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' }, image_url: { type: 'string' },
                    headline: { type: 'string' }, body: { type: 'string' },
                  },
                },
              },
              top_positive_reviews: { type: 'array', items: { type: 'string' } },
              top_negative_reviews: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      }),
    });
    const body = await res.json() as { data?: { json?: Record<string, unknown> } };
    const d = body.data?.json;
    if (!d) return null;
    
    const bullets = (d.bullets as string[]) ?? [];
    const thumbnails: Array<{ url: string; ocr_description: string }> = [];
    const a_plus: Array<{ type: string; visual_desc: string; text_content: string; image_url?: string }> = [];
    
    for (const url of ((d.product_images as string[]) ?? []).slice(0, 7)) {
      if (url) thumbnails.push({ url, ocr_description: `Gallery: ${String(d.title ?? asin).slice(0, 50)}` });
    }
    
    for (const mod of ((d.a_plus_modules as Array<Record<string, unknown>>) ?? [])) {
      if (isBrandStoryModule(String(mod.type ?? ''))) continue;
      a_plus.push({
        type: String(mod.type ?? 'image_module'),
        visual_desc: String(mod.headline ?? 'A+ Content'),
        text_content: String(mod.body ?? mod.headline ?? ''),
        image_url: String(mod.image_url ?? ''),
      });
      if (mod.image_url && thumbnails.length < 12) {
        thumbnails.push({ url: String(mod.image_url), ocr_description: `[A+] ${String(mod.headline ?? 'Graphic')}` });
      }
    }
    
    // brand_story_modules = "From the brand" section on Amazon — shows entire brand product line, not this product. Skipped entirely.

    const out: ProductData = {
      asin, title: (d.title as string) ?? `Product ${asin}`, brand: (d.brand as string) ?? '',
      categories_flat: 'General', url: targetUrl, description: (d.description as string) ?? '',
      bullets, rating: (d.rating as number) ?? 0, price: (d.price as string) ?? 'N/A',
      thumbnails, headline: (d.title as string) ?? '',
      winning_hook: bullets[0] ?? 'Standard Utility',
      a_plus,
      top_10_positive_reviews: ((d.top_positive_reviews as string[]) ?? []).slice(0, 10),
      top_10_negative_reviews: ((d.top_negative_reviews as string[]) ?? []).slice(0, 10),
    };
    console.log(`[EcomDebug] firecrawlProduct: Successfully extracted ASIN ${asin}.`);
    return out;
  } catch (e) {
    console.error(`[EcomDebug] firecrawlProduct error for ASIN ${asin}:`, e);
    return null;
  }
}

async function firecrawlAplusContent(
  asin: string,
  apiKey: string,
  amazonDomain = 'amazon.com',
): Promise<Array<{ type: string; visual_desc: string; text_content: string; image_url?: string }>> {
  if (!apiKey) return [];
  const targetUrl = `https://www.${amazonDomain}/dp/${asin}`;
  console.log(`[FirecrawlAplus] ${asin} — fetching A+ from ${targetUrl}`);
  try {
    // Fetch BOTH structured json (LLM extraction) AND markdown so we can recover image URLs from
    // markdown when the LLM forgets them. Firecrawl supports multi-format in a single call.
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        url: targetUrl,
        formats: ['json', 'markdown'],
        jsonOptions: {
          prompt: 'Extract ONLY modules from the "Product Description" / A+ content section of this Amazon product page. ' +
            'This section appears in the middle of the page and contains rich branded imagery, feature highlights, and comparison charts. ' +
            'For EVERY module, you MUST return the image_url if any image is present — extract it directly from the <img src="..."> tags in the A+ section. ' +
            'Do NOT include anything from: "From the brand", sponsored products, recommendations, "Customers also bought/viewed", or any other product listings.',
          schema: {
            type: 'object',
            properties: {
              a_plus_modules: {
                type: 'array',
                description: 'Modules from the Product Description / A+ section only',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    image_url: { type: 'string' },
                    headline: { type: 'string' },
                    body: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      }),
    });
    if (!res.ok) {
      console.warn(`[FirecrawlAplus] ${asin} — HTTP ${res.status} from Firecrawl`);
      return [];
    }
    const body = await res.json() as {
      data?: {
        json?: { a_plus_modules?: Array<Record<string, unknown>> };
        markdown?: string;
      };
    };
    const rawMods = body.data?.json?.a_plus_modules ?? [];

    // Fallback: harvest Amazon A+ CDN image URLs from markdown when LLM-extracted modules
    // lack image_url. Amazon A+ images live on `m.media-amazon.com/images/S/aplus-media...`.
    const markdownImageUrls: string[] = [];
    if (body.data?.markdown) {
      const aplusImgRegex = /https:\/\/m\.media-amazon\.com\/images\/S\/aplus-media[^\s)"']+\.(?:jpg|jpeg|png|webp)/gi;
      const seen = new Set<string>();
      for (const match of body.data.markdown.matchAll(aplusImgRegex)) {
        if (!seen.has(match[0])) {
          seen.add(match[0]);
          markdownImageUrls.push(match[0]);
        }
      }
    }
    // Uncomment to audit raw Firecrawl response — grep [FirecrawlAplus] in terminal
    // console.log(`[FirecrawlAplus] ${asin} — raw modules from Firecrawl: ${rawMods.length}`);
    // rawMods.forEach((mod, i) => {
    //   console.log(`[FirecrawlAplus] ${asin}   raw[${i}] type="${String(mod.type ?? '')}" image_url="${String(mod.image_url ?? '').slice(0, 60)}" headline="${String(mod.headline ?? '').slice(0, 60)}"`);
    // });

    // Extra safety filter — Firecrawl LLM occasionally leaks brand story modules through,
    // and on products with NO real A+ content it tends to misidentify the feature_bullets
    // section as A+ modules (returning headline-only `feature_highlight` items with no image
    // and no body). Reject those — they pollute the A+ data with bullet-point text.
    const filteredMods = rawMods
      .filter(mod => !isBrandStoryModule(String(mod.type ?? '')))
      .map(mod => ({
        type: String(mod.type ?? 'image_module'),
        visual_desc: String(mod.headline ?? 'A+ Content'),
        text_content: String(mod.body ?? mod.headline ?? ''),
        image_url: String(mod.image_url ?? ''),
      }))
      .filter(mod => {
        // Drop modules that are clearly misidentified feature_bullets: no image AND body
        // is empty or identical to the headline (LLM duplicates headline as body when no
        // real body exists). Real A+ modules always have either an image or substantial
        // body text distinct from the headline.
        const hasImage = !!mod.image_url;
        const hasRealBody = mod.text_content.length > 30 && mod.text_content !== mod.visual_desc;
        return hasImage || hasRealBody;
      });

    // Backfill missing image_urls from markdown harvest. Many Firecrawl LLM responses return
    // module text+headline but drop the <img> src — pair them positionally with markdown URLs.
    let mdIdx = 0;
    const usedMdUrls = new Set<string>(filteredMods.map(m => m.image_url).filter(Boolean));
    for (const mod of filteredMods) {
      if (mod.image_url) continue;
      while (mdIdx < markdownImageUrls.length && usedMdUrls.has(markdownImageUrls[mdIdx])) mdIdx++;
      if (mdIdx < markdownImageUrls.length) {
        mod.image_url = markdownImageUrls[mdIdx];
        usedMdUrls.add(markdownImageUrls[mdIdx]);
        mdIdx++;
      }
    }

    // If LLM returned zero modules but markdown has A+ images, build modules from them as last resort
    if (filteredMods.length === 0 && markdownImageUrls.length > 0) {
      for (const url of markdownImageUrls.slice(0, 12)) {
        filteredMods.push({
          type: 'image_module',
          visual_desc: 'A+ Content',
          text_content: 'A+ Content',
          image_url: url,
        });
      }
      console.log(`[FirecrawlAplus] ${asin} — built ${filteredMods.length} modules from markdown fallback (LLM returned 0)`);
    }

    console.log(`[FirecrawlAplus] ${asin} — returned ${filteredMods.length} A+ modules (${filteredMods.filter(m => m.image_url).length} with image_url, ${markdownImageUrls.length} markdown URLs harvested)`);
    return filteredMods;
  } catch (e) {
    console.error(`[FirecrawlAplus] ${asin} — error: ${e}`);
    return [];
  }
}


// firecrawlBplusContent — originally written by Raza to fetch the "From the brand" Amazon section.
// DISABLED: this section is a brand-level showcase (entire product range carousel), not A+ content
// for the specific audited product. Storing it in product.b_plus polluted the creative dashboard
// with competitor or sibling-product images. Kept here for reference; do not re-enable without
// adding a filter that confirms images are specific to the audited ASIN.
//
// async function firecrawlBplusContent(
//   asin: string,
//   apiKey: string,
//   amazonDomain = 'amazon.com',
// ): Promise<Array<Record<string, unknown>>> {
//   if (!apiKey) return [];
//   const targetUrl = `https://www.${amazonDomain}/dp/${asin}`;
//   try {
//     const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
//       method: 'POST',
//       headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         url: targetUrl,
//         formats: ['json'],
//         jsonOptions: {
//           schema: {
//             type: 'object',
//             properties: {
//               brand_story_modules: {
//                 type: 'array',
//                 items: {
//                   type: 'object',
//                   properties: {
//                     type: { type: 'string' },
//                     image_url: { type: 'string' },
//                     headline: { type: 'string' },
//                     body: { type: 'string' },
//                   },
//                 },
//               },
//             },
//           },
//         },
//       }),
//     });
//     if (!res.ok) return [];
//     const body = await res.json() as { data?: { json?: { brand_story_modules?: Array<Record<string, unknown>> } } };
//     return body.data?.json?.brand_story_modules ?? [];
//   } catch {
//     return [];
//   }
// }

export async function enrichCompetitorContent(
  product: ProductData,
  firecrawlKey: string,
  amazonDomain = 'amazon.com',
): Promise<void> {
  if (!firecrawlKey) return;

  // Do NOT skip Firecrawl based on raw a_plus.length — the custom scraper can populate
  // a_plus with brand story navigation cards (no image_url) or with images from the wrong
  // brand's A+ section scraped from an adjacent Amazon page section (e.g. Acquaso images
  // stored under BoilPRO). Both cases look like "has data" but are useless.
  //
  // Instead, count only image-bearing entries whose visual_desc matches the product's own
  // brand. Generic placeholders ("A+ Content", "Gallery:...") are accepted without brand check.
  // If fewer than 2 valid images exist, call Firecrawl for clean data regardless.
  const brand = (product.brand ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Uncomment to audit per-entry brand validation — grep [Enrich] in terminal
  // console.log(`[Enrich] ${product.asin} "${product.title.slice(0, 50)}" — brand="${product.brand}" a_plus total=${product.a_plus.length}`);
  // product.a_plus.forEach((m, i) => {
  //   console.log(`[Enrich] ${product.asin}   existing[${i}] type="${m.type}" visual_desc="${m.visual_desc.slice(0, 60)}" image_url="${(m.image_url ?? '').slice(0, 60)}"`);
  // });

  const validImageCount = product.a_plus.filter(m => {
    if (!m.image_url || m.image_url.trim() === '') return false;
    if (!brand) return true;
    const vd = m.visual_desc.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    if (vd === 'a+ content' || vd.startsWith('gallery')) return true; // generic placeholder — accept
    return vd.includes(brand); // reject if visual_desc names a different brand
  }).length;

  if (validImageCount >= 2) return;

  try {
    const aplusMods = await firecrawlAplusContent(product.asin, firecrawlKey, amazonDomain);
    product.a_plus.push(...aplusMods);
  } catch (e) {
    console.warn(`[Firecrawl] A+ enrichment failed for ${product.asin}: ${e}`);
  }
}

export async function rainforestSearch(
  query: string,
  rainforestKey: string,
  firecrawlKey: string,
  amazonDomain = 'amazon.com',
  opts: ScraperOptions = {},
): Promise<string[]> {
  const candidates = await rainforestSearchCandidates(query, rainforestKey, firecrawlKey, amazonDomain, opts);
  return candidates.map(c => c.asin);
}

/**
 * Like rainforestSearch but returns rich candidate data (title, image, rating, reviews, price, link).
 * Used during Phase 1 of the audit to show competitor cards to the user before deep-scraping.
 */
export async function rainforestSearchCandidates(
  query: string,
  rainforestKey: string,
  firecrawlKey: string,
  amazonDomain = 'amazon.com',
  opts: ScraperOptions = {},
): Promise<CompetitorCandidate[]> {
  console.log(`[EcomDebug] rainforestSearchCandidates: Called for query "${query}"`);
  try {
    const customCandidates = await customScraperSearchCandidates(query, amazonDomain, opts);
    if (customCandidates) {
      console.log(`[Scraper] search query="${query}" source=CustomScraper results=${customCandidates.length}`);
      return customCandidates;
    }
    console.log(`[Scraper] search query="${query}" source=CustomScraper MISS — trying Rainforest`);
  } catch (e) {
    console.warn(`[Scraper] search query="${query}" source=CustomScraper threw: ${e} — falling back to Rainforest`);
  }
  if (!rainforestKey) {
    console.log(`[Scraper] search query="${query}" source=Firecrawl (no Rainforest key)`);
    const asins = await firecrawlSearch(query, firecrawlKey, amazonDomain);
    return asins.map((asin, i) => ({ asin, rank: i }));
  }
  if (rainforestQuotaIsPaused()) {
    console.warn(`[Rainforest] Search quota paused (${_rainforestQuotaUnavailableReason}) — recovering via custom scraper`);
    const asins = await recoverRainforestSearchWithCustom(query, amazonDomain, opts);
    return asins.map((asin, i) => ({ asin, rank: i }));
  }
  try {
    const params = new URLSearchParams({
      api_key: rainforestKey, type: 'search',
      amazon_domain: amazonDomain, search_term: query, sort_by: 'featured',
    });
    const res = await fetch(`https://api.rainforestapi.com/request?${params}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 402) {
      const body = await res.text();
      markRainforestQuotaPaused(body, 'rainforest_search');
      const asins = await recoverRainforestSearchWithCustom(query, amazonDomain, opts);
      return asins.map((asin, i) => ({ asin, rank: i }));
    }
    if (!res.ok) {
      console.warn(`[Rainforest] Search HTTP ${res.status} for "${query}" — recovering via custom scraper`);
      const asins = await recoverRainforestSearchWithCustom(query, amazonDomain, opts);
      return asins.map((asin, i) => ({ asin, rank: i }));
    }
    const body = await res.json() as {
      search_results?: Array<{
        asin?: string;
        title?: string;
        image?: string;
        link?: string;
        rating?: number;
        ratings_total?: number;
        price?: { raw?: string; value?: number };
      }>;
    };
    recordRainforestUsage(opts, 'search', undefined, body);
    const candidates: CompetitorCandidate[] = (body.search_results ?? [])
      .filter(r => r.asin)
      .map((r, i) => ({
        asin: r.asin!,
        title: r.title,
        imageUrl: r.image,
        listingUrl: r.link,
        avgRating: r.rating,
        numRatings: r.ratings_total,
        price: r.price?.raw,
        rank: i,
      }));
    console.log(`[Scraper] search query="${query}" source=Rainforest results=${candidates.length}`);
    return candidates;
  } catch (e) {
    console.error(`[EcomDebug] rainforestSearchCandidates error:`, e);
    const asins = await firecrawlSearch(query, firecrawlKey, amazonDomain);
    return asins.map((asin, i) => ({ asin, rank: i }));
  }
}

export async function rainforestProduct(
  asin: string,
  rainforestKey: string,
  firecrawlKey: string,
  amazonDomain = 'amazon.com',
  opts: ScraperOptions = {},
): Promise<ProductData | null> {
  console.log(`[EcomDebug] rainforestProduct: Called for ASIN ${asin} on ${amazonDomain}`);
  try {
    const customRaw = await customScraperProduct(asin, amazonDomain, opts);
    if (customRaw) {
      const out = parseCustomProductResponse(asin, amazonDomain, customRaw);
      console.log(`[Scraper] product asin=${asin} source=CustomScraper title="${out.title.slice(0, 60)}" thumbnails=${out.thumbnails.length} a_plus=${out.a_plus.length}`);
      try {
        if (opts.enrichReviews ?? true) await enrichReviews(out, rainforestKey, amazonDomain, opts);
      } catch (e) {
        console.warn(`[Scraper] product asin=${asin} enrichReviews failed (non-fatal): ${e}`);
      }
      try {
        await enrichCompetitorContent(out, firecrawlKey, amazonDomain);
      } catch (e) {
        console.warn(`[Scraper] product asin=${asin} enrichCompetitorContent failed (non-fatal): ${e}`);
      }
      console.log(`[Scraper] product asin=${asin} source=CustomScraper FINAL a_plus=${out.a_plus.length} (${out.a_plus.filter(m => m.image_url).length} with image) thumbnails=${out.thumbnails.length} reviews=${out.reviews_fetched_count ?? 0}`);
      return out;
    }
  } catch (e) {
    console.warn(`[Scraper] product asin=${asin} source=CustomScraper threw unexpectedly: ${e} — falling back to Rainforest`);
  }
  console.log(`[Scraper] product asin=${asin} source=CustomScraper MISS — trying Rainforest/Firecrawl`);
  if (!rainforestKey) {
    console.log(`[EcomDebug] rainforestProduct: No rainforestKey. Falling back to firecrawlProduct.`);
    const fallback = await firecrawlProduct(asin, firecrawlKey, amazonDomain);
    if (fallback) {
      deriveGenericCategory(fallback);
      await enrichCompetitorContent(fallback, firecrawlKey, amazonDomain);
    }
    return fallback ?? localFallbackProduct(asin, amazonDomain);
  }
  if (rainforestQuotaIsPaused()) {
    console.warn(`[Rainforest] Product quota paused (${_rainforestQuotaUnavailableReason}) — recovering without Rainforest for ${asin}`);
    const recovered = await recoverProductWithoutRainforest(asin, amazonDomain, firecrawlKey, opts);
    return recovered ?? localFallbackProduct(asin, amazonDomain);
  }
  try {
    const params = new URLSearchParams({
      api_key: rainforestKey, type: 'product', amazon_domain: amazonDomain, asin,
      include_summarization_attributes: 'true',
      include_a_plus_body: 'true',
    });
    const res = await fetch(`https://api.rainforestapi.com/request?${params}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 402) {
      const errText = await res.text();
      console.warn(`[Rainforest] Product quota/credits issue for ${asin}: ${errText.slice(0, 180)}`);
      markRainforestQuotaPaused(errText, 'rainforest_product');
      const recovered = await recoverProductWithoutRainforest(asin, amazonDomain, firecrawlKey, opts);
      return recovered ?? localFallbackProduct(asin, amazonDomain);
    }
    if (!res.ok) {
      console.warn(`[Rainforest] Product HTTP ${res.status} for ${asin} — recovering without Rainforest`);
      const recovered = await recoverProductWithoutRainforest(asin, amazonDomain, firecrawlKey, opts);
      return recovered ?? localFallbackProduct(asin, amazonDomain);
    }
    const body = await res.json() as { product?: Record<string, unknown> };
    recordRainforestUsage(opts, 'product', asin, body);
    const product = body.product ?? {};
    if (!product.title) {
      console.warn(`[EcomDebug] rainforestProduct: ASIN ${asin} returned empty product from Rainforest.`);
    }
    const relatedAsins = extractRelatedAsinsFromProduct(product, asin);
    if (relatedAsins.length) {
      console.log(`[Scraper] product asin=${asin} related_asins=${relatedAsins.length} sample=${relatedAsins.slice(0, 5).join(',')}`);
    }
    const bullets = (product.feature_bullets as string[]) ?? [];
    const buybox = (product.buybox_winner as Record<string, unknown>) ?? {};
    const priceObj = (buybox.price as Record<string, unknown>) ?? {};

    const out: ProductData = {
      asin, title: (product.title as string) ?? '', brand: (product.brand as string) ?? '',
      categories_flat: (product.categories_flat as string) ?? '',
      url: (product.link as string) ?? `https://www.${amazonDomain}/dp/${asin}`,
      description: (product.description as string) ?? '',
      bullets, rating: (product.rating as number) ?? null,
      ratings_total: (product.ratings_total as number) ?? undefined,
      reviews_total: (product.reviews_total as number) ?? undefined,
      rating_breakdown: (product.rating_breakdown as Record<string, number>) ?? undefined,
      price: (priceObj.raw as string) ?? 'N/A',
      thumbnails: [], headline: (product.title as string) ?? '',
      winning_hook: bullets[0] ?? 'Standard Utility',
      a_plus: [], top_10_positive_reviews: [], top_10_negative_reviews: [],
      amazon_domain: amazonDomain,
      related_asins: relatedAsins,
    };

    for (const img of ((product.images as Array<Record<string, unknown>>) ?? []).slice(0, 7)) {
      out.thumbnails.push({ url: (img.link as string) ?? '', ocr_description: `Gallery: ${out.title.slice(0, 50)}` });
    }

    const aplusData = (product.a_plus_content as Record<string, unknown>) ?? {};
    // Don't gate on has_a_plus_content — Rainforest occasionally reports it as false/null
    // even when body_modules or all_images contain real A+ data. Process whatever's present;
    // the empty checks below handle the truly-absent case.
    {
      const seenAplus = new Set<string>();
      const bodyModules = (aplusData.body_modules as Array<Record<string, unknown>>) ?? [];
      const allImages = (aplusData.all_images as Array<Record<string, unknown>>) ?? [];

      // Uncomment to audit raw Rainforest A+ response — grep [Rainforest][aplus] in terminal
      // console.log(`[Rainforest][aplus] ${asin} — body_modules: ${bodyModules.length}, all_images: ${allImages.length}`);
      // bodyModules.forEach((mod, i) => {
      //   const t = String((mod.module_type as string) ?? 'unknown');
      //   const imgs = Array.isArray(mod.images) ? mod.images.length : (mod.image ? 1 : 0);
      //   console.log(`[Rainforest][aplus] ${asin}   body_mod[${i}] type="${t}" images=${imgs} block=${mod.block ? 'yes' : 'no'} blocks=${Array.isArray(mod.blocks) ? mod.blocks.length : 0}`);
      // });

      if (bodyModules.length > 0) {
        // Primary: body_modules with full brand-story filtering.
        // all_images is NOT used as primary because it also contains brand story images
        // (brand story is part of Amazon's A+ framework) and can't be filtered by type.
        for (const mod of bodyModules) {
          const moduleType = (mod.module_type as string) ?? 'unknown_module';
          if (isBrandStoryModule(moduleType)) continue;
          const moduleText = (mod.text as string) ?? (mod.body as string) ?? '';
          if (isBrandStoryText(moduleText)) continue;

          // Collect images across ALL Rainforest nesting patterns:
          //   mod.images[]       — STANDARD_MULTIPLE_IMAGE_TEXT and similar
          //   mod.image          — STANDARD_SINGLE_SIDE_IMAGE, PREMIUM_IMAGE_CAPTION_OVERLAY, etc.
          //   mod.block.image    — STANDARD_IMAGE_CAPTION_BLOCK (singular "block" wrapper)
          //   mod.blocks[].image — STANDARD_FOUR_IMAGE_TEXT_QUADRANT, STANDARD_THREE_IMAGE_TEXT, etc.
          const rawImgs: Array<Record<string, unknown>> = [];
          if (Array.isArray(mod.images)) rawImgs.push(...(mod.images as Array<Record<string, unknown>>));
          if (mod.image && typeof mod.image === 'object') rawImgs.push(mod.image as Record<string, unknown>);
          if (mod.block && typeof mod.block === 'object') {
            const b = mod.block as Record<string, unknown>;
            if (b.image && typeof b.image === 'object') rawImgs.push(b.image as Record<string, unknown>);
          }
          for (const block of (mod.blocks as Array<Record<string, unknown>>) ?? []) {
            if (block.image && typeof block.image === 'object') rawImgs.push(block.image as Record<string, unknown>);
          }

          for (const img of rawImgs) {
            const imgUrl = (img.link as string) ?? (img.src as string) ?? '';
            if (!imgUrl || seenAplus.has(imgUrl)) continue;
            seenAplus.add(imgUrl);
            const desc = (img.name as string) ?? (img.alt as string) ?? `A+ ${moduleType}`;
            out.a_plus.push({ type: moduleType, visual_desc: desc, text_content: moduleText.slice(0, 200) || desc, image_url: imgUrl });
            if (out.thumbnails.length < 12) out.thumbnails.push({ url: imgUrl, ocr_description: `[${moduleType}] ${desc}` });
          }

          if (moduleText && rawImgs.length === 0) {
            out.a_plus.push({ type: moduleType, visual_desc: `A+ ${moduleType} (text only)`, text_content: moduleText.slice(0, 200) });
          }
        }
      } else {
        // Fallback: body_modules missing entirely — use all_images as last resort.
        // Only reached when Rainforest returns no body_modules at all.
        for (const img of allImages) {
          const imgUrl = (img.link as string) ?? (img.src as string) ?? '';
          if (!imgUrl || seenAplus.has(imgUrl)) continue;
          seenAplus.add(imgUrl);
          const desc = (img.name as string) ?? (img.alt as string) ?? 'A+ Content Graphic';
          out.a_plus.push({ type: 'image_module', visual_desc: desc, text_content: desc, image_url: imgUrl });
          if (out.thumbnails.length < 12) out.thumbnails.push({ url: imgUrl, ocr_description: desc });
        }
      }
    }

    // Collect initial top_reviews with actual ratings
    const initialScored: Array<{ body: string; rating: number; sentiment: 'positive' | 'neutral' | 'negative' }> = [];
    for (const r of (product.top_reviews as Array<Record<string, unknown>>) ?? []) {
      const body = (r.body as string) ?? '';
      const rating = Number(r.rating ?? 3);
      if ((r.rating as number) >= 4) out.top_10_positive_reviews.push(body);
      else out.top_10_negative_reviews.push(body);
      if (body.trim()) {
        const sentiment = rating >= 3.5 ? 'positive' : rating >= 2.5 ? 'neutral' : 'negative';
        initialScored.push({ body, rating, sentiment });
      }
    }

    try {
      const paginatedReviews = (opts.enrichReviews ?? true)
        ? await fetchReviews(asin, rainforestKey, amazonDomain, opts.reviewPages ?? 15, opts)
        : [];
      const criticalReviews = (opts.enrichReviews ?? true)
        ? await fetchCriticalReviews(asin, rainforestKey, amazonDomain, opts)
        : [];

      // Merge + deduplicate all reviews, replace the lists entirely
      const allPos: string[] = [...out.top_10_positive_reviews];
      const allNeg: string[] = [...out.top_10_negative_reviews];
      const seen = new Set<string>([...allPos, ...allNeg].map(r => r.slice(0, 220)));
      const allScored: Array<{ body: string; rating: number; sentiment: 'positive' | 'neutral' | 'negative' }> = [...initialScored];

      for (const r of [...paginatedReviews, ...criticalReviews]) {
        const key = r.body.slice(0, 220);
        if (!seen.has(key)) {
          seen.add(key);
          if (r.rating >= 4) allPos.push(r.body);
          else allNeg.push(r.body);
          const sentiment = r.rating >= 3.5 ? 'positive' : r.rating >= 2.5 ? 'neutral' : 'negative';
          allScored.push({ body: r.body, rating: r.rating, sentiment });
        }
      }

      // Replace top lists (cap at 15 each) and build reviews_scored with actual ratings + 3-way sentiment
      out.top_10_positive_reviews = allPos.slice(0, 15);
      out.top_10_negative_reviews = allNeg.slice(0, 15);
      out.reviews_scored = allScored;
    } catch (e) {
      console.warn(`[Rainforest] Review enrichment failed for ${asin}: ${e}`);
    }

    out.reviews_fetched_count = out.top_10_positive_reviews.length + out.top_10_negative_reviews.length;

    deriveGenericCategory(out);
    await enrichCompetitorContent(out, firecrawlKey, amazonDomain);
    console.log(`[Scraper] product asin=${asin} source=Rainforest title="${out.title.slice(0, 60)}" thumbnails=${out.thumbnails.length} a_plus=${out.a_plus.length} reviews=${out.reviews_fetched_count} category="${out.categories_flat?.slice(0, 60)}"`);
    return out;
  } catch (e) {
    console.error(`[EcomDebug] rainforestProduct error for ASIN ${asin}:`, e);
    const fallback = await firecrawlProduct(asin, firecrawlKey, amazonDomain);
    if (fallback) {
      deriveGenericCategory(fallback);
      await enrichCompetitorContent(fallback, firecrawlKey, amazonDomain);
    }
    return fallback ?? localFallbackProduct(asin, amazonDomain);
  }
}

async function enrichReviews(
  out: ProductData,
  rainforestKey: string,
  amazonDomain: string,
  opts: ScraperOptions,
): Promise<void> {
  const paginatedReviews = await fetchReviews(out.asin, rainforestKey, amazonDomain, opts.reviewPages ?? 15, opts);
  const criticalReviews = await fetchCriticalReviews(out.asin, rainforestKey, amazonDomain, opts);
  const seen = new Set<string>([
    ...out.top_10_positive_reviews,
    ...out.top_10_negative_reviews,
  ].map(r => r.slice(0, 220)));

  const scored = out.reviews_scored ?? [];
  for (const r of [...paginatedReviews, ...criticalReviews]) {
    const key = r.body.slice(0, 220);
    if (seen.has(key)) continue;
    seen.add(key);
    scored.push({ ...r, sentiment: classifyReviewSentiment(r.rating) });
    if (r.rating >= 4) out.top_10_positive_reviews.push(r.body);
    else out.top_10_negative_reviews.push(r.body);
  }
  out.top_10_positive_reviews = out.top_10_positive_reviews.slice(0, 15);
  out.top_10_negative_reviews = out.top_10_negative_reviews.slice(0, 15);
  out.reviews_scored = scored;
  out.reviews_fetched_count = out.top_10_positive_reviews.length + out.top_10_negative_reviews.length;
}

export async function fetchReviews(
  asin: string,
  rainforestKey: string,
  amazonDomain = 'amazon.com',
  pages = 15,
  opts: ScraperOptions = {},
): Promise<Array<{ body: string; rating: number }>> {
  console.log(`[EcomDebug] fetchReviews: Called for ASIN ${asin} (max pages: ${pages})`);
  const customReviews: Array<{ body: string; rating: number }> = [];
  for (let page = 1; page <= pages; page++) {
    const custom = await customScraperReviews(asin, amazonDomain, opts, page);
    if (!custom) break;
    if (!custom.reviews.length) break;
    customReviews.push(...custom.reviews.flatMap(r => {
      const normalized = normalizeReview(r);
      return normalized ? [normalized] : [];
    }));
    if (custom.hasNextPage === false) break;
  }
  if (customReviews.length) {
    console.log(`[Scraper] reviews asin=${asin} source=CustomScraper reviews=${customReviews.length}`);
    return customReviews;
  }
  if (!rainforestKey) {
    console.warn(`[Scraper] reviews asin=${asin} source=none (no Rainforest key, custom scraper returned 0)`);
    return [];
  }
  const allReviews: Array<{ body: string; rating: number }> = [];
  for (let page = 1; page <= pages; page++) {
    console.log(`[EcomDebug] fetchReviews: Fetching page ${page} for ASIN ${asin}...`);
    try {
      const params = new URLSearchParams({
        api_key: rainforestKey,
        type: 'reviews',
        amazon_domain: amazonDomain,
        asin,
        page: String(page),
      });
      const res = await fetch(`https://api.rainforestapi.com/request?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) break;
      const body = await res.json() as { reviews?: Array<Record<string, unknown>> };
      recordRainforestUsage(opts, 'reviews', asin, body);
      const reviews = body.reviews ?? [];
      if (!reviews.length) {
        console.log(`[EcomDebug] fetchReviews: No more reviews found on page ${page} for ASIN ${asin}. Breaking out.`);
        break;
      }
      for (const r of reviews) {
        const text = String(r.body ?? r.text ?? '');
        const rating = Number(r.rating ?? r.star_rating ?? 3);
        if (text) allReviews.push({ body: text, rating });
      }
      console.log(`[EcomDebug] fetchReviews: Fetched ${reviews.length} reviews from page ${page}. Total so far: ${allReviews.length}`);
    } catch (e) {
      console.error(`[EcomDebug] fetchReviews error on page ${page} for ASIN ${asin}:`, e);
      break;
    }
  }
  console.log(`[Scraper] reviews asin=${asin} source=Rainforest reviews=${allReviews.length}`);
  return allReviews;
}

export async function fetchCriticalReviews(
  asin: string,
  rainforestKey: string,
  amazonDomain = 'amazon.com',
  opts: ScraperOptions = {},
): Promise<Array<{ body: string; rating: number }>> {
  try {
    const custom = await customScraperReviews(asin, amazonDomain, opts, 1, 'all_critical');
    if (custom?.reviews.length) {
      const results = custom.reviews.flatMap(r => {
        const normalized = normalizeReview(r, 2);
        return normalized ? [normalized] : [];
      });
      console.log(`[Scraper] critical_reviews asin=${asin} source=CustomScraper reviews=${results.length}`);
      return results;
    }
  } catch (e) {
    console.warn(`[Scraper] critical_reviews asin=${asin} source=CustomScraper threw: ${e} — falling back to Rainforest`);
  }
  if (!rainforestKey) {
    console.warn(`[Scraper] critical_reviews asin=${asin} source=none (no Rainforest key)`);
    return [];
  }
  try {
    const params = new URLSearchParams({
      api_key: rainforestKey,
      type: 'reviews',
      amazon_domain: amazonDomain,
      asin,
      review_stars: 'all_critical',
    });
    const res = await fetch(`https://api.rainforestapi.com/request?${params}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(`[Scraper] critical_reviews asin=${asin} source=Rainforest HTTP ${res.status}`);
      return [];
    }
    const body = await res.json() as { reviews?: Array<Record<string, unknown>> };
    recordRainforestUsage(opts, 'critical_reviews', asin, body);
    const allReviews: Array<{ body: string; rating: number }> = [];
    for (const r of (body.reviews ?? [])) {
      const text = String(r.body ?? r.text ?? '');
      const rating = Number(r.rating ?? 1);
      if (text) allReviews.push({ body: text, rating });
    }
    console.log(`[Scraper] critical_reviews asin=${asin} source=Rainforest reviews=${allReviews.length}`);
    return allReviews;
  } catch (e) {
    console.error(`[Scraper] critical_reviews asin=${asin} source=Rainforest threw: ${e}`);
    return [];
  }
}
