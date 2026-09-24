/**
 * Google's rolling alias — always points at the latest stable Flash model, so it
 * keeps working when a pinned ID (e.g. gemini-2.5-flash) is decommissioned and
 * starts returning 404 ("no longer available to new users").
 */
export const GEMINI_ROLLING_ALIAS = "gemini-flash-latest";

/** Canonical Gemini model IDs — default to the rolling alias so a retired pinned
 *  version can never 404 the whole app. */
export const GEMINI_TEXT_MODEL_DEFAULT = GEMINI_ROLLING_ALIAS;
export const GEMINI_VISION_MODEL_DEFAULT = GEMINI_ROLLING_ALIAS;

// Every known decommissioned / deprecated pinned ID → the rolling alias, so a stale
// env value OR a hardcoded reference that goes through normalizeGeminiModel resolves
// to a live model instead of 404ing. (gemini-2.5-flash is now retired for new users.)
const DEPRECATED_MODEL_REMAP: Record<string, string> = {
  "gemini-2.5-flash": GEMINI_ROLLING_ALIAS,
  // NOTE: gemini-2.5-flash-lite is intentionally NOT remapped — it is a live, stable GA
  // model that (unlike the gemini-*-latest rolling aliases, which now roll to Gemini-3.x)
  // still accepts the vision request config the shared caller sends (thinkingBudget:0 +
  // responseMimeType). The high-volume per-ad ad pass pins to it for exactly that reason.
  "gemini-2.0-flash": GEMINI_ROLLING_ALIAS,
  "gemini-2.0-flash-lite": GEMINI_ROLLING_ALIAS,
  "gemini-1.5-flash": GEMINI_ROLLING_ALIAS,
  "gemini-1.5-pro": GEMINI_ROLLING_ALIAS,
};

/** Remap decommissioned model IDs (including stale env vars) to current equivalents. */
export function normalizeGeminiModel(model: string): string {
  return DEPRECATED_MODEL_REMAP[model] ?? model;
}

export function geminiTextModels(): string[] {
  const primary = normalizeGeminiModel(
    process.env.GEMINI_TEXT_MODEL ?? GEMINI_TEXT_MODEL_DEFAULT,
  );
  // Pinned default + the rolling alias: if the pinned ID is retired (404), the
  // caller falls through to the alias instead of losing the feature.
  return [primary, GEMINI_TEXT_MODEL_DEFAULT, GEMINI_ROLLING_ALIAS]
    .filter((m, i, a) => a.indexOf(m) === i);
}

export function geminiVisionModels(): string[] {
  const primary = normalizeGeminiModel(
    process.env.GEMINI_VISION_MODEL ?? GEMINI_VISION_MODEL_DEFAULT,
  );
  // Always include the known-good default AND the rolling alias as fallbacks so a
  // stale/decommissioned model ID can't kill the whole vision path — the caller
  // tries the next model on a 404/400.
  return [primary, GEMINI_VISION_MODEL_DEFAULT, GEMINI_ROLLING_ALIAS]
    .filter((m, i, a) => a.indexOf(m) === i);
}

// The SMALL/FAST Flash-Lite tier — cheaper + faster + higher rate limits than full Flash.
// Used for the per-ad ad pass so we can afford to classify EVERY ad (video: first few
// seconds; still: poster frame) instead of a sample. Pinned to the STABLE 2.5 GA lite
// model (not the gemini-flash-lite-latest rolling alias) because the rolling aliases now
// roll to Gemini-3.x, which 400s on the request config the shared vision caller sends.
export const GEMINI_FLASH_LITE_MODEL = "gemini-2.5-flash-lite";

/** Small/fast vision models for the high-volume per-ad ad pass. Defaults to the pinned
 *  Flash-Lite; falls back to the rolling alias so a 404 on some account can't kill the pass. */
export function geminiAdVisionModels(): string[] {
  const primary = normalizeGeminiModel(
    process.env.GEMINI_AD_VISION_MODEL ?? GEMINI_FLASH_LITE_MODEL,
  );
  return [primary, GEMINI_ROLLING_ALIAS, GEMINI_VISION_MODEL_DEFAULT]
    .filter((m, i, a) => a.indexOf(m) === i);
}
