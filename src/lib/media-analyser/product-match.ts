import type { CombinedScraperData, ProductContext } from "./types";

export function extractTargetProduct(payload: CombinedScraperData): Record<string, unknown> {
  const products = payload.ecom?.products ?? [];
  if (!products.length) return {};
  const p = products[0] as Record<string, unknown>;
  return p;
}

export function productContextFromPayload(productUrl: string, payload: CombinedScraperData): ProductContext {
  const p = extractTargetProduct(payload);
  return {
    product_url: productUrl.trim(),
    title: String(p.title ?? p.name ?? ""),
    brand: String(p.brand ?? ""),
    category: String(p.category ?? (p as Record<string, unknown>).categories_flat ?? ""),
    bullets: Array.isArray(p.bullets) ? (p.bullets as string[]) : [],
    asin_or_id: String(p.asin ?? ""),
  };
}
