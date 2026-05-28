/**
 * Funnel benchmark sources for the Funnel Audit tab.
 * Three sources: hardcoded Meta defaults, AI-generated industry-specific, and user's past snapshots.
 */

export type FunnelBenchmarkSource = "meta" | "industry" | "past";

/** Benchmark values keyed by funnel-stage name. Values are percentages (0-100). */
export type BenchmarkValues = Record<string, number>;

export interface BenchmarkSnapshot {
  /** Stable ID for selection / persistence. */
  id: string;
  /** Display name (e.g. "Meta Ecom Benchmarks", "DTC apparel — Jul 2026"). */
  label: string;
  source: FunnelBenchmarkSource;
  /** When this snapshot was generated/captured. */
  fetchedAt: string;
  values: BenchmarkValues;
  /** Industry name when source === "industry". */
  industry?: string;
  /** Optional notes the user added. */
  notes?: string;
}

/**
 * Meta's published e-commerce funnel benchmarks (Meta Industry Reports + Shopify
 * Benchmarks 2024). These are conservative, well-known industry medians.
 */
export const META_BENCHMARKS: BenchmarkSnapshot = {
  id: "meta-ecom-default",
  label: "Meta Recommended (E-commerce)",
  source: "meta",
  fetchedAt: "2026-01-01T00:00:00Z",
  values: {
    PageView: 100,
    ViewContent: 80,
    AddToCart: 25,
    InitiateCheckout: 10,
    AddPaymentInfo: 7,
    Purchase: 3,
    // Google GA4 equivalents
    view_item: 100,
    add_to_cart: 35,
    begin_checkout: 12,
    purchase: 3,
  },
};

/**
 * Default benchmark set used before the user picks anything.
 */
export const DEFAULT_BENCHMARKS = META_BENCHMARKS;
