/**
 * Competitor discovery and batch scanning swarm.
 * Port of Amazon-scraper-GW/execution/competitor_iq_v2.py
 */

import { rainforestSearch, rainforestSearchCandidates, rainforestProduct, ScraperOptions, ProductData, CompetitorCandidate } from './scraper';
import { callLLM, stripJsonFences, LLM_MODEL, OPENAI_ENDPOINT } from './llm';
import {
  ReviewSettings,
  DEFAULT_COMPETITOR_REVIEW_PAGES,
  competitorPagesPerProduct,
  normalizeReviewPages,
  REVIEWS_PER_PAGE,
} from './reviewVolume';

function getCandidateMultiplier(opts: ScraperOptions): number { return Math.max(1, opts.candidateMultiplier ?? 3); }
function getCandidateExtra(opts: ScraperOptions): number { return Math.max(0, opts.candidateExtra ?? 20); }

function cleanQuery(text: string, maxWords = 5): string {
  const clean = (text || '').replace(/[^a-zA-Z0-9\s]/g, ' ');
  return clean.split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ');
}

function singularQuery(query: string): string {
  const words = query.split(/\s+/);
  if (!words.length) return query;
  const last = words[words.length - 1];
  const singularized = last
    .replace(/ies$/, 'y')
    .replace(/(?<!s)s$/, '');
  words[words.length - 1] = singularized;
  return words.join(' ');
}

function titleSearchQuery(title: string, category = ''): string {
  const stopWords = new Set([
    'with', 'for', 'and', 'the', 'from', 'star', 'plus', 'auto', 'new',
    'standard', 'personal', 'solution', 'technology', 'self', 'cleaning',
  ]);
  const categoryWords = category
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 3);
  const titleWords = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 5);
  const seen = new Set<string>();
  const combined: string[] = [];
  for (const w of [...categoryWords, ...titleWords]) {
    if (!seen.has(w)) {
      seen.add(w);
      combined.push(w);
    }
  }
  return combined.join(' ').slice(0, 80);
}

function addQuery(queries: string[], query: string): void {
  const cleaned = cleanQuery(query, 8);
  if (!cleaned) return;
  const lower = cleaned.toLowerCase();
  for (const q of queries) {
    if (q.toLowerCase() === lower) return;
  }
  queries.push(cleaned);
}

// Match a whole word (prevents "washing" matching "dishwashing", "iron" matching "environment", etc.)
function hasWord(text: string, word: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${word}(?:[^a-z0-9]|$)`).test(text);
}
// Match an exact phrase (faster than regex for multi-word phrases)
function hasPhrase(text: string, phrase: string): boolean {
  return text.includes(phrase);
}

function productTypeQueries(title: string, category = ''): string[] {
  const text = `${title} ${category}`.toLowerCase();
  const queries: string[] = [];

  // Robot vacuum / mop
  if (hasWord(text, 'robot') && (hasWord(text, 'vacuum') || hasPhrase(text, 'robot mop'))) {
    queries.push('robot vacuum mop', 'robot vacuum cleaner', 'vacuum mop');
  }
  // Vacuum cleaner — exclude non-appliance uses: vacuum insulated bottles, vacuum bags, flasks, sealed containers
  if (hasWord(text, 'vacuum') && !hasPhrase(text, 'vacuum insulated') && !hasPhrase(text, 'vacuum bag') && !hasPhrase(text, 'vacuum flask') && !hasPhrase(text, 'vacuum seal') && !hasPhrase(text, 'vacuum tube')) {
    if (hasWord(text, 'wet') && hasWord(text, 'dry')) {
      queries.push('wet dry vacuum cleaner', 'vacuum cleaner');
    } else if (!hasWord(text, 'robot')) {
      queries.push('vacuum cleaner');
    }
  }
  // Floor mop (not "mop up", not combined with vacuum)
  if (hasWord(text, 'mop') && !hasWord(text, 'vacuum') && !hasWord(text, 'robot')) {
    queries.push('floor mop', 'spin mop');
  }
  // Luggage / suitcase
  if (hasWord(text, 'suitcase') || hasWord(text, 'luggage') || hasPhrase(text, 'trolley bag')) {
    queries.push('trolley bag suitcase', 'luggage suitcase', 'travel suitcase');
  }
  // Refrigerator
  if (hasWord(text, 'refrigerator') || hasWord(text, 'fridge')) {
    queries.push('refrigerator', 'double door refrigerator');
  }
  // Washing machine — require full phrase; single "washing" is too broad (e.g. "Washing Basket" in air fryer accessories)
  if (hasPhrase(text, 'washing machine') || hasPhrase(text, 'front load') || hasPhrase(text, 'top load') || (hasWord(text, 'washer') && !hasPhrase(text, 'dishwasher'))) {
    queries.push('washing machine');
  }
  // Air fryer
  if (hasPhrase(text, 'air fryer') || hasWord(text, 'airfryer')) {
    queries.push('air fryer', 'digital air fryer');
  }
  // Microwave
  if (hasWord(text, 'microwave')) {
    queries.push('microwave oven', 'solo microwave');
  }
  // Mixer grinder
  if (hasWord(text, 'mixer') && hasWord(text, 'grinder')) {
    queries.push('mixer grinder', 'mixer grinder juicer');
  }
  // Pressure cooker (avoid matching "pressure" alone as in "pressure washer")
  if (hasPhrase(text, 'pressure cooker') || hasPhrase(text, 'instant pot')) {
    queries.push('electric pressure cooker', 'pressure cooker');
  }
  // OTG / toaster oven — require both words to avoid "toast" in bread descriptions
  if ((hasWord(text, 'oven') && hasWord(text, 'toaster')) || hasWord(text, 'otg')) {
    queries.push('oven toaster griller', 'otg oven');
  }
  // Water purifier
  if (hasPhrase(text, 'water purifier') || hasPhrase(text, 'ro purifier') || hasPhrase(text, 'water filter')) {
    queries.push('ro water purifier', 'water purifier');
  }
  // Induction cooktop
  if (hasWord(text, 'induction') && (hasWord(text, 'cooktop') || hasWord(text, 'stove') || hasWord(text, 'cooker'))) {
    queries.push('induction cooktop', 'induction stove');
  }
  // Electric kettle — require "kettle" as a standalone word (not "kettledrum")
  if (hasWord(text, 'kettle')) {
    queries.push('electric kettle', 'stainless steel kettle');
  }
  // Steam iron / dry iron — "iron" alone is too broad (cast iron, iron supplement, etc.)
  if (hasPhrase(text, 'steam iron') || hasPhrase(text, 'dry iron') || (hasWord(text, 'iron') && hasWord(text, 'press'))) {
    queries.push('steam iron', 'dry iron');
  }
  // Ceiling fan
  if (hasPhrase(text, 'ceiling fan') || (hasWord(text, 'fan') && hasWord(text, 'ceiling'))) {
    queries.push('ceiling fan', 'bldc ceiling fan');
  }
  // Air cooler
  if (hasPhrase(text, 'air cooler') || hasPhrase(text, 'desert cooler') || hasPhrase(text, 'evaporative cooler')) {
    queries.push('air cooler', 'personal air cooler');
  }
  // Air conditioner — " ac " too noisy (e.g. "black ac adapter"); require full phrase or split/window
  if (hasPhrase(text, 'air conditioner') || hasPhrase(text, 'split ac') || hasPhrase(text, 'window ac')) {
    queries.push('split ac', 'inverter split ac');
  }
  // Hair dryer
  if (hasPhrase(text, 'hair dryer') || hasPhrase(text, 'hair drier') || (hasWord(text, 'dryer') && hasWord(text, 'hair'))) {
    queries.push('hair dryer', 'professional hair dryer');
  }
  // Electric toothbrush
  if (hasPhrase(text, 'electric toothbrush') || hasPhrase(text, 'sonic toothbrush')) {
    queries.push('electric toothbrush', 'sonic toothbrush');
  }
  // Dishwasher
  if (hasWord(text, 'dishwasher')) {
    queries.push('dishwasher', 'countertop dishwasher');
  }
  // Lunch box / tiffin
  if (hasPhrase(text, 'lunch box') || hasWord(text, 'tiffin')) {
    queries.push('lunch box', 'tiffin box');
  }

  return queries;
}

async function generateCompetitorSearchQueries(
  title: string,
  categoriesFlat: string,
  price: string,
  bullets: string[],
  llmKey: string,
  llmEndpoint?: string,
  amazonDomain = 'amazon.com',
): Promise<string[]> {
  const bulletsSummary = bullets.slice(0, 4).join(' | ');
  const prompt = `You are an Amazon marketplace analyst. Generate 5 search queries to find direct competitors for this product.

Product title: ${title}
Amazon category path: ${categoriesFlat || 'unknown'}
Price: ${price || 'unknown'}
Key features: ${bulletsSummary || 'N/A'}

Rules:
- Focus on WHAT the product IS physically, not what it is used FOR
- Each query must be 2-5 words, no brand names, no model numbers
- Queries should find products of exactly the same type at a similar price point on ${amazonDomain}
- Do NOT use the category leaf word alone if it is too generic (e.g. "Bottles" — instead say "oil spray bottle")
- Vary the queries to cover different ways shoppers would search

Respond with ONLY valid JSON: {"queries": ["query1", "query2", "query3", "query4", "query5"]}`;

  console.log(`[CompetitorSwarm] LLM query gen — title="${title.slice(0, 80)}" category="${categoriesFlat.slice(0, 80)}" price="${price}" bullets=${bullets.length}`);
  try {
    const raw = await callLLM(llmKey, [{ role: 'user', content: prompt }], {
      model: LLM_MODEL,
      maxTokens: 200,
      temperature: 0,
      responseFormat: { type: 'json_object' },
      endpoint: llmEndpoint ?? OPENAI_ENDPOINT,
      timeoutMs: 45_000,
    });
    console.log(`[CompetitorSwarm] LLM raw response: ${raw.slice(0, 300)}`);
    const parsed = JSON.parse(stripJsonFences(raw)) as { queries?: unknown };
    const queries = Array.isArray(parsed.queries) ? parsed.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0) : [];
    if (queries.length) {
      console.log(`[CompetitorSwarm] LLM queries accepted: ${JSON.stringify(queries)}`);
      return queries;
    }
    console.warn(`[CompetitorSwarm] LLM returned 0 usable queries — falling back to rule-based`);
  } catch (e) {
    console.warn(`[CompetitorSwarm] LLM query generation failed (non-fatal): ${e} — falling back to rule-based`);
  }
  return [];
}

function competitorSearchQueries(productTitle: string, cleanQueryStr: string): string[] {
  const queries: string[] = [];

  // Amazon titles are keyword-stuffed: "Oil Sprayer ... for Air Fryer, BBQ, Salad"
  // Use only the first comma-separated segment for product-type detection to avoid
  // false positives from appliance names listed as usage contexts.
  const coreTitle = productTitle.split(',')[0].trim();

  for (const q of productTypeQueries(coreTitle, cleanQueryStr)) {
    addQuery(queries, q);
  }
  addQuery(queries, cleanQueryStr);
  addQuery(queries, singularQuery(cleanQueryStr));
  addQuery(queries, titleSearchQuery(productTitle, cleanQueryStr));
  addQuery(queries, titleSearchQuery(productTitle, ''));

  return queries;
}

function reviewCount(product: Record<string, unknown>): number {
  const scored = product['reviews_scored'];
  if (Array.isArray(scored)) return scored.length;
  const pos = product['top_10_positive_reviews'];
  const neg = product['top_10_negative_reviews'];
  return (Array.isArray(pos) ? pos.length : 0) + (Array.isArray(neg) ? neg.length : 0);
}

function imageCount(product: Record<string, unknown>): number {
  const thumbnails = product['thumbnails'];
  if (Array.isArray(thumbnails)) return thumbnails.length;
  const images = product['images'];
  if (Array.isArray(images)) return images.length;
  return 0;
}

function isSearchCardFallback(product: Record<string, unknown>): boolean {
  return product['scrape_source'] === 'custom_search_fallback';
}

function hasProductMetrics(product: Record<string, unknown>): boolean {
  const price = product['price'];
  const rating = product['rating'];
  const ratingsTotal = product['ratings_total'];
  const reviewsTotal = product['reviews_total'];

  const hasPrice = price != null && price !== '' && price !== 'N/A';
  const hasRating = rating != null && rating !== 0;
  const hasRatingsTotal = ratingsTotal != null && ratingsTotal !== 0;
  const hasReviewsTotal = reviewsTotal != null && reviewsTotal !== 0;

  return hasPrice || hasRating || hasRatingsTotal || hasReviewsTotal;
}

function hasReviewSignal(product: Record<string, unknown>): boolean {
  const rating = Number(product['rating'] ?? 0);
  const ratingsTotal = Number(product['ratings_total'] ?? 0);
  const reviewsTotal = Number(product['reviews_total'] ?? 0);
  const fetched = Number(product['reviews_fetched_count'] ?? 0);
  const pos = Array.isArray(product['top_10_positive_reviews']) ? (product['top_10_positive_reviews'] as unknown[]).length : 0;
  const neg = Array.isArray(product['top_10_negative_reviews']) ? (product['top_10_negative_reviews'] as unknown[]).length : 0;
  return rating > 0 || ratingsTotal > 0 || reviewsTotal > 0 || fetched > 0 || (pos + neg) > 0;
}

function extractTypeWords(title: string): Set<string> {
  const stopWords = new Set([
    // conjunctions / prepositions
    'with', 'for', 'and', 'the', 'from', 'into', 'onto', 'over', 'under',
    // generic product descriptors
    'star', 'plus', 'auto', 'new', 'standard', 'personal', 'solution',
    'technology', 'self', 'cleaning', 'pack', 'set', 'piece', 'unit', 'value',
    'combo', 'premium', 'best', 'top', 'pro', 'max', 'mini', 'ultra', 'lite',
    'super', 'large', 'small', 'heavy', 'duty', 'grade', 'quality', 'food',
    'safe', 'free', 'proof', 'resistant', 'coated', 'lined', 'series',
    // colours
    'black', 'white', 'silver', 'grey', 'gray', 'blue', 'red', 'green',
    'yellow', 'orange', 'purple', 'brown', 'pink', 'golden', 'gold',
    // materials — these appear across totally different product categories
    'stainless', 'steel', 'plastic', 'glass', 'metal', 'ceramic', 'aluminium',
    'aluminum', 'copper', 'iron', 'silicone', 'nylon', 'rubber', 'wood',
    'wooden', 'bamboo', 'carbon', 'fibre', 'fiber', 'polypropylene',
    // power / connectivity attributes — same problem: "electric kettle" ≠ "electric water bottle"
    'electric', 'electronic', 'bluetooth', 'smart', 'digital', 'wireless',
    'automatic', 'portable', 'rechargeable', 'cordless', 'battery', 'powered',
    'operated', 'solar', 'magnetic', 'touch', 'sensor',
    // size / count words
    'double', 'triple', 'single', 'multi', 'dual', 'twin', 'extra', 'deluxe',
    // common filler suffixes
    'edition', 'version', 'model', 'type', 'style', 'design',
  ]);
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      // skip short words, stop words, and pure numeric/unit tokens (1.5l, 500g, etc.)
      .filter(w => w.length > 3 && !stopWords.has(w) && !/^\d+(\.\d+)?[lLkKwWgGmMcC]?$/.test(w)),
  );
}

// Compare categories_flat at depth 3 (4th level, e.g. "Kettles & Hot Water Dispensers").
// If both products have a category at that depth and they differ → different product types → reject.
// Passes when either product lacks deep category data (can't compare).
function isCategoryCompatible(targetCats: string, candidateCats: string): boolean {
  if (!targetCats || !candidateCats) return true;
  const tp = targetCats.split('>').map(s => s.trim().toLowerCase()).filter(Boolean);
  const cp = candidateCats.split('>').map(s => s.trim().toLowerCase()).filter(Boolean);
  const depth = 3; // 0-indexed, so index 3 = 4th breadcrumb
  if (tp.length > depth && cp.length > depth) {
    return tp[depth] === cp[depth];
  }
  return true;
}

export function isTitleCompatible(targetTitle: string, candidateTitle: string): boolean {
  const targetWords = extractTypeWords(targetTitle);
  if (targetWords.size === 0) return true;
  const candidateWords = extractTypeWords(candidateTitle);
  let matches = 0;
  for (const w of targetWords) {
    if (candidateWords.has(w)) {
      matches++;
      // require 2 matching type-words when the target has enough words to compare,
      // otherwise a single shared brand name or generic noun slips through
      if (matches >= 2 || targetWords.size === 1) return true;
    }
  }
  return false;
}

export function isUsableDeepCompetitor(product: Record<string, unknown>): boolean {
  if (!product || !product['asin']) return false;
  if (isSearchCardFallback(product)) return false;
  const title = String(product['title'] ?? '').trim();
  if (!title) return false;
  if (title.toLowerCase().startsWith('amazon product ')) return false;
  // Must have basic product data AND at least one review signal — products with literally zero
  // reviews aren't useful as competitors (no sentiment, no battle cards, no pain points).
  // Swarm will keep scanning more candidates from the pool until limit is reached or exhausted.
  if (!hasReviewSignal(product)) return false;
  return hasProductMetrics(product) || imageCount(product) >= 2 || !!product['a_plus'];
}

export interface CompetitorSwarmResult {
  competitors: ProductData[];
  searchQueryUsed: string;
  candidateAsins: string[];
  candidateCount: number;
}

export async function findAndScanCompetitors(
  searchQuery: string,
  productTitle: string,
  targetAsin: string,
  limit: number,
  rainforestKey: string,
  firecrawlKey: string,
  amazonDomain: string,
  opts: ScraperOptions,
  reviewSettings: ReviewSettings,
  onProgress?: (msg: string) => void,
  onScanUpdate?: (asin: string, status: 'scanning' | 'completed' | 'failed') => Promise<void>,
  targetCategoriesFlat?: string,
): Promise<CompetitorSwarmResult> {
  const ts = () => new Date().toISOString().slice(11, 23);

  const cleanQueryStr = cleanQuery(searchQuery, 5);
  const searchQueries = competitorSearchQueries(productTitle, cleanQueryStr);

  console.log(`[CompetitorSwarm] START query="${cleanQueryStr}" title="${productTitle?.slice(0, 60)}" limit=${limit} domain=${amazonDomain} candidateMultiplier=${getCandidateMultiplier(opts)} candidateExtra=${getCandidateExtra(opts)}`);
  console.log(`[CompetitorSwarm] Query plan: ${JSON.stringify(searchQueries)}`);

  let rawAsins: string[] = [];
  let usedQuery = '';

  for (const query of searchQueries) {
    onProgress?.(`Searching competitors: "${query}"`);
    console.log(`[CompetitorSwarm] [${ts()}] Search attempt: "${query}"`);
    const results = await rainforestSearch(query, rainforestKey, firecrawlKey, amazonDomain, opts);
    console.log(`[CompetitorSwarm] [${ts()}] Search "${query}" => ${results.length} ASINs`);
    if (results.length) {
      rawAsins = results;
      usedQuery = query;
      break;
    }
  }

  if (!rawAsins.length) {
    console.warn(`[CompetitorSwarm] All queries returned 0 ASINs — aborting swarm`);
    return { competitors: [], searchQueryUsed: '', candidateAsins: [], candidateCount: 0 };
  }

  const candidateCap = Math.min(
    Math.max(limit, Math.min(limit * getCandidateMultiplier(opts), limit + getCandidateExtra(opts))),
    limit + 4,
  );
  const seen = new Set<string>();
  const candidateAsins: string[] = [];
  for (const asin of rawAsins) {
    if (asin === targetAsin) continue;
    if (seen.has(asin)) continue;
    seen.add(asin);
    candidateAsins.push(asin);
    if (candidateAsins.length >= candidateCap) break;
  }

  console.log(`[CompetitorSwarm] [${ts()}] Candidates: ${candidateAsins.length} (cap=${candidateCap}) via query="${usedQuery}" sample=${JSON.stringify(candidateAsins.slice(0, 5))}`);

  // Register all candidates as 'scanning' immediately so frontend shows live nodes
  for (const asin of candidateAsins) {
    try { await onScanUpdate?.(asin, 'scanning'); } catch {}
  }

  const perCompetitorPages = competitorPagesPerProduct(reviewSettings.competitor_review_pages, limit);
  const competitorOpts: ScraperOptions = {
    ...opts,
    reviewPages:      perCompetitorPages,
    productTimeoutMs: opts.competitorTimeoutMs ?? opts.productTimeoutMs,
  };

  const batchSize    = opts.scanBatchSize ?? 4;
  const deadline     = opts.scanMaxSeconds ? Date.now() + opts.scanMaxSeconds * 1000 : Infinity;
  const successfulComps: ProductData[] = [];

  console.log(`[CompetitorSwarm] [${ts()}] SCAN LOOP start — ${candidateAsins.length} candidates batchSize=${batchSize} timeout=${opts.scanMaxSeconds ?? '∞'}s need=${limit}`);

  for (let i = 0; i < candidateAsins.length; i += batchSize) {
    if (successfulComps.length >= limit) break;
    if (Date.now() > deadline) {
      console.warn(`[CompetitorSwarm] [${ts()}] Scan timeout (${opts.scanMaxSeconds}s) reached — stopping with ${successfulComps.length}/${limit}`);
      break;
    }
    const batch = candidateAsins.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const batchT0 = Date.now();
    console.log(`[CompetitorSwarm] [${ts()}] BATCH ${batchNum} — scanning ${JSON.stringify(batch)} (${successfulComps.length}/${limit} collected)`);
    onProgress?.(
      `Deep-scraping competitors (${Math.min(i + batch.length, candidateAsins.length)} of ${candidateAsins.length}, need ${limit} for analysis)…`,
    );

    const settled = await Promise.allSettled(
      batch.map(asin => rainforestProduct(asin, rainforestKey, firecrawlKey, amazonDomain, competitorOpts)),
    );
    console.log(`[CompetitorSwarm] [${ts()}] BATCH ${batchNum} done in ${((Date.now() - batchT0) / 1000).toFixed(1)}s — ${settled.filter(r => r.status === 'fulfilled' && r.value).length} returned data`);

    for (let j = 0; j < settled.length; j++) {
      const batchAsin = batch[j];
      if (successfulComps.length >= limit) {
        try { await onScanUpdate?.(batchAsin, 'failed'); } catch {}
        continue;
      }
      const result = settled[j];
      if (result.status === 'rejected') {
        console.warn(`[CompetitorSwarm] REJECTED ${batchAsin}: ${result.reason}`);
        try { await onScanUpdate?.(batchAsin, 'failed'); } catch {}
        continue;
      }
      const product = result.value;
      if (!product) {
        console.warn(`[CompetitorSwarm] NULL result for ${batchAsin}`);
        try { await onScanUpdate?.(batchAsin, 'failed'); } catch {}
        continue;
      }
      if (!isUsableDeepCompetitor(product as unknown as Record<string, unknown>)) {
        const p = product as unknown as Record<string, unknown>;
        const src = p.scrape_source ?? 'unknown';
        const imgs = Array.isArray(p.thumbnails) ? (p.thumbnails as unknown[]).length : 0;
        const revs = Array.isArray(p.reviews_scored) ? (p.reviews_scored as unknown[]).length : 0;
        const noReviews = !hasReviewSignal(p);
        const reason = noReviews ? 'NO_REVIEWS' : 'WEAK';
        console.log(`[CompetitorSwarm] ${reason} ${batchAsin} source=${src} images=${imgs} reviews=${revs} ratings_total=${p.ratings_total ?? 0} title="${product.title?.slice(0, 50)}"`);
        try { await onScanUpdate?.(batchAsin, 'failed'); } catch {}
        continue;
      }
      const candidateTitle = String(product.title ?? '');
      const candidateCats = String(product.categories_flat ?? '');
      if (!isCategoryCompatible(targetCategoriesFlat ?? '', candidateCats)) {
        console.log(`[CompetitorSwarm] CATEGORY_MISMATCH ${batchAsin} target="${(targetCategoriesFlat ?? '').slice(0, 60)}" candidate="${candidateCats.slice(0, 60)}"`);
        try { await onScanUpdate?.(batchAsin, 'failed'); } catch {}
        continue;
      }
      if (!isTitleCompatible(productTitle, candidateTitle)) {
        console.log(`[CompetitorSwarm] TITLE_MISMATCH ${batchAsin} target="${productTitle.slice(0, 40)}" candidate="${candidateTitle.slice(0, 40)}"`);
        try { await onScanUpdate?.(batchAsin, 'failed'); } catch {}
        continue;
      }
      successfulComps.push(product);
      console.log(`[CompetitorSwarm] ACCEPTED ${batchAsin} [${successfulComps.length}/${limit}] source=${(product as unknown as Record<string, unknown>).scrape_source ?? 'unknown'}`);
      try { await onScanUpdate?.(batchAsin, 'completed'); } catch {}
    }
  }

  if (successfulComps.length < limit) {
    console.warn(`[CompetitorSwarm] PartialData: only ${successfulComps.length}/${limit} usable competitors after scanning ${candidateAsins.length} candidates`);
  }

  return {
    competitors: successfulComps,
    searchQueryUsed: usedQuery,
    candidateAsins,
    candidateCount: candidateAsins.length,
  };
}

export interface DiscoverCandidatesResult {
  candidates: CompetitorCandidate[];
  searchQueryUsed: string;
}

/** Turn related ASIN hints from the target product page into discover candidates. */
export function candidatesFromRelatedAsins(
  relatedAsins: string[],
  targetAsin: string,
  max = 10,
): CompetitorCandidate[] {
  const out: CompetitorCandidate[] = [];
  for (const asin of relatedAsins) {
    if (!asin || asin === targetAsin) continue;
    out.push({ asin, rank: out.length });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Phase 1 of the competitor pipeline: runs search queries and returns rich candidate cards.
 * Does NOT deep-scrape. The caller stores candidates in ea_competitor_candidates and shows
 * them to the user for selection before Phase 2 (scanSelectedCompetitors) is triggered.
 */
export async function discoverCompetitorCandidates(
  searchQuery: string,
  productTitle: string,
  targetAsin: string,
  maxCandidates: number,
  rainforestKey: string,
  firecrawlKey: string,
  amazonDomain: string,
  opts: ScraperOptions,
  onProgress?: (msg: string) => void,
  llmOptions?: {
    key: string;
    endpoint?: string;
    productData?: { price?: string; bullets?: string[]; categoriesFlat?: string };
  },
): Promise<DiscoverCandidatesResult> {
  const ts = () => new Date().toISOString().slice(11, 23);
  const cleanQueryStr = cleanQuery(searchQuery, 5);

  // LLM-generated queries come first — they understand the actual product type from full context.
  // Rule-based queries are appended as fallback.
  const llmQueries: string[] = [];
  if (llmOptions?.key) {
    onProgress?.('Generating competitor search queries…');
    const pd = llmOptions.productData ?? {};
    const generated = await generateCompetitorSearchQueries(
      productTitle,
      pd.categoriesFlat ?? searchQuery,
      pd.price ?? '',
      pd.bullets ?? [],
      llmOptions.key,
      llmOptions.endpoint,
      amazonDomain,
    );
    llmQueries.push(...generated);
  }

  const ruleQueries = competitorSearchQueries(productTitle, cleanQueryStr);
  // Merge: LLM first, then rule-based (deduplicated)
  const seenQueries = new Set(llmQueries.map(q => q.toLowerCase()));
  const searchQueries = [...llmQueries, ...ruleQueries.filter(q => !seenQueries.has(q.toLowerCase()))];

  console.log(`[CompetitorSwarm] DISCOVER START rawSearchQuery="${searchQuery.slice(0, 80)}" cleanQueryStr="${cleanQueryStr}" title="${productTitle?.slice(0, 60)}" max=${maxCandidates} domain=${amazonDomain}`);
  console.log(`[CompetitorSwarm] DISCOVER QUERIES_LIST llm=[${llmQueries.map(q => `"${q}"`).join(', ')}] rules=[${ruleQueries.map(q => `"${q}"`).join(', ')}]`);

  const seen = new Set<string>();
  const candidates: CompetitorCandidate[] = [];
  let usedQuery = '';

  const ingest = (results: CompetitorCandidate[], query: string) => {
    let added = 0;
    for (const c of results) {
      if (!c.asin || c.asin === targetAsin || seen.has(c.asin)) continue;
      seen.add(c.asin);
      candidates.push(c);
      added++;
      if (candidates.length >= maxCandidates) break;
    }
    if (added && !usedQuery) usedQuery = query;
    return added;
  };

  for (const query of searchQueries) {
    if (candidates.length >= maxCandidates) break;
    onProgress?.(`Discovering competitors: "${query}"`);
    console.log(`[CompetitorSwarm] [${ts()}] Discover attempt: "${query}"`);
    const results = await rainforestSearchCandidates(query, rainforestKey, firecrawlKey, amazonDomain, opts);
    console.log(`[CompetitorSwarm] [${ts()}] Discover "${query}" => ${results.length} raw${results.length ? ` | first: "${results[0]?.title?.slice(0, 60)}"` : ''}`);
    ingest(results, query);
  }

  console.log(`[CompetitorSwarm] DISCOVER DONE — ${candidates.length} candidates via "${usedQuery || searchQueries[0] || 'n/a'}"`);
  return { candidates, searchQueryUsed: usedQuery || searchQueries[0] || '' };
}

/**
 * Phase 2 of the competitor pipeline: deep-scrapes the user-selected ASINs.
 * Called after the user confirms which candidates to include.
 */
export async function scanSelectedCompetitors(
  selectedAsins: string[],
  limit: number,
  rainforestKey: string,
  firecrawlKey: string,
  amazonDomain: string,
  opts: ScraperOptions,
  reviewSettings: ReviewSettings,
  onProgress?: (msg: string) => void,
  onScanUpdate?: (asin: string, status: 'scanning' | 'completed' | 'failed') => Promise<void>,
  targetCategoriesFlat?: string,
): Promise<CompetitorSwarmResult> {
  const ts = () => new Date().toISOString().slice(11, 23);
  const candidateAsins = selectedAsins.slice(0, limit);

  console.log(`[CompetitorSwarm] SCAN SELECTED — ${candidateAsins.length} ASINs, limit=${limit}`);

  const batchSize = opts.scanBatchSize ?? 3;
  const scanDeadline = opts.scanMaxSeconds ? Date.now() + opts.scanMaxSeconds * 1000 : null;
  const successfulComps: ProductData[] = [];
  const needed = limit;

  for (let i = 0; i < candidateAsins.length; i += batchSize) {
    if (successfulComps.length >= needed) break;
    if (scanDeadline && Date.now() > scanDeadline) {
      console.warn(`[CompetitorSwarm] [${ts()}] Scan deadline reached — stopping after ${successfulComps.length} competitors`);
      break;
    }

    const batch = candidateAsins.slice(i, i + batchSize);
    const pagesPerProduct = competitorPagesPerProduct(reviewSettings.competitor_review_pages, candidateAsins.length);
    const reviewOpts = { ...opts, reviewPages: pagesPerProduct, productTimeoutMs: opts.competitorTimeoutMs ?? opts.productTimeoutMs };

    console.log(`[CompetitorSwarm] [${ts()}] Batch ${i}–${i + batch.length - 1}: ${JSON.stringify(batch)} pagesPerProduct=${pagesPerProduct}`);
    onProgress?.(
      `Scraping competitor ${Math.min(i + batch.length, candidateAsins.length)} of ${candidateAsins.length} (target ${needed} for analysis)…`,
    );

    const results = await Promise.allSettled(
      batch.map(async (asin) => {
        await onScanUpdate?.(asin, 'scanning');
        const product = await rainforestProduct(asin, rainforestKey, firecrawlKey, amazonDomain, reviewOpts);
        return { asin, product };
      }),
    );

    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn(`[CompetitorSwarm] [${ts()}] Batch item failed:`, r.reason);
        continue;
      }
      const { asin, product } = r.value;
      if (!product) {
        await onScanUpdate?.(asin, 'failed');
        continue;
      }
      await onScanUpdate?.(asin, 'completed');
      if (isUsableDeepCompetitor(product as unknown as Record<string, unknown>)) {
        successfulComps.push(product);
      }
    }
  }

  if (successfulComps.length < needed) {
    console.warn(`[CompetitorSwarm] PartialData: only ${successfulComps.length}/${needed} usable competitors from ${candidateAsins.length} selected`);
  }

  return {
    competitors: successfulComps,
    searchQueryUsed: '',
    candidateAsins,
    candidateCount: candidateAsins.length,
  };
}
