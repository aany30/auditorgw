/**
 * Combined Review Tags Engine — cross-brand sentiment aggregation.
 * Port of Amazon-scraper-GW/execution/combined_review_tags_engine.py — CF Worker compatible.
 *
 * Different from sentimentTags (which tags ONE product at a time):
 * this engine pools every review across target + all competitors,
 * asks the LLM to identify shared aspects (Quality, Durability, etc.),
 * classifies each tag as positive/neutral/negative, and returns per-brand breakdown.
 */

import { callLLM, stripJsonFences } from './llm';

function reviewMentionsAspect(tagName: string, body: string): boolean {
  const tag = (tagName ?? '').toLowerCase();
  const text = (body ?? '').toLowerCase();
  const keywordMap: Record<string, string[]> = {
    'heating performance': ['heating', 'heat', 'heats', 'hot', 'warm', 'speed'],
    'heating speed': ['heating', 'heat', 'heats', 'hot', 'fast', 'quick'],
    'temperature retention': ['temperature retention', 'retention', 'stays hot', 'retain', 'keeps hot'],
    'power consumption': ['power consumption', 'power', 'electricity', 'energy', 'consumption'],
    'installation': ['installation', 'install', 'installed', 'setup', 'mount'],
    'quality': ['quality', 'build', 'built', 'material', 'solid', 'premium', 'flimsy', 'durable'],
    'value for money': ['value', 'money', 'price', 'worth', 'cost'],
    'noise level': ['noise', 'noisy', 'sound', 'quiet'],
    'compact size': ['compact', 'size', 'small', 'space'],
  };
  const keywords = keywordMap[tag] ?? tag.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  return keywords.some(k => text.includes(k));
}

export interface CombinedTagEvidence {
  body: string;
  rating: number;
  sentiment: string;
}

export interface CombinedTagByProduct {
  asin: string;
  title: string;
  is_target: boolean;
  count: number;
  evidence: CombinedTagEvidence[];
}

export interface CombinedReviewTag {
  tag: string;
  polarity: 'positive' | 'neutral' | 'negative';
  total_count: number;
  avg_rating: number;
  summary: string;
  brand_count: number;
  by_product: CombinedTagByProduct[];
}

interface PooledReview {
  id: number;
  body: string;
  rating: number;
  sentiment: string;
  source_label: string;
  asin: string;
  is_target: boolean;
}

function sentimentFromRating(rating: unknown): string {
  const r = parseFloat(String(rating));
  if (isNaN(r)) return 'neutral';
  if (r >= 3.5) return 'positive';
  if (r >= 2.5) return 'neutral';
  return 'negative';
}

function shortLabel(title: string | undefined, asin: string | undefined, fallback = 'Brand'): string {
  if (title) {
    const words = title.trim().split(/\s+/);
    return words.length >= 2 ? words.slice(0, 2).join(' ') : title.trim();
  }
  return asin || fallback;
}

function gatherReviewsFor(
  product: Record<string, unknown>,
  sourceLabel: string,
  asin: string,
  isTarget: boolean,
): Omit<PooledReview, 'id'>[] {
  const out: Omit<PooledReview, 'id'>[] = [];

  const scored = product.reviews_scored as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(scored) && scored.length > 0) {
    for (const r of scored) {
      const body = String(r.body ?? r.text ?? '').trim();
      if (!body) continue;
      const rating = parseFloat(String(r.rating ?? 3));
      const sentiment = typeof r.sentiment === 'string' ? r.sentiment : sentimentFromRating(rating);
      out.push({ body, rating: isNaN(rating) ? 3 : rating, sentiment, source_label: sourceLabel, asin, is_target: isTarget });
    }
    return out;
  }

  for (const entry of (product.top_10_positive_reviews as unknown[] | undefined) ?? []) {
    const body = typeof entry === 'string' ? entry : String((entry as Record<string, string>).body ?? (entry as Record<string, string>).text ?? '');
    if (body.trim()) out.push({ body: body.trim(), rating: 5, sentiment: 'positive', source_label: sourceLabel, asin, is_target: isTarget });
  }
  for (const entry of (product.top_10_negative_reviews as unknown[] | undefined) ?? []) {
    const body = typeof entry === 'string' ? entry : String((entry as Record<string, string>).body ?? (entry as Record<string, string>).text ?? '');
    if (body.trim()) out.push({ body: body.trim(), rating: 2, sentiment: 'negative', source_label: sourceLabel, asin, is_target: isTarget });
  }

  // review_signals — structured signal objects
  for (const signal of (product.review_signals as Array<Record<string, unknown>> | undefined) ?? []) {
    if (!signal || typeof signal !== 'object') continue;
    const body = String(signal.body ?? signal.text ?? '').trim();
    if (!body) continue;
    const rating = typeof signal.rating === 'number' ? signal.rating : parseFloat(String(signal.rating ?? product.rating ?? 3));
    out.push({ body, rating: isNaN(rating) ? 3 : rating, sentiment: sentimentFromRating(rating), source_label: sourceLabel, asin, is_target: isTarget });
  }

  // review_summary — last-resort: parse summary text into sentences when no reviews at all
  if (!out.length) {
    const summaryRaw = product.review_summary;
    const summaryText = summaryRaw && typeof summaryRaw === 'object'
      ? String((summaryRaw as Record<string, unknown>).text ?? '')
      : String(summaryRaw ?? '');
    const baseRating = typeof product.rating === 'number' ? product.rating : parseFloat(String(product.rating ?? 3));
    const r = isNaN(baseRating) ? 3 : baseRating;
    for (const sentence of summaryText.split(/(?<=[.!?])\s+|\s+(?=They\s+)|\s+(?=Some\s+customers\b)|\s+(?=However\b)/)) {
      const s = sentence.trim();
      if (s.length >= 35) out.push({ body: s.slice(0, 1000), rating: r, sentiment: sentimentFromRating(r), source_label: sourceLabel, asin, is_target: isTarget });
    }
  }

  return out;
}

function roundRobinSample<T>(buckets: T[][], limit: number): T[] {
  const sampled: T[] = [];
  let idx = 0;
  while (sampled.length < limit) {
    let empty = 0;
    for (const lst of buckets) {
      if (idx < lst.length) {
        sampled.push(lst[idx]);
        if (sampled.length >= limit) break;
      } else {
        empty++;
      }
    }
    if (empty === buckets.length) break;
    idx++;
  }
  return sampled;
}


export async function generateCombinedReviewTags(
  targetProduct: Record<string, unknown>,
  competitors: Record<string, unknown>[],
  apiKey: string,
  maxTags = 18,
  targetReviewLimit = 100,
  competitorTotalReviewLimit = 50,
  endpoint?: string,
): Promise<CombinedReviewTag[]> {
  if (!targetProduct || !apiKey) return [];

  const targetAsin = String(targetProduct.asin ?? 'TARGET');
  const targetLabel = shortLabel(targetProduct.title as string | undefined, targetAsin, 'You');

  const targetPool = gatherReviewsFor(targetProduct, targetLabel, targetAsin, true).slice(0, targetReviewLimit);

  const competitorBuckets: Omit<PooledReview, 'id'>[][] = [];
  for (const c of competitors ?? []) {
    const asin = String(c.asin ?? '?');
    const label = shortLabel(c.title as string | undefined, asin);
    const reviews = gatherReviewsFor(c, label, asin, false);
    if (reviews.length) competitorBuckets.push(reviews);
  }

  const competitorPool = roundRobinSample(competitorBuckets, competitorTotalReviewLimit);
  let pool: Omit<PooledReview, 'id'>[] = [...targetPool, ...competitorPool];

  if (!pool.length) return [];

  // Cap pool — round-robin balance
  const maxTotal = targetReviewLimit + competitorTotalReviewLimit;
  if (pool.length > maxTotal) {
    const bucketsByAsin: Record<string, Omit<PooledReview, 'id'>[]> = {};
    for (const r of pool) {
      (bucketsByAsin[r.asin] ??= []).push(r);
    }
    pool = roundRobinSample(Object.values(bucketsByAsin), maxTotal);
  }

  const pooled: PooledReview[] = pool.map((r, i) => ({ ...r, id: i + 1 }));

  const bodyLimit = pool.length > 900 ? 180 : pool.length > 450 ? 240 : 320;
  const blocks = pooled.map(r => {
    const body = r.body.length > bodyLimit ? r.body.slice(0, bodyLimit) + '...' : r.body;
    return `[${r.id}|${r.source_label}|${r.rating}★] ${body}`;
  });

  const targetTitle = String(targetProduct.title ?? '').trim().slice(0, 120);
  const category = String(targetProduct.generic_category ?? targetProduct.categories_flat ?? 'product').trim().slice(0, 80);
  const nBrands = 1 + (competitors?.length ?? 0);

  const systemMsg =
    `You are a senior Amazon competitive-intelligence analyst. Your job is to read reviews from MULTIPLE brands in the same category and identify the SHARED ASPECTS that customers discuss across all of them — then classify each aspect's overall sentiment and tell us which reviews support that classification.\n\n` +
    `You are NOT analysing one product in isolation. You are looking for themes that appear ACROSS brands. The same aspect (e.g. "Quality") may be praised for one brand and complained about for another — group ALL of those mentions under a single "Quality" tag, then decide its OVERALL polarity from the weight of evidence.\n\n` +
    `Polarity rules:\n` +
    `- positive: clear majority of mentions are favourable (avg rating ≥ 3.7)\n` +
    `- negative: clear majority are complaints (avg rating ≤ 2.7)\n` +
    `- neutral:  mixed sentiment OR factual/descriptive mentions without clear valence\n\n` +
    `Aspect naming: use Amazon's own "Customers say" voice — short, concrete noun phrases of 1-3 words: "Quality", "Heating issue", "Suction power", "Value for money", "Battery life", "Installation", "Customer service", "Mounting mechanism", etc. Do not collapse separate product dimensions into one tag.`;

  const userMsg =
    `Category: ${category}\n` +
    `Target product: "${targetTitle}"\n` +
    `Brands compared: ${nBrands} (1 target + ${competitors?.length ?? 0} competitors)\n\n` +
    `Each review below is formatted as: [id|brand_label|rating★] body\n\n` +
    `${blocks.join('\n')}\n\n` +
    `Identify the TOP ${maxTags} aspects discussed ACROSS BRANDS. For each aspect, return EVERY review id that mentions it across all brands, not just representative examples. Count accuracy matters: scan every review line and include every matching id under every relevant shared aspect.\n\n` +
    `Return STRICT JSON in this exact shape:\n` +
    `{\n` +
    `  "tags": [\n` +
    `    {\n` +
    `      "tag": "Quality",\n` +
    `      "polarity": "positive",\n` +
    `      "summary": "Buyers across all brands praise solid build, but Brand X is called flimsy.",\n` +
    `      "review_ids": [1, 4, 12, 33, ...]\n` +
    `    },\n` +
    `    ...\n` +
    `  ]\n` +
    `}\n\n` +
    `Hard rules:\n` +
    `- Include only aspects mentioned by AT LEAST 2 reviews from AT LEAST 2 different brands.\n` +
    `- Merge synonyms into one Amazon-style aspect: quality/build/material = Quality; heat/heating/warmth = Heating performance.\n` +
    `- Do not undercount. If 20 reviews discuss installation across brands, include all 20 ids.\n` +
    `- Keep distinct dimensions separate: Heating performance is not Temperature retention; Temperature retention is not Power consumption.\n` +
    `- Do not assign a review id to a tag unless that exact aspect is actually discussed in that review.\n` +
    `- Order tags by total_count descending (largest aspects first).\n` +
    `- Each summary: ONE sentence, ≤ 140 chars, mention specific brand names where useful.\n` +
    `- Cap to ${maxTags} tags maximum.\n` +
    `- No markdown, no commentary, no code fences. JSON only.`;

  let tagRefs: Array<{ tag: string; polarity?: string; summary?: string; review_ids: number[] }> = [];
  try {
    const raw = await callLLM(apiKey, [
      { role: 'system', content: systemMsg },
      { role: 'user', content: userMsg },
    ], {
      model: 'gpt-4o-mini',
      maxTokens: 2200,
      temperature: 0,
      endpoint,
    });
    const stripped = stripJsonFences(raw);
    const m = stripped.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : stripped) as { tags?: typeof tagRefs };
    tagRefs = parsed.tags ?? [];
  } catch (e) {
    console.error('[CombinedTags] LLM failed:', e);
    return [];
  }

  if (!Array.isArray(tagRefs)) return [];

  const byId = new Map(pooled.map(r => [r.id, r]));
  const results: CombinedReviewTag[] = [];

  for (const tref of tagRefs) {
    const tagName = (tref.tag ?? '').trim();
    const ids = tref.review_ids ?? [];
    const polarityHint = (tref.polarity ?? '').toLowerCase();
    const summary = (tref.summary ?? '').trim();
    if (!tagName || !ids.length) continue;

    const bucketMap = new Map<string, { asin: string; title: string; is_target: boolean; evidence: CombinedTagEvidence[] }>();
    let ratingSum = 0;
    let ratingN = 0;

    for (const rid of ids) {
      const r = byId.get(rid);
      if (!r) continue;
      if (!reviewMentionsAspect(tagName, r.body)) continue;

      if (!bucketMap.has(r.asin)) {
        bucketMap.set(r.asin, { asin: r.asin, title: r.source_label, is_target: r.is_target, evidence: [] });
      }
      bucketMap.get(r.asin)!.evidence.push({ body: r.body, rating: r.rating, sentiment: r.sentiment });
      const parsed = parseFloat(String(r.rating));
      if (!isNaN(parsed)) { ratingSum += parsed; ratingN++; }
    }

    if (bucketMap.size < 2) continue;

    const avg = ratingN ? ratingSum / ratingN : 3;
    const derived = sentimentFromRating(avg);
    const polarity = (['positive', 'neutral', 'negative'].includes(polarityHint) ? polarityHint : derived) as 'positive' | 'neutral' | 'negative';

    const buckets = [...bucketMap.values()].sort((a, b) =>
      (a.is_target ? 0 : 1) - (b.is_target ? 0 : 1) || b.evidence.length - a.evidence.length
    );
    for (const b of buckets) {
      if (polarity === 'negative') {
        b.evidence.sort((a, c) => a.rating - c.rating || c.body.length - a.body.length);
      } else {
        b.evidence.sort((a, c) => c.rating - a.rating || c.body.length - a.body.length);
      }
    }

    const byProduct: CombinedTagByProduct[] = buckets.map(b => ({
      asin: b.asin,
      title: b.title,
      is_target: b.is_target,
      count: b.evidence.length,
      evidence: b.evidence.slice(0, 5),
    }));

    results.push({
      tag: tagName,
      polarity,
      total_count: byProduct.reduce((s, b) => s + b.count, 0),
      avg_rating: Math.round(avg * 100) / 100,
      summary,
      brand_count: byProduct.length,
      by_product: byProduct,
    });
  }

  results.sort((a, b) => b.total_count - a.total_count);
  return results.slice(0, maxTags);
}
