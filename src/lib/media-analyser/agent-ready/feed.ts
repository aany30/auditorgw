/**
 * Feed adapters — map the canonical product to the formats agents consume.
 *
 * schema.org/Product is the stable, indexed-today target. The agent-commerce feed
 * specs (UCP, ACP, AP2) are still moving, so we emit a neutral draft envelope
 * behind an adapter shape rather than hard-coding to any one spec.
 */
import type { CanonicalProduct } from "./types";

function availabilityUrl(a: string): string | undefined {
  const s = a.toLowerCase();
  if (!s) return undefined;
  if (/out|sold|unavailable/.test(s)) return "https://schema.org/OutOfStock";
  if (/pre[- ]?order/.test(s)) return "https://schema.org/PreOrder";
  return "https://schema.org/InStock";
}

/** schema.org/Product JSON-LD — the markup a client drops onto a PDP. */
export function buildSchemaOrg(c: CanonicalProduct): Record<string, unknown> {
  const offers: Record<string, unknown> = {};
  if (c.price) offers.price = c.price.replace(/[^\d.]/g, "") || c.price;
  if (c.currency) offers.priceCurrency = c.currency;
  const avail = availabilityUrl(c.availability);
  if (avail) offers.availability = avail;
  if (c.sourceUrl) offers.url = c.sourceUrl;

  const out: Record<string, unknown> = {
    "@context": "https://schema.org/",
    "@type": "Product",
    name: c.title,
    ...(c.brand ? { brand: { "@type": "Brand", name: c.brand } } : {}),
    ...(c.description ? { description: c.description } : {}),
    ...(c.category ? { category: c.category } : {}),
    ...(c.images.length ? { image: c.images } : {}),
    ...(c.materials.length ? { material: c.materials.join(", ") } : {}),
    ...(c.colorway.length ? { color: c.colorway.join(", ") } : {}),
    ...(c.sizing.availableSizes.length ? { size: c.sizing.availableSizes } : {}),
    ...(c.audience.length ? { audience: c.audience.map(a => ({ "@type": "PeopleAudience", audienceType: a })) } : {}),
    ...(c.attributes.length ? {
      additionalProperty: c.attributes.map(a => ({ "@type": "PropertyValue", name: a.key, value: a.value })),
    } : {}),
    ...(Object.keys(offers).length ? { offers: { "@type": "Offer", ...offers } } : {}),
  };
  return out;
}

/** Neutral agent-commerce feed envelope (adapter for UCP / ACP / AP2). */
export function buildAgentFeed(c: CanonicalProduct): Record<string, unknown> {
  return {
    spec: "agent-ready/draft-v0",
    adapts: ["schema.org/Product", "UCP", "ACP", "AP2"],
    product: {
      id: c.sourceUrl || c.title,
      title: c.title,
      brand: c.brand,
      category: c.category,
      description: c.description,
      price: c.price ? { amount: c.price, currency: c.currency || undefined } : undefined,
      availability: c.availability || undefined,
      attributes: Object.fromEntries(c.attributes.map(a => [a.key, a.value])),
      materials: c.materials,
      colorway: c.colorway,
      sizing: c.sizing,
      media: c.images,
    },
    // The fields an agent matches an intent query against.
    query_hints: {
      use_cases: c.useCaseTags,
      audience: c.audience,
      styling_context: c.stylingContext,
    },
  };
}
