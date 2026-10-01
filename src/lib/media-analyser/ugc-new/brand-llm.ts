/**
 * Brand-reasoning LLM for the Cohort Studio.
 *
 * TEMPORARY (demo): routed through OpenRouter (OpenAI-compatible, default openai/gpt-4o) via
 * the shim in "@/lib/media-analyser/openrouter", because the Anthropic org is over its usage cap (until Oct 1)
 * and the Gemini key is out of credits. The function names still say "claude" for minimal churn;
 * revert callClaude to the Anthropic Messages API once the ANTHROPIC_API_KEY limit is raised.
 * Supports vision (product & brand imagery).
 */
import { openrouterConfigured, openrouterChat, userContentWithImages, type ORMessage } from "@/lib/media-analyser/openrouter";

export interface ImageInput { mime: string; base64: string }

export function claudeConfigured(): boolean {
  // TEMP: reasoning runs on OpenRouter, so gate on that key.
  return openrouterConfigured();
}

/** Fetch an image URL → { mime, base64 } (skips oversized / non-images). */
export async function imageToInput(url: string): Promise<ImageInput | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 4_500_000) return null;
    const ct = r.headers.get("content-type") || "image/jpeg";
    const mime = ct.startsWith("image/") ? ct.split(";")[0] : "image/jpeg";
    return { mime, base64: buf.toString("base64") };
  } catch { return null; }
}

// TEMP: `model` (a Claude id) is ignored — routed to OpenAI (OPENAI_MODEL, default gpt-4o).
async function callClaude(system: string, text: string, images: ImageInput[], maxTokens: number, _model?: string, timeoutMs = 120_000, jsonMode = false): Promise<string> {
  const messages: ORMessage[] = [
    { role: "system", content: system },
    { role: "user", content: userContentWithImages(text, images) },
  ];
  return openrouterChat({ messages, maxTokens, timeoutMs, jsonMode });
}

/** Strip markdown fences and parse the first JSON value out of an LLM reply.
 *  Repairs the common truncated-mid-array case (LLM hit the token cap) by trimming to
 *  the last complete object and closing open arrays/objects, so partial output still yields
 *  the complete items rather than throwing. */
export function parseJson<T = unknown>(raw: string): T {
  const s = raw.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const start = Math.min(...[s.indexOf("{"), s.indexOf("[")].filter(i => i >= 0));
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  const slice = start >= 0 && end > start ? s.slice(start, end + 1) : s;
  try { return JSON.parse(slice) as T; } catch { /* attempt repair below */ }

  const balance = (str: string): string => {
    let c = str;
    const opens = (c.match(/\[/g) || []).length, closes = (c.match(/\]/g) || []).length;
    c += "]".repeat(Math.max(0, opens - closes));
    const ob = (c.match(/\{/g) || []).length, cb = (c.match(/\}/g) || []).length;
    c += "}".repeat(Math.max(0, ob - cb));
    return c;
  };
  // (a) Truncated between items → trim to the last complete "}" and balance.
  const lastObj = slice.lastIndexOf("}");
  if (lastObj > 0) {
    try { return JSON.parse(balance(slice.slice(0, lastObj + 1))) as T; } catch { /* try (b) */ }
  }
  // (b) Truncated mid-string → close the open string, then balance.
  try { return JSON.parse(balance(slice + '"')) as T; } catch { /* fall through */ }
  return JSON.parse(slice) as T; // rethrow original error
}

/**
 * Reason over a brand (text + optional imagery) with Claude and return the model's raw
 * output string. Claude ONLY — no fallback. Throws a descriptive error if ANTHROPIC_API_KEY
 * is missing or the Claude call fails. `schema` is appended to the prompt so Claude returns
 * the exact JSON shape the caller expects.
 */
export async function brandReason(opts: {
  system: string;
  user: string;
  images?: ImageInput[];
  schema?: Record<string, unknown>;
  maxTokens?: number;
  /** Override the Claude model (e.g. "claude-fable-5-1" for the deep analysis step). */
  model?: string;
  /** Claude request timeout (ms) — raise for slow/vision steps. */
  timeoutMs?: number;
  /** Return free-form prose/markdown instead of JSON (skips the JSON shape hint). */
  plainText?: boolean;
}): Promise<{ raw: string; engine: "claude" }> {
  if (!claudeConfigured()) {
    throw new Error("OPENROUTER_API_KEY is not set. The Cohort Studio reasoning is temporarily routed through OpenRouter — set OPENROUTER_API_KEY and redeploy.");
  }
  const images = opts.images ?? [];
  const maxTokens = opts.maxTokens ?? 2000;
  // Describe the desired JSON via the PROMPT. IMPORTANT (OpenAI/gpt-4o): if we paste a JSON
  // Schema and say "match this shape", gpt-4o echoes the SCHEMA back instead of returning data.
  // So we explicitly tell it to return DATA that CONFORMS to the schema, not the schema itself.
  // plainText steps (e.g. the strategy document) want prose, so skip the JSON hint entirely.
  const shapeHint = opts.plainText ? "" : (opts.schema
    ? `\n\nReturn ONLY one compact minified JSON object containing ACTUAL DATA that conforms to this JSON Schema. Do NOT return the schema itself — return an instance populated with real values. No markdown, no code fences, no commentary. JSON Schema: ${JSON.stringify(opts.schema)}`
    : `\n\nReturn ONLY one compact minified JSON object with real data (no markdown, no commentary, no repetition).`);
  const sys = `${opts.system}${shapeHint}`;

  // jsonMode (OpenAI response_format) for the JSON steps; prose steps stay free-form.
  const raw = await callClaude(sys, opts.user, images, maxTokens, opts.model, opts.timeoutMs, !opts.plainText);
  return { raw, engine: "claude" };
}
