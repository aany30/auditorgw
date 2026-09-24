/**
 * Focus-Driven Tabs — server-side agent engine (Phase 2, the "Hybrid").
 *
 * Each analytical lens is a domain expert agent: one LLM pass over the SAME compact audit
 * snapshot (+ the Data QA confidence report) producing an independent verdict. The Chief
 * Analyst orchestrator then merges all verdicts + QA into an executive synthesis, surfacing
 * conflicts and down-weighting low-confidence findings.
 *
 * Server-only: imports callVisionLLM. Client code imports schemas/types from focus-lenses.ts.
 */

import { callVisionLLM } from "@/lib/media-analyser/vision-llm";
import { geminiTextModels } from "@/lib/media-analyser/gemini-models";
import {
  FOCUS_LENSES,
  FOCUS_LENS_SCHEMA,
  CHIEF_ANALYST_SCHEMA,
  CHIEF_ANALYST_SYSTEM,
  focusLensSystemPrompt,
  parseFocusLensResult,
  parseChiefAnalystResult,
  type FocusLensKey,
  type FocusLensResult,
  type ChiefAnalystResult,
  type DataConfidenceReport,
} from "@/lib/media-analyser/focus-lenses";

const cap = (o: unknown, n = 60_000) => JSON.stringify(o).slice(0, n);

/** Run one domain expert agent over the audit snapshot (+ optional Data QA report). */
export async function generateFocusLens(
  geminiKey: string,
  lensKey: FocusLensKey,
  input: unknown,
  qa?: DataConfidenceReport | null,
): Promise<FocusLensResult> {
  const lens = FOCUS_LENSES.find(l => l.key === lensKey);
  if (!lens) throw new Error(`Unknown lens "${lensKey}"`);
  const userText =
    `AUDIT SNAPSHOT (JSON):\n${cap(input)}\n\n` +
    (qa ? `DATA QA CONFIDENCE (honour this — flag findings that rest on missing/partial sources):\n${cap(qa, 8_000)}\n\n` : "") +
    `Return the ${lens.label} verdict JSON now.`;
  const raw = await callVisionLLM(
    focusLensSystemPrompt(lens),
    [{ text: userText }],
    geminiKey,
    { jsonMode: true, responseSchema: FOCUS_LENS_SCHEMA, models: geminiTextModels(), maxTokens: 2048 },
  );
  return parseFocusLensResult(raw);
}

/** Chief Analyst: synthesise all domain verdicts + Data QA into one executive brief. */
export async function runChiefAnalyst(
  geminiKey: string,
  opts: { input: unknown; qa: DataConfidenceReport; verdicts: Partial<Record<FocusLensKey, FocusLensResult>> },
): Promise<ChiefAnalystResult> {
  const expertVerdicts = Object.fromEntries(
    Object.entries(opts.verdicts).map(([k, v]) => [k, v ? { verdict: v.verdict, headline: v.headline, insights: v.insights, confidence: v.confidence, confidence_note: v.confidence_note } : null]),
  );
  const userText =
    `AUDIT SNAPSHOT (JSON):\n${cap(opts.input, 30_000)}\n\n` +
    `DATA QA CONFIDENCE REPORT:\n${cap(opts.qa, 8_000)}\n\n` +
    `DOMAIN EXPERT VERDICTS:\n${cap(expertVerdicts, 40_000)}\n\n` +
    `Synthesise the panel into the executive brief JSON now.`;
  const raw = await callVisionLLM(
    CHIEF_ANALYST_SYSTEM,
    [{ text: userText }],
    geminiKey,
    { jsonMode: true, responseSchema: CHIEF_ANALYST_SCHEMA, models: geminiTextModels(), enableThinking: true, maxTokens: 3072 },
  );
  return parseChiefAnalystResult(raw);
}
