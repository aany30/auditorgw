export interface Planned {
  spend: number;
  reach: number;
  impressions: number;
  frequency?: number;
  cpm?: number;
  vtr?: number;
  ctr?: number;
  views?: number;
  clicks?: number;
}

export interface PlanItem {
  entityType: "campaign" | "adset" | "ad";
  entityId: string;
  entityName: string;
  campaignId: string;
  parentId?: string;
  plan: Planned;
}

export interface PlanGroup {
  id: string;
  name: string;
  items: PlanItem[];
  panelFocusIds?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SavedPlanStoreV2 {
  version: 2;
  groups: PlanGroup[];
}

export interface DrillPathEntry {
  type: "campaign" | "adset" | "ad" | "io" | "li";
  id: string;
  name: string;
}

/**
 * Hierarchical selection for the Aggregate combo picker's drill-down tree.
 * Roll-up rule: undefined arrays mean "everything under this level".
 *   { dimensionValue: "Video" }                                  → all campaigns using Video
 *   { dimensionValue: "Video", campaignIds: ["c1", "c2"] }       → all ad sets/ads in c1, c2 that use Video
 *   { dimensionValue: "Video", campaignIds:["c1"], adSetIds:[…]}  → all ads in the given ad sets under c1
 *   { dimensionValue: "Video", …, adSetIds:[…], adIds:[…]}        → only these specific ads
 */
export interface HierNodeSelection {
  dimensionValue: string;
  campaignIds?: string[];
  adSetIds?: string[];
  adIds?: string[];
}

/**
 * A saved combo for the Aggregate section's Channel/Objective/Creative views.
 * `metaValues`/`dv360Values` are the multi-selected labels for that dimension
 * (empty array = "all"); `plannedMeta`/`plannedDv360` are the planned targets
 * entered for that platform's combined row.
 *
 * `metaHier`/`dv360Hier` (optional) carry the richer drill-down selection when
 * the user has narrowed down to specific campaigns / ad sets / ads within a
 * dimension value. When present, they take precedence over `metaValues`/
 * `dv360Values` for delivered-metric computation. Older saved plans without
 * these fields keep working (flat-values path).
 */
export interface AggComboSelection {
  metaValues: string[];
  dv360Values: string[];
  metaHier?: HierNodeSelection[];
  dv360Hier?: HierNodeSelection[];
  plannedMeta: Record<string, number>;
  plannedDv360: Record<string, number>;
}

export interface AggPlanGroup {
  id: string;
  name: string;
  dimension: "channel" | "objective" | "creative";
  /** panels[0] = the main row's combo; panels[1:] = extra ("+ Add another") panels. */
  panels: AggComboSelection[];
  createdAt: number;
  updatedAt: number;
}

export interface AggPlanGroupStore {
  version: 1;
  groups: AggPlanGroup[];
}
