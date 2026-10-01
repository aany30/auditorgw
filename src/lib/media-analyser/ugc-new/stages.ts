/**
 * UGC New — the six pipeline stages as callable functions, so both the one-shot
 * orchestrator (/api/ugc-new/run) and any per-stage route share one implementation.
 */
import { editWithNanoBananaPro, generateElevenLabsSpeech, submitFalQueueJob, getFalQueueStatus, fetchFalVideoResult, type FalImage, type FalQueueSubmit } from "@/lib/media-analyser/fal";
import { renderArkSeedance, arkConfigured } from "@/lib/media-analyser/ark";
import { resolveElevenVoice } from "@/lib/media-analyser/generation-models";
import { llmText, llmJson, parseJsonLoose, type Attachment } from "@/lib/media-analyser/ugc-new/llm";
import {
  INTAKE_SYSTEM, intakeUser, SEARCH_QUERY_SYSTEM, BRIEF_SYSTEM, briefUser,
  SCRIPT_ANGLES, scriptSystem, scriptUser, SCRIPT_WORD_BUDGET,
  PERSONA_SYSTEM, personaUser, portraitPrompt, IMAGE_QC_SYSTEM, imageQcUser, PERSONA_COUNT,
  VOICE_TRAITS_SYSTEM, voiceTraitsUser, buildVideoPrompt, TARGET_VIDEO_SECONDS, TARGET_ASPECT_RATIO,
} from "@/lib/media-analyser/ugc-new/prompts";
import {
  INTAKE_SCHEMA, IntakeResult, SEARCH_QUERY_SCHEMA, SearchQueries, PersonaArray,
  ImageQc, IMAGE_QC_SCHEMA, VoiceTraits, VOICE_TRAITS_SCHEMA,
  type GeneratedScript, type GeneratedPersona, type VoiceTraits as VoiceTraitsT,
} from "@/lib/media-analyser/ugc-new/types";
import { firecrawlScrape, researchTopic, formatResearchSources } from "@/lib/media-analyser/ugc-new/research";

const pdfAttachment = (pdfDataUrl?: string): Attachment[] | undefined =>
  pdfDataUrl?.startsWith("data:application/pdf") ? [{ mimeType: "application/pdf", dataBase64: pdfDataUrl.split(",")[1] ?? "" }] : undefined;

// ── Stage 0 ──────────────────────────────────────────────────────────────────
export async function runIntake(input: { pastedText?: string; productUrl?: string; pdfDataUrl?: string; imageCount?: number }): Promise<IntakeResult & { productUrl: string }> {
  const raw = await llmJson(INTAKE_SYSTEM, intakeUser({ pastedText: input.pastedText, productUrl: input.productUrl, imageCount: input.imageCount, hasPdf: !!input.pdfDataUrl }), INTAKE_SCHEMA, { attachments: pdfAttachment(input.pdfDataUrl) });
  return { ...IntakeResult.parse(raw), productUrl: input.productUrl ?? "" };
}

// ── Stage 1 ──────────────────────────────────────────────────────────────────
export async function runBrief(input: { productDescription: string; otherInfo?: string; productUrl?: string; steering?: string; imageCount?: number; pdfDataUrl?: string }): Promise<{ brief: string; researchNotes: string }> {
  let competitorQuery = "", adStyleQuery = "";
  try { const q = SearchQueries.parse(await llmJson(SEARCH_QUERY_SYSTEM, input.productDescription, SEARCH_QUERY_SCHEMA, { maxTokens: 256 })); competitorQuery = q.competitorQuery; adStyleQuery = q.adStyleQuery; } catch { /* heuristic */ }
  const first6 = input.productDescription.split(/\s+/).slice(0, 6).join(" ");
  if (!competitorQuery) competitorQuery = `${first6} competitors`;
  if (!adStyleQuery) adStyleQuery = `${first6} UGC ad examples`;
  const [ownPage, competitors, adStyle] = await Promise.all([
    input.productUrl ? firecrawlScrape(input.productUrl) : Promise.resolve(""),
    researchTopic(competitorQuery, 4, 2),
    researchTopic(adStyleQuery, 4, 0),
  ]);
  const researchNotes = [
    ownPage ? `Own product page:\n${ownPage}` : "",
    `Search queries used: "${competitorQuery}", "${adStyleQuery}"`,
    formatResearchSources("Similar products found:", competitors),
    formatResearchSources("Competitor UGC ad style references:", adStyle),
  ].filter(Boolean).join("\n\n");
  const brief = await llmText(BRIEF_SYSTEM, briefUser({ productDescription: input.productDescription, otherInfo: input.otherInfo, productUrl: input.productUrl, imageCount: input.imageCount ?? 0, researchNotes, hasPdf: !!input.pdfDataUrl, steering: input.steering }), { attachments: pdfAttachment(input.pdfDataUrl), maxTokens: 800 });
  return { brief, researchNotes };
}

// ── Stage 2 ──────────────────────────────────────────────────────────────────
export function enforceScriptBudget(raw: string, budget: number): string {
  const t = raw.trim().replace(/```[\s\S]*?```/g, "").replace(/^[^:]{0,40}:\s*/i, "").replace(/\[[^\]]*\]|\([^)]*\)/g, "").replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim();
  if (t.split(/\s+/).length <= budget) return t;
  const sentences = t.match(/[^.!?]+[.!?]?/g) ?? [t];
  let out = "", words = 0;
  for (const s of sentences) { const w = s.trim().split(/\s+/).length; if (words + w > budget) break; out += s; words += w; }
  return (out.trim() || t.split(/\s+/).slice(0, budget).join(" ")).trim();
}

export async function runScripts(input: { brief: string; audienceLabel: string; audienceDescription: string; ageRange?: string; interests?: string }): Promise<GeneratedScript[]> {
  return Promise.all(SCRIPT_ANGLES.map(async (a) => {
    const raw = await llmText(scriptSystem(a.instruction), scriptUser(input), { maxTokens: 256 });
    const content = enforceScriptBudget(raw, SCRIPT_WORD_BUDGET);
    return { angle: a.id, label: a.label, content, wordCount: content.split(/\s+/).filter(Boolean).length };
  }));
}

// ── Stage 3 ──────────────────────────────────────────────────────────────────
async function toDataUrl(img: FalImage): Promise<string> {
  const r = await fetch(img.url); const buf = Buffer.from(await r.arrayBuffer());
  return `data:${img.content_type || "image/jpeg"};base64,${buf.toString("base64")}`;
}

export async function runPersonas(input: { falKey: string; productImageDataUrls: string[]; productDescription: string; audienceLabel: string; audienceDescription: string; ageRange?: string; interests?: string; scriptAngle: string; scriptContent: string }): Promise<GeneratedPersona[]> {
  let personas: { name: string; description: string }[] = [];
  try { personas = PersonaArray.parse(parseJsonLoose(await llmText(PERSONA_SYSTEM, personaUser({ audienceLabel: input.audienceLabel, audienceDescription: input.audienceDescription, ageRange: input.ageRange, interests: input.interests, scriptAngle: input.scriptAngle, scriptContent: input.scriptContent }), { maxTokens: 900 }))); } catch { /* fallback */ }
  while (personas.length < PERSONA_COUNT) personas.push({ name: `Creator ${personas.length + 1}`, description: "A relatable everyday content creator who fits this audience." });
  personas = personas.slice(0, PERSONA_COUNT);
  // Persona portraits are generated with Seedream 5 Pro — on ByteDance ARK when the
  // ARK key is configured, else FAL's Seedream. (Previously hardcoded to Nano Banana /
  // GPT-Image, which is why Nano Banana kept appearing despite the Seedream selection.)
  const imageProvider: "ark" | "fal" = arkConfigured() ? "ark" : "fal";
  return Promise.all(personas.map(async (p) => {
    const provider = "seedream-5-pro";
    try {
      const img = await editWithNanoBananaPro(input.falKey, input.productImageDataUrls, portraitPrompt(p), { aspect: TARGET_ASPECT_RATIO, model: "seedream-5-pro", provider: imageProvider });
      const imageDataUrl = await toDataUrl(img);
      let qcScore: number | undefined, qcNotes: string | undefined;
      // QC is best-effort AND time-bounded (25s) so a throttled Gemini can't hang the
      // persona step and starve the downstream video render of function budget.
      try { const qc = ImageQc.parse(await Promise.race([llmJson(IMAGE_QC_SYSTEM, imageQcUser(input.productDescription, p.description), IMAGE_QC_SCHEMA, { attachments: [{ mimeType: "image/jpeg", dataBase64: imageDataUrl.split(",")[1] ?? "" }], maxTokens: 300 }), new Promise((_, rej) => setTimeout(() => rej(new Error("QC timed out")), 25_000))])); qcScore = qc.score; qcNotes = qc.notes; } catch { /* best-effort */ }
      return { ...p, imageDataUrl, provider, qcScore, qcNotes };
    } catch (e) { return { ...p, provider, qcNotes: `Portrait failed: ${e instanceof Error ? e.message : e}` }; }
  }));
}

/** Pick the persona most usable for a talking-head video (highest QC among those with a portrait). */
export function bestPersona(personas: GeneratedPersona[]): GeneratedPersona | null {
  const withImg = personas.filter(p => p.imageDataUrl);
  if (!withImg.length) return null;
  return withImg.sort((a, b) => (b.qcScore ?? 0) - (a.qcScore ?? 0))[0];
}

// ── Stage 4 ──────────────────────────────────────────────────────────────────
export async function runVoice(input: { falKey: string; personaName: string; personaDescription: string; scriptContent: string; language?: string }): Promise<{ traits: VoiceTraitsT; voice: string; audioUrl: string }> {
  let traits: VoiceTraitsT = { gender: null, ageBracket: null, descriptors: [], preferredUseCase: null };
  try { traits = VoiceTraits.parse(await llmJson(VOICE_TRAITS_SYSTEM, voiceTraitsUser({ name: input.personaName, description: input.personaDescription }), VOICE_TRAITS_SCHEMA, { maxTokens: 200 })); } catch { /* defaults */ }
  const voiceHint = [traits.gender, traits.ageBracket, ...(traits.descriptors ?? [])].filter(Boolean).join(", ");
  const voice = resolveElevenVoice(input.language ?? "", voiceHint);
  const audio = await generateElevenLabsSpeech(input.falKey, { text: input.scriptContent.slice(0, 5000), voice, speed: 1.1 });
  return { traits, voice, audioUrl: audio.url };
}

// ── Stage 5 — Seedance reference-to-video ────────────────────────────────────
// PRIMARY: ByteDance ARK Seedance 2.5. ARK accepts AI-generated creator faces
// (FAL's 2.5 content-policy-rejects them) and renders reliably in ONE pass with
// native lip-synced audio — so the talking-head no longer times out on the slow
// 2.5→2.0 FAL dance. FALLBACK (only if ARK isn't configured or errors): the
// original FAL queue path, 2.5 → 2.0 (2.0 accepts the created face).
const SEEDANCE_25 = "bytedance/seedance-2.5/reference-to-video";
const SEEDANCE_20 = "bytedance/seedance-2.0/reference-to-video";

function seedanceBody(input: { portraitUrl: string; referenceUrls?: string[]; voiceoverUrl?: string; prompt: string; durationSec?: number }) {
  const hasVoiceover = /^https?:\/\//.test(input.voiceoverUrl ?? "");
  const imageUrls = [input.portraitUrl, ...(input.referenceUrls ?? [])].filter(u => /^https?:\/\//.test(u)).slice(0, 4);
  return {
    prompt: input.prompt,
    image_urls: imageUrls,
    ...(hasVoiceover ? { audio_urls: [input.voiceoverUrl] } : {}),
    duration: String(input.durationSec ?? TARGET_VIDEO_SECONDS),
    resolution: "1080p",
    aspect_ratio: TARGET_ASPECT_RATIO,
    generate_audio: true,
  };
}

/** Poll a FAL queue job to completion. COMPLETED-but-no-video (content policy) is terminal. */
export async function pollVideo(falKey: string, handle: FalQueueSubmit, deadlineMs: number): Promise<string | null> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 6000));
    let status: string;
    try { ({ status } = await getFalQueueStatus(falKey, handle.statusUrl)); } catch { continue; } // transient status poll
    if (status === "COMPLETED") {
      try { const v = await fetchFalVideoResult(falKey, handle.responseUrl); return v.url || null; }
      catch { return null; } // completed with no video → terminal (e.g. content policy)
    }
    if (status === "FAILED") return null;
  }
  return null;
}

async function renderOne(falKey: string, model: string, body: Record<string, unknown>, deadlineMs: number): Promise<string | null> {
  try { return await pollVideo(falKey, await submitFalQueueJob(falKey, model, body), deadlineMs); }
  catch { return null; }
}

/**
 * Render the talking-head. ARK Seedance 2.5 is tried FIRST (reliable, accepts the AI
 * face, native audio); the FAL queue (2.5 → 2.0) is only used when ARK isn't
 * configured or errors. `onFallback` fires when we drop from ARK to the FAL path.
 */
export async function renderSeedanceVideo(
  input: { falKey: string; portraitUrl: string; referenceUrls?: string[]; voiceoverUrl?: string; characterName?: string; characterDescription: string; scriptContent: string; timeOfDay: string; durationSec?: number },
  onFallback?: () => void,
): Promise<{ videoUrl?: string; usedModel?: "seedance-2.5" | "seedance-2.0" | "ark-seedance-2.5" }> {
  const durationSec = Math.max(4, Math.min(30, input.durationSec ?? TARGET_VIDEO_SECONDS)); // Seedance 2.5 ref caps at 30s
  // Reference images: the portrait (identity) plus any extra references (e.g. the character
  // "world" scene) so the render is grounded in that character + environment.
  const refUrls = (input.referenceUrls ?? []).filter(u => /^https?:\/\//.test(u));
  // ── PRIMARY · ByteDance ARK Seedance 2.5 ──
  // ARK generates its own lip-synced audio from the script embedded in the prompt,
  // so we prompt for native speech (hasVoiceover:false) rather than a supplied track.
  if (arkConfigured()) {
    const arkPrompt = buildVideoPrompt({ provider: "seedance", characterName: input.characterName, characterDescription: input.characterDescription, hasPortrait: true, hasVoiceover: false, scriptContent: input.scriptContent, timeOfDay: input.timeOfDay });
    try {
      const v = await renderArkSeedance(
        { task: "ref", videoModelId: "seedance-2-5", prompt: arkPrompt, imageUrls: [input.portraitUrl, ...refUrls], durationSec, aspect: TARGET_ASPECT_RATIO, resolution: "1080p", generateAudio: true },
        { pollMs: 6000, timeoutMs: 9 * 60 * 1000 },
      );
      if (v.url) return { videoUrl: v.url, usedModel: "ark-seedance-2.5" };
    } catch { /* fall through to the FAL queue */ }
    onFallback?.();
  }

  // ── FALLBACK · FAL queue (2.5 → 2.0) ──
  // Native Seedance audio here too: a 30s reference track exceeds the FAL models' 15s cap.
  // The character-"world" scene rides along as an extra reference image (refUrls).
  const prompt = buildVideoPrompt({ provider: "seedance", characterName: input.characterName, characterDescription: input.characterDescription, hasPortrait: true, hasVoiceover: false, scriptContent: input.scriptContent, timeOfDay: input.timeOfDay });
  const body = seedanceBody({ portraitUrl: input.portraitUrl, referenceUrls: refUrls, prompt, durationSec });
  // 2.5 first (rejections come back fast, so this doesn't eat the budget).
  const v25 = await renderOne(input.falKey, SEEDANCE_25, body, 8 * 60 * 1000);
  if (v25) return { videoUrl: v25, usedModel: "seedance-2.5" };
  const v20 = await renderOne(input.falKey, SEEDANCE_20, body, 6 * 60 * 1000);
  if (v20) return { videoUrl: v20, usedModel: "seedance-2.0" };
  return {};
}
