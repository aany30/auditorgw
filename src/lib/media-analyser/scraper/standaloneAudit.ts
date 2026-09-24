/**
 * Standalone AI e-commerce audit pipeline (extracted from the Scrapper worker).
 * No D1, Clerk, or durable objects — returns analytics-ready payload in-process.
 */
import { buildAnalyticsPayload } from './analyticsPayload';
import type { EcomEnv } from './config';
import { competitorCounts, scraperOptions } from './config';
import {
  candidatesFromRelatedAsins,
  discoverCompetitorCandidates,
  findAndScanCompetitors,
  scanSelectedCompetitors,
} from './services/ecomAgent/competitorSwarm';
import { runAnalysisPhase, type ProgressFn } from './auditAnalysis';
import { resolveLLM } from './services/ecomAgent/llm';
import { makeReviewSettings } from './services/ecomAgent/reviewVolume';
import type { ProductData } from './services/ecomAgent/scraper';
import {
  extractAsinFromUrl,
  resolveAmazonMarket,
  rainforestProduct,
} from './services/ecomAgent/scraper';
import { detectPlatform } from './platforms/index';
import { runMarketplaceAudit } from './marketplaceAudit';
import { runBrandWebsiteAudit } from './brandWebsiteAudit';

export type { ProgressFn } from './auditAnalysis';

function cleanCompetitorSearchQuery(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');
}

async function resolveAsinAndDomain(
  productUrl: string,
  defaultDomain: string,
  onProgress?: ProgressFn,
): Promise<{ asin: string; amazonDomain: string; resolvedUrl: string }> {
  const userInput = productUrl.trim();
  onProgress?.(5, 'Resolving product…');
  let resolvedUrl = userInput;
  if (/amzn\./i.test(resolvedUrl)) {
    try {
      const resp = await fetch(resolvedUrl, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
      resolvedUrl = resp.url || resolvedUrl;
    } catch {
      /* use original */
    }
  }
  const asin =
    extractAsinFromUrl(resolvedUrl) ??
    resolvedUrl.match(/[?&]asin=([A-Z0-9]{10})/i)?.[1]?.toUpperCase() ??
    null;
  if (!asin) {
    throw new Error('Could not extract ASIN from URL — paste a full Amazon product page URL or a 10-character ASIN.');
  }
  const amazonDomain = resolveAmazonMarket(userInput, resolvedUrl, defaultDomain);
  console.log(`[EcomAudit] marketplace=${amazonDomain} (configured=${defaultDomain}, input="${userInput.slice(0, 80)}")`);
  return { asin, amazonDomain, resolvedUrl };
}

export interface EcomAuditResult {
  payload: ReturnType<typeof buildAnalyticsPayload>;
  meta: { asin: string; productUrl: string; amazonDomain: string };
  elapsedMs: number;
}

/**
 * Full AI e-commerce audit: scrape target + competitors, run LLM analysis, return analytics payload.
 */
export async function runEcomAudit(
  productUrl: string,
  env: EcomEnv,
  onProgress?: ProgressFn,
): Promise<EcomAuditResult> {
  const trimmed = productUrl.trim();
  const platform = detectPlatform(trimmed);

  if (platform && platform !== 'amazon') {
    return runMarketplaceAudit(productUrl, platform, env, onProgress);
  }

  // If no known marketplace matched but the input is a valid HTTPS URL,
  // treat it as a brand website (D2C) audit.
  if (!platform) {
    let isValidHttpsUrl = false;
    try {
      const u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
      isValidHttpsUrl = (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname && u.hostname.includes('.');
    } catch {
      isValidHttpsUrl = false;
    }
    if (isValidHttpsUrl) {
      console.log(`[EcomAudit] No marketplace match — routing to brand-website audit for ${trimmed.slice(0, 80)}`);
      return runBrandWebsiteAudit(productUrl, env, onProgress);
    }
  }

  return runAmazonAudit(productUrl, env, onProgress);
}

async function runAmazonAudit(
  productUrl: string,
  env: EcomEnv,
  onProgress?: ProgressFn,
): Promise<EcomAuditResult> {
  const t0 = Date.now();
  const rainforestKey = env.RAINFOREST_API_KEY ?? '';
  const firecrawlKey = env.FIRECRAWL_API_KEY ?? '';
  const opts = scraperOptions(env);
  const { key: llmKey, endpoint: llmEndpoint } = resolveLLM(env);

  if (!rainforestKey && !opts.customScraperUrl) {
    throw new Error('RAINFOREST_API_KEY or CUSTOM_SCRAPER_URL must be configured.');
  }
  if (!llmKey) {
    throw new Error('OPENROUTER_API_KEY or OPENAI_API_KEY must be configured for LLM analysis.');
  }

  const defaultDomain = env.AMAZON_DOMAIN ?? process.env.AMAZON_DOMAIN ?? 'amazon.com';
  const { asin, amazonDomain, resolvedUrl } = await resolveAsinAndDomain(productUrl, defaultDomain, onProgress);

  onProgress?.(15, `Scraping target product (${amazonDomain})…`);
  const targetProduct = await rainforestProduct(asin, rainforestKey, firecrawlKey, amazonDomain, opts);
  if (!targetProduct) {
    throw new Error(`Failed to scrape product data for ASIN ${asin}.`);
  }
  targetProduct.platform = 'amazon';

  const catsFlatLeaf = (targetProduct.categories_flat ?? '').split('>').pop()?.trim();
  const genericLeaf = (targetProduct.generic_category ?? '').split('>').pop()?.trim();
  const rawSearchQuery =
    catsFlatLeaf || genericLeaf || String(targetProduct.title ?? 'premium product');

  const reviewSettings = makeReviewSettings(
    env.REVIEW_PAGES ? Number(env.REVIEW_PAGES) : undefined,
    undefined,
    10,
    undefined,
  );

  const counts = competitorCounts(env);

  onProgress?.(30, `Discovering up to ${counts.discover} competitors…`);
  let discoverCandidates = (
    await discoverCompetitorCandidates(
      rawSearchQuery,
      targetProduct.title,
      asin,
      counts.discover,
      rainforestKey,
      firecrawlKey,
      amazonDomain,
      opts,
      async (msg) => onProgress?.(33, msg),
      {
        key: llmKey,
        endpoint: llmEndpoint,
        productData: {
          price: targetProduct.price,
          bullets: targetProduct.bullets,
          categoriesFlat: targetProduct.categories_flat,
        },
      },
    )
  ).candidates;

  if (!discoverCandidates.length && targetProduct.related_asins?.length) {
    onProgress?.(34, 'Using similar products from the Amazon listing…');
    discoverCandidates = candidatesFromRelatedAsins(
      targetProduct.related_asins,
      asin,
      counts.deepScrape,
    );
    console.log(`[EcomAudit] related_asins fallback => ${discoverCandidates.length} candidates`);
  }

  let allCompetitors: ProductData[] = [];
  let searchQueryUsed = rawSearchQuery;

  if (discoverCandidates.length) {
    const selected = discoverCandidates
      .slice(0, counts.deepScrape)
      .map((c) => c.asin)
      .filter(Boolean);

    onProgress?.(40, `Deep-scraping ${selected.length} competitors (full listing data)…`);
    const swarmResult = await scanSelectedCompetitors(
      selected,
      selected.length,
      rainforestKey,
      firecrawlKey,
      amazonDomain,
      opts,
      reviewSettings,
      async (msg) => onProgress?.(45, msg),
      undefined,
      targetProduct.categories_flat,
    );
    allCompetitors = swarmResult.competitors;
    searchQueryUsed = swarmResult.searchQueryUsed || searchQueryUsed;
  }

  if (!allCompetitors.length) {
    onProgress?.(38, 'Search discovery empty — running integrated competitor swarm…');
    const swarmResult = await findAndScanCompetitors(
      rawSearchQuery,
      targetProduct.title,
      asin,
      counts.deepScrape,
      rainforestKey,
      firecrawlKey,
      amazonDomain,
      opts,
      reviewSettings,
      async (msg) => onProgress?.(42, msg),
      undefined,
      targetProduct.categories_flat,
    );
    allCompetitors = swarmResult.competitors;
    searchQueryUsed = swarmResult.searchQueryUsed || searchQueryUsed;
  }

  // No Amazon competitors found → DEGRADE GRACEFULLY (don't abort the whole run).
  // The product itself scraped fine, and the user may have supplied their own
  // competitors for the social/ad-intelligence side — a missing Amazon competitor
  // set must not fail the audit. (Mirrors brandWebsiteAudit.)
  const analysisCompetitors = allCompetitors.slice(0, counts.llmAnalysis);
  if (allCompetitors.length) {
    onProgress?.(53, `Scraped ${allCompetitors.length} competitors — running deep AI analysis on top ${analysisCompetitors.length}…`);
  } else {
    onProgress?.(53, 'No competitors found on Amazon — generating analysis from the product alone…');
  }
  const auditInput = await runAnalysisPhase(
    env,
    targetProduct,
    allCompetitors,
    analysisCompetitors,
    cleanCompetitorSearchQuery(searchQueryUsed) || searchQueryUsed,
    reviewSettings,
    onProgress,
  );

  const payload = buildAnalyticsPayload(auditInput);
  return {
    payload,
    meta: { asin, productUrl: resolvedUrl, amazonDomain },
    elapsedMs: Date.now() - t0,
  };
}
