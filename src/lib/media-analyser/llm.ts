import path from "path";
import fs from "fs";
import type { CombinedScraperData, DeterministicInsights, LlmEnrichmentResult } from "./types";
import { geminiTextModels } from "./gemini-models";
import { cleanUserError } from "./user-errors";

const GEMINI_TEXT_MODELS = geminiTextModels();
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function loadSystemInstruction(): string {
  const promptPath = path.resolve(process.cwd(), "../../python_agent/system_prompt.md");
  let text = "";
  try {
    text = fs.readFileSync(promptPath, "utf-8");
  } catch {
    text = "You are a strategic e-commerce analyst. Analyze the provided data and return a JSON object with headline, keyFindings, opportunities, risks, recommendedActions, strategicPlays, and rationale fields.";
  }
  const marker = "## System Instruction";
  if (text.includes(marker)) {
    return text.split(marker, 2)[1].trim();
  }
  return text.trim();
}

function stripJsonFences(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) {
    const nl = text.indexOf("\n");
    text = nl !== -1 ? text.slice(nl + 1) : text.slice(3);
  }
  if (text.endsWith("```")) {
    text = text.slice(0, text.lastIndexOf("```"));
  }
  return text.trim();
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map(s => s.trim());
}

/**
 * The social snapshot's "avgEngagementRate" is total interactions ÷ posts (an avg
 * interaction COUNT, not a rate) — passing it to the model as "engagement rate"
 * made it echo impossible values like "967.6% engagement rate". Recursively relabel
 * those keys so the model reads them as counts, not percentages.
 */
function relabelEngagement(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(relabelEngagement);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const nk = k === "avgEngagementRate" ? "avgInteractionsPerPost" : k === "engagementRate" ? "interactionsPerPost" : k;
      out[nk] = relabelEngagement(val);
    }
    return out;
  }
  return v;
}

export function buildUserPrompt(data: CombinedScraperData, deterministic: DeterministicInsights): string {
  const payload = data as Record<string, unknown>;
  const signals = {
    keyFindings: deterministic.keyFindings,
    opportunities: deterministic.opportunities,
    risks: deterministic.risks,
    recommendedActions: deterministic.recommendedActions,
  };
  return [
    `Analysis scope: ${data.scope}`,
    `Source coverage: ${JSON.stringify(payload.sourceCounts ?? {})}`,
    "",
    "ECOM snapshot (Amazon listing + performance + competitors + pain points + battle cards):",
    JSON.stringify(payload.ecom ?? "not in scope"),
    "",
    "SOCIAL snapshot (interactions-per-post by format/theme, top posts, competitor benchmarks — note: 'interactionsPerPost' fields are raw AVERAGE COUNTS, never a percentage/rate):",
    JSON.stringify(payload.social ? relabelEngagement(payload.social) : "not in scope"),
    "",
    "CREATIVE snapshot (asset quality, copy, CTA, hook, font, competitor creative benchmarks):",
    JSON.stringify(payload.creative ?? "not in scope"),
    "",
    "Deterministic grounding signals (already computed - corroborate or sharpen, do not just repeat):",
    JSON.stringify(signals),
  ].join("\n");
}

async function callGeminiModel(apiKey: string, model: string, prompt: string): Promise<string> {
  const endpoint = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;
  const generationConfig: Record<string, unknown> = {
    temperature: 0.4,
    maxOutputTokens: 4096,
    responseMimeType: "application/json",
  };
  if (model.includes("2.5") || model.includes("2.0")) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: loadSystemInstruction() }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig,
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        const lastError = `Gemini HTTP ${res.status}: ${errBody.slice(0, 240)}`;
        if ((res.status === 429 || res.status === 503) && attempt < 2) {
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        throw new Error(lastError);
      }

      const decoded = await res.json() as Record<string, unknown>;
      const candidates = (decoded.candidates as Array<Record<string, unknown>> | undefined) ?? [];
      const parts = (((candidates[0]?.content as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined) ?? []);
      return String(parts[0]?.text ?? "");
    } catch (err) {
      clearTimeout(timer);
      if (attempt >= 2) throw err;
    }
  }
  throw new Error(`Gemini ${model} request failed`);
}

async function callGemini(apiKey: string, prompt: string): Promise<[string, string]> {
  let lastError = "";
  for (const model of GEMINI_TEXT_MODELS) {
    try {
      const text = await callGeminiModel(apiKey, model, prompt);
      return [text, model];
    } catch (err) {
      lastError = String(err);
      continue;
    }
  }
  throw new Error(lastError || "All Gemini models failed");
}

export async function generateLlmEnrichment(
  data: CombinedScraperData,
  deterministic: DeterministicInsights,
  opts?: { enabled?: boolean; apiKey?: string }
): Promise<LlmEnrichmentResult> {
  const { enabled = true, apiKey } = opts ?? {};
  if (!enabled) {
    return { used: false, error: "LLM enrichment disabled for this request.", keyFindings: [], opportunities: [], risks: [], recommendedActions: [], recommendations: [], rationale: [] };
  }
  const key = apiKey ?? process.env.GEMINI_API_KEY ?? "";
  if (!key) {
    return { used: false, error: "GEMINI_API_KEY is not configured.", keyFindings: [], opportunities: [], risks: [], recommendedActions: [], recommendations: [], rationale: [] };
  }

  try {
    const [raw, usedModel] = await callGemini(key, buildUserPrompt(data, deterministic));
    const parsed = JSON.parse(stripJsonFences(raw)) as Record<string, unknown>;
    return {
      used: true,
      model: usedModel,
      headline: typeof parsed.headline === "string" ? parsed.headline : null,
      keyFindings: asStringList(parsed.keyFindings),
      opportunities: asStringList(parsed.opportunities),
      risks: asStringList(parsed.risks),
      recommendedActions: asStringList(parsed.recommendedActions),
      recommendations: asStringList(parsed.strategicPlays),
      rationale: asStringList(parsed.rationale),
    };
  } catch (err) {
    // Never surface a raw vendor error (429/billing/etc.) into the report.
    return { used: false, error: cleanUserError(err), keyFindings: [], opportunities: [], risks: [], recommendedActions: [], recommendations: [], rationale: [] };
  }
}
