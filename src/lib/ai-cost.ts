/**
 * Calculate the USD cost of a Claude API call from the usage object
 * returned by the Anthropic SDK.
 *
 * Pricing: Claude Haiku 4.5 (as billed by Anthropic, 2026)
 *   Input tokens:        $0.80  / 1M = $0.0000008  / token
 *   Output tokens:       $4.00  / 1M = $0.000004   / token
 *   Cache read input:    $0.08  / 1M = $0.00000008 / token
 *   Cache write (create):$1.00  / 1M = $0.000001   / token
 */
export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function calcCost(usage: AnthropicUsage): number {
  return (
    usage.input_tokens * 0.0000008 +
    usage.output_tokens * 0.000004 +
    (usage.cache_read_input_tokens ?? 0) * 0.00000008 +
    (usage.cache_creation_input_tokens ?? 0) * 0.000001
  );
}

// ── Product pricing ────────────────────────────────────────────────────────
// The raw Anthropic cost (`calcCost`) is the wholesale price. What we SHOW the
// user (and charge to the in-app credit counter) is the productised price:
//
//   displayed = (rawUsd × MARKUP) ÷ DIVISOR        // = rawUsd × 60 today
//
// MARKUP = 3× (company margin); DIVISOR = 0.05 (per-credit unit price). Tune
// these two constants in one place to re-price the whole product.
export const CREDIT_MARKUP = 3;
export const CREDIT_DIVISOR = 0.05;

/** Convert a raw Anthropic USD cost into the user-facing credit value. */
export function toDisplayCredits(rawUsd: number | undefined | null): number {
  if (!rawUsd || rawUsd < 0) return 0;
  return (rawUsd * CREDIT_MARKUP) / CREDIT_DIVISOR;
}

/** Per-recommendation display estimate (raw ≈ $0.0003 → shown as the marked-up value). */
export const RECO_ESTIMATE_DISPLAY = `~$${toDisplayCredits(0.0003).toFixed(2)}`;
