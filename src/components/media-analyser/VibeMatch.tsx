
import { useRef, useState, useCallback } from "react";
import type { VibeMatchUpdate } from "@/lib/media-analyser/api-types";
import ModelSelect from "@/components/media-analyser/ModelSelect";
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL_ID } from "@/lib/media-analyser/generation-models";
import { makeThumbs } from "@/lib/media-analyser/image-thumb";

type FalAspect = "auto" | "1:1" | "4:5" | "9:16";
type GenPhase = "idle" | "extracting" | "generating" | "done" | "error";

interface UploadedImage {
  id: string;
  dataUrl: string;
  name: string;
}

interface VibePreview {
  summary: string;
  confidence: string;
  palette: string[];
  colourTone?: string;
  promptCount: number;
}

interface VibeResult {
  index: number;
  status: "pending" | "generating" | "done" | "error";
  sceneName?: string;
  shotId?: string;
  imageUrl?: string;
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
  required?: boolean;
  accentClass: string;
  dragClass: string;
  addMoreClass: string;
  cols?: string;
}

function DropZone({ images, max, onAdd, onRemove, label, sublabel, required, accentClass, dragClass, addMoreClass, cols = "grid-cols-3 sm:grid-cols-5" }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const border = isDragging
    ? dragClass
    : images.length
      ? "border-line bg-surface-2"
      : `border-line hover:${accentClass} hover:bg-surface-2/50`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-semibold text-fg">{label}</p>
        {required && <span className="text-[9px] font-semibold text-white bg-fg-mute px-1 py-0.5 rounded">required</span>}
      </div>
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

export function VibeMatch() {
  const [refImages, setRefImages] = useState<UploadedImage[]>([]);
  const [productImages, setProductImages] = useState<UploadedImage[]>([]);
  const [aspect, setAspect] = useState<FalAspect>("auto");
  const [imageModel, setImageModel] = useState<string>(DEFAULT_IMAGE_MODEL_ID);
  const [phase, setPhase] = useState<GenPhase>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [vibePreview, setVibePreview] = useState<VibePreview | null>(null);
  const [results, setResults] = useState<VibeResult[]>([]);

  const isRunning = phase === "extracting" || phase === "generating";
  const canGenerate = refImages.length >= 2 && productImages.length >= 1 && !isRunning;

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
        if (added.length) { setRefImages(p => [...p, ...added]); setResults([]); setVibePreview(null); setPhase("idle"); }
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

  const removeRef = (id: string) => { setRefImages(p => p.filter(i => i.id !== id)); setResults([]); setVibePreview(null); setPhase("idle"); };
  const removeProd = (id: string) => { setProductImages(p => p.filter(i => i.id !== id)); setResults([]); setPhase("idle"); };

  const upsertResult = (index: number, patch: Partial<VibeResult>) => {
    setResults(prev => {
      const base: VibeResult = prev.find(r => r.index === index) ?? { index, status: "pending" };
      return [...prev.filter(r => r.index !== index), { ...base, ...patch }].sort((a, b) => a.index - b.index);
    });
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setPhase("extracting");
    setStatusMessage(`Synthesising vibe from ${refImages.length} reference image${refImages.length !== 1 ? "s" : ""}…`);
    setVibePreview(null);
    setResults([]);

    const accumulated: VibeResult[] = [];
    try {
      const res = await fetch("/api/media-analyser/vibe-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceDataUrls: refImages.map(i => i.dataUrl),
          productDataUrls: productImages.map(i => i.dataUrl),
          aspect,
          imageModel,
        }),
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
            const u = JSON.parse(line.slice(6)) as VibeMatchUpdate;
            if (u.message) setStatusMessage(u.message);

            if (u.phase === "extracting") {
              setPhase("extracting");
            } else if (u.phase === "vibe_ready") {
              setVibePreview({
                summary: u.vibeSummary ?? "",
                confidence: u.vibeConfidence ?? "medium",
                palette: u.palette ?? [],
                colourTone: u.colourTone,
                promptCount: u.promptCount ?? 3,
              });
              // Pre-seed result cards so the user sees them immediately.
              const count = u.promptCount ?? 3;
              setResults(Array.from({ length: count }, (_, i) => ({ index: i, status: "pending" })));
              setPhase("generating");
            } else if (u.phase === "generating" && u.index != null) {
              upsertResult(u.index, { status: "generating", sceneName: u.sceneName });
            } else if (u.phase === "result" && u.index != null) {
              const r: VibeResult = { index: u.index, status: "done", sceneName: u.sceneName, shotId: u.shotId, imageUrl: u.imageUrl };
              accumulated.push(r);
              upsertResult(u.index, r);
            } else if (u.phase === "error" && u.index != null) {
              upsertResult(u.index, { status: "error", error: u.message });
            } else if (u.phase === "done") {
              setPhase("done");
              setStatusMessage(u.message ?? "Done.");
            } else if (u.phase === "error" && u.index == null) {
              setPhase("error");
            }
          } catch { /* skip malformed events */ }
        }
      }

      if (accumulated.length) {
        const referenceThumbnails = await makeThumbs([
          ...productImages.map(i => i.dataUrl),
          ...refImages.map(i => i.dataUrl),
        ]);
        fetch("/api/media-analyser/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "vibe_match",
            product_name: `Vibe match · ${refImages.length} references`,
            result_count: accumulated.length,
            thumbnail_url: accumulated[0]?.imageUrl ?? null,
            results: accumulated,
            input: {
              description: `Combined vibe from ${refImages.length} reference image${refImages.length !== 1 ? "s" : ""} applied to ${productImages.length} product photo${productImages.length !== 1 ? "s" : ""}`,
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

  const reset = () => {
    setRefImages([]); setProductImages([]); setResults([]);
    setVibePreview(null); setPhase("idle"); setStatusMessage("");
  };

  const download = async (url: string, name: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "vibe-match"}.jpg`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { window.open(url, "_blank"); }
  };

  const aspectClass = aspect === "9:16" ? "aspect-[9/16]" : aspect === "4:5" ? "aspect-[4/5]" : aspect === "1:1" ? "aspect-square" : "aspect-video";
  const confColor = vibePreview?.confidence === "high" ? "text-accent-2 bg-accent-2-soft" : vibePreview?.confidence === "low" ? "text-alert bg-alert-soft" : "text-accent bg-accent-soft";

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">
          Vibe Match
          <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">combined-vibe agent ✦</span>
        </h3>
        <p className="text-xs text-fg-dim mt-0.5 leading-relaxed">
          Upload 2–15 reference images from <em>any</em> brand — we synthesise their combined aesthetic into one vibe profile, then render your product in every scene variation of that vibe.
        </p>
      </div>

      {/* Two upload zones */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DropZone
          images={refImages} max={MAX_REF} onAdd={addRef} onRemove={removeRef}
          label="Reference Images" sublabel={`2–${MAX_REF} images from any brand — we extract the combined vibe.`}
          accentClass="border-accent/40" dragClass="border-accent bg-accent-soft"
          addMoreClass="text-accent hover:text-accent" cols="grid-cols-3 sm:grid-cols-4"
        />
        <DropZone
          images={productImages} max={MAX_PROD} onAdd={addProduct} onRemove={removeProd}
          label="Your Product Photos" sublabel={`1–${MAX_PROD} angles of your product — composited into the extracted vibe.`}
          required accentClass="border-line" dragClass="border-line bg-surface-2"
          addMoreClass="text-fg-dim hover:text-fg" cols="grid-cols-3"
        />
      </div>

      {/* Validation hints */}
      {refImages.length === 1 && (
        <p className="text-[11px] text-accent bg-accent-soft border border-accent/30 rounded-md px-2.5 py-1.5">
          Add at least one more reference image — combined vibe synthesis requires a minimum of 2.
        </p>
      )}

      {/* Output format */}
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

      {/* Generate / Clear */}
      <div className="flex gap-2">
        <button onClick={handleGenerate} disabled={!canGenerate}
          className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${
            canGenerate
              ? "bg-gradient-to-r from-accent to-accent text-white hover:from-accent hover:to-accent shadow-sm"
              : "bg-surface-2 text-fg-mute cursor-not-allowed"
          }`}>
          {isRunning
            ? phase === "extracting" ? `Synthesising vibe from ${refImages.length} images…` : "Generating product renders…"
            : `Synthesise vibe + render my product`}
        </button>
        {(results.length > 0 || refImages.length > 0 || productImages.length > 0) && !isRunning && (
          <button onClick={reset} className="px-4 py-2.5 text-sm text-fg-mute hover:text-fg-dim transition-colors">Clear</button>
        )}
      </div>

      {/* Status */}
      {phase !== "idle" && statusMessage && (
        <div className="flex items-center gap-2 text-sm">
          {isRunning && <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />}
          <span className={phase === "error" ? "text-alert" : phase === "done" ? "text-accent-2 font-medium" : "text-fg-dim"}>
            {statusMessage}
          </span>
        </div>
      )}

      {/* Vibe preview — shown once extraction completes */}
      {vibePreview && (
        <div className="rounded-xl bg-gradient-to-br from-accent to-accent border border-accent/30 p-4 space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-accent">Combined vibe extracted</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${confColor}`}>
              {vibePreview.confidence} confidence
            </span>
            <span className="text-[10px] text-accent">{refImages.length} refs → {vibePreview.promptCount} scene render{vibePreview.promptCount !== 1 ? "s" : ""}</span>
          </div>
          <p className="text-xs text-fg leading-relaxed">{vibePreview.summary}</p>
          {vibePreview.colourTone && (
            <p className="text-[11px] text-accent italic">{vibePreview.colourTone}</p>
          )}
          {vibePreview.palette.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-fg-mute">Palette</span>
              {vibePreview.palette.slice(0, 8).map(hex => (
                <div key={hex} className="w-5 h-5 rounded-full border-2 border-white shadow-sm shrink-0" style={{ backgroundColor: hex }} title={hex} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results — one card per reproductionPrompt scene */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {results.map(r => (
            <div key={r.index} className="border border-line rounded-xl overflow-hidden bg-surface shadow-sm">
              <div className="relative bg-surface-2 flex items-center justify-center">
                <span className="absolute top-1.5 left-1.5 z-10 text-[9px] font-semibold text-accent bg-surface/80 px-1.5 py-0.5 rounded-full">
                  Your product
                </span>
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.imageUrl} alt={r.sceneName ?? ""} className={`w-full ${aspectClass} object-cover`} loading="lazy" />
                ) : r.status === "error" ? (
                  <div className={`w-full ${aspectClass} flex items-center justify-center p-4`}>
                    <p className="text-[11px] text-alert text-center leading-snug">{r.error ?? "Render failed"}</p>
                  </div>
                ) : (
                  <div className={`w-full ${aspectClass} flex flex-col items-center justify-center gap-2 text-fg-mute`}>
                    <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    <span className="text-[10px]">{r.status === "generating" ? "Compositing…" : "Queued…"}</span>
                  </div>
                )}
              </div>
              <div className="p-3 space-y-1.5">
                {r.sceneName && <p className="text-xs font-semibold text-fg">{r.sceneName}</p>}
                {r.shotId && <p className="text-[10px] text-fg-mute font-mono">{r.shotId}</p>}
                {vibePreview?.palette && vibePreview.palette.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    {vibePreview.palette.slice(0, 6).map(hex => (
                      <div key={hex} className="w-4 h-4 rounded-full border border-white shadow-sm shrink-0" style={{ backgroundColor: hex }} title={hex} />
                    ))}
                  </div>
                )}
                {r.imageUrl && (
                  <div className="pt-1">
                    <button onClick={() => download(r.imageUrl!, r.sceneName ?? `vibe-match-${r.index + 1}`)}
                      className="text-[11px] text-accent hover:text-accent bg-accent-soft hover:bg-accent-soft px-2 py-1 rounded-md transition-colors">
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
