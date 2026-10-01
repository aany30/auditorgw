/**
 * A+ auto-scrape — given a product link, reuse the existing single-product scrapers
 * (Amazon via Rainforest, marketplaces via the platform parsers) to pull the reference
 * images + verified facts + negative reviews, so the A+ form can be filled from one URL.
 *
 * This is the LIGHT path: the target product only — no competitor swarm, no LLM analysis.
 */
import { loadEcomEnv, scraperOptions, defaultAmazonDomain } from "./scraper/config";
import { detectPlatform, extractProductId } from "./scraper/platforms/detect";
import { scrapeMarketplaceProduct } from "./scraper/platforms/scrape";
import {
  extractAsinFromUrl,
  resolveAmazonMarket,
  rainforestProduct,
  type ProductData,
} from "./scraper/services/ecomAgent/scraper";

export interface AplusScrapeResult {
  imageUrls: string[];
  title: string;
  brand: string;
  price: string;
  rating: string;
  attributes: { label: string; value: string }[];
  painPoints: string[];
  keywords: string[];
  platform: string;
}

/** Map the scraper's ProductData into the fields the A+ form consumes. */
function mapProductData(p: ProductData): AplusScrapeResult {
  const imageUrls = (p.thumbnails ?? [])
    .map((t) => t.url)
    .filter((u) => /^https?:\/\//.test(u))
    .slice(0, 6);

  const rating =
    p.rating != null ? `${p.rating}${p.ratings_total ? ` (${p.ratings_total} ratings)` : ""}` : "";

  // Bullets → attributes. Split on the first colon when it reads like "Label: Value";
  // otherwise keep the whole line as a generic feature so nothing is lost.
  const attributes = (p.bullets ?? [])
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((b) => {
      const i = b.indexOf(":");
      return i > 0 && i <= 40
        ? { label: b.slice(0, i).trim(), value: b.slice(i + 1).trim() }
        : { label: "Feature", value: b };
    });

  // Negative reviews are the truest source of customer pain points for A+ framing.
  const painPoints = (p.top_10_negative_reviews ?? [])
    .map((r) => r.trim())
    .filter(Boolean)
    .slice(0, 8);

  return {
    imageUrls,
    title: p.title ?? "",
    brand: p.brand ?? "",
    price: p.price ?? "",
    rating,
    attributes,
    painPoints,
    keywords: [],
    platform: p.platform ?? "amazon",
  };
}

/** Scrape a single product link into A+ form fields. Throws with an actionable message on failure. */
export async function scrapeProductForAplus(rawUrl: string): Promise<AplusScrapeResult> {
  const url = rawUrl.trim();
  if (!url) throw new Error("A product URL is required");

  const env = loadEcomEnv();
  const opts = scraperOptions(env);
  const platform = detectPlatform(url);

  // ── Amazon (also matches a bare 10-char ASIN) ──
  if (platform === "amazon") {
    let resolved = url;
    if (/amzn\./i.test(resolved)) {
      // Short links (amzn.to / a.co) must be followed to the real product URL first.
      try {
        const r = await fetch(resolved, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
        resolved = r.url || resolved;
      } catch {
        /* fall back to the original */
      }
    }
    const asin =
      extractAsinFromUrl(resolved) ?? (/^[A-Z0-9]{10}$/i.test(url) ? url.toUpperCase() : null);
    if (!asin) throw new Error("Could not find an ASIN in that Amazon link.");

    const rainforestKey = env.RAINFOREST_API_KEY ?? "";
    if (!rainforestKey && !opts.customScraperUrl) {
      throw new Error("RAINFOREST_API_KEY is not configured — Amazon scraping is unavailable.");
    }
    const amazonDomain = resolveAmazonMarket(url, resolved, defaultAmazonDomain(env));
    const product = await rainforestProduct(
      asin,
      rainforestKey,
      env.FIRECRAWL_API_KEY ?? "",
      amazonDomain,
      opts,
    );
    if (!product) throw new Error(`Failed to scrape Amazon product ${asin}.`);
    return mapProductData(product);
  }

  // ── Other supported marketplaces (Flipkart / Myntra / Nykaa / Croma) ──
  if (platform) {
    const productId = extractProductId(url, platform) ?? "";
    const product = await scrapeMarketplaceProduct(platform, url, productId, env.FIRECRAWL_API_KEY ?? "");
    if (!product) {
      throw new Error(
        `Couldn't scrape that ${platform} page — it may need FIRECRAWL_API_KEY set, or paste the image URLs manually.`,
      );
    }
    return mapProductData(product);
  }

  throw new Error(
    "Unsupported link. Auto-scrape supports Amazon, Flipkart, Myntra, Nykaa and Croma product pages — for other sites, use Upload photos or Image URLs.",
  );
}
