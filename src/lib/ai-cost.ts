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
