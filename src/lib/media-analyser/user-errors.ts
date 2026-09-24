/**
 * Turn a raw thrown error into a clean, client-safe message. Vendor errors from
 * Gemini/OpenAI/Apify (429s, quota/billing text, auth, timeouts) must NEVER reach
 * client-facing report output — they read as broken and can leak keys/URLs. Known
 * vendor patterns collapse to a plain-language notice; anything else is trimmed to
 * a short, generic line.
 */
export function cleanUserError(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err ?? "")).trim();
  const low = raw.toLowerCase();

  if (/\b429\b|resource_exhausted|rate.?limit|too many requests|quota exceeded/.test(low))
    return "AI enrichment is temporarily rate-limited — the deterministic metrics below are unaffected. Try again in a few minutes.";
  if (/billing|payment required|insufficient|out of (credit|quota)|current quota|balance/.test(low))
    return "AI enrichment is temporarily unavailable (account limit reached) — the deterministic metrics below are unaffected.";
  if (/\b401\b|\b403\b|unauthor|api key|permission denied|forbidden/.test(low))
    return "AI enrichment is temporarily unavailable — the deterministic metrics below are unaffected.";
  if (/timed? ?out|timeout|econnreset|etimedout|network|fetch failed|\b503\b|\b502\b|unavailable/.test(low))
    return "AI enrichment timed out — the deterministic metrics below are unaffected. Try again shortly.";

  // App/config errors (e.g. missing scraper key) are safe + useful — keep a short,
  // single-line version; never dump a long raw stack/body.
  const firstLine = raw.split("\n")[0].slice(0, 200);
  return firstLine || "Something went wrong. Please try again.";
}

/** True when the error is a transient AI/vendor failure (for degrade-gracefully paths). */
export function isVendorError(err: unknown): boolean {
  const low = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return /\b429\b|\b503\b|\b502\b|resource_exhausted|rate.?limit|quota|billing|timed? ?out|timeout|fetch failed|unavailable/.test(low);
}
