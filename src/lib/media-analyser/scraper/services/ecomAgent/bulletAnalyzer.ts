/**
 * Bullet Analyzer — LLM-driven bullet point comparison across products.
 * Port of execution/bullet_analyzer.py.
 * CF Worker compatible — no Node.js APIs.
 *
 * Takes target product bullets + competitor bullets, asks the LLM to derive
 * 10 meaningful categories, then maps each product's bullets to those categories.
 *
 * Output:
 * {
 *   "categories": [
 *     {
 *       "name": "Category Name",
 *       "by_product": [
 *         { "asin": "...", "title": "Brand X", "is_target": bool, "bullet": "snippet or null" }
 *       ]
 *     }
 *   ],
 *   "unique_claims": [
 *     { "asin": "...", "title": "Brand X", "is_target": bool, "bullet": "unique bullet text" }
 *   ]
 * }
 */

export interface BulletByProduct {
  asin:      string;
  title:     string;
  is_target: boolean;
  bullet:    string | null;
}

export interface BulletCategory {
  name:       string;
  by_product: BulletByProduct[];
}

export interface BulletAnalysisResult {
  categories:    BulletCategory[];
  unique_claims: BulletByProduct[];
  source?:       string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortTitle(title: string | undefined, asin: string): string {
  if (title) {
    const words = title.split(' ');
    return words.length >= 3 ? words.slice(0, 3).join(' ') : title;
  }
  return asin || 'Unknown';
}

function truncateBullet(value: unknown, limit = 140): string {
  const text = String(value ?? '').trim();
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1).trimEnd() + '…';
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let text = raw.trim()
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '');
  const candidates = [text];
  const m = text.match(/\{[\s\S]*\}/);
  if (m) candidates.push(m[0]);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
    } catch { continue; }
  }
  return null;
}

interface ProductEntry {
  asin:      string;
  title:     string;
  is_target: boolean;
  bullets:   string[];
}

function buildProducts(
  targetProduct: Record<string, unknown>,
  competitors: Record<string, unknown>[],
): ProductEntry[] {
  const targetAsin   = String(targetProduct.asin ?? 'TARGET');
  const targetTitle  = shortTitle(targetProduct.title as string, targetAsin);
  const targetBullets = (targetProduct.bullets as string[] | undefined) ?? [];

  const all: ProductEntry[] = [
    { asin: targetAsin, title: targetTitle, is_target: true, bullets: targetBullets },
  ];
  for (const c of (competitors ?? [])) {
    all.push({
      asin:      String(c.asin ?? '?'),
      title:     shortTitle(c.title as string, String(c.asin ?? '?')),
      is_target: false,
      bullets:   (c.bullets as string[] | undefined) ?? [],
    });
  }
  return all;
}

// ─── Deterministic fallback (no LLM key) ──────────────────────────────────────

const CATEGORY_KEYWORDS: Array<[string, string[]]> = [
  ['Suction Power',   ['suction', 'pa', 'vacuum', 'power']],
  ['Navigation',      ['navigation', 'lidar', 'mapping', 'map', 'sensor', 'obstacle']],
  ['Mopping',         ['mop', 'mopping', 'water', 'wash', 'scrub']],
  ['Self Cleaning',   ['self-clean', 'self clean', 'cleaning base', 'hot wash', 'auto wash']],
  ['Dust Collection', ['dust', 'bag', 'bin', 'empty', 'station']],
  ['Runtime',         ['runtime', 'run time', 'battery', 'minute', 'hours', 'charging']],
  ['App Control',     ['app', 'alexa', 'google', 'voice', 'smart', 'zone']],
  ['Pet Hair',        ['pet', 'hair', 'tangle', 'anti-tangle', 'brush']],
  ['Floor Coverage',  ['floor', 'carpet', 'hard floor', 'edge', 'corner']],
  ['Warranty',        ['warranty', 'service', 'support', 'guarantee']],
  ['Design',          ['compact', 'slim', 'design', 'white', 'black']],
  ['Value Pack',      ['accessory', 'included', 'combo', 'bundle']],
];

function localBulletAnalysis(allProducts: ProductEntry[], maxCategories = 10): BulletAnalysisResult {
  const usedPairs = new Set<string>();
  const categories: BulletCategory[] = [];

  for (const [name, keywords] of CATEGORY_KEYWORDS) {
    if (categories.length >= maxCategories) break;
    const byProduct: BulletByProduct[] = [];
    let hasAny = false;
    for (const product of allProducts) {
      let chosen: string | null = null;
      for (let idx = 0; idx < (product.bullets ?? []).length; idx++) {
        const text = String(product.bullets[idx] ?? '');
        const lower = text.toLowerCase();
        if (keywords.some(k => lower.includes(k))) {
          chosen = truncateBullet(text);
          usedPairs.add(`${product.asin}:${idx}`);
          hasAny = true;
          break;
        }
      }
      byProduct.push({ asin: product.asin, title: product.title, is_target: product.is_target, bullet: chosen });
    }
    if (hasAny) categories.push({ name, by_product: byProduct });
  }

  // Fill remaining slots from positional bullets (slots 0-7)
  let slot = 0;
  while (categories.length < maxCategories && slot < 8) {
    const byProduct: BulletByProduct[] = [];
    let hasAny = false;
    for (const product of allProducts) {
      const bullets = product.bullets ?? [];
      const bullet  = slot < bullets.length ? truncateBullet(bullets[slot]) : null;
      if (bullet) { hasAny = true; usedPairs.add(`${product.asin}:${slot}`); }
      byProduct.push({ asin: product.asin, title: product.title, is_target: product.is_target, bullet });
    }
    if (hasAny) categories.push({ name: `Listing Claim ${slot + 1}`, by_product: byProduct });
    slot++;
  }

  const uniqueClaims: BulletByProduct[] = [];
  for (const product of allProducts) {
    for (let idx = 0; idx < (product.bullets ?? []).length; idx++) {
      if (usedPairs.has(`${product.asin}:${idx}`)) continue;
      const text = truncateBullet(product.bullets[idx]);
      if (!text) continue;
      uniqueClaims.push({ asin: product.asin, title: product.title, is_target: product.is_target, bullet: text });
      break;
    }
    if (uniqueClaims.length >= 10) break;
  }

  return {
    categories:    categories.slice(0, maxCategories),
    unique_claims: uniqueClaims,
    source:        'deterministic_fallback',
  };
}

// ─── Main function ─────────────────────────────────────────────────────────────

/**
 * Derives bullet-point comparison categories across target + competitors.
 * Returns BulletAnalysisResult or null on failure.
 */
export async function analyzeProductBullets(
  targetProduct: Record<string, unknown>,
  competitors: Record<string, unknown>[],
  llmKey: string,
  maxCategories = 10,
): Promise<BulletAnalysisResult | null> {
  const allProducts = buildProducts(targetProduct, competitors);

  const hasBullets = allProducts.filter(p => p.bullets.length > 0).length;
  if (hasBullets < 2) return null;

  if (!llmKey) {
    console.log('  [BulletAnalyzer] No LLM key — using deterministic fallback');
    return localBulletAnalysis(allProducts, maxCategories);
  }

  const lines: string[] = [];
  for (const p of allProducts) {
    const label = p.is_target ? 'YOU' : p.title;
    for (let i = 0; i < Math.min(p.bullets.length, 8); i++) {
      const b = String(p.bullets[i] ?? '').trim();
      if (b) lines.push(`[${p.asin}|${label}|b${i + 1}] ${b.slice(0, 200)}`);
    }
  }
  if (!lines.length) return null;

  const bulletsBlock = lines.join('\n');
  const nProducts    = allProducts.length;

  const systemMsg = (
    'You are an Amazon competitive intelligence analyst. ' +
    'You read bullet points from multiple Amazon product listings and identify ' +
    'the common categories they address (e.g. "Material Quality", "Ease of Setup", ' +
    '"Temperature Control", "Power", "Warranty"). ' +
    'Then you map each product\'s best matching bullet to each category.'
  );

  const userMsg = [
    `Products compared: ${nProducts} (1 target + ${nProducts - 1} competitors)\n\n`,
    'Each line: [ASIN|brand_label|bN] text\n\n',
    `${bulletsBlock}\n\n`,
    `Step 1: Derive exactly ${maxCategories} meaningful categories covering `,
    'the key product dimensions across all listings. ',
    'Use short Amazon-style noun phrases (1-3 words): e.g. "Heating Speed", ',
    '"Material Quality", "Ease of Setup", "Value for Money", "Safety Features".\n\n',
    'Step 2: For each category, find the SINGLE best matching bullet from each ',
    'product (or null if that product doesn\'t address it). Truncate to 120 chars.\n\n',
    'Step 3: Identify up to 10 "unique claims" — bullets only ONE product mentions ',
    '(no other product addresses this feature). Most distinctive only.\n\n',
    'Return STRICT JSON:\n',
    '{\n',
    '  "categories": [\n',
    '    {\n',
    '      "name": "Category Name",\n',
    '      "by_product": [\n',
    '        {"asin": "B0...", "bullet": "snippet or null"},\n',
    '        ...\n',
    '      ]\n',
    '    }\n',
    '  ],\n',
    '  "unique_claims": [\n',
    '    {"asin": "B0...", "bullet": "unique bullet text"}\n',
    '  ]\n',
    '}\n\n',
    'Rules:\n',
    `- Exactly ${maxCategories} categories.\n`,
    '- by_product must include ALL products in the same order as input.\n',
    '- Use JSON null (not string "null") when no matching bullet exists.\n',
    '- unique_claims: up to 10 most distinctive.\n',
    '- No markdown, no commentary. JSON only.',
  ].join('');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${llmKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user',   content: userMsg },
        ],
        max_tokens: 3500,
        temperature: 0,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
    const data    = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw     = data.choices?.[0]?.message?.content?.trim() ?? '';
    const parsed  = parseJsonObject(raw);
    if (!parsed) throw new Error('LLM returned malformed JSON');

    const asinMeta: Record<string, ProductEntry> = {};
    const productOrder: string[] = [];
    for (const p of allProducts) {
      asinMeta[p.asin] = p;
      productOrder.push(p.asin);
    }

    const categories: BulletCategory[] = [];
    for (const cat of ((parsed.categories as Array<Record<string, unknown>>) ?? [])) {
      const name = String(cat.name ?? '').trim();
      if (!name) continue;

      // Collect bullets indexed by asin from LLM response
      const parsedByAsin: Record<string, string | null> = {};
      for (const bp of ((cat.by_product as Array<Record<string, unknown>>) ?? [])) {
        const asin = String(bp.asin ?? '');
        if (!asinMeta[asin]) continue;
        let bullet = bp.bullet;
        if (typeof bullet === 'string') {
          bullet = bullet.trim() || null;
          if (bullet && (bullet as string).toLowerCase() === 'null') bullet = null;
        } else if (bullet !== null && bullet !== undefined) {
          bullet = null;
        }
        parsedByAsin[asin] = bullet as string | null;
      }

      // Always build by_product in stable product_order
      const byProduct: BulletByProduct[] = productOrder.map(asin => ({
        asin,
        title:     asinMeta[asin]?.title ?? asin,
        is_target: asinMeta[asin]?.is_target ?? false,
        bullet:    parsedByAsin[asin] ?? null,
      }));
      categories.push({ name, by_product: byProduct });
    }

    const uniqueClaims: BulletByProduct[] = [];
    for (const uc of ((parsed.unique_claims as Array<Record<string, unknown>>) ?? []).slice(0, 10)) {
      const asin   = String(uc.asin ?? '');
      const bullet = String(uc.bullet ?? '').trim();
      if (!bullet) continue;
      uniqueClaims.push({
        asin,
        title:     asinMeta[asin]?.title ?? asin,
        is_target: asinMeta[asin]?.is_target ?? false,
        bullet,
      });
    }

    if (!categories.length) {
      console.warn('  [BulletAnalyzer] LLM returned no usable categories; using deterministic fallback');
      return localBulletAnalysis(allProducts, maxCategories);
    }

    return { categories: categories.slice(0, maxCategories), unique_claims: uniqueClaims };
  } catch (e) {
    console.warn(`  [BulletAnalyzer] LLM failed: ${e}; using deterministic fallback`);
    return localBulletAnalysis(allProducts, maxCategories);
  }
}
