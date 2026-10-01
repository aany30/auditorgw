/**
 * UGC New — thin LLM helper over callVisionLLM (Gemini primary, OpenRouter/OpenAI
 * fallback). Mirrors the source pipeline's Gemini→fallback + loose-JSON tolerance.
 */
import { callVisionLLM, type VisionUserPart } from "@/lib/media-analyser/vision-llm";
import { geminiTextModels } from "@/lib/media-analyser/gemini-models";

export interface Attachment { mimeType: string; dataBase64: string }

function parts(user: string, attachments?: Attachment[]): VisionUserPart[] {
  const p: VisionUserPart[] = [{ text: user }];
  for (const a of attachments ?? []) p.push({ inline_data: { mime_type: a.mimeType, data: a.dataBase64 } });
  return p;
}

/** Salvage a JSON value from a possibly-fenced / prose-wrapped model reply. */
export function parseJsonLoose<T = unknown>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned) as T; } catch { /* fall through */ }
  const first = cleaned.search(/[[{]/);
  const last = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
  if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1)) as T;
  throw new Error("Could not parse JSON from model reply");
}

/** Structured JSON generation with a Gemini responseSchema. */
export async function llmJson<T = unknown>(
  system: string,
  user: string,
  responseSchema: Record<string, unknown>,
  opts?: { geminiKey?: string; attachments?: Attachment[]; maxTokens?: number },
): Promise<T> {
  const raw = await callVisionLLM(system, parts(user, opts?.attachments), opts?.geminiKey ?? process.env.GEMINI_API_KEY ?? "", {
    jsonMode: true,
    responseSchema,
    maxTokens: opts?.maxTokens ?? 2048,
    models: geminiTextModels(),
  });
  return parseJsonLoose<T>(raw);
}

/** Plain-text generation (brief, script). */
export async function llmText(
  system: string,
  user: string,
  opts?: { geminiKey?: string; attachments?: Attachment[]; maxTokens?: number },
): Promise<string> {
  const raw = await callVisionLLM(system, parts(user, opts?.attachments), opts?.geminiKey ?? process.env.GEMINI_API_KEY ?? "", {
    jsonMode: false,
    maxTokens: opts?.maxTokens ?? 1024,
    models: geminiTextModels(),
  });
  return raw.trim();
}
