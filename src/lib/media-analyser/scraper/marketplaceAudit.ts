/**
 * Non-Amazon marketplace audit: Flipkart, Myntra, Nykaa, Croma via Firecrawl + HTML fallback.
 */
import { buildAnalyticsPayload } from './analyticsPayload';
import type { EcomEnv } from './config';
import { competitorCounts } from './config';
import {
  detectPlatform,
  extractProductId,
  resolveProductUrl,
  extractNykaaRelatedFromPdp,
  scrapeMarketplaceCompetitor,
  scrapeMarketplaceProduct,
  searchMarketplaceCandidates,
} from './platforms/index';
import { searchCromaCategoryFallback } from './platforms/htmlFallback';
import type { PlatformId } from './platforms/types';
import { getPlatformDefinition } from './platforms/definitions';
import { rankMyntraCandidates, rankMyntraProducts } from './platforms/myntraRank';
import { isUsableDeepCompetitor } from './services/ecomAgent/competitorSwarm';
import { callLLM, LLM_MODEL, OPENAI_ENDPOINT, resolveLLM, stripJsonFences } from './services/ecomAgent/llm';
import { makeReviewSettings } from './services/ecomAgent/reviewVolume';
import type { CompetitorCandidate, ProductData } from './services/ecomAgent/scraper';
import { runAnalysisPhase, type ProgressFn } from './auditAnalysis';
import type { EcomAuditResult } from './standaloneAudit';

function isUsableMarketplaceCompetitor(p: ProductData): boolean {
  if (isUsableDeepCompetitor(p as unknown as Record<string, unknown>)) return true;
  const title = String(p.title ?? '').trim();
  if (!title || title.length < 4) return false;
  return (
    (p.rating != null && p.rating > 0) ||
    (p.bullets?.length ?? 0) > 0 ||
    (p.thumbnails?.length ?? 0) >= 1
  );
}

function cleanQuery(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');
}

function titleSearchQuery(title: string): string {
  const stop = new Set(['with', 'for', 'and', 'the', 'from', 'new', 'buy', 'online']);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w))
    .slice(0, 5)
    .join(' ');
}

async function generateMarketplaceSearchQueries(
  platform: PlatformId,
  title: string,
  category: string,
  price: string,
  bullets: string[],
  llmKey: string,
  llmEndpoint?: string,
): Promise<string[]> {
  const label = getPlatformDefinition(platform).label;
  const prompt = `You are a ${label} marketplace analyst. Generate 5 search queries to find direct competitors for this product on ${label}.

Product title: ${title}
Category: ${category || 'unknown'}
Price: ${price || 'unknown'}
Key features: ${bullets.slice(0, 4).join(' | ') || 'N/A'}

Rules:
- 2-5 words per query, no brand names, no model numbers
- Same product type and similar price band
- Respond with ONLY valid JSON: {"queries": ["q1","q2","q3","q4","q5"]}`;

  try {
    const raw = await callLLM(llmKey, [{ role: 'user', content: prompt }], {
      model: LLM_MODEL,
      maxTokens: 200,
      temperature: 0,
      responseFormat: { type: 'json_object' },
      endpoint: llmEndpoint ?? OPENAI_ENDPOINT,
      timeoutMs: 45_000,
    });
    const parsed = JSON.parse(stripJsonFences(raw)) as { queries?: unknown };
    const queries = Array.isArray(parsed.queries)
      ? parsed.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      : [];
    if (queries.length) return queries;
  } catch (e) {
    console.warn(`[MarketplaceAudit] LLM query gen failed:`, e);
  }
  return [];
}

function buildSearchQueries(
  platform: PlatformId,
  target: ProductData,
  llmQueries: string[],
): string[] {
  const leaf = (target.categories_flat ?? '').split('>').pop()?.trim() || '';
  const base = cleanQuery(leaf || target.generic_category || titleSearchQuery(target.title));
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (q: string) => {
    const c = cleanQuery(q);
    if (!c || seen.has(c.toLowerCase())) return;
    seen.add(c.toLowerCase());
    out.push(c);
  };
  for (const q of llmQueries) add(q);
  add(base);
  add(titleSearchQuery(target.title));
  if (!out.length) add(target.title.split(' ').slice(0, 4).join(' '));
  console.log(`[MarketplaceAudit] ${platform} search plan: ${JSON.stringify(out)}`);
  return out;
}

function selectRankedCandidates(
  platform: PlatformId,
  target: ProductData,
  candidates: CompetitorCandidate[],
  limit: number,
): CompetitorCandidate[] {
  if (platform === 'myntra' || platform === 'nykaa') {
    const ranked = rankMyntraCandidates(target, candidates);
    const top = ranked.slice(0, limit);
    console.log(
      `[MarketplaceAudit] Myntra top ${top.length} by relevance: ${top
        .map((c) => `${c.title?.slice(0, 40) ?? c.asin} ★${c.avgRating ?? '?'}`)
        .join(' | ')}`,
    );
    return top;
  }
  return candidates.slice(0, limit);
}

export async function runMarketplaceAudit(
  productUrl: string,
  platform: PlatformId,
  env: EcomEnv,
  onProgress?: ProgressFn,
): Promise<EcomAuditResult> {
  const t0 = Date.now();
  const firecrawlKey = env.FIRECRAWL_API_KEY ?? '';
  const { key: llmKey, endpoint: llmEndpoint } = resolveLLM(env);
  if (!llmKey) {
    throw new Error('OPENROUTER_API_KEY or OPENAI_API_KEY must be configured for LLM analysis.');
  }

  const counts = competitorCounts(env);
  const label = getPlatformDefinition(platform).label;

  onProgress?.(5, `Resolving ${label} product…`);
  const resolvedUrl = await resolveProductUrl(productUrl, platform);
  const productId = extractProductId(resolvedUrl, platform);
  if (!productId) {
    throw new Error(
      `Could not extract product ID from ${label} URL. Paste a full product page link.`,
    );
  }

  onProgress?.(15, `Scraping target product on ${label}…`);
  const targetProduct = await scrapeMarketplaceProduct(
    platform,
    resolvedUrl,
    productId,
    firecrawlKey,
  );
  if (!targetProduct) {
    const hint =
      platform === 'myntra'
        ? 'Use a full Myntra /buy URL (e.g. …/12345678/buy).'
        : 'Use a full product page URL.';
    throw new Error(`Failed to scrape product on ${label}. ${hint}`);
  }

  const reviewSettings = makeReviewSettings(
    env.REVIEW_PAGES ? Number(env.REVIEW_PAGES) : undefined,
    undefined,
    10,
    undefined,
  );

  onProgress?.(28, `Discovering up to ${counts.discover} competitors on ${label}…`);
  const llmQueries = await generateMarketplaceSearchQueries(
    platform,
    targetProduct.title,
    targetProduct.categories_flat,
    targetProduct.price,
    targetProduct.bullets,
    llmKey,
    llmEndpoint,
  );
  const searchQueries = buildSearchQueries(platform, targetProduct, llmQueries);

  const seen = new Set<string>([productId]);
  const candidates: CompetitorCandidate[] = [];
  let usedQuery = '';

  for (const query of searchQueries) {
    if (candidates.length >= counts.discover * 2) break;
    onProgress?.(32, `Searching ${label}: "${query}"`);
    const found = await searchMarketplaceCandidates(platform, query, firecrawlKey);
    for (const c of found) {
      if (!c.asin || seen.has(c.asin)) continue;
      seen.add(c.asin);
      candidates.push({ ...c, rank: candidates.length });
      if (!usedQuery) usedQuery = query;
    }
  }

  if (!candidates.length && platform === 'nykaa') {
    onProgress?.(35, 'Search empty — loading similar products from Nykaa product page…');
    const related = await extractNykaaRelatedFromPdp(resolvedUrl, firecrawlKey);
    for (const c of related) {
      if (!c.asin || seen.has(c.asin)) continue;
      seen.add(c.asin);
      candidates.push({ ...c, rank: candidates.length });
    }
    if (candidates.length && !usedQuery) usedQuery = 'similar products (PDP)';
  }

  if (!candidates.length && platform === 'croma') {
    // Croma search is fully JS-rendered — fall back to fetching the product's category PLP
    // which has server-side rendered product listings in __INITIAL_DATA__.plpReducer.plpData.products
    const catCode = (targetProduct.generic_category ?? '').match(/croma-cat:(\d+)/)?.[1];
    if (catCode) {
      onProgress?.(35, `Croma search JS-rendered — loading category c/${catCode} instead…`);
      const catCandidates = await searchCromaCategoryFallback(catCode, productId, 20);
      for (const c of catCandidates) {
        if (!c.asin || seen.has(c.asin)) continue;
        seen.add(c.asin);
        candidates.push({ ...c, rank: candidates.length });
      }
      if (candidates.length && !usedQuery) usedQuery = `category c/${catCode}`;
    }
  }

  const rankedPool = selectRankedCandidates(platform, targetProduct, candidates, counts.discover);
  const selected = selectRankedCandidates(platform, targetProduct, rankedPool, counts.deepScrape);

  onProgress?.(40, `Deep-scraping top ${selected.length} relevant competitors on ${label}…`);

  const batchSize = Number(env.CUSTOM_COMPETITOR_SCAN_BATCH_SIZE ?? 4) || 4;
  const allCompetitors: ProductData[] = [];

  for (let i = 0; i < selected.length; i += batchSize) {
    const batch = selected.slice(i, i + batchSize);
    onProgress?.(45, `Scanning competitors ${i + 1}–${Math.min(i + batch.length, selected.length)}…`);
    const settled = await Promise.allSettled(
      batch.map((c) => scrapeMarketplaceCompetitor(platform, c, firecrawlKey)),
    );
    for (const r of settled) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const p = r.value;
      if (!isUsableMarketplaceCompetitor(p)) continue;
      allCompetitors.push(p);
    }
  }

  if (!allCompetitors.length) {
    const hints: string[] = [];
    if (candidates.length === 0) {
      hints.push(
        `Search returned 0 candidates across ${searchQueries.length} queries.`,
      );
      if (platform === 'nykaa') {
        if (!firecrawlKey) {
          hints.push(
            'Nykaa blocks direct scraping — set FIRECRAWL_API_KEY in .env.',
          );
        } else {
          hints.push(
            'Ensure Firecrawl has credits, or use a product page that shows “similar products”.',
          );
        }
      } else if (platform === 'flipkart') {
        hints.push(
          'HTML search fallback was used. If Flipkart returned 0 results, try a different product URL or wait a moment and retry.',
        );
      } else if (platform === 'croma') {
        hints.push(
          'Croma search is JS-rendered. Ensure the product URL is a valid Croma product page so its category can be detected for competitor lookup.',
        );
      }
    } else {
      hints.push(
        `Found ${candidates.length} listing(s) but none scraped with enough detail (title, price, or reviews).`,
      );
    }
    // Degrade gracefully — a missing competitor set must not abort the whole run
    // (the product scraped fine; the user may have supplied their own competitors).
    onProgress?.(53, `No competitors found on ${label} — generating analysis from the product alone. ${hints.join(' ')}`.trim());
  }

  const orderedCompetitors =
    platform === 'myntra' || platform === 'nykaa'
      ? rankMyntraProducts(targetProduct, allCompetitors).slice(0, counts.deepScrape)
      : allCompetitors.slice(0, counts.deepScrape);

  const analysisCompetitors = orderedCompetitors.slice(0, counts.llmAnalysis);
  if (orderedCompetitors.length) {
    onProgress?.(
      53,
      `Scraped ${orderedCompetitors.length} competitors — running AI analysis on top ${analysisCompetitors.length} by relevance & ratings…`,
    );
  }

  const auditInput = await runAnalysisPhase(
    env,
    targetProduct,
    orderedCompetitors,
    analysisCompetitors,
    usedQuery || searchQueries[0] || targetProduct.title,
    reviewSettings,
    onProgress,
  );

  const payload = buildAnalyticsPayload(auditInput);
  return {
    payload,
    meta: {
      asin: productId,
      productUrl: resolvedUrl,
      amazonDomain: platform,
    },
    elapsedMs: Date.now() - t0,
  };
}
