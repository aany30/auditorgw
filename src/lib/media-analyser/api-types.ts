import type { FocusLensKey, FocusLensResult, ChiefAnalystResult } from "./focus-lenses";

export interface FocusTabResponse {
  lens: string;
  result: FocusLensResult;
}

export interface AnalystSynthesisResponse {
  agents: Partial<Record<FocusLensKey, FocusLensResult>>;
  synthesis: ChiefAnalystResult;
}
