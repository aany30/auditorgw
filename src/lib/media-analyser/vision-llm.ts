import { geminiVisionModels } from "./gemini-models";

export type VisionUserPart = Record<string, unknown>;

export interface VisionLLMOptions {
  jsonMode?: boolean;
  maxTokens?: number;
  /** Gemini structured-output schema (OpenAPI subset). Gemini path only. */
  responseSchema?: Record<string, unknown>;
  /** Skip the OpenAI/OpenRouter fallback entirely (e.g. video QC, which OpenAI can't read). */
  geminiOnly?: boolean;
  /** Allow Gemini thinking budget (default off for speed). Useful for QC/reasoning. */
  enableThinking?: boolean;
  /** Override the Gemini model list (defaults to geminiVisionModels()). */
  models?: string[];
}

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type VisionProvider = { key: string; endpoint: string; model: string };

/**
 * All configured OpenAI-compatible vision providers, in priority order:
 * OpenRouter first (if keyed), then OpenAI. Returning a LIST — rather than a
 * single winner — lets callOpenAIVision skip a provider that is out of credit
 * (HTTP 402) and try the next one, instead of hard-failing on the first.
 */
function resolveVisionProviders(): VisionProvider[] {
  const model = process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini";
  const out: VisionProvider[] = [];
  const openrouterKey = process.env.OPENROUTER_API_KEY ?? "";
  const openaiKey = process.env.OPENAI_API_KEY ?? "";
  if (openrouterKey) out.push({ key: openrouterKey, endpoint: OPENROUTER_ENDPOINT, model });
  if (openaiKey) out.push({ key: openaiKey, endpoint: OPENAI_ENDPOINT, model });
  return out;
}

function resolveOpenAIVision(): VisionProvider | null {
  return resolveVisionProviders()[0] ?? null;
}

function isRetryable(status: number, body = ""): boolean {
  return status === 429 || status === 503 || /RESOURCE_EXHAUSTED|high demand|overloaded|quota/i.test(body);
}

function shouldFallbackToOpenAI(err: string): boolean {
  // 401/403/400 = the Gemini key itself is invalid / unauthorized / malformed —
  // retrying Gemini won't help, so hand off to OpenAI/OpenRouter just like an overload.
  return /\b400\b|\b401\b|\b403\b|503|429|404|high demand|RESOURCE_EXHAUSTED|no longer available|empty response|SAFETY|RECITATION|blocked|blockReason|API[ _]?key not valid|API_KEY_INVALID|invalid authentication|UNAUTHENTICATED|PERMISSION_DENIED|OAuth 2/i.test(err);
}

/** A hard stop — daily quota exhausted or billing — that retrying will NOT clear. */
function isHardQuotaError(err: string): boolean {
  // Billing / credit exhaustion won't clear by retrying — treat as HARD so we fail
  // fast (and hand off to the fallback provider) instead of burning ~51s on backoff.
  return /per ?day|perdayper|check your plan and billing|free.?tier|HTTP 402|insufficient.*credit|prepay|credits? (are )?depleted|\bdepleted\b|billing/i.test(err);
}

/**
 * A transient Gemini failure (per-minute rate-limit, momentary 503 overload,
 * empty body) that a short backoff-and-retry is likely to clear — as opposed to
 * a hard daily-quota/billing stop. Mirrors the resilience the text path has.
 */
function isTransientVisionError(err: string): boolean {
  if (isHardQuotaError(err)) return false;
  return /\b429\b|\b503\b|RESOURCE_EXHAUSTED|per ?minute|perminute|\brate\b|overloaded|high demand|UNAVAILABLE|empty response|fetch failed|timeout|abort/i.test(err);
}

function extractGeminiText(data: Record<string, unknown>): { text: string; reason: string } {
  const candidates = (data.candidates as Array<Record<string, unknown>> | undefined) ?? [];
  const c0 = candidates[0];
  if (!c0) {
    const block = (data.promptFeedback as Record<string, unknown> | undefined)?.blockReason;
    return { text: "", reason: block ? `blocked (${String(block)})` : "no candidates" };
  }
  const finish = String(c0.finishReason ?? "");
  const parts = ((c0.content as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined) ?? [];
  const text = parts.map(p => String(p.text ?? "")).join("").trim();
  if (text) return { text, reason: "" };
  return { text: "", reason: finish || "empty response" };
}

function geminiPartsToOpenAI(parts: VisionUserPart[]): Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> {
  const out: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> = [];
  for (const part of parts) {
    const inline = part.inline_data as { mime_type?: string; data?: string } | undefined;
    if (inline?.data) {
      const mime = inline.mime_type ?? "image/jpeg";
      out.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${inline.data}`, detail: "low" },
      });
    } else if (part.text) {
      out.push({ type: "text", text: String(part.text) });
    }
  }
  return out;
}

function isCreditLimitError(status: number, body = ""): boolean {
  return status === 402 || /more credits|can only afford|insufficient.*credit/i.test(body);
}

/** True for a "this provider is out of money" failure that the NEXT provider might not have. */
function isProviderCreditError(err: string): boolean {
  return /HTTP 40[12]\b|more credits|can only afford|insufficient.*credit|quota|RESOURCE_EXHAUSTED/i.test(err);
}

async function callOpenAIVision(
  systemPrompt: string,
  userParts: VisionUserPart[],
  opts?: VisionLLMOptions,
): Promise<string> {
  const providers = resolveVisionProviders();
  if (!providers.length) throw new Error("OPENAI_API_KEY is not configured");

  let lastErr = "";
  for (let i = 0; i < providers.length; i++) {
    try {
      return await callOneOpenAIVisionProvider(providers[i], systemPrompt, userParts, opts);
    } catch (e) {
      lastErr = String(e);
      const nextExists = i < providers.length - 1;
      // If this provider is out of credit / rate-limited, the next one might not
      // be — try it before giving up. Otherwise the error is provider-agnostic.
      if (nextExists && isProviderCreditError(lastErr)) {
        console.warn(`[vision-llm] ${providers[i].endpoint} unavailable (${lastErr.slice(0, 90)}), trying next vision provider`);
        continue;
      }
      throw e;
    }
  }
  throw new Error(lastErr || "OpenAI vision failed");
}

async function callOneOpenAIVisionProvider(
  cfg: VisionProvider,
  systemPrompt: string,
  userParts: VisionUserPart[],
  opts?: VisionLLMOptions,
): Promise<string> {
  const content = geminiPartsToOpenAI(userParts);
  const tokenBudgets = [
    opts?.maxTokens ?? 4096,
    2048,
    1024,
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  let lastErr = "";
  for (const maxTokens of tokenBudgets) {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
    };
    if (opts?.jsonMode !== false) body.response_format = { type: "json_object" };

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(cfg.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const bodyText = await res.text().catch(() => "");
          lastErr = `HTTP ${res.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`;
          if (isCreditLimitError(res.status, bodyText)) break;
          if (isRetryable(res.status, bodyText) && attempt < 3) {
            await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
            continue;
          }
          throw new Error(lastErr);
        }
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content?.trim() ?? "";
        if (text) return text;
        lastErr = "empty response";
      } catch (e) {
        lastErr = String(e);
        if (attempt < 3 && /abort|timeout|fetch failed/i.test(lastErr)) {
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        if (!/HTTP 402|more credits|can only afford/i.test(lastErr)) throw new Error(lastErr);
        break;
      }
    }
  }
  throw new Error(`OpenAI vision failed: ${lastErr}`);
}

async function callGeminiVisionOnly(
  systemPrompt: string,
  userParts: VisionUserPart[],
  apiKey: string,
  opts?: VisionLLMOptions,
): Promise<string> {
  const models = opts?.models?.length ? opts.models : geminiVisionModels();
  let lastErr = "";

  // JSON mode often returns empty bodies for multi-image vision — try text mode too.
  // With a responseSchema we stay strictly in JSON mode (the schema requires it).
  const modes = opts?.jsonMode === false ? [false] : opts?.responseSchema ? [true] : [true, false];

  for (const model of models) {
    for (const jsonMode of modes) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const generationConfig: Record<string, unknown> = {
            temperature: 0.2,
            maxOutputTokens: opts?.maxTokens ?? 4096,
          };
          if (!opts?.enableThinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };
          if (jsonMode) {
            generationConfig.responseMimeType = "application/json";
            if (opts?.responseSchema) generationConfig.responseSchema = opts.responseSchema;
          }

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: "user", parts: userParts }],
                generationConfig,
              }),
            },
          );
          if (!res.ok) {
            const bodyText = await res.text().catch(() => "");
            let detail = "";
            try { detail = String((JSON.parse(bodyText) as Record<string, { message?: string }>)?.error?.message ?? ""); } catch { /* ignore */ }
            lastErr = `HTTP ${res.status}${detail ? `: ${detail}` : ""}`;
            // 503/429 won't recover by retrying Gemini in-loop, and 400/401/403 mean the
            // key itself is bad — bail immediately so the OpenAI/OpenRouter fallback takes over.
            if (isRetryable(res.status, bodyText) || res.status === 400 || res.status === 401 || res.status === 403) break;
            if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          const data = (await res.json()) as Record<string, unknown>;
          const { text, reason } = extractGeminiText(data);
          if (text) return text;
          lastErr = reason.includes("empty") ? reason : `empty response (${reason})`;
          if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
        } catch (e) {
          lastErr = String(e);
          if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
        }
      }
    }
  }
  throw new Error(`Gemini vision failed: ${lastErr}`);
}

/**
 * Vision LLM with automatic fallback.
 * Default: Gemini first → OpenAI/OpenRouter on 503/429/404 or if VISION_PROVIDER=openai.
 */
export async function callVisionLLM(
  systemPrompt: string,
  userParts: VisionUserPart[],
  geminiKey: string,
  opts?: VisionLLMOptions,
): Promise<string> {
  const provider = (process.env.VISION_PROVIDER ?? "auto").toLowerCase();
  // geminiOnly (e.g. video QC — OpenAI can't read video) forbids any fallback.
  const openai = opts?.geminiOnly ? null : resolveOpenAIVision();

  if (opts?.geminiOnly) {
    if (!geminiKey) throw new Error("GEMINI_API_KEY is not configured (geminiOnly request)");
    // No fallback exists, so give Gemini a backoff-and-retry for transient blips
    // (per-minute rate-limit, momentary 503, empty body) — but never for a hard
    // daily-quota/billing stop, which won't clear.
    const tryGeminiOnly = () => callGeminiVisionOnly(systemPrompt, userParts, geminiKey, opts);
    try {
      return await tryGeminiOnly();
    } catch (e) {
      let err = String(e);
      if (!isTransientVisionError(err)) throw e;
      for (const waitMs of [6000, 15000, 30000]) {
        console.warn(`[vision-llm] Gemini transient error (geminiOnly), retrying in ${waitMs}ms`);
        await new Promise(r => setTimeout(r, waitMs));
        try {
          return await tryGeminiOnly();
        } catch (retryErr) {
          err = String(retryErr);
          if (!isTransientVisionError(err)) throw retryErr;
        }
      }
      throw new Error(err.replace(/^Error: /, ""));
    }
  }

  if (provider === "openai") {
    if (!openai) throw new Error("VISION_PROVIDER=openai but OPENAI_API_KEY is not configured");
    return callOpenAIVision(systemPrompt, userParts, opts);
  }

  if (provider === "gemini") {
    if (!geminiKey) throw new Error("VISION_PROVIDER=gemini but GEMINI_API_KEY is not configured");
    return callGeminiVisionOnly(systemPrompt, userParts, geminiKey, opts);
  }

  // auto: Gemini first, OpenAI fallback
  if (geminiKey) {
    const tryGemini = () => callGeminiVisionOnly(systemPrompt, userParts, geminiKey, opts);
    try {
      return await tryGemini();
    } catch (e) {
      const err = String(e);
      if (openai && shouldFallbackToOpenAI(err)) {
        console.warn(`[vision-llm] Gemini failed (${err.slice(0, 120)}), falling back to OpenAI`);
        try {
          return await callOpenAIVision(systemPrompt, userParts, opts);
        } catch (openaiErr) {
          if (opts?.jsonMode !== false) {
            console.warn(`[vision-llm] OpenAI json mode failed (${String(openaiErr).slice(0, 80)}), retrying text mode`);
            return callOpenAIVision(systemPrompt, userParts, { jsonMode: false });
          }
          throw openaiErr;
        }
      }
      // No OpenAI fallback configured. The text/analysis path retries transient
      // 429/503s with backoff and usually self-heals; the vision path otherwise
      // bails instantly (it was designed to hand off to OpenAI). When there's no
      // fallback, give Gemini the same backoff-and-retry for transient blips —
      // but never for a hard daily-quota/billing stop, which won't clear.
      if (!openai && isTransientVisionError(err)) {
        for (const waitMs of [6000, 15000]) {
          console.warn(`[vision-llm] Gemini transient error, retrying in ${waitMs}ms (no OpenAI fallback configured)`);
          await new Promise(r => setTimeout(r, waitMs));
          try {
            return await tryGemini();
          } catch (retryErr) {
            if (!isTransientVisionError(String(retryErr))) throw retryErr;
          }
        }
      }
      if (shouldFallbackToOpenAI(err)) {
        throw new Error(`${err.replace(/^Error: /, "")} — add OPENAI_API_KEY on Vercel for automatic fallback when Gemini is overloaded.`);
      }
      throw e;
    }
  }

  if (openai) return callOpenAIVision(systemPrompt, userParts, opts);
  throw new Error("No vision provider configured — set GEMINI_API_KEY or OPENAI_API_KEY");
}
