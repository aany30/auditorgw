import type { AnalysisResponse, CombinedScraperData, DeterministicInsights, LlmEnrichmentResult, SocialSnapshot } from "./types";
import { buildDeterministicInsights } from "./metrics";
import { generateLlmEnrichment } from "./llm";
import { buildIgBrandProfile } from "./meta-social";

async function enrichSocialWithBrandProfile(social: SocialSnapshot | null | undefined, data: CombinedScraperData): Promise<SocialSnapshot | null | undefined> {
  if (!social) return social;
  if (social.instagramBrandProfile) return social;
  const igPosts = (social.marketingPosts ?? []).filter(p => p.platform?.toLowerCase() === "instagram");
  if (!igPosts.length) return social;
  try {
    const profile = await buildIgBrandProfile(
      igPosts,
      data,
      social.brandVisualProfile as Record<string, unknown> | undefined,
    );
    if (profile) return { ...social, instagramBrandProfile: profile };
  } catch (err) {
    console.warn(`[service] Brand profile enrichment skipped: ${err}`);
  }
  return social;
}

function pick(primary: string[], fallback: string[], llmUsed: boolean): string[] {
  return llmUsed && primary.length ? primary : fallback;
}

export async function analyzeScraperInsights(
  data: CombinedScraperData,
  opts?: { useLlm?: boolean }
): Promise<AnalysisResponse> {
  const { useLlm = true } = opts ?? {};
  const enrichedSocial = await enrichSocialWithBrandProfile(data.social, data);
  const deterministic: DeterministicInsights = buildDeterministicInsights(data);
  const llm: LlmEnrichmentResult = await generateLlmEnrichment(data, deterministic, { enabled: useLlm });

  return {
    summary: {
      headline: (llm.used && llm.headline) ? llm.headline : deterministic.headline,
      keyFindings: pick(llm.keyFindings, deterministic.keyFindings, llm.used),
      scope: data.scope,
      generatedAt: new Date().toISOString(),
    },
    recommendations: {
      opportunities: pick(llm.opportunities, deterministic.opportunities, llm.used),
      risks: pick(llm.risks, deterministic.risks, llm.used),
      recommendedActions: pick(llm.recommendedActions, deterministic.recommendedActions, llm.used),
      insights: deterministic.insights,
      llmRecommendations: llm.recommendations,
      llmRationale: llm.rationale,
      llmUsed: llm.used,
      llmModel: llm.model ?? null,
      llmError: llm.error ?? null,
    },
    sourceCounts: data.sourceCounts,
    ecomSnapshot: data.ecom ?? null,
    socialSnapshot: enrichedSocial ?? null,
    redditSnapshot: data.reddit ?? null,
    creativeSnapshot: data.creative ?? null,
  };
}
