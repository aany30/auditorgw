/**
 * Fal.ai client wrapper — raw fetch, no SDK dependency.
 * Uses fal-ai/nano-banana-pro/edit (Google Nano Banana Pro) to compose a creative
 * scene around the user's product while keeping the product identical.
 */

import {
  normalizeImageModel,
  normalizeVideoModel,
  resolveVideoDuration,
  type ImageModelId,
  type VideoModelId,
} from "./generation-models";
import { arkSeedanceEnabled, arkConfigured, renderArkSeedance, submitArkSeedanceTask, type SeedanceProvider } from "./ark";
export type { SeedanceProvider } from "./ark";

/** ARK sentinel handle — encodes an ARK task id in the FAL queue-handle shape so the
 *  decoupled render/render-status routes carry it opaquely without a schema change. */
const ARK_HANDLE_PREFIX = "ark://";
export function isArkHandle(url: string): boolean {
  return url.startsWith(ARK_HANDLE_PREFIX);
}
export function arkTaskIdFromHandle(url: string): string {
  return url.slice(ARK_HANDLE_PREFIX.length);
}

/** True when this render should go to ARK. Only Seedance can use ARK (Veo/Kling have no
 *  ARK equivalent and stay on FAL). A per-request `provider` overrides the env default:
 *  "fal" forces FAL, "ark" forces ARK (when a key is configured), "auto"/undefined defers
 *  to the SEEDANCE_PROVIDER env default. */
function shouldRenderOnArk(model?: VideoModelId, provider?: SeedanceProvider): boolean {
  if (normalizeVideoModel(model).id !== "seedance-2") return false;
  if (provider === "fal") return false;
  if (provider === "ark") return arkConfigured();
  return arkSeedanceEnabled();
}

const FAL_BASE = "https://fal.run";
const FAL_QUEUE_BASE = "https://queue.fal.run";

export function mapSeedanceAspect(a?: string): string {
  switch (a) {
    case "1:1": return "1:1";
    case "9:16": return "9:16";
    case "16:9": return "16:9";
    case "4:5": return "3:4";
    default: return "auto";
  }
}

export type FalQueueStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface FalQueueSubmit {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
}

function falQueueStatusUrl(modelId: string, requestId: string): string {
  return `${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}/status`;
}

function falQueueResponseUrl(modelId: string, requestId: string): string {
  return `${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}`;
}

/**
 * fetch() with a hard per-request timeout. The Fal queue poll loop enforces an
 * overall deadline only between iterations — so a single hung request (FAL's API
 * accepts the connection but never responds) would block past the deadline and
 * ride all the way into Vercel's 800s function kill, freezing the UI on the last
 * status. Bounding every individual request guarantees the loop stays responsive.
 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Submit a job to the Fal queue — returns immediately with tracking URLs from Fal. */
export async function submitFalQueueJob(
  apiKey: string,
  modelId: string,
  input: Record<string, unknown>,
): Promise<FalQueueSubmit> {
  let submitRes: Response;
  try {
    submitRes = await fetchWithTimeout(`${FAL_QUEUE_BASE}/${modelId}`, {
      method: "POST",
      headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }, 60_000);
  } catch (e) {
    throw new Error(`Fal queue submit failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!submitRes.ok) {
    const err = await submitRes.text().catch(() => "");
    throw new Error(`Fal queue submit HTTP ${submitRes.status}: ${err.slice(0, 200)}`);
  }
  const submitData = (await submitRes.json()) as {
    request_id?: string;
    status_url?: string;
    response_url?: string;
  };
  const requestId = submitData.request_id;
  if (!requestId) throw new Error("Fal queue returned no request_id");
  return {
    requestId,
    statusUrl: submitData.status_url ?? falQueueStatusUrl(modelId, requestId),
    responseUrl: submitData.response_url ?? falQueueResponseUrl(modelId, requestId),
  };
}

/** Poll Fal queue status — prefer the status_url returned by submit. */
export async function getFalQueueStatus(
  apiKey: string,
  statusUrl: string,
): Promise<{ status: FalQueueStatus; error?: string }> {
  const statusRes = await fetchWithTimeout(statusUrl, {
    headers: { Authorization: `Key ${apiKey}` },
  }, 30_000);
  if (!statusRes.ok) {
    const err = await statusRes.text().catch(() => "");
    throw new Error(`Fal queue status HTTP ${statusRes.status}: ${err.slice(0, 200)}`);
  }
  const statusData = (await statusRes.json()) as { status?: string; error?: string };
  const status = String(statusData.status ?? "IN_PROGRESS") as FalQueueStatus;
  return { status, error: statusData.error };
}

/** Fetch the completed result payload — prefer the response_url returned by submit. */
export async function getFalQueueResult(
  apiKey: string,
  responseUrl: string,
): Promise<Record<string, unknown>> {
  const resultRes = await fetchWithTimeout(responseUrl, {
    headers: { Authorization: `Key ${apiKey}` },
  }, 60_000);
  if (!resultRes.ok) {
    const err = await resultRes.text().catch(() => "");
    throw new Error(`Fal queue result HTTP ${resultRes.status}: ${err.slice(0, 200)}`);
  }
  return (await resultRes.json()) as Record<string, unknown>;
}

/** Submit to Fal queue and poll until the job completes (reliable for long Seedance renders). */
async function runFalQueueModel(
  apiKey: string,
  modelId: string,
  input: Record<string, unknown>,
  opts?: { pollMs?: number; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const pollMs = opts?.pollMs ?? 4000;
  const timeoutMs = opts?.timeoutMs ?? 750_000;
  const deadline = Date.now() + timeoutMs;
  const t0 = Date.now();

  const { requestId, statusUrl, responseUrl } = await submitFalQueueJob(apiKey, modelId, input);
  console.log(`[fal-queue] submitted model=${modelId} req=${requestId} timeoutMs=${timeoutMs}`);

  let lastStatus = "";
  let polls = 0;
  let fetchErrors = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollMs));
    polls++;
    let statusData: { status: FalQueueStatus; error?: string };
    try {
      statusData = await getFalQueueStatus(apiKey, statusUrl);
    } catch (e) {
      fetchErrors++;
      console.warn(`[fal-queue] req=${requestId} poll #${polls} status fetch failed (${fetchErrors} total): ${e instanceof Error ? e.message : e}`);
      continue;
    }
    if (statusData.status !== lastStatus) {
      lastStatus = statusData.status;
      console.log(`[fal-queue] req=${requestId} status=${statusData.status} @${Math.round((Date.now() - t0) / 1000)}s (poll #${polls})`);
    }
    if (statusData.status === "COMPLETED") {
      console.log(`[fal-queue] req=${requestId} COMPLETED in ${Math.round((Date.now() - t0) / 1000)}s, fetching result`);
      return getFalQueueResult(apiKey, responseUrl);
    }
    if (statusData.status === "FAILED") {
      console.error(`[fal-queue] req=${requestId} FAILED: ${statusData.error ?? "unknown"}`);
      throw new Error(`Fal queue job failed: ${statusData.error ?? "unknown error"}`);
    }
  }
  console.error(`[fal-queue] req=${requestId} TIMED OUT after ${Math.round((Date.now() - t0) / 1000)}s (${polls} polls, ${fetchErrors} fetch errors, last status=${lastStatus || "none"})`);
  throw new Error("Fal queue job timed out — try a shorter duration or retry");
}

export function extractFalVideo(data: Record<string, unknown>): FalVideo {
  const video = (data.video ?? (data as { videos?: FalVideo[] }).videos?.[0]) as FalVideo | undefined;
  if (!video?.url) throw new Error("Seedance returned no video URL");
  return video;
}

export interface FalAudio {
  url: string;
  content_type?: string;
  duration?: number;
}

/** Pull the audio URL out of a FAL result (elevenlabs tts / audio endpoints). */
export function extractFalAudio(data: Record<string, unknown>): FalAudio {
  const audio = (data.audio
    ?? (data as { audios?: FalAudio[] }).audios?.[0]
    ?? ((data as { audio_url?: string }).audio_url ? { url: (data as { audio_url?: string }).audio_url } : undefined)
  ) as FalAudio | undefined;
  if (!audio?.url) throw new Error("ElevenLabs returned no audio URL");
  return audio;
}

/**
 * Generate speech with ElevenLabs on FAL (multilingual TTS). Returns the audio URL.
 * TTS is fast, so this waits for completion. Uses the same FAL_KEY as everything else.
 * VERIFY: FAL endpoint + input keys — https://fal.ai/models/fal-ai/elevenlabs/tts/multilingual-v2
 */
export async function generateElevenLabsSpeech(
  apiKey: string,
  opts: { text: string; voice: string; modelId?: string; speed?: number },
): Promise<FalAudio> {
  // `speed` (ElevenLabs range 0.7–1.2, default 1.0) sets the delivery pace — >1 speeds
  // it up so the read lands snappier against the shot. Clamped to the valid range.
  const input: Record<string, unknown> = { text: opts.text, voice: opts.voice };
  if (typeof opts.speed === "number") input.speed = Math.max(0.7, Math.min(1.2, opts.speed));
  const data = await runFalQueueModel(
    apiKey,
    "fal-ai/elevenlabs/tts/multilingual-v2",
    input,
    { timeoutMs: 120_000 },
  );
  return extractFalAudio(data);
}

/**
 * Zero-shot VOICE CLONE via FAL F5-TTS: speak `text` in the voice of a reference audio sample —
 * one call, reuses FAL_KEY (no ElevenLabs account). ref_text is auto-transcribed when omitted.
 * Returns the generated speech URL. `refAudioUrl` must be HTTP (upload data: URLs to FAL first).
 * VERIFY: https://fal.ai/models/fal-ai/f5-tts/api
 */
export async function cloneVoiceWithF5TTS(
  apiKey: string,
  opts: { refAudioUrl: string; text: string },
): Promise<{ url: string; duration?: number }> {
  const data = await runFalQueueModel(apiKey, "fal-ai/f5-tts", {
    gen_text: opts.text,
    ref_audio_url: opts.refAudioUrl,
    model_type: "F5-TTS",
    remove_silence: true,
  }, { timeoutMs: 300_000 });
  const a = (data.audio_url ?? data.audio) as { url?: string } | string | undefined;
  const url = typeof a === "string" ? a : a?.url;
  if (!url) throw new Error("F5-TTS returned no audio URL");
  return { url, duration: (data as { duration?: number }).duration };
}

/**
 * Transcribe an audio file (FAL Wizper / Whisper v3). Returns the full text plus timestamped
 * segment cues — used to drive the b-roll keywords and burn accurately-timed captions.
 * VERIFY: https://fal.ai/models/fal-ai/wizper/api
 */
export async function transcribeAudioWithFal(
  apiKey: string,
  audioUrl: string,
): Promise<{ text: string; cues: { text: string; start: number; end: number }[] }> {
  // Both models are Whisper v3. Prefer fal-ai/whisper with WORD-level timestamps (tight
  // caption sync); if it errors, fall back to wizper (fal's optimized Whisper, segment-only).
  // The cue builder below normalises whichever granularity comes back, so sync stays good.
  let data: Record<string, unknown>;
  try {
    data = await runFalQueueModel(apiKey, "fal-ai/whisper", {
      audio_url: audioUrl,
      task: "transcribe",
      chunk_level: "word",
    }, { timeoutMs: 180_000 });
  } catch (e) {
    console.warn(`[transcribe] fal-ai/whisper word-level failed, falling back to wizper segment: ${e instanceof Error ? e.message : e}`);
    data = await runFalQueueModel(apiKey, "fal-ai/wizper", {
      audio_url: audioUrl,
      task: "transcribe",
      chunk_level: "segment",
    }, { timeoutMs: 180_000 });
  }

  const text = String((data as { text?: string }).text ?? "").trim();
  const rawChunks = ((data as { chunks?: { timestamp?: [number, number]; text?: string }[] }).chunks ?? [])
    .map(c => ({ text: String(c.text ?? "").trim(), start: Number(c.timestamp?.[0] ?? 0) || 0, end: Number(c.timestamp?.[1] ?? 0) || 0 }))
    .filter(c => c.text && c.end >= c.start);

  // Flatten to a word list with timestamps — split any multi-word (segment) chunk
  // proportionally so word-level and segment-level responses are handled uniformly.
  const words: { text: string; start: number; end: number }[] = [];
  for (const c of rawChunks) {
    const ws = c.text.split(/\s+/).filter(Boolean);
    if (ws.length <= 1) { words.push(c); continue; }
    const span = Math.max(0.01, c.end - c.start);
    let t = c.start;
    for (const w of ws) { const d = span / ws.length; words.push({ text: w, start: t, end: Math.min(c.end, t + d) }); t += d; }
  }
  for (let i = 0; i < words.length; i++) {
    if (!(words[i].end > words[i].start)) words[i].end = words[i + 1]?.start ?? words[i].start + 0.4;
  }

  // Group ~3 words per cue so captions advance with the voice.
  const cues: { text: string; start: number; end: number }[] = [];
  for (let i = 0; i < words.length; i += 3) {
    const g = words.slice(i, i + 3);
    if (!g.length) continue;
    cues.push({ text: g.map(w => w.text).join(" "), start: g[0].start, end: g[g.length - 1].end });
  }
  return { text, cues: cues.filter(c => c.text && c.end > c.start) };
}

/**
 * Submit a lip-sync job (video + audio → talking video with the mouth matched to the
 * audio) WITHOUT waiting — returns the FAL queue handle so the client polls it via
 * /render-status like a normal render. Merges the audio track in the process.
 * VERIFY: FAL lip-sync endpoint + input keys — https://fal.ai/models/fal-ai/sync-lipsync
 */
export async function submitLipsyncJob(
  apiKey: string,
  opts: { videoUrl: string; audioUrl: string },
): Promise<FalQueueSubmit> {
  return submitFalQueueJob(apiKey, "fal-ai/sync-lipsync", {
    video_url: opts.videoUrl,
    audio_url: opts.audioUrl,
  });
}

/** Lip-sync a talking-head video to an audio track (mouth matched to the speech). Submits the
 *  sync-lipsync job and polls to completion. Returns the lip-synced video URL. */
export async function lipSyncVideo(apiKey: string, videoUrl: string, audioUrl: string): Promise<FalVideo> {
  const submit = await submitLipsyncJob(apiKey, { videoUrl, audioUrl });
  const deadline = Date.now() + 500_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    let s: { status: FalQueueStatus; error?: string };
    try { s = await getFalQueueStatus(apiKey, submit.statusUrl); } catch { continue; }
    if (s.status === "COMPLETED") return extractFalVideo(await getFalQueueResult(apiKey, submit.responseUrl));
    if (s.status === "FAILED") throw new Error(`Lip-sync failed: ${s.error ?? "unknown"}`);
  }
  throw new Error("Lip-sync timed out");
}

/**
 * Concatenate several finished video clips into one continuous reel using
 * FAL's ffmpeg compose endpoint (`fal-ai/ffmpeg-api/compose`). Clips are laid
 * end-to-end on a single video track; timestamps + durations are in milliseconds.
 * Returns the single stitched video URL.
 *
 * Docs: https://fal.ai/models/fal-ai/ffmpeg-api/compose
 */
export async function stitchVideosWithFal(
  apiKey: string,
  clips: { url: string; durationSec: number }[],
  opts?: { keepAudio?: boolean },
): Promise<FalVideo> {
  const usable = clips.filter(c => c.url.startsWith("http") && c.durationSec > 0);
  if (!usable.length) throw new Error("No clips to stitch");
  if (usable.length === 1) return { url: usable[0].url, duration: usable[0].durationSec };

  let cursorMs = 0;
  const keyframes = usable.map(c => {
    const durationMs = Math.max(1000, Math.round(c.durationSec * 1000));
    const frame = { url: c.url, timestamp: cursorMs, duration: durationMs };
    cursorMs += durationMs;
    return frame;
  });

  // Video track always; an audio track (same clip keyframes) preserves each clip's
  // native audio when stitching. VERIFY: fal-ai/ffmpeg-api/compose audio-track shape.
  const tracks: Record<string, unknown>[] = [{ id: "reel", type: "video", keyframes }];
  if (opts?.keepAudio) tracks.push({ id: "reel_audio", type: "audio", keyframes });

  const data = await runFalQueueModel(apiKey, "fal-ai/ffmpeg-api/compose", { tracks });

  // compose returns { video_url, thumbnail_url }; tolerate { video: { url } } too.
  const url =
    (data.video_url as string | undefined) ??
    ((data.video as FalVideo | undefined)?.url) ??
    (data.url as string | undefined);
  if (!url) throw new Error("ffmpeg compose returned no video URL");
  return { url, duration: cursorMs / 1000 };
}

/**
 * Trim a video to at most `maxSec` seconds (from the start) via FAL ffmpeg compose — a single
 * video-track keyframe whose duration caps the output. Used to satisfy Kling motion-control's
 * ≤10s reference-video limit. Returns the trimmed video URL (audio dropped).
 */
export async function trimVideoWithFal(apiKey: string, url: string, maxSec: number): Promise<FalVideo> {
  const durationMs = Math.max(1000, Math.round(maxSec * 1000));
  const tracks = [{ id: "trim", type: "video", keyframes: [{ url, timestamp: 0, duration: durationMs }] }];
  const data = await runFalQueueModel(apiKey, "fal-ai/ffmpeg-api/compose", { tracks });
  const out =
    (data.video_url as string | undefined) ??
    ((data.video as FalVideo | undefined)?.url) ??
    (data.url as string | undefined);
  if (!out) throw new Error("ffmpeg trim returned no video URL");
  return { url: out, duration: maxSec };
}

export interface FalImage {
  url: string;
  width?: number;
  height?: number;
  content_type?: string;
}

const FAL_STORAGE_INITIATE = "https://rest.fal.ai/storage/upload/initiate";

/** Parse a `data:<mime>;base64,<payload>` URL into its mime + raw bytes. */
function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const m = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) throw new Error("Not a data: URL");
  const mime = m[1] || "application/octet-stream";
  const isB64 = Boolean(m[2]);
  const payload = m[3];
  if (isB64) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime, bytes };
  }
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
}

const FAL_EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/webm": "weba",
};

/**
 * Upload a `data:` URL (or already-HTTP URL — returned as-is) to FAL storage and
 * return a publicly fetchable HTTPS URL. Seedance reference-to-video only accepts
 * HTTP(S) image URLs, so user-uploaded data URLs must be hosted first.
 *
 * Flow: POST initiate {content_type,file_name} → {file_url, upload_url};
 * PUT raw bytes to upload_url; file_url is then fetchable.
 */
export async function uploadToFalStorage(apiKey: string, dataUrl: string): Promise<string> {
  if (dataUrl.startsWith("http")) return dataUrl;
  const { mime, bytes } = parseDataUrl(dataUrl);
  const ext = FAL_EXT_BY_MIME[mime] ?? "bin";
  const fileName = `upload_${bytes.length}.${ext}`;

  const initRes = await fetch(FAL_STORAGE_INITIATE, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: mime, file_name: fileName }),
  });
  if (!initRes.ok) {
    const err = await initRes.text().catch(() => "");
    throw new Error(`FAL storage initiate HTTP ${initRes.status}: ${err.slice(0, 200)}`);
  }
  const { file_url, upload_url } = (await initRes.json()) as { file_url?: string; upload_url?: string };
  if (!file_url || !upload_url) throw new Error("FAL storage initiate returned no URLs");

  const putRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": mime },
    body: bytes as unknown as BodyInit,
  });
  if (!putRes.ok) {
    const err = await putRes.text().catch(() => "");
    throw new Error(`FAL storage upload HTTP ${putRes.status}: ${err.slice(0, 200)}`);
  }
  return file_url;
}

/**
 * FAL Seedream 5 Pro text-to-image (`bytedance/seedream/v5/pro/text-to-image`).
 * No reference image — the shape is driven by a named aspect preset (text-to-image
 * has no input to infer the aspect from). ~110-130s per render.
 */
async function seedreamText2Image(
  apiKey: string,
  prompt: string,
  opts?: { aspect?: FalAspect; seed?: number },
): Promise<FalImage> {
  const payload: Record<string, unknown> = {
    prompt,
    image_size: seedreamImageSize(opts?.aspect ?? "9:16"),
    num_images: 1,
  };
  if (typeof opts?.seed === "number") payload.seed = opts.seed;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 240_000);
  try {
    const res = await fetch(`${FAL_BASE}/bytedance/seedream/v4/text-to-image`, {
      method: "POST",
      headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`FAL Seedream t2i HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = (await res.json()) as { images?: FalImage[] };
    const img = data.images?.[0];
    if (!img?.url) throw new Error("FAL Seedream returned no image URL");
    return img;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pure text-to-image (no reference images) — used for character anchors, world
 * backdrops, and Stage-03 scene-anchoring reference assets. Standard model is
 * **Seedream 5 Pro** on FAL (`bytedance/seedream/v5/pro/text-to-image`); Nano
 * Banana Pro (`fal-ai/nano-banana-pro`) is the automatic fallback if Seedream
 * errors or times out. (The ByteDance ARK Seedream path was removed — that model
 * 404s on this account; FAL serves Seedream directly.)
 */
export async function generateImageWithNanoBananaPro(
  apiKey: string,
  prompt: string,
  opts?: { aspect?: FalAspect; resolution?: "1K" | "2K" | "4K"; seed?: number; provider?: "ark" | "fal" },
): Promise<FalImage> {
  // Standard = Seedream 5 Pro (FAL text-to-image). Nano Banana Pro is the fallback.
  try {
    return await seedreamText2Image(apiKey, prompt, { aspect: opts?.aspect, seed: opts?.seed });
  } catch (e) {
    console.warn(`[seedream] FAL text-to-image failed, falling back to Nano Banana Pro: ${e instanceof Error ? e.message : e}`);
  }
  const payload: Record<string, unknown> = {
    prompt,
    aspect_ratio: opts?.aspect ?? "9:16",
    resolution: opts?.resolution ?? "2K",
    output_format: "jpeg",
    num_images: 1,
  };
  // A distinct seed per character makes near-identical prompts render different people.
  if (typeof opts?.seed === "number") payload.seed = opts.seed;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180_000);
  try {
    const res = await fetch(`${FAL_BASE}/fal-ai/nano-banana-pro`, {
      method: "POST",
      headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Fal.ai HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = (await res.json()) as { images?: FalImage[] };
    const img = data.images?.[0];
    if (!img?.url) throw new Error("Fal.ai returned no image URL");
    return img;
  } finally {
    clearTimeout(timer);
  }
}

export type FalAspect = "1:1" | "4:5" | "9:16" | "16:9" | "auto";

/**
 * Seedream v5 image_size. For 2K/4K we pass FAL's documented `auto_2K` / `auto_4K`
 * string — in EDIT mode Seedream auto-detects the aspect from the input image, so
 * this yields a 2K/4K render at the reference's aspect (e.g. a 9:16 anchor stays
 * 9:16). For 1K it snaps to a named aspect preset.
 */
function seedreamImageSize(aspect: FalAspect, resolution?: "1K" | "2K" | "4K"): string {
  if (resolution === "2K") return "auto_2K";
  if (resolution === "4K") return "auto_4K";
  switch (aspect) {
    case "9:16": return "portrait_16_9";
    case "4:5": return "portrait_4_3";
    case "16:9": return "landscape_16_9";
    case "1:1": return "square_hd";
    default: return "square_hd";
  }
}

/** GPT Image only supports a fixed set of output sizes — snap to the nearest. */
function gptImageSize(aspect: FalAspect): string {
  switch (aspect) {
    case "9:16":
    case "4:5": return "1024x1536";
    case "16:9": return "1536x1024";
    case "1:1": return "1024x1024";
    default: return "auto";
  }
}

/**
 * Edit/compose with the selected image model (Nano Banana Pro/2, Seedream 5
 * Lite/Pro, GPT Image). Keeps the supplied product EXACTLY as-is and builds a new
 * scene/overlay around it per the prompt. Each model expresses the output
 * canvas differently (aspect_ratio vs image_size preset/enum), so the payload
 * is built per model — mirroring buildVideoInput()'s per-model dispatch.
 * All four return the image at `images[0].url`.
 */
export async function editWithNanoBananaPro(
  apiKey: string,
  imageDataUrls: string | string[],
  prompt: string,
  opts?: { aspect?: FalAspect; resolution?: "1K" | "2K" | "4K"; model?: ImageModelId; provider?: "ark" | "fal" },
): Promise<FalImage> {
  const urls = (Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrls]).filter(u => u.startsWith("data:image/") || u.startsWith("http"));
  if (!urls.length) throw new Error("At least one valid image URL is required");

  const entry = normalizeImageModel(opts?.model);
  const aspect = opts?.aspect ?? "auto";

  // Seedream 5 Pro/Lite edits go straight to FAL (the ByteDance ARK Seedream model
  // 404s on this account, so routing through it only wasted a call + logged noise).

  let payload: Record<string, unknown>;
  if (entry.id === "seedream-5-lite" || entry.id === "seedream-5-pro") {
    payload = {
      prompt,
      image_urls: urls,
      image_size: seedreamImageSize(aspect, opts?.resolution),
      num_images: 1,
    };
  } else if (entry.id === "gpt-image-1") {
    // input_fidelity:"high" is what keeps the supplied product intact.
    payload = {
      prompt,
      image_urls: urls,
      image_size: gptImageSize(aspect),
      input_fidelity: "high",
      quality: "high",
      output_format: "jpeg",
      num_images: 1,
    };
  } else if (entry.id === "nano-banana-2") {
    // Richer edit payload (4K, thinking/web-search).
    payload = {
      prompt,
      image_urls: urls,
      num_images: 1,
      aspect_ratio: aspect,
      resolution: "4K",
      output_format: "jpeg",
      thinking_level: "high",
      enable_web_search: true,
      safety_tolerance: "5",
      limit_generations: true,
    };
  } else {
    // nano-banana-pro (default) — original 2K body.
    payload = {
      prompt,
      image_urls: urls,
      aspect_ratio: aspect,
      resolution: opts?.resolution ?? "2K",
      output_format: "jpeg",
      num_images: 1,
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180_000);

  try {
    const res = await fetch(`${FAL_BASE}/${entry.falModelId}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Fal.ai HTTP ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = (await res.json()) as { images?: FalImage[] };
    const img = data.images?.[0];
    if (!img?.url) throw new Error("Fal.ai returned no image URL");
    return img;
  } catch (e) {
    // A bad/decommissioned model slug (e.g. a 404 on the Seedream endpoints) must not
    // hard-fail the whole generation. Fall back once to Nano Banana Pro — the account's
    // proven edit model — mirroring the text-to-image fallback above.
    if (entry.id !== "nano-banana-pro") {
      console.warn(`[edit] ${entry.falModelId} failed (${e instanceof Error ? e.message : e}) — falling back to Nano Banana Pro`);
      clearTimeout(timer);
      return editWithNanoBananaPro(apiKey, urls, prompt, { ...opts, model: "nano-banana-pro" });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export interface FalVideo {
  url: string;
  content_type?: string;
  duration?: number;
}

export type SeedanceResolution = "480p" | "720p" | "1080p";

/**
 * Image-to-video with ByteDance Seedance 2.0 (via Fal).
 * Animates a generated keyframe (start) into a short reel; an optional end frame
 * lets the model interpolate between two storyboard shots. Duration is hard-capped
 * to the Seedance-supported 4–10s window for reels.
 *
 * Docs: https://fal.ai/models/bytedance/seedance-2.0/image-to-video
 */
export type VideoTask = "i2v" | "ref";

export interface VideoBuildOpts {
  prompt: string;
  imageUrl?: string;            // i2v start frame
  endImageUrl?: string | null;  // i2v end frame
  imageUrls?: string[];         // ref-to-video inputs
  durationSec?: number;
  /**
   * Bypass the model's duration clamp and pass this value verbatim (string-seconds
   * models only). Used by the UGC ref-to-video path, where Seedance 2.0 accepts 15s
   * even though the i2v range is clamped to 10s — keeps generate-video unaffected.
   */
  unclampedDurationSec?: number;
  aspect?: FalAspect;
  resolution?: SeedanceResolution;
  generateAudio?: boolean;
}

export interface VideoBuildResult {
  falModelId: string;
  input: Record<string, unknown>;
  /** the task actually built — may differ from requested if the model lacks ref support */
  effectiveTask: VideoTask;
}

/**
 * Build the FAL endpoint + input payload for the chosen video model.
 * Seedance, Veo 3 and Kling have different input schemas (duration formats,
 * aspect handling, audio, reference-image support), so each gets its own builder.
 * If a reference-to-video task is requested for a model that only does i2v, it
 * gracefully downgrades (first image = start frame, last = end frame).
 */
export function buildVideoInput(
  modelId: VideoModelId | undefined,
  task: VideoTask,
  opts: VideoBuildOpts,
): VideoBuildResult {
  const entry = normalizeVideoModel(modelId);
  const duration = resolveVideoDuration(entry, opts.durationSec);
  // Seedance 2.5 only supports 480p/720p — clamp a requested 1080p down.
  const is25 = entry.id === "seedance-2-5";
  const resolution = is25 && (opts.resolution ?? "720p") === "1080p" ? "720p" : (opts.resolution ?? "720p");
  const audio = opts.generateAudio ?? false;

  // Resolve start/end frames for whichever task we end up running.
  const refUrls = (opts.imageUrls ?? []).filter(u => u.startsWith("http"));
  const useRef = task === "ref" && entry.supportsReferenceToVideo && refUrls.length > 0;
  const effectiveTask: VideoTask = useRef ? "ref" : "i2v";
  const startUrl = opts.imageUrl ?? refUrls[0];
  const endUrl = opts.endImageUrl ?? (refUrls.length > 1 ? refUrls[refUrls.length - 1] : null);

  if (useRef) {
    // Seedance reference-to-video (only model with ref support today).
    // The ref path supports a longer window than i2v — honour an explicit unclamped
    // value when given (clamped to the model's ref max: 2.5→30s, 2.0→15s), else the
    // clamped i2v duration. Prevents a 30s request leaking to a model that can't do it.
    const refMax = entry.refDurationMax ?? entry.durationRange[1];
    const refDuration =
      entry.durationFormat === "string-seconds" && opts.unclampedDurationSec
        ? Math.min(refMax, Math.round(opts.unclampedDurationSec))
        : duration;
    return {
      falModelId: entry.refFalModelId ?? entry.i2vFalModelId,
      effectiveTask,
      input: {
        prompt: opts.prompt,
        image_urls: refUrls.slice(0, 9),
        duration: String(refDuration),
        resolution,
        aspect_ratio: mapSeedanceAspect(opts.aspect),
        generate_audio: audio,
      },
    };
  }

  if (!startUrl) throw new Error("At least one image URL is required for video generation");

  // image-to-video, per model schema.
  if (entry.id === "veo-3") {
    // VERIFY: FAL docs — Veo 3 i2v input keys (image_url, duration "8s", resolution, audio).
    return {
      falModelId: entry.i2vFalModelId,
      effectiveTask,
      input: {
        prompt: opts.prompt,
        image_url: startUrl,
        aspect_ratio: opts.aspect ?? "auto",
        duration: `${duration}s`,
        resolution,
        generate_audio: audio,
      },
    };
  }

  if (entry.id === "kling-2") {
    // VERIFY: FAL docs — Kling i2v input keys (duration enum "5"|"10", tail_image_url, aspect enum).
    const input: Record<string, unknown> = {
      prompt: opts.prompt,
      image_url: startUrl,
      duration: String(duration),
      aspect_ratio: opts.aspect ?? "16:9",
    };
    if (entry.supportsEndFrame && endUrl) input.tail_image_url = endUrl;
    return { falModelId: entry.i2vFalModelId, effectiveTask, input };
  }

  // Seedance image-to-video (default). NB: Seedance 2.5 i2v only accepts aspect_ratio "auto".
  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    image_url: startUrl,
    duration: String(duration),
    resolution,
    aspect_ratio: is25 ? "auto" : mapSeedanceAspect(opts.aspect),
    generate_audio: audio,
  };
  if (endUrl) input.end_image_url = endUrl;
  return { falModelId: entry.i2vFalModelId, effectiveTask, input };
}

export async function generateVideoWithSeedance(
  apiKey: string,
  opts: {
    imageUrl: string;
    endImageUrl?: string | null;
    prompt: string;
    durationSec?: number;
    aspect?: FalAspect;
    resolution?: SeedanceResolution;
    generateAudio?: boolean;
    model?: VideoModelId;
    seedanceProvider?: SeedanceProvider;
  },
): Promise<FalVideo> {
  if (shouldRenderOnArk(opts.model, opts.seedanceProvider)) {
    const duration = resolveVideoDuration(normalizeVideoModel(opts.model), opts.durationSec);
    return renderArkSeedance({
      task: "i2v",
      prompt: opts.prompt,
      imageUrl: opts.imageUrl,
      endImageUrl: opts.endImageUrl,
      durationSec: duration,
      aspect: opts.aspect,
      resolution: opts.resolution ?? "720p",
      generateAudio: opts.generateAudio,
    });
  }
  const { falModelId, input } = buildVideoInput(opts.model, "i2v", opts);
  const data = await runFalQueueModel(apiKey, falModelId, input);
  return extractFalVideo(data);
}

/**
 * Kling v3 motion-control (video-to-video): animate a CHARACTER IMAGE with the motion of a
 * REFERENCE VIDEO. The character/background come from the image; the actions follow the video.
 * This is NOT ByteDance Seedance — it sidesteps Seedance's "real person" face filter, so it's
 * how we drive an AI presenter without a 422. Duration is inferred from the reference video.
 * VERIFY input field names against https://fal.ai/models/fal-ai/kling-video/v3/standard/motion-control/api
 */
export async function generateVideoWithKlingMotionControl(
  apiKey: string,
  opts: {
    imageUrl: string; referenceVideoUrl: string; prompt?: string; pro?: boolean;
    characterOrientation?: string;            // required by the endpoint (e.g. "forward")
    extra?: Record<string, unknown>;          // schema-probe / future-proofing pass-through
  },
): Promise<FalVideo> {
  const model = opts.pro
    ? "fal-ai/kling-video/v3/pro/motion-control"
    : "fal-ai/kling-video/v3/standard/motion-control";
  const input: Record<string, unknown> = {
    image_url: opts.imageUrl,
    video_url: opts.referenceVideoUrl,
    // "image" = keep the avatar's own orientation and apply the video's motion (the ref video
    // must be ≤10s in this mode). "video" reorients the character to the driving video.
    character_orientation: opts.characterOrientation ?? "image",
    ...(opts.extra ?? {}),
  };
  if (opts.prompt) input.prompt = opts.prompt;
  const data = await runFalQueueModel(apiKey, model, input, { timeoutMs: 600_000 });
  return extractFalVideo(data);
}

/**
 * Kling AI Avatar (image + audio → lip-synced talking video). Maps audio waveforms to facial
 * motion directly — no reference video needed. Fallback for the avatar when the user supplies
 * audio but no driving/reference video. Also a non-Seedance path (no face filter).
 * VERIFY: https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro/api
 */
export async function generateKlingAiAvatar(
  apiKey: string,
  opts: { imageUrl: string; audioUrl: string; prompt?: string; model?: string; timeoutMs?: number },
): Promise<FalVideo> {
  const input: Record<string, unknown> = { image_url: opts.imageUrl, audio_url: opts.audioUrl };
  if (opts.prompt) input.prompt = opts.prompt;
  const model = opts.model || "fal-ai/kling-video/ai-avatar/v2/pro";
  const data = await runFalQueueModel(apiKey, model, input, { timeoutMs: opts.timeoutMs ?? 680_000 });
  return extractFalVideo(data);
}

/**
 * Multi-reference image-to-video. Pass up to 9 reference images and reference them
 * in the prompt as @Image1, @Image2, etc. Only Seedance supports true
 * reference-to-video; other models downgrade to image-to-video (first/last frame).
 *
 * Docs: https://fal.ai/models/bytedance/seedance-2.0/reference-to-video
 */
export async function generateReferenceVideoWithSeedance(
  apiKey: string,
  opts: {
    imageUrls: string[];
    prompt: string;
    durationSec?: number;
    unclampedDurationSec?: number;
    aspect?: FalAspect;
    resolution?: SeedanceResolution;
    generateAudio?: boolean;
    model?: VideoModelId;
    seedanceProvider?: SeedanceProvider;
  },
): Promise<FalVideo> {
  const urls = opts.imageUrls.filter(u => u.startsWith("http"));
  if (!urls.length) throw new Error("At least one reference image URL is required");
  // Cap the render poll at 600s so the downstream QC gate still fits inside the
  // route's 800s function budget (otherwise a slow render eats the whole window
  // and Vercel kills the function mid-QC with nothing delivered).
  if (shouldRenderOnArk(opts.model, opts.seedanceProvider)) {
    const duration = opts.unclampedDurationSec
      ? Math.round(opts.unclampedDurationSec)
      : resolveVideoDuration(normalizeVideoModel(opts.model), opts.durationSec);
    try {
      return await renderArkSeedance({
        task: "ref",
        prompt: opts.prompt,
        imageUrls: urls,
        durationSec: duration,
        aspect: opts.aspect,
        resolution: opts.resolution ?? "720p",
        generateAudio: opts.generateAudio,
      }, { timeoutMs: 600_000 });
    } catch (e) {
      // Same ARK real-person filter fallback as submitReferenceVideoSeedance.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/SensitiveContent|PrivacyInformation|real person|content[_ ]?polic/i.test(msg)) throw e;
      console.warn(`[seedance] ARK rejected a reference image as a possible real person — falling back to FAL Seedance queue. (${msg.slice(0, 160)})`);
    }
  }
  const { falModelId, input } = buildVideoInput(opts.model, "ref", { ...opts, imageUrls: urls });
  const data = await runFalQueueModel(apiKey, falModelId, input, { timeoutMs: 600_000 });
  return extractFalVideo(data);
}

/**
 * Submit a Seedance reference-to-video job WITHOUT waiting for it to finish, and
 * return the FAL queue tracking handle. Used by the decoupled UGC pipeline: a
 * 15s/1080p render routinely exceeds 10 minutes — longer than any single Vercel
 * function can live — so we submit here and let the client poll for completion.
 */
export async function submitReferenceVideoSeedance(
  apiKey: string,
  opts: {
    imageUrls: string[];
    prompt: string;
    durationSec?: number;
    unclampedDurationSec?: number;
    aspect?: FalAspect;
    resolution?: SeedanceResolution;
    generateAudio?: boolean;
    model?: VideoModelId;
    seedanceProvider?: SeedanceProvider;
  },
): Promise<FalQueueSubmit> {
  const urls = opts.imageUrls.filter(u => u.startsWith("http"));
  if (!urls.length) throw new Error("At least one reference image URL is required");
  if (shouldRenderOnArk(opts.model, opts.seedanceProvider)) {
    const duration = opts.unclampedDurationSec
      ? Math.round(opts.unclampedDurationSec)
      : resolveVideoDuration(normalizeVideoModel(opts.model), opts.durationSec);
    try {
      const taskId = await submitArkSeedanceTask({
        task: "ref",
        prompt: opts.prompt,
        imageUrls: urls,
        durationSec: duration,
        aspect: opts.aspect,
        resolution: opts.resolution ?? "720p",
        generateAudio: opts.generateAudio,
      });
      // Carry the ARK task id in the FAL queue-handle shape; render-status detects the
      // ark:// sentinel and polls ARK instead of the FAL queue.
      return { requestId: taskId, statusUrl: `${ARK_HANDLE_PREFIX}${taskId}`, responseUrl: `${ARK_HANDLE_PREFIX}${taskId}` };
    } catch (e) {
      // ARK's ByteDance privacy filter hard-rejects reference images it thinks contain a
      // real person (InputImageSensitiveContentDetected.PrivacyInformation) — which trips on
      // our AI-generated UGC creator shots. FAL's Seedance queue is far more permissive with
      // creator refs, so fall back to it instead of failing the render. Other ARK errors
      // (auth, quota, bad params) still surface.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/SensitiveContent|PrivacyInformation|real person|content[_ ]?polic/i.test(msg)) throw e;
      console.warn(`[seedance] ARK rejected a reference image as a possible real person — falling back to FAL Seedance queue. (${msg.slice(0, 160)})`);
    }
  }
  const { falModelId, input } = buildVideoInput(opts.model, "ref", { ...opts, imageUrls: urls });
  return submitFalQueueJob(apiKey, falModelId, input);
}

/** Fetch + extract the finished video for a completed FAL queue job. */
export async function fetchFalVideoResult(apiKey: string, responseUrl: string): Promise<FalVideo> {
  const data = await getFalQueueResult(apiKey, responseUrl);
  return extractFalVideo(data);
}
