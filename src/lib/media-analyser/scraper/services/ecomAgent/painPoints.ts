/**
 * Pain Point Engine — clusters competitor 1★ reviews into themes.
 * Port of Amazon-scraper-GW/server/src/lib/painPoints.ts — CF Worker compatible.
 */

import { callLLM, stripJsonFences } from './llm';

export interface PainPoint {
  type: string;
  summary: string;
  frequency: number;
  severity: number;
  source_evidence: string;
  theme?: string;
}

export async function classifyPainPoints(
  competitors: Array<Record<string, unknown>>,
  apiKey: string,
  endpoint?: string,
): Promise<PainPoint[]> {
  let reviewsText = '';
  for (const comp of competitors) {
    const brand = String((comp.title ?? comp.asin ?? 'Unknown')).slice(0, 30);
    const negReviews = Array.isArray(comp.top_10_negative_reviews)
      ? comp.top_10_negative_reviews as Array<unknown>
      : [];
    for (const r of negReviews.slice(0, 15)) {
      // Handle both plain strings and review objects (e.g. { body: string })
      const body = typeof r === 'string' ? r : String((r as Record<string, unknown>).body ?? r);
      if (body.trim()) reviewsText += `[${brand}]: "${body}"\n`;
    }
  }
  if (!reviewsText.trim()) return [];

  const prompt =
    `You are analyzing Amazon competitor reviews to extract customer pain points.\n\n` +
    `Reviews from all competitors (labeled by brand):\n${reviewsText}\n\n` +
    `Group these reviews into deduplicated pain point themes. For each unique theme, return:\n` +
    `- type: one of "Pain", "JTBD", "Objection", "Desire Signal"\n` +
    `- summary: one-sentence description of the theme\n` +
    `- frequency: number of reviews expressing this theme\n` +
    `- severity: 1-5 scale based on language intensity (5 = product-breaking)\n` +
    `- source_evidence: exact quote from one representative review, including the brand tag\n\n` +
    `Deduplicate aggressively: if 3 reviews mention 'zipper breaking', that is ONE theme with frequency=3.\n` +
    `Rank output by frequency * severity descending.\n\n` +
    `Return ONLY a JSON array: [{"type": "...", "summary": "...", "frequency": N, "severity": N, "source_evidence": "..."}]\n` +
    `No markdown fences, no explanation text.`;

  try {
    const raw = await callLLM(apiKey, [{ role: 'user', content: prompt }], {
      model: 'gpt-4o-mini',
      maxTokens: 2000,
      temperature: 0,
      endpoint,
    });
    const stripped = stripJsonFences(raw);
    const m = stripped.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(m ? m[0] : stripped) as PainPoint[];
    const validated = parsed.filter(pp =>
      pp.type && pp.summary && pp.frequency != null && pp.severity != null && pp.source_evidence
    );
    return validated.sort((a, b) => (b.frequency * b.severity) - (a.frequency * a.severity));
  } catch (e) {
    console.error(`[PainPoints] Failed: ${e}`);
    return [];
  }
}
