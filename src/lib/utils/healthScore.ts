import { HealthScore, MetaPixelData, EMQMetrics, FunnelStage } from "@/types";

/**
 * Calculate pixel health score (0-100) based on various metrics
 */
export function calculatePixelHealth(pixelData: MetaPixelData): number {
  if (!pixelData) return 0;

  let score = 100;

  // Event firing consistency (20 points max deduction)
  if (pixelData.eventFiringConsistency < 80) {
    score -= (80 - pixelData.eventFiringConsistency) * 0.25;
  }

  // Duplicate events (15 points max deduction)
  if (pixelData.duplicateEvents > 0) {
    const deduction = Math.min(15, pixelData.duplicateEvents * 2);
    score -= deduction;
  }

  // Event latency (10 points max deduction)
  if (pixelData.averageLatency > 5000) {
    const deduction = Math.min(10, (pixelData.averageLatency - 5000) / 500);
    score -= deduction;
  }

  // Inactive status (30 points deduction)
  if (pixelData.status === "inactive") {
    score -= 30;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Calculate Event Match Quality (EMQ) score (0-100)
 */
export function calculateEMQScore(emqMetrics: EMQMetrics): number {
  if (!emqMetrics) return 0;

  const weights = {
    emailHashQuality: 0.3,
    phoneHashQuality: 0.2,
    externalIdCoverage: 0.2,
    ipUserAgentAvailability: 0.15,
    overallScore: 0.15,
  };

  const score =
    emqMetrics.emailHashQuality * weights.emailHashQuality +
    emqMetrics.phoneHashQuality * weights.phoneHashQuality +
    emqMetrics.externalIdCoverage * weights.externalIdCoverage +
    emqMetrics.ipUserAgentAvailability * weights.ipUserAgentAvailability +
    emqMetrics.overallScore * weights.overallScore;

  return Math.round(score);
}

/**
 * Calculate funnel health based on conversion stages
 */
export function calculateFunnelHealth(funnel: FunnelStage[]): number {
  if (!funnel || funnel.length === 0) return 0;

  // Define healthy conversion rate benchmarks
  const benchmarks: Record<string, number> = {
    pageview: 1.0,
    viewContent: 0.8,
    addToCart: 0.5,
    initiate_checkout: 0.3,
    purchase: 0.15,
  };

  let totalScore = 0;
  let benchmarkCount = 0;

  funnel.forEach((stage) => {
    const benchmark = benchmarks[stage.stage] || 0.5;
    if (stage.conversionRate > 0) {
      // Score: how close to benchmark (100 if at benchmark, less if below)
      const stageScore = Math.min(100, (stage.conversionRate / benchmark) * 100);
      totalScore += stageScore;
      benchmarkCount++;
    }
  });

  return benchmarkCount > 0 ? Math.round(totalScore / benchmarkCount) : 0;
}

/**
 * Calculate attribution readiness score
 */
export function calculateAttributionScore(setupChecks: {
  aggregatedEventMeasurementSetup: boolean;
  domainVerified: boolean;
  priorityEventConfigured: boolean;
  attributionSettingsOptimal: boolean;
  consentModeEnabled: boolean;
  iosTrackingReady: boolean;
}): number {
  const checks = Object.values(setupChecks).filter((v) => typeof v === "boolean");
  const passedChecks = Object.values(setupChecks).filter((v) => v === true).length;

  return Math.round((passedChecks / checks.length) * 100);
}

/**
 * Calculate CAPI health score
 */
export function calculateCapiHealth(capiMetrics: {
  browserServerDuplication: number;
  eventIdConsistency: number;
  deduplicationHealth: number;
  missingPayloadParameters: number;
  matchKeyCoverage: number;
  apiResponseFailures: number;
  serverLatency: number;
}): number {
  let score = 100;

  // Browser-server duplication (20 points deduction if poor)
  if (capiMetrics.browserServerDuplication < 90) {
    score -= (90 - capiMetrics.browserServerDuplication) * 0.2;
  }

  // Event ID consistency (15 points)
  if (capiMetrics.eventIdConsistency < 95) {
    score -= (95 - capiMetrics.eventIdConsistency) * 0.15;
  }

  // Deduplication health (20 points)
  if (capiMetrics.deduplicationHealth < 85) {
    score -= (85 - capiMetrics.deduplicationHealth) * 0.2;
  }

  // Missing parameters (15 points)
  if (capiMetrics.missingPayloadParameters > 5) {
    score -= Math.min(15, capiMetrics.missingPayloadParameters * 3);
  }

  // Match key coverage (15 points)
  if (capiMetrics.matchKeyCoverage < 80) {
    score -= (80 - capiMetrics.matchKeyCoverage) * 0.15;
  }

  // API failures (15 points)
  if (capiMetrics.apiResponseFailures > 1) {
    score -= Math.min(15, capiMetrics.apiResponseFailures * 5);
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Calculate overall health score from component scores
 */
export function calculateOverallScore(scores: {
  pixelHealth?: number;
  emqScore?: number;
  capiHealth?: number;
  funnelHealth?: number;
  conversionHealth?: number;
  gaHealth?: number;
  gtmHealth?: number;
  attributionScore?: number;
}): HealthScore {
  const validScores = Object.values(scores).filter(
    (s) => typeof s === "number" && s >= 0 && s <= 100
  ) as number[];

  const overallScore =
    validScores.length > 0
      ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length)
      : 0;

  let status: "healthy" | "moderate" | "critical" = "healthy";
  if (overallScore < 60) {
    status = "critical";
  } else if (overallScore < 80) {
    status = "moderate";
  }

  return {
    overall: overallScore,
    ...scores,
    status,
    lastUpdated: new Date(),
  };
}

/**
 * Get color for health score
 */
export function getHealthScoreColor(score: number): string {
  if (score >= 80) return "text-healthy"; // Green
  if (score >= 60) return "text-warning"; // Yellow
  return "text-critical"; // Red
}

/**
 * Get background color for health score
 */
export function getHealthScoreBgColor(score: number): string {
  if (score >= 80) return "bg-healthy/20"; // Green
  if (score >= 60) return "bg-warning/20"; // Yellow
  return "bg-critical/20"; // Red
}

/**
 * Get status label
 */
export function getStatusLabel(score: number): string {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "Moderate";
  return "Critical";
}
