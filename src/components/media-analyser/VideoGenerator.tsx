
import { useRef, useState, useCallback } from "react";
import type { AnalysisResponse } from "@/lib/media-analyser/types";
import type { GeneratedVideoUpdate, VideoMode } from "@/lib/media-analyser/api-types";
import ModelSelect from "@/components/media-analyser/ModelSelect";
import { IMAGE_MODELS, VIDEO_MODELS, DEFAULT_IMAGE_MODEL_ID, DEFAULT_VIDEO_MODEL_ID } from "@/lib/media-analyser/generation-models";
import { makeThumbs } from "@/lib/media-analyser/image-thumb";

interface ReelShot {
  index: number;
  url: string;
}

interface GeneratedReel {
  index: number;
  concept: string;
  shots: ReelShot[];
  videoUrl?: string;
  posterUrl?: string;
  durationSeconds?: number;
  caption?: string;
  headline?: string;
  primaryText?: string;
  cta?: string;
  status: "shots" | "rendering" | "done" | "error";
  error?: string;
}

interface UploadedImage {
  id: string;
  dataUrl: string;
  name: string;
}

const MAX_IMAGES = 6;

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
      if (!ctx) { reject(new Error("Canvas not available")); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
    img.src = url;
  });
}

interface Props {
  mode: VideoMode;
  result: AnalysisResponse;
}

export function VideoGenerator({ mode, result }: Props) {
  const isIg = mode === "instagram";
  const title = isIg ? "Generate Reels" : "Generate Video Ads";
  const subtitle =
    "Upload product photos — we read your brand's visual DNA, reproduce on-brand keyframe shots, then animate them into a reel with Seedance 2.0 (capped at 10s).";

  const social = result.socialSnapshot as Record<string, unknown> | null | undefined;
  const visualProfile = social?.brandVisualProfile as Record<string, unknown> | undefined;
  const dnaConfidence = visualProfile?.confidence ? String(visualProfile.confidence) : null;
  const dnaActive = Boolean(visualProfile);
  const dnaStatus = social?.brandVisualDnaStatus ? String(social.brandVisualDnaStatus) : null;

  const [images, setImages] = useState<UploadedImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "error">("idle");
  const [reels, setReels] = useState<GeneratedReel[]>([]);
  const [imageModel, setImageModel] = useState<string>(DEFAULT_IMAGE_MODEL_ID);
  const [videoModel, setVideoModel] = useState<string>(DEFAULT_VIDEO_MODEL_ID);
  const [adSeconds, setAdSeconds] = useState<15 | 30>(15);   // ad length: 15s or 30s (Seedance 2.5)
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!list.length) return;
    const slots = MAX_IMAGES - images.length;
    if (slots <= 0) { setStatusMessage(`Maximum ${MAX_IMAGES} product photos.`); return; }
    try {
      const added: UploadedImage[] = [];
      for (const file of list.slice(0, slots)) {
        const dataUrl = await compressImage(file);
        added.push({ id: crypto.randomUUID(), dataUrl, name: file.name });
      }
      setImages(prev => [...prev, ...added]);
      setReels([]);
      setPhase("idle");
      setStatusMessage("");
    } catch {
      setStatusMessage("Failed to load one or more images.");
    }
  }, [images.length]);

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    setReels([]);
    setPhase("idle");
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = "";
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const extractContext = () => {
    const ecom = result.ecomSnapshot as Record<string, unknown> | null | undefined;
    const products = (ecom?.products as Record<string, unknown>[] | undefined) ?? [];
    const target = products[0] ?? {};
    const painPoints = (target.painPoints as Array<{ summary: string }> | undefined) ?? [];

    let postsData: unknown[] = [];
    let analysisText = "";
    if (isIg) {
      const raw = ([...((social?.instagramProductPosts as unknown[]) ?? []), ...((social?.marketingPosts as unknown[]) ?? [])]) as Record<string, unknown>[];
      postsData = raw.slice(0, 15).map(p => ({ caption: p.captionSnippet ?? p.body, angle: p.marketingAngle, hook: p.hook, likes: p.likes, comments: p.comments, format: p.format }));
      const profile = social?.instagramBrandProfile;
      analysisText = profile ? JSON.stringify(profile).slice(0, 3000) : "";
    } else {
      const ads = (social?.paidAds as Record<string, unknown>[] | undefined) ?? [];
      postsData = ads.slice(0, 15).map(a => ({ title: a.title, body: a.body, cta: a.cta, status: a.status }));
      analysisText = String(social?.paidAdsAnalysis ?? "");
    }

    const reproductionPrompts = (social?.reproductionPrompts as unknown[] | undefined) ?? [];

    return {
      productName: String(target.title ?? target.name ?? "Product"),
      brand: String(target.brand ?? "Brand"),
      category: String(target.category ?? ""),
      painPoints: painPoints.slice(0, 5).map(p => p.summary),
      posts: postsData,
      analysisText,
      brandVisualProfile: visualProfile,
      reproductionPrompts,
    };
  };

  const upsertReel = (index: number, patch: Partial<GeneratedReel>) => {
    setReels(prev => {
      const existing = prev.find(r => r.index === index);
      const base: GeneratedReel = existing ?? { index, concept: "", shots: [], status: "shots" };
      const merged = { ...base, ...patch, shots: patch.shots ?? base.shots };
      return [...prev.filter(r => r.index !== index), merged].sort((a, b) => a.index - b.index);
    });
  };

  const handleGenerate = async () => {
    if (!images.length) return;
    setIsGenerating(true);
    setReels([]);
    setPhase("working");
    setStatusMessage("Reading brand DNA and storyboarding reels…");

    const ctx = extractContext();
    const imageDataUrls = images.map(img => img.dataUrl);
    const finishedReels: GeneratedReel[] = [];
    try {
      const res = await fetch("/api/media-analyser/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, imageDataUrls, imageModel, videoModel, durationSeconds: adSeconds, ...ctx }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({ error: "Request failed" }))) as { error?: string };
        throw new Error(err.error ?? "Request failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const u = JSON.parse(line.slice(6)) as GeneratedVideoUpdate;
            if (u.message) setStatusMessage(u.message);
            if (u.phase === "shots" && u.reelIndex != null) {
              if (u.shotUrl != null && u.shotIndex != null) {
                setReels(prev => {
                  const existing = prev.find(r => r.index === u.reelIndex);
                  const base: GeneratedReel = existing ?? { index: u.reelIndex!, concept: u.concept ?? "", shots: [], status: "shots" };
                  const shots = [...base.shots.filter(s => s.index !== u.shotIndex), { index: u.shotIndex!, url: u.shotUrl! }].sort((a, b) => a.index - b.index);
                  const updated: GeneratedReel = { ...base, concept: base.concept || (u.concept ?? ""), shots, status: "shots" };
                  return [...prev.filter(r => r.index !== u.reelIndex), updated].sort((a, b) => a.index - b.index);
                });
              } else if (u.concept) {
                upsertReel(u.reelIndex, { concept: u.concept, status: "shots" });
              }
            } else if (u.phase === "rendering" && u.reelIndex != null) {
              upsertReel(u.reelIndex, { concept: u.concept, status: "rendering" });
            } else if (u.phase === "video" && u.reelIndex != null) {
              upsertReel(u.reelIndex, {
                concept: u.concept,
                status: "done",
                videoUrl: u.videoUrl,
                posterUrl: u.posterUrl,
                durationSeconds: u.durationSeconds,
                caption: u.caption,
                headline: u.headline,
                primaryText: u.primaryText,
                cta: u.cta,
              });
              if (u.videoUrl) {
                finishedReels.push({
                  index: u.reelIndex, concept: u.concept ?? "", shots: [], status: "done",
                  videoUrl: u.videoUrl, posterUrl: u.posterUrl, durationSeconds: u.durationSeconds,
                  caption: u.caption, headline: u.headline, primaryText: u.primaryText, cta: u.cta,
                });
              }
            } else if (u.phase === "error" && u.reelIndex != null) {
              upsertReel(u.reelIndex, { status: "error", error: u.message });
            } else if (u.phase === "error") {
              setPhase("error");
            } else if (u.phase === "done") {
              setPhase("done");
              setStatusMessage("Done.");
              if (finishedReels.length) {
                const referenceThumbnails = await makeThumbs(imageDataUrls);
                fetch("/api/media-analyser/generations", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    mode: isIg ? "video" : "video_meta_ad",
                    product_name: ctx.productName,
                    brand: ctx.brand,
                    result_count: finishedReels.length,
                    thumbnail_url: finishedReels[0]?.posterUrl ?? null,
                    results: finishedReels.sort((a, b) => a.index - b.index),
                    input: {
                      description: isIg ? "Reels animated from product photos" : "Video ads animated from product photos",
                      imageModel,
                      videoModel,
                      aspect: "9:16",
                      referenceThumbnails,
                    },
                  }),
                }).catch(() => {});
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      setPhase("error");
      setStatusMessage(String(e));
    } finally {
      setIsGenerating(false);
    }
  };

  const download = async (url: string, name: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.mp4`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { window.open(url, "_blank"); }
  };

  return (
    <div className="mt-6 pt-6 border-t border-line">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">
          {title} <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">Seedance 2.0 ✦</span>
          {dnaActive && (
            <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">
              Brand Visual DNA{dnaConfidence ? ` · ${dnaConfidence}` : ""}
            </span>
          )}
        </h3>
        <p className="text-xs text-fg-dim mt-0.5">{subtitle}</p>
        {!dnaActive && (
          <p className="text-[11px] text-accent bg-accent-soft border border-accent/30 rounded-md px-2 py-1 mt-1.5">
            No brand visual DNA in this run — reels will still render but won&apos;t be brand-grounded.
            {dnaStatus ? <span className="block mt-0.5 text-accent">Reason: {dnaStatus}</span> : null}
          </p>
        )}
      </div>

      {/* Upload */}
      <div
        className={`relative border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
          isDragging ? "border-accent/40 bg-accent-soft" : images.length ? "border-line bg-surface-2" : "border-line hover:border-accent hover:bg-surface-2"
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
      >
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFileChange} />
        {images.length ? (
          <div className="space-y-3" onClick={e => e.stopPropagation()}>
            <div className="grid grid-cols-2 gap-2">
              {images.map(img => (
                <div key={img.id} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.dataUrl} alt={img.name} className="w-full aspect-square object-contain rounded-lg border border-line bg-surface" />
                  <button type="button" onClick={() => removeImage(img.id)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Remove image">×</button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-fg-dim text-left">{images.length} photo{images.length !== 1 ? "s" : ""} ready · output 9:16 · ≤10s</p>
              {images.length < MAX_IMAGES && (
                <button type="button" onClick={() => fileInputRef.current?.click()} className="text-[11px] font-medium text-accent hover:text-accent shrink-0">+ Add more</button>
              )}
            </div>
          </div>
        ) : (
          <div className="py-2">
            <p className="text-sm font-medium text-fg">Drop product photos here</p>
            <p className="text-xs text-fg-mute mt-1">or click to browse · JPG / PNG / WEBP · up to {MAX_IMAGES} images</p>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
        <ModelSelect
          label="Keyframe image model"
          options={IMAGE_MODELS.map(m => ({ id: m.id, label: m.label }))}
          value={imageModel}
          onChange={setImageModel}
          disabled={isGenerating}
        />
        <ModelSelect
          label="Animation video model"
          options={VIDEO_MODELS.map(m => ({ id: m.id, label: m.label }))}
          value={videoModel}
          onChange={setVideoModel}
          disabled={isGenerating}
        />
        <ModelSelect
          label="Length"
          options={[{ id: "15", label: "15 seconds" }, { id: "30", label: "30 seconds" }]}
          value={String(adSeconds)}
          onChange={v => setAdSeconds(Number(v) === 30 ? 30 : 15)}
          disabled={isGenerating}
        />
      </div>

      <button
        onClick={handleGenerate}
        disabled={!images.length || isGenerating}
        className={`mt-3 w-full py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${
          !images.length || isGenerating ? "bg-surface-2 text-fg-mute cursor-not-allowed" : "bg-accent text-bg hover:opacity-90"
        }`}
      >
        {isGenerating ? "Generating…" : title}
      </button>

      {phase !== "idle" && (
        <div className="mt-3 flex items-center gap-2 text-sm text-fg-dim">
          {phase === "working" && <span className="w-3.5 h-3.5 border-2 border-accent/40 border-t-transparent rounded-full animate-spin" />}
          <span className={phase === "error" ? "text-alert" : ""}>{statusMessage}</span>
        </div>
      )}

      {/* Results */}
      {reels.length > 0 && (
        <div className="mt-5 space-y-5">
          {reels.map(reel => (
            <div key={reel.index} className="border border-line rounded-xl overflow-hidden bg-surface shadow-sm">
              <div className="p-3 border-b border-line">
                <p className="text-xs font-semibold text-fg">{reel.concept || `Reel ${reel.index + 1}`}</p>
                {reel.status === "rendering" && (
                  <p className="text-[11px] text-accent flex items-center gap-1.5 mt-1">
                    <span className="w-3 h-3 border-2 border-accent/40 border-t-transparent rounded-full animate-spin" /> Rendering with Seedance…
                  </p>
                )}
                {reel.status === "error" && <p className="text-[11px] text-alert mt-1">{reel.error}</p>}
              </div>

              {/* Storyboard shots (reproduced keyframes) */}
              {reel.shots.length > 0 && (
                <div className="p-3">
                  <p className="text-[10px] font-semibold text-fg-mute uppercase tracking-wider mb-2">Storyboard shots</p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {reel.shots.map(shot => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={shot.index} src={shot.url} alt={`Shot ${shot.index + 1}`} className="h-28 aspect-[9/16] object-cover rounded-md border border-line shrink-0" loading="lazy" />
                    ))}
                  </div>
                </div>
              )}

              {/* Final reel */}
              {reel.videoUrl && (
                <div className="p-3 pt-0 space-y-2">
                  <video src={reel.videoUrl} className="w-full aspect-[9/16] max-h-[480px] object-cover rounded-lg bg-black" controls preload="metadata" poster={reel.posterUrl} />
                  {isIg
                    ? reel.caption && <p className="text-xs text-fg-dim whitespace-pre-line leading-relaxed">{reel.caption}</p>
                    : (
                      <div className="space-y-1">
                        {reel.headline && <p className="text-xs font-semibold text-fg">{reel.headline}</p>}
                        {reel.primaryText && <p className="text-xs text-fg-dim leading-relaxed">{reel.primaryText}</p>}
                        {reel.cta && <span className="inline-block text-[10px] font-semibold text-white bg-accent px-2 py-0.5 rounded">{reel.cta}</span>}
                      </div>
                    )}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => download(reel.videoUrl!, reel.concept || `reel-${reel.index + 1}`)} className="text-[11px] text-accent hover:text-accent bg-accent-soft hover:bg-accent-soft px-2 py-1 rounded-md transition-colors">Download MP4</button>
                    {reel.durationSeconds && <span className="text-[11px] text-fg-mute self-center">{reel.durationSeconds}s</span>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
