import type { FocusLensKey, FocusLensResult, ChiefAnalystResult } from "./focus-lenses";

export interface FocusTabResponse {
  lens: string;
  result: FocusLensResult;
}

export interface AnalystSynthesisResponse {
  agents: Partial<Record<FocusLensKey, FocusLensResult>>;
  synthesis: ChiefAnalystResult;
}

// ─── Response types for API route imports ──────────────────────────────────
// Re-exported from the actual Next.js API route (pages/api/media-analyser/*) that
// defines and returns each shape, so components get real field types instead of
// `[key: string]: unknown` stubs.

export type { UGCCharacterResponse } from "@/pages/api/media-analyser/ugc-ads-character";
export type { UGCCharacterAnglesResponse } from "@/pages/api/media-analyser/ugc-ads-character-angles";
export type { UGCFetchProductResponse } from "@/pages/api/media-analyser/ugc-ads-fetch-product";
export type { UGCWorldResponse } from "@/pages/api/media-analyser/ugc-ads-world";
export type { UGCRenderSubmit } from "@/pages/api/media-analyser/ugc-ads-render";
export type { UGCRenderStatus } from "@/pages/api/media-analyser/ugc-ads-render-status";
export type { UGCQcResponse } from "@/pages/api/media-analyser/ugc-ads-qc";
export type { UGCCohortsResponse } from "@/pages/api/media-analyser/ugc-ads-cohorts";
export type { UGCPersonasResponse } from "@/pages/api/media-analyser/ugc-new-personas";
export type { UGCScriptsResponse } from "@/pages/api/media-analyser/ugc-new-scripts";
/** SSE updates from /api/media-analyser/ugc-new-render (used by UGCNew.tsx + UGCCohortStudio.tsx). */
export type { UGCRenderUpdate } from "@/pages/api/media-analyser/ugc-new-render";
/** SSE updates from /api/media-analyser/ugc-playground-run (used by UGCPlayground.tsx). */
export type { UGCNewUpdate } from "@/pages/api/media-analyser/ugc-playground-run";

export type { BrandAnalyzeResponse, AnalyzeMode } from "@/pages/api/media-analyser/ugc-new-brand-analyze";
export type { CohortPersonasResponse } from "@/pages/api/media-analyser/ugc-new-cohort-personas";
export type { CohortScriptResponse } from "@/pages/api/media-analyser/ugc-new-cohort-script";
export type { CharacterWorldResponse } from "@/pages/api/media-analyser/ugc-new-character-world";
export type { PenPortraitResponse } from "@/pages/api/media-analyser/ugc-new-pen-portrait";

export type { GeneratedVideoUpdate, VideoMode } from "@/pages/api/media-analyser/generate-video";
export type { GeneratedPostUpdate, PostMode } from "@/pages/api/media-analyser/generate-posts";

export type { VibeCloneUpdate } from "@/pages/api/media-analyser/vibe-clone";
export type { VibeCloneStoryboardResponse } from "@/pages/api/media-analyser/vibe-clone-ugc-storyboard";
export type { VibeCloneKeyframeResponse } from "@/pages/api/media-analyser/vibe-clone-ugc-keyframe";
export type { VibeCloneClipResponse } from "@/pages/api/media-analyser/vibe-clone-ugc-clip";
export type { VibeCloneStitchResponse } from "@/pages/api/media-analyser/vibe-clone-ugc-stitch";

export type { VibeMatchUpdate } from "@/pages/api/media-analyser/vibe-match";
export type { VoiceCloneUpdate } from "@/pages/api/media-analyser/voice-clone";

export type { InstaGridUpdate, InstaPost } from "@/pages/api/media-analyser/insta-grid";
export type { InstaGridVideoUpdate } from "@/pages/api/media-analyser/insta-grid-video";

export type { AplusUpdate } from "@/pages/api/media-analyser/aplus-content";
export type { AgentReadyUpdate } from "@/pages/api/media-analyser/agent-ready-audit";

export type { MicroDramaAnalyzeResponse } from "@/pages/api/media-analyser/micro-drama-analyze";
export type { MicroDramaCharacterResponse } from "@/pages/api/media-analyser/micro-drama-character";
export type { MicroDramaShotListResponse } from "@/pages/api/media-analyser/micro-drama-shot-list";

export type { LuxRenderSubmit } from "@/pages/api/media-analyser/lux-ads-render";

export type { CloneReelPlan } from "@/pages/api/media-analyser/clone-reel-plan";
export type { CloneReelClipResponse } from "@/pages/api/media-analyser/clone-reel-clip";
