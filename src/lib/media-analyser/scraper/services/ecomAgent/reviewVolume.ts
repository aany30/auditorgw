/**
 * Review volume and scraper mode configuration utilities.
 * Port of Amazon-scraper-GW/execution/review_volume.py
 */

export const REVIEWS_PER_PAGE = 10;
export const MIN_REVIEW_PAGES = 5;
export const MAX_REVIEW_PAGES = 100;
export const DEFAULT_TARGET_REVIEW_PAGES = 10;
export const DEFAULT_COMPETITOR_REVIEW_PAGES = 5;
export const SCRAPER_MODE_CUSTOM = 'custom' as const;
export const SCRAPER_MODE_RAINFOREST = 'rainforest' as const;
export const SCRAPER_MODE_BOTH = 'both' as const;
export const DEFAULT_SCRAPER_MODE = SCRAPER_MODE_BOTH;
export const SCRAPER_MODES = new Set([SCRAPER_MODE_CUSTOM, SCRAPER_MODE_RAINFOREST, SCRAPER_MODE_BOTH]);

export type ScraperMode = typeof SCRAPER_MODE_CUSTOM | typeof SCRAPER_MODE_RAINFOREST | typeof SCRAPER_MODE_BOTH;

export interface ReviewSettings {
  target_review_pages: number;
  target_review_limit: number;
  competitor_review_pages: number;
  competitor_review_limit: number;
  competitor_review_pages_per_product: number;
  reviews_per_page: number;
  scraper_mode: ScraperMode;
}

export function normalizeScraperMode(value: unknown, defaultMode: ScraperMode = DEFAULT_SCRAPER_MODE): ScraperMode {
  const raw = String(value ?? defaultMode).trim().toLowerCase().replace(/-/g, '_');
  const aliases: Record<string, ScraperMode> = {
    hybrid: SCRAPER_MODE_BOTH,
    mixed: SCRAPER_MODE_BOTH,
    custom_scraper: SCRAPER_MODE_CUSTOM,
    rainforest_api: SCRAPER_MODE_RAINFOREST,
    api: SCRAPER_MODE_RAINFOREST,
  };
  const resolved = aliases[raw] ?? raw;
  return (SCRAPER_MODES.has(resolved as ScraperMode) ? resolved : defaultMode) as ScraperMode;
}

export function normalizeReviewPages(value: unknown, defaultVal: number): number {
  let pages: number;
  const parsed = parseInt(String(value ?? ''), 10);
  pages = Number.isFinite(parsed) ? parsed : Math.round(defaultVal);
  pages = Math.max(MIN_REVIEW_PAGES, Math.min(MAX_REVIEW_PAGES, pages));
  return Math.round(pages / 5) * 5;
}

export function reviewsForPages(pages: number): number {
  return normalizeReviewPages(pages, DEFAULT_TARGET_REVIEW_PAGES) * REVIEWS_PER_PAGE;
}

export function competitorPagesPerProduct(combinedPages: number, competitorCount: number): number {
  const count = Math.max(1, Math.trunc(competitorCount || 1));
  const pages = normalizeReviewPages(combinedPages, DEFAULT_COMPETITOR_REVIEW_PAGES);
  return Math.max(1, Math.min(MAX_REVIEW_PAGES, Math.ceil(pages / count)));
}

export function makeReviewSettings(
  targetReviewPages?: unknown,
  competitorReviewPages?: unknown,
  competitorCount = 10,
  scraperMode?: unknown,
): ReviewSettings {
  const targetPages = normalizeReviewPages(targetReviewPages, DEFAULT_TARGET_REVIEW_PAGES);
  const competitorPages = normalizeReviewPages(competitorReviewPages, DEFAULT_COMPETITOR_REVIEW_PAGES);
  const perCompetitorPages = competitorPagesPerProduct(competitorPages, competitorCount);
  const mode = normalizeScraperMode(scraperMode);
  return {
    target_review_pages: targetPages,
    target_review_limit: targetPages * REVIEWS_PER_PAGE,
    competitor_review_pages: competitorPages,
    competitor_review_limit: competitorPages * REVIEWS_PER_PAGE,
    competitor_review_pages_per_product: perCompetitorPages,
    reviews_per_page: REVIEWS_PER_PAGE,
    scraper_mode: mode,
  };
}
