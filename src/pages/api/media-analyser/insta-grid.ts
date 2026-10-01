import type { NextApiRequest, NextApiResponse } from "next";
import { editWithNanoBananaPro, type FalAspect } from "@/lib/media-analyser/fal";
import { normalizeImageModel } from "@/lib/media-analyser/generation-models";
import { extractGridVibeFromImages, shotSpecToPrompt, fetchCdnImageInline } from "@/lib/media-analyser/brandVisualDna";
import { getApifyToken } from "@/lib/media-analyser/meta-social";

export const config = { maxDuration: 300 };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InstaPost {
  id: string;
  imageUrl: string;
  postUrl?: string;
  likes?: number;
  comments?: number;
}

export interface InstaGridUpdate {
  phase: "fetching" | "posts_ready" | "analyzing" | "grid_ready" | "generating" | "result" | "done" | "error";
  // posts_ready
  posts?: InstaPost[];
  handle?: string;
  // grid_ready
  gridSummary?: string;
  gridConfidence?: string;
  palette?: string[];
  colourTone?: string;
  rowConcept?: string;
  specCount?: number;
  // generating / result
  index?: number;
  total?: number;
  ar?: string;
  shotId?: string;
  sceneName?: string;
  imageUrl?: string;
  message?: string;
}

// ── Apify helpers ─────────────────────────────────────────────────────────────

function normalizeHandle(raw: string): string {
  const s = raw.trim().replace(/^@/, "");
  if (s.startsWith("http")) return s;
  return `https://www.instagram.com/${s}/`;
}

async function fetchApifyDataset(datasetId: string, token: string): Promise<unknown[]> {
  const res = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&clean=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return [];
  return (await res.json()) as unknown[];
}

async function runApifyInstagramPosts(profileUrl: string, token: string, limit = 20): Promise<InstaPost[]> {
  const safeId = "apify~instagram-scraper";
  const runRes = await fetch(
    `https://api.apify.com/v2/acts/${safeId}/runs?memory=256&waitForFinish=120`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ directUrls: [profileUrl], resultsType: "posts", resultsLimit: limit }),
    },
  );
  if (!runRes.ok) {
    // Surface Apify's actual reason instead of a bare status — the most common
    // failure here isn't a code bug but an account-level quota/billing limit.
    let detail = "";
    let errType = "";
    try {
      const errBody = (await runRes.json()) as { error?: { type?: string; message?: string } };
      errType = String(errBody?.error?.type ?? "");
      detail = String(errBody?.error?.message ?? "");
    } catch {
      /* non-JSON body — fall back to status only */
    }
    if (errType === "platform-feature-disabled" || /usage hard limit/i.test(detail)) {
      throw new Error(
        "Instagram scraping is temporarily unavailable — the Apify account has hit its monthly usage limit. Upgrade the Apify plan or wait for the next billing cycle, then try again.",
      );
    }
    throw new Error(`Apify run failed: ${runRes.status}${detail ? ` — ${detail}` : ""}`);
  }
  const runData = (await runRes.json()) as Record<string, unknown>;
  const run = (runData.data ?? runData) as Record<string, unknown>;

  // Poll if still running
  let status = String(run.status ?? "RUNNING");
  let runId = String(run.id ?? "");
  const deadline = Date.now() + 180_000;
  while ((status === "RUNNING" || status === "READY") && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 8000));
    const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!pollRes.ok) break;
    const pollData = (await pollRes.json()) as Record<string, unknown>;
    const d = (pollData.data ?? pollData) as Record<string, unknown>;
    status = String(d.status ?? "UNKNOWN");
    runId = String(d.id ?? runId);
  }

  const defaultDataset = String((run.defaultDatasetId as string) ?? "");
  const items = defaultDataset ? await fetchApifyDataset(defaultDataset, token) : [];

  // Parse items — keep only photos (filter reels/videos)
  const posts: InstaPost[] = [];
  for (const raw of items as Record<string, unknown>[]) {
    const mediaType = String(raw.type ?? raw.mediaType ?? "").toLowerCase();
    const isVideo = mediaType.includes("video") || mediaType.includes("reel");
    if (isVideo) continue;

    const imageUrl = String(raw.displayUrl ?? raw.imageUrl ?? raw.thumbnailUrl ?? "");
    if (!imageUrl) continue;

    const id = String(raw.id ?? raw.shortCode ?? crypto.randomUUID());
    const shortCode = String(raw.shortCode ?? "");
    const postUrl = shortCode ? `https://www.instagram.com/p/${shortCode}/` : String(raw.url ?? raw.permalink ?? "");

    posts.push({
      id,
      imageUrl,
      postUrl: postUrl || undefined,
      likes: typeof raw.likesCount === "number" ? raw.likesCount : typeof raw.likes === "number" ? raw.likes : undefined,
      comments: typeof raw.commentsCount === "number" ? raw.commentsCount : typeof raw.comments === "number" ? raw.comments : undefined,
    });
    if (posts.length >= limit) break;
  }
  return posts;
}

// ── GET — fetch posts from an Instagram handle ────────────────────────────────

function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const rawHandle = (req.query.handle as string) ?? "";
  if (!rawHandle) return res.status(400).json({ error: "handle is required" });

  const token = getApifyToken();
  if (!token) return res.status(500).json({ error: "APIFY_API_TOKEN is not configured" });

  const profileUrl = normalizeHandle(rawHandle);
  const handle = rawHandle.replace(/^@/, "").split("/").filter(Boolean).pop() ?? rawHandle;

  return runApifyInstagramPosts(profileUrl, token, 12)
    .then(posts => res.status(200).json({ ok: true, handle, posts }))
    .catch(e => res.status(500).json({ error: String(e) }));
}

// ── POST — analyze grid + generate ───────────────────────────────────────────

function normalizeAspect(a: unknown): FalAspect {
  return a === "1:1" || a === "4:5" || a === "9:16" || a === "16:9" ? a : "auto";
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const isDryRun = req.query.dry === "1";

  const body = (req.body ?? {}) as Record<string, unknown>;
  const imageModel = normalizeImageModel(body.imageModel).id;

  // Input: either uploaded data URLs or CDN image URLs from handle fetch.
  // The client sends the last 3 posts FIRST so Gemini sees them as the "top row".
  const rawImgs = body.imageDataUrls ?? body.postImageUrls;
  const imageInputs = (Array.isArray(rawImgs) ? rawImgs : rawImgs ? [rawImgs] : []).map(u => String(u));

  const rawProd = body.productDataUrls;
  const productUrls = (Array.isArray(rawProd) ? rawProd : rawProd ? [rawProd] : [])
    .map(u => String(u))
    .filter(u => u.startsWith("data:image/"))
    .slice(0, 6);

  // Single aspect ratio — all 3 row posts use the same format.
  const rawAR = body.aspectRatio;
  const aspectRatio = ["1:1", "4:5", "9:16"].includes(String(rawAR)) ? String(rawAR) : "1:1";

  if (!imageInputs.length) {
    return res.status(400).json({ error: "imageDataUrls or postImageUrls are required" });
  }

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  const falKey = process.env.FAL_KEY ?? "";
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
  if (!isDryRun && !falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (u: InstaGridUpdate) => { res.write(`data: ${JSON.stringify(u)}\n\n`); };

  try {
    // Convert inputs to base64 data URLs Gemini can read.
    // Uploaded images are already data: URLs; CDN image URLs need fetching.
    send({ phase: "analyzing", message: `Analysing ${imageInputs.length} grid post${imageInputs.length !== 1 ? "s" : ""}…` });

    const dataUrls: string[] = [];
    for (const input of imageInputs.slice(0, 9)) {
      if (input.startsWith("data:image/")) {
        dataUrls.push(input);
      } else {
        // CDN URL — fetch inline using the existing proxy-fallback helper
        const inline = await fetchCdnImageInline(input).catch(() => null);
        if (inline) dataUrls.push(`data:${inline.mime_type};base64,${inline.data}`);
      }
    }

    if (!dataUrls.length) {
      send({ phase: "error", message: "Could not load any grid images. Check the URLs or try uploading directly." });
      res.end();
      return;
    }

    // STAGE 1 — extract grid aesthetic via Gemini.
    // Last 3 posts are already first in dataUrls (client sorts newest-first).
    let grid;
    try {
      grid = await extractGridVibeFromImages(dataUrls, geminiKey, aspectRatio);
    } catch (e) {
      send({ phase: "error", message: String(e instanceof Error ? e.message : e) });
      res.end();
      return;
    }
    if (!grid || !grid.shotSpecs.length) {
      send({ phase: "error", message: "Could not extract grid aesthetic — try uploading clearer, more consistent posts." });
      res.end();
      return;
    }

    send({
      phase: "grid_ready",
      gridSummary: grid.summary,
      gridConfidence: grid.confidence,
      palette: grid.palette,
      colourTone: grid.paletteV2?.colour_tone,
      rowConcept: grid.rowConcept,
      specCount: grid.shotSpecs.length,
      message: `Grid row designed (${grid.confidence} confidence) — generating 3 posts for the next row…`,
    });

    // STAGE 2 — render one post per aspect ratio
    const total = grid.shotSpecs.length;
    for (let i = 0; i < grid.shotSpecs.length; i++) {
      const spec = grid.shotSpecs[i];
      const ar = normalizeAspect(spec.ar);
      const label = spec.shot_label || `Post ${i + 1} of row (${spec.ar ?? aspectRatio})`;

      send({
        phase: "generating",
        index: i, total,
        ar: spec.ar,
        shotId: spec.shot_id,
        sceneName: label,
        message: `Generating ${label} (${spec.ar})…`,
      });

      if (isDryRun) {
        send({ phase: "result", index: i, total, ar: spec.ar, shotId: spec.shot_id, sceneName: label });
        continue;
      }

      try {
        const prompt = shotSpecToPrompt(spec);
        const full = spec.negativePrompt ? `${prompt}\n\nDo not: ${spec.negativePrompt}.` : prompt;
        const falInputs = productUrls.length ? productUrls : [dataUrls[0]];
        // All 3 row posts use the same aspect ratio for visual consistency.
        const img = await editWithNanoBananaPro(falKey, falInputs, full, { aspect: normalizeAspect(aspectRatio), model: imageModel });
        send({ phase: "result", index: i, total, ar: spec.ar, shotId: spec.shot_id, sceneName: label, imageUrl: img.url });
      } catch (e) {
        send({ phase: "error", index: i, total, message: `${label} render failed: ${String(e)}` });
      }
    }

    send({ phase: "done", message: `${total} grid post${total !== 1 ? "s" : ""} generated.` });
  } catch (err) {
    send({ phase: "error", message: String(err) });
  } finally {
    res.end();
  }
  return;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  return res.status(405).end();
}
