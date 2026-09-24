/**
 * Brand-website audit: scrape any D2C brand's product page (e.g. beminimalist.co),
 * extract social handles from the homepage footer, then run the existing Amazon
 * competitor swarm using the extracted brand + title as the search query.
 *
 * Returns the same EcomAuditResult shape as Amazon/marketplace audits so the
 * downstream pipeline (social, Reddit, LLM brief) stays unchanged.
 */
import { buildAnalyticsPayload } from './analyticsPayload';
import type { EcomEnv } from './config';
import { competitorCounts, scraperOptions } from './config';
import {
  findAndScanCompetitors,
} from './services/ecomAgent/competitorSwarm';
import { runAnalysisPhase, type ProgressFn } from './auditAnalysis';
import { resolveLLM } from './services/ecomAgent/llm';
import { makeReviewSettings } from './services/ecomAgent/reviewVolume';
import type { ProductData } from './services/ecomAgent/scraper';
import { firecrawlScrapeJson, productSchema } from './platforms/firecrawlClient';
import { fetchPageHtml } from './platforms/htmlFallback';
import type { EcomAuditResult } from './standaloneAudit';

export interface BrandSocialLinks {
  instagram?: string;
  facebook?: string;
  tiktok?: string;
  youtube?: string;
  twitter?: string;
}

/**
 * Extract social handles from a brand homepage's raw HTML.
 * Prefers links inside <footer>; falls back to the full document.
 */
export function extractSocialLinksFromHtml(html: string): BrandSocialLinks {
  const out: BrandSocialLinks = {};

  // Prefer <footer> block when present — that's where brands publish their canonical socials
  const footerMatch = html.match(/<footer[^>]*>([\s\S]*?)<\/footer>/i);
  const scopes: string[] = [];
  if (footerMatch) scopes.push(footerMatch[1]);
  scopes.push(html); // fallback to whole doc

  const skipInstagramPaths = /^(p|reel|reels|tv|stories|explore|accounts|web)$/i;

  for (const scope of scopes) {
    if (!out.instagram) {
      // Match instagram.com/<handle>/ — handle is 1-30 chars of [a-zA-Z0-9._]
      const re = /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{1,30})\/?(?=["'?#\s)/<>])/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(scope)) !== null) {
        const handle = m[1];
        if (skipInstagramPaths.test(handle)) continue;
        out.instagram = handle.toLowerCase();
        break;
      }
    }
    if (!out.facebook) {
      const re = /https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9.\-_]{2,60})(?=[/"'?#\s<>])/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(scope)) !== null) {
        const page = m[1];
        if (/^(sharer|share|dialog|tr|plugins|events|profile\.php)$/i.test(page)) continue;
        out.facebook = page;
        break;
      }
    }
    if (!out.tiktok) {
      const m = scope.match(/https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9._]{1,30})/i);
      if (m) out.tiktok = m[1].toLowerCase();
    }
    if (!out.youtube) {
      const m = scope.match(/https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/|user\/)([a-zA-Z0-9._\-]{2,60})/i);
      if (m) out.youtube = m[1];
    }
    if (!out.twitter) {
      const m = scope.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]{1,15})(?=[/"'?#\s<>])/i);
      if (m) {
        const handle = m[1];
        if (!/^(intent|share|home|search)$/i.test(handle)) {
          out.twitter = handle.toLowerCase();
        }
      }
    }
    // Stop scanning fallback scope if we already have IG (most important field)
    if (out.instagram && out.facebook) break;
  }

  return out;
}

function metaContent(html: string, prop: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const m = html.match(re);
  return m?.[1]?.trim() ?? '';
}

interface ParsedHtmlProduct {
  title: string;
  brand: string;
  category: string;
  price: string;
  description: string;
  bullets: string[];
  product_images: string[];
}

/**
 * Parse product details from raw HTML using JSON-LD schema + OpenGraph meta tags.
 * Used when Firecrawl is unavailable (out of credits) or for brand homepages.
 */
function parseHtmlForProduct(html: string, fallbackTitle: string): ParsedHtmlProduct | null {
  // 1. Try JSON-LD <script type="application/ld+json"> — most reliable for e-commerce
  let ldProduct: Record<string, unknown> | null = null;
  const ldMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const type = (item as Record<string, unknown>)['@type'];
        const typeStr = Array.isArray(type) ? type.join(',') : String(type ?? '');
        if (/Product/i.test(typeStr)) {
          ldProduct = item as Record<string, unknown>;
          break;
        }
        // @graph wrapper (common in Shopify/WordPress)
        const graph = (item as Record<string, unknown>)['@graph'];
        if (Array.isArray(graph)) {
          for (const g of graph) {
            const gType = (g as Record<string, unknown>)?.['@type'];
            const gTypeStr = Array.isArray(gType) ? gType.join(',') : String(gType ?? '');
            if (/Product/i.test(gTypeStr)) {
              ldProduct = g as Record<string, unknown>;
              break;
            }
          }
        }
      }
      if (ldProduct) break;
    } catch { /* malformed JSON-LD; skip */ }
  }

  // 2. Extract OpenGraph meta tags (universal fallback)
  const ogTitle = metaContent(html, 'og:title') || metaContent(html, 'twitter:title');
  const ogDesc = metaContent(html, 'og:description') || metaContent(html, 'description');
  const ogImage = metaContent(html, 'og:image');
  const ogBrand = metaContent(html, 'og:brand') || metaContent(html, 'product:brand');
  const ogPrice = metaContent(html, 'product:price:amount') || metaContent(html, 'og:price:amount');
  const ogCurrency = metaContent(html, 'product:price:currency') || metaContent(html, 'og:price:currency') || '';
  const siteName = metaContent(html, 'og:site_name');

  // 3. Merge sources (JSON-LD wins, fall back to OG)
  const title = String((ldProduct?.name as string) ?? ogTitle ?? fallbackTitle ?? '').trim();
  if (!title) return null;

  const brand = String(
    (ldProduct?.brand && typeof ldProduct.brand === 'object'
      ? (ldProduct.brand as Record<string, unknown>).name
      : ldProduct?.brand) ?? ogBrand ?? siteName ?? '',
  ).trim();

  const description = String((ldProduct?.description as string) ?? ogDesc ?? '').trim();
  const category = String((ldProduct?.category as string) ?? '').trim();

  // Price: JSON-LD offers[].price OR offers.price, fall back to OG
  let price = '';
  const offers = ldProduct?.offers;
  if (offers) {
    const offer = Array.isArray(offers) ? offers[0] : offers;
    const p = (offer as Record<string, unknown>)?.price ?? (offer as Record<string, unknown>)?.lowPrice;
    const cur = (offer as Record<string, unknown>)?.priceCurrency ?? '';
    if (p) price = `${cur ? cur + ' ' : ''}${p}`;
  }
  if (!price && ogPrice) price = `${ogCurrency ? ogCurrency + ' ' : ''}${ogPrice}`;
  if (!price) price = 'N/A';

  // Images: JSON-LD `image` (string or array) + og:image fallback
  const images: string[] = [];
  const ldImage = ldProduct?.image;
  if (typeof ldImage === 'string') images.push(ldImage);
  else if (Array.isArray(ldImage)) {
    for (const i of ldImage) {
      if (typeof i === 'string') images.push(i);
      else if (i && typeof i === 'object' && typeof (i as Record<string, unknown>).url === 'string') {
        images.push(String((i as Record<string, unknown>).url));
      }
    }
  }
  if (!images.length && ogImage) images.push(ogImage);

  // Bullets: from description; split on bullets/newlines/sentences
  const bullets: string[] = description
    ? description.split(/[\n\r•·▪️–—]+|(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(s => s.length > 8 && s.length < 200).slice(0, 6)
    : [];
  if (!bullets.length && title) bullets.push(title.slice(0, 120));

  return {
    title,
    brand,
    category,
    price,
    description,
    bullets,
    product_images: images,
  };
}

/**
 * Scrape the brand's homepage (origin of the product URL) and extract social handles.
 */
async function scrapeBrandHomepage(productUrl: string): Promise<BrandSocialLinks> {
  let homepageUrl: string;
  try {
    homepageUrl = new URL(productUrl).origin;
  } catch {
    return {};
  }
  console.log(`[brand-website] Fetching homepage for social links: ${homepageUrl}`);
  const html = await fetchPageHtml(homepageUrl, 20_000);
  if (!html) {
    console.warn(`[brand-website] Homepage fetch returned no HTML`);
    return {};
  }
  const links = extractSocialLinksFromHtml(html);
  const found = Object.entries(links)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=@${v}`)
    .join(', ');
  console.log(`[brand-website] Social links extracted: ${found || '(none found)'}`);
  return links;
}

function mapBrandSiteToProductData(
  raw: Record<string, unknown>,
  url: string,
  syntheticId: string,
  socialLinks: BrandSocialLinks,
): ProductData {
  const bullets = (raw.bullets as string[]) ?? (raw.highlights as string[]) ?? [];
  const thumbnails: Array<{ url: string; ocr_description: string }> = [];
  for (const img of ((raw.product_images as string[]) ?? []).slice(0, 12)) {
    if (img) thumbnails.push({ url: String(img), ocr_description: String(raw.title ?? '').slice(0, 60) });
  }
  const aPlus: ProductData['a_plus'] = [];
  for (const mod of ((raw.rich_content as Array<Record<string, unknown>>) ?? [])) {
    aPlus.push({
      type: String(mod.type ?? 'content'),
      visual_desc: String(mod.headline ?? 'Content'),
      text_content: String(mod.body ?? mod.headline ?? ''),
      image_url: mod.image_url ? String(mod.image_url) : undefined,
    });
  }
  const title = String(raw.title ?? `Product ${syntheticId}`);
  return {
    asin: syntheticId,
    platform: 'amazon', // synthetic for downstream type compat; actual source is the brand site URL
    title,
    brand: String(raw.brand ?? ''),
    categories_flat: String(raw.category ?? raw.categories ?? 'General'),
    generic_category: String(raw.category ?? ''),
    url,
    description: String(raw.description ?? ''),
    bullets,
    rating: raw.rating != null ? Number(raw.rating) : null,
    ratings_total: raw.review_count != null ? Number(raw.review_count) : undefined,
    reviews_total: raw.review_count != null ? Number(raw.review_count) : undefined,
    price: String(raw.price ?? 'N/A'),
    thumbnails,
    headline: title,
    winning_hook: bullets[0] ?? title.slice(0, 80),
    a_plus: aPlus,
    top_10_positive_reviews: ((raw.top_positive_reviews as string[]) ?? []).slice(0, 10),
    top_10_negative_reviews: ((raw.top_negative_reviews as string[]) ?? []).slice(0, 10),
    // Stashed on the product so analyticsPayload.ts can forward to ecom.products[0].socialLinks
    // (cast to satisfy ProductData type — analyticsPayload reads via index access)
    ...(socialLinks && Object.keys(socialLinks).length ? { socialLinks } as unknown as Partial<ProductData> : {}),
  };
}

function cleanCompetitorSearchQuery(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');
}

export async function runBrandWebsiteAudit(
  productUrl: string,
  env: EcomEnv,
  onProgress?: ProgressFn,
): Promise<EcomAuditResult> {
  const t0 = Date.now();
  const firecrawlKey = env.FIRECRAWL_API_KEY ?? '';
  const rainforestKey = env.RAINFOREST_API_KEY ?? '';
  const opts = scraperOptions(env);
  const { key: llmKey } = resolveLLM(env);

  if (!llmKey) {
    throw new Error('OPENROUTER_API_KEY or OPENAI_API_KEY must be configured for LLM analysis.');
  }
  if (!rainforestKey && !opts.customScraperUrl) {
    throw new Error('RAINFOREST_API_KEY or CUSTOM_SCRAPER_URL must be configured to discover competitors on Amazon.');
  }

  const counts = competitorCounts(env);
  const url = productUrl.trim();
  const hostname = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  const pathname = (() => { try { return new URL(url).pathname; } catch { return '/'; } })();
  const isHomepageOnly = pathname === '/' || pathname === '';

  onProgress?.(8, isHomepageOnly ? 'Scraping brand homepage…' : 'Scraping brand product page…');

  // Step 1a: try Firecrawl first (best quality structured extraction)
  let productJson: Record<string, unknown> | null = null;
  let firecrawlError: string | null = null;
  if (firecrawlKey) {
    const fcResult = await firecrawlScrapeJson(
      url,
      firecrawlKey,
      "Extract this brand's product details. The page is a direct-to-consumer brand's own product page (not a marketplace). Capture the product title, brand name, product category, current price (with currency), bullets/key features, full description, product image URLs, and any rich content modules with headlines and body text. Skip cart widgets, recommended products, and navigation.",
      productSchema(),
      { timeoutMs: 90_000, waitFor: 4_000 },
    );
    if (fcResult.json) {
      productJson = fcResult.json;
      console.log(`[brand-website] Firecrawl OK`);
    } else {
      firecrawlError = fcResult.error ?? 'Firecrawl returned no data';
      console.warn(`[brand-website] Firecrawl failed (${fcResult.creditsExhausted ? 'credits exhausted' : 'error'}) — falling back to raw HTML + JSON-LD`);
    }
  }

  // Step 1b: HTML fallback — fetch raw HTML once, use it for BOTH product extraction
  // (via JSON-LD + OG meta) AND social-link extraction. Always run so we get social
  // links even when Firecrawl succeeds.
  onProgress?.(15, 'Reading raw HTML (product details + social links)…');
  const productHtml = await fetchPageHtml(url, 20_000);

  if (!productJson) {
    if (!productHtml) {
      throw new Error(
        `Could not load ${url}. Firecrawl: ${firecrawlError ?? 'skipped (no key)'}. Direct fetch also failed.`,
      );
    }
    const fallbackTitle = (hostname.split('.').slice(-2, -1)[0] ?? '').replace(/[-_]/g, ' ');
    const htmlProduct = parseHtmlForProduct(productHtml, fallbackTitle);
    if (!htmlProduct) {
      throw new Error(
        `Could not extract product details from ${url}. Firecrawl error: ${firecrawlError ?? 'unavailable'}. The page has no usable JSON-LD or OpenGraph product metadata.`,
      );
    }
    console.log(`[brand-website] HTML fallback parsed: title="${htmlProduct.title.slice(0, 60)}" brand="${htmlProduct.brand}"`);
    productJson = htmlProduct as unknown as Record<string, unknown>;
  }

  // Step 2: social handles — prefer extracting from the same HTML we already fetched
  // (saves a request); fall back to a separate homepage fetch only if the product page
  // is on a different origin or had no HTML.
  onProgress?.(22, 'Extracting brand social links…');
  let socialLinks: BrandSocialLinks = {};
  if (productHtml) {
    socialLinks = extractSocialLinksFromHtml(productHtml);
  }
  if (!socialLinks.instagram && !isHomepageOnly) {
    // Product page didn't expose footer socials; try the homepage explicitly
    const homepageLinks = await scrapeBrandHomepage(url);
    socialLinks = { ...homepageLinks, ...socialLinks };
  }
  console.log(
    `[brand-website] Social links: ${Object.entries(socialLinks).filter(([, v]) => v).map(([k, v]) => `${k}=@${v}`).join(', ') || '(none)'}`,
  );

  // Step 3: build a ProductData object with a synthetic ASIN
  const syntheticId = (hostname.replace(/^www\./, '').split('.')[0] || 'brand').toLowerCase();
  const targetProduct = mapBrandSiteToProductData(productJson, url, syntheticId, socialLinks);

  if (!targetProduct.brand && !targetProduct.title) {
    throw new Error(`No usable product fields extracted from ${url}. The page may require JavaScript or be blocked.`);
  }

  console.log(`[brand-website] Extracted: brand="${targetProduct.brand}" title="${targetProduct.title.slice(0, 60)}" price=${targetProduct.price} category="${targetProduct.categories_flat}"`);

  // Step 4: run Amazon competitor swarm using brand+title as the search query
  const amazonDomain = env.AMAZON_DOMAIN ?? process.env.AMAZON_DOMAIN ?? 'amazon.com';
  const searchQuery = `${targetProduct.brand} ${targetProduct.title}`.slice(0, 120);

  const reviewSettings = makeReviewSettings(
    env.REVIEW_PAGES ? Number(env.REVIEW_PAGES) : undefined,
    undefined,
    10,
    undefined,
  );

  onProgress?.(30, `Discovering competitors on ${amazonDomain}…`);
  let allCompetitors: ProductData[] = [];
  let searchQueryUsed = searchQuery;
  try {
    const swarmResult = await findAndScanCompetitors(
      searchQuery,
      targetProduct.title,
      syntheticId,
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
  } catch (e) {
    console.warn(`[brand-website] Competitor swarm failed: ${e instanceof Error ? e.message : e}`);
    // Don't throw — brand-website audits should succeed even without Amazon competitors
  }

  const analysisCompetitors = allCompetitors.slice(0, counts.llmAnalysis);
  if (allCompetitors.length) {
    onProgress?.(53, `Scraped ${allCompetitors.length} competitors — running AI analysis on top ${analysisCompetitors.length}…`);
  } else {
    onProgress?.(53, 'No competitors found on Amazon — generating analysis from brand product alone…');
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
    meta: { asin: syntheticId, productUrl: url, amazonDomain: 'brand-website' },
    elapsedMs: Date.now() - t0,
  };
}
