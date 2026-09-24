/**
 * Direct HTML fetch + embedded JSON parsing when Firecrawl is unavailable or out of credits.
 */
import type { CompetitorCandidate, ProductData } from '../services/ecomAgent/scraper';
import { getPlatformDefinition } from './definitions';
import type { PlatformId } from './types';
import { mapFirecrawlToProduct } from './types';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function fetchPageHtml(url: string, timeoutMs = 25_000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-IN,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.warn(`[HtmlFallback] HTTP ${res.status} for ${url.slice(0, 80)}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.warn(`[HtmlFallback] Fetch failed for ${url.slice(0, 80)}:`, e);
    return null;
  }
}

function extractJsonAfterMarker(html: string, marker: string): Record<string, unknown> | null {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const start = html.indexOf('{', idx + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function metaContent(html: string, prop: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const m = html.match(re);
  return m?.[1]?.trim() ?? '';
}

function parseMyntraPdp(html: string, productId: string, url: string): ProductData | null {
  const root = extractJsonAfterMarker(html, 'window.__myx = ');
  const pdp = (root?.pdpData ?? root) as Record<string, unknown> | undefined;
  if (!pdp || !pdp.name) return null;

  const brandObj = pdp.brand as Record<string, unknown> | undefined;
  const ratings = pdp.ratings as Record<string, unknown> | undefined;
  const reviewInfo = ratings?.reviewInfo as Record<string, unknown> | undefined;
  const media = pdp.media as Record<string, unknown> | undefined;
  const albums = (media?.albums as Array<Record<string, unknown>>) ?? [];
  const images = (albums[0]?.images as Array<Record<string, unknown>>) ?? [];
  const bullets: string[] = [];
  const descriptors = (pdp.descriptors as Array<Record<string, unknown>>) ?? [];
  for (const d of descriptors) {
    const desc = String(d.description ?? d.value ?? '').trim();
    if (desc) bullets.push(desc.slice(0, 200));
  }
  const mrp = Number(pdp.mrp ?? 0);
  const price = Number(pdp.price ?? mrp ?? 0);
  const thumbnails = images
    .map((img) => String(img.src ?? img.imageURL ?? ''))
    .filter(Boolean)
    .slice(0, 10)
    .map((u) => ({ url: u, ocr_description: String(pdp.name).slice(0, 60) }));

  const avgRating = Number(
    ratings?.averageRating ?? ratings?.average ?? pdp.rating ?? 0,
  );
  const totalCount = Number(
    ratings?.totalCount ?? ratings?.ratingsCount ?? reviewInfo?.reviewsCount ?? 0,
  );
  const topReviews = (reviewInfo?.topReviews as Array<Record<string, unknown>>) ?? [];
  const positive = topReviews
    .filter((r) => Number(r.userRating ?? 0) >= 4)
    .map((r) => String(r.reviewText ?? '').trim())
    .filter(Boolean)
    .slice(0, 10);
  const negative = topReviews
    .filter((r) => Number(r.userRating ?? 0) <= 2)
    .map((r) => String(r.reviewText ?? '').trim())
    .filter(Boolean)
    .slice(0, 10);

  return {
    asin: String(pdp.id ?? productId),
    platform: 'myntra',
    title: String(pdp.name),
    brand: String(brandObj?.name ?? pdp.brandName ?? ''),
    categories_flat: String((pdp.articleType as Record<string, unknown>)?.typeName ?? pdp.baseColour ?? 'Fashion'),
    generic_category: String((pdp.articleType as Record<string, unknown>)?.typeName ?? ''),
    url,
    description: bullets.join(' ').slice(0, 500),
    bullets: bullets.length ? bullets : [String(pdp.name).slice(0, 120)],
    rating: avgRating > 0 ? avgRating : null,
    ratings_total: totalCount > 0 ? totalCount : undefined,
    reviews_total: totalCount > 0 ? totalCount : undefined,
    price: price > 0 ? `₹${price}` : mrp > 0 ? `₹${mrp}` : 'N/A',
    thumbnails,
    headline: String(pdp.name),
    winning_hook: bullets[0] ?? String(pdp.name).slice(0, 80),
    a_plus: [],
    top_10_positive_reviews: positive,
    top_10_negative_reviews: negative,
    reviews_fetched_count: positive.length + negative.length,
  };
}

function parseMyntraSearchProductBlocks(html: string, max: number): CompetitorCandidate[] {
  const seen = new Set<string>();
  const out: CompetitorCandidate[] = [];
  const idRe = /"productId"\s*:\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(html)) !== null && out.length < max * 2) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const chunk = html.slice(m.index, m.index + 2500);
    const title = chunk.match(/"productName"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1]?.replace(/\\u002F/g, '/');
    const rating = Number(chunk.match(/"rating"\s*:\s*([\d.]+)/)?.[1] ?? 0);
    const ratingCount = Number(chunk.match(/"ratingCount"\s*:\s*(\d+)/)?.[1] ?? 0);
    const path = chunk.match(/"landingPageUrl"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1]?.replace(/\\u002F/g, '/');
    const brand = chunk.match(/"brand"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1];
    const discount = chunk.match(/"discount"\s*:\s*(\d+)/)?.[1];
    const listingUrl = path
      ? path.startsWith('http')
        ? path.split('?')[0]
        : `https://www.myntra.com/${path.split('?')[0]}`
      : undefined;
    out.push({
      asin: id,
      title: title ? title.replace(/\\u0026/g, '&') : undefined,
      listingUrl,
      avgRating: rating > 0 ? rating : undefined,
      numRatings: ratingCount > 0 ? ratingCount : undefined,
      price: discount ? `₹${discount}` : undefined,
      rank: out.length,
    });
  }
  return out;
}

function parseFlipkartPdp(html: string, productId: string, url: string): ProductData | null {
  // Title: from <title> tag, strip "Price in India - Buy…" tail
  const rawTitle =
    html.match(/<title>([^<]+)<\/title>/)?.[1]?.trim() ??
    html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1]?.trim() ?? '';
  const title = rawTitle
    .replace(/\s*Price in India[^]*$/i, '')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;/g, '')
    .trim();
  if (!title || title.length < 5) return null;

  // From embedded JSON (window.__INITIAL_STATE__ fragment):
  //   "rating":4.2,"ratingsCount":67357,"reviewsCount":2504
  const ratingBlock = html.match(
    /"rating"\s*:([\d.]+)\s*,\s*"ratingsCount"\s*:\s*(\d+)\s*,\s*"reviewsCount"\s*:\s*(\d+)/,
  );
  const rating = ratingBlock ? parseFloat(ratingBlock[1]) : null;
  const ratingsTotal = ratingBlock ? parseInt(ratingBlock[2], 10) : undefined;
  const reviewsTotal = ratingBlock ? parseInt(ratingBlock[3], 10) : undefined;

  // Brand: "bd":"Minimalist"
  const brand = html.match(/"bd"\s*:\s*"([^"]+)"/)?.[1] ?? '';

  // Price: "finalPrice":224
  const priceNum =
    html.match(/"finalPrice"\s*:\s*(\d+)/)?.[1] ??
    html.match(/"discountedPrice"\s*:\s*(\d+)/)?.[1];
  const price = priceNum ? `₹${priceNum}` : 'N/A';

  // Images count hint: "imagesCount":3
  const imagesCount = parseInt(html.match(/"imagesCount"\s*:\s*(\d+)/)?.[1] ?? '0', 10);

  // Product images from <img> or <source> tags (exclude /www/ promo images)
  const seenImgs = new Set<string>();
  const imgMatches = [
    ...(html.matchAll(
      /(?:src|href)="(https?:\/\/rukminim\d\.flixcart\.com\/image\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi,
    )),
  ]
    .map((m) => m[1])
    .filter((u) => !u.includes('/www/') && !u.includes('{@'))
    .filter((u) => {
      const key = u.replace(/\?.*/, '');
      if (seenImgs.has(key)) return false;
      seenImgs.add(key);
      return true;
    });
  const thumbnails = imgMatches
    .slice(0, imagesCount > 0 ? imagesCount : 8)
    .map((u) => ({ url: u, ocr_description: title.slice(0, 60) }));

  // Description from embedded JSON
  const description =
    html
      .match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
      ?.replace(/\\u0026/g, '&')
      .replace(/\\u003c/g, '<')
      .replace(/\\u003e/g, '>')
      .replace(/\\n/g, ' ')
      .trim()
      .slice(0, 500) ?? '';

  const bullets = description
    ? [description.slice(0, 200)]
    : [title.slice(0, 120)];

  console.log(
    `[HtmlFallback] Flipkart PDP parsed: "${title.slice(0, 50)}" | ₹${priceNum ?? '?'} | ★${rating ?? '?'} | ${ratingsTotal ?? 0} ratings | ${reviewsTotal ?? 0} reviews | ${thumbnails.length} images`,
  );

  return {
    asin: productId,
    platform: 'flipkart',
    title,
    brand,
    categories_flat: '',
    generic_category: '',
    url,
    description: description.slice(0, 500),
    bullets,
    rating: rating && rating > 0 ? rating : null,
    ratings_total: ratingsTotal,
    reviews_total: reviewsTotal,
    price,
    thumbnails,
    headline: title,
    winning_hook: description ? description.slice(0, 80) : title.slice(0, 80),
    a_plus: [],
    top_10_positive_reviews: [],
    top_10_negative_reviews: [],
    reviews_fetched_count: 0,
  };
}

function parseNykaaPdp(html: string, productId: string, url: string): ProductData | null {
  // Title from og:title (most reliable)
  const rawTitle =
    metaContent(html, 'og:title') || metaContent(html, 'twitter:title');
  const title = rawTitle.replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim();
  if (!title || title.length < 5) return null;

  // From Nykaa's __PRELOADED_STATE__ / inline JSON:
  //   "offerPrice":224,"brandName":"Minimalist","rating":4.4
  const price =
    html.match(/"offerPrice"\s*:\s*(\d+)/)?.[1] ??
    metaContent(html, 'product:price:amount');

  const brand =
    html.match(/"brandName"\s*:\s*"([^"]+)"/)?.[1] ??
    metaContent(html, 'product:brand') ??
    metaContent(html, 'og:brand') ?? '';

  // Rating: "rating":4.4  (surrounded by price/sku context — not inside a nested object)
  const ratingRaw = html.match(/"offerPrice":[^}]{0,200}"rating"\s*:\s*([\d.]+)/)?.[1]
    ?? html.match(/"rating"\s*:([\d.]+),"productType"/)?.[1]
    ?? html.match(/"rating"\s*:([\d.]+)/)?.[1];
  const rating = ratingRaw ? parseFloat(ratingRaw) : null;

  // Ratings / Reviews count from visible HTML: "66350<!-- --> ratings" "3663<!-- --> reviews"
  const ratingsTotal =
    parseInt(html.match(/(\d[\d,]+)<!--\s*-->\s*ratings/i)?.[1]?.replace(/,/g, '') ?? '0', 10) ||
    undefined;
  const reviewsTotal =
    parseInt(html.match(/(\d[\d,]+)<!--\s*-->\s*reviews/i)?.[1]?.replace(/,/g, '') ?? '0', 10) ||
    undefined;

  // Images: deduplicated high-res images from images-static.nykaa.com
  const seenImgs = new Set<string>();
  const imgMatches = [
    ...html.matchAll(
      /["'](https:\/\/images-static\.nykaa\.com\/[^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)/gi,
    ),
  ]
    .map((m) => m[1])
    .filter((u) => {
      const k = u.replace(/\?.*/, '');
      if (seenImgs.has(k)) return false;
      seenImgs.add(k);
      return true;
    });
  const thumbnails = imgMatches
    .slice(0, 10)
    .map((u) => ({ url: u, ocr_description: title.slice(0, 60) }));

  // Description / bullets
  const description =
    metaContent(html, 'og:description')
      .replace(/&amp;/g, '&')
      .trim()
      .slice(0, 500) || '';

  console.log(
    `[HtmlFallback] Nykaa PDP parsed: "${title.slice(0, 50)}" | ₹${price ?? '?'} | ★${rating ?? '?'} | ${ratingsTotal ?? 0} ratings | ${reviewsTotal ?? 0} reviews | ${thumbnails.length} images`,
  );

  return {
    asin: productId,
    platform: 'nykaa',
    title,
    brand,
    categories_flat: '',
    generic_category: '',
    url,
    description,
    bullets: description ? [description.slice(0, 200)] : [title.slice(0, 120)],
    rating: rating && rating > 0 ? rating : null,
    ratings_total: ratingsTotal,
    reviews_total: reviewsTotal,
    price: price ? `₹${price}` : 'N/A',
    thumbnails,
    headline: title,
    winning_hook: description ? description.slice(0, 80) : title.slice(0, 80),
    a_plus: [],
    top_10_positive_reviews: [],
    top_10_negative_reviews: [],
    reviews_fetched_count: 0,
  };
}

function parseCromaPdp(html: string, productId: string, url: string): ProductData | null {
  // ── Title: JSON-LD "name" first (most accurate), then og:title ──────────
  const ldStart = html.indexOf('<script type="application/ld+json">');
  const ldEnd = ldStart > 0 ? html.indexOf('</script>', ldStart) : -1;
  const ldRaw =
    ldStart > 0 && ldEnd > ldStart
      ? html.slice(ldStart + 36, ldEnd).replace(/[\x00-\x1F\x7F]/g, ' ')
      : '';

  const ldTitle = ldRaw.match(/"@type"\s*:\s*"Product"[^}]{0,1000}"name"\s*:\s*"([^"]+)"/s)?.[1];
  const ogTitle = metaContent(html, 'og:title').replace(/^Buy\s+/i, '').replace(/\s*-\s*Croma.*$/i, '');
  const title = (ldTitle ?? ogTitle).replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim();
  if (!title || title.length < 5) return null;

  // ── From __INITIAL_DATA__ (full tail — Croma's state is large) ───────────
  const initIdx = html.indexOf('__INITIAL_DATA__');
  const raw = initIdx > 0 ? html.slice(initIdx) : html;

  // Extract categoryL2 code for later category-based competitor search
  const categoryL2 = raw.match(/"categoryL2"\s*:\s*"(\d+)"/)?.[1] ?? '';

  // Price: "price":"20234" — sometimes present, sometimes dynamically loaded
  const priceNum =
    raw.match(/"price"\s*:\s*"(\d{3,6})"/)?.[1] ??
    raw.match(/"sellingPrice"\s*:\s*"?(\d{3,6})/)?.[1] ??
    raw.match(/"discountedPrice"\s*:\s*"?(\d{3,6})/)?.[1];
  const price = priceNum ? `₹${priceNum}` : 'N/A';

  // Brand: from Croma's SAP classifications block
  const brand =
    raw.match(
      /SG-ManufacturerDetails-Brand[^}]{0,600}"featureValues"\s*:\s*\[\s*\{"value"\s*:\s*"([^"]+)"/,
    )?.[1] ??
    raw.match(/"brand"\s*:\s*"([A-Za-z][^"]{1,40})"/)?.[1] ??
    metaContent(html, 'product:brand') ?? '';

  // Rating: "averageRating":4  (integer or float)
  const ratingRaw =
    raw.match(/"averageRating"\s*:\s*([\d.]+)/)?.[1] ??
    raw.match(/"finalReviewRating"\s*:\s*([\d.]+)/)?.[1];
  const rating = ratingRaw ? parseFloat(ratingRaw) : null;

  // Ratings / Reviews count
  const ratingsTotal =
    parseInt(raw.match(/"numberOfRatings"\s*:\s*(\d+)/)?.[1] ?? '0', 10) || undefined;
  const reviewsTotal =
    parseInt(raw.match(/"numberOfReviews"\s*:\s*(\d+)/)?.[1] ?? '0', 10) || undefined;

  // ── Images: JSON-LD image array (media.tatacroma.com) ───────────────────
  const seenImgs = new Set<string>();
  const imgMatches = [
    ...ldRaw.matchAll(/"(https:\/\/media\.tatacroma\.com[^"]+\.(?:jpe?g|png|webp)[^"]*)"/g),
  ]
    .map((m) => m[1])
    .filter((u) => {
      const k = u.replace(/\?.*/, '');
      if (seenImgs.has(k)) return false;
      seenImgs.add(k);
      return true;
    });
  const ogImage = metaContent(html, 'og:image');
  if (!imgMatches.length && ogImage) imgMatches.push(ogImage);
  const thumbnails = imgMatches
    .slice(0, 12)
    .map((u) => ({ url: u, ocr_description: title.slice(0, 60) }));

  // ── Description: JSON-LD or og:description ───────────────────────────────
  const ldDesc =
    ldRaw.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
      .replace(/\\n/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() ?? '';
  const description =
    (ldDesc.length > 50 ? ldDesc : metaContent(html, 'og:description').replace(/&amp;/g, '&'))
      .trim()
      .slice(0, 500);

  console.log(
    `[HtmlFallback] Croma PDP parsed: "${title.slice(0, 50)}" | ₹${priceNum ?? '?'} | ★${rating ?? '?'} | ${ratingsTotal ?? 0} ratings | ${thumbnails.length} images`,
  );

  return {
    asin: productId,
    platform: 'croma',
    title,
    brand,
    categories_flat: '',
    generic_category: categoryL2 ? `croma-cat:${categoryL2}` : '',
    url,
    description,
    bullets: description ? [description.slice(0, 200)] : [title.slice(0, 120)],
    rating: rating && rating > 0 ? rating : null,
    ratings_total: ratingsTotal,
    reviews_total: reviewsTotal,
    price,
    thumbnails,
    headline: title,
    winning_hook: description ? description.slice(0, 80) : title.slice(0, 80),
    a_plus: [],
    top_10_positive_reviews: [],
    top_10_negative_reviews: [],
    reviews_fetched_count: 0,
  };
}

function parseGenericMeta(html: string, platform: PlatformId, productId: string, url: string): ProductData | null {
  const title = metaContent(html, 'og:title') || metaContent(html, 'twitter:title');
  if (!title) return null;
  const price = metaContent(html, 'product:price:amount') || metaContent(html, 'og:price:amount');
  const image = metaContent(html, 'og:image');
  const brand = metaContent(html, 'og:brand') || metaContent(html, 'product:brand');
  return mapFirecrawlToProduct(platform, productId, url, {
    title,
    brand,
    price: price ? `₹${price}` : 'N/A',
    bullets: [title.slice(0, 120)],
    product_images: image ? [image] : [],
  });
}

export async function scrapeProductHtmlFallback(
  platform: PlatformId,
  productUrl: string,
  productId: string,
): Promise<ProductData | null> {
  const def = getPlatformDefinition(platform);
  const url = productUrl.startsWith('http')
    ? productUrl.split('?')[0]
    : def.normalizeProductUrl(productUrl, productId);

  const html = await fetchPageHtml(url);
  if (!html) return null;

  if (platform === 'myntra') {
    const p = parseMyntraPdp(html, productId, url);
    if (p) {
      console.log(`[HtmlFallback] Myntra PDP parsed: ${p.title.slice(0, 60)}`);
      return p;
    }
  }

  if (platform === 'flipkart') {
    const p = parseFlipkartPdp(html, productId, url);
    if (p) return p;
  }

  if (platform === 'nykaa') {
    const p = parseNykaaPdp(html, productId, url);
    if (p) return p;
  }

  if (platform === 'croma') {
    const p = parseCromaPdp(html, productId, url);
    if (p) return p;
  }

  const generic = parseGenericMeta(html, platform, productId, url);
  if (generic) {
    console.log(`[HtmlFallback] ${platform} meta tags: ${generic.title.slice(0, 60)}`);
    return generic;
  }
  return null;
}

export async function searchMyntraHtmlFallback(
  query: string,
  max = 15,
): Promise<CompetitorCandidate[]> {
  const slug = query.replace(/\s+/g, '-').toLowerCase().slice(0, 40);
  const searchUrl = `https://www.myntra.com/${slug}?rawQuery=${encodeURIComponent(query)}`;
  const html = await fetchPageHtml(searchUrl);
  if (!html) return [];

  const candidates = parseMyntraSearchProductBlocks(html, max);
  console.log(
    `[HtmlFallback] Myntra search "${query}" => ${candidates.length} products (with ratings where available)`,
  );
  return candidates;
}

// ---------------------------------------------------------------------------
// Flipkart HTML search fallback
// ---------------------------------------------------------------------------

function parseFlipkartSearchProductBlocks(html: string, max: number): CompetitorCandidate[] {
  const seen = new Set<string>();
  const out: CompetitorCandidate[] = [];

  // Collect positions of all product anchors: href="/slug/p/itmXXX?..."
  const hrefRe = /href="(\/[^"]+\/p\/(itm[a-z0-9]+))[^"]*"/gi;
  const positions: Array<{ itm: string; slug: string; pos: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const itm = m[2];
    const slug = m[1].split('?')[0];
    if (!seen.has(itm)) {
      seen.add(itm);
      positions.push({ itm, slug, pos: m.index });
    }
  }

  for (let i = 0; i < positions.length && out.length < max; i++) {
    const { itm, slug, pos } = positions[i];
    // Card spans from this anchor to the next, capped at 4 KB
    const end = positions[i + 1]?.pos ?? pos + 4096;
    const card = html.slice(pos, Math.min(end, pos + 4096));

    // Title from alt="..." on the product image
    const title = card.match(/alt="([^"]{5,150})"/)?.[1]?.trim();
    if (!title) continue; // skip cards without a visible title

    const url = `https://www.flipkart.com${slug}`;

    // Price: class="hZ3P6w">₹336 (Flipkart search card price inner div)
    const priceRaw = card.match(/class="hZ3P6w"[^>]*>(₹[\d,]+)/)?.[1];
    const price = priceRaw ?? undefined;

    // Rating: class="MKiFS6">4.4 (the star-badge div)
    const ratingRaw = card.match(/class="MKiFS6"[^>]*>([\d.]+)/)?.[1];
    const avgRating = ratingRaw ? parseFloat(ratingRaw) : undefined;

    // Rating count: class="PvbNMB">(1,20,398)  — Flipkart uses Indian comma format
    const ratingCountRaw = card.match(/class="PvbNMB"[^>]*>\(?([0-9,]+)\)?/)?.[1]
      ?? card.match(/([\d,]+)\s+Ratings/)?.[1];
    const numRatings = ratingCountRaw
      ? parseInt(ratingCountRaw.replace(/,/g, ''), 10)
      : undefined;

    out.push({
      asin: itm,
      title,
      listingUrl: url,
      avgRating: avgRating && avgRating > 0 ? avgRating : undefined,
      numRatings: numRatings && numRatings > 0 ? numRatings : undefined,
      price: price ?? undefined,
      rank: out.length,
    });
  }

  return out;
}

export async function searchFlipkartHtmlFallback(
  query: string,
  max = 15,
): Promise<CompetitorCandidate[]> {
  const searchUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}&sort=relevance`;
  const html = await fetchPageHtml(searchUrl);
  if (!html) return [];

  const candidates = parseFlipkartSearchProductBlocks(html, max);
  console.log(
    `[HtmlFallback] Flipkart search "${query}" => ${candidates.length} products`,
  );
  return candidates;
}

// ---------------------------------------------------------------------------
// Nykaa HTML search fallback
// ---------------------------------------------------------------------------

function parseNykaaSearchProductBlocks(html: string, max: number): CompetitorCandidate[] {
  const seen = new Set<string>();
  const out: CompetitorCandidate[] = [];

  // Each product link: <a href="/some-slug/p/PRODUCTID"...><img alt="Product Name"...>
  // Also inline price: ₹\d+ appearing near each product block
  const anchorRe = /<a[^>]+href="([^"]*\/p\/(\d+)[^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null && out.length < max) {
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);

    const pos = m.index;
    // Look ahead ~2KB for alt text and price
    const chunk = html.slice(pos, Math.min(html.length, pos + 2048));

    // Product name: first alt="..." that looks like a product title
    const altMatch = chunk.match(/alt="([^"]{10,120})"/)?.[1]
      ?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

    // Price: first ₹ amount in the block
    const priceMatch = chunk.match(/₹([\d,]+)/)?.[1]?.replace(/,/g, '');
    const priceNum = priceMatch ? parseInt(priceMatch, 10) : undefined;

    const listingUrl = m[1].startsWith('http') ? m[1] : `https://www.nykaa.com${m[1]}`;

    out.push({
      asin: id,
      title: altMatch ?? undefined,
      listingUrl,
      avgRating: undefined, // rating not easily available on search page
      numRatings: undefined,
      price: priceNum ? `₹${priceNum}` : undefined,
      rank: out.length,
    });
  }

  return out;
}

export async function searchNykaaHtmlFallback(
  query: string,
  max = 15,
): Promise<CompetitorCandidate[]> {
  const searchUrl = `https://www.nykaa.com/search/result/?q=${encodeURIComponent(query)}`;
  const html = await fetchPageHtml(searchUrl);
  if (!html) return [];

  const candidates = parseNykaaSearchProductBlocks(html, max);
  console.log(
    `[HtmlFallback] Nykaa search "${query}" => ${candidates.length} products`,
  );
  return candidates;
}

// ---------------------------------------------------------------------------
// Croma HTML search fallback
// ---------------------------------------------------------------------------

function parseCromaSearchProductBlocks(html: string, max: number): CompetitorCandidate[] {
  const seen = new Set<string>();
  const out: CompetitorCandidate[] = [];

  // Croma product links: /product-name/p/PRODUCTID
  const anchorRe = /<a[^>]+href="(\/[^"]*\/p\/(\d+)[^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null && out.length < max) {
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);

    const pos = m.index;
    const chunk = html.slice(pos, Math.min(html.length, pos + 2048));

    // Product name from alt or aria-label
    const title = chunk.match(/alt="([^"]{10,120})"/)?.[1]?.trim()
      ?? chunk.match(/aria-label="([^"]{10,120})"/)?.[1]?.trim();

    const listingUrl = `https://www.croma.com${m[1].split('?')[0]}`;

    out.push({
      asin: id,
      title: title ?? undefined,
      listingUrl,
      avgRating: undefined,
      numRatings: undefined,
      price: undefined,
      rank: out.length,
    });
  }

  return out;
}

export async function searchCromaHtmlFallback(
  query: string,
  max = 15,
): Promise<CompetitorCandidate[]> {
  const searchUrl = `https://www.croma.com/search?q=${encodeURIComponent(query)}`;
  const html = await fetchPageHtml(searchUrl);
  if (!html) return [];

  const candidates = parseCromaSearchProductBlocks(html, max);
  console.log(
    `[HtmlFallback] Croma search "${query}" => ${candidates.length} products`,
  );
  return candidates;
}

/**
 * Croma category page search — fetches the category PLP which has products
 * embedded in __INITIAL_DATA__.plpReducer.plpData.products (server-side rendered).
 * This is the only reliable way to get Croma product listings without a headless browser.
 */
export async function searchCromaCategoryFallback(
  categoryL2: string,
  excludeProductId: string,
  max = 20,
): Promise<CompetitorCandidate[]> {
  const catUrl = `https://www.croma.com/products/c/${categoryL2}`;
  const html = await fetchPageHtml(catUrl, 20_000);
  if (!html) return [];

  // Find and parse products array from __INITIAL_DATA__.plpReducer.plpData.products
  const plpStart = html.indexOf('"plpReducer"');
  if (plpStart === -1) return [];

  const productsIdx = html.indexOf('"products":[', plpStart);
  if (productsIdx === -1) return [];

  const arrStart = productsIdx + 11;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let i = arrStart;
  while (i < Math.min(html.length, arrStart + 200_000)) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === '[') {
      depth++;
    } else if (c === ']') {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }

  let products: Array<{
    code: string;
    name: string;
    manufacturer?: string;
    finalReviewRating?: number;
    averageRating?: number;
    finalReviewRatingCount?: number;
    numberOfRatings?: number;
    numberOfReviews?: number;
    mrp?: { formattedValue?: string; value?: number };
    price?: { formattedValue?: string; value?: number };
    plpImage?: string;
    url?: string;
  }> = [];

  try {
    products = JSON.parse(html.slice(arrStart, i + 1));
  } catch {
    return [];
  }

  const candidates: CompetitorCandidate[] = [];
  for (const p of products) {
    if (!p.code || p.code === excludeProductId) continue;
    const rating = p.finalReviewRating || p.averageRating || undefined;
    const numRatings = p.numberOfRatings || p.finalReviewRatingCount || undefined;
    const priceVal = p.price?.value || p.mrp?.value;
    const listingUrl = p.url
      ? `https://www.croma.com${p.url}`
      : `https://www.croma.com/electronics/p/${p.code}`;
    candidates.push({
      asin: p.code,
      title: p.name ?? undefined,
      listingUrl,
      avgRating: rating && rating > 0 ? rating : undefined,
      numRatings,
      price: priceVal ? `₹${priceVal}` : undefined,
      rank: candidates.length,
    });
    if (candidates.length >= max) break;
  }

  console.log(
    `[HtmlFallback] Croma category c/${categoryL2} => ${candidates.length} products`,
  );
  return candidates;
}

export async function searchMarketplaceHtmlFallback(
  platform: PlatformId,
  query: string,
  max = 15,
): Promise<CompetitorCandidate[]> {
  if (platform === 'myntra') return searchMyntraHtmlFallback(query, max);
  if (platform === 'flipkart') return searchFlipkartHtmlFallback(query, max);
  if (platform === 'nykaa') return searchNykaaHtmlFallback(query, max);
  if (platform === 'croma') return searchCromaHtmlFallback(query, max);
  return [];
}
