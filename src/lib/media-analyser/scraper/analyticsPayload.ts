/**
 * Pure mapper: ecom audit outputs -> the analytics agent's `CombinedScraperData`
 * payload (mirrors sample_scraper_payload.json). No I/O — unit-testable.
 */

type Rec = Record<string, any>;

export interface AuditMapperInput {
  targetProduct: Rec | null;
  /** All deep-scraped competitors (e.g. 10) — full listing data for the brief. */
  competitorProducts?: Rec[];
  /** Subset used for LLM battle cards / pain points (e.g. top 4). */
  competitorsAnalyzed?: number;
  painPoints?: Rec[];
  strategicActions?: Rec[];
  battleCards?: Rec[];
}

const arr = (v: any): any[] => (Array.isArray(v) ? v : []);

const reviewCount = (p: Rec): number =>
  Number(p.ratings_total ?? p.reviews_total ?? p.reviewCount ?? 0) || 0;

function listingCounts(p: Rec) {
  return {
    bulletCount: arr(p.bullets).length,
    aplusModuleCount: arr(p.a_plus).length,
    imageCount: arr(p.thumbnails).length,
  };
}

function tagsBySentiment(p: Rec, sentiment: string): string[] {
  return arr(p.sentiment_tags)
    .filter((t) => String(t?.sentiment ?? '').toLowerCase() === sentiment)
    .map((t) => String(t?.tag ?? '').trim())
    .filter(Boolean);
}

function reviewThemes(p: Rec, kind: 'positive' | 'negative'): string[] {
  const key = kind === 'positive' ? 'top_10_positive_reviews' : 'top_10_negative_reviews';
  return arr(p[key])
    .map((r) => {
      if (typeof r === 'string') return r.trim();
      return String(r?.body ?? r?.text ?? '').trim();
    })
    .filter(Boolean)
    .slice(0, 3);
}

function competitorInsight(c: Rec, analyzed: boolean) {
  const counts = listingCounts(c);
  return {
    asin: String(c.asin ?? ''),
    platform: c.platform ? String(c.platform) : null,
    title: c.title ?? null,
    brand: c.brand ?? null,
    category: c.generic_category ?? c.categories_flat ?? null,
    price: c.price ?? null,
    rating: c.rating ?? null,
    reviewCount: reviewCount(c),
    ...counts,
    headline: c.headline ?? c.winning_hook ?? null,
    positiveTags: tagsBySentiment(c, 'positive'),
    negativeTags: tagsBySentiment(c, 'negative'),
    positiveReviewThemes: reviewThemes(c, 'positive'),
    negativeReviewThemes: reviewThemes(c, 'negative'),
    reviewsFetched: c.reviews_fetched_count ?? null,
    deepAnalyzed: analyzed,
  };
}

function battleCardInsight(bc: Rec) {
  const metrics = bc['1v1_metrics'] ?? {};
  const attack = String(bc.attack_vector ?? '').trim();
  const counter = String(bc.counter_strategy ?? '').trim();
  const vuln = String(bc.vulnerability ?? '').trim();
  return {
    competitorAsin: String(bc.competitor_asin ?? bc.competitorAsin ?? ''),
    competitorTitle: bc.competitor_title ?? null,
    verdict: vuln || counter || attack || null,
    attackVector: attack || null,
    counterStrategy: counter || null,
    vulnerability: vuln || null,
    metrics,
    ourAdvantages: arr(bc.our_advantages ?? bc.ourAdvantages),
    theirAdvantages: attack
      ? [attack, ...arr(bc.their_advantages ?? bc.theirAdvantages)].filter(Boolean)
      : arr(bc.their_advantages ?? bc.theirAdvantages),
  };
}

export function buildAnalyticsPayload(input: AuditMapperInput) {
  const target = input.targetProduct ?? {};
  const allCompetitors = arr(input.competitorProducts);
  const analyzedCount = input.competitorsAnalyzed ?? allCompetitors.length;
  const analyzedAsins = new Set(
    allCompetitors.slice(0, analyzedCount).map((c) => String(c.asin ?? '')),
  );
  const painPoints = arr(input.painPoints);
  const strategicActions = arr(input.strategicActions);
  const battleCards = arr(input.battleCards);

  const product = {
    name: String(target.title ?? target.asin ?? 'Target product'),
    asin: target.asin ?? null,
    platform: target.platform ? String(target.platform) : null,
    title: target.title ?? null,
    brand: target.brand ?? null,
    category: target.generic_category ?? target.categories_flat ?? null,
    rating: target.rating ?? null,
    reviewCount: reviewCount(target),
    price: target.price ?? null,
    // Optional: official social links scraped from the brand's homepage footer
    // (set by runBrandWebsiteAudit; absent for marketplace audits)
    socialLinks: target.socialLinks ?? null,
    ...listingCounts(target),
    positiveTags: tagsBySentiment(target, 'positive'),
    negativeTags: tagsBySentiment(target, 'negative'),
    painPoints: painPoints.map((pp) => ({
      summary: String(pp.summary ?? ''),
      frequency: Number(pp.frequency ?? 0) || 0,
      severity: Number(pp.severity ?? 0) || 0,
    })),
    strategicActions: strategicActions.map((sa) => ({
      priority: String(sa.priority ?? 'MEDIUM'),
      title: String(sa.title ?? ''),
    })),
    competitors: allCompetitors.map((c) =>
      competitorInsight(c, analyzedAsins.has(String(c.asin ?? ''))),
    ),
    battleCards: battleCards.map(battleCardInsight),
  };

  return {
    scope: 'ecom' as const,
    sourceCounts: {
      ecomProjects: 1,
      ecomCompetitors: allCompetitors.length,
      ecomCompetitorsAnalyzed: Math.min(analyzedCount, allCompetitors.length),
      socialPosts: 0,
      socialMetrics: 0,
      competitorRuns: 0,
    },
    ecom: {
      projectCount: 1,
      completedProjectCount: 1,
      competitorCount: allCompetitors.length,
      competitorsScraped: allCompetitors.length,
      competitorsAnalyzed: Math.min(analyzedCount, allCompetitors.length),
      battleCardCount: battleCards.length,
      averageTargetRating: target.rating ?? null,
      averageTargetReviewCount: reviewCount(target) || null,
      products: [product],
    },
  };
}
