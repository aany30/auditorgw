const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    brand: { type: 'string' },
    category: { type: 'string' },
    price: { type: 'string' },
    rating: { type: 'number' },
    review_count: { type: 'number' },
    description: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
    highlights: { type: 'array', items: { type: 'string' } },
    product_images: { type: 'array', items: { type: 'string' } },
    rich_content: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          headline: { type: 'string' },
          body: { type: 'string' },
          image_url: { type: 'string' },
        },
      },
    },
    top_positive_reviews: { type: 'array', items: { type: 'string' } },
    top_negative_reviews: { type: 'array', items: { type: 'string' } },
  },
};

const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          product_id: { type: 'string' },
          title: { type: 'string' },
          url: { type: 'string' },
          rating: { type: 'number' },
          review_count: { type: 'number' },
          price: { type: 'string' },
        },
      },
    },
  },
};

const SIMILAR_PRODUCTS_SCHEMA = {
  type: 'object',
  properties: {
    similar_products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          product_id: { type: 'string' },
          title: { type: 'string' },
          url: { type: 'string' },
          rating: { type: 'number' },
          review_count: { type: 'number' },
          price: { type: 'string' },
        },
      },
    },
  },
};

export interface FirecrawlScrapeOpts {
  timeoutMs?: number;
  waitFor?: number;
  mobile?: boolean;
  /** Request markdown alongside JSON (used for Nykaa search link parsing). */
  includeMarkdown?: boolean;
}

export interface FirecrawlResult {
  json: Record<string, unknown> | null;
  markdown?: string;
  status?: number;
  error?: string;
  creditsExhausted?: boolean;
}

export async function firecrawlScrapeJson(
  url: string,
  apiKey: string,
  prompt: string,
  schema: Record<string, unknown>,
  timeoutMsOrOpts: number | FirecrawlScrapeOpts = 90_000,
): Promise<FirecrawlResult> {
  const opts: FirecrawlScrapeOpts =
    typeof timeoutMsOrOpts === 'number' ? { timeoutMs: timeoutMsOrOpts } : timeoutMsOrOpts;
  const timeoutMs = opts.timeoutMs ?? 90_000;

  if (!apiKey) {
    return { json: null, error: 'FIRECRAWL_API_KEY is not set' };
  }
  const formats: string[] = opts.includeMarkdown ? ['json', 'markdown'] : ['json'];
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        url,
        formats,
        waitFor: opts.waitFor ?? 3000,
        mobile: opts.mobile ?? false,
        jsonOptions: { prompt, schema },
      }),
    });
    const body = (await res.json()) as {
      data?: { json?: Record<string, unknown>; markdown?: string };
      error?: string;
      success?: boolean;
    };
    if (!res.ok) {
      const errText = String(body.error ?? res.statusText);
      const creditsExhausted = res.status === 402 || /insufficient credits/i.test(errText);
      console.warn(`[Firecrawl] HTTP ${res.status} for ${url.slice(0, 80)}: ${errText.slice(0, 120)}`);
      return { json: null, status: res.status, error: errText, creditsExhausted };
    }
    const json = body.data?.json ?? null;
    const markdown = body.data?.markdown;
    if (!json && !markdown) {
      return { json: null, error: 'Firecrawl returned empty extraction' };
    }
    return { json, markdown };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[Firecrawl] Failed for ${url.slice(0, 80)}:`, msg);
    return { json: null, error: msg };
  }
}

const NYKAA_SIMILAR_PROMPT =
  'From this Nykaa product page, extract ONLY products listed in sections like "You may also like", ' +
  '"Similar products", "Customers also viewed", or "Frequently bought together". ' +
  'Return up to 12 items. product_id must be the numeric id from /p/{id} in each product URL.';

/** Scrape similar/related products from a Nykaa PDP (search fallback). */
export async function firecrawlNykaaSimilarProducts(
  productUrl: string,
  apiKey: string,
): Promise<FirecrawlResult> {
  return firecrawlScrapeJson(productUrl, apiKey, NYKAA_SIMILAR_PROMPT, SIMILAR_PRODUCTS_SCHEMA, {
    timeoutMs: 90_000,
    waitFor: 5000,
    mobile: true,
  });
}

export function productSchema(): Record<string, unknown> {
  return PRODUCT_SCHEMA;
}

export function searchSchema(): Record<string, unknown> {
  return SEARCH_SCHEMA;
}

export function parseSearchResults(json: Record<string, unknown> | null) {
  const rows = (json?.results as Array<Record<string, unknown>>) ?? [];
  return rows
    .map((r) => ({
      productId: String(r.product_id ?? r.productId ?? '').trim(),
      title: r.title ? String(r.title) : undefined,
      url: r.url ? String(r.url) : undefined,
      rating: r.rating != null ? Number(r.rating) : undefined,
      reviewCount: r.review_count != null ? Number(r.review_count) : undefined,
      price: r.price ? String(r.price) : undefined,
    }))
    .filter((r) => r.productId.length > 2);
}

/** @deprecated use firecrawlScrapeJson return value */
export async function firecrawlScrapeJsonLegacy(
  url: string,
  apiKey: string,
  prompt: string,
  schema: Record<string, unknown>,
  timeoutMs?: number,
): Promise<Record<string, unknown> | null> {
  const r = await firecrawlScrapeJson(url, apiKey, prompt, schema, timeoutMs);
  return r.json;
}
