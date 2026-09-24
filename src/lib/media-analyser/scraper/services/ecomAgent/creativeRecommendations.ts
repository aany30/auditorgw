/**
 * Creative Recommendations — port of execution/creative_engine.py
 * generate_creative_recommendations() + _compute_creative_urgency()
 *
 * Generates ranked creative action items based on competitor A+ gaps and
 * customer pain points. Used by the creative dashboard.
 */

import { callLLM, stripJsonFences } from './llm';

export interface CreativeRecommendation {
  type:             'A+' | 'B+' | 'Visual' | 'Copy';
  title:            string;
  summary:          string;
  source_evidence:  string;
  frequency:        number;
  module_gap_score: number;
  creative_urgency: number;
  ranking_score:    number;
}

const VALID_TYPES = new Set(['A+', 'B+', 'Visual', 'Copy']);

/** Score 1–5: max severity across all pain points. Returns 1 if none. */
function computeCreativeUrgency(painPoints: Array<Record<string, unknown>>): number {
  if (!painPoints.length) return 1;
  const maxSev = Math.max(...painPoints.map(pp => Number(pp.severity ?? 1)));
  return Math.min(5, maxSev || 1);
}

export async function generateCreativeRecommendations(
  competitors: Array<Record<string, unknown>>,
  painPoints: Array<Record<string, unknown>>,
  ourProduct: Record<string, unknown>,
  apiKey: string,
  endpoint?: string,
): Promise<CreativeRecommendation[]> {
  if (!competitors.length || !painPoints.length) return [];

  const ourAplusCount = ((ourProduct.a_plus as unknown[]) ?? []).length;
  const creativeUrgency = computeCreativeUrgency(painPoints);

  const compGaps = competitors.map(comp => {
    const aplusCount = ((comp.a_plus as unknown[]) ?? []).length;
    return {
      asin:             String(comp.asin ?? 'unknown'),
      title:            String(comp.title ?? 'Unknown').slice(0, 60),
      a_plus_count:     aplusCount,
      module_gap_score: Math.max(0, aplusCount - ourAplusCount),
    };
  });

  const evidenceLines = painPoints.slice(0, 15).map(pp =>
    `- [${pp.type ?? 'Pain'}] (freq=${pp.frequency ?? 1}, sev=${pp.severity ?? 1}): ` +
    `${pp.summary ?? ''} | Evidence: ${pp.source_evidence ?? 'N/A'}`,
  );

  const compSummary = compGaps
    .map(cg => `- ${cg.title} (ASIN: ${cg.asin}): ${cg.a_plus_count} A+ modules, gap_score=${cg.module_gap_score}`)
    .join('\n');

  const prompt =
    `You are a creative strategist for an Amazon product listing. Based on competitor analysis ` +
    `and customer pain points, generate creative recommendations.\n\n` +
    `Our product A+ modules: ${ourAplusCount}\n\n` +
    `Competitors:\n${compSummary}\n\n` +
    `Customer pain points (from real reviews):\n${evidenceLines.join('\n')}\n\n` +
    `Generate 5-10 actionable creative recommendations. Each MUST:\n` +
    `1. Have a type: one of 'A+', 'B+', 'Visual', 'Copy'\n` +
    `2. Have a title (short, actionable)\n` +
    `3. Have a summary (1-2 sentences explaining the creative angle)\n` +
    `4. Include source_evidence: an EXACT quote from the pain points above\n` +
    `5. Have a frequency count (how many pain points support this angle)\n\n` +
    `Return ONLY a JSON array: [{"type": "...", "title": "...", "summary": "...", "source_evidence": "...", "frequency": N}]`;

  let results: Array<Record<string, unknown>> = [];
  try {
    const raw = await callLLM(apiKey, [{ role: 'user', content: prompt }], {
      model:    'gpt-4o-mini',
      maxTokens: 2000,
      temperature: 0,
      endpoint,
    });
    results = JSON.parse(stripJsonFences(raw)) as Array<Record<string, unknown>>;
  } catch (e) {
    console.error('[CreativeRecs] LLM failed:', e);
    return [];
  }

  const maxGap = Math.max(...compGaps.map(cg => cg.module_gap_score), 0);
  const validated: CreativeRecommendation[] = [];

  for (const item of results) {
    const required = ['type', 'title', 'summary', 'source_evidence', 'frequency'];
    if (!required.every(k => k in item)) continue;
    if (!(item.source_evidence as string)?.trim()) continue;

    const type = VALID_TYPES.has(String(item.type)) ? (item.type as CreativeRecommendation['type']) : 'Copy';
    const freq     = Number(item.frequency ?? 1);
    const gap      = maxGap > 0 ? maxGap : 1;
    const ranking  = freq * gap * creativeUrgency;

    validated.push({
      type,
      title:            String(item.title ?? ''),
      summary:          String(item.summary ?? ''),
      source_evidence:  String(item.source_evidence ?? ''),
      frequency:        freq,
      module_gap_score: maxGap,
      creative_urgency: creativeUrgency,
      ranking_score:    ranking,
    });
  }

  return validated.sort((a, b) => b.ranking_score - a.ranking_score);
}
