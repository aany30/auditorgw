// API Response Types
export interface MetaPixelData {
  pixelId: string;
  status: "active" | "inactive";
  eventCount: number;
  eventFiringConsistency: number; // percentage
  duplicateEvents: number;
  averageLatency: number; // ms
  matchRate: number; // percentage
  lastUpdated: Date;
}

export interface GoogleConversionData {
  conversionId: string;
  conversionCount: number;
  conversionValue: number;
  duplicateConversions: number;
  attributionModel: string;
  status: "active" | "inactive";
  lastUpdated: Date;
}

export interface EMQMetrics {
  emailHashQuality: number;
  phoneHashQuality: number;
  externalIdCoverage: number;
  ipUserAgentAvailability: number;
  overallScore: number;
}

export interface FunnelStage {
  stage: "pageview" | "viewContent" | "addToCart" | "initiate_checkout" | "purchase";
  count: number;
  conversionRate: number;
}

export interface AuditIssue {
  id: string;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "needs_fix" | "in_progress" | "fixed" | "monitoring";
  estimatedImpact: number; // percentage
  recommendation: string;
  createdAt: Date;
}

export interface HealthScore {
  overall: number;
  pixelHealth?: number;
  emqScore?: number;
  capiHealth?: number;
  funnelHealth?: number;
  attributionScore?: number;
  conversionHealth?: number;
  gaHealth?: number;
  gtmHealth?: number;
  status: "healthy" | "moderate" | "critical";
  lastUpdated: Date;
  trend?: number; // percentage change
}

export interface DashboardMetrics {
  platformHealth: {
    meta?: number;
    google?: number;
    linkedin?: number;
  };
  conversionRate: number;
  dataQuality: number;
  issues: AuditIssue[];
  recommendations: Recommendation[];
}

export interface Recommendation {
  id: string;
  priority: "critical" | "high" | "medium" | "low";
  issue: string;
  impact: number; // estimated improvement %
  action: string;
  effort: "quick" | "medium" | "complex";
}

// Credential Types
export interface MetaCredentials {
  accessToken: string;
  businessId: string;
  pixelIds: string[];
}

export interface GoogleCredentials {
  accessToken: string;
  customerId: string;
  propertyId: string;
  containerId: string;
}

// Date Range
export type DateRange = "7d" | "30d" | "90d" | "custom";

export interface CustomDateRange {
  startDate: Date;
  endDate: Date;
}

// Naming Convention Types
export interface NamingRule {
  id: string;
  label: string;
  placeholder: string;
  description: string;
  required: boolean;
  position: number;
  examples?: string[];
  /**
   * UI input type. "select" renders a dropdown built from `examples`.
   * Defaults to "text" when omitted.
   */
  inputType?: "text" | "select";
}

export interface NamingConvention {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  rules: NamingRule[];
  separator: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignData {
  id: string;
  name: string;
  objective?: string;
  status: string;
  platform: "meta" | "google";
  createdTime?: string;
  /** Campaign end / stop time (ISO). Null/undefined means ongoing. */
  endTime?: string;
  /** Budget + spend fields (optional — populated when Insights data is available). */
  dailyBudget?: number;
  lifetimeBudget?: number;
  spend?: number;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  conversionValue?: number;
  /** 0-100, Google Ads only (search_impression_share). */
  impressionShare?: number;
  /** ISO currency code: "USD", "INR", etc. */
  currency?: string;
}

export interface AdSetData {
  id: string;
  name: string;
  status: string;
}

export interface AdData {
  id: string;
  name: string;
  creativeType?: string;
}

export interface GoogleCampaignData {
  id: string;
  name: string;
  status: string;
  createdTime: string;
}

export interface GoogleAdGroupData {
  id: string;
  name: string;
  status: string;
}

export interface NamingComponent {
  position: number;
  label: string;
  expectedPattern: string;
  actualValue: string | null;
  isPresent: boolean;
  isValid: boolean;
}

export interface NamingComplianceResult {
  campaignId: string;
  campaignName: string;
  platform: "meta" | "google";
  status: "compliant" | "non-compliant";
  /** % of REQUIRED components missing (0-100). >65 → non-compliant. */
  missingPct: number;
  components: NamingComponent[];
  suggestions?: string;
}
