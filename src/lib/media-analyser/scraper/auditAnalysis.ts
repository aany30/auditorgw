import type { AuditMapperInput } from './analyticsPayload';
import type { EcomEnv } from './config';
import { resolveLLM } from './services/ecomAgent/llm';
import { makeReviewSettings } from './services/ecomAgent/reviewVolume';
import type { ProductData } from './services/ecomAgent/scraper';

export type ProgressFn = (progress: number, message: string) => void;

export async function runAnalysisPhase(
  env: EcomEnv,
  targetProduct: ProductData,
  allCompetitors: ProductData[],
  analysisCompetitors: ProductData[],
  _rawSearchQuery: string,
  reviewSettings: ReturnType<typeof makeReviewSettings>,
  onProgress?: ProgressFn,
): Promise<AuditMapperInput> {
  const { key: llmKey, endpoint: llmEndpoint } = resolveLLM(env);
  const nAll = allCompetitors.length;
  const nLlm = analysisCompetitors.length;

  onProgress?.(
    60,
    `Generating battle cards for top ${nLlm} competitors (${nAll} scraped in total)…`,
  );
  const { processHub } = await import('./services/ecomAgent/collisionEngine');
  const { battle_cards } = await processHub(
    targetProduct,
    analysisCompetitors,
    llmKey,
    llmEndpoint,
  );

  onProgress?.(72, 'Classifying images…');
  try {
    const { classifyImages } = await import('./services/ecomAgent/imageClassifier');
    const openaiKey = env.OPENAI_API_KEY || '';
    await classifyImages(
      targetProduct as unknown as Record<string, unknown>,
      analysisCompetitors as unknown as Record<string, unknown>[],
      openaiKey,
    );
  } catch (e) {
    console.warn('[EcomAudit] imageClassifier failed:', e);
  }

  onProgress?.(79, 'Analysing sentiment tags…');
  const { attachSentimentTags } = await import('./services/ecomAgent/sentimentTags');
  await attachSentimentTags(
    targetProduct as unknown as Record<string, unknown>,
    allCompetitors as unknown as Record<string, unknown>[],
    llmKey,
    llmEndpoint,
    reviewSettings.target_review_limit,
    Math.max(
      10,
      Math.floor(reviewSettings.competitor_review_limit / Math.max(1, allCompetitors.length)),
    ),
  );

  onProgress?.(83, 'Clustering pain points…');
  const { classifyPainPoints } = await import('./services/ecomAgent/painPoints');
  const painPoints = await classifyPainPoints(
    analysisCompetitors as unknown as Record<string, unknown>[],
    llmKey,
    llmEndpoint,
  );

  onProgress?.(88, 'Generating strategic actions…');
  const { generateStrategicActions } = await import('./services/ecomAgent/strategicActions');
  const strategicActions = await generateStrategicActions(
    targetProduct as unknown as Record<string, unknown>,
    analysisCompetitors as unknown as Record<string, unknown>[],
    llmKey,
    5,
    llmEndpoint,
  );

  onProgress?.(93, 'Analysing cross-brand review themes…');
  const { generateCombinedReviewTags } = await import('./services/ecomAgent/combinedReviewTags');
  await generateCombinedReviewTags(
    targetProduct as unknown as Record<string, unknown>,
    analysisCompetitors as unknown as Record<string, unknown>[],
    llmKey,
    18,
    reviewSettings.target_review_limit,
    reviewSettings.competitor_review_limit,
    llmEndpoint,
  ).catch((e) => console.warn('[EcomAudit] combinedReviewTags failed:', e));

  onProgress?.(97, 'Analyzing bullet comparison…');
  try {
    const { analyzeProductBullets } = await import('./services/ecomAgent/bulletAnalyzer');
    await analyzeProductBullets(
      targetProduct as unknown as Record<string, unknown>,
      analysisCompetitors as unknown as Record<string, unknown>[],
      env.OPENAI_API_KEY || '',
      10,
    );
  } catch (e) {
    console.warn('[EcomAudit] bulletAnalyzer failed:', e);
  }

  const { generateCreativeRecommendations } = await import(
    './services/ecomAgent/creativeRecommendations'
  );
  await generateCreativeRecommendations(
    analysisCompetitors as unknown as Record<string, unknown>[],
    painPoints as unknown as Record<string, unknown>[],
    targetProduct as unknown as Record<string, unknown>,
    llmKey,
    llmEndpoint,
  ).catch((e) => console.warn('[EcomAudit] creativeRecommendations failed:', e));

  onProgress?.(100, 'Audit complete');
  return {
    targetProduct: targetProduct as unknown as Record<string, unknown>,
    competitorProducts: allCompetitors as unknown as Record<string, unknown>[],
    competitorsAnalyzed: nLlm,
    painPoints: painPoints as unknown as Record<string, unknown>[],
    strategicActions: strategicActions as unknown as Record<string, unknown>[],
    battleCards: battle_cards as unknown as Record<string, unknown>[],
  };
}
