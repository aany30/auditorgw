
import { useCallback, useRef, useState } from "react";
import ModelSelect from "@/components/media-analyser/ModelSelect";
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL_ID } from "@/lib/media-analyser/generation-models";
import type { VibeCloneStoryboardResponse } from "@/lib/media-analyser/api-types";
import type { VibeShot } from "@/lib/media-analyser/ugc/vibe-clone-ugc";
import type { VibeCloneKeyframeResponse } from "@/lib/media-analyser/api-types";
import type { VibeCloneClipResponse } from "@/lib/media-analyser/api-types";
import type { VibeCloneStitchResponse } from "@/lib/media-analyser/api-types";

const MAX_MODEL = 2;
const MAX_PROD = 3;
const MAX_IMAGE_BYTES = 780_000;

type Phase = "input" | "storyboarding" | "shots" | "stitching" | "done" | "error";
type ShotStatus = "pending" | "keyframe" | "clip" | "done" | "error";

interface UploadedImage { id: string; dataUrl: string; name: string }
interface ShotItem {
  shot: VibeShot;
  keyframeUrl?: string;
  clipUrl?: string;
  durationSeconds?: number;
  status: ShotStatus;
  error?: string;
}

function compressImage(file: File, maxDim = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const encodeAt = (dim: number, quality: number): string => {
        const scale = Math.min(1, dim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not available");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", quality);
      };
      try {
        let dim = maxDim;
        let out = encodeAt(dim, 0.85);
        for (const q of [0.75, 0.65, 0.55]) { if (out.length <= MAX_IMAGE_BYTES) break; out = encodeAt(dim, q); }
        while (out.length > MAX_IMAGE_BYTES && dim > 640) { dim = Math.round(dim * 0.8); out = encodeAt(dim, 0.6); }
        resolve(out);
      } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
    img.src = url;
  });
}

function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m || "Something went wrong. Please try again.";
}

/** POST JSON, retrying transient network failures ("Failed to fetch") a couple times. */
async function postJson(url: string, body: unknown): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  throw lastErr instanceof Error ? lastErr : new Error("network error");
}

export function VibeCloneUGC() {
  const [reelUrl, setReelUrl] = useState("");
  const [modelImages, setModelImages] = useState<UploadedImage[]>([]);
  const [productImages, setProductImages] = useState<UploadedImage[]>([]);
  const [imageModel, setImageModel] = useState<string>(DEFAULT_IMAGE_MODEL_ID);
  const aspect = "9:16";

  const [phase, setPhase] = useState<Phase>("input");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [shots, setShots] = useState<ShotItem[]>([]);
  const [finalUrl, setFinalUrl] = useState("");

  const modelRef = useRef<HTMLInputElement>(null);
  const prodRef = useRef<HTMLInputElement>(null);
  const busy = phase === "storyboarding" || phase === "shots" || phase === "stitching";

  const addImages = useCallback(async (files: FileList, which: "model" | "product") => {
    const cap = which === "model" ? MAX_MODEL : MAX_PROD;
    const cur = which === "model" ? modelImages.length : productImages.length;
    const added: UploadedImage[] = [];
    for (const file of Array.from(files).slice(0, cap - cur)) {
      try { added.push({ id: crypto.randomUUID(), dataUrl: await compressImage(file), name: file.name }); } catch { /* ignore */ }
    }
    if (!added.length) return;
    if (which === "model") setModelImages(p => [...p, ...added]);
    else setProductImages(p => [...p, ...added]);
  }, [modelImages.length, productImages.length]);

  const patchShot = (n: number, patch: Partial<ShotItem>) =>
    setShots(prev => prev.map(s => (s.shot.shot_number === n ? { ...s, ...patch } : s)));

  const resetAll = () => {
    setReelUrl(""); setModelImages([]); setProductImages([]); setShots([]); setFinalUrl("");
    setError(""); setStatus(""); setPhase("input");
  };

  // Render one shot: keyframe → clip. `modelRefs`/`productRefs` are https (hosted) or
  // data URLs. Returns the finished clip or null on failure.
  const renderShot = useCallback(async (shot: VibeShot, modelRefs: string[], productRefs: string[]): Promise<{ url: string; durationSec: number } | null> => {
    const n = shot.shot_number;
    try {
      patchShot(n, { status: "keyframe", error: undefined });
      const kfRes = await postJson("/api/vibe-clone-ugc/keyframe", { keyframePrompt: shot.keyframe_prompt, modelImageDataUrls: modelRefs, productImageDataUrls: productRefs, aspect, imageModel });
      const kf = (await kfRes.json().catch(() => ({}))) as Partial<VibeCloneKeyframeResponse> & { error?: string };
      if (!kfRes.ok || !kf.imageUrl) throw new Error(kf.error ?? "keyframe failed");
      patchShot(n, { keyframeUrl: kf.imageUrl, status: "clip" });

      const clipRes = await postJson("/api/vibe-clone-ugc/clip", { imageUrl: kf.imageUrl, prompt: shot.motion_prompt, durationSec: shot.duration_sec, aspect });
      const clip = (await clipRes.json().catch(() => ({}))) as Partial<VibeCloneClipResponse> & { error?: string };
      if (!clipRes.ok || !clip.videoUrl) throw new Error(clip.error ?? "clip failed");
      patchShot(n, { clipUrl: clip.videoUrl, durationSeconds: clip.durationSeconds, status: "done" });
      return { url: clip.videoUrl, durationSec: clip.durationSeconds ?? shot.duration_sec };
    } catch (e) {
      patchShot(n, { status: "error", error: friendly(e) });
      return null;
    }
  }, [imageModel]);

  const recreate = useCallback(async () => {
    if (!reelUrl.trim() || !modelImages.length || !productImages.length || busy) return;
    setPhase("storyboarding"); setError(""); setFinalUrl(""); setShots([]);
    setStatus("Watching the reel and storyboarding the shots…");
    let storyboard: VibeShot[] = [];
    let modelRefs = modelImages.map(i => i.dataUrl);
    let productRefs = productImages.map(i => i.dataUrl);
    try {
      const res = await postJson("/api/vibe-clone-ugc/storyboard", { reelUrl: reelUrl.trim(), modelImageDataUrls: modelRefs, productImageDataUrls: productRefs, aspect });
      const data = (await res.json().catch(() => ({}))) as Partial<VibeCloneStoryboardResponse> & { error?: string };
      if (!res.ok || !data.shots?.length) throw new Error(data.error ?? "Could not storyboard that reel.");
      storyboard = data.shots;
      // Prefer the FAL-hosted https URLs so per-shot keyframe calls stay tiny + reliable.
      if (data.modelHostedUrls?.length) modelRefs = data.modelHostedUrls;
      if (data.productHostedUrls?.length) productRefs = data.productHostedUrls;
      setShots(storyboard.map(shot => ({ shot, status: "pending" as ShotStatus })));
    } catch (e) {
      setError(friendly(e)); setPhase("input"); setStatus(""); return;
    }

    // Render each shot sequentially (keyframe → clip), then stitch the successful clips.
    setPhase("shots");
    const clips: { url: string; durationSec: number }[] = [];
    for (const shot of storyboard) {
      setStatus(`Recreating shot ${shot.shot_number} of ${storyboard.length}…`);
      const clip = await renderShot(shot, modelRefs, productRefs);
      if (clip) clips.push(clip);
    }

    if (!clips.length) { setError("No shots could be rendered."); setPhase("error"); setStatus(""); return; }
    if (clips.length === 1) { setFinalUrl(clips[0].url); setPhase("done"); setStatus(""); return; }

    setPhase("stitching"); setStatus("Stitching the shots into the final reel…");
    try {
      const res = await postJson("/api/vibe-clone-ugc/stitch", { clips });
      const data = (await res.json().catch(() => ({}))) as Partial<VibeCloneStitchResponse> & { error?: string };
      if (!res.ok || !data.videoUrl) throw new Error(data.error ?? "stitch failed");
      setFinalUrl(data.videoUrl); setPhase("done"); setStatus("");
    } catch (e) {
      setError(`Couldn't stitch the reel (${friendly(e)}). The individual shot clips are still below.`);
      setPhase("done"); setStatus("");
    }
  }, [reelUrl, modelImages, productImages, busy, renderShot]);

  const dropzone = (which: "model" | "product") => {
    const imgs = which === "model" ? modelImages : productImages;
    const ref = which === "model" ? modelRef : prodRef;
    const cap = which === "model" ? MAX_MODEL : MAX_PROD;
    const remove = (id: string) => (which === "model" ? setModelImages : setProductImages)(p => p.filter(i => i.id !== id));
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-fg">{which === "model" ? "Model / creator" : "Product photo"}{cap > 1 ? "s" : ""}</p>
        <div className="border-2 border-dashed border-line rounded-xl p-4 cursor-pointer hover:border-accent/40 hover:bg-surface-2/50 transition-colors"
          onClick={() => ref.current?.click()}>
          <input ref={ref} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { if (e.target.files?.length) addImages(e.target.files, which); e.target.value = ""; }} />
          {imgs.length ? (
            <div className="grid grid-cols-3 gap-1.5" onClick={e => e.stopPropagation()}>
              {imgs.map(img => (
                <div key={img.id} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.dataUrl} alt={img.name} className="w-full aspect-square object-contain rounded-md border border-line bg-surface" />
                  <button type="button" onClick={() => remove(img.id)}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] leading-none opacity-0 group-hover:opacity-100 flex items-center justify-center" aria-label="Remove">×</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-3">
              <p className="text-sm font-medium text-fg-dim">Drop {which === "model" ? "a creator photo" : "your product photo"} here</p>
              <p className="text-[11px] text-fg-mute mt-0.5">JPG · PNG · WEBP · up to {cap}</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">
          Vibe Clone — UGC
          <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">reel → frames → reel ✦</span>
        </h3>
        <p className="text-xs text-fg-dim mt-0.5 leading-relaxed">
          Paste a reel and add your creator + product. We storyboard it, generate a photo for every shot with
          your model and product in the reel&apos;s vibe, animate each, and stitch them into a new reel.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-fg">Reference reel link</p>
        <input type="url" value={reelUrl} disabled={busy} onChange={e => setReelUrl(e.target.value)}
          placeholder="Instagram reel link, Meta Ad Library link, or a direct .mp4 URL"
          className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:border-accent disabled:opacity-50" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {dropzone("model")}
        {dropzone("product")}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-medium text-fg-dim mb-2">Format</p>
          <div className="flex rounded-lg border border-line overflow-hidden">
            <button disabled className="flex-1 py-1.5 text-xs font-medium bg-accent text-bg">Vertical 9:16</button>
          </div>
          <p className="text-[10px] text-fg-mute mt-1">Keyframes → Seedance clips → stitched reel</p>
        </div>
        <ModelSelect label="Keyframe image model" options={IMAGE_MODELS.map(m => ({ id: m.id, label: m.label }))} value={imageModel} onChange={setImageModel} disabled={busy} />
      </div>

      {phase !== "done" && (
        <div className="flex gap-2">
          <button onClick={recreate} disabled={!reelUrl.trim() || !modelImages.length || !productImages.length || busy}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${!reelUrl.trim() || !modelImages.length || !productImages.length || busy ? "bg-surface-2 text-fg-mute cursor-not-allowed" : "bg-accent text-bg hover:opacity-90"}`}>
            {busy ? "Recreating…" : "Recreate this reel"}
          </button>
          {(reelUrl || modelImages.length || productImages.length) && !busy && (
            <button onClick={resetAll} className="px-4 py-2.5 text-sm text-fg-mute hover:text-fg-dim transition-colors">Clear</button>
          )}
        </div>
      )}

      {status && (
        <div className="flex items-center gap-2 text-sm">
          {busy && <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />}
          <span className="text-fg-dim">{status}</span>
        </div>
      )}
      {error && <p className="text-[11px] text-alert leading-snug">{error}</p>}

      {/* final reel */}
      {finalUrl && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-fg">Recreated reel</p>
          <div className="max-w-sm border border-line rounded-xl overflow-hidden bg-surface shadow-sm">
            <video key={finalUrl} src={finalUrl} controls playsInline className="w-full aspect-[9/16] object-cover bg-black" />
            <div className="p-2.5"><a href={finalUrl} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:text-accent bg-accent-soft hover:bg-accent-soft px-2 py-1 rounded-md">Open / download</a></div>
          </div>
          {phase === "done" && <button onClick={resetAll} className="text-xs text-fg-mute hover:text-fg-dim">Recreate another reel</button>}
        </div>
      )}

      {/* per-shot progress */}
      {shots.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-fg">Shots</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {shots.map(s => (
              <div key={s.shot.shot_number} className="rounded-lg border border-line p-2 space-y-1">
                <p className="text-[10px] font-medium text-fg-dim">Shot {s.shot.shot_number} · {s.shot.duration_sec}s</p>
                {s.clipUrl ? (
                  <video src={s.clipUrl} controls playsInline className="w-full aspect-[9/16] object-cover rounded-md bg-black" />
                ) : s.keyframeUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.keyframeUrl} alt={`Shot ${s.shot.shot_number}`} className="w-full aspect-[9/16] object-cover rounded-md border border-line bg-surface" />
                ) : (
                  <div className="w-full aspect-[9/16] rounded-md bg-surface-2 flex items-center justify-center text-[10px] text-fg-mute">
                    {s.status === "error" ? "⚠" : "…"}
                  </div>
                )}
                <p className="text-[10px] text-fg-mute">
                  {s.status === "keyframe" ? "Generating photo…" : s.status === "clip" ? "Animating…" : s.status === "done" ? "✓ done" : s.status === "error" ? (s.error ?? "failed") : "queued"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
