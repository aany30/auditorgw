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
 * A saved combo for the Aggregate section's Channel/Objective/Creative views.
 * `metaValues`/`dv360Values` are the multi-selected labels for that dimension
 * (empty array = "all"); `plannedMeta`/`plannedDv360` are the planned targets
 * entered for that platform's combined row.
 */
export interface AggComboSelection {
  metaValues: string[];
  dv360Values: string[];
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
