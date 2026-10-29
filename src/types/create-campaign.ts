// ── Meta campaign creation ────────────────────────────────────────────────

export interface MetaCampaignInput {
  name: string;
  objective: MetaObjective;
  special_ad_categories: string[];
  buying_type: "AUCTION";
  status: "PAUSED";
  daily_budget?: number;       // minor currency units (cents/paise)
  lifetime_budget?: number;    // minor currency units
}

export type MetaObjective =
  | "OUTCOME_AWARENESS"
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_ENGAGEMENT"
  | "OUTCOME_LEADS"
  | "OUTCOME_APP_PROMOTION"
  | "OUTCOME_SALES";

export interface MetaAdSetInput {
  campaign_id: string;
  name: string;
  optimization_goal: string;
  billing_event: string;
  daily_budget?: number;
  lifetime_budget?: number;
  start_time: string;          // ISO 8601
  end_time?: string;           // ISO 8601, required for lifetime budget
  targeting: {
    geo_locations: { countries: string[] };
    age_min?: number;
    age_max?: number;
    genders?: number[];        // 0=all, 1=male, 2=female
  };
  bid_strategy?: string;
  promoted_object?: Record<string, unknown>;
}

export interface MetaAdInput {
  adset_id: string;
  name: string;
  creative: {
    name: string;
    object_story_spec: {
      page_id: string;
      link_data: {
        link: string;
        message: string;
        picture?: string;       // image URL
        name?: string;          // headline
        description?: string;
        call_to_action?: { type: string; value?: { link: string } };
      };
    };
  };
  status: "PAUSED";
}

// ── DV360 campaign creation ───────────────────────────────────────────────

export interface DV360DateObj {
  year: number;
  month: number;
  day: number;
}

export interface DV360CampaignInput {
  displayName: string;
  entityStatus: "ENTITY_STATUS_PAUSED";
  campaignGoal: {
    campaignGoalType: string;
    performanceGoal: {
      performanceGoalType: string;
      performanceGoalAmountMicros?: string;
    };
  };
  campaignFlight: {
    plannedDates: { startDate: DV360DateObj; endDate: DV360DateObj };
  };
  frequencyCap: {
    unlimited?: boolean;
    timeUnit?: string;
    timeUnitCount?: number;
    maxImpressions?: number;
  };
}

export interface DV360InsertionOrderInput {
  campaignId: string;
  displayName: string;
  entityStatus: "ENTITY_STATUS_PAUSED";
  pacing: { pacingPeriod: string; pacingType: string };
  frequencyCap: {
    unlimited?: boolean;
    timeUnit?: string;
    timeUnitCount?: number;
    maxImpressions?: number;
  };
  kpi: {
    kpiType: string;
    kpiAmountMicros?: string;
    kpiPercentageMicros?: string;
    kpiString?: string;
  };
  budget: {
    budgetUnit: string;
    budgetSegments: Array<{
      dateRange: { startDate: DV360DateObj; endDate: DV360DateObj };
      budgetAmountMicros: string;
    }>;
  };
}

export interface DV360LineItemInput {
  campaignId: string;
  insertionOrderId: string;
  displayName: string;
  entityStatus: "ENTITY_STATUS_PAUSED";
  lineItemType: string;
  flight: { dateRange: { startDate: DV360DateObj; endDate: DV360DateObj } };
  budget: {
    budgetAllocationType: string;
    budgetUnit: string;
    maxAmount?: string;        // micros
  };
  bidStrategy: Record<string, unknown>;
  frequencyCap?: {
    maxImpressions: number;
    timeUnit: string;
    timeUnitCount: number;
    unlimited: boolean;
  };
}

// ── Google Ads campaign creation ──────────────────────────────────────────

export type GAdsChannelType =
  | "SEARCH"
  | "DISPLAY"
  | "VIDEO"
  | "SHOPPING"
  | "PERFORMANCE_MAX";

export type GAdsBiddingStrategy =
  | "MAXIMIZE_CLICKS"
  | "MAXIMIZE_CONVERSIONS"
  | "MAXIMIZE_CONVERSION_VALUE"
  | "TARGET_CPA"
  | "TARGET_ROAS"
  | "TARGET_IMPRESSION_SHARE"
  | "MANUAL_CPC";

export interface GAdsCampaignInput {
  name: string;
  advertisingChannelType: GAdsChannelType;
  status: "PAUSED";
  biddingStrategyType: GAdsBiddingStrategy;
  dailyBudget: number;          // major currency units (will be × 1,000,000)
  startDate?: string;           // YYYY-MM-DD
  endDate?: string;             // YYYY-MM-DD
  networkSettings?: {
    targetGoogleSearch: boolean;
    targetSearchNetwork: boolean;
    targetContentNetwork: boolean;
    targetPartnerSearchNetwork: boolean;
  };
}

export interface GAdsAdGroupInput {
  name: string;
  type: string;                 // SEARCH_STANDARD, DISPLAY_STANDARD, VIDEO_RESPONSIVE
  cpcBidMicros?: string;        // max CPC in micros
}

export interface GAdsAdInput {
  headlines: string[];           // 3-15 headlines (max 30 chars each)
  descriptions: string[];        // 2-4 descriptions (max 90 chars each)
  finalUrls: string[];
}

// ── Snapchat campaign creation ───────────────────────────────────────────

export type SnapchatObjective =
  | "AWARENESS"
  | "APP_INSTALLS"
  | "DRIVING_TRAFFIC_TO_APP"
  | "DRIVING_TRAFFIC_TO_WEBSITE"
  | "ENGAGEMENT"
  | "LEAD_GENERATION"
  | "VIDEO_VIEWS"
  | "WEB_CONVERSIONS"
  | "CATALOG_SALES";

export type SnapchatBidStrategy =
  | "AUTO_BID"
  | "TARGET_COST"
  | "LOWEST_COST_WITH_MAX_BID";

export interface SnapchatCampaignInput {
  name: string;
  objective?: SnapchatObjective;
  status: "PAUSED";
  daily_budget_micro?: string;
  start_time?: string;           // ISO 8601
  end_time?: string;             // ISO 8601
}

export interface SnapchatAdSquadInput {
  name: string;
  type?: "SNAP_ADS" | "STORY" | "LENS" | "FILTER";
  status: "PAUSED";
  bid_micro?: string;
  bid_strategy?: SnapchatBidStrategy;
  billing_event?: "IMPRESSION" | "SWIPE_UP";
  optimization_goal?: "IMPRESSIONS" | "SWIPES" | "APP_INSTALLS" | "VIDEO_VIEWS" | "PIXEL_PAGE_VIEW" | "PIXEL_PURCHASE";
  daily_budget_micro?: string;
  start_time?: string;
  end_time?: string;
  placement_v2?: { config: string };
  targeting?: Record<string, unknown>;
}

// ── Shared response ───────────────────────────────────────────────────────

export interface CreateCampaignResponse {
  success: boolean;
  campaignId?: string;
  adsetId?: string;            // Meta
  adId?: string;               // Meta
  insertionOrderId?: string;   // DV360
  lineItemId?: string;         // DV360
  adGroupId?: string;          // Google Ads
  adGroupAdId?: string;        // Google Ads
  adSquadId?: string;          // Snapchat
  error?: string;
  partialErrors?: string[];
}
