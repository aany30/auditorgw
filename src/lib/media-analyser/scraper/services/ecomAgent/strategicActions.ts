/**
 * Strategic Actions Engine — LLM-generated priority actions.
 * Port of Amazon-scraper-GW/server/src/lib/strategicActions.ts — CF Worker compatible.
 */

import { callLLM, stripJsonFences } from './llm';

export interface StrategicAction {
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  color: 'red' | 'orange' | 'green';
  title: string;
  description: string;
  cta: string;
}

interface SentimentTag {
  tag?: string;
  sentiment?: string;
  count?: number;
  avg_rating?: unknown;
}

function formatTagsForLlm(tags: SentimentTag[]): string {
  if (!tags.length) return '(none)';
  return tags.slice(0, 15).map(t =>
    `- ${t.tag ?? '?'} [${t.sentiment ?? 'neutral'}, ${t.count ?? 0} mentions, avg ${t.avg_rating ?? '?'}★]`
  ).join('\n');
}

export async function generateStrategicActions(
  targetProduct: Record<string, unknown>,
  competitors: Record<string, unknown>[],
  apiKey: string,
  maxActions = 5,
  endpoint?: string,
): Promise<StrategicAction[]> {
  const tpTags = (targetProduct.sentiment_tags as SentimentTag[] | undefined) ?? [];
  const tpSummary = {
    rating:          targetProduct.rating,
    ratings_total:   targetProduct.ratings_total,
    thumbnail_count: ((targetProduct.thumbnails as unknown[]) ?? []).length,
    aplus_count:     ((targetProduct.a_plus as unknown[]) ?? []).length,
    bullet_count:    ((targetProduct.bullets as unknown[]) ?? []).length,
    tags:            formatTagsForLlm(tpTags),
  };

  let avgRating = 0, avgBullets = 0, avgAplus = 0, avgThumbs = 0;
  if (competitors.length) {
    const capped = competitors.slice(0, 6);
    const ratings = capped.map(c => parseFloat(String(c.rating ?? 0))).filter(r => r > 0);
    avgRating   = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
    avgBullets  = capped.reduce((s, c) => s + ((c.bullets as unknown[]) ?? []).length, 0) / capped.length;
    avgAplus    = capped.reduce((s, c) => s + ((c.a_plus as unknown[]) ?? []).length, 0) / capped.length;
    avgThumbs   = capped.reduce((s, c) => s + ((c.thumbnails as unknown[]) ?? []).length, 0) / capped.length;
  }

  const prompt =
    `You are a senior Amazon listing strategist. Produce up to ${maxActions} HIGH-leverage STRATEGIC ACTIONS the brand should take to improve conversion and close review-driven gaps against competitors.\n\n` +
    `OUR PRODUCT (target):\n` +
    `- Title: ${String(targetProduct.title ?? '').slice(0, 120)}\n` +
    `- Rating: ${tpSummary.rating} | Reviews: ${tpSummary.ratings_total}\n` +
    `- Assets: ${tpSummary.thumbnail_count} B+ images, ${tpSummary.aplus_count} A+ modules, ${tpSummary.bullet_count} bullets\n` +
    `- Sentiment tags from our reviews:\n${tpSummary.tags}\n\n` +
    `MARKET AVERAGES (from competitors):\n` +
    `- Avg rating: ${avgRating.toFixed(2)}★\n` +
    `- Avg assets: ${Math.round(avgThumbs)} B+ / ${Math.round(avgAplus)} A+ / ${Math.round(avgBullets)} bullets\n\n` +
    `RULES:\n` +
    `- Prioritize fixing NEGATIVE and NEUTRAL review tags first (address real customer pain). Each action should reference the specific tag(s) it addresses.\n` +
    `- Suggest asset gap closures if our B+/A+/bullet counts trail the market.\n` +
    `- Suggest creative / messaging pivots if competitors consistently win on a positive tag we don't own.\n` +
    `- Each action must be CONCRETE and BRAND-ACTIONABLE in one sprint.\n\n` +
    `Return STRICT JSON array, one object per action:\n` +
    `[{"priority":"HIGH|MEDIUM|LOW","color":"red|orange|green","title":"short action title (<=60 chars)","description":"2 sentences.","cta":"Generate in Creative Studio → or Rework Copy → or Build Review Strategy → or Counter-Position →"}]\n\n` +
    `No markdown fences, no commentary. JSON only.`;

  let actions: Partial<StrategicAction>[];
  try {
    const raw = await callLLM(apiKey, [{ role: 'user', content: prompt }], {
      model: 'gpt-4o-mini',
      maxTokens: 1200,
      temperature: 0.2,
      endpoint,
    });
    const stripped = stripJsonFences(raw);
    const m = stripped.match(/\[[\s\S]*\]/);
    actions = JSON.parse(m ? m[0] : stripped);
  } catch (e) {
    console.error('[StrategicActions] LLM failed:', e);
    return [];
  }

  const validPriority = new Set(['HIGH', 'MEDIUM', 'LOW']);
  const validColor = new Set(['red', 'orange', 'green']);

  return actions.slice(0, maxActions).flatMap(a => {
    if (!a || typeof a !== 'object') return [];
    let priority = String(a.priority ?? 'MEDIUM').toUpperCase() as StrategicAction['priority'];
    let color = String(a.color ?? 'orange').toLowerCase() as StrategicAction['color'];
    if (!validPriority.has(priority)) priority = 'MEDIUM';
    if (!validColor.has(color)) color = 'orange';
    return [{
      priority,
      color,
      title:       String(a.title ?? 'Untitled action').slice(0, 80),
      description: String(a.description ?? '').trim(),
      cta:         String(a.cta ?? 'Generate in Creative Studio →').trim(),
    }];
  });
}
