/**
 * UGC Ads -- lightweight single-product scrape.
 *
 * Given ONE product URL, fetch just that product's images + key details so the UGC
 * ad form can be pre-filled.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import type { ProductData } from "@/lib/media-analyser/scraper/services/ecomAgent/scraper";
import {
  extractAsinFromUrl,
  rainforestProduct,
  resolveAmazonMarket,
} from "@/lib/media-analyser/scraper/services/ecomAgent/scraper";
import {
  detectPlatform,
  extractProductId,
  resolveProductUrl,
} from "@/lib/media-analyser/scraper/platforms/index";
import { scrapeMarketplaceProduct } from "@/lib/media-analyser/scraper/platforms/scrape";
import { firecrawlScrapeJson, productSchema } from "@/lib/media-analyser/scraper/platforms/firecrawlClient";
import { fetchAdsFromAdLibraryUrl } from "@/lib/media-analyser/meta-social";

export const config = { maxDuration: 300 };

export interface UGCFetchProductResponse {
  title: string;
  brand: string;
  description: string;
  bullets: string[];
  price: string;
  imageUrls: string[];
}

/** Pull the product's own gallery + rich-content image URLs out of a ProductData. */
function imageUrlsFromProduct(p: ProductData): string[] {
  const urls = [
    ...p.thumbnails.map(t => t.url),
    ...p.a_plus.map(a => a.image_url).filter((u): u is string => Boolean(u)),
  ]
    .map(u => String(u).trim())
    .filter(u => /^https?:\/\//i.test(u));
  return Array.from(new Set(urls)).slice(0, 10);
}

/** Generic brand/unknown-site path: Firecrawl structured extraction -> minimal product fields. */
async function scrapeGeneric(url: string, firecrawlKey: string): Promise<UGCFetchProductResponse> {
  if (!firecrawlKey) {
    throw new Error("This URL isn't a supported marketplace and FIRECRAWL_API_KEY is not configured.");
  }
  const fc = await firecrawlScrapeJson(
    url,
    firecrawlKey,
    "Extract this product's details from the page (a brand or store product page). Capture the product title, brand name, current price with currency, bullets/key features, full description, and all product image URLs. Skip navigation, cart widgets and recommended products.",
    productSchema(),
    { timeoutMs: 90_000, waitFor: 3000 },
  );
  const d = fc.json;
  if (!d) {
    throw new Error(fc.creditsExhausted ? "Firecrawl credits exhausted." : (fc.error || "Could not extract product details from that URL."));
  }
  const bullets = ((d.bullets as string[]) ?? (d.highlights as string[]) ?? []).map(String).filter(Boolean);
  const imageUrls = [
    ...(((d.product_images as string[]) ?? []).map(String)),
    ...(((d.rich_content as Array<Record<string, unknown>>) ?? []).map(m => m.image_url).filter(Boolean).map(String)),
  ]
    .map(u => u.trim())
    .filter(u => /^https?:\/\//i.test(u));
  return {
    title: String(d.title ?? "").trim(),
    brand: String(d.brand ?? "").trim(),
    description: String(d.description ?? "").trim(),
    bullets,
    price: String(d.price ?? "").trim(),
    imageUrls: Array.from(new Set(imageUrls)).slice(0, 10),
  };
}

function toResponse(p: ProductData): UGCFetchProductResponse {
  return {
    title: (p.title ?? "").trim(),
    brand: (p.brand ?? "").trim(),
    description: (p.description ?? "").trim(),
    bullets: (p.bullets ?? []).map(String).filter(Boolean),
    price: (p.price ?? "").trim(),
    imageUrls: imageUrlsFromProduct(p),
  };
}

/**
 * Meta Ad Library path: scrape an advertiser's live ads and surface their creative
 * stills as the product images.
 */
async function scrapeMetaAds(url: string): Promise<UGCFetchProductResponse> {
  const { ads, label, error } = await fetchAdsFromAdLibraryUrl(url, 30);
  if (!ads.length) {
    throw new Error(error || "No ads found for that Meta Ad Library URL -- paste the full link (with view_all_page_id= or q=) or try manual upload.");
  }
  const imageUrls = Array.from(
    new Set(
      ads
        .flatMap(a => [a.imageUrl, a.thumbnailUrl])
        .map(u => (u ?? "").trim())
        .filter(u => /^https:\/\//i.test(u)),
    ),
  ).slice(0, 12);
  if (!imageUrls.length) {
    throw new Error("Those ads have no still images to use -- try a different Ad Library URL or manual upload.");
  }
  const first = ads[0];
  const brand = (first?.pageName || label || "").trim();
  const bullets = ads
    .map(a => (a.title || a.body || "").trim())
    .filter(Boolean)
    .slice(0, 6);
  return {
    title: (label || brand).trim(),
    brand,
    description: (first?.body ?? "").trim(),
    bullets,
    price: "",
    imageUrls,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = String(body.url ?? "").trim();

  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Paste a full product URL (starting with http/https)." });
  }

  const firecrawlKey = process.env.FIRECRAWL_API_KEY ?? "";
  const rainforestKey = process.env.RAINFOREST_API_KEY ?? "";

  try {
    const platform = detectPlatform(url);

    // -- Meta Ad Library / Facebook Page -> scrape the advertiser's ad creatives --
    if (/facebook\.com/i.test(url)) {
      return res.status(200).json(await scrapeMetaAds(url));
    }

    // -- Amazon --
    if (platform === "amazon") {
      let resolved = url;
      if (/amzn\./i.test(url)) {
        try {
          const resp = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
          resolved = resp.url || url;
        } catch { /* fall back to original */ }
      }
      const asin =
        extractAsinFromUrl(resolved) ??
        resolved.match(/[?&]asin=([A-Z0-9]{10})/i)?.[1]?.toUpperCase() ??
        null;
      if (!asin) {
        return res.status(400).json({ error: "Couldn't find an ASIN in that Amazon URL -- paste a full product page URL." });
      }
      const amazonDomain = resolveAmazonMarket(url, resolved, process.env.AMAZON_DOMAIN ?? "amazon.com");
      const product = await rainforestProduct(asin, rainforestKey, firecrawlKey, amazonDomain, { enrichReviews: false });
      if (!product) return res.status(502).json({ error: "Could not fetch that Amazon product. Check the URL or try manual upload." });
      return res.status(200).json(toResponse(product));
    }

    // -- Supported marketplaces (flipkart / myntra / nykaa / croma) --
    if (platform) {
      const resolved = await resolveProductUrl(url, platform);
      const productId = extractProductId(resolved, platform);
      if (!productId) {
        return res.status(400).json({ error: `Couldn't read a product ID from that ${platform} URL.` });
      }
      const product = await scrapeMarketplaceProduct(platform, resolved, productId, firecrawlKey);
      if (!product) return res.status(502).json({ error: `Could not fetch that ${platform} product. Try manual upload.` });
      return res.status(200).json(toResponse(product));
    }

    // -- Unknown / brand site -> Firecrawl generic extraction --
    return res.status(200).json(await scrapeGeneric(url, firecrawlKey));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ugc-fetch-product] failed for ${url.slice(0, 80)}: ${msg}`);
    return res.status(502).json({ error: `Could not fetch that product: ${msg}` });
  }
}
