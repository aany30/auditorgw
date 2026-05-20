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
