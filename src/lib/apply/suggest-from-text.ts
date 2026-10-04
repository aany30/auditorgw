/**
 * Parse an AI recommendation text for any apply-able action it suggests —
 * budget targets, pause/resume phrasing, or a frequency cap. Returns the
 * first clear hit so the caller can swap a heuristic Apply with the AI's
 * exact recommendation.
 *
 * Lives in /lib/apply so every dashboard surface that opens an AI panel can
 * reuse the same parser (BudgetAllocationAudit, the shared AI buttons, etc.).
 */

/**
 * Shape of an action the AI recommendation text implies — a lighter-weight form
 * of ApplyAction that only carries the "what to change" bits. The caller fills
 * in platform/entity details to turn it into a full ApplyAction.
 */
export type AiSuggestedAction =
  | { kind: "set_budget"; to: number }                                       // major currency units
  | { kind: "set_status"; to: "PAUSED" | "ACTIVE" }
  | { kind: "set_frequency_cap"; impressions: number; days: number };

export function parseSuggestedAction(text: string): AiSuggestedAction | null {
  if (!text) return null;
  const clean = text.replace(/\*+/g, "");

  // 1. Budget target — "Reduce daily budget to ₹3,500" / "Set budget at ₹5,000"
  const budgetPatterns: RegExp[] = [
    /(?:reduce|lower|decrease|cut|cap|set|change|adjust|bring|tighten)\s+(?:the\s+|its\s+|your\s+)?(?:daily\s+)?(?:budget|cap|spend)\s+(?:cap\s+)?(?:to|at|around)\s+(?:₹|rs\.?|inr|\$)?\s*([\d,]+(?:\.\d+)?)/i,
    /(?:increase|raise|boost|scale|bump|up|grow)\s+(?:the\s+|its\s+|your\s+)?(?:daily\s+)?budget\s+(?:to|at|around)\s+(?:₹|rs\.?|inr|\$)?\s*([\d,]+(?:\.\d+)?)/i,
    /(?:budget|cap|limit)\s+(?:of|to|at)\s+(?:₹|rs\.?|inr|\$)?\s*([\d,]+(?:\.\d+)?)\s*(?:\/day|per\s*day|daily)?/i,
    /(?:₹|rs\.?|inr|\$)\s*([\d,]+(?:\.\d+)?)\s*\/\s*day/i,
  ];
  for (const re of budgetPatterns) {
    const m = clean.match(re);
    if (m && m[1]) {
      const n = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(n) && n >= 10 && n <= 100_000_000) return { kind: "set_budget", to: n };
    }
  }

  // 2. Frequency cap — "Cap frequency to 3 impressions per 7 days"
  const freqMatch = clean.match(
    /(?:cap|limit|set)\s+(?:the\s+|its\s+|your\s+)?(?:frequency|freq)\s+(?:cap\s+)?(?:to|at)\s+(\d+)\s+impressions?\s+(?:per|every|\/|in|over)\s+(\d+)\s+days?/i
  );
  if (freqMatch) {
    const impressions = parseInt(freqMatch[1], 10);
    const days = parseInt(freqMatch[2], 10);
    if (impressions > 0 && impressions <= 100 && days > 0 && days <= 90) {
      return { kind: "set_frequency_cap", impressions, days };
    }
  }

  // 3. Pause — "pause this campaign", "turn it off", "stop delivery"
  if (/\b(pause\s+(?:this|the|its|all)|turn\s+(?:this\s+)?off|stop\s+delivery|deactivate|disable\s+(?:this|the))\b/i.test(clean)) {
    return { kind: "set_status", to: "PAUSED" };
  }

  // 4. Resume / activate — "resume", "turn on", "reactivate", "enable", "unpause"
  if (/\b(resume\s+(?:this|the|its)|re-?activate|re-?enable|un-?pause|turn\s+(?:this\s+)?on|activate\s+(?:this|the))\b/i.test(clean)) {
    return { kind: "set_status", to: "ACTIVE" };
  }

  return null;
}
