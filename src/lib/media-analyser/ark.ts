/**
 * BytePlus ModelArk (ARK) — direct Seedance video access.
 *
 * ARK is ByteDance's first-party model platform; it serves the Seedance video
 * models without the FAL middleman. We route ONLY the Seedance render through ARK
 * — FAL still handles image editing (Nano Banana Pro) and asset storage, so the
 * keyframes/refs we feed ARK are already public FAL-hosted HTTPS URLs.
 *
 * The API is a create-task → poll flow (same async shape as the FAL queue), which
 * lets it slot into the existing decoupled UGC render pipeline unchanged:
 *   POST {base}/contents/generations/tasks         → { id }
 *   GET  {base}/contents/generations/tasks/{id}    → { status, content.video_url }
 *
 * Auth: `Authorization: Bearer <ARK_API_KEY>`.
 *
 * VERIFY on first live render (all env-overridable, so a wrong guess is a config
 * change, not a code change):
 *   - ARK_BASE_URL region (default ap-southeast / BytePlus international)
 *   - ARK_SEEDANCE_MODEL id (default dreamina-seedance-2-0-260128)
 *   - param convention: top-level resolution/ratio/duration/generate_audio, per the
 *     official Seedance 2.0 SDK example.
 */

import type { FalAspect, FalQueueStatus, FalVideo } from "./fal";

const DEFAULT_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
const DEFAULT_MODEL = "dreamina-seedance-2-0-260128";
// BytePlus Seedream 5.0 Pro (flagship unified text-to-image + up to 10-ref editing),
// per docs.byteplus.com/en/docs/ModelArk. Override with ARK_SEEDREAM_MODEL if needed.
// The account must ACTIVATE this model in the Ark console (else ARK 404s → FAL fallback).
const DEFAULT_SEEDREAM_MODEL = "seedream-5-0-pro";

export function arkBaseUrl(): string {
  return (process.env.ARK_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}

export function arkSeedanceModel(): string {
  return process.env.ARK_SEEDANCE_MODEL || DEFAULT_MODEL;
}

export function arkSeedreamModel(): string {
  return (process.env.ARK_SEEDREAM_MODEL || DEFAULT_SEEDREAM_MODEL).trim();
}

/** True when Seedream image gen should route through ARK (key present + not forced to FAL). */
export function arkSeedreamEnabled(): boolean {
  if (!(process.env.ARK_API_KEY ?? "").trim()) return false;
  return (process.env.SEEDREAM_PROVIDER ?? "ark").trim().toLowerCase() !== "fal";
}

/** True when Seedance should render through ARK by default (key present + env not forced to FAL). */
export function arkSeedanceEnabled(): boolean {
  const key = (process.env.ARK_API_KEY ?? "").trim();
  if (!key) return false;
  const provider = (process.env.SEEDANCE_PROVIDER ?? "ark").trim().toLowerCase();
  return provider !== "fal";
}

/** True when an ARK key is configured at all (regardless of the SEEDANCE_PROVIDER default). */
export function arkConfigured(): boolean {
  return !!(process.env.ARK_API_KEY ?? "").trim();
}

/** Per-request render engine choice. "auto" defers to the env default (arkSeedanceEnabled). */
export type SeedanceProvider = "ark" | "fal" | "auto";

/** ARK ratio enum — mirrors mapSeedanceAspect but for ARK's accepted set. */
function mapArkRatio(a?: FalAspect): string {
  switch (a) {
    case "1:1": return "1:1";
    case "9:16": return "9:16";
    case "16:9": return "16:9";
    case "4:5": return "3:4";
    default: return "adaptive";
  }
}

export type ArkImageRole = "first_frame" | "last_frame" | "reference_image";

export interface ArkSeedanceOpts {
  task: "i2v" | "ref";
  prompt: string;
  imageUrl?: string;             // i2v start frame
  endImageUrl?: string | null;   // i2v end frame
  imageUrls?: string[];          // ref-to-video inputs
  durationSec?: number;
  aspect?: FalAspect;
  resolution?: "480p" | "720p" | "1080p";
  generateAudio?: boolean;
}

interface ArkContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
  role?: ArkImageRole;
}

function buildArkContent(opts: ArkSeedanceOpts): ArkContentPart[] {
  const parts: ArkContentPart[] = [{ type: "text", text: opts.prompt }];
  if (opts.task === "ref") {
    for (const url of (opts.imageUrls ?? []).filter(u => u.startsWith("http")).slice(0, 9)) {
      parts.push({ type: "image_url", image_url: { url }, role: "reference_image" });
    }
  } else {
    if (opts.imageUrl) parts.push({ type: "image_url", image_url: { url: opts.imageUrl }, role: "first_frame" });
    if (opts.endImageUrl) parts.push({ type: "image_url", image_url: { url: opts.endImageUrl }, role: "last_frame" });
  }
  return parts;
}

function arkKey(): string {
  const key = (process.env.ARK_API_KEY ?? "").trim();
  if (!key) throw new Error("ARK_API_KEY is not configured");
  return key;
}

/** Create a Seedance generation task on ARK — returns the task id (does not wait). */
export async function submitArkSeedanceTask(opts: ArkSeedanceOpts): Promise<string> {
  const body = {
    model: arkSeedanceModel(),
    content: buildArkContent(opts),
    ratio: mapArkRatio(opts.aspect),
    resolution: opts.resolution ?? "720p",
    duration: Math.round(opts.durationSec ?? 5),
    generate_audio: opts.generateAudio ?? false,
    watermark: false,
  };
  const res = await fetch(`${arkBaseUrl()}/contents/generations/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${arkKey()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`ARK task create HTTP ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id?: string; task_id?: string };
  const id = data.id ?? data.task_id;
  if (!id) throw new Error("ARK task create returned no task id");
  return id;
}

// ── Seedream image generation (ARK /images/generations) ─────────────────────────
// Text-to-image when no `image` is sent; multi-reference edit when `image` is present.
// Synchronous (unlike Seedance video) — returns a public URL directly.

function arkImageSize(a?: FalAspect): string {
  switch (a) {
    case "1:1": return "2048x2048";
    case "9:16": return "1440x2560";
    case "16:9": return "2560x1440";
    case "4:5": return "1728x2160";
    default: return "2048x2048";
  }
}

export interface ArkSeedreamOpts { prompt: string; imageUrls?: string[]; aspect?: FalAspect }

/** Generate (or edit, when imageUrls are supplied) an image with Seedream on ARK. */
export async function generateArkSeedreamImage(opts: ArkSeedreamOpts): Promise<{ url: string }> {
  const body: Record<string, unknown> = {
    model: arkSeedreamModel(),
    prompt: opts.prompt,
    size: arkImageSize(opts.aspect),
    response_format: "url",
    watermark: false,
  };
  const imgs = (opts.imageUrls ?? []).filter(u => u.startsWith("http") || u.startsWith("data:image/"));
  if (imgs.length) body.image = imgs.length === 1 ? imgs[0] : imgs;

  const res = await fetch(`${arkBaseUrl()}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${arkKey()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`ARK Seedream HTTP ${res.status}: ${err.slice(0, 240)}`);
  }
  const data = (await res.json()) as { data?: { url?: string }[] };
  const url = data.data?.[0]?.url;
  if (!url) throw new Error("ARK Seedream returned no image url");
  return { url };
}

/** Map ARK's task status to the FAL queue status vocabulary the routes already speak. */
function mapArkStatus(s: string): FalQueueStatus {
  switch (s) {
    case "succeeded": return "COMPLETED";
    case "failed":
    case "cancelled":
    case "canceled": return "FAILED";
    case "running": return "IN_PROGRESS";
    default: return "IN_QUEUE"; // queued / pending / unknown
  }
}

export interface ArkTaskStatus {
  status: FalQueueStatus;
  videoUrl?: string;
  error?: string;
}

/** Poll one ARK task by id. */
export async function getArkSeedanceStatus(taskId: string): Promise<ArkTaskStatus> {
  const res = await fetch(`${arkBaseUrl()}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${arkKey()}` },
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`ARK task status HTTP ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    status?: string;
    error?: { message?: string } | string;
    content?: { video_url?: string };
  };
  const status = mapArkStatus(String(data.status ?? "queued"));
  const videoUrl = data.content?.video_url;
  const error = typeof data.error === "string" ? data.error : data.error?.message;
  return { status, videoUrl, error };
}

/** Submit + poll an ARK Seedance render to completion. Mirrors the FAL sync path. */
export async function renderArkSeedance(
  opts: ArkSeedanceOpts,
  poll?: { pollMs?: number; timeoutMs?: number },
): Promise<FalVideo> {
  const pollMs = poll?.pollMs ?? 4000;
  const timeoutMs = poll?.timeoutMs ?? 750_000;
  const deadline = Date.now() + timeoutMs;

  const taskId = await submitArkSeedanceTask(opts);
  console.log(`[ark-seedance] submitted task=${taskId} model=${arkSeedanceModel()} timeoutMs=${timeoutMs}`);

  let lastStatus = "";
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollMs));
    let st: ArkTaskStatus;
    try {
      st = await getArkSeedanceStatus(taskId);
    } catch (e) {
      console.warn(`[ark-seedance] task=${taskId} poll error: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    if (st.status !== lastStatus) {
      lastStatus = st.status;
      console.log(`[ark-seedance] task=${taskId} status=${st.status}`);
    }
    if (st.status === "COMPLETED") {
      if (!st.videoUrl) throw new Error("ARK render completed but returned no video URL");
      return { url: st.videoUrl, duration: opts.durationSec };
    }
    if (st.status === "FAILED") throw new Error(`ARK render failed: ${st.error ?? "unknown error"}`);
  }
  throw new Error("ARK render timed out — try a shorter duration or retry");
}
