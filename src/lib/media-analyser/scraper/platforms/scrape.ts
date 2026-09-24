import type { CompetitorCandidate, ProductData } from '../services/ecomAgent/scraper';
import { getPlatformDefinition } from './definitions';
import {
  firecrawlNykaaSimilarProducts,
  firecrawlScrapeJson,
  parseSearchResults,
  productSchema,
  searchSchema,
} from './firecrawlClient';
import { scrapeProductHtmlFallback, searchMarketplaceHtmlFallback } from './htmlFallback';
import {
  nykaaRowsToCandidates,
  parseNykaaSearchFromMarkdown,
  parseNykaaSimilarResults,
} from './nykaaParse';
import type { PlatformId } from './types';
import { mapFirecrawlToProduct, searchRowsToCandidates } from './types';

const NYKAA_FC_OPTS = { waitFor: 5000, mobile: true, includeMarkdown: true } as const;

function hasProductFields(json: Record<string, unknown> | null): boolean {
  if (!json) return false;
  return Boolean(
    json.title ||
      json.price ||
      json.name ||
      (Array.isArray(json.bullets) && json.bullets.length) ||
      (Array.isArray(json.highlights) && json.highlights.length),
  );
}

export async function scrapeMarketplaceProduct(
  platform: PlatformId,
  productUrl: string,
  productId: string,
  firecrawlKey: string,
): Promise<ProductData | null> {
  const def = getPlatformDefinition(platform);
  const url = productUrl.startsWith('http') ? productUrl.split('?')[0] : def.normalizeProductUrl(productUrl, productId);

  // HTML-first platforms: parse embedded JSON without consuming Firecrawl credits.
  // Myntra (window.__myx), Flipkart (__INITIAL_STATE__), Nykaa (__PRELOADED_STATE__), Croma (__INITIAL_DATA__)
  if (platform === 'myntra' || platform === 'flipkart' || platform === 'nykaa' || platform === 'croma') {
    const htmlProduct = await scrapeProductHtmlFallback(platform, url, productId);
    if (htmlProduct) return htmlProduct;
  }

  if (firecrawlKey) {
    const fcOpts = platform === 'nykaa' ? { waitFor: 5000, mobile: true } : {};
    const fc = await firecrawlScrapeJson(
      url,
      firecrawlKey,
      def.productExtractPrompt,
      productSchema(),
      fcOpts,
    );
    if (fc.creditsExhausted) {
      console.warn(`[Scrape] Firecrawl credits exhausted — using HTML fallback for ${platform}`);
    }
    if (hasProductFields(fc.json)) {
      return mapFirecrawlToProduct(platform, productId, url, fc.json!);
    }
  }

  const fallback = await scrapeProductHtmlFallback(platform, url, productId);
  if (fallback) return fallback;

  return null;
}

async function searchNykaaCandidates(
  query: string,
  firecrawlKey: string,
  searchExtractPrompt: string,
  searchUrl: string,
): Promise<CompetitorCandidate[]> {
  if (!firecrawlKey) return [];

  const fc = await firecrawlScrapeJson(
    searchUrl,
    firecrawlKey,
    searchExtractPrompt,
    searchSchema(),
    NYKAA_FC_OPTS,
  );
  if (fc.creditsExhausted) return [];

  let rows = parseSearchResults(fc.json);
  if (!rows.length && fc.markdown) {
    rows = parseNykaaSearchFromMarkdown(fc.markdown, 15) as typeof rows;
    if (rows.length) {
      console.log(`[Scrape] Nykaa search "${query}" — ${rows.length} products from markdown links`);
    }
  }
  return nykaaRowsToCandidates(rows);
}

/** Similar products on Nykaa PDP when search returns nothing. */
export async function extractNykaaRelatedFromPdp(
  productUrl: string,
  firecrawlKey: string,
): Promise<CompetitorCandidate[]> {
  if (!firecrawlKey) return [];
  const fc = await firecrawlNykaaSimilarProducts(productUrl, firecrawlKey);
  if (fc.creditsExhausted || (!fc.json && !fc.markdown)) return [];

  let rows = parseNykaaSimilarResults(fc.json);
  if (!rows.length && fc.markdown) {
    rows = parseNykaaSearchFromMarkdown(fc.markdown, 12);
  }
  const candidates = nykaaRowsToCandidates(rows);
  if (candidates.length) {
    console.log(`[Scrape] Nykaa PDP similar products => ${candidates.length} candidates`);
  }
  return candidates;
}

export async function searchMarketplaceCandidates(
  platform: PlatformId,
  query: string,
  firecrawlKey: string,
): Promise<CompetitorCandidate[]> {
  const def = getPlatformDefinition(platform);
  const searchUrl = def.buildSearchUrl(query);

  // HTML search fallback (Myntra) when Firecrawl unavailable
  let htmlCandidates = await searchMarketplaceHtmlFallback(platform, query, 15);
  if (htmlCandidates.length) return htmlCandidates;

  if (platform === 'nykaa') {
    return searchNykaaCandidates(query, firecrawlKey, def.searchExtractPrompt, searchUrl);
  }

  if (!firecrawlKey) return [];

  const fc = await firecrawlScrapeJson(searchUrl, firecrawlKey, def.searchExtractPrompt, searchSchema());
  if (fc.creditsExhausted) {
    htmlCandidates = await searchMarketplaceHtmlFallback(platform, query, 15);
    if (htmlCandidates.length) return htmlCandidates;
    return [];
  }
  const rows = parseSearchResults(fc.json);
  return searchRowsToCandidates(rows);
}

export async function scrapeMarketplaceCompetitor(
  platform: PlatformId,
  candidate: CompetitorCandidate,
  firecrawlKey: string,
): Promise<ProductData | null> {
  const def = getPlatformDefinition(platform);
  const productId = candidate.asin;
  const url =
    candidate.listingUrl && candidate.listingUrl.startsWith('http')
      ? candidate.listingUrl
      : platform === 'myntra'
        ? candidate.listingUrl ?? `https://www.myntra.com/${productId}/buy`
        : def.normalizeProductUrl('', productId);
  return scrapeMarketplaceProduct(platform, url, productId, firecrawlKey);
}
