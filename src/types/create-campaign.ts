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

// ── Shared response ───────────────────────────────────────────────────────

export interface CreateCampaignResponse {
  success: boolean;
  campaignId?: string;
  adsetId?: string;            // Meta
  adId?: string;               // Meta
  insertionOrderId?: string;   // DV360
  lineItemId?: string;         // DV360
  error?: string;
  partialErrors?: string[];
}
