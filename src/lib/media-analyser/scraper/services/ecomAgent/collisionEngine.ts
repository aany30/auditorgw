/**
 * Collision Engine — vision tagging, aspect extraction, data-driven battle cards.
 * Full port of Amazon-scraper-GW/server/src/lib/collisionEngine.ts — CF Worker compatible.
 * Key CF Worker differences vs Raza's Node version:
 *   - No Buffer — uses btoa() + Uint8Array for base64 encoding
 *   - No OpenAI SDK singleton — uses callLLM() raw fetch wrapper
 *   - No llmWithRetry import — callLLM() has built-in retry logic
 */

import { callLLM, stripJsonFences, LLM_VISION_MODEL } from './llm';
import type { ProductData } from './scraper';

function fallbackReviewAspects(title: string, category: string, reviews: string[]): Array<{ text: string; count: number; impact: string }> {
  const textBlob = reviews.join(' ').toLowerCase();
  if (!textBlob.trim()) return [{ text: 'Review data unavailable', count: 0, impact: 'neutral' }];

  const aspectKeywords: Record<string, string[]> = {
    'Quality': ['quality', 'build', 'finish', 'material', 'durable', 'sturdy', 'strong'],
    'Value for money': ['value', 'price', 'worth', 'money', 'expensive', 'cheap'],
    'Ease of use': ['easy', 'use', 'using', 'handle', 'setup', 'install', 'clean'],
    'Design': ['design', 'look', 'style', 'colour', 'color', 'compact', 'size'],
    'Performance': ['performance', 'works', 'working', 'power', 'speed', 'cooling', 'heating', 'suction', 'wash'],
    'Delivery': ['delivery', 'delivered', 'packaging', 'package', 'received', 'damaged'],
    'Service': ['service', 'support', 'installation', 'warranty', 'replacement'],
    'Capacity': ['capacity', 'space', 'storage', 'large', 'small', 'fit', 'fits'],
  };
  const negativeWords = ['bad', 'poor', 'worst', 'issue', 'problem', 'broken', 'damage', 'damaged', 'defect', 'leak', 'noisy', 'not worth', 'difficult', 'disappointed'];
  const positiveWords = ['good', 'great', 'excellent', 'best', 'love', 'easy', 'satisfied', 'recommend', 'worth', 'quality', 'nice', 'happy'];

  const tags: Array<{ text: string; count: number; impact: string }> = [];
  for (const [label, keywords] of Object.entries(aspectKeywords)) {
    const count = keywords.reduce((sum, k) => sum + (textBlob.split(k).length - 1), 0);
    if (count <= 0) continue;
    const snippets = reviews.filter(r => keywords.some(k => r.toLowerCase().includes(k)));
    const neg = snippets.filter(s => negativeWords.some(w => s.toLowerCase().includes(w))).length;
    const pos = snippets.filter(s => positiveWords.some(w => s.toLowerCase().includes(w))).length;
    const impact = neg > pos ? 'negative' : pos > neg ? 'positive' : 'neutral';
    tags.push({ text: label, count: Math.max(1, count), impact });
  }

  if (!tags.length) {
    const ctx = `${title} ${category}`.toLowerCase();
    let fallbackLabel = 'Customer feedback';
    if (ctx.includes('vacuum') || ctx.includes('mop')) fallbackLabel = 'Cleaning performance';
    else if (ctx.includes('lunch') || ctx.includes('bottle')) fallbackLabel = 'Daily usability';
    else if (ctx.includes('washing')) fallbackLabel = 'Washing performance';
    tags.push({ text: fallbackLabel, count: reviews.length, impact: 'neutral' });
  }

  return tags.sort((a, b) => b.count - a.count).slice(0, 8);
}

// Same constants as Raza's Node version
const VISION_MODEL           = LLM_VISION_MODEL; // 'gpt-4o'
const ASPECT_CONCURRENCY     = 3;   // max concurrent aspect extraction LLM calls
const VISION_BATCH_SIZE      = 6;   // images per vision batch
const VISION_BATCH_CONCURRENCY = 6; // max concurrent vision batches
const MAX_GALLERY_IMAGES     = 60;  // max gallery thumbnails to analyze
const MAX_APLUS_IMAGES       = 40;  // max A+ module images to analyze

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface BattleCard {
  competitor_asin: string;
  competitor_title: string;
  '1v1_metrics': {
    'Rating_&_Price': string;
    'Visual_Superiority': string;
    'Vulnerability_Signal': string;
    'Review_Volume': string;
  };
  attack_vector: string;
  counter_strategy: string;
  vulnerability: string;
}

export interface CollisionReport {
  visual_taxonomy: string[];
  aplus_taxonomy:  string[];
  battle_cards:    BattleCard[];
}

// ── Simple semaphore — same polling approach as Raza ─────────────────────────

function makeSemaphore(limit: number) {
  let count = 0;
  return {
    async acquire() {
      while (count >= limit) await new Promise(r => setTimeout(r, 100));
      count++;
    },
    release() { count--; },
  };
}

// ── Text-based fallback taxonomy ──────────────────────────────────────────────
// LLM-first, keyword fallback. Called when vision is unavailable or returns < 2 tags.
// Port of Raza's generate_visual_taxonomy() — general cross-category keywords (not luggage-specific).

async function generateVisualTaxonomy(
  ourProduct: Partial<ProductData>,
  competitors: Partial<ProductData>[],
  apiKey: string,
  endpoint?: string,
): Promise<string[]> {
  const p        = ourProduct as Record<string, unknown>;
  const category = String(p.generic_category ?? p.categories_flat ?? '');
  const ourTitle = String(ourProduct.title ?? '');

  const allText: string[] = [
    ...(ourProduct.bullets ?? []),
    ...competitors.flatMap(c => [
      ...(c.bullets ?? []),
      ...(c.a_plus ?? []).map(ap => String((ap as Record<string, unknown>).visual_desc ?? '')),
    ]),
  ];

  // LLM-first: category-aware taxonomy (same as Raza's LLM path)
  if (apiKey && (allText.length || ourTitle)) {
    try {
      const sampleText  = allText.slice(0, 40).join('\n');
      const compTitles  = competitors.slice(0, 5).map(c => String(c.title ?? '').slice(0, 80));
      const prompt =
        `You are analyzing Amazon product listings for: "${ourTitle.slice(0, 120)}".\n` +
        `Product category: ${category || 'Unknown'}\n` +
        `Competitor titles: ${compTitles.join('; ')}\n\n` +
        `Sample bullet points from the market:\n${sampleText.slice(0, 2000)}\n\n` +
        `Based on this specific product category, identify the 10 most important VISUAL FEATURES ` +
        `that customers evaluate when browsing these listings. These should be the key visual content ` +
        `categories that Amazon listing images typically cover for this product type.\n\n` +
        `Feature #1 must always be 'Main / Hero Shot'.\n\n` +
        `Return ONLY a JSON array of exactly 10 short feature names (3-5 words each), ` +
        `ordered by importance. Example format:\n` +
        `["Main / Hero Shot", "Interior Layout", "Material Close-Up", ...]\n` +
        `No markdown fences, no explanation.`;

      const raw      = await callLLM(apiKey, [{ role: 'user', content: prompt }], {
        model: VISION_MODEL, maxTokens: 300, temperature: 0, endpoint,
      });
      const features = JSON.parse(stripJsonFences(raw)) as unknown[];
      if (Array.isArray(features) && features.length >= 5) {
        console.log(`[Vision] LLM taxonomy: ${features.length} features for "${category || 'product'}"`);
        return (features as string[]).slice(0, 10);
      }
    } catch (e) {
      console.warn(`[Vision] LLM taxonomy failed: ${e}. Using keyword fallback.`);
    }
  }

  // Keyword fallback — general cross-category keywords (same as Raza's market_keywords)
  const features = ['Main / Hero Shot'];
  const marketKeywords: Record<string, string[]> = {
    'Material / Build Quality':  ['material', 'build', 'quality', 'construction', 'body', 'frame', 'shell'],
    'Key Feature Close-Up':      ['feature', 'detail', 'close-up', 'technology', 'mechanism'],
    'Interior / Capacity':       ['interior', 'capacity', 'space', 'storage', 'compartment', 'inside'],
    'Size / Dimensions':         ['size', 'dimension', 'inches', 'cm', 'weight', 'compact', 'large'],
    'Design / Aesthetics':       ['design', 'modern', 'color', 'stylish', 'elegant', 'finish', 'look'],
    'Performance / Efficiency':  ['performance', 'power', 'efficient', 'energy', 'speed', 'fast', 'cooling', 'heating'],
    'Lifestyle / In-Use':        ['lifestyle', 'use', 'daily', 'home', 'kitchen', 'outdoor', 'office'],
    'Safety / Durability':       ['safe', 'durable', 'warranty', 'protection', 'reliable', 'sturdy', 'strong'],
    'Accessories / Contents':    ['accessory', 'include', 'box', 'package', 'contents', 'bundle'],
    'Installation / Setup':      ['install', 'setup', 'easy', 'assembly', 'mount', 'connect'],
    'Comparison / Value':        ['compare', 'value', 'price', 'worth', 'vs', 'better', 'advantage'],
    'Technical Specs':           ['spec', 'technical', 'watt', 'volt', 'liter', 'capacity', 'rating'],
  };

  const textBlob = allText.join(' ').toLowerCase();
  const scored   = Object.entries(marketKeywords)
    .map(([theme, keys]) => ({ theme, score: keys.reduce((n, k) => n + (textBlob.split(k).length - 1), 0) }))
    .sort((a, b) => b.score - a.score);

  for (const { theme } of scored) {
    if (!features.includes(theme) && features.length < 10) features.push(theme);
  }
  for (const fb of ['Product Detail', 'Color Variations', 'Packaging', 'Technical Specs', 'Comparison View', 'Brand Story', 'Warranty Info']) {
    if (features.length < 10 && !features.includes(fb)) features.push(fb);
  }
  return features.slice(0, 10);
}

// ── Positional keyword-based thumbnail tagging ────────────────────────────────
// Tags thumbnails whose ocr_description matches a taxonomy keyword (fallback when vision unavailable).

function tagThumbnailsPositional(competitors: Partial<ProductData>[], taxonomy: string[]): void {
  for (const comp of competitors) {
    for (const thumb of (comp.thumbnails ?? [])) {
      const t = thumb as Record<string, unknown>;
      if (t.matched_feature) continue;
      const desc = String(t.ocr_description ?? '').toLowerCase();
      if (!desc) continue;
      for (const feature of taxonomy) {
        const keywords = feature.replace(/&/g, '').replace(/\//g, ' ')
          .split(/\s+/).filter(k => k.length > 2).map(k => k.toLowerCase());
        if (keywords.some(k => desc.includes(k))) {
          t.matched_feature = feature;
          break;
        }
      }
    }
  }
}

// ── Download one image as base64 data URI ─────────────────────────────────────
// CF Worker compatible: uses btoa() + Uint8Array instead of Node's Buffer.

async function downloadBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 500) return null;

    // CF Worker: no Buffer — convert ArrayBuffer to base64 via btoa
    const bytes  = new Uint8Array(buf);
    let binary   = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const b64    = btoa(binary);
    const ct     = res.headers.get('content-type') ?? 'image/jpeg';
    const mime   = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

// ── GPT-4o Vision: tag one batch of up to 6 images ───────────────────────────
// Port of Raza's _tag_batch() — same model, same prompt, same detail level.
// visionDisabled is a shared flag; set to true on quota/auth errors to skip remaining batches.

async function tagBatch(
  batch: Array<{ section: 'gallery' | 'aplus'; item: Record<string, unknown>; url: string }>,
  urlToB64: Map<string, string>,
  ourTitle: string,
  category: string,
  visionDisabled: { disabled: boolean },
  apiKey: string,
  endpoint?: string,
): Promise<void> {
  if (visionDisabled.disabled || !apiKey) return;

  const contentParts: Array<{ type: 'image_url'; image_url: { url: string; detail: 'low' } } | { type: 'text'; text: string }> = [];
  const valid: Array<Record<string, unknown>> = [];

  for (const { item, url } of batch) {
    const b64 = urlToB64.get(url);
    if (!b64) continue;
    contentParts.push({ type: 'image_url', image_url: { url: b64, detail: 'low' } });
    valid.push(item);
  }
  if (!valid.length) return;

  const n = valid.length;
  contentParts.push({
    type: 'text',
    text: (
      `Product: "${ourTitle.slice(0, 80)}" (Category: ${category || 'general'})\n\n` +
      `I am showing you ${n} Amazon product listing image(s) numbered 1–${n}.\n` +
      `For each image, identify the ONE primary feature/selling point it showcases.\n` +
      `Use short, universal labels (2-4 words). Follow the style of these examples:\n` +
      `Hero Shot, Size Comparison, Material Close-Up, Lifestyle In-Use, Interior Layout,\n` +
      `Color Variants, Durability Safety, Compatibility Fits, Product Specs,\n` +
      `Key Feature Callout, Unboxing Package, Installation Setup, Brand Story\n\n` +
      `Return ONLY a JSON array of exactly ${n} strings, one per image in order.\n` +
      `No markdown, no explanation. Example: ["Hero Shot", "Material Close-Up", ...]`
    ),
  });

  try {
    const raw  = await callLLM(apiKey, [{ role: 'user', content: contentParts as any }], {
      model: VISION_MODEL, maxTokens: 200, temperature: 0, endpoint,
    });
    const stripped = stripJsonFences(raw);
    const m    = stripped.match(/\[[\s\S]*\]/);
    const tags = JSON.parse(m ? m[0] : stripped) as unknown[];
    if (Array.isArray(tags)) {
      for (let i = 0; i < valid.length; i++) {
        if (i < tags.length && typeof tags[i] === 'string') {
          valid[i].matched_feature = tags[i] as string;
        }
      }
    }
  } catch (e) {
    const msg = String(e);
    if (msg.includes('quota') || msg.includes('auth') || msg.includes('401') || msg.includes('insufficient')) {
      if (!visionDisabled.disabled) {
        console.warn('[Vision] Quota/auth error — disabling vision tagging, falling back to keyword matching.');
        visionDisabled.disabled = true;
      }
    } else {
      console.warn(`[Vision] Batch tag failed: ${e}`);
    }
  }
}

// ── Main vision analysis pipeline ─────────────────────────────────────────────
// Port of Raza's analyze_image_features_vision():
//   1. Collect gallery + A+ images from competitors
//   2. Download all unique URLs as base64 in parallel
//   3. Run GPT-4o vision batches (6 images each, up to 6 concurrent)
//   4. Derive frequency-sorted taxonomies from matched_feature tags
//   5. Fall back to text-based taxonomy if < 2 vision tags produced

async function analyzeImageFeaturesVision(
  ourProduct: Partial<ProductData>,
  competitors: Partial<ProductData>[],
  apiKey: string,
  endpoint?: string,
): Promise<{ galleryTaxonomy: string[]; aplusTaxonomy: string[] }> {
  const ourTitle = String(ourProduct.title ?? '');
  const p        = ourProduct as Record<string, unknown>;
  const category = String(p.generic_category ?? p.categories_flat ?? '');

  // If no API key, fall back to text-based taxonomy only
  if (!apiKey) {
    const taxonomy = await generateVisualTaxonomy(ourProduct, competitors, apiKey, endpoint);
    tagThumbnailsPositional(competitors, taxonomy);
    return { galleryTaxonomy: taxonomy, aplusTaxonomy: [] };
  }

  // Collect gallery + A+ image items (same limits as Raza's Python constants)
  type ImageItem = { section: 'gallery' | 'aplus'; item: Record<string, unknown>; url: string };
  const galleryItems: ImageItem[] = [];
  const aplusItems: ImageItem[]   = [];

  for (const comp of competitors) {
    for (const thumb of (comp.thumbnails ?? [])) {
      const t   = thumb as Record<string, unknown>;
      const url = String(t.url ?? t.src ?? '');
      if (url.startsWith('http') && galleryItems.length < MAX_GALLERY_IMAGES) {
        galleryItems.push({ section: 'gallery', item: t, url });
      }
    }
    for (const mod of (comp.a_plus ?? [])) {
      const m   = mod as Record<string, unknown>;
      const url = String(m.image_url ?? m.url ?? '');
      if (url.startsWith('http') && aplusItems.length < MAX_APLUS_IMAGES) {
        aplusItems.push({ section: 'aplus', item: m, url });
      }
    }
  }

  const allItems = [...galleryItems, ...aplusItems];

  if (!allItems.length) {
    const taxonomy = await generateVisualTaxonomy(ourProduct, competitors, apiKey, endpoint);
    tagThumbnailsPositional(competitors, taxonomy);
    return { galleryTaxonomy: taxonomy, aplusTaxonomy: [] };
  }

  // Download all unique image URLs in parallel (same as Raza's ThreadPoolExecutor(max_workers=20))
  const uniqueUrls = [...new Set(allItems.map(i => i.url))];
  const urlToB64   = new Map<string, string>();

  await Promise.all(uniqueUrls.map(async url => {
    const b64 = await downloadBase64(url);
    if (b64) urlToB64.set(url, b64);
  }));
  console.log(`[Vision] Downloaded ${urlToB64.size}/${uniqueUrls.length} images for feature tagging`);

  // Batch into groups of 6, run up to 6 batches concurrently (same as Raza)
  const batches: ImageItem[][] = [];
  for (let i = 0; i < allItems.length; i += VISION_BATCH_SIZE) {
    batches.push(allItems.slice(i, i + VISION_BATCH_SIZE));
  }

  const visionDisabled = { disabled: false };
  const sem            = makeSemaphore(VISION_BATCH_CONCURRENCY);

  await Promise.all(batches.map(async batch => {
    await sem.acquire();
    try {
      await tagBatch(batch, urlToB64, ourTitle, category, visionDisabled, apiKey, endpoint);
    } finally {
      sem.release();
    }
  }));

  // Derive frequency-sorted taxonomies from matched_feature tags written by tagBatch
  const galleryTagFreq = new Map<string, number>();
  const aplusTagFreq   = new Map<string, number>();

  for (const comp of competitors) {
    for (const thumb of (comp.thumbnails ?? [])) {
      const tag = (thumb as Record<string, unknown>).matched_feature as string | undefined;
      if (tag) galleryTagFreq.set(tag, (galleryTagFreq.get(tag) ?? 0) + 1);
    }
    for (const mod of (comp.a_plus ?? [])) {
      const tag = (mod as Record<string, unknown>).matched_feature as string | undefined;
      if (tag) aplusTagFreq.set(tag, (aplusTagFreq.get(tag) ?? 0) + 1);
    }
  }

  let galleryTaxonomy = [...galleryTagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .slice(0, 10);

  const aplusTaxonomy = [...aplusTagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .slice(0, 8);

  // Promote hero tag to first position (same as Raza)
  if (galleryTaxonomy.length) {
    const heroIdx = galleryTaxonomy.findIndex(t => t.toLowerCase().includes('hero'));
    if (heroIdx > 0) {
      const [hero] = galleryTaxonomy.splice(heroIdx, 1);
      galleryTaxonomy.unshift(hero);
    }
  }

  console.log(`[Vision] Gallery taxonomy (${galleryTaxonomy.length}): ${galleryTaxonomy.join(', ')}`);
  console.log(`[Vision] A+ taxonomy (${aplusTaxonomy.length}): ${aplusTaxonomy.join(', ')}`);

  // Fall back to text-based if vision produced nothing useful
  if (galleryTaxonomy.length < 2) {
    const taxonomy = await generateVisualTaxonomy(ourProduct, competitors, apiKey, endpoint);
    tagThumbnailsPositional(competitors, taxonomy);
    return { galleryTaxonomy: taxonomy, aplusTaxonomy };
  }

  return { galleryTaxonomy, aplusTaxonomy };
}

// ── Review aspect extraction ──────────────────────────────────────────────────
// Port of Raza's extract_review_aspects() — mutates product.aspect_tags in-place.
// Uses gpt-4o-mini via callLLM (which has built-in retry — same resilience as llmWithRetry).

async function extractReviewAspects(
  product: Record<string, unknown>,
  apiKey: string,
  endpoint?: string,
): Promise<void> {
  const FALLBACK = [{ text: 'Overall Quality', count: 0, impact: 'neutral' }];
  const posRaw   = (product.top_10_positive_reviews as unknown[] | undefined ?? []).slice(0, 15);
  const negRaw   = (product.top_10_negative_reviews as unknown[] | undefined ?? []).slice(0, 15);
  const allReviews = [...posRaw, ...negRaw];

  if (!allReviews.length) { product.aspect_tags = FALLBACK; return; }
  if (!apiKey) { product.aspect_tags = FALLBACK; return; }

  const asin     = String(product.asin ?? 'unknown');
  const title    = String(product.title ?? 'unknown product');
  const category = String((product.generic_category ?? product.categories_flat) ?? '');

  // Reviews may be strings or objects with a `body` field (same handling as Raza)
  const reviewLines = allReviews.slice(0, 30).map(r =>
    typeof r === 'string' ? r : String((r as Record<string, unknown>).body ?? r)
  );
  const reviewsText = reviewLines.join('\n---\n');

  const prompt =
    `Analyze these customer reviews for "${title.slice(0, 100)}" (category: ${category || 'general'}).\n\n` +
    `Reviews:\n${reviewsText.slice(0, 4000)}\n\n` +
    `Identify the TOP 8-12 specific aspects/features that customers discuss in these reviews. ` +
    `Do NOT use generic aspects — discover what customers ACTUALLY talk about for this specific product.\n\n` +
    `For each aspect, count how many reviews mention it and determine the overall sentiment.\n\n` +
    `Return ONLY a JSON array: [{"text": "Cooling Performance", "count": 7, "impact": "negative"}, ...]\n` +
    `"impact" must be one of: "positive", "negative", "neutral".\n` +
    `Order by count descending. No markdown fences, no explanation.`;

  try {
    const raw = await callLLM(apiKey, [{ role: 'user', content: prompt }], {
      model: VISION_MODEL, maxTokens: 600, temperature: 0, endpoint,
    });
    const stripped = stripJsonFences(raw);
    const m    = stripped.match(/\[[\s\S]*\]/);
    const tags = JSON.parse(m ? m[0] : stripped) as Array<{ text: string; count: number; impact: string }>;
    product.aspect_tags = [...tags].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    console.log(`[Collision] Extracted ${tags.length} aspect tags for ${asin}`);
  } catch (e) {
    console.error(`[Collision] Aspect extraction failed for ${asin}: ${e}. Using fallback.`);
    product.aspect_tags = fallbackReviewAspects(title, category, reviewLines);
  }
}

// ── Battle card generation — pure data, no LLM ───────────────────────────────
// Port of Raza's generate_battle_card() — zero LLM cost, never fails.

function generateBattleCard(
  ourProduct: Partial<ProductData>,
  competitor: Partial<ProductData>,
): BattleCard {
  const ourAplus  = ((ourProduct as Record<string, unknown>).a_plus_modules as unknown[] | undefined ?? ourProduct.a_plus ?? []).length;
  const compAplus = ((competitor as Record<string, unknown>).a_plus_modules as unknown[] | undefined ?? competitor.a_plus ?? []).length;

  let visualDelta = 'Parity';
  if (ourAplus > compAplus)       visualDelta = `Dominant (+${ourAplus - compAplus} modules)`;
  else if (compAplus > ourAplus)  visualDelta = `Deficient (-${compAplus - ourAplus} modules)`;

  const compRating  = competitor.rating;
  const ratingStr   = compRating != null ? `${compRating}/5.0` : 'N/A';

  const ourTotal  = Number((ourProduct as Record<string, unknown>).ratings_total ?? 0);
  const compTotal = Number((competitor as Record<string, unknown>).ratings_total ?? 0);
  const reviewVolume = (ourTotal || compTotal)
    ? `Us: ${ourTotal.toLocaleString()} vs Them: ${compTotal.toLocaleString()}`
    : 'Review data unavailable';

  const compNeg = (competitor as Record<string, unknown>).top_10_negative_reviews as unknown[] ?? [];
  const compPos = (competitor as Record<string, unknown>).top_10_positive_reviews as unknown[] ?? [];

  // Weakness: longest negative review text (same as Raza)
  let weaknessSignal = 'General';
  if (compNeg.length) {
    const texts = compNeg.map(r => typeof r === 'string' ? r : String((r as Record<string, unknown>).body ?? r));
    weaknessSignal = (texts.sort((a, b) => b.length - a.length)[0]?.slice(0, 60) ?? '') + '...';
  }

  // Strength: winning_hook or first positive review (same as Raza)
  let strengthSignal = String((competitor as Record<string, unknown>).winning_hook ?? '') || 'Standard Utility';
  if (!strengthSignal || strengthSignal === 'Standard Utility') {
    if (compPos.length) {
      const first = compPos[0];
      strengthSignal = (typeof first === 'string' ? first : String((first as Record<string, unknown>).body ?? first)).slice(0, 60) + '...';
    }
  }

  return {
    competitor_asin:  competitor.asin ?? '',
    competitor_title: String(competitor.title ?? ''),
    '1v1_metrics': {
      'Rating_&_Price':      `${ratingStr} | ${String((competitor as Record<string, unknown>).price ?? 'N/A')}`,
      'Visual_Superiority':  `A+ Modules: ${ourAplus} (Us) vs ${compAplus} (Them) → ${visualDelta}`,
      'Vulnerability_Signal': `Negative Review Theme: '${weaknessSignal}'`,
      'Review_Volume':        reviewVolume,
    },
    attack_vector:    `Competitor leverages: ${strengthSignal}`,
    counter_strategy: `Attack their vulnerability: '${weaknessSignal}'. Highlight our superiority in this aspect across A+ and Bullets.`,
    vulnerability:    weaknessSignal,
  };
}

// ── processHub — public entry point ──────────────────────────────────────────
// Port of Raza's process_hub():
//   1. Vision-based image feature tagging
//   2. Review aspect extraction for our product + all competitors (max 3 concurrent)
//   3. Data-driven battle cards (pure data, no LLM — zero cost, zero failure rate)

export async function processHub(
  ourProduct: Partial<ProductData>,
  competitors: Partial<ProductData>[],
  apiKey: string,
  endpoint?: string,
): Promise<CollisionReport> {
  console.log(`[Collision] Starting for ASIN ${ourProduct.asin} with ${competitors.length} competitors`);

  // Step 1: Vision tagging — writes matched_feature on competitor thumbnails + A+ modules
  console.log('[Collision] Running vision image feature tagging...');
  const { galleryTaxonomy, aplusTaxonomy } = await analyzeImageFeaturesVision(
    ourProduct, competitors, apiKey, endpoint,
  );

  // Step 2: Review aspect extraction — our product first, then competitors (capped at 3 concurrent)
  await extractReviewAspects(ourProduct as Record<string, unknown>, apiKey, endpoint);

  const sem = makeSemaphore(ASPECT_CONCURRENCY);
  await Promise.all(competitors.map(async comp => {
    await sem.acquire();
    try {
      await extractReviewAspects(comp as Record<string, unknown>, apiKey, endpoint);
    } catch (e) {
      console.error(`[Collision] Aspect extraction failed for competitor: ${e}`);
    } finally {
      sem.release();
    }
  }));

  // Step 3: Battle cards — pure data, no LLM (same as Raza — zero cost, always succeeds)
  const battleCards: BattleCard[] = competitors.map(comp => generateBattleCard(ourProduct, comp));
  console.log(`[Collision] Built ${battleCards.length} battle cards`);

  return {
    visual_taxonomy: galleryTaxonomy,
    aplus_taxonomy:  aplusTaxonomy,
    battle_cards:    battleCards,
  };
}
