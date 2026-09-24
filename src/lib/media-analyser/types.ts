import { z } from "zod";

export type SourceScope = "ecom" | "social" | "both";
export type Severity = "high" | "medium" | "low";

const EcomCompetitorInsightSchema = z.object({
  asin: z.string(),
  platform: z.string().nullish(),
  title: z.string().nullish(),
  brand: z.string().nullish(),
  category: z.string().nullish(),
  price: z.string().nullish(),
  rating: z.number().nullish(),
  reviewCount: z.number().nullish(),
  bulletCount: z.number().default(0),
  aplusModuleCount: z.number().default(0),
  imageCount: z.number().default(0),
  headline: z.string().nullish(),
  positiveTags: z.array(z.string()).default([]),
  negativeTags: z.array(z.string()).default([]),
  positiveReviewThemes: z.array(z.string()).default([]),
  negativeReviewThemes: z.array(z.string()).default([]),
  reviewsFetched: z.number().nullish(),
  deepAnalyzed: z.boolean().default(false),
}).passthrough();
export type EcomCompetitorInsight = z.infer<typeof EcomCompetitorInsightSchema>;

const EcomBattleCardInsightSchema = z.object({
  competitorAsin: z.string(),
  competitorTitle: z.string().nullish(),
  verdict: z.string().nullish(),
  attackVector: z.string().nullish(),
  counterStrategy: z.string().nullish(),
  vulnerability: z.string().nullish(),
  metrics: z.record(z.string(), z.unknown()).default({}),
  ourAdvantages: z.array(z.string()).default([]),
  theirAdvantages: z.array(z.string()).default([]),
}).passthrough();
export type EcomBattleCardInsight = z.infer<typeof EcomBattleCardInsightSchema>;

const PainPointSchema = z.object({
  summary: z.string(),
  frequency: z.number().default(0),
  severity: z.number().default(0),
}).passthrough();

const StrategicActionSchema = z.object({
  priority: z.string().default("MEDIUM"),
  title: z.string(),
}).passthrough();

const EcomProductInsightSchema = z.object({
  name: z.string(),
  asin: z.string().nullish(),
  platform: z.string().nullish(),
  title: z.string().nullish(),
  brand: z.string().nullish(),
  category: z.string().nullish(),
  rating: z.number().nullish(),
  reviewCount: z.number().nullish(),
  price: z.string().nullish(),
  bulletCount: z.number().default(0),
  aplusModuleCount: z.number().default(0),
  imageCount: z.number().default(0),
  positiveTags: z.array(z.string()).default([]),
  negativeTags: z.array(z.string()).default([]),
  painPoints: z.array(PainPointSchema).default([]),
  strategicActions: z.array(StrategicActionSchema).default([]),
  competitors: z.array(EcomCompetitorInsightSchema).default([]),
  battleCards: z.array(EcomBattleCardInsightSchema).default([]),
}).passthrough();
export type EcomProductInsight = z.infer<typeof EcomProductInsightSchema>;

export const EcomSnapshotSchema = z.object({
  projectCount: z.number().default(0),
  completedProjectCount: z.number().default(0),
  competitorCount: z.number().default(0),
  competitorsScraped: z.number().default(0),
  competitorsAnalyzed: z.number().default(0),
  battleCardCount: z.number().default(0),
  rainforestCallCount: z.number().default(0),
  rainforestCreditsUsed: z.number().default(0),
  averageTargetRating: z.number().nullish(),
  averageTargetReviewCount: z.number().nullish(),
  products: z.array(EcomProductInsightSchema).default([]),
}).passthrough();
export type EcomSnapshot = z.infer<typeof EcomSnapshotSchema>;

const SocialAggregateSchema = z.object({
  key: z.string(),
  posts: z.number().default(0),
  avgEngagementRate: z.number().nullish(),
}).passthrough();
export type SocialAggregate = z.infer<typeof SocialAggregateSchema>;

const SocialTopPostSchema = z.object({
  platform: z.string(),
  format: z.string(),
  contentBucket: z.string().nullish(),
  likes: z.number().default(0),
  comments: z.number().default(0),
  views: z.number().nullish(),
  engagementRate: z.number().nullish(),
}).passthrough();

const SocialMarketingPostSchema = z.object({
  platform: z.string(),
  postUrl: z.string().default(""),
  format: z.string().default("post"),
  publishedAt: z.string().nullish(),
  captionSnippet: z.string().default(""),
  imageUrl: z.string().nullish(),
  thumbnailUrl: z.string().nullish(),
  likes: z.number().default(0),
  comments: z.number().default(0),
  views: z.number().nullish(),
  engagementRate: z.number().nullish(),
  marketingAngle: z.string().default("General product"),
  hook: z.string().nullish(),
  cta: z.string().nullish(),
  postAnalysis: z.string().nullish(),
  productUrlMatched: z.boolean().default(true),
  matchReason: z.string().nullish(),
  matchScore: z.number().nullish(),
}).passthrough();
export type SocialMarketingPost = z.infer<typeof SocialMarketingPostSchema>;

const InstagramImageAnalysisSchema = z.object({
  postUrl: z.string().default(""),
  imageUrl: z.string().nullish(),
  // 4-5 line Gemini description of what is actually shown in the creative.
  description: z.string().nullish(),
  visualStyle: z.string().nullish(),
  contentType: z.string().nullish(),
  dominantColors: z.array(z.string()).default([]),
  composition: z.string().nullish(),
  hasTextOverlay: z.boolean().default(false),
  mood: z.string().nullish(),
  brandElements: z.array(z.string()).default([]),
  engagementRate: z.number().nullish(),
}).passthrough();
export type InstagramImageAnalysis = z.infer<typeof InstagramImageAnalysisSchema>;

// Per-ad strategic analysis derived by Gemini from the ad's copy + metadata
// (works for every ad — video or still — since it needs no image fetch).
const AdCampaignAnalysisSchema = z.object({
  summary: z.string().nullish(),
  angle: z.string().nullish(),
  audience: z.string().nullish(),
  messaging: z.string().nullish(),
  funnelStage: z.string().nullish(),
}).passthrough();
export type AdCampaignAnalysis = z.infer<typeof AdCampaignAnalysisSchema>;

export const SocialPaidAdSchema = z.object({
  adId: z.string().default(""),
  adName: z.string().default(""),
  platform: z.string().default("meta"),
  pageName: z.string().default(""),
  title: z.string().default(""),
  body: z.string().default(""),
  imageUrl: z.string().nullish(),
  thumbnailUrl: z.string().nullish(),
  videoUrl: z.string().nullish(),
  mediaType: z.string().nullish(),
  startTime: z.string().nullish(),
  stopTime: z.string().nullish(),
  linkUrl: z.string().nullish(),
  cta: z.string().nullish(),
  status: z.string().nullish(),
  isActive: z.boolean().default(true),
  instagramUrl: z.string().nullish(),
  matchReason: z.string().nullish(),
  publisherPlatforms: z.array(z.string()).default([]),
  runningDays: z.number().nullish(),
  durationBucket: z.enum(["new", "recent", "established", "long_running", "unknown"]).nullish(),
  platformBucket: z.enum(["facebook_only", "instagram_only", "multi_platform", "other"]).nullish(),
  adSnapshotUrl: z.string().nullish(),
  pageId: z.string().nullish(),
  categories: z.array(z.string()).default([]),
  audienceSizeMin: z.number().nullish(),
  audienceSizeMax: z.number().nullish(),
  adCreativeAnalysis: InstagramImageAnalysisSchema.nullish(),
  adCampaignAnalysis: AdCampaignAnalysisSchema.nullish(),
  // Structural influencer signals from the Ad Library payload (Tier-0).
  brandedContent: z.boolean().nullish(),
  partnershipLabel: z.string().nullish(),
  pageCategories: z.array(z.string()).default([]),
  advertiserEntityType: z.string().nullish(),
  igActor: z.string().nullish(),
  /** Meta collates near-identical ad versions into one card; "~N results" counts versions. */
  collationCount: z.number().nullish(),
}).passthrough();
export type SocialPaidAd = z.infer<typeof SocialPaidAdSchema>;

const PaidAdBucketGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(["active", "inactive"]),
  platformBucket: z.enum(["facebook_only", "instagram_only", "multi_platform", "other"]),
  durationBucket: z.enum(["new", "recent", "established", "long_running", "unknown"]),
  count: z.number(),
  ads: z.array(SocialPaidAdSchema).default([]),
});
export type PaidAdBucketGroup = z.infer<typeof PaidAdBucketGroupSchema>;

const PaidAdsSummarySchema = z.object({
  active: z.number().default(0),
  inactive: z.number().default(0),
  byPlatform: z.object({
    facebook_only: z.number().default(0),
    instagram_only: z.number().default(0),
    multi_platform: z.number().default(0),
    other: z.number().default(0),
  }).default({
    facebook_only: 0,
    instagram_only: 0,
    multi_platform: 0,
    other: 0,
  }),
  byDuration: z.object({
    new: z.number().default(0),
    recent: z.number().default(0),
    established: z.number().default(0),
    long_running: z.number().default(0),
    unknown: z.number().default(0),
  }).default({
    new: 0,
    recent: 0,
    established: 0,
    long_running: 0,
    unknown: 0,
  }),
});
export type PaidAdsSummary = z.infer<typeof PaidAdsSummarySchema>;

const ContentPillarSchema = z.object({
  name: z.string(),
  percentage: z.number().default(0),
  avgEngagementRate: z.number().nullish(),
  description: z.string().nullish(),
}).passthrough();
export type ContentPillar = z.infer<typeof ContentPillarSchema>;

const CampaignConceptSchema = z.object({
  title: z.string(),
  theme: z.string(),
  keyMessage: z.string(),
  hook: z.string(),
  cta: z.string(),
  recommendedFormats: z.array(z.string()).default([]),
  toneNotes: z.string(),
  visualDirection: z.string(),
}).passthrough();
export type CampaignConcept = z.infer<typeof CampaignConceptSchema>;

const InstagramBrandProfileSchema = z.object({
  // Meta
  analyzedPostCount: z.number().default(0),

  // Brand Identity
  brandName: z.string().nullish(),
  industry: z.string().nullish(),
  tagline: z.string().nullish(),
  valueProposition: z.string().nullish(),

  // Voice & Messaging
  toneOfVoice: z.array(z.string()).default([]),
  brandPersonality: z.array(z.string()).default([]),
  targetAudience: z.string().nullish(),
  keyMessages: z.array(z.string()).default([]),

  // Visual Identity
  primaryColors: z.array(z.string()).default([]),
  secondaryColors: z.array(z.string()).default([]),
  imageryStyle: z.string().nullish(),
  layoutStyle: z.string().nullish(),
  dominantMood: z.string().nullish(),
  brandConsistencyScore: z.number().nullish(),

  // Content Strategy
  contentPillars: z.array(ContentPillarSchema).default([]),
  topFormats: z.array(z.string()).default([]),
  textOverlayRate: z.number().default(0),
  topPerformingFormats: z.array(z.string()).default([]),

  // Campaign Concepts
  campaignConcepts: z.array(CampaignConceptSchema).default([]),

  // Raw analyses
  imageAnalyses: z.array(InstagramImageAnalysisSchema).default([]),
}).passthrough();
export type InstagramBrandProfile = z.infer<typeof InstagramBrandProfileSchema>;

const ReproductionPromptSchema = z.object({
  sceneName: z.string().default(""),
  basis: z.string().default("inferred"),
  visualPrompt: z.string().default(""),
  negativePrompt: z.string().default(""),
}).passthrough();
export type ReproductionPrompt = z.infer<typeof ReproductionPromptSchema>;

export const SocialSnapshotSchema = z.object({
  profileCount: z.number().default(0),
  postCount: z.number().default(0),
  successfulPostCount: z.number().default(0),
  metricCount: z.number().default(0),
  avgEngagementRate: z.number().nullish(),
  competitorSetCount: z.number().default(0),
  competitorRunCount: z.number().default(0),
  competitorPostCount: z.number().default(0),
  byFormat: z.array(SocialAggregateSchema).default([]),
  byContentBucket: z.array(SocialAggregateSchema).default([]),
  topPosts: z.array(SocialTopPostSchema).default([]),
  competitorAvgEngagementRate: z.number().nullish(),
  competitorAvgFollowers: z.number().nullish(),
  marketingPosts: z.array(SocialMarketingPostSchema).default([]),
  instagramProductPosts: z.array(SocialMarketingPostSchema).default([]),
  paidAds: z.array(SocialPaidAdSchema).default([]),
  paidAdBuckets: z.array(PaidAdBucketGroupSchema).default([]),
  paidAdsSummary: PaidAdsSummarySchema.nullish(),
  paidAdsAnalysis: z.string().nullish(),
  paidAdsFetchError: z.string().nullish(),
  // Google Ads Transparency Center (parallel to the Meta paidAds above; platform "google").
  googleAds: z.array(SocialPaidAdSchema).default([]),
  googleAdBuckets: z.array(PaidAdBucketGroupSchema).default([]),
  googleAdsSummary: PaidAdsSummarySchema.nullish(),
  googleAdsAnalysis: z.string().nullish(),
  googleAdsFetchError: z.string().nullish(),
  // LinkedIn organic company posts (apimaestro shape; loose passthrough). NOT LinkedIn Ads.
  linkedInPosts: z.array(z.record(z.string(), z.unknown())).optional(),
  productMatchedCount: z.number().default(0),
  totalFetchedCount: z.number().default(0),
  instagramFetchedCount: z.number().default(0),
  facebookFetchedCount: z.number().default(0),
  socialDataSource: z.string().nullish(),
  brandProfilePicUrl: z.string().nullish(),
  instagramBrandProfile: InstagramBrandProfileSchema.nullish(),
  brandVisualProfile: z.record(z.string(), z.unknown()).nullish(),
  reproductionPrompts: z.array(ReproductionPromptSchema).nullish(),
  brandVisualDnaStatus: z.string().nullish(),
}).passthrough();
export type SocialSnapshot = z.infer<typeof SocialSnapshotSchema>;

const RedditReviewItemSchema = z.object({
  subreddit: z.string().default(""),
  title: z.string().default(""),
  body: z.string().default(""),
  url: z.string().default(""),
  score: z.number().default(0),
  numComments: z.number().default(0),
  kind: z.string().default("post"),
  sentiment: z.string().nullish(),
  matchReason: z.string().nullish(),
  matchScore: z.number().nullish(),
}).passthrough();
export type RedditReviewItem = z.infer<typeof RedditReviewItemSchema>;

export const RedditSnapshotSchema = z.object({
  searchQueries: z.array(z.string()).default([]),
  totalFetchedCount: z.number().default(0),
  matchedCount: z.number().default(0),
  postCount: z.number().default(0),
  commentCount: z.number().default(0),
  avgScore: z.number().nullish(),
  bySentiment: z.array(SocialAggregateSchema).default([]),
  reviews: z.array(RedditReviewItemSchema).default([]),
  analysisBrief: z.string().nullish(),
}).passthrough();
export type RedditSnapshot = z.infer<typeof RedditSnapshotSchema>;

const CreativeSnapshotSchema = z.object({
  assets: z.array(z.record(z.string(), z.unknown())).default([]),
  aggregates: z.record(z.string(), z.unknown()).default({}),
  competitorCreatives: z.array(z.record(z.string(), z.unknown())).default([]),
}).passthrough();
export type CreativeSnapshot = z.infer<typeof CreativeSnapshotSchema>;

const SourceCountsSchema = z.object({
  ecomProjects: z.number().default(0),
  ecomCompetitors: z.number().default(0),
  ecomCompetitorsAnalyzed: z.number().default(0),
  socialPosts: z.number().default(0),
  socialMetrics: z.number().default(0),
  redditReviews: z.number().default(0),
  competitorRuns: z.number().default(0),
}).passthrough();
export type SourceCounts = z.infer<typeof SourceCountsSchema>;

export const CombinedScraperDataSchema = z.object({
  scope: z.enum(["ecom", "social", "both"]).default("both"),
  ecom: EcomSnapshotSchema.nullish(),
  social: SocialSnapshotSchema.nullish(),
  reddit: RedditSnapshotSchema.nullish(),
  creative: CreativeSnapshotSchema.nullish(),
  sourceCounts: SourceCountsSchema.default({ ecomProjects: 0, ecomCompetitors: 0, ecomCompetitorsAnalyzed: 0, socialPosts: 0, socialMetrics: 0, redditReviews: 0, competitorRuns: 0 }),
}).passthrough();
export type CombinedScraperData = z.infer<typeof CombinedScraperDataSchema>;

const InsightItemSchema = z.object({
  title: z.string(),
  detail: z.string(),
  severity: z.enum(["high", "medium", "low"]),
}).passthrough();
export type InsightItem = z.infer<typeof InsightItemSchema>;

export const DeterministicInsightsSchema = z.object({
  headline: z.string(),
  keyFindings: z.array(z.string()),
  opportunities: z.array(z.string()),
  risks: z.array(z.string()),
  recommendedActions: z.array(z.string()),
  insights: z.array(InsightItemSchema),
  sourceCounts: SourceCountsSchema,
}).passthrough();
export type DeterministicInsights = z.infer<typeof DeterministicInsightsSchema>;

export const LlmEnrichmentResultSchema = z.object({
  used: z.boolean().default(false),
  model: z.string().nullish(),
  headline: z.string().nullish(),
  keyFindings: z.array(z.string()).default([]),
  opportunities: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  recommendedActions: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
  rationale: z.array(z.string()).default([]),
  error: z.string().nullish(),
}).passthrough();
export type LlmEnrichmentResult = z.infer<typeof LlmEnrichmentResultSchema>;

const AnalysisSummarySchema = z.object({
  headline: z.string(),
  keyFindings: z.array(z.string()),
  scope: z.enum(["ecom", "social", "both"]),
  generatedAt: z.string(),
}).passthrough();
export type AnalysisSummary = z.infer<typeof AnalysisSummarySchema>;

const AnalysisRecommendationsSchema = z.object({
  opportunities: z.array(z.string()),
  risks: z.array(z.string()),
  recommendedActions: z.array(z.string()),
  insights: z.array(InsightItemSchema),
  llmRecommendations: z.array(z.string()),
  llmRationale: z.array(z.string()),
  llmUsed: z.boolean(),
  llmModel: z.string().nullish(),
  llmError: z.string().nullish(),
}).passthrough();

// Lightweight per-competitor social data (Instagram posts + Meta ads), reusing
// the same post/ad shapes as the user's own brand. No heavy enrichment.
export const CompetitorSocialSchema = z.object({
  brand: z.string(),
  handle: z.string().nullish(),
  why: z.string().nullish(),
  posts: z.array(SocialMarketingPostSchema),
  ads: z.array(SocialPaidAdSchema),
  googleAds: z.array(SocialPaidAdSchema).default([]),
  postCount: z.number(),
  adCount: z.number(),
  googleAdCount: z.number().default(0),
  linkedInPosts: z.array(z.record(z.string(), z.unknown())).optional(),
  warning: z.string().nullish(),
}).passthrough();
export type CompetitorSocial = z.infer<typeof CompetitorSocialSchema>;

export const AnalysisResponseSchema = z.object({
  summary: AnalysisSummarySchema,
  recommendations: AnalysisRecommendationsSchema,
  sourceCounts: SourceCountsSchema,
  ecomSnapshot: EcomSnapshotSchema.nullish(),
  socialSnapshot: SocialSnapshotSchema.nullish(),
  redditSnapshot: RedditSnapshotSchema.nullish(),
  creativeSnapshot: CreativeSnapshotSchema.nullish(),
  competitorSocial: z.array(CompetitorSocialSchema).nullish(),
}).passthrough();
export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

export interface RawSocialPost {
  platform: string;
  post_id: string;
  post_url: string;
  caption: string;
  created_at?: string | null;
  media_type?: string;
  likes: number;
  comments: number;
  views?: number | null;
  link_urls: string[];
  image_url?: string | null;
  thumbnail_url?: string | null;
  owner_username?: string | null;
  owner_profile_pic?: string | null;
}

export interface RawRedditItem {
  post_id: string;
  subreddit: string;
  title: string;
  body: string;
  url: string;
  score: number;
  num_comments: number;
  created_utc?: number | null;
  kind: string;
  parent_post_id?: string | null;
}

export interface ProductContext {
  product_url: string;
  title: string;
  brand: string;
  category: string;
  bullets: string[];
  asin_or_id: string;
}

const BrandbookTypographySchema = z.object({
  primary: z.string().default(""),
  secondary: z.string().default(""),
  guidance: z.string().default(""),
}).passthrough();

const BrandbookRecentPostSchema = z.object({
  imageUrl: z.string().nullish(),
  caption: z.string().default(""),
  angle: z.string().nullish(),
  platform: z.string().nullish(),
  likes: z.number().default(0),
  comments: z.number().default(0),
  engagementRate: z.number().nullish(),
  publishedAt: z.string().nullish(),
  analysis: z.string().nullish(),
}).passthrough();
export type BrandbookRecentPost = z.infer<typeof BrandbookRecentPostSchema>;

const BrandbookSocialStatsSchema = z.object({
  avgEngagementRate: z.number().nullish(),
  analyzedPostCount: z.number().nullish(),
  consistencyScore: z.number().nullish(),
  dominantMood: z.string().nullish(),
  postCount: z.number().nullish(),
}).passthrough();
export type BrandbookSocialStats = z.infer<typeof BrandbookSocialStatsSchema>;

const BrandbookGanttItemSchema = z.object({
  label: z.string().default(""),
  startMs: z.number().nullish(),
  endMs: z.number(),
  runningDays: z.number().nullish(),
  isActive: z.boolean().default(false),
  platformBucket: z.string().default("other"),
}).passthrough();

const BrandbookPaidAdStatsSchema = z.object({
  total: z.number().default(0),
  active: z.number().default(0),
  inactive: z.number().default(0),
  avgRunningDays: z.number().nullish(),
  stillCount: z.number().default(0),
  videoCount: z.number().default(0),
  longestRunningDays: z.number().nullish(),
  longestRunningLabel: z.string().nullish(),
  newestStart: z.string().nullish(),
  maxRunningDays: z.number().default(1),
  rangeStartMs: z.number().default(0),
  rangeEndMs: z.number().default(0),
  byPlatform: z.object({
    facebook_only: z.number().default(0),
    instagram_only: z.number().default(0),
    multi_platform: z.number().default(0),
    other: z.number().default(0),
  }).default({ facebook_only: 0, instagram_only: 0, multi_platform: 0, other: 0 }),
  byDuration: z.object({
    new: z.number().default(0),
    recent: z.number().default(0),
    established: z.number().default(0),
    long_running: z.number().default(0),
    unknown: z.number().default(0),
  }).default({ new: 0, recent: 0, established: 0, long_running: 0, unknown: 0 }),
  byMonth: z.array(z.object({ label: z.string(), count: z.number() })).default([]),
  timeline: z.array(BrandbookGanttItemSchema).default([]),
}).passthrough();
export type BrandbookPaidAdStats = z.infer<typeof BrandbookPaidAdStatsSchema>;

// ── Brand Field Journal (magazine-format synthesis output) ───────────────────
const JournalTraitSchema = z.object({
  name: z.string().default(""),
  description: z.string().default(""),
}).passthrough();

const JournalRecommendationSchema = z.object({
  title: z.string().default(""),
  body: z.string().default(""),
  evidenceRef: z.string().default(""),
}).passthrough();

const BrandbookQuoteSchema = z.object({
  text: z.string().default(""),
  source: z.string().nullish(),
  sentiment: z.string().nullish(),
}).passthrough();
export type BrandbookQuote = z.infer<typeof BrandbookQuoteSchema>;

export const BrandbookJournalSchema = z.object({
  cover: z.object({
    brandName: z.string().default(""),
    tagline: z.string().default(""),
    editionLabel: z.string().default(""),
    captureWindow: z.string().default(""),
  }).default({ brandName: "", tagline: "", editionLabel: "", captureWindow: "" }),
  executiveRead: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
    whatsWorking: z.string().default(""),
    whatsSlipping: z.string().default(""),
    firstMove: z.string().default(""),
  }).default({ headline: "", lede: "", whatsWorking: "", whatsSlipping: "", firstMove: "" }),
  brandIdentity: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
    traits: z.array(JournalTraitSchema).default([]),
    soundsLike: z.string().default(""),
    doesntSoundLike: z.string().default(""),
  }).default({ headline: "", lede: "", traits: [], soundsLike: "", doesntSoundLike: "" }),
  visualSystem: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
    imageryDo: z.array(z.string()).default([]),
    imageryDont: z.array(z.string()).default([]),
  }).optional(),
  instagramPerformance: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
    engagementCurveNote: z.string().default(""),
    formatNote: z.string().default(""),
    cadenceNote: z.string().default(""),
  }).optional(),
  instagramContent: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
    topPostsIntro: z.string().default(""),
    topPostReasons: z.array(z.object({ postRef: z.string().default(""), whyItWorked: z.string().default("") })).default([]),
  }).optional(),
  instagramVoice: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
    captionObservation: z.string().default(""),
    hashtagObservation: z.string().default(""),
  }).optional(),
  audience: z.object({
    headline: z.string().default(""),
    portrait: z.string().default(""),
    themesIntro: z.string().default(""),
  }).default({ headline: "", portrait: "", themesIntro: "" }),
  forumListening: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
    communitiesNote: z.string().default(""),
    voicesNote: z.string().default(""),
    closingPull: z.string().default(""),
  }).optional(),
  reviewSentiment: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
    praiseIntro: z.string().default(""),
    complaintIntro: z.string().default(""),
  }).optional(),
  verbatimQuotes: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
  }).optional(),
  // v1 compat alias kept for existing renders
  voiceOfCustomer: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
    closingObservation: z.string().default(""),
  }).optional(),
  paidOverview: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
    closingObservation: z.string().default(""),
  }).optional(),
  paidCreative: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
    retiredPatternNote: z.string().default(""),
    closingPull: z.string().default(""),
  }).optional(),
  paidTimeline: z.object({
    headline: z.string().default(""),
    cadenceNote: z.string().default(""),
    survivorsNote: z.string().default(""),
  }).optional(),
  paidGallery: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
    closingObservation: z.string().default(""),
  }).optional(),
  // v1 compat alias
  paidMedia: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
    closingObservation: z.string().default(""),
  }).optional(),
  competitive: z.object({
    headline: z.string().default(""),
    lede: z.string().default(""),
    sovNote: z.string().default(""),
    pillarNote: z.string().default(""),
  }).optional(),
  recommendations: z.array(JournalRecommendationSchema).default([]),
  colophon: z.object({
    methodologyNote: z.string().default(""),
  }).optional(),
}).passthrough();
export type BrandbookJournal = z.infer<typeof BrandbookJournalSchema>;

export const BrandbookProfileSchema = z.object({
  brandName: z.string(),
  tagline: z.string(),
  industry: z.string(),
  valueProposition: z.string(),
  targetAudience: z.string(),
  toneOfVoice: z.array(z.string()).default([]),
  brandPersonality: z.array(z.string()).default([]),
  keyMessages: z.array(z.string()).default([]),
  primaryColors: z.array(z.string()).default([]),
  secondaryColors: z.array(z.string()).default([]),
  typography: BrandbookTypographySchema.default({ primary: "", secondary: "", guidance: "" }),
  logoUrl: z.string().nullish(),
  heroImageUrl: z.string().nullish(),
  imageryUrls: z.array(z.string()).default([]),
  brandOverview: z.string().default(""),
  valuesStatement: z.string().default(""),
  imageryStyle: z.string().default(""),
  imageryGuidelines: z.array(z.string()).default([]),
  layoutStyle: z.string().default(""),
  moodKeywords: z.array(z.string()).default([]),
  lightingNotes: z.string().optional(),
  // Social + Meta ads intelligence (target brand only)
  socialAnalysis: z.string().default(""),
  socialStats: BrandbookSocialStatsSchema.default({}),
  contentPillars: z.array(ContentPillarSchema).default([]),
  recentPosts: z.array(BrandbookRecentPostSchema).default([]),
  paidAds: z.array(SocialPaidAdSchema).default([]),
  paidAdsSummary: PaidAdsSummarySchema.nullish(),
  paidAdStats: BrandbookPaidAdStatsSchema.nullish(),
  paidAdsAnalysis: z.string().default(""),
  // Brand Field Journal (magazine synthesis) + supporting verbatims
  journal: BrandbookJournalSchema.nullish(),
  customerQuotes: z.array(BrandbookQuoteSchema).default([]),
}).passthrough();
export type BrandbookProfile = z.infer<typeof BrandbookProfileSchema>;

export const BrandbookUpdateSchema = z.object({
  phase: z.enum(["queued", "synthesizing", "rendering", "done", "error"]),
  message: z.string().optional(),
  pdfBase64: z.string().optional(),
  profile: BrandbookProfileSchema.optional(),
}).passthrough();
export type BrandbookUpdate = z.infer<typeof BrandbookUpdateSchema>;
