/**
 * Sentiment Tag Engine — Amazon "Customers say" style aspect tags.
 * Port of Amazon-scraper-GW/server/src/lib/sentimentTags.ts — CF Worker compatible.
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

export interface Review {
  body: string;
  rating: number;
  sentiment: string;
}

export interface SentimentTag {
  tag: string;
  sentiment: string;
  count: number;
  avg_rating: number;
  reviews: Review[];
}

function fallbackAspectKeywords(category: string): Record<string, string[]> {
  const cat = (category || '').toLowerCase();
  const base: Record<string, string[]> = {
    'Quality': ['quality', 'build', 'built', 'material', 'premium', 'durable', 'sturdy', 'solid', 'flimsy'],
    'Value for money': ['value', 'money', 'price', 'worth', 'cost', 'expensive', 'cheap'],
    'Ease of use': ['easy', 'use', 'user', 'simple', 'convenient', 'operate'],
    'Design': ['design', 'look', 'looks', 'style', 'compact', 'finish', 'appearance'],
    'Customer service': ['service', 'support', 'replacement', 'warranty', 'return'],
    'Delivery': ['delivery', 'delivered', 'packaging', 'packed', 'installation'],
  };
  if (['wash', 'dryer', 'machine'].some(w => cat.includes(w))) {
    Object.assign(base, {
      'Washing performance': ['wash', 'washing', 'clean', 'cleaning', 'stain', 'clothes'],
      'Noise level': ['noise', 'noisy', 'quiet', 'sound', 'vibration'],
      'Water usage': ['water', 'rinse', 'soak', 'spin'],
    });
  }
  if (['heater', 'geyser', 'water'].some(w => cat.includes(w))) {
    Object.assign(base, {
      'Heating performance': ['heat', 'heating', 'hot', 'warm'],
      'Heating speed': ['fast', 'quick', 'speed', 'minutes'],
      'Power consumption': ['power', 'electricity', 'energy', 'bill'],
      'Installation': ['installation', 'install', 'installed', 'mount'],
    });
  }
  if (['suitcase', 'trolley', 'luggage', 'bag'].some(w => cat.includes(w))) {
    Object.assign(base, {
      'Storage capacity': ['space', 'storage', 'capacity', 'room', 'size'],
      'Wheel quality': ['wheel', 'wheels', 'spinner', 'rolling', 'roll'],
      'Handle quality': ['handle', 'zip', 'zipper', 'lock'],
      'Durability': ['durable', 'durability', 'strong', 'break', 'damage'],
    });
  }
  return base;
}

function generateLocalSentimentTags(
  product: Record<string, unknown>,
  reviews: Review[],
  maxTags = 10,
  maxReviewsPerTag = 10,
): SentimentTag[] {
  const category = String(product.generic_category ?? product.categories_flat ?? product.title ?? '');
  const keywordMap = fallbackAspectKeywords(category);
  const buckets: Record<string, Review[]> = {};

  for (const review of reviews) {
    const body = (review.body || '').toLowerCase();
    if (!body) continue;
    for (const [tag, keywords] of Object.entries(keywordMap)) {
      if (keywords.some(k => body.includes(k))) {
        (buckets[tag] ??= []).push(review);
      }
    }
  }

  const tagsOut: SentimentTag[] = [];
  for (const [tag, evidence] of Object.entries(buckets)) {
    if (!evidence.length) continue;
    const pos = evidence.filter(r => r.sentiment === 'positive').length;
    const neg = evidence.filter(r => r.sentiment === 'negative').length;
    const neu = evidence.length - pos - neg;
    const sentiment = pos >= neg && pos >= neu ? 'positive' : neg >= pos && neg >= neu ? 'negative' : 'neutral';
    const ratings = evidence.map(r => parseFloat(String(r.rating))).filter(n => !isNaN(n));
    const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 3;
    tagsOut.push({
      tag,
      sentiment,
      count: evidence.length,
      avg_rating: Math.round(avg * 100) / 100,
      reviews: evidence.slice(0, maxReviewsPerTag),
    });
  }

  tagsOut.sort((a, b) => b.count - a.count || b.avg_rating - a.avg_rating);
  return tagsOut.slice(0, maxTags);
}

export function sentimentFromRating(rating: unknown): string {
  const r = parseFloat(String(rating));
  if (isNaN(r)) return 'neutral';
  if (r >= 3.5) return 'positive';
  if (r >= 2.5) return 'neutral';
  return 'negative';
}

export function gatherReviews(product: Record<string, unknown>): Review[] {
  const out: Review[] = [];

  // Primary path: use reviews_scored if available (has real per-review ratings)
  const scored = product.reviews_scored as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(scored) && scored.length > 0) {
    for (const entry of scored) {
      const body = typeof entry === 'string' ? entry : String(entry.body ?? entry.text ?? '');
      const rating = typeof entry.rating === 'number' ? entry.rating : parseFloat(String(entry.rating ?? 3));
      const sentiment = typeof entry.sentiment === 'string' ? entry.sentiment : sentimentFromRating(rating);
      if (body.trim()) out.push({ body: body.trim(), rating: isNaN(rating) ? 3 : rating, sentiment });
    }
    return out;
  }

  // Fallback: top_10_positive/negative reviews (ratings are approximated)
  for (const entry of (product.top_10_positive_reviews as unknown[] | undefined) ?? []) {
    const body = typeof entry === 'string' ? entry : String((entry as Record<string, string>).body || (entry as Record<string, string>).text || '');
    if (body.trim()) out.push({ body: body.trim(), rating: 5, sentiment: 'positive' });
  }
  for (const entry of (product.top_10_negative_reviews as unknown[] | undefined) ?? []) {
    const body = typeof entry === 'string' ? entry : String((entry as Record<string, string>).body || (entry as Record<string, string>).text || '');
    if (body.trim()) out.push({ body: body.trim(), rating: 2, sentiment: 'negative' });
  }

  // review_signals — structured signal objects (optional field)
  for (const signal of (product.review_signals as Array<Record<string, unknown>> | undefined) ?? []) {
    if (!signal || typeof signal !== 'object') continue;
    const body = String(signal.body ?? signal.text ?? '').trim();
    if (!body) continue;
    const rating = typeof signal.rating === 'number' ? signal.rating : parseFloat(String(signal.rating ?? product.rating ?? 3));
    out.push({ body, rating: isNaN(rating) ? 3 : rating, sentiment: sentimentFromRating(rating) });
  }

  // review_summary — last-resort fallback: parse summary text into sentences
  if (!out.length) {
    const summaryRaw = product.review_summary;
    const summaryText = summaryRaw && typeof summaryRaw === 'object'
      ? String((summaryRaw as Record<string, unknown>).text ?? '')
      : String(summaryRaw ?? '');
    const baseRating = typeof product.rating === 'number' ? product.rating : parseFloat(String(product.rating ?? 3));
    const r = isNaN(baseRating) ? 3 : baseRating;
    for (const sentence of summaryText.split(/(?<=[.!?])\s+|\s+(?=They\s+)|\s+(?=Some\s+customers\b)|\s+(?=However\b)/)) {
      const s = sentence.trim();
      if (s.length >= 35) out.push({ body: s.slice(0, 1000), rating: r, sentiment: sentimentFromRating(r) });
    }
  }

  return out;
}

export async function generateSentimentTags(
  product: Record<string, unknown>,
  apiKey: string,
  maxTags = 10,
  maxReviewsPerTag = 10,
  endpoint?: string,
  maxInputReviews = 120,
): Promise<SentimentTag[]> {
  const reviews = gatherReviews(product);
  if (!reviews.length) {
    product.sentiment_tags = [];
    return [];
  }

  if (!apiKey) {
    const fallback = generateLocalSentimentTags(product, reviews, maxTags, maxReviewsPerTag);
    product.sentiment_tags = fallback;
    return fallback;
  }

  const inputReviews = reviews.slice(0, Math.max(1, maxInputReviews));
  const minMentions = inputReviews.length < 12 ? 1 : 2;
  const bodyLimit = inputReviews.length > 500 ? 220 : inputReviews.length > 200 ? 300 : 360;

  const blocks = inputReviews.map((r, i) => {
    const body = r.body.length > bodyLimit ? r.body.slice(0, bodyLimit) + '…' : r.body;
    return `[${i + 1}|${r.rating}★] ${body}`;
  });
  const reviewsBlock = blocks.join('\n');
  const title = String(product.title ?? '').trim().slice(0, 120);
  const category = String(product.generic_category ?? product.categories_flat ?? 'product').trim().slice(0, 80);

  const prompt =
    `You are Amazon's 'Customers say' review summarizer for "${title}" (category: ${category}).\n\n` +
    `Below are customer reviews. Each line is formatted as: [id|rating★] body\n\n` +
    `${reviewsBlock}\n\n` +
    `Identify the TOP ${maxTags} aspects customers discuss — short, concrete noun phrases (1-3 words). ` +
    `Use the style Amazon uses: "Quality", "Installation", "Heating performance", "Value for money", etc.\n\n` +
    `For each aspect, return ALL review ids that mention it ` +
    `(not just representative examples. Count accuracy matters: ` +
    `scan every review line and include every matching id under every relevant aspect).\n` +
    `Return STRICT JSON:\n[{"tag":"Quality","review_ids":[1,3,7,...]}, ...]\n\n` +
    `Rules:\n` +
    `- Order aspects by how many reviews mention them, descending.\n` +
    `- An aspect must be mentioned by >= ${minMentions} review(s) to be included.\n` +
    `- Merge synonyms into one Amazon-style aspect: quality/build/material = Quality; heat/heating/warmth = Heating performance.\n` +
    `- Keep distinct dimensions separate even if related: heating performance, temperature retention, power consumption, noise level, installation, and quality are separate aspects.\n` +
    `- Do not assign a review id to an aspect unless that aspect is actually discussed in the review.\n` +
    `- Do not undercount. If 18 reviews discuss installation, include all 18 ids.\n` +
    `- No markdown fences. No commentary. JSON only.`;

  let tagRefs: { tag: string; review_ids: number[] }[];
  try {
    const raw = await callLLM(apiKey, [{ role: 'user', content: prompt }], {
      model: 'gpt-4o-mini',
      maxTokens: 1500,
      temperature: 0,
      endpoint,
    });
    const stripped = stripJsonFences(raw);
    const m = stripped.match(/\[[\s\S]*\]/);
    tagRefs = JSON.parse(m ? m[0] : stripped);
  } catch (e) {
    console.error('[SentimentTags] LLM failed:', e);
    const fallback = generateLocalSentimentTags(product, reviews, maxTags, maxReviewsPerTag);
    product.sentiment_tags = fallback;
    return fallback;
  }

  if (!Array.isArray(tagRefs)) {
    product.sentiment_tags = [];
    return [];
  }

  const tagsOut: SentimentTag[] = [];
  for (const t of tagRefs) {
    const tagName = (t.tag ?? '').trim();
    const ids = t.review_ids ?? [];
    if (!tagName || !ids.length) continue;

    const evidence: Review[] = [];
    let posCount = 0, neuCount = 0, negCount = 0;
    let ratingSum = 0, ratingN = 0;

    for (const rid of ids) {
      const idx = rid - 1;
      if (idx >= 0 && idx < reviews.length) {
        const rv = reviews[idx];
        if (!reviewMentionsAspect(tagName, rv.body)) continue;
        evidence.push(rv);
        if (rv.sentiment === 'positive') posCount++;
        else if (rv.sentiment === 'negative') negCount++;
        else neuCount++;
        const r = parseFloat(String(rv.rating));
        if (!isNaN(r)) { ratingSum += r; ratingN++; }
      }
    }

    if (evidence.length < minMentions) continue;

    const avg = ratingN ? ratingSum / ratingN : 3;
    const counts: Record<string, number> = { positive: posCount, negative: negCount, neutral: neuCount };
    // Primary: highest count wins. Ties resolved by explicit fallback checks below (matches Python).
    let sentiment = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    if (counts[sentiment] === 0) {
      sentiment = sentimentFromRating(avg);
    } else if (posCount === negCount && posCount > 0) {
      sentiment = sentimentFromRating(avg);
    }

    if (sentiment === 'negative') {
      evidence.sort((a, b) => a.rating - b.rating || b.body.length - a.body.length);
    } else {
      evidence.sort((a, b) => b.rating - a.rating || b.body.length - a.body.length);
    }

    tagsOut.push({
      tag: tagName,
      sentiment,
      count: evidence.length,
      avg_rating: Math.round(avg * 100) / 100,
      reviews: evidence.slice(0, maxReviewsPerTag),
    });
  }

  tagsOut.sort((a, b) => b.count - a.count);
  const sliced = tagsOut.slice(0, maxTags);
  if (!sliced.length) {
    const fallback = generateLocalSentimentTags(product, reviews, maxTags, maxReviewsPerTag);
    product.sentiment_tags = fallback;
    return fallback;
  }
  product.sentiment_tags = sliced;
  return sliced;
}

export async function attachSentimentTags(
  product: Record<string, unknown>,
  competitors: Record<string, unknown>[],
  apiKey: string,
  endpoint?: string,
  targetReviewLimit = 120,
  competitorReviewLimit = 120,
): Promise<void> {
  const targets: Array<[Record<string, unknown>, number]> = [
    [product, targetReviewLimit],
    ...competitors.map(c => [c, competitorReviewLimit] as [Record<string, unknown>, number]),
  ];
  const CONCURRENCY = Math.min(3, targets.length);
  let idx = 0;
  async function worker() {
    while (idx < targets.length) {
      const [t, limit] = targets[idx++];
      await generateSentimentTags(t, apiKey, 10, 10, endpoint, limit).catch(e =>
        console.error('[SentimentTags] attach failed:', e)
      );
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}
