/**
 * Content tag extraction from competitor copy.
 * Port of Amazon-scraper-GW/server/src/lib/contentTags.ts — CF Worker compatible.
 */

import { callLLM, stripJsonFences } from './llm';

export interface ContentTag {
  text: string;
  source_evidence: string;
}

export async function extractContentTags(
  competitors: Array<Record<string, unknown>>,
  apiKey: string,
  endpoint?: string,
): Promise<ContentTag[]> {
  let contentText = '';
  for (const comp of competitors) {
    const brand = String(comp.title ?? comp.asin ?? 'Unknown').slice(0, 30);
    for (const bullet of (comp.bullets as string[] ?? [])) {
      if (bullet) contentText += `[${brand} bullet]: ${bullet}\n`;
    }
    for (const mod of (comp.a_plus as Array<Record<string, unknown>> ?? [])) {
      const txt = String(mod.text_content ?? mod.visual_desc ?? '');
      if (txt) contentText += `[${brand} A+]: ${txt.slice(0, 200)}\n`;
    }
  }
  if (!contentText.trim()) return [];

  // Cap to prevent response truncation on large competitor sets (Raza has no cap but hits same bug)
  const cappedText = contentText.slice(0, 6000);

  const prompt =
    `You are a content strategist analyzing Amazon product listing text.\n\n` +
    `Extract 10-20 key content tags — specific marketing claims, feature phrases, and positioning angles found in the text below. ` +
    `Each tag must include the exact text excerpt it was derived from as source_evidence.\n\n` +
    `Text:\n${cappedText}\n\n` +
    `Return a JSON array:\n` +
    `[{"text": "tag phrase (2-5 words)", "source_evidence": "exact excerpt from the text above"}]\n\n` +
    `Rules:\n` +
    `- source_evidence MUST be a direct quote from the text — not paraphrased\n` +
    `- Each tag should be a distinct marketing angle or feature claim\n` +
    `- No markdown fences, no explanation text`;

  try {
    const raw = await callLLM(apiKey, [{ role: 'user', content: prompt }], {
      model: 'gpt-4o-mini',
      maxTokens: 1500,
      temperature: 0,
      endpoint,
    });
    const results = JSON.parse(stripJsonFences(raw)) as ContentTag[];
    return results.filter(item => item.text?.trim() && item.source_evidence?.trim());
  } catch (e) {
    console.error(`[ContentTags] Failed: ${e}`);
    return [];
  }
}
