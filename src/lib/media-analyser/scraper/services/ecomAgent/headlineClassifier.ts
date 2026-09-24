import { callLLM, stripJsonFences, LLM_MODEL } from './llm';

export interface HeadlineClassification {
  asin: string;
  title: string;
  winning_hook: string;
  hook_type: 'Feature-led' | 'Benefit-led' | 'Social proof' | 'Price-anchored' | 'Problem-solving';
  rationale: string;
}

const VALID_HOOK_TYPES = new Set(['Feature-led', 'Benefit-led', 'Social proof', 'Price-anchored', 'Problem-solving']);

export async function classifyHeadlines(
  competitors: Record<string, unknown>[],
  apiKey: string,
  endpoint?: string,
): Promise<HeadlineClassification[]> {
  if (!apiKey || !competitors.length) return [];

  const entries = competitors
    .map(c => ({
      asin: String(c.asin ?? 'unknown'),
      title: String(c.title ?? c.headline ?? ''),
      winning_hook: String(c.winning_hook ?? ''),
    }))
    .filter(e => e.title || e.winning_hook);

  if (!entries.length) return [];

  const prompt =
    `You are a marketing copywriter analyzing Amazon product headlines and hooks.\n\n` +
    `For each product below, classify the headline+hook combination into exactly ONE hook type:\n` +
    `- Feature-led: Focuses on specs, dimensions, materials, or technical features\n` +
    `- Benefit-led: Focuses on outcomes, lifestyle improvements, or user benefits\n` +
    `- Social proof: References ratings, bestseller status, or 'loved by X'\n` +
    `- Price-anchored: Emphasizes value, deals, bundle savings, or price comparison\n` +
    `- Problem-solving: Addresses a specific pain point or problem the product solves\n\n` +
    `Products:\n${JSON.stringify(entries, null, 2)}\n\n` +
    `Return a JSON array with one object per product:\n` +
    `[{"asin": "...", "title": "...", "winning_hook": "...", "hook_type": "Feature-led|Benefit-led|Social proof|Price-anchored|Problem-solving", "rationale": "one sentence explaining why"}]\n` +
    `No markdown fences, no explanation text.`;

  try {
    const raw = await callLLM(apiKey, [{ role: 'user', content: prompt }], {
      model: LLM_MODEL,
      maxTokens: 1500,
      temperature: 0,
      endpoint,
    });
    const stripped = stripJsonFences(raw);
    const m = stripped.match(/\[[\s\S]*\]/);
    const results = JSON.parse(m ? m[0] : stripped) as HeadlineClassification[];

    return results.filter(item => {
      if (!item.asin || !item.hook_type) return false;
      if (!VALID_HOOK_TYPES.has(item.hook_type)) item.hook_type = 'Feature-led';
      return true;
    });
  } catch (e) {
    console.error('[HeadlineClassifier] LLM failed:', e);
    return [];
  }
}
