/**
 * LLM helper for Ecom Agent — raw fetch() only, no SDK.
 * Supports retry with exponential backoff on 429.
 */

// Defaults — overridden at call time when env vars are passed in
export const LLM_MODEL        = 'gpt-4.1-mini';
export const LLM_VISION_MODEL = 'gpt-4o-mini';
export const LLM_PROMPT_MODEL = 'o4-mini'; // Used for BLS + creative prompt generation

// OpenAI-compatible endpoints
export const OPENAI_ENDPOINT      = 'https://api.openai.com/v1/chat/completions';
export const OPENROUTER_ENDPOINT  = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Resolve which LLM key + endpoint + model names to use from env.
 *
 * Priority: OpenRouter > OpenAI (whichever key is present).
 * Endpoint always matches the key so the request hits the right provider.
 * LLM_MODEL and LLM_PROMPT_MODEL env vars override the code-level defaults,
 * matching Python's os.getenv("LLM_MODEL", "gpt-4.1-mini") pattern.
 *
 * Swap to OpenAI: remove OPENROUTER_API_KEY from wrangler.toml (or leave it
 * blank) and populate OPENAI_API_KEY — the endpoint flips automatically.
 */
export function resolveLLM(env: {
  OPENROUTER_API_KEY?: string;
  OPENAI_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_PROMPT_MODEL?: string;
}): {
  key: string;
  endpoint: string;
  model: string;
  promptModel: string;
} {
  const endpoint = env.OPENROUTER_API_KEY ? OPENROUTER_ENDPOINT : OPENAI_ENDPOINT;
  const key = env.OPENROUTER_API_KEY ?? env.OPENAI_API_KEY ?? '';
  return {
    key,
    endpoint,
    model:       env.LLM_MODEL       ?? LLM_MODEL,
    promptModel: env.LLM_PROMPT_MODEL ?? LLM_PROMPT_MODEL,
  };
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | LLMContentPart[];
}

export interface LLMContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
}

export interface LLMResponse {
  choices: Array<{
    message: { content: string | null };
  }>;
}

export function stripJsonFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isQuotaExhaustedError(msg: string): boolean {
  const s = msg.toLowerCase();
  return s.includes('insufficient_quota') || s.includes('exceeded your current quota') || (s.includes('billing') && s.includes('quota'));
}

function parseRetryAfter(errorBody: string): number {
  const m = errorBody.match(/try again in (\d+(?:\.\d+)?)(ms|s)/i);
  if (m) {
    const val = parseFloat(m[1]);
    return m[2].toLowerCase() === 'ms' ? Math.ceil(val) : Math.ceil(val * 1000);
  }
  return 0;
}

export async function callLLM(
  apiKey: string,
  messages: LLMMessage[],
  options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    responseFormat?: { type: 'json_object' | 'text' };
    /** Override endpoint — defaults to OpenAI. Pass OPENROUTER_ENDPOINT for OpenRouter. */
    endpoint?: string;
    /** Abort the fetch after this many milliseconds. Applies per-attempt. */
    timeoutMs?: number;
  } = {},
): Promise<string> {
  const model    = options.model ?? LLM_MODEL;
  const endpoint = options.endpoint ?? OPENAI_ENDPOINT;
  const maxRetries = 6;
  let lastError = '';

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const ac    = options.timeoutMs ? new AbortController() : undefined;
    const timer = ac ? setTimeout(() => ac.abort(), options.timeoutMs!) : undefined;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          // o-series (o1, o3, o4-mini, etc.) use max_completion_tokens and reject temperature
          ...(model.startsWith('o')
            ? { max_completion_tokens: options.maxTokens ?? 2000 }
            : { max_tokens: options.maxTokens ?? 2000, temperature: options.temperature ?? 0 }),
          ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
        }),
        signal: ac?.signal,
      });

      if (res.status === 401 || res.status === 403) {
        // Auth/permission error — never retryable (same as Raza's llmWithRetry fast-fail)
        const body = await res.text();
        throw new Error(`LLM auth error ${res.status}: ${body.slice(0, 200)}`);
      }

      if (res.status === 429) {
        const body = await res.text();
        const retryMs = parseRetryAfter(body) || (2000 * Math.pow(2, attempt)) + Math.random() * 500;
        const capped = Math.min(retryMs, 45_000);
        console.warn(`[LLM] 429 rate limit, retrying in ${Math.round(capped / 1000)}s (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(capped);
        lastError = body;
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        if (isQuotaExhaustedError(body)) throw new Error(`LLM quota exhausted: ${body.slice(0, 200)}`);
        throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = await res.json() as LLMResponse;
      return data.choices[0]?.message?.content ?? '';
    } catch (e) {
      if (isQuotaExhaustedError(String(e))) throw e; // quota errors never retryable
      if (attempt === maxRetries - 1) throw e;
      const delay = 2000 * Math.pow(2, attempt) + Math.random() * 500;
      await sleep(Math.min(delay, 45_000));
      lastError = String(e);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  throw new Error(`LLM failed after ${maxRetries} attempts. Last error: ${lastError}`);
}
