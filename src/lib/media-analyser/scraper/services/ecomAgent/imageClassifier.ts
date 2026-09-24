/**
 * Image Classifier — emergent category discovery + guaranteed assignment.
 * Port of execution/image_classifier.py (v2 rewrite).
 * CF Worker compatible — no Node.js APIs.
 *
 * Analyzes the full image catalog (target + all competitors) in one pass:
 *   1. Build a manifest: every image gets an ID + text signal.
 *   2. Single LLM call: discover categories from actual visual patterns,
 *      then assign every image to exactly one category.
 *   3. Write image_type AND matched_feature on each image dict in-place.
 *      matched_feature is what the visual matrix columns match against, so
 *      keeping both fields identical guarantees matrix alignment.
 *   4. Return (galleryCats, aplusCats) so the caller can replace
 *      visual_taxonomy / aplus_taxonomy in the synthesis report.
 */

const MAX_SIGNAL_CHARS = 120;

export interface ImageObject {
  url?: string;
  image_url?: string;
  ocr_description?: string;
  visual_desc?: string;
  text_content?: string;
  type?: string;
  image_type?: string;
  matched_feature?: string;
  [key: string]: unknown;
}

interface ManifestItem {
  id: string;
  signal: string;
  kind: 'gallery' | 'aplus';
}

function hasImage(obj: ImageObject, kind: 'gallery' | 'aplus'): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (kind === 'gallery') return !!(obj.url || obj.image_url);
  return !!(obj.image_url || obj.url);
}

function buildManifest(
  targetProduct: Record<string, unknown> | null | undefined,
  competitors: Record<string, unknown>[],
): [ManifestItem[], Map<string, ImageObject>] {
  const manifest: ManifestItem[] = [];
  const idToObj = new Map<string, ImageObject>();

  function addItem(uid: string, obj: ImageObject, kind: 'gallery' | 'aplus', extra = '') {
    if (!hasImage(obj, kind)) return;
    const parts = [
      obj.ocr_description ?? '',
      obj.visual_desc ?? '',
      String(obj.text_content ?? '').slice(0, 80),
      obj.type ?? '',
      extra,
    ].map(p => String(p).trim()).filter(Boolean);
    const signal = parts.join(' | ').slice(0, MAX_SIGNAL_CHARS) || '(no description)';
    manifest.push({ id: uid, signal, kind });
    idToObj.set(uid, obj);
  }

  if (targetProduct) {
    const thumbs = (targetProduct.thumbnails as ImageObject[] | undefined) ?? [];
    for (let i = 0; i < thumbs.length; i++) {
      addItem(`tp_t${i}`, thumbs[i], 'gallery', i === 0 ? 'main product image' : `listing image ${i + 1}`);
    }
    const aplus = (targetProduct.a_plus as ImageObject[] | undefined) ?? [];
    for (let i = 0; i < aplus.length; i++) {
      addItem(`tp_a${i}`, aplus[i], 'aplus');
    }
  }

  for (let ci = 0; ci < (competitors ?? []).length; ci++) {
    const comp = competitors[ci];
    const thumbs = (comp.thumbnails as ImageObject[] | undefined) ?? [];
    for (let i = 0; i < thumbs.length; i++) {
      addItem(`c${ci}_t${i}`, thumbs[i], 'gallery', i === 0 ? 'main product image' : `listing image ${i + 1}`);
    }
    const aplus = (comp.a_plus as ImageObject[] | undefined) ?? [];
    for (let i = 0; i < aplus.length; i++) {
      addItem(`c${ci}_a${i}`, aplus[i], 'aplus');
    }
  }

  return [manifest, idToObj];
}

function fallbackForManifest(manifest: ManifestItem[]): [Record<string, string>, string[], string[]] {
  const assignments: Record<string, string> = {};
  for (const m of manifest) {
    assignments[m.id] = m.kind === 'gallery' ? 'Gallery' : 'A+ Content';
  }
  const galleryCats = manifest.some(m => m.kind === 'gallery') ? ['Gallery'] : [];
  const aplusCats   = manifest.some(m => m.kind === 'aplus')   ? ['A+ Content'] : [];
  return [assignments, galleryCats, aplusCats];
}

function cleanCategories(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values ?? []) {
    const label = String(v ?? '').trim();
    const key = label.toLowerCase();
    if (label && !seen.has(key)) {
      result.push(label);
      seen.add(key);
    }
  }
  return result;
}

async function discoverAndAssign(
  manifest: ManifestItem[],
  openaiKey: string,
  modelId: string,
): Promise<[Record<string, string>, string[], string[]]> {
  if (!openaiKey) return fallbackForManifest(manifest);

  const n = manifest.length;
  const catalog = manifest.map(m => `[${m.id}|${m.kind}] ${m.signal}`).join('\n');

  const prompt = [
    `You are analyzing ${n} Amazon product listing images across a product and its competitors.\n\n`,
    'Each line: [id|kind] text_signal\n',
    '  kind=gallery → listing thumbnail (1:1 square)\n',
    '  kind=aplus   → A+ enhanced content module (16:9 landscape)\n\n',
    'TASK:\n',
    '1. Identify 6–10 GALLERY categories and 4–8 APLUS categories based on actual visual patterns.\n',
    '   Good gallery examples: Hero Product Shot, Lifestyle Scene, Dimension Diagram, Feature Callout, ',
    'Packaging, Color Variants, How-To Usage\n',
    '   Good aplus examples: Brand Story, Comparison Chart, Technical Specs, Feature Grid, Infographic, ',
    'Hero Banner, Social Proof\n',
    '2. Assign EVERY image to exactly one category matching its kind.\n',
    '   gallery images → only gallery categories\n',
    '   aplus images   → only aplus categories\n\n',
    'RULES:\n',
    '- Every image ID must appear in assignments exactly once\n',
    '- No image may be skipped or appear twice\n',
    '- Use specific, descriptive category names — not generic labels like "Image 1"\n\n',
    `Image catalog:\n${catalog}\n\n`,
    'Return strict JSON only — no markdown:\n',
    '{\n',
    '  "gallery_categories": ["Cat A", "Cat B", ...],\n',
    '  "aplus_categories": ["Cat X", "Cat Y", ...],\n',
    '  "assignments": {\n',
    '    "id1": "Cat A",\n',
    '    "id2": "Cat X",\n',
    '    ...\n',
    '  }\n',
    '}\n\n',
    `All ${n} IDs must appear in assignments.`,
  ].join('');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: Math.max(4000, n * 20),
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim() ?? '';
    const parsed = JSON.parse(content) as {
      gallery_categories?: unknown[];
      aplus_categories?: unknown[];
      assignments?: Record<string, string>;
    };

    const galleryCats = cleanCategories(parsed.gallery_categories ?? []);
    const aplusCats   = cleanCategories(parsed.aplus_categories ?? []);
    const allCats     = new Set([...galleryCats, ...aplusCats]);
    const rawAssignments = parsed.assignments ?? {};

    const assignments: Record<string, string> = {};
    for (const item of manifest) {
      const assigned = rawAssignments[item.id] ?? '';
      assignments[item.id] = allCats.has(assigned)
        ? assigned
        : item.kind === 'gallery' ? 'Gallery' : 'A+ Content';
    }

    // Reconstruct used categories from actual assignments (covers gaps where LLM didn't return them)
    const usedGallery = manifest.filter(m => m.kind === 'gallery').map(m => assignments[m.id]).filter(Boolean);
    const usedAplus   = manifest.filter(m => m.kind === 'aplus').map(m => assignments[m.id]).filter(Boolean);

    const finalGallery = galleryCats.length ? galleryCats : cleanCategories(usedGallery);
    const finalAplus   = aplusCats.length   ? aplusCats   : cleanCategories(usedAplus);

    for (const label of usedGallery) if (!finalGallery.includes(label)) finalGallery.push(label);
    for (const label of usedAplus)   if (!finalAplus.includes(label))   finalAplus.push(label);

    return [assignments, finalGallery, finalAplus];
  } catch (e) {
    console.warn(`[ImageClassifier] discoverAndAssign failed: ${e}`);
    return fallbackForManifest(manifest);
  }
}

/**
 * Classify all images using emergent category discovery.
 *
 * Mutates every thumbnail and a_plus dict in targetProduct and competitors
 * in-place, adding:
 *   image_type      — human-readable category label (used for display badges)
 *   matched_feature — same value, drives visual matrix column matching
 *
 * Returns [galleryCats, aplusCats] so the caller can update
 * visual_taxonomy / aplus_taxonomy in the synthesis report.
 */
export async function classifyImages(
  targetProduct: Record<string, unknown> | null | undefined,
  competitors: Record<string, unknown>[],
  openaiKey: string,
  classifierModel = 'gpt-4o-mini',
): Promise<[string[], string[]]> {
  const [manifest, idToObj] = buildManifest(targetProduct, competitors);
  if (!manifest.length) return [[], []];

  const [assignments, galleryCats, aplusCats] = await discoverAndAssign(manifest, openaiKey, classifierModel);

  let tagged = 0;
  for (const [uid, category] of Object.entries(assignments)) {
    const obj = idToObj.get(uid);
    if (obj) {
      obj.image_type      = category;
      obj.matched_feature = category;
      tagged++;
    }
  }

  console.log(`[ImageClassifier] Tagged ${tagged} images → ${galleryCats.length} gallery + ${aplusCats.length} A+ categories`);
  if (galleryCats.length) console.log(`[ImageClassifier] Gallery: ${galleryCats.join(', ')}`);
  if (aplusCats.length)   console.log(`[ImageClassifier] A+: ${aplusCats.join(', ')}`);

  return [galleryCats, aplusCats];
}
