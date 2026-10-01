
import { useRef, useState, useCallback } from "react";
import type { InstaGridUpdate, InstaPost } from "@/lib/media-analyser/api-types";
import type { InstaGridVideoUpdate } from "@/lib/media-analyser/api-types";
import ModelSelect from "@/components/media-analyser/ModelSelect";
import { IMAGE_MODELS, VIDEO_MODELS, DEFAULT_IMAGE_MODEL_ID, DEFAULT_VIDEO_MODEL_ID } from "@/lib/media-analyser/generation-models";
import { makeThumbs } from "@/lib/media-analyser/image-thumb";

type InputMode = "handle" | "upload";
type GenPhase = "idle" | "fetching" | "analyzing" | "generating" | "done" | "error";

interface UploadedImage {
  id: string;
  dataUrl: string;
  name: string;
}

interface GridResult {
  index: number;
  status: "pending" | "generating" | "done" | "error";
  ar: string;
  shotId?: string;
  sceneName?: string;
  imageUrl?: string;
  error?: string;
}

interface GridVideo {
  status: "pending" | "scripting" | "rendering" | "done" | "error";
  videoUrl?: string;
  adConcept?: string;
  durationSeconds?: number;
  error?: string;
}

interface GridPreview {
  summary: string;
  confidence: string;
  palette: string[];
  colourTone?: string;
  rowConcept?: string;
  specCount: number;
}

const IG_ASPECTS = ["1:1", "4:5", "9:16"] as const;
type IgAspect = typeof IG_ASPECTS[number];

const ASPECT_LABELS: Record<IgAspect, string> = {
  "1:1": "Square 1:1",
  "4:5": "Portrait 4:5",
  "9:16": "Story 9:16",
};

const MAX_POSTS = 9;
const MAX_PROD = 6;

function compressImage(file: File, maxDim = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas unavailable")); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load")); };
    img.src = url;
  });
}

function proxyUrl(raw: string) {
  if (/cdninstagram\.com|fbcdn\.net/i.test(raw)) return `/api/image-proxy?url=${encodeURIComponent(raw)}`;
  return raw;
}

export function InstaGrid() {
  const [inputMode, setInputMode] = useState<InputMode>("handle");
  const [handle, setHandle] = useState("");
  const [fetchedPosts, setFetchedPosts] = useState<InstaPost[]>([]);
  const [uploadedPosts, setUploadedPosts] = useState<UploadedImage[]>([]);
  const [productImages, setProductImages] = useState<UploadedImage[]>([]);
  // Single AR — all 3 row posts use the same format.
  const [selectedAR, setSelectedAR] = useState<IgAspect>("1:1");
  const [imageModel, setImageModel] = useState<string>(DEFAULT_IMAGE_MODEL_ID);
  const [videoModel, setVideoModel] = useState<string>(DEFAULT_VIDEO_MODEL_ID);
  const [adSeconds, setAdSeconds] = useState<15 | 30>(15);   // row-video length: 15s or 30s (Seedance 2.5)

  const [phase, setPhase] = useState<GenPhase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [gridPreview, setGridPreview] = useState<GridPreview | null>(null);
  const [results, setResults] = useState<GridResult[]>([]);
  const [rowVideo, setRowVideo] = useState<GridVideo | null>(null);
  const [videoPhase, setVideoPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [videoMsg, setVideoMsg] = useState("");

  const uploadRef = useRef<HTMLInputElement>(null);
  const prodRef = useRef<HTMLInputElement>(null);
  const isRunning = phase === "fetching" || phase === "analyzing" || phase === "generating";

  // ── Image upload handlers ───────────────────────────────────────────────────

  const addUploadedPosts = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!list.length) return;
    setUploadedPosts(prev => {
      const slots = MAX_POSTS - prev.length;
      if (slots <= 0) return prev;
      (async () => {
        const added: UploadedImage[] = [];
        for (const file of list.slice(0, slots)) {
          try { added.push({ id: crypto.randomUUID(), dataUrl: await compressImage(file), name: file.name }); } catch { /* ignore */ }
        }
        if (added.length) { setUploadedPosts(p => [...p, ...added]); resetResults(); }
      })();
      return prev;
    });
  }, []);

  const addProductImages = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!list.length) return;
    setProductImages(prev => {
      const slots = MAX_PROD - prev.length;
      if (slots <= 0) return prev;
      (async () => {
        const added: UploadedImage[] = [];
        for (const file of list.slice(0, slots)) {
          try { added.push({ id: crypto.randomUUID(), dataUrl: await compressImage(file), name: file.name }); } catch { /* ignore */ }
        }
        if (added.length) setProductImages(p => [...p, ...added]);
      })();
      return prev;
    });
  }, []);

  const resetResults = () => { setResults([]); setGridPreview(null); setRowVideo(null); setVideoPhase("idle"); setVideoMsg(""); if (phase !== "idle") setPhase("idle"); };

  // ── Handle fetch ────────────────────────────────────────────────────────────

  const handleFetch = async () => {
    if (!handle.trim() || isRunning) return;
    setPhase("fetching");
    setStatusMsg(`Fetching posts from @${handle.replace(/^@/, "")}…`);
    setFetchedPosts([]);
    resetResults();
    try {
      const res = await fetch(`/api/media-analyser/insta-grid?handle=${encodeURIComponent(handle.trim())}`);
      const data = await res.json() as { ok?: boolean; posts?: InstaPost[]; error?: string; handle?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Fetch failed");
      setFetchedPosts(data.posts ?? []);
      setStatusMsg(`${data.posts?.length ?? 0} posts fetched from @${data.handle ?? handle}`);
      setPhase("idle");
    } catch (e) {
      setPhase("error");
      setStatusMsg(String(e));
    }
  };

  // ── Generate ────────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (isRunning) return;

    // Put the most recent 3 posts FIRST so Gemini treats them as the current top row.
    const rawInputs: string[] =
      inputMode === "handle"
        ? fetchedPosts.map(p => p.imageUrl)
        : uploadedPosts.map(p => p.dataUrl);

    const imageInputs = [
      ...rawInputs.slice(0, 3),      // last 3 = current top row (primary anchor)
      ...rawInputs.slice(3),         // rest = wider context
    ];

    if (!imageInputs.length) return;

    setPhase("analyzing");
    setStatusMsg("Analysing grid — reading the last 3 posts as the current row…");
    setGridPreview(null);
    // Seed 3 pending cards (one per row position)
    setResults([0, 1, 2].map(i => ({ index: i, status: "pending", ar: selectedAR })));

    const payload = {
      [inputMode === "handle" ? "postImageUrls" : "imageDataUrls"]: imageInputs,
      productDataUrls: productImages.map(p => p.dataUrl),
      aspectRatio: selectedAR,   // single AR — all 3 posts use the same format
      imageModel,
    };

    const accumulated: GridResult[] = [];
    try {
      const res = await fetch("/api/media-analyser/insta-grid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Request failed" })) as { error?: string };
        throw new Error(err.error ?? "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const u = JSON.parse(line.slice(6)) as InstaGridUpdate;
            if (u.message) setStatusMsg(u.message);
            if (u.phase === "analyzing") { setPhase("analyzing"); }
            else if (u.phase === "grid_ready") {
              setGridPreview({ summary: u.gridSummary ?? "", confidence: u.gridConfidence ?? "medium", palette: u.palette ?? [], colourTone: u.colourTone, rowConcept: u.rowConcept, specCount: u.specCount ?? 3 });
              setPhase("generating");
            } else if (u.phase === "generating" && u.index != null) {
              setResults(prev => prev.map(r => r.index === u.index ? { ...r, status: "generating", sceneName: u.sceneName, shotId: u.shotId } : r));
            } else if (u.phase === "result" && u.index != null) {
              const r: GridResult = { index: u.index, status: "done", ar: u.ar ?? selectedAR, shotId: u.shotId, sceneName: u.sceneName, imageUrl: u.imageUrl };
              accumulated.push(r);
              setResults(prev => prev.map(existing => existing.index === u.index ? r : existing));
            } else if (u.phase === "error" && u.index != null) {
              setResults(prev => prev.map(r => r.index === u.index ? { ...r, status: "error", error: u.message } : r));
            } else if (u.phase === "done") { setPhase("done"); }
            else if (u.phase === "error" && u.index == null) {
              setPhase("error");
              // Top-level failure (e.g. grid extraction) — clear the seeded
              // pending cards so they don't spin forever.
              setResults(prev => prev.map(r => r.status === "pending" ? { ...r, status: "error", error: u.message ?? "Failed" } : r));
            }
          } catch { /* skip */ }
        }
      }

      if (accumulated.length) {
        const source = inputMode === "handle" ? `@${handle.replace(/^@/, "")}` : `${uploadedPosts.length} uploaded posts`;
        // Only local data URLs thumbnail cleanly (remote post images are CORS-tainted).
        const referenceThumbnails = await makeThumbs([
          ...productImages.map(p => p.dataUrl),
          ...uploadedPosts.map(p => p.dataUrl),
        ]);
        fetch("/api/media-analyser/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "insta_grid",
            product_name: `Insta grid · ${source}`,
            result_count: accumulated.length,
            thumbnail_url: accumulated[0]?.imageUrl ?? null,
            results: accumulated,
            input: {
              description: `9-tile grid built from ${source}`,
              aspect: selectedAR,
              imageModel,
              referenceThumbnails,
            },
          }),
        }).catch(() => {});
      }
    } catch (e) { setPhase("error"); setStatusMsg(String(e)); }
  };

  const pollVideoRender = async (
    statusUrl: string,
    responseUrl: string,
    adConcept?: string,
    durationSeconds?: number,
  ) => {
    const deadline = Date.now() + 12 * 60_000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 4000));
      let data: { status?: string; videoUrl?: string; error?: string; message?: string };
      try {
        const res = await fetch(
          `/api/insta-grid-video/status?statusUrl=${encodeURIComponent(statusUrl)}&responseUrl=${encodeURIComponent(responseUrl)}`,
        );
        data = await res.json() as typeof data;
        if (!res.ok) throw new Error(data.error ?? `Status check failed (${res.status})`);
      } catch (e) {
        if (/Load failed|fetch failed|network/i.test(String(e))) continue;
        throw e;
      }
      if (data.message) setVideoMsg(data.message);
      if (data.status === "COMPLETED" && data.videoUrl) {
        setRowVideo({ status: "done", videoUrl: data.videoUrl, adConcept, durationSeconds });
        setVideoPhase("done");
        setVideoMsg("Grid row video generated.");
        return;
      }
      if (data.status === "FAILED") throw new Error(data.error ?? "SeeDance render failed");
    }
    throw new Error("Video render timed out after 12 minutes — please retry.");
  };

  const handleGenerateVideos = async () => {
    const renderable = results.filter(r => r.status === "done" && r.imageUrl).sort((a, b) => a.index - b.index);
    if (!renderable.length || videoPhase === "running") return;

    setVideoPhase("running");
    setVideoMsg("Writing SeeDance 2.0 script for the full row…");
    setRowVideo({ status: "pending" });

    const items = renderable.map(r => ({ index: r.index, imageUrl: r.imageUrl!, ar: r.ar, sceneName: r.sceneName }));
    let queuedJob: { statusUrl: string; responseUrl: string; adConcept?: string; durationSeconds?: number } | null = null;
    let hadError = false;

    try {
      const res = await fetch("/api/media-analyser/insta-grid-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, videoModel, durationSeconds: adSeconds }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Request failed" })) as { error?: string };
        throw new Error(err.error ?? "Request failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const u = JSON.parse(line.slice(6)) as InstaGridVideoUpdate;
            if (u.message) setVideoMsg(u.message);
            if (u.phase === "scripting") setRowVideo(v => ({ ...(v ?? { status: "pending" }), status: "scripting" }));
            else if (u.phase === "rendering") setRowVideo(v => ({ ...(v ?? { status: "pending" }), status: "rendering", adConcept: u.adConcept }));
            else if (u.phase === "queued" && u.statusUrl && u.responseUrl) {
              queuedJob = {
                statusUrl: u.statusUrl,
                responseUrl: u.responseUrl,
                adConcept: u.adConcept,
                durationSeconds: u.durationSeconds,
              };
              setRowVideo(v => ({ ...(v ?? { status: "pending" }), status: "rendering", adConcept: u.adConcept, durationSeconds: u.durationSeconds }));
            } else if (u.phase === "result") setRowVideo({ status: "done", videoUrl: u.videoUrl, adConcept: u.adConcept, durationSeconds: u.durationSeconds });
            else if (u.phase === "done" && !queuedJob) { setVideoPhase("done"); setVideoMsg("Grid row video generated."); }
            else if (u.phase === "error") {
              hadError = true;
              setVideoPhase("error");
              setRowVideo(v => ({ ...(v ?? { status: "pending" }), status: "error", error: u.message }));
            }
          } catch { /* skip */ }
        }
      }

      if (!hadError && queuedJob) {
        await pollVideoRender(queuedJob.statusUrl, queuedJob.responseUrl, queuedJob.adConcept, queuedJob.durationSeconds);
      } else if (!hadError && !queuedJob) {
        throw new Error("Video job was not queued — check API keys and retry.");
      }
    } catch (e) {
      setVideoPhase("error");
      const msg = e instanceof Error ? e.message : String(e);
      setVideoMsg(/Load failed/i.test(msg) ? "Connection dropped — retry in a moment." : msg);
      setRowVideo(v => ({ ...(v ?? { status: "pending" }), status: "error", error: msg }));
    }
  };

  const reset = () => { setHandle(""); setFetchedPosts([]); setUploadedPosts([]); setProductImages([]); setResults([]); setGridPreview(null); setRowVideo(null); setVideoPhase("idle"); setVideoMsg(""); setPhase("idle"); setStatusMsg(""); };

  const download = async (url: string, label: string) => {
    const ext = /video|\.mp4/i.test(label) || /\.mp4($|\?)/i.test(url) ? "mp4" : "jpg";
    try {
      const blob = await fetch(url).then(r => r.blob());
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `insta-grid-${label.replace(/:/g, "x").replace(/\s+/g, "-")}.${ext}`; a.click(); URL.revokeObjectURL(a.href);
    } catch { window.open(url, "_blank"); }
  };

  const hasPosts = inputMode === "handle" ? fetchedPosts.length > 0 : uploadedPosts.length > 0;
  const confColor = gridPreview?.confidence === "high" ? "text-accent-2 bg-accent-2-soft" : gridPreview?.confidence === "low" ? "text-alert bg-alert-soft" : "text-accent bg-accent-soft";
  const selectedVideoModel = VIDEO_MODELS.find(m => m.id === videoModel) ?? VIDEO_MODELS[0];

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">
          Insta Grid
          <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">grid agent ✦</span>
        </h3>
        <p className="text-xs text-fg-dim mt-0.5 leading-relaxed">
          Fetch or upload posts from an Instagram feed — we extract the grid&apos;s visual identity and generate new content in 1:1, 4:5 and 9:16 that fits seamlessly.
        </p>
      </div>

      {/* Input mode toggle */}
      <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line max-w-xs">
        {(["handle", "upload"] as InputMode[]).map(m => (
          <button key={m} onClick={() => { setInputMode(m); resetResults(); }}
            disabled={isRunning}
            className={`flex-1 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${inputMode === m ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
            {m === "handle" ? "Instagram Handle" : "Upload Posts"}
          </button>
        ))}
      </div>

      {/* Handle input */}
      {inputMode === "handle" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={handle}
              onChange={e => { setHandle(e.target.value); setFetchedPosts([]); resetResults(); }}
              onKeyDown={e => e.key === "Enter" && handleFetch()}
              placeholder="@nykaa or https://instagram.com/nykaa"
              disabled={isRunning}
              className="flex-1 text-sm border border-line rounded-lg px-3 py-2.5 outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/40 disabled:opacity-50"
            />
            <button onClick={handleFetch} disabled={!handle.trim() || isRunning}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shrink-0 ${!handle.trim() || isRunning ? "bg-surface-2 text-fg-mute cursor-not-allowed" : "bg-accent text-bg hover:opacity-90"}`}>
              {phase === "fetching" ? (
                <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Fetching…</span>
              ) : "Fetch Posts"}
            </button>
          </div>

          {/* Fetched posts grid — last 3 highlighted as the "current top row" */}
          {fetchedPosts.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs text-fg-dim">{fetchedPosts.length} posts fetched (photos only)</p>
                <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">posts 1–3 = current top row</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {fetchedPosts.map((post, i) => (
                  <div key={post.id} className={`relative aspect-square bg-surface-2 rounded-md overflow-hidden ${i < 3 ? "ring-2 ring-accent ring-offset-1" : ""}`}>
                    {i < 3 && (
                      <span className="absolute top-1 left-1 z-10 text-[8px] font-bold text-white bg-accent px-1 py-0.5 rounded">
                        {i === 0 ? "newest" : `row ${i+1}`}
                      </span>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={proxyUrl(post.imageUrl)} alt="" className="w-full h-full object-cover" loading="lazy" />
                    {post.likes != null && (
                      <span className="absolute bottom-1 right-1 text-[9px] text-white bg-black/50 px-1 rounded">{post.likes.toLocaleString()} ♥</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload posts */}
      {inputMode === "upload" && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-fg-dim">Grid Posts (up to {MAX_POSTS})</p>
          <p className="text-[11px] text-fg-mute">Upload screenshots or saved posts. <span className="text-accent font-medium">Upload the 3 most recent posts first</span> — they anchor the next-row design.</p>
          <div
            className={`border-2 border-dashed rounded-xl p-4 cursor-pointer transition-colors ${uploadedPosts.length ? "border-line bg-surface-2" : "border-line hover:border-accent/40 hover:bg-accent-soft/30"}`}
            onClick={() => uploadRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.length) addUploadedPosts(e.dataTransfer.files); }}
          >
            <input ref={uploadRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => { if (e.target.files?.length) addUploadedPosts(e.target.files); e.target.value = ""; }} />
            {uploadedPosts.length ? (
              <div className="space-y-2" onClick={e => e.stopPropagation()}>
                <div className="grid grid-cols-3 gap-1.5">
                  {uploadedPosts.map(img => (
                    <div key={img.id} className="relative group aspect-square">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.dataUrl} alt="" className="w-full h-full object-cover rounded-md border border-line" />
                      <button type="button" onClick={() => { setUploadedPosts(p => p.filter(i => i.id !== img.id)); resetResults(); }}
                        className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">×</button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-fg-mute">{uploadedPosts.length}/{MAX_POSTS}</p>
                  {uploadedPosts.length < MAX_POSTS && (
                    <button type="button" onClick={() => uploadRef.current?.click()} className="text-[11px] font-medium text-accent hover:text-accent">+ Add more</button>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-5">
                <p className="text-sm font-medium text-fg-dim">Drop grid posts here</p>
                <p className="text-[11px] text-fg-mute mt-0.5">JPG · PNG · WEBP · up to {MAX_POSTS} posts</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Product photos (optional) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-fg-dim">Product Photos</p>
          <span className="text-[9px] font-semibold text-fg-mute bg-surface-2 px-1.5 py-0.5 rounded">optional</span>
        </div>
        <p className="text-[11px] text-fg-mute">Upload your product to composite it into the grid aesthetic. Leave empty for standalone posts.</p>
        <div
          className={`border-2 border-dashed rounded-xl p-3 cursor-pointer transition-colors ${productImages.length ? "border-line bg-surface-2" : "border-line hover:border-line hover:bg-surface-2"}`}
          onClick={() => prodRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.length) addProductImages(e.dataTransfer.files); }}
        >
          <input ref={prodRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { if (e.target.files?.length) addProductImages(e.target.files); e.target.value = ""; }} />
          {productImages.length ? (
            <div className="space-y-1.5" onClick={e => e.stopPropagation()}>
              <div className="grid grid-cols-4 gap-1.5">
                {productImages.map(img => (
                  <div key={img.id} className="relative group aspect-square">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.dataUrl} alt="" className="w-full h-full object-contain rounded-md border border-line bg-surface" />
                    <button type="button" onClick={() => setProductImages(p => p.filter(i => i.id !== img.id))}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">×</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-fg-mute">{productImages.length}/{MAX_PROD}</p>
                {productImages.length < MAX_PROD && (
                  <button type="button" onClick={() => prodRef.current?.click()} className="text-[11px] font-medium text-fg-dim hover:text-fg">+ Add more</button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-3">
              <p className="text-xs text-fg-mute">Drop product photos here · JPG / PNG / WEBP · up to {MAX_PROD}</p>
            </div>
          )}
        </div>
      </div>

      {/* Aspect ratio — single selector, all 3 row posts use the same format */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-medium text-fg-dim">Row format</p>
          <span className="text-[10px] text-fg-mute">all 3 posts in the same format</span>
        </div>
        <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line">
          {IG_ASPECTS.map(ar => (
            <button key={ar}
              onClick={() => setSelectedAR(ar)}
              disabled={isRunning}
              className={`flex-1 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${selectedAR === ar ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
              {ASPECT_LABELS[ar]}
            </button>
          ))}
        </div>
      </div>

      {/* Image model */}
      <ModelSelect
        label="Image model"
        options={IMAGE_MODELS.map(m => ({ id: m.id, label: m.label }))}
        value={imageModel}
        onChange={setImageModel}
        disabled={isRunning}
      />

      {/* Generate / Clear */}
      <div className="flex gap-2">
        <button onClick={handleGenerate}
          disabled={!hasPosts || isRunning}
          className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${hasPosts && !isRunning ? "bg-gradient-to-r from-accent to-accent text-white hover:from-accent hover:to-accent shadow-sm" : "bg-surface-2 text-fg-mute cursor-not-allowed"}`}>
          {isRunning && phase !== "fetching"
            ? phase === "analyzing" ? "Analysing grid…" : "Generating row…"
            : `Generate next row — 3 × ${ASPECT_LABELS[selectedAR]}`}
        </button>
        {(hasPosts || productImages.length > 0 || results.length > 0) && !isRunning && (
          <button onClick={reset} className="px-4 py-2.5 text-sm text-fg-mute hover:text-fg-dim transition-colors">Clear</button>
        )}
      </div>

      {/* Status */}
      {phase !== "idle" && statusMsg && (
        <div className="flex items-center gap-2 text-sm">
          {isRunning && <span className="w-3.5 h-3.5 border-2 border-accent/40 border-t-transparent rounded-full animate-spin shrink-0" />}
          <span className={phase === "error" ? "text-alert" : phase === "done" ? "text-accent-2 font-medium" : "text-fg-dim"}>{statusMsg}</span>
        </div>
      )}

      {/* Grid preview card */}
      {gridPreview && (
        <div className="rounded-xl bg-gradient-to-br from-accent to-accent border border-accent p-4 space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-accent">Next row designed</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${confColor}`}>{gridPreview.confidence} confidence</span>
            <span className="text-[10px] text-accent">3 posts · {ASPECT_LABELS[selectedAR]}</span>
          </div>
          {gridPreview.rowConcept && (
            <p className="text-xs font-medium text-accent bg-accent-soft/60 rounded-lg px-2.5 py-1.5 leading-relaxed">
              Row concept: {gridPreview.rowConcept}
            </p>
          )}
          <p className="text-xs text-fg leading-relaxed">{gridPreview.summary}</p>
          {gridPreview.colourTone && <p className="text-[11px] text-accent italic">{gridPreview.colourTone}</p>}
          {gridPreview.palette.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-fg-mute">Palette</span>
              {gridPreview.palette.slice(0, 8).map(hex => (
                <div key={hex} className="w-5 h-5 rounded-full border-2 border-white shadow-sm shrink-0" style={{ backgroundColor: hex }} title={hex} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generate videos CTA — appears once all 3 images are done */}
      {phase === "done" && results.some(r => r.status === "done" && r.imageUrl) && (
        <div className="rounded-xl border border-accent/30 bg-gradient-to-br from-accent to-accent p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-accent flex items-center gap-2">
                🎬 Turn these into video ads
                <span className="text-[10px] font-semibold text-accent bg-surface/70 px-1.5 py-0.5 rounded-full">{selectedVideoModel.label} ✦</span>
              </p>
              <p className="text-[11px] text-accent mt-0.5">
                {selectedVideoModel.supportsReferenceToVideo
                  ? `All 3 posts become one silent reel — Gemini writes the script, ${selectedVideoModel.label} animates @Image1 → @Image2 → @Image3.`
                  : `Gemini writes the script and ${selectedVideoModel.label} animates it from the first post (last post as end frame) — multi-image narration needs Seedance 2.0.`}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <ModelSelect
                label="Video model"
                options={VIDEO_MODELS.map(m => ({ id: m.id, label: m.label }))}
                value={videoModel}
                onChange={setVideoModel}
                disabled={videoPhase === "running"}
              />
              <ModelSelect
                label="Length"
                options={[{ id: "15", label: "15 seconds" }, { id: "30", label: "30 seconds" }]}
                value={String(adSeconds)}
                onChange={v => setAdSeconds(Number(v) === 30 ? 30 : 15)}
                disabled={videoPhase === "running"}
              />
              <button
                onClick={handleGenerateVideos}
                disabled={videoPhase === "running"}
                className={`py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${videoPhase === "running" ? "bg-surface-2 text-fg-mute cursor-not-allowed" : "bg-gradient-to-r from-accent to-accent text-white hover:from-accent hover:to-accent shadow-sm"}`}
              >
                {videoPhase === "running" ? "Generating video…" : "Generate 1 row video"}
              </button>
            </div>
          </div>
          {videoPhase !== "idle" && videoMsg && (
            <div className="flex items-center gap-2 text-xs">
              {videoPhase === "running" && <span className="w-3 h-3 border-2 border-accent/40 border-t-transparent rounded-full animate-spin shrink-0" />}
              <span className={videoPhase === "error" ? "text-alert" : videoPhase === "done" ? "text-accent-2 font-medium" : "text-accent"}>{videoMsg}</span>
            </div>
          )}
          {rowVideo && (
            <div className={`relative bg-black rounded-xl overflow-hidden ${selectedAR === "9:16" ? "aspect-[9/16] max-w-xs mx-auto" : selectedAR === "4:5" ? "aspect-[4/5] max-w-sm mx-auto" : "aspect-video max-w-2xl mx-auto"}`}>
              {rowVideo.videoUrl ? (
                <video src={rowVideo.videoUrl} className="w-full h-full object-cover" controls muted playsInline preload="metadata" poster={results.find(r => r.imageUrl)?.imageUrl} />
              ) : rowVideo.status === "error" ? (
                <p className="text-sm text-alert text-center p-6 leading-snug">{rowVideo.error ?? "Video failed"}</p>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 text-fg-mute h-full min-h-[160px]">
                  <span className="w-6 h-6 border-2 border-accent/40 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs">{rowVideo.status === "rendering" ? "Rendering row video…" : "Writing script…"}</span>
                </div>
              )}
            </div>
          )}
          {rowVideo?.adConcept && <p className="text-[11px] text-accent leading-snug">{rowVideo.adConcept}</p>}
          {rowVideo?.videoUrl && (
            <button onClick={() => download(rowVideo.videoUrl!, "grid-row-video")}
              className="text-[11px] text-accent hover:text-accent bg-surface/70 hover:bg-surface px-3 py-1.5 rounded-md transition-colors">
              Download video{rowVideo.durationSeconds ? ` · ${rowVideo.durationSeconds}s` : ""}
            </button>
          )}
        </div>
      )}

      {/* Results — one card per aspect ratio */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {results.map(r => {
            const arClass = r.ar === "9:16" ? "aspect-[9/16]" : r.ar === "4:5" ? "aspect-[4/5]" : "aspect-square";
            return (
              <div key={r.index} className="border border-line rounded-xl overflow-hidden bg-surface shadow-sm">
                <div className={`relative bg-surface-2 flex items-center justify-center w-full ${arClass}`}>
                  <span className="absolute top-1.5 left-1.5 z-10 text-[9px] font-semibold text-accent bg-surface/80 px-1.5 py-0.5 rounded-full">
                    Post {r.index + 1} of row
                  </span>
                  {r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imageUrl} alt="" className="w-full h-full object-cover absolute inset-0" loading="lazy" />
                  ) : r.status === "error" ? (
                    <p className="text-[11px] text-alert text-center p-3 leading-snug">{r.error ?? "Failed"}</p>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-fg-mute">
                      <span className="w-5 h-5 border-2 border-accent/40 border-t-transparent rounded-full animate-spin" />
                      <span className="text-[10px]">{r.status === "generating" ? "Generating…" : "Queued…"}</span>
                    </div>
                  )}
                </div>
                <div className="p-3 space-y-1.5">
                  {r.sceneName && <p className="text-xs font-semibold text-fg line-clamp-1">{r.sceneName}</p>}
                  {r.shotId && <p className="text-[10px] text-fg-mute font-mono">{r.shotId}</p>}
                  {r.imageUrl && (
                    <button onClick={() => download(r.imageUrl!, r.ar)}
                      className="text-[11px] text-accent hover:text-accent bg-accent-soft hover:bg-accent-soft px-2 py-1 rounded-md transition-colors">
                      Download image
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
