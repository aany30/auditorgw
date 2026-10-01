/**
 * TEMPORARY demo shim — routes reasoning through the OpenAI API (chat/completions, default
 * gpt-4o) instead of the Anthropic Messages API.
 *
 * Why: the Anthropic org is over its usage cap (until Oct 1), the Gemini key is out of prepaid
 * credits, AND the OpenRouter key is effectively out of credit too (HTTP 402, ~16 tokens left).
 * The OpenAI key is the only one with usable balance, so the demo runs on it directly.
 *
 * (File is named openrouter.ts for historical reasons — it now targets OpenAI direct.)
 * Revert path: restore the Anthropic calls in brand-llm.ts + research-chat/route.ts once the
 * ANTHROPIC_API_KEY workspace limit is raised.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export function openrouterConfigured(): boolean {
  return !!(process.env.OPENAI_API_KEY ?? "").trim();
}

/** Default demo model (override with OPENAI_MODEL). */
export function openrouterModel(): string {
  return (process.env.OPENAI_MODEL || "gpt-4o").trim();
}

export interface ORImage { mime: string; base64: string }

type ORContent = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
export interface ORMessage { role: "system" | "user" | "assistant"; content: ORContent }

/** Build an OpenAI-style user message from text + optional images (data URIs). */
export function userContentWithImages(text: string, images: ORImage[]): ORContent {
  if (!images.length) return text;
  return [
    { type: "text", text },
    ...images.slice(0, 8).map(im => ({ type: "image_url" as const, image_url: { url: `data:${im.mime};base64,${im.base64}` } })),
  ];
}

/** Non-streaming OpenAI chat completion → returns the assistant text.
 *  jsonMode adds response_format:json_object (requires the word "json" in the prompt). */
export async function openrouterChat(opts: {
  messages: ORMessage[];
  maxTokens: number;
  model?: string;
  timeoutMs?: number;
  jsonMode?: boolean;
}): Promise<string> {
  const key = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model || openrouterModel(),
      max_tokens: opts.maxTokens,
      messages: opts.messages,
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 400);
    try { const j = JSON.parse(body) as { error?: { message?: string } }; if (j?.error?.message) detail = j.error.message; } catch { /* keep raw */ }
    throw new Error(`OpenAI API error — HTTP ${res.status} on model "${opts.model || openrouterModel()}": ${detail}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const out = (data.choices?.[0]?.message?.content ?? "").trim();
  if (!out) throw new Error("OpenAI returned no text");
  return out;
}
