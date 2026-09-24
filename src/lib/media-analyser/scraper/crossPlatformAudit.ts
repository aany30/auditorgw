/**
 * Cross-platform competitor discovery.
 * Given any product URL, finds the same product category's top competitors
 * across ALL supported platforms (Amazon, Flipkart, Myntra, Nykaa, Croma) in parallel.
 */
import type { EcomEnv } from './config';
import { competitorCounts, defaultAmazonDomain, scraperOptions } from './config';
import { detectPlatform, searchMarketplaceCandidates, scrapeMarketplaceCompetitor, scrapeMarketplaceProduct, resolveProductUrl, extractProductId } from './platforms/index';
import type { PlatformId } from './platforms/types';
import { callLLM, LLM_MODEL, OPENAI_ENDPOINT, resolveLLM, stripJsonFences } from './services/ecomAgent/llm';
import {
  extractAsinFromUrl,
  resolveAmazonMarket,
  rainforestProduct,
  rainforestSearchCandidates,
} from './services/ecomAgent/scraper';
import type { CompetitorCandidate, ProductData } from './services/ecomAgent/scraper';
import { rankMyntraCandidates } from './platforms/myntraRank';

export interface PlatformPresence {
  platform: PlatformId | 'amazon';
  url: string;
  title: string;
  brand: string;
  rating?: number;
  numRatings?: number;
  price?: string;
  thumbnail?: string;
}

export interface CrossPlatformCompetitor {
  /** Normalised display name (shortest title across platforms). */
  name: string;
  brand: string;
  /** LLM-identified competitor brand name. */
  identifiedBrand?: string;
  /** LLM-identified competitor product description. */
  identifiedProduct?: string;
  platforms: PlatformPresence[];
  bestRating: number;
  bestPlatform: PlatformId | 'amazon';
  totalRatings: number;
  platformCount: number;
  /** What this competitor is doing well — brief LLM insight. */
  insights?: string;
}

export interface PlatformSummary {
  found: number;
  deepScraped: number;
  error?: string;
}

export interface CrossPlatformAuditResult {
  sourceProduct: {
    title: string;
    brand: string;
    platform: string;
    url: string;
    price?: string;
    rating?: number;
  };
  competitors: CrossPlatformCompetitor[];
  byPlatform: Partial<Record<PlatformId | 'amazon', PlatformSummary>>;
  searchQueries: string[];
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Competitor brand identification (LLM-powered "web research")
// ---------------------------------------------------------------------------

export interface IdentifiedCompetitor {
  brand: string;
  product: string;
  searchQuery: string;
  why: string;
}

const GENERIC_CATEGORIES = new Set([
  'general', 'all', 'other', 'uncategorized', 'misc', 'miscellaneous',
  'product', 'item', 'goods', 'n/a', 'na', 'unknown',
]);

function isUsableCategory(cat: string): boolean {
  const c = cat.toLowerCase().trim();
  return c.length >= 5 && !GENERIC_CATEGORIES.has(c);
}

/** Ask the LLM to name the top 4 real competitor brands for this product in India. */
async function identifyTopCompetitors(
  title: string,
  brand: string,
  category: string,
  price: string,
  bullets: string[],
  llmKey: string,
  llmEndpoint?: string,
): Promise<IdentifiedCompetitor[]> {
  const leaf = (category ?? '').split('>').pop()?.trim() || '';
  const catHint = isUsableCategory(leaf) ? leaf : 'N/A';

  const prompt = `You are an Indian e-commerce expert with deep knowledge of brands selling on Amazon.in, Flipkart, Myntra, and Nykaa in 2024-2025.

Given this product, name exactly 4 top-selling DIRECT competitor products in the Indian market that are currently popular and well-reviewed.

Source Product: ${title}
Brand: ${brand || 'Unknown'}
Category: ${catHint}
Price: ${price || 'N/A'}
Key Features: ${bullets.slice(0, 3).join(' | ') || 'N/A'}

Requirements:
- Each competitor must be from a DIFFERENT brand (NOT "${brand || 'source brand'}")
- Must be an actual real product actively sold in India right now
- Should directly compete for the SAME customer need
- searchQuery: 2-5 words suitable for searching on Flipkart/Amazon/Nykaa
- why: 1 sentence on why this competitor is strong

Respond ONLY with valid JSON (no markdown):
{"competitors":[{"brand":"BrandName","product":"Exact Product Name","searchQuery":"2-5 word query","why":"one sentence insight"}]}`;

  try {
    const raw = await callLLM(llmKey, [{ role: 'user', content: prompt }], {
      model: LLM_MODEL,
      maxTokens: 600,
      temperature: 0.3,
      responseFormat: { type: 'json_object' },
      endpoint: llmEndpoint ?? OPENAI_ENDPOINT,
      timeoutMs: 45_000,
    });
    const parsed = JSON.parse(stripJsonFences(raw)) as { competitors?: unknown };
    if (Array.isArray(parsed.competitors) && parsed.competitors.length > 0) {
      const valid = parsed.competitors
        .filter(
          (c): c is IdentifiedCompetitor =>
            typeof c === 'object' && c !== null &&
            typeof (c as IdentifiedCompetitor).brand === 'string' &&
            typeof (c as IdentifiedCompetitor).searchQuery === 'string',
        )
        .map((c) => ({
          brand: c.brand.trim(),
          product: (c.product ?? c.brand).trim(),
          searchQuery: c.searchQuery.trim(),
          why: (c.why ?? '').trim(),
        }))
        .slice(0, 4);
      if (valid.length >= 2) {
        console.log(`[CrossPlatform] LLM identified ${valid.length} competitors: ${valid.map((c) => c.brand).join(', ')}`);
        return valid;
      }
    }
  } catch (e) {
    console.warn('[CrossPlatform] identifyTopCompetitors LLM failed:', e);
  }

  // Deterministic fallback: generic product-type queries
  const STOP = new Set(['with','for','and','the','from','new','buy','online','free','best','pack','set','ml','gm','kg']);
  const brandWords = new Set(brand.toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/).filter((w)=>w.length>2));
  const kw = title.toLowerCase().replace(/[^a-z0-9\s%]/g,' ').split(/\s+/)
    .filter((w)=>w.length>2 && !STOP.has(w) && !brandWords.has(w)).slice(0,5).join(' ');
  return [
    { brand: 'Competitor A', product: kw, searchQuery: kw.split(' ').slice(0,4).join(' '), why: 'Direct product category match' },
    { brand: 'Competitor B', product: kw, searchQuery: kw.split(' ').slice(0,3).join(' '), why: 'Direct product category match' },
  ];
}

// ---------------------------------------------------------------------------
// Per-platform search helpers
// ---------------------------------------------------------------------------

async function searchOnPlatform(
  platform: Exclude<PlatformId, 'amazon'>,
  queries: string[],
  firecrawlKey: string,
  maxCandidates: number,
  sourceId: string,
): Promise<{ candidates: CompetitorCandidate[]; error?: string }> {
  const seen = new Set<string>([sourceId]);
  const candidates: CompetitorCandidate[] = [];
  try {
    for (const query of queries) {
      if (candidates.length >= maxCandidates) break;
      const found = await searchMarketplaceCandidates(platform, query, firecrawlKey);
      for (const c of found) {
        if (!c.asin || seen.has(c.asin)) continue;
        seen.add(c.asin);
        candidates.push({ ...c, rank: candidates.length });
      }
    }
    return { candidates };
  } catch (e) {
    return { candidates, error: String((e as Error).message ?? e) };
  }
}

async function searchOnAmazon(
  queries: string[],
  rainforestKey: string,
  firecrawlKey: string,
  amazonDomain: string,
  opts: ReturnType<typeof scraperOptions>,
  maxCandidates: number,
  sourceAsin: string,
): Promise<{ candidates: CompetitorCandidate[]; error?: string }> {
  if (!rainforestKey) return { candidates: [], error: 'No RAINFOREST_API_KEY' };
  const seen = new Set<string>([sourceAsin]);
  const candidates: CompetitorCandidate[] = [];
  try {
    for (const query of queries) {
      if (candidates.length >= maxCandidates) break;
      const results = await rainforestSearchCandidates(query, rainforestKey, firecrawlKey, amazonDomain, opts);
      for (const c of results) {
        if (!c.asin || seen.has(c.asin)) continue;
        seen.add(c.asin);
        candidates.push({ ...c, rank: candidates.length });
      }
    }
    return { candidates };
  } catch (e) {
    return { candidates, error: String((e as Error).message ?? e) };
  }
}

// ---------------------------------------------------------------------------
// Deep-scrape helpers
// ---------------------------------------------------------------------------

async function deepScrapeMarketplace(
  platform: Exclude<PlatformId, 'amazon'>,
  candidates: CompetitorCandidate[],
  firecrawlKey: string,
  limit: number,
  target: ProductData,
): Promise<ProductData[]> {
  const ranked =
    platform === 'myntra' || platform === 'nykaa'
      ? rankMyntraCandidates(target, candidates)
      : candidates;
  const selected = ranked.slice(0, limit);
  const results = await Promise.allSettled(
    selected.map((c) => scrapeMarketplaceCompetitor(platform, c, firecrawlKey)),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<ProductData> => r.status === 'fulfilled' && r.value != null)
    .map((r) => ({ ...r.value, platform }));
}

async function deepScrapeAmazon(
  candidates: CompetitorCandidate[],
  rainforestKey: string,
  firecrawlKey: string,
  amazonDomain: string,
  opts: ReturnType<typeof scraperOptions>,
  limit: number,
): Promise<ProductData[]> {
  if (!rainforestKey) return [];
  const selected = candidates.slice(0, limit);
  const results = await Promise.allSettled(
    selected.map(async (c) => {
      const p = await rainforestProduct(c.asin, rainforestKey, firecrawlKey, amazonDomain, opts);
      if (p) p.platform = 'amazon';
      return p;
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<ProductData> => r.status === 'fulfilled' && r.value != null)
    .map((r) => r.value);
}

// ---------------------------------------------------------------------------
// Deduplication / merging
// ---------------------------------------------------------------------------

function normaliseName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 6)
    .join(' ');
}

function wordOverlap(a: string, b: string): number {
  const wa = new Set(normaliseName(a).split(' '));
  const wb = normaliseName(b).split(' ');
  const common = wb.filter((w) => wa.has(w)).length;
  return common / Math.max(wa.size, wb.length, 1);
}

function mergeIntoCompetitors(
  products: ProductData[],
  identified?: IdentifiedCompetitor[],
): CrossPlatformCompetitor[] {
  const groups: CrossPlatformCompetitor[] = [];

  for (const p of products) {
    const presence: PlatformPresence = {
      platform: (p.platform ?? 'amazon') as PlatformId | 'amazon',
      url: p.url,
      title: p.title,
      brand: p.brand ?? '',
      rating: p.rating ?? undefined,
      numRatings: p.ratings_total ?? undefined,
      price: p.price ?? undefined,
      thumbnail: p.thumbnails?.[0]?.url,
    };

    // Try to merge into existing group (>50% word overlap + same brand)
    let merged = false;
    for (const group of groups) {
      const sameBrand =
        !group.brand ||
        !presence.brand ||
        (group.brand || '').toLowerCase() === (presence.brand || '').toLowerCase();
      if (sameBrand && wordOverlap(group.name, presence.title) > 0.5) {
        if (!group.platforms.some((pl) => pl.platform === presence.platform)) {
          group.platforms.push(presence);
          group.platformCount = group.platforms.length;
          if ((presence.rating ?? 0) > group.bestRating) {
            group.bestRating = presence.rating ?? 0;
            group.bestPlatform = presence.platform;
          }
          group.totalRatings += presence.numRatings ?? 0;
          if (presence.title.length < group.name.length) group.name = presence.title;
        }
        merged = true;
        break;
      }
    }

    if (!merged) {
      // Find matching identified competitor for this brand
      const matchedId = identified?.find(
        (id) =>
          (id.brand || '').toLowerCase() === (presence.brand || '').toLowerCase() ||
          wordOverlap(id.product, presence.title) > 0.4,
      );
      groups.push({
        name: presence.title,
        brand: presence.brand,
        identifiedBrand: matchedId?.brand,
        identifiedProduct: matchedId?.product,
        insights: matchedId?.why,
        platforms: [presence],
        bestRating: presence.rating ?? 0,
        bestPlatform: presence.platform,
        totalRatings: presence.numRatings ?? 0,
        platformCount: 1,
      });
    }
  }

  // Sort: multi-platform first, then by total ratings (social proof), then rating
  return groups.sort((a, b) => {
    if (b.platformCount !== a.platformCount) return b.platformCount - a.platformCount;
    if (b.totalRatings !== a.totalRatings) return b.totalRatings - a.totalRatings;
    return b.bestRating - a.bestRating;
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export type CrossProgressFn = (pct: number, msg: string) => void;

export async function runCrossPlatformAudit(
  productUrl: string,
  env: EcomEnv,
  onProgress?: CrossProgressFn,
): Promise<CrossPlatformAuditResult> {
  const t0 = Date.now();
  const firecrawlKey = env.FIRECRAWL_API_KEY ?? '';
  const rainforestKey = env.RAINFOREST_API_KEY ?? '';
  const amazonDomain = defaultAmazonDomain(env);
  const opts = scraperOptions(env);
  const { key: llmKey, endpoint: llmEndpoint } = resolveLLM(env);
  const counts = competitorCounts(env);
  // At most 2 deep-scrapes per competitor per platform to stay within time budget
  const deepPerCompetitor = 2;

  if (!llmKey) throw new Error('OPENROUTER_API_KEY or OPENAI_API_KEY required for cross-platform analysis.');

  // ── 1. Detect source platform & scrape target product ──────────────────
  const sourcePlatform = detectPlatform(productUrl.trim()) ?? 'amazon';
  onProgress?.(5, `Scraping source product from ${sourcePlatform}…`);

  let targetProduct: ProductData | null = null;
  let sourceAsin = '';

  if (sourcePlatform === 'amazon') {
    const asin = extractAsinFromUrl(productUrl.trim());
    if (!asin) throw new Error('Could not extract ASIN from URL.');
    sourceAsin = asin;
    const domain = resolveAmazonMarket(productUrl.trim(), productUrl.trim(), amazonDomain);
    targetProduct = await rainforestProduct(asin, rainforestKey, firecrawlKey, domain, opts);
    if (targetProduct) targetProduct.platform = 'amazon';
  } else {
    const resolvedUrl = await resolveProductUrl(productUrl, sourcePlatform);
    const productId = extractProductId(resolvedUrl, sourcePlatform);
    if (!productId) throw new Error(`Could not extract product ID from ${sourcePlatform} URL.`);
    sourceAsin = productId;
    targetProduct = await scrapeMarketplaceProduct(sourcePlatform, resolvedUrl, productId, firecrawlKey);
    if (targetProduct) targetProduct.platform = sourcePlatform;
  }

  if (!targetProduct) throw new Error(`Failed to scrape source product. Check the URL and API keys.`);

  onProgress?.(15, `Got "${targetProduct.title.slice(0, 50)}" — asking LLM to identify top 4 competitors…`);

  // ── 2. LLM identifies top 4 competitor brands/products ──────────────────
  const identified = await identifyTopCompetitors(
    targetProduct.title,
    targetProduct.brand ?? '',
    targetProduct.categories_flat ?? targetProduct.generic_category ?? '',
    targetProduct.price ?? '',
    targetProduct.bullets ?? [],
    llmKey,
    llmEndpoint,
  );

  const competitorNames = identified.map((c) => `${c.brand} (${c.searchQuery})`).join(', ');
  console.log(`[CrossPlatform] Identified competitors: ${competitorNames}`);
  onProgress?.(25, `Identified: ${identified.map((c) => c.brand).join(', ')} — searching all platforms…`);

  // ── 3. For each competitor, search all platforms in parallel ─────────────
  const PLATFORMS_TO_SEARCH: Array<Exclude<PlatformId, 'amazon'>> = ['flipkart', 'myntra', 'nykaa'];

  // Build all (competitor × platform) search tasks
  const searchTasks: Array<{
    competitorIdx: number;
    platform: Exclude<PlatformId, 'amazon'> | 'amazon';
    promise: Promise<{ candidates: CompetitorCandidate[]; error?: string }>;
  }> = [];

  for (let ci = 0; ci < identified.length; ci++) {
    const comp = identified[ci];
    // Amazon
    if (rainforestKey) {
      searchTasks.push({
        competitorIdx: ci,
        platform: 'amazon',
        promise: searchOnAmazon(
          [comp.searchQuery, comp.brand + ' ' + comp.searchQuery.split(' ')[0]].slice(0, 2),
          rainforestKey, firecrawlKey, amazonDomain, opts, deepPerCompetitor + 2, sourceAsin,
        ),
      });
    }
    // Other platforms
    for (const p of PLATFORMS_TO_SEARCH) {
      const queries = [comp.searchQuery, comp.brand + ' ' + comp.searchQuery.split(' ')[0]].filter(Boolean).slice(0, 2);
      searchTasks.push({
        competitorIdx: ci,
        platform: p,
        promise: searchOnPlatform(p, queries, firecrawlKey, deepPerCompetitor + 2, sourcePlatform === p ? sourceAsin : ''),
      });
    }
  }

  const searchResults = await Promise.all(searchTasks.map((t) => t.promise));

  // Log what we found
  for (let i = 0; i < searchTasks.length; i++) {
    const { competitorIdx, platform } = searchTasks[i];
    const res = searchResults[i];
    console.log(`[CrossPlatform] ${identified[competitorIdx].brand} on ${platform}: ${res.candidates.length} candidates`);
  }

  onProgress?.(50, `Deep-scraping best matches per competitor per platform…`);

  // ── 4. Deep-scrape best candidates per (competitor × platform) ──────────
  const deepTasks: Array<Promise<ProductData[]>> = [];

  for (let i = 0; i < searchTasks.length; i++) {
    const { platform } = searchTasks[i];
    const { candidates } = searchResults[i];
    if (!candidates.length) {
      deepTasks.push(Promise.resolve([]));
      continue;
    }
    const top = candidates.slice(0, deepPerCompetitor);
    if (platform === 'amazon') {
      deepTasks.push(deepScrapeAmazon(top, rainforestKey, firecrawlKey, amazonDomain, opts, deepPerCompetitor));
    } else {
      deepTasks.push(deepScrapeMarketplace(platform, top, firecrawlKey, deepPerCompetitor, targetProduct));
    }
  }

  const deepResultArrays = await Promise.all(deepTasks);
  const allProducts: ProductData[] = deepResultArrays.flat();
  console.log(`[CrossPlatform] deep-scraped ${allProducts.length} total products across ${identified.length} competitors`);

  // ── 5. Build byPlatform summary ─────────────────────────────────────────
  const byPlatform: Partial<Record<PlatformId | 'amazon', PlatformSummary>> = {};
  for (let i = 0; i < searchTasks.length; i++) {
    const { platform } = searchTasks[i];
    const key = platform as PlatformId | 'amazon';
    if (!byPlatform[key]) byPlatform[key] = { found: 0, deepScraped: 0 };
    byPlatform[key]!.found += searchResults[i].candidates.length;
    byPlatform[key]!.deepScraped += deepResultArrays[i].length;
    if (searchResults[i].error && !byPlatform[key]!.error) {
      byPlatform[key]!.error = searchResults[i].error;
    }
  }

  // ── 6. Merge & deduplicate across platforms ──────────────────────────────
  onProgress?.(80, `Merging ${allProducts.length} products → building competitor profiles…`);
  const competitors = mergeIntoCompetitors(allProducts, identified);

  // Fill in identifiedBrand/Product/insights from LLM results where not already set
  for (const comp of competitors) {
    if (!comp.identifiedBrand) {
      const match = identified.find((id) =>
        (id.brand || '').toLowerCase() === (comp.brand || '').toLowerCase() ||
        wordOverlap(id.product, comp.name) > 0.35,
      );
      if (match) {
        comp.identifiedBrand = match.brand;
        comp.identifiedProduct = match.product;
        comp.insights = match.why;
      }
    }
  }

  onProgress?.(95, `Found ${competitors.length} unique competitors across ${Object.keys(byPlatform).length} platforms`);

  return {
    sourceProduct: {
      title: targetProduct.title,
      brand: targetProduct.brand ?? '',
      platform: sourcePlatform,
      url: productUrl,
      price: targetProduct.price ?? undefined,
      rating: targetProduct.rating ?? undefined,
    },
    competitors,
    byPlatform,
    searchQueries: identified.map((c) => `${c.brand}: ${c.searchQuery}`),
    elapsedMs: Date.now() - t0,
  };
}
