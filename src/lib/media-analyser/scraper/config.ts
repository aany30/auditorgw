import type { ScraperOptions } from './services/ecomAgent/scraper';

export interface EcomEnv {
  RAINFOREST_API_KEY?: string;
  FIRECRAWL_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENAI_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_PROMPT_MODEL?: string;
  REVIEW_PAGES?: string;
  ENRICH_REVIEWS?: string;
  CUSTOM_SCRAPER_URL?: string;
  CUSTOM_SCRAPER_API_KEY?: string;
  CUSTOM_PRODUCT_TIMEOUT?: string;
  CUSTOM_COMPETITOR_PRODUCT_TIMEOUT?: string;
  CUSTOM_COMPETITOR_PRODUCT_REQUEST_RETRIES?: string;
  CUSTOM_COMPETITOR_SCAN_BATCH_SIZE?: string;
  CUSTOM_COMPETITOR_SCAN_MAX_SECONDS?: string;
  COMPETITOR_CANDIDATE_MULTIPLIER?: string;
  COMPETITOR_CANDIDATE_EXTRA?: string;
  /** @deprecated use ECOM_DEEP_SCRAPE_COUNT */
  ECOM_AUTO_COMPETITORS?: string;
  ECOM_DISCOVER_CANDIDATES?: string;
  ECOM_DEEP_SCRAPE_COUNT?: string;
  ECOM_ANALYSIS_COMPETITORS?: string;
  AMAZON_DOMAIN?: string;
  PORT?: string;
}

export interface CompetitorCounts {
  discover: number;
  deepScrape: number;
  llmAnalysis: number;
}

/** Discover a shortlist, deep-scrape top N, run expensive LLM on the same N (default 4). */
export function competitorCounts(env: EcomEnv): CompetitorCounts {
  const legacy = Number(env.ECOM_AUTO_COMPETITORS ?? '');
  const llmAnalysis = Number(env.ECOM_ANALYSIS_COMPETITORS ?? '') || 4;
  const deepScrape = Number(env.ECOM_DEEP_SCRAPE_COUNT ?? '') || legacy || llmAnalysis;
  const discover =
    Number(env.ECOM_DISCOVER_CANDIDATES ?? '') || Math.max(deepScrape + 2, deepScrape);
  return {
    discover: Math.max(deepScrape, discover),
    deepScrape: Math.max(1, deepScrape),
    llmAnalysis: Math.max(1, Math.min(llmAnalysis, deepScrape)),
  };
}

export function loadEcomEnv(): EcomEnv {
  const env = { ...process.env } as EcomEnv;
  if (!env.AMAZON_DOMAIN?.trim()) {
    env.AMAZON_DOMAIN = 'amazon.com';
  }
  return env;
}

export function defaultAmazonDomain(env?: EcomEnv): string {
  return (env?.AMAZON_DOMAIN ?? process.env.AMAZON_DOMAIN ?? 'amazon.com').trim();
}

export function scraperOptions(env: EcomEnv): ScraperOptions {
  return {
    customScraperUrl: env.CUSTOM_SCRAPER_URL ?? '',
    customScraperKey: env.CUSTOM_SCRAPER_API_KEY ?? '',
    enrichReviews: (env.ENRICH_REVIEWS ?? 'true').toLowerCase() !== 'false',
    reviewPages: Number(env.REVIEW_PAGES ?? 15) || 15,
    productTimeoutMs: env.CUSTOM_PRODUCT_TIMEOUT
      ? Number(env.CUSTOM_PRODUCT_TIMEOUT) * 1000
      : undefined,
    competitorTimeoutMs: env.CUSTOM_COMPETITOR_PRODUCT_TIMEOUT
      ? Number(env.CUSTOM_COMPETITOR_PRODUCT_TIMEOUT) * 1000
      : undefined,
    requestRetries: env.CUSTOM_COMPETITOR_PRODUCT_REQUEST_RETRIES
      ? Number(env.CUSTOM_COMPETITOR_PRODUCT_REQUEST_RETRIES)
      : 0,
    scanBatchSize: env.CUSTOM_COMPETITOR_SCAN_BATCH_SIZE
      ? Number(env.CUSTOM_COMPETITOR_SCAN_BATCH_SIZE)
      : 4,
    scanMaxSeconds: env.CUSTOM_COMPETITOR_SCAN_MAX_SECONDS
      ? Number(env.CUSTOM_COMPETITOR_SCAN_MAX_SECONDS)
      : undefined,
    candidateMultiplier: env.COMPETITOR_CANDIDATE_MULTIPLIER
      ? Math.max(1, Number(env.COMPETITOR_CANDIDATE_MULTIPLIER))
      : 3,
    candidateExtra: env.COMPETITOR_CANDIDATE_EXTRA
      ? Math.max(0, Number(env.COMPETITOR_CANDIDATE_EXTRA))
      : 20,
  };
}
