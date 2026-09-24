import type { PlatformDefinition, PlatformId } from './types';

const PRODUCT_PROMPT_BASE =
  'Extract data for THIS product listing only. Ignore sponsored items, ads, and "similar products" sections. ';

const SEARCH_PROMPT_BASE =
  'Extract organic product search results from this page. Return up to 15 distinct products with stable product IDs from URLs. ' +
  'Skip ads and duplicate listings. ';

const FLIPKART: PlatformDefinition = {
  id: 'flipkart',
  label: 'Flipkart',
  hostPatterns: [/flipkart\.com/i],
  extractProductId(url) {
    try {
      const u = new URL(url);
      const pid = u.searchParams.get('pid');
      if (pid) return pid;
      const m = u.pathname.match(/\/p\/([^/]+)/i);
      if (m) return m[1];
      const itm = u.pathname.match(/itm([a-z0-9]+)/i);
      if (itm) return itm[1];
    } catch { /* */ }
    return null;
  },
  normalizeProductUrl(url, productId) {
    if (url.includes('flipkart.com') && url.includes('/p/')) return url.split('?')[0];
    return `https://www.flipkart.com/search?pid=${encodeURIComponent(productId)}`;
  },
  buildSearchUrl(query) {
    return `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;
  },
  productExtractPrompt:
    PRODUCT_PROMPT_BASE +
    'Map Flipkart highlights/key features to bullets. Use review_count for total ratings count.',
  searchExtractPrompt:
    SEARCH_PROMPT_BASE + 'For Flipkart: product_id from pid= query param or product slug in /p/ URL.',
};

const MYNTRA: PlatformDefinition = {
  id: 'myntra',
  label: 'Myntra',
  hostPatterns: [/myntra\.com/i],
  extractProductId(url) {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/(\d+)\/buy\b/i) ?? u.pathname.match(/\/buy\/[^/]+\/(\d+)/i);
      if (m) return m[1];
      const style = u.pathname.match(/\/(\d{6,})\b/);
      if (style) return style[1];
    } catch { /* */ }
    return null;
  },
  normalizeProductUrl(url, productId) {
    if (url.startsWith('http') && /myntra\.com/i.test(url)) return url.split('?')[0];
    return `https://www.myntra.com/${productId}/buy`;
  },
  buildSearchUrl(query) {
    return `https://www.myntra.com/${encodeURIComponent(query.replace(/\s+/g, '-').toLowerCase())}`;
  },
  productExtractPrompt:
    PRODUCT_PROMPT_BASE +
    'Map Myntra product details and highlights to bullets. rich_content from description blocks if present.',
  searchExtractPrompt:
    SEARCH_PROMPT_BASE + 'For Myntra: product_id is the numeric style/product id in listing URLs.',
};

const NYKAA: PlatformDefinition = {
  id: 'nykaa',
  label: 'Nykaa',
  hostPatterns: [/nykaa\.com/i],
  extractProductId(url) {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/p\/(\d+)/i) ?? u.pathname.match(/\/p\/([^/?]+)/i);
      if (m) return m[1];
      const id = u.searchParams.get('productId') ?? u.searchParams.get('id');
      if (id) return id;
    } catch { /* */ }
    return null;
  },
  normalizeProductUrl(url, productId) {
    if (/nykaa\.com\/.*\/p\//i.test(url)) return url.split('?')[0];
    return `https://www.nykaa.com/p/${productId}`;
  },
  buildSearchUrl(query) {
    return `https://www.nykaa.com/search/result/?q=${encodeURIComponent(query)}`;
  },
  productExtractPrompt:
    PRODUCT_PROMPT_BASE +
    'Map Nykaa product description and key ingredients/features to bullets. Include beauty category when visible.',
  searchExtractPrompt:
    SEARCH_PROMPT_BASE + 'For Nykaa: product_id from /p/{id} path segment.',
};

const CROMA: PlatformDefinition = {
  id: 'croma',
  label: 'Croma',
  hostPatterns: [/croma\.com/i],
  extractProductId(url) {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/p\/([^/?]+)/i) ?? u.pathname.match(/\/([^/]+)\/p\b/i);
      if (m) return m[1];
      const sku = u.searchParams.get('sku') ?? u.searchParams.get('pid');
      if (sku) return sku;
    } catch { /* */ }
    return null;
  },
  normalizeProductUrl(url, productId) {
    if (/croma\.com.*\/p\//i.test(url)) return url.split('?')[0];
    return `https://www.croma.com/p/${productId}`;
  },
  buildSearchUrl(query) {
    return `https://www.croma.com/search?q=${encodeURIComponent(query)}`;
  },
  productExtractPrompt:
    PRODUCT_PROMPT_BASE +
    'Map Croma key features and specifications to bullets. Use electronics category when visible.',
  searchExtractPrompt:
    SEARCH_PROMPT_BASE + 'For Croma: product_id from product URL slug in /p/ path.',
};

const DEFS: Record<PlatformId, PlatformDefinition> = {
  amazon: {
    id: 'amazon',
    label: 'Amazon',
    hostPatterns: [/amazon\./i],
    extractProductId: () => null,
    normalizeProductUrl: (url) => url,
    buildSearchUrl: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
    productExtractPrompt: '',
    searchExtractPrompt: '',
  },
  flipkart: FLIPKART,
  myntra: MYNTRA,
  nykaa: NYKAA,
  croma: CROMA,
};

export function getPlatformDefinition(platform: PlatformId): PlatformDefinition {
  return DEFS[platform];
}

export function listMarketplaceDefinitions(): PlatformDefinition[] {
  return [FLIPKART, MYNTRA, NYKAA, CROMA];
}
