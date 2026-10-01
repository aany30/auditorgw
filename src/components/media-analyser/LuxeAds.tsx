
import { useCallback, useRef, useState } from "react";
import ModelSelect from "@/components/media-analyser/ModelSelect";
import type { UGCFetchProductResponse } from "@/lib/media-analyser/api-types";
import type { LuxRenderSubmit } from "@/lib/media-analyser/api-types";
import type { UGCRenderStatus } from "@/lib/media-analyser/api-types";
import type { LuxPlan } from "@/lib/media-analyser/lux-ads/prompt";

const MAX_PROD = 3;    // product images pulled from the scraped link
const MAX_MODEL = 2;   // optional model-face reference shots
const MAX_IMAGE_BYTES = 780_000;
const RENDER_POLL_MS = 6000;
const RENDER_DEADLINE_MS = 20 * 60 * 1000;

// Lux spots render on Seedance 2.5; its schema supports 16:9 / 9:16 / 1:1.
type LuxAspect = "16:9" | "9:16" | "1:1";
const ASPECTS: { key: LuxAspect; label: string }[] = [
  { key: "16:9", label: "Landscape 16:9" },
  { key: "9:16", label: "Vertical 9:16" },
  { key: "1:1", label: "Square 1:1" },
];
const previewAspectClass = (a: LuxAspect): string =>
  a === "16:9" ? "aspect-video" : a === "1:1" ? "aspect-square" : "aspect-[9/16]";

type Phase = "input" | "fetching" | "scripting" | "ready" | "rendering" | "done" | "error";

interface UploadedImage { id: string; dataUrl: string; name: string }

/** Re-encode a loaded image to a budget-safe JPEG data URL. */
function encodeImage(img: HTMLImageElement, maxDim = 1280): string {
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
  let dim = maxDim;
  let out = encodeAt(dim, 0.85);
  for (const q of [0.75, 0.65, 0.55]) { if (out.length <= MAX_IMAGE_BYTES) break; out = encodeAt(dim, q); }
  while (out.length > MAX_IMAGE_BYTES && dim > 640) { dim = Math.round(dim * 0.8); out = encodeAt(dim, 0.6); }
  return out;
}

/** Compress an uploaded File → JPEG data URL. */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); try { resolve(encodeImage(img)); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); } };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
    img.src = url;
  });
}

/** Load a scraped product image URL through the CORS-safe edge proxy and re-encode it
 *  to a compressed same-origin data URL (so it can feed the script + Nano Banana). */
function urlToDataUrl(remoteUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { try { resolve(encodeImage(img)); } catch { resolve(null); } };
    img.onerror = () => resolve(null);
    img.src = `/api/image-proxy?url=${encodeURIComponent(remoteUrl)}`;
  });
}

function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m || "Something went wrong. Please try again.";
}

export function LuxeAds() {
  // ── inputs (per the workflow: Product Link, Concept, optional Model Face, Aspect) ──
  const [productUrl, setProductUrl] = useState("");
  const [concept, setConcept] = useState("");
  const [productUploads, setProductUploads] = useState<UploadedImage[]>([]);
  const [modelImages, setModelImages] = useState<UploadedImage[]>([]);
  const [aspect, setAspect] = useState<LuxAspect>("16:9");
  // "Imagine concept" — the user writes a single-line idea, we imagine a full concept from it
  // (a distinct step BEFORE script gen); they review/edit/regenerate the concept, then the
  // finalised concept feeds the script. `idea` = the one-liner seed; `concept` = the concept used.
  const [imagineConcept, setImagineConcept] = useState(false);
  const [idea, setIdea] = useState("");
  const [imagining, setImagining] = useState(false);

  // scraped product (Apify → Product Image + Bulletin Description)
  const [productImages, setProductImages] = useState<UploadedImage[]>([]);
  const [productTitle, setProductTitle] = useState("");

  const [phase, setPhase] = useState<Phase>("input");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState<LuxPlan | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [renderEngine, setRenderEngine] = useState<"ark" | "fal">("ark");

  const fileRef = useRef<HTMLInputElement>(null);
  const prodFileRef = useRef<HTMLInputElement>(null);
  const busy = phase === "fetching" || phase === "scripting" || phase === "rendering";

  const addModelImages = useCallback(async (files: FileList | File[]) => {
    const slots = MAX_MODEL - modelImages.length;
    if (slots <= 0) return;
    const added: UploadedImage[] = [];
    for (const file of Array.from(files).slice(0, slots)) {
      try { added.push({ id: crypto.randomUUID(), dataUrl: await compressImage(file), name: file.name }); } catch { /* ignore */ }
    }
    if (added.length) setModelImages(p => [...p, ...added]);
  }, [modelImages.length]);

  const removeModelImage = (id: string) => setModelImages(p => p.filter(i => i.id !== id));

  const addProductUploads = useCallback(async (files: FileList | File[]) => {
    const slots = MAX_PROD - productUploads.length;
    if (slots <= 0) return;
    const added: UploadedImage[] = [];
    for (const file of Array.from(files).slice(0, slots)) {
      try { added.push({ id: crypto.randomUUID(), dataUrl: await compressImage(file), name: file.name }); } catch { /* ignore */ }
    }
    if (added.length) setProductUploads(p => [...p, ...added]);
  }, [productUploads.length]);

  const removeProductUpload = (id: string) => setProductUploads(p => p.filter(i => i.id !== id));

  const resetAll = () => {
    setProductUrl(""); setConcept(""); setIdea(""); setImagining(false); setProductUploads([]); setModelImages([]); setProductImages([]); setProductTitle("");
    setPlan(null); setVideoUrl("");
    setError(""); setStatus(""); setPhase("input");
  };

  // ── Step 1: Product Link → Apify scrape → product image + description → Script Gen ──
  const generateScript = useCallback(async () => {
    const hasUploads = productUploads.length > 0;
    if (!concept.trim() || busy) return;
    if (!productUrl.trim() && !hasUploads) return;
    setError(""); setPlan(null); setVideoUrl("");

    // A → A1 → (A2 product image + A3/A4 description).
    // If the user uploaded product photos, a blocked/empty scrape is non-fatal — we fall back to the uploads.
    let images: UploadedImage[] = [];
    let features = "";
    let title = "";
    if (productUrl.trim()) {
      setPhase("fetching"); setStatus("Scraping the product page…");
      try {
        const res = await fetch("/api/media-analyser/ugc-ads-fetch-product", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: productUrl.trim() }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<UGCFetchProductResponse> & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Could not scrape that product link.");

        title = (data.title ?? "").trim();
        features = [data.title, ...(data.bullets ?? []), data.description].map(s => (s ?? "").trim()).filter(Boolean).join("\n").slice(0, 2000);

        const urls = (data.imageUrls ?? []).slice(0, MAX_PROD);
        if (urls.length) {
          setStatus(`Fetching ${urls.length} product image${urls.length > 1 ? "s" : ""}…`);
          const converted = await Promise.all(urls.map(u => urlToDataUrl(u)));
          converted.forEach((d, i) => { if (d) images.push({ id: crypto.randomUUID(), dataUrl: d, name: `Product ${i + 1}` }); });
        }
      } catch (e) {
        // With uploads on hand we can keep going; without them the scrape is the only source, so surface the error.
        if (!hasUploads) { setError(friendly(e)); setPhase("input"); setStatus(""); return; }
        setStatus("Couldn't scrape that link — using your uploaded product photos.");
      }
    }

    // Uploaded product photos lead (they're the user's ground truth); scraped shots fill the rest.
    if (hasUploads) images = [...productUploads, ...images].slice(0, MAX_PROD);

    if (!images.length) {
      setError("No product images. Upload a product photo (some sites block our scraper), or try a different link.");
      setPhase("input"); setStatus(""); return;
    }

    setProductImages(images); setProductTitle(title);

    // (A4 + U concept + C model face) → F Script Gen (editable) → Scene / Dialogue / Video Prompt
    setPhase("scripting"); setStatus("Directing the 30-second luxury spot…");
    try {
      const res = await fetch("/api/media-analyser/lux-ads-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrls: images.map(i => i.dataUrl),
          modelImageDataUrls: modelImages.map(i => i.dataUrl),
          description: concept.trim(),
          productFeatures: features,
          aspect,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { plan?: LuxPlan; error?: string };
      if (!res.ok || !data.plan) throw new Error(data.error ?? "Could not write the script.");
      setPlan(data.plan); setPhase("ready"); setStatus("");
    } catch (e) {
      setError(friendly(e)); setPhase("input"); setStatus("");
    }
  }, [productUrl, concept, productUploads, modelImages, aspect, busy]);

  // ── Imagine concept (pre-step): one-line idea → full cinematic concept the user then finalises ──
  const imagineConceptNow = useCallback(async () => {
    if (!idea.trim() || imagining || busy) return;
    setImagining(true); setError("");
    try {
      const res = await fetch("/api/media-analyser/ugc-ads-imagine-concept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: idea.trim(), imageDataUrls: productUploads.map(i => i.dataUrl), productTitle }),
      });
      const data = (await res.json().catch(() => ({}))) as { concept?: string; error?: string };
      if (!res.ok || !data.concept) throw new Error(data.error ?? "Could not imagine a concept.");
      setConcept(data.concept);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setImagining(false);
    }
  }, [idea, imagining, busy, productUploads, productTitle]);

  // Inline-edit a keyframe's visual action.
  const editKeyframeAction = (n: number, action: string) =>
    setPlan(prev => prev ? { ...prev, keyframes: prev.keyframes.map(k => k.keyframe_number === n ? { ...k, action } : k) } : prev);

  // ── Step 2: Nano reference assets → Seedance 2.5 (native 30s) → Video ──
  const generateVideo = useCallback(async () => {
    if (!plan || !productImages.length || busy) return;
    setPhase("rendering"); setError(""); setStatus("Building references & filming the 30-second spot… this takes a few minutes.");
    setVideoUrl("");
    try {
      const submitRes = await fetch("/api/media-analyser/lux-ads-render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrls: productImages.map(i => i.dataUrl),
          modelImageDataUrls: modelImages.map(i => i.dataUrl),
          plan,
          seedanceProvider: renderEngine,
        }),
      });
      if (!submitRes.ok) {
        const err = (await submitRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Render request failed.");
      }
      const handle = (await submitRes.json()) as LuxRenderSubmit;

      const deadline = Date.now() + RENDER_DEADLINE_MS;
      let url = "";
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, RENDER_POLL_MS));
        const statusRes = await fetch("/api/media-analyser/ugc-ads-render-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statusUrl: handle.statusUrl, responseUrl: handle.responseUrl }),
        }).catch(() => null);
        if (!statusRes || !statusRes.ok) continue;
        const st = (await statusRes.json().catch(() => null)) as UGCRenderStatus | null;
        if (!st) continue;
        if (st.status === "failed") throw new Error(st.error || "The render failed.");
        if (st.status === "rendered" && st.videoUrl) { url = st.videoUrl; break; }
      }
      if (!url) throw new Error("The render is taking unusually long. Please try again.");
      setVideoUrl(url); setPhase("done"); setStatus("");
    } catch (e) {
      setError(friendly(e)); setPhase("error"); setStatus("");
    }
  }, [plan, productImages, modelImages, renderEngine, busy]);

  const canSubmit = (!!productUrl.trim() || productUploads.length > 0) && !!concept.trim() && !busy && !imagining;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">
          Luxe Ads
          <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">30s ultra-luxury ✦</span>
        </h3>
        <p className="text-xs text-fg-dim mt-0.5 leading-relaxed">
          Paste your product link (or upload photos) and describe the campaign. An ultra-luxury director storyboards
          a 30-second, 8–10-keyframe broadcast spot — then we render it with Seedance 2.5.
        </p>
      </div>

      {/* A — Product Link */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-fg">Product link</p>
        <input
          type="url"
          value={productUrl}
          disabled={busy}
          onChange={e => setProductUrl(e.target.value)}
          placeholder="https://www.amazon.com/dp/… · Flipkart · Myntra · or any brand product page"
          className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <p className="text-[11px] text-fg-mute leading-snug">We scrape the page for the product image and details (Apify/Firecrawl) to ground the script. If the site blocks the scraper, add product photos below instead.</p>
      </div>

      {/* A' — Product images (optional fallback when the scraper is blocked) */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-fg">Product images <span className="font-normal text-fg-mute">(optional — if the site blocks scraping)</span></p>
        <div className="border-2 border-dashed border-line rounded-xl p-4 cursor-pointer hover:border-accent/40 hover:bg-surface-2/50 transition-colors"
          onClick={() => prodFileRef.current?.click()}>
          <input ref={prodFileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { if (e.target.files?.length) addProductUploads(e.target.files); e.target.value = ""; }} />
          {productUploads.length ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5" onClick={e => e.stopPropagation()}>
              {productUploads.map(img => (
                <div key={img.id} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.dataUrl} alt={img.name} className="w-full aspect-square object-cover rounded-md border border-line bg-surface" />
                  <button type="button" onClick={() => removeProductUpload(img.id)}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    aria-label="Remove">×</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-2.5">
              <p className="text-sm font-medium text-fg-dim">Drop product photos (used to ground the keyframes)</p>
              <p className="text-[11px] text-fg-mute mt-0.5">JPG · PNG · WEBP · up to {MAX_PROD}</p>
            </div>
          )}
        </div>
      </div>

      {/* U — Concept (+ "Imagine concept" one-line assist) */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-semibold text-fg">{imagineConcept ? "Your idea" : "Concept"}</p>
          <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-fg-dim cursor-pointer select-none">
            <input type="checkbox" checked={imagineConcept} disabled={busy} onChange={e => setImagineConcept(e.target.checked)} className="accent-accent" />
            Imagine concept <span className="font-normal text-fg-mute">— not sure what to write?</span>
          </label>
        </div>
        {imagineConcept ? (
          <>
            <textarea
              value={idea}
              disabled={busy || imagining}
              onChange={e => setIdea(e.target.value)}
              rows={2}
              placeholder="Just one line — your rough thought. e.g. “some chestnut-themed shots that match the shoe”"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:border-accent disabled:opacity-50 resize-y"
            />
            <button
              type="button"
              onClick={imagineConceptNow}
              disabled={!idea.trim() || imagining || busy}
              className="self-start inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft text-accent text-xs font-semibold px-3 py-1.5 hover:bg-accent-soft/70 disabled:opacity-50 transition-colors"
            >
              {imagining ? "Imagining concept…" : concept ? "↻ Regenerate concept" : "Imagine concept →"}
            </button>
            {concept && (
              <div className="flex flex-col gap-1 mt-1">
                <p className="text-[11px] font-semibold text-fg">Imagined concept <span className="font-normal text-fg-mute">— edit or regenerate, then Generate script</span></p>
                <textarea
                  value={concept}
                  disabled={busy}
                  onChange={e => setConcept(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:border-accent disabled:opacity-50 resize-y"
                />
              </div>
            )}
          </>
        ) : (
          <textarea
            value={concept}
            disabled={busy}
            onChange={e => setConcept(e.target.value)}
            rows={3}
            placeholder="What should the ad do? e.g. “energetic unboxing, highlight the fast charging, cinematic hero shots”"
            className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:border-accent disabled:opacity-50 resize-y"
          />
        )}
      </div>

      {/* C — Model Face (optional) */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-fg">Model face <span className="font-normal text-fg-mute">(optional)</span></p>
        <div className="border-2 border-dashed border-line rounded-xl p-4 cursor-pointer hover:border-accent/40 hover:bg-surface-2/50 transition-colors"
          onClick={() => fileRef.current?.click()}>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { if (e.target.files?.length) addModelImages(e.target.files); e.target.value = ""; }} />
          {modelImages.length ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5" onClick={e => e.stopPropagation()}>
              {modelImages.map(img => (
                <div key={img.id} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.dataUrl} alt={img.name} className="w-full aspect-square object-cover rounded-md border border-line bg-surface" />
                  <button type="button" onClick={() => removeModelImage(img.id)}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    aria-label="Remove">×</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-2.5">
              <p className="text-sm font-medium text-fg-dim">Drop a face/talent photo (or leave blank to auto-cast)</p>
              <p className="text-[11px] text-fg-mute mt-0.5">JPG · PNG · WEBP · up to {MAX_MODEL}</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <ModelSelect label="Aspect ratio" options={ASPECTS.map(a => ({ id: a.key, label: a.label }))} value={aspect} onChange={v => setAspect(v as LuxAspect)} disabled={busy} />
          <p className="text-[10px] text-fg-mute mt-1">Fixed 30s · Seedance 2.5 · ultra-luxury cinematic</p>
        </div>
      </div>

      {/* Render engine: direct Seedance (ARK) vs FAL */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-fg">Render engine</p>
        <div className="inline-flex rounded-lg border border-line p-0.5 bg-surface-2/50 w-full sm:w-auto self-start">
          {(["ark", "fal"] as const).map(e => (
            <button key={e} type="button" disabled={busy} onClick={() => setRenderEngine(e)}
              className={`flex-1 sm:flex-none px-4 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 ${renderEngine === e ? "bg-accent text-bg" : "text-fg-dim hover:text-fg"}`}>
              {e === "ark" ? "Direct Seedance (ARK)" : "FAL"}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-fg-mute leading-snug">
          {renderEngine === "ark"
            ? "Renders Seedance 2.5 directly on BytePlus ARK — handles the creator reference (ARK accepts AI-generated faces; FAL 2.5 rejects them)."
            : "Renders through the FAL queue — FAL's Seedance 2.5 rejects AI-generated human faces, so use ARK when a creator/model image is present."}
        </p>
      </div>

      {/* primary action */}
      {phase !== "ready" && phase !== "done" && (
        <div className="flex gap-2">
          <button onClick={generateScript} disabled={!canSubmit}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${!canSubmit ? "bg-surface-2 text-fg-mute cursor-not-allowed" : "bg-accent text-bg hover:opacity-90"}`}>
            {phase === "fetching" ? "Scraping…" : phase === "scripting" ? "Writing script…" : "Generate script"}
          </button>
          {(productUrl || concept || productUploads.length || modelImages.length) && !busy && (
            <button onClick={resetAll} className="px-4 py-2.5 text-sm text-fg-mute hover:text-fg-dim transition-colors">Clear</button>
          )}
        </div>
      )}

      {/* status */}
      {status && (
        <div className="flex items-center gap-2 text-sm">
          {busy && <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />}
          <span className="text-fg-dim">{status}</span>
        </div>
      )}
      {error && <p className="text-[11px] text-alert leading-snug">{error}</p>}

      {/* scraped product preview */}
      {productImages.length > 0 && phase !== "input" && (
        <div className="flex items-center gap-2 flex-wrap">
          {productImages.map(img => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={img.id} src={img.dataUrl} alt={img.name} className="w-12 h-12 object-contain rounded-md border border-line bg-surface" />
          ))}
          {productTitle && <span className="text-[11px] text-fg-mute">{productTitle}</span>}
        </div>
      )}

      {/* editable script preview + render */}
      {plan && (phase === "ready" || phase === "rendering" || phase === "done") && (
        <div className="rounded-xl border border-line p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs font-semibold text-fg">Keyframes <span className="font-normal text-fg-mute">· edit the cinematic beats before rendering</span></p>
            <p className="text-[11px] text-fg-mute">{plan.duration_seconds}s · {aspect} · {plan.delivery_mode.replace(/_/g, " ").toLowerCase()}</p>
          </div>
          {plan.meta.mood && <p className="text-[11px] text-fg-dim">Mood: {plan.meta.mood}</p>}
          {plan.meta.act_structure && <p className="text-[11px] text-fg-mute">{plan.meta.act_structure}</p>}
          <ul className="space-y-1.5">
            {plan.keyframes.map(k => (
              <li key={k.keyframe_number} className="text-[11px] text-fg-dim leading-snug">
                <span className="font-medium text-fg">Keyframe {k.keyframe_number}</span> <span className="text-fg-mute">({k.time_range})</span>
                <span className="text-fg-mute"> — {k.camera_direction}</span>
                <input
                  type="text"
                  value={k.action}
                  disabled={phase !== "ready"}
                  onChange={e => editKeyframeAction(k.keyframe_number, e.target.value)}
                  className="mt-0.5 w-full rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim bg-bg focus:outline-none focus:border-accent disabled:opacity-60"
                />
                {k.color_grade && <span className="text-[10px] text-fg-mute">Grade: {k.color_grade}</span>}
              </li>
            ))}
          </ul>

          {phase === "ready" && (
            <button onClick={generateVideo} disabled={busy}
              className="w-full py-2.5 px-4 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent disabled:opacity-40">
              Generate video
            </button>
          )}

          {videoUrl && (
            <div className="max-w-sm border border-line rounded-xl overflow-hidden bg-surface shadow-sm">
              <video key={videoUrl} src={videoUrl} controls playsInline className={`w-full ${previewAspectClass(aspect)} object-contain bg-black`} />
              <div className="p-2.5 flex items-center justify-between gap-2">
                <a href={videoUrl} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:text-accent bg-accent-soft hover:bg-accent-soft px-2 py-1 rounded-md transition-colors">Open / download</a>
              </div>
            </div>
          )}

          {phase === "done" && (
            <button onClick={resetAll} className="text-xs text-fg-mute hover:text-fg-dim">Make another</button>
          )}
        </div>
      )}
    </div>
  );
}
