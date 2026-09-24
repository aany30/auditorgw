import type {
  CombinedScraperData,
  DeterministicInsights,
  EcomProductInsight,
  InsightItem,
} from "./types";

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = parseFloat(value);
    return isNaN(n) ? null : n;
  }
  return null;
}

function shortTitle(title: string | null | undefined, asin: string): string {
  const t = (title ?? asin ?? "Competitor").trim();
  return t.length > 58 ? t.slice(0, 55) + "…" : t;
}

function appendInsight(items: InsightItem[], title: string, detail: string, severity: "high" | "medium" | "low"): void {
  if (detail.trim()) {
    items.push({ title, detail, severity });
  }
}

function ecomCompetitorFindings(product: EcomProductInsight): [string[], string[], string[]] {
  const keyFindings: string[] = [];
  const opportunities: string[] = [];
  const risks: string[] = [];

  const targetRating = num(product.rating);
  const targetReviews = num(product.reviewCount) ?? 0;
  const competitors = product.competitors ?? [];
  if (!competitors.length) return [keyFindings, opportunities, risks];

  const analyzed = competitors.filter(c => c.deepAnalyzed).length;
  const scraped = competitors.length;
  keyFindings.push(
    `Competitive set: **${scraped} competitors fully scraped** ` +
    `(${analyzed || Math.min(4, scraped)} received deep AI analysis including battle cards).`
  );

  for (const comp of competitors) {
    const label = shortTitle(comp.title, comp.asin);
    const cr = num(comp.rating);
    const cv = num(comp.reviewCount) ?? 0;

    const gaps: string[] = [];
    if (targetRating !== null && cr !== null && cr > targetRating) {
      gaps.push(`rating ${cr} vs your ${targetRating}`);
    }
    if (cv > targetReviews * 1.5 && targetReviews > 0) {
      gaps.push(`${Math.round(cv).toLocaleString()} reviews vs your ${Math.round(targetReviews).toLocaleString()}`);
    }
    if (comp.bulletCount > product.bulletCount) {
      gaps.push(`${comp.bulletCount} bullets vs your ${product.bulletCount}`);
    }
    if (comp.aplusModuleCount > product.aplusModuleCount) {
      gaps.push(`${comp.aplusModuleCount} A+ modules vs your ${product.aplusModuleCount}`);
    }
    if (comp.imageCount > product.imageCount) {
      gaps.push(`${comp.imageCount} images vs your ${product.imageCount}`);
    }

    if (gaps.length) {
      risks.push(`**${label}** (\`${comp.asin}\`) leads on: ${gaps.join(", ")}.`);
    } else if (cr !== null && targetRating !== null && targetRating >= cr) {
      opportunities.push(
        `**${label}** (\`${comp.asin}\`) trails your ${targetRating}★ rating — defend this position in hero copy.`
      );
    }

    const negTags = comp.negativeTags ?? [];
    if (negTags.length) {
      keyFindings.push(`Competitor **${comp.asin}** negative themes: ${negTags.slice(0, 3).join(", ")}.`);
    }
  }

  for (const bc of product.battleCards ?? []) {
    const asin = bc.competitorAsin ?? "?";
    const verdict = (bc.verdict ?? "").trim();
    if (verdict) keyFindings.push(`Battle card vs **${asin}**: ${verdict}`);
    const their = bc.theirAdvantages ?? [];
    if (their.length) risks.push(`**${asin}** threat: ${their[0].slice(0, 120)}`);
  }

  return [keyFindings, opportunities, risks];
}

export function buildDeterministicInsights(data: CombinedScraperData): DeterministicInsights {
  const insights: InsightItem[] = [];
  const opportunities: string[] = [];
  const risks: string[] = [];
  const recommendedActions: string[] = [];
  const keyFindings: string[] = [];

  if (data.ecom) {
    const ecom = data.ecom;
    keyFindings.push(
      `Ecom coverage includes ${ecom.completedProjectCount} completed audits and ` +
      `${ecom.competitorCount} tracked competitors.`
    );

    if (ecom.completedProjectCount === 0) {
      risks.push("No completed Ecom audits were found, so Amazon-side recommendations are constrained.");
      recommendedActions.push("Run or complete at least one Ecom audit to unlock product-level competitive analysis.");
    } else {
      appendInsight(
        insights,
        "Amazon intelligence coverage",
        `${ecom.completedProjectCount} completed audits are available with ${ecom.battleCardCount} battle cards.`,
        "medium"
      );
    }

    // A rating of 0 means "no rating data" (star ratings are 1-5), not a real 0★ —
    // only flag when there's a genuine low rating so we never print "target rating is 0".
    if (ecom.averageTargetRating !== null && ecom.averageTargetRating !== undefined && ecom.averageTargetRating > 0 && ecom.averageTargetRating < 4.0) {
      risks.push(
        `Average target rating is ${ecom.averageTargetRating}, which signals likely conversion pressure versus better-rated competitors.`
      );
      recommendedActions.push("Prioritize listing fixes around top complaint clusters before scaling paid traffic.");
    }

    if (ecom.averageTargetReviewCount !== null && ecom.averageTargetReviewCount !== undefined && ecom.averageTargetReviewCount < 150) {
      opportunities.push("Review depth is relatively low; social proof growth can improve marketplace trust.");
      recommendedActions.push("Launch a review acquisition loop and track uplift by ASIN over the next 30 days.");
    }

    if (ecom.rainforestCreditsUsed > 0) {
      appendInsight(
        insights,
        "Scraper cost footprint",
        `Rainforest usage totals ${ecom.rainforestCreditsUsed} credits across ${ecom.rainforestCallCount} calls.`,
        "low"
      );
    }

    for (const product of ecom.products) {
      const [compKf, compOpp, compRisk] = ecomCompetitorFindings(product);
      keyFindings.push(...compKf);
      opportunities.push(...compOpp);
      risks.push(...compRisk);
    }
  }

  if (data.social) {
    const social = data.social;
    const matched = social.productMatchedCount || social.postCount;
    const totalFetched = social.totalFetchedCount || 0;
    if (matched && totalFetched) {
      keyFindings.push(
        `Meta social: ${matched} Instagram/Facebook posts matched this product ` +
        `(from ${totalFetched} brand posts fetched via Graph API).`
      );
    }
    const successRate = pct(social.successfulPostCount, social.postCount);
    keyFindings.push(
      `Social coverage includes ${social.postCount} product-matched posts ` +
      `(${successRate}% successful) and ${social.metricCount} metric rows.`
    );

    const severity = successRate < 70 ? "high" : successRate < 85 ? "medium" : "low";
    appendInsight(
      insights,
      "Social scrape reliability",
      `${successRate}% of tracked social posts are in successful scrape state.`,
      severity
    );

    if (successRate < 70) {
      risks.push("Social scrape success rate is below 70%, which weakens trend confidence.");
      recommendedActions.push("Stabilize social scraping inputs and retry failed/expired posts before strategic decisions.");
    } else if (successRate > 90) {
      opportunities.push("High social scrape consistency enables stronger trend and creative signal extraction.");
    }

    if (social.byContentBucket?.length) {
      const topBucket = social.byContentBucket[0];
      opportunities.push(
        `Top Meta marketing angle for this product: **${topBucket.key}** ` +
        `(${topBucket.posts} posts` +
        (topBucket.avgEngagementRate ? `, ${topBucket.avgEngagementRate}% avg engagement` : "") +
        `).`
      );
    }

    if (social.avgEngagementRate !== null && social.avgEngagementRate !== undefined) {
      if (social.avgEngagementRate >= 4) {
        opportunities.push(`Average active engagement rate (${social.avgEngagementRate}%) is strong enough to mine recurring creative patterns.`);
        recommendedActions.push("Use top-performing social formats to inform marketplace hero image and A+ content direction.");
      } else {
        risks.push(`Average active engagement rate (${social.avgEngagementRate}%) is weak and may indicate creative fatigue.`);
        recommendedActions.push("Run creative refresh experiments segmented by content bucket and post format.");
      }
    }

    if (social.competitorRunCount > 0) {
      appendInsight(
        insights,
        "Competitor benchmark readiness",
        `${social.competitorRunCount} competitor benchmark runs are available for comparative analysis.`,
        "medium"
      );
      opportunities.push("Competitor benchmark data can be aligned with Amazon battle cards to prioritize positioning gaps.");
    }
  }

  if (data.reddit) {
    const reddit = data.reddit;
    const matched = reddit.matchedCount || (reddit.reviews ?? []).length;
    if (matched) {
      keyFindings.push(
        `Reddit: ${matched} posts/comments discuss this product ` +
        `(from ${reddit.totalFetchedCount || matched} items searched).`
      );
      const neg = (reddit.reviews ?? []).filter(r => r.sentiment === "negative").length;
      const pos = (reddit.reviews ?? []).filter(r => r.sentiment === "positive").length;
      if (neg > pos && neg >= 2) {
        risks.push(`Reddit sentiment skews negative (${neg} negative-leaning vs ${pos} positive-leaning mentions).`);
        recommendedActions.push("Address recurring Reddit complaints in listing copy, FAQ, and customer support macros.");
      } else if (pos > neg && pos >= 2) {
        opportunities.push(`Reddit advocates for this product (${pos} positive-leaning mentions) — mine quotes for social proof.`);
      }
    }
  }

  if (data.creative) {
    const creative = data.creative;
    const aggregates = creative.aggregates as Record<string, unknown>;
    const assetCount = creative.assets.length;
    const avgVisualClarity = num(aggregates.avgVisualClarity);
    const avgCtaContrast = num(aggregates.avgCtaContrast);
    const ctaCoverage = num(aggregates.ctaCoverageRate);
    const benefitCopyRate = num(aggregates.benefitCopyRate);
    const avgHookScore = num(aggregates.avgHookScore);

    keyFindings.push(
      `Creative coverage includes ${assetCount} assets with ${creative.competitorCreatives.length} competitor creative benchmarks.`
    );

    if (assetCount < 3) {
      risks.push("Creative asset coverage is sparse, so creative recommendations should be treated as directional.");
    } else {
      appendInsight(
        insights,
        "Creative analysis coverage",
        `${assetCount} assets are available for visual, copy, CTA, font, and hook diagnostics.`,
        "low"
      );
    }

    if (avgVisualClarity !== null && avgVisualClarity < 7) {
      risks.push(`Average creative visual clarity is ${avgVisualClarity}, below the 7.0 quality threshold for conversion assets.`);
      recommendedActions.push("Reshoot or redesign low-clarity hero and ad assets before scaling paid spend.");
    }
    if (ctaCoverage !== null && ctaCoverage < 80) {
      risks.push(`CTA coverage is ${ctaCoverage}%, below the 80% benchmark for ad creative discipline.`);
      recommendedActions.push("Add visible high-contrast CTAs to ad assets that currently lack a clear next step.");
    }
    if (avgCtaContrast !== null && avgCtaContrast < 6) {
      risks.push(`Average CTA contrast is ${avgCtaContrast}, which makes conversion prompts weak on mobile.`);
      recommendedActions.push("Raise CTA contrast above 6.0 on all paid creative and mobile-first product visuals.");
    }
    if (benefitCopyRate !== null && benefitCopyRate < 80) {
      opportunities.push(`Benefit-led copy appears on ${benefitCopyRate}% of assets; rewriting feature-led copy can sharpen conversion intent.`);
    }
    if (avgHookScore !== null && avgHookScore >= 7) {
      opportunities.push(`Average creative hook score is ${avgHookScore}, giving the team reusable video-opening patterns.`);
    }
  }

  if (data.ecom && data.social) {
    const hasCrossSignal = data.ecom.completedProjectCount > 0 && data.social.metricCount > 0;
    if (hasCrossSignal) {
      appendInsight(
        insights,
        "Cross-channel insight readiness",
        "Both Amazon audit data and social performance metrics are available for unified strategic recommendations.",
        "low"
      );
      opportunities.push("Build a monthly loop that syncs social winning themes into Amazon listing and A+ optimization.");
      recommendedActions.push("Create a recurring cross-scraper review cadence with one owner and fixed KPI checkpoints.");
    } else {
      risks.push("Cross-channel insight quality is limited because one side of the data is sparse.");
    }
  }

  if (!recommendedActions.length) {
    recommendedActions.push("Increase both Amazon and social data coverage to improve recommendation quality.");
  }
  if (!opportunities.length) {
    opportunities.push("No major upside signal detected yet; enrich data depth to unlock sharper opportunities.");
  }

  let headline: string;
  if (data.scope === "both") {
    headline = "Cross-scraper signals indicate where Amazon strategy and social performance can reinforce each other.";
  } else if (data.scope === "ecom") {
    headline = "Amazon competitive intelligence highlights listing gaps versus scraped competitors and battle-card threats.";
  } else {
    headline = "Social scraper insights highlight engagement trends and content performance priorities.";
  }

  return {
    headline,
    keyFindings,
    opportunities,
    risks,
    recommendedActions,
    insights,
    sourceCounts: data.sourceCounts,
  };
}
