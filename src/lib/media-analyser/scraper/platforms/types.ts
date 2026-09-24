import type { CompetitorCandidate, ProductData } from '../services/ecomAgent/scraper';

export type PlatformId = 'amazon' | 'flipkart' | 'myntra' | 'nykaa' | 'croma';

export const MARKETPLACE_PLATFORMS: PlatformId[] = ['flipkart', 'myntra', 'nykaa', 'croma'];

export interface PlatformDefinition {
  id: PlatformId;
  label: string;
  hostPatterns: RegExp[];
  extractProductId(url: string): string | null;
  normalizeProductUrl(url: string, productId: string): string;
  buildSearchUrl(query: string): string;
  productExtractPrompt: string;
  searchExtractPrompt: string;
}

export interface SearchResultRow {
  productId: string;
  title?: string;
  url?: string;
  rating?: number;
  reviewCount?: number;
  price?: string;
}

export interface PlatformScrapeContext {
  firecrawlKey: string;
  platform: PlatformDefinition;
}

export type ProductMapper = (raw: Record<string, unknown>, productId: string, url: string) => ProductData;

export function mapFirecrawlToProduct(
  platform: PlatformId,
  productId: string,
  url: string,
  d: Record<string, unknown>,
): ProductData {
  const bullets = (d.bullets as string[]) ?? (d.highlights as string[]) ?? [];
  const thumbnails: Array<{ url: string; ocr_description: string }> = [];
  for (const img of ((d.product_images as string[]) ?? []).slice(0, 12)) {
    if (img) thumbnails.push({ url: String(img), ocr_description: String(d.title ?? productId).slice(0, 60) });
  }
  const a_plus: ProductData['a_plus'] = [];
  for (const mod of ((d.rich_content as Array<Record<string, unknown>>) ?? [])) {
    a_plus.push({
      type: String(mod.type ?? 'content'),
      visual_desc: String(mod.headline ?? 'Content'),
      text_content: String(mod.body ?? mod.headline ?? ''),
      image_url: mod.image_url ? String(mod.image_url) : undefined,
    });
    if (mod.image_url && thumbnails.length < 14) {
      thumbnails.push({ url: String(mod.image_url), ocr_description: String(mod.headline ?? 'Rich content') });
    }
  }
  const title = String(d.title ?? `Product ${productId}`);
  return {
    asin: productId,
    platform,
    title,
    brand: String(d.brand ?? ''),
    categories_flat: String(d.category ?? d.categories ?? 'General'),
    generic_category: String(d.category ?? ''),
    url,
    description: String(d.description ?? ''),
    bullets,
    rating: d.rating != null ? Number(d.rating) : null,
    ratings_total: d.review_count != null ? Number(d.review_count) : undefined,
    reviews_total: d.review_count != null ? Number(d.review_count) : undefined,
    price: String(d.price ?? 'N/A'),
    thumbnails,
    headline: title,
    winning_hook: bullets[0] ?? title.slice(0, 80),
    a_plus,
    top_10_positive_reviews: ((d.top_positive_reviews as string[]) ?? []).slice(0, 10),
    top_10_negative_reviews: ((d.top_negative_reviews as string[]) ?? []).slice(0, 10),
  };
}

export function searchRowsToCandidates(rows: SearchResultRow[]): CompetitorCandidate[] {
  return rows
    .filter((r) => r.productId)
    .map((r, i) => ({
      asin: r.productId,
      title: r.title,
      listingUrl: r.url,
      avgRating: r.rating,
      numRatings: r.reviewCount,
      price: r.price,
      rank: i,
    }));
}
