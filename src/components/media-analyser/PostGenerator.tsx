
import { useRef, useState, useCallback } from "react";
import type { AnalysisResponse } from "@/lib/media-analyser/types";
import type { GeneratedPostUpdate, PostMode } from "@/lib/media-analyser/api-types";
import ModelSelect from "@/components/media-analyser/ModelSelect";
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL_ID } from "@/lib/media-analyser/generation-models";
import { makeThumbs } from "@/lib/media-analyser/image-thumb";

interface GeneratedPost {
  index: number;
  concept: string;
  imageUrl: string;
  caption?: string;
  headline?: string;
  primaryText?: string;
  cta?: string;
}

interface UploadedImage {
  id: string;
  dataUrl: string;
  name: string;
}

const MAX_IMAGES = 6;

// Send clean product photos (just downscaled) — Nano Banana Pro preserves the
// product and the aspect_ratio param controls the output canvas.
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
  mode: PostMode;
  result: AnalysisResponse;
  layout?: "full" | "column";
}

export function PostGenerator({ mode, result, layout = "full" }: Props) {
  const isIg = mode === "instagram";
  const isColumn = layout === "column";
  const title = isIg ? "Generate Instagram Posts" : "Generate Meta Ads";
  const subtitle = isIg
    ? "Upload product photos (multiple angles welcome) — we analyze your posts above and generate 10 on-brand Instagram creatives (4:5) with captions."
    : "Upload product photos (multiple angles welcome) — we analyze your ads above and generate 10 Meta ad creatives (1:1) with headline, primary text & CTA.";

  const social = result.socialSnapshot as Record<string, unknown> | null | undefined;
  const visualProfile = social?.brandVisualProfile as Record<string, unknown> | undefined;
  const reproCount = ((social?.reproductionPrompts as unknown[] | undefined) ?? []).length;
  const dnaConfidence = visualProfile?.confidence ? String(visualProfile.confidence) : null;
  const dnaActive = reproCount > 0;
  const dnaStatus = social?.brandVisualDnaStatus ? String(social.brandVisualDnaStatus) : null;

  const [images, setImages] = useState<UploadedImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [phase, setPhase] = useState<"idle" | "analyzing" | "generating" | "done" | "error">("idle");
  const [posts, setPosts] = useState<GeneratedPost[]>([]);
  const [imageModel, setImageModel] = useState<string>(DEFAULT_IMAGE_MODEL_ID);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!list.length) return;

    const slots = MAX_IMAGES - images.length;
    if (slots <= 0) {
      setStatusMessage(`Maximum ${MAX_IMAGES} product photos. Remove one to add more.`);
      return;
    }

    try {
      const added: UploadedImage[] = [];
      for (const file of list.slice(0, slots)) {
        const dataUrl = await compressImage(file);
        added.push({ id: crypto.randomUUID(), dataUrl, name: file.name });
      }
      setImages(prev => [...prev, ...added]);
      setPosts([]);
      setPhase("idle");
      setStatusMessage("");
    } catch {
      setStatusMessage("Failed to load one or more images. Try different files.");
    }
  }, [images.length]);

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    setPosts([]);
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
    const social = result.socialSnapshot as Record<string, unknown> | null | undefined;

    let postsData: unknown[] = [];
    let analysisText = "";
    if (isIg) {
      const raw = ([...((social?.instagramProductPosts as unknown[]) ?? []), ...((social?.marketingPosts as unknown[]) ?? [])]) as Record<string, unknown>[];
      postsData = raw.slice(0, 20).map(p => ({
        caption: p.captionSnippet ?? p.body,
        angle: p.marketingAngle,
        hook: p.hook,
        likes: p.likes,
        comments: p.comments,
        format: p.format,
      }));
      const profile = social?.instagramBrandProfile;
      analysisText = profile ? JSON.stringify(profile).slice(0, 4000) : "";
    } else {
      const ads = (social?.paidAds as Record<string, unknown>[] | undefined) ?? [];
      postsData = ads.slice(0, 20).map(a => ({
        title: a.title,
        body: a.body,
        cta: a.cta,
        status: a.status,
      }));
      analysisText = String(social?.paidAdsAnalysis ?? "");
    }

    // Brand Visual DNA (forensic reproduction prompts + profile) extracted during
    // the audit from the brand's own Instagram/Meta creatives.
    const brandVisualProfile = (social?.brandVisualProfile as Record<string, unknown> | undefined) ?? undefined;
    const reproductionPrompts = (social?.reproductionPrompts as unknown[] | undefined) ?? [];

    return {
      productName: String(target.title ?? target.name ?? "Product"),
      brand: String(target.brand ?? "Brand"),
      category: String(target.category ?? ""),
      painPoints: painPoints.slice(0, 5).map(p => p.summary),
      posts: postsData,
      analysisText,
      brandVisualProfile,
      reproductionPrompts,
    };
  };

  const handleGenerate = async () => {
    if (!images.length) return;
    setIsGenerating(true);
    setPosts([]);
    setPhase("analyzing");
    setStatusMessage(isIg ? "Analyzing your Instagram posts…" : "Analyzing your Meta ads…");

    const ctx = extractContext();
    const imageDataUrls = images.map(img => img.dataUrl);
    const accumulated: GeneratedPost[] = [];
    try {
      const res = await fetch("/api/media-analyser/generate-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, imageDataUrls, imageModel, ...ctx }),
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
            const u = JSON.parse(line.slice(6)) as GeneratedPostUpdate;
            if (u.phase === "analyzing") { setPhase("analyzing"); setStatusMessage(u.message ?? ""); }
            else if (u.phase === "generating") {
              setPhase("generating");
              if (u.imageUrl && u.index != null) {
                const post: GeneratedPost = {
                  index: u.index, concept: u.concept ?? "", imageUrl: u.imageUrl,
                  caption: u.caption, headline: u.headline, primaryText: u.primaryText, cta: u.cta,
                };
                accumulated.push(post);
                setPosts(prev => [...prev.filter(p => p.index !== u.index), post].sort((a, b) => a.index - b.index));
              } else {
                setStatusMessage(u.message ?? "");
              }
            } else if (u.phase === "done") {
              setPhase("done");
              setStatusMessage("Done.");
              if (accumulated.length) {
                const referenceThumbnails = await makeThumbs(imageDataUrls);
                fetch("/api/media-analyser/generations", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    mode,
                    product_name: ctx.productName,
                    brand: ctx.brand,
                    result_count: accumulated.length,
                    thumbnail_url: accumulated[0]?.imageUrl ?? null,
                    results: accumulated,
                    input: {
                      description: isIg ? "Instagram posts from product photos" : "Meta ads from product photos",
                      imageModel,
                      aspect: isIg ? "4:5" : "1:1",
                      referenceThumbnails,
                    },
                  }),
                }).catch(() => {});
              }
            } else if (u.phase === "error" && u.index == null) { setPhase("error"); setStatusMessage(u.message ?? "Generation failed."); }
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
      a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.jpg`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { window.open(url, "_blank"); }
  };

  const copyText = (text: string) => navigator.clipboard?.writeText(text).catch(() => {});

  return (
    <div className={isColumn ? "mt-6 pt-6 border-t border-line" : "mt-8 border-t border-line pt-6"}>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">
          {title} <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">AI ✦</span>
          {dnaActive && (
            <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">
              Brand Visual DNA{dnaConfidence ? ` · ${dnaConfidence}` : ""}
            </span>
          )}
        </h3>
        <p className="text-xs text-fg-dim mt-0.5">{subtitle}</p>
        {dnaActive && dnaConfidence === "low" && (
          <p className="text-[11px] text-accent bg-accent-soft border border-accent/30 rounded-md px-2 py-1 mt-1.5">
            Limited brand data — visual results are approximate.
          </p>
        )}
        {!dnaActive && dnaStatus && dnaStatus !== "ok" && !dnaStatus.startsWith("ok ") && (
          <p className="text-[11px] text-accent bg-accent-soft border border-accent/30 rounded-md px-2 py-1 mt-1.5">
            No brand visual DNA — {dnaStatus}
          </p>
        )}
      </div>

      {/* Upload */}
      <div
        className={`relative border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
          isDragging ? "border-accent bg-accent-soft" : images.length ? "border-line bg-surface-2" : "border-line hover:border-accent/40 hover:bg-surface-2"
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
      >
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFileChange} />
        {images.length ? (
          <div className="space-y-3" onClick={e => e.stopPropagation()}>
            <div className={`grid gap-2 ${isColumn ? "grid-cols-2" : "grid-cols-3 sm:grid-cols-4"}`}>
              {images.map(img => (
                <div key={img.id} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.dataUrl} alt={img.name} className="w-full aspect-square object-contain rounded-lg border border-line bg-surface" />
                  <button
                    type="button"
                    onClick={() => removeImage(img.id)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Remove image"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-fg-dim text-left">
                {images.length} photo{images.length !== 1 ? "s" : ""} ready · output {isIg ? "4:5" : "1:1"}
              </p>
              {images.length < MAX_IMAGES && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] font-medium text-accent hover:text-accent shrink-0"
                >
                  + Add more
                </button>
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

      <div className="mt-3">
        <ModelSelect
          label="Image model"
          options={IMAGE_MODELS.map(m => ({ id: m.id, label: m.label }))}
          value={imageModel}
          onChange={setImageModel}
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
          {(phase === "analyzing" || phase === "generating") && (
            <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          )}
          <span className={phase === "error" ? "text-alert" : ""}>{statusMessage}</span>
        </div>
      )}

      {/* Results */}
      {posts.length > 0 && (
        <div className={`mt-5 grid grid-cols-1 ${isColumn ? "gap-4" : "sm:grid-cols-3 gap-4"}`}>
          {posts.map(p => (
            <div key={p.index} className="border border-line rounded-xl overflow-hidden bg-surface shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.imageUrl} alt={p.concept} className={`w-full object-cover ${isIg ? "aspect-[4/5]" : "aspect-square"}`} loading="lazy" />
              <div className="p-3 space-y-2">
                <p className="text-xs font-semibold text-fg">{p.concept}</p>
                {isIg ? (
                  p.caption && <p className="text-xs text-fg-dim whitespace-pre-line leading-relaxed">{p.caption}</p>
                ) : (
                  <div className="space-y-1">
                    {p.headline && <p className="text-xs font-semibold text-fg">{p.headline}</p>}
                    {p.primaryText && <p className="text-xs text-fg-dim leading-relaxed">{p.primaryText}</p>}
                    {p.cta && <span className="inline-block text-[10px] font-semibold text-white bg-accent px-2 py-0.5 rounded">{p.cta}</span>}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => download(p.imageUrl, p.concept)} className="text-[11px] text-accent hover:text-accent bg-accent-soft hover:bg-accent-soft px-2 py-1 rounded-md transition-colors">Download</button>
                  <button
                    onClick={() => copyText(isIg ? (p.caption ?? "") : `${p.headline ?? ""}\n\n${p.primaryText ?? ""}\n\n${p.cta ?? ""}`)}
                    className="text-[11px] text-fg-dim hover:text-fg bg-surface-2 hover:bg-surface-2 px-2 py-1 rounded-md transition-colors"
                  >Copy text</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
