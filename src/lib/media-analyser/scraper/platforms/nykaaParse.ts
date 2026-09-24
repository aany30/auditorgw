import type { CompetitorCandidate } from '../services/ecomAgent/scraper';
import type { SearchResultRow } from './types';

/** Nykaa PDP/search URLs: …/slug/p/12345 or …/p/12345 */
const NYKAA_P_PATH = /(?:https?:\/\/(?:www\.)?nykaa\.com)?[^\s"'<>]*\/p\/(\d{4,})/gi;
const NYKAA_PRODUCT_ID_JSON = /"productId"\s*:\s*"?(\d{4,})"?/g;
const NYKAA_MD_LINK =
  /\[([^\]]{3,120})\]\((https?:\/\/(?:www\.)?nykaa\.com[^)\s]*\/p\/(\d{4,})[^)]*)\)/gi;

export function extractNykaaProductIds(text: string, max = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (id: string) => {
    const t = id.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  let m: RegExpExecArray | null;
  const pRe = new RegExp(NYKAA_P_PATH.source, 'gi');
  while ((m = pRe.exec(text)) !== null && out.length < max) add(m[1]);

  const jRe = new RegExp(NYKAA_PRODUCT_ID_JSON.source, 'g');
  while ((m = jRe.exec(text)) !== null && out.length < max) add(m[1]);

  return out;
}

export function parseNykaaSearchFromMarkdown(markdown: string, max = 15): SearchResultRow[] {
  const byId = new Map<string, SearchResultRow>();
  const linkRe = new RegExp(NYKAA_MD_LINK.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(markdown)) !== null && byId.size < max) {
    const title = m[1].trim();
    const url = m[2].split('?')[0];
    const productId = m[3];
    if (!byId.has(productId)) {
      byId.set(productId, { productId, title, url });
    }
  }

  for (const productId of extractNykaaProductIds(markdown, max)) {
    if (byId.has(productId)) continue;
    byId.set(productId, {
      productId,
      url: `https://www.nykaa.com/p/${productId}`,
    });
    if (byId.size >= max) break;
  }

  return [...byId.values()];
}

export function parseNykaaSimilarResults(json: Record<string, unknown> | null): SearchResultRow[] {
  const rows =
    (json?.similar_products as Array<Record<string, unknown>>) ??
    (json?.related_products as Array<Record<string, unknown>>) ??
    [];
  return rows
    .map((r) => ({
      productId: String(r.product_id ?? r.productId ?? '').trim(),
      title: r.title ? String(r.title) : undefined,
      url: r.url ? String(r.url) : undefined,
      rating: r.rating != null ? Number(r.rating) : undefined,
      reviewCount: r.review_count != null ? Number(r.review_count) : undefined,
      price: r.price ? String(r.price) : undefined,
    }))
    .filter((r) => /^\d{4,}$/.test(r.productId));
}

export function nykaaRowsToCandidates(rows: SearchResultRow[]): CompetitorCandidate[] {
  return rows.map((r, i) => ({
    asin: r.productId,
    title: r.title,
    listingUrl: r.url?.startsWith('http')
      ? r.url
      : r.productId
        ? `https://www.nykaa.com/p/${r.productId}`
        : undefined,
    avgRating: r.rating,
    numRatings: r.reviewCount,
    price: r.price,
    rank: i,
  }));
}
