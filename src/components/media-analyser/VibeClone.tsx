
import { useRef, useState, useCallback } from "react";
import type { VibeCloneUpdate } from "@/lib/media-analyser/api-types";
import ModelSelect from "@/components/media-analyser/ModelSelect";
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL_ID } from "@/lib/media-analyser/generation-models";
import { makeThumbs } from "@/lib/media-analyser/image-thumb";

type FalAspect = "auto" | "1:1" | "4:5" | "9:16";
type GenPhase = "idle" | "running" | "done" | "error";

interface UploadedImage {
  id: string;
  dataUrl: string;
  name: string;
}

interface VibeResult {
  index: number;
  status: "analyzing" | "generating" | "done" | "error";
  sceneName?: string;
  summary?: string;
  palette?: string[];
  sourceUrl: string;
  imageUrl?: string;
  hasProduct: boolean;
  error?: string;
}

const MAX_REF = 15;
const MAX_PROD = 6;

const ASPECTS: { key: FalAspect; label: string }[] = [
  { key: "auto", label: "Auto" },
  { key: "1:1", label: "Square 1:1" },
  { key: "4:5", label: "Portrait 4:5" },
  { key: "9:16", label: "Story 9:16" },
];

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

interface DropZoneProps {
  images: UploadedImage[];
  max: number;
  onAdd: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
  label: string;
  sublabel: string;
  accentClass: string;
  dragClass: string;
  addMoreClass: string;
  cols?: string;
}

function DropZone({ images, max, onAdd, onRemove, label, sublabel, accentClass, dragClass, addMoreClass, cols = "grid-cols-3 sm:grid-cols-5" }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const border = isDragging
    ? dragClass
    : images.length
      ? "border-line bg-surface-2"
      : `border-line hover:${accentClass} hover:bg-surface-2/50`;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold text-fg">{label}</p>
      <p className="text-[11px] text-fg-mute leading-snug">{sublabel}</p>
      <div
        className={`border-2 border-dashed rounded-xl p-4 cursor-pointer transition-colors ${border}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files?.length) onAdd(e.dataTransfer.files);
        }}
      >
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => { if (e.target.files?.length) onAdd(e.target.files); e.target.value = ""; }} />
        {images.length ? (
          <div className="space-y-2" onClick={e => e.stopPropagation()}>
            <div className={`grid ${cols} gap-1.5`}>
              {images.map(img => (
                <div key={img.id} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.dataUrl} alt={img.name} className="w-full aspect-square object-contain rounded-md border border-line bg-surface" />
                  <button type="button" onClick={() => onRemove(img.id)}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    aria-label="Remove">×</button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-fg-mute">{images.length}/{max}</p>
              {images.length < max && (
                <button type="button" onClick={() => fileRef.current?.click()} className={`text-[11px] font-medium ${addMoreClass} shrink-0`}>
                  + Add more
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm font-medium text-fg-dim">Drop images here</p>
            <p className="text-[11px] text-fg-mute mt-0.5">JPG · PNG · WEBP · up to {max}</p>
          </div>
        )}
      </div>
    </div>
  );
}

type ProductMode = "product_compose" | "replace_product";

export function VibeClone() {
  const [refImages, setRefImages] = useState<UploadedImage[]>([]);
  const [productImages, setProductImages] = useState<UploadedImage[]>([]);
  const [aspect, setAspect] = useState<FalAspect>("auto");
  const [imageModel, setImageModel] = useState<string>(DEFAULT_IMAGE_MODEL_ID);
  const [productMode, setProductMode] = useState<ProductMode>("product_compose");
  const [phase, setPhase] = useState<GenPhase>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [results, setResults] = useState<VibeResult[]>([]);

  const isRunning = phase === "running";
  const hasProduct = productImages.length > 0;

  const addRef = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!list.length) return;
    setRefImages(prev => {
      const slots = MAX_REF - prev.length;
      if (slots <= 0) return prev;
      (async () => {
        const added: UploadedImage[] = [];
        for (const file of list.slice(0, slots)) {
          try { added.push({ id: crypto.randomUUID(), dataUrl: await compressImage(file), name: file.name }); } catch { /* ignore */ }
        }
        if (added.length) { setRefImages(p => [...p, ...added]); setResults([]); setPhase("idle"); }
      })();
      return prev;
    });
  }, []);

  const addProduct = useCallback(async (files: FileList | File[]) => {
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
        if (added.length) { setProductImages(p => [...p, ...added]); setResults([]); setPhase("idle"); }
      })();
      return prev;
    });
  }, []);

  const removeRef = (id: string) => { setRefImages(p => p.filter(i => i.id !== id)); setResults([]); setPhase("idle"); };
  const removeProd = (id: string) => { setProductImages(p => p.filter(i => i.id !== id)); setResults([]); setPhase("idle"); };

  const upsert = (index: number, patch: Partial<VibeResult>, fallbackSource: string) => {
    setResults(prev => {
      const base: VibeResult = prev.find(r => r.index === index) ?? { index, status: "analyzing", sourceUrl: fallbackSource, hasProduct };
      return [...prev.filter(r => r.index !== index), { ...base, ...patch } as VibeResult].sort((a, b) => a.index - b.index);
    });
  };

  const handleGenerate = async () => {
    if (!refImages.length || isRunning) return;
    setPhase("running");
    setStatusMessage(hasProduct
      ? `Cloning the vibe of ${refImages.length} reference image${refImages.length !== 1 ? "s" : ""} onto your product…`
      : `Reading each image's vibe and regenerating…`);
    setResults(refImages.map((img, i) => ({ index: i, status: "analyzing", sourceUrl: img.dataUrl, hasProduct })));

    const accumulated: VibeResult[] = [];
    try {
      const res = await fetch("/api/media-analyser/vibe-clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrls: refImages.map(i => i.dataUrl), productDataUrls: productImages.map(i => i.dataUrl), aspect, imageModel, productMode: hasProduct ? productMode : undefined }),
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
            const u = JSON.parse(line.slice(6)) as VibeCloneUpdate;
            if (u.message) setStatusMessage(u.message);
            if (u.index == null) {
              if (u.phase === "done") { setPhase("done"); setStatusMessage("All images generated."); }
              else if (u.phase === "error") { setPhase("error"); }
              continue;
            }
            const refUrl = refImages[u.index]?.dataUrl ?? "";
            const hp = u.hasProduct ?? hasProduct;
            if (u.phase === "analyzing") {
              upsert(u.index, { status: "analyzing", hasProduct: hp }, refUrl);
            } else if (u.phase === "generating") {
              upsert(u.index, { status: "generating", sceneName: u.sceneName, summary: u.summary, palette: u.palette, hasProduct: hp }, refUrl);
            } else if (u.phase === "result") {
              const r: VibeResult = { index: u.index, status: "done", sceneName: u.sceneName, summary: u.summary, palette: u.palette, sourceUrl: u.sourceUrl ?? refUrl, imageUrl: u.imageUrl, hasProduct: hp };
              accumulated.push(r);
              upsert(u.index, r, refUrl);
            } else if (u.phase === "error") {
              upsert(u.index, { status: "error", error: u.message, hasProduct: hp }, refUrl);
            }
          } catch { /* skip malformed events */ }
        }
      }
      if (accumulated.length) {
        const referenceThumbnails = await makeThumbs([
          ...refImages.map(i => i.dataUrl),
          ...productImages.map(i => i.dataUrl),
        ]);
        fetch("/api/media-analyser/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "vibe_clone",
            product_name: `Vibe clone · ${refImages.length} image${refImages.length !== 1 ? "s" : ""}`,
            result_count: accumulated.length,
            thumbnail_url: accumulated[0]?.imageUrl ?? null,
            results: accumulated,
            input: {
              description: `Reproduced the vibe of ${refImages.length} reference image${refImages.length !== 1 ? "s" : ""}${productImages.length ? ` onto ${productImages.length} product photo${productImages.length !== 1 ? "s" : ""}` : ""}`,
              aspect,
              imageModel,
              referenceThumbnails,
            },
          }),
        }).catch(() => {});
      }
    } catch (e) {
      setPhase("error");
      setStatusMessage(String(e));
    }
  };

  const reset = () => { setRefImages([]); setProductImages([]); setResults([]); setPhase("idle"); setStatusMessage(""); };

  const download = async (url: string, name: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "vibe-clone"}.jpg`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { window.open(url, "_blank"); }
  };

  const aspectClass = aspect === "9:16" ? "aspect-[9/16]" : aspect === "4:5" ? "aspect-[4/5]" : aspect === "1:1" ? "aspect-square" : "aspect-video";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">
          Vibe Clone
          <span className="text-[10px] font-semibold text-accent bg-accent px-1.5 py-0.5 rounded-full">per-image agent ✦</span>
        </h3>
        <p className="text-xs text-fg-dim mt-0.5 leading-relaxed">
          Upload reference images from <em>any</em> brand — we clone each one&apos;s exact vibe.
          Optionally upload your product to composite it into every cloned vibe.
        </p>
      </div>

      {(refImages.length > 0 || productImages.length > 0) && (
        <div className={`flex items-center gap-2 text-[11px] font-medium px-3 py-2 rounded-lg border ${hasProduct ? "text-accent bg-accent border-accent" : "text-fg-dim bg-surface-2 border-line"}`}>
          <span>{hasProduct ? "✦" : "↻"}</span>
          <span>{hasProduct
            ? productMode === "replace_product"
              ? `Your product will REPLACE the original product in each of the ${refImages.length} reference image${refImages.length !== 1 ? "s" : ""} — same scene, different product`
              : `Your product will be composited into the exact vibe of each of the ${refImages.length} reference image${refImages.length !== 1 ? "s" : ""}`
            : `Each of the ${refImages.length} reference image${refImages.length !== 1 ? "s" : ""} will be cloned with improved light and grade`}
          </span>
        </div>
      )}

      {/* Product mode toggle — shown only when product images are uploaded */}
      {hasProduct && (
        <div>
          <p className="text-xs font-medium text-fg-dim mb-2">Product mode</p>
          <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line">
            <button
              onClick={() => setProductMode("product_compose")} disabled={isRunning}
              className={`flex-1 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${productMode === "product_compose" ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
              Composite — place product in the vibe scene
            </button>
            <button
              onClick={() => setProductMode("replace_product")} disabled={isRunning}
              className={`flex-1 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${productMode === "replace_product" ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
              Swap — replace the ad&apos;s existing product
            </button>
          </div>
          {productMode === "replace_product" && (
            <p className="text-[11px] text-fg-mute mt-1.5">Reference images must already contain a product. The agent removes it and seats your product in the same position.</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DropZone images={refImages} max={MAX_REF} onAdd={addRef} onRemove={removeRef}
          label="Reference Images" sublabel={`1–${MAX_REF} images from any brand — we clone their exact vibe.`}
          accentClass="border-accent" dragClass="border-accent bg-accent"
          addMoreClass="text-accent hover:text-accent" cols="grid-cols-3 sm:grid-cols-4" />
        <DropZone images={productImages} max={MAX_PROD} onAdd={addProduct} onRemove={removeProd}
          label="Your Product Photos (optional)" sublabel={`1–${MAX_PROD} angles of your product. Leave empty to restyle the references.`}
          accentClass="border-line" dragClass="border-line bg-surface-2"
          addMoreClass="text-fg-dim hover:text-fg" cols="grid-cols-3" />
      </div>

      <div>
        <p className="text-xs font-medium text-fg-dim mb-2">Output format</p>
        <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line">
          {ASPECTS.map(a => (
            <button key={a.key} onClick={() => setAspect(a.key)} disabled={isRunning}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${aspect === a.key ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
              {a.label}
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

      <div className="flex gap-2">
        <button onClick={handleGenerate} disabled={!refImages.length || isRunning}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${!refImages.length || isRunning ? "bg-surface-2 text-fg-mute cursor-not-allowed" : "bg-accent text-bg hover:opacity-90"}`}>
          {isRunning ? "Generating…" : hasProduct
            ? `Clone vibe of ${refImages.length} image${refImages.length !== 1 ? "s" : ""} onto product`
            : `Clone the vibe of ${refImages.length || ""} image${refImages.length === 1 ? "" : "s"}`.trim()}
        </button>
        {(results.length > 0 || refImages.length > 0 || productImages.length > 0) && !isRunning && (
          <button onClick={reset} className="px-4 py-2.5 text-sm text-fg-mute hover:text-fg-dim transition-colors">Clear</button>
        )}
      </div>

      {phase !== "idle" && statusMessage && (
        <div className="flex items-center gap-2 text-sm">
          {isRunning && <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />}
          <span className={phase === "error" ? "text-alert" : phase === "done" ? "text-accent-2 font-medium" : "text-fg-dim"}>{statusMessage}</span>
        </div>
      )}

      {results.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {results.map(r => (
            <div key={r.index} className="border border-line rounded-xl overflow-hidden bg-surface shadow-sm">
              <div className="grid grid-cols-2">
                <div className="relative border-r border-line bg-surface-2">
                  <span className="absolute top-1.5 left-1.5 z-10 text-[9px] font-semibold text-fg-dim bg-surface/80 px-1.5 py-0.5 rounded-full">Source</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.sourceUrl} alt="" className={`w-full ${aspectClass} object-cover`} loading="lazy" />
                </div>
                <div className="relative bg-surface-2 flex items-center justify-center">
                  <span className="absolute top-1.5 left-1.5 z-10 text-[9px] font-semibold bg-surface/80 px-1.5 py-0.5 rounded-full text-accent">
                    {r.hasProduct ? "Your product" : "Cloned"}
                  </span>
                  {r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imageUrl} alt={r.sceneName ?? ""} className={`w-full ${aspectClass} object-cover`} loading="lazy" />
                  ) : r.status === "error" ? (
                    <div className={`w-full ${aspectClass} flex items-center justify-center p-3`}>
                      <p className="text-[11px] text-alert text-center leading-snug">{r.error ?? "Failed"}</p>
                    </div>
                  ) : (
                    <div className={`w-full ${aspectClass} flex flex-col items-center justify-center gap-2 text-fg-mute`}>
                      <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                      <span className="text-[10px]">{r.status === "generating" ? (r.hasProduct ? "Compositing…" : "Cloning…") : "Analysing…"}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="p-3 space-y-1.5">
                {r.sceneName && <p className="text-xs font-semibold text-fg">{r.sceneName}</p>}
                {r.summary && <p className="text-[11px] text-fg-dim leading-relaxed line-clamp-2">{r.summary}</p>}
                {r.palette && r.palette.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    {r.palette.slice(0, 6).map(hex => (
                      <div key={hex} className="w-4 h-4 rounded-full border border-white shadow-sm shrink-0" style={{ backgroundColor: hex }} title={hex} />
                    ))}
                  </div>
                )}
                {r.imageUrl && (
                  <div className="pt-1">
                    <button onClick={() => download(r.imageUrl!, r.sceneName ?? `vibe-clone-${r.index + 1}`)}
                      className="text-[11px] text-accent hover:text-accent bg-accent hover:bg-accent px-2 py-1 rounded-md transition-colors">
                      Download
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
