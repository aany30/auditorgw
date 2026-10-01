
import { useState, useRef, useCallback } from "react";
import type { GeneratedPersona, Feature } from "@/lib/media-analyser/ugc-playground/types";
import type { UGCNewUpdate } from "@/lib/media-analyser/api-types";

// ── image compression (client) ──────────────────────────────────────────────
const MAX_IMG_BYTES = 780_000;
function encodeImage(img: HTMLImageElement, maxDim: number): string {
  const enc = (dim: number, q: number) => {
    const scale = Math.min(1, dim / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", q);
  };
  let out = enc(maxDim, 0.82); for (const q of [0.72, 0.6]) { if (out.length <= MAX_IMG_BYTES) break; out = enc(maxDim, q); }
  return out;
}
function compressImage(file: File, maxDim = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); try { resolve(encodeImage(img, maxDim)); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); } };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
    img.src = url;
  });
}
/** Fetch a remote product image through the CORS-safe proxy and compress it to a data URL. */
function remoteToDataUrl(remoteUrl: string, maxDim = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { try { resolve(encodeImage(img, maxDim)); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); } };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = `/api/image-proxy?url=${encodeURIComponent(remoteUrl)}`;
  });
}

interface ScannedProduct { title: string; brand: string; description: string; bullets: string[]; price: string; imageUrls: string[]; }

const PHASES = [
  { key: "script", label: "Script" }, { key: "persona", label: "Persona" },
  { key: "voice", label: "Voice" }, { key: "video", label: "Video" },
] as const;

export function UGCPlayground() {
  // ── scan state ──
  const [productUrl, setProductUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState("");
  const [product, setProduct] = useState<ScannedProduct | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [selectedImages, setSelectedImages] = useState<string[]>([]); // remote URLs picked from gallery
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);  // data URLs (manual upload)
  const [chosenFeature, setChosenFeature] = useState(""); // label of picked feature, or "__custom__"
  const [customFeature, setCustomFeature] = useState("");
  const [timeOfDay, setTimeOfDay] = useState("18:00");
  const imgRef = useRef<HTMLInputElement>(null);

  // ── run state ──
  const [running, setRunning] = useState(false);
  const [activePhase, setActivePhase] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [script, setScript] = useState("");
  const [persona, setPersona] = useState<GeneratedPersona | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [videos, setVideos] = useState<Record<string, string>>({});

  // ── scan a product URL → details + images + features ──
  const scan = async () => {
    if (scanning || !productUrl.trim()) return;
    setScanning(true); setScanErr(""); setProduct(null); setFeatures([]); setSelectedImages([]); setChosenFeature(""); setCustomFeature("");
    try {
      const res = await fetch("/api/media-analyser/ugc-ads-fetch-product", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: productUrl.trim() }) });
      const data = (await res.json().catch(() => ({}))) as ScannedProduct & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Scan failed");
      setProduct(data);
      setSelectedImages(data.imageUrls.slice(0, 3));
      // features run in parallel — non-fatal if it fails
      try {
        const fr = await fetch("/api/media-analyser/ugc-playground-features", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: data.title, brand: data.brand, description: data.description, bullets: data.bullets }) });
        const fd = (await fr.json().catch(() => ({}))) as { features?: Feature[]; error?: string };
        if (fr.ok && fd.features?.length) { setFeatures(fd.features); setChosenFeature(fd.features[0].label); }
      } catch { /* user can still type a custom feature */ }
    } catch (e) {
      setScanErr(String(e instanceof Error ? e.message : e));
    } finally {
      setScanning(false);
    }
  };

  const addImages = useCallback(async (files: FileList) => {
    const list = Array.from(files).filter(f => f.type.startsWith("image/")).slice(0, 3);
    const added: string[] = []; for (const f of list) { try { added.push(await compressImage(f)); } catch { /* ignore */ } }
    if (added.length) setUploadedImages(p => [...p, ...added].slice(0, 3));
  }, []);

  const toggleGalleryImage = (u: string) => setSelectedImages(p => p.includes(u) ? p.filter(x => x !== u) : (p.length >= 3 ? p : [...p, u]));

  const featureLabel = chosenFeature === "__custom__" ? customFeature.trim() : chosenFeature.trim();
  const featureAngle = chosenFeature === "__custom__" ? "" : (features.find(f => f.label === chosenFeature)?.angle ?? "");
  const totalImages = selectedImages.length + uploadedImages.length;
  const canRun = !!product && !!featureLabel && totalImages >= 2 && !running;

  const generate = async () => {
    if (!canRun || running) return;
    setRunning(true); setErr(""); setLog([]); setScript(""); setPersona(null); setAudioUrl(""); setVideos({}); setActivePhase("script");
    try {
      // Convert the picked remote gallery images to data URLs (proxy handles CORS), plus any manual uploads.
      const converted: string[] = [];
      for (const u of selectedImages) { try { converted.push(await remoteToDataUrl(u)); } catch { /* skip unloadable */ } }
      const productImageDataUrls = [...converted, ...uploadedImages].slice(0, 3);
      if (productImageDataUrls.length < 2) throw new Error("Couldn't load enough product images — pick different ones or upload your own.");

      const res = await fetch("/api/media-analyser/ugc-playground-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productDescription: [product!.title, product!.description, ...product!.bullets].filter(Boolean).join(". ").slice(0, 4000), featureLabel, featureAngle, productImageDataUrls, timeOfDay }) });
      if (!res.ok || !res.body) { const e = (await res.json().catch(() => ({}))) as { error?: string }; throw new Error(e.error ?? "Request failed"); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.split("\n").find(l => l.startsWith("data: ")); if (!line) continue;
          let u: UGCNewUpdate; try { u = JSON.parse(line.slice(6)); } catch { continue; }
          if (u.phase === "error") { setErr(u.message ?? "Generation failed"); continue; }
          setActivePhase(u.phase);
          if (u.message) setLog(l => [...l, `${PHASES.find(x => x.key === u.phase)?.label ?? u.phase}: ${u.message}`]);
          if (u.script) setScript(u.script);
          if (u.persona) setPersona(u.persona);
          if (u.audioUrl) setAudioUrl(u.audioUrl);
          if (u.provider && u.videoUrl) setVideos(v => ({ ...v, [u.provider!]: u.videoUrl! }));
        }
      }
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setRunning(false); setActivePhase("");
    }
  };

  const hasVideo = Object.values(videos).some(Boolean);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">UGC Playground
          <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">experimental sandbox ✦</span>
        </h2>
        <p className="text-xs text-fg-dim mt-0.5">Paste a product link → we scrape its images + details → pick one feature to showcase → get a 15s reel where the creator explains that feature with the product shown around them.</p>
      </div>

      {/* ── 1 · scan ── */}
      <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input value={productUrl} onChange={e => setProductUrl(e.target.value)} disabled={scanning || running} placeholder="Product URL (Amazon, Flipkart, Myntra, Nykaa, Croma, or brand site)"
            onKeyDown={e => { if (e.key === "Enter") scan(); }}
            className="flex-1 min-w-[240px] text-xs rounded-md border border-line px-2 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
          <button type="button" onClick={scan} disabled={scanning || running || !productUrl.trim()} className="text-xs font-medium text-white bg-accent rounded-md px-3 py-2 disabled:opacity-40">{scanning ? "Scanning…" : "Scan product"}</button>
        </div>
        {scanErr && <p className="text-[11px] text-alert">⚠ {scanErr}</p>}
      </div>

      {/* ── 2 · product + features ── */}
      {product && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-fg">{product.title || "Product"}{product.brand ? <span className="text-fg-mute font-normal"> · {product.brand}</span> : null}{product.price ? <span className="text-fg-mute font-normal"> · {product.price}</span> : null}</p>
            {product.description && <p className="text-[11px] text-fg-dim mt-1 line-clamp-3">{product.description}</p>}
          </div>

          {/* image picker */}
          <div>
            <p className="text-[11px] font-semibold text-fg-mute mb-1.5">Product images — pick 2–3 (scraped) or upload your own</p>
            <div className="flex gap-1.5 flex-wrap">
              {product.imageUrls.map((u, i) => {
                const sel = selectedImages.includes(u); const idx = selectedImages.indexOf(u);
                return (
                  <button type="button" key={i} onClick={() => toggleGalleryImage(u)} disabled={running} className={`relative rounded-md overflow-hidden border-2 ${sel ? "border-accent" : "border-line"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/image-proxy?url=${encodeURIComponent(u)}`} alt="" className="w-16 h-16 object-cover" />
                    {sel && <span className="absolute top-0 right-0 w-4 h-4 rounded-bl bg-accent text-white text-[10px] flex items-center justify-center">{idx + 1}</span>}
                  </button>
                );
              })}
              {uploadedImages.map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <div key={`up${i}`} className="relative rounded-md overflow-hidden border-2 border-accent-2"><img src={u} alt="" className="w-16 h-16 object-cover" />{!running && <button onClick={() => setUploadedImages(p => p.filter((_, j) => j !== i))} className="absolute top-0 right-0 w-4 h-4 rounded-full bg-black/60 text-white text-[10px]">×</button>}</div>
              ))}
              <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { if (e.target.files) addImages(e.target.files); e.target.value = ""; }} />
              <button type="button" onClick={() => imgRef.current?.click()} disabled={running} className="w-16 h-16 rounded-md border-2 border-dashed border-line text-[10px] text-fg-mute disabled:opacity-40">+ upload</button>
            </div>
            {totalImages < 2 && <p className="text-[11px] text-fg-mute mt-1">Select at least 2 images so the product is clearly shown.</p>}
          </div>

          {/* feature picker */}
          <div>
            <p className="text-[11px] font-semibold text-fg-mute mb-1.5">Which feature should the creator explain?</p>
            <div className="space-y-1.5">
              {features.map((f, i) => (
                <label key={i} className={`flex items-start gap-2 text-xs rounded-md border p-2 cursor-pointer ${chosenFeature === f.label ? "border-accent bg-accent-soft/40" : "border-line"}`}>
                  <input type="radio" name="feature" checked={chosenFeature === f.label} onChange={() => setChosenFeature(f.label)} disabled={running} className="mt-0.5 accent-[var(--accent,#6d28d9)]" />
                  <span><span className="font-medium text-fg">{f.label}</span>{f.angle ? <span className="text-fg-dim"> — {f.angle}</span> : null}</span>
                </label>
              ))}
              <label className={`flex items-center gap-2 text-xs rounded-md border p-2 cursor-pointer ${chosenFeature === "__custom__" ? "border-accent bg-accent-soft/40" : "border-line"}`}>
                <input type="radio" name="feature" checked={chosenFeature === "__custom__"} onChange={() => setChosenFeature("__custom__")} disabled={running} className="accent-[var(--accent,#6d28d9)]" />
                <input value={customFeature} onChange={e => { setCustomFeature(e.target.value); setChosenFeature("__custom__"); }} onFocus={() => setChosenFeature("__custom__")} disabled={running} placeholder="Or type your own feature / use-case…"
                  className="flex-1 min-w-0 text-xs bg-transparent focus:outline-none" />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1 text-[11px] text-fg-mute">Time of day <input type="time" value={timeOfDay} onChange={e => setTimeOfDay(e.target.value)} disabled={running} className="rounded-md border border-line px-2 py-1" /></label>
            <button onClick={generate} disabled={!canRun} className={`flex-1 min-w-[200px] py-2.5 rounded-lg text-sm font-medium transition-colors ${!canRun ? "bg-surface-2 text-fg-mute cursor-not-allowed" : "bg-accent text-white hover:opacity-90"}`}>
              {running ? "Generating reel…" : "Generate reel"}
            </button>
          </div>
        </div>
      )}

      {/* ── progress ── */}
      {(running || log.length > 0) && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
          <div className="flex flex-wrap gap-1.5">{PHASES.map(p => {
            const done = log.some(l => l.startsWith(p.label)) && activePhase !== p.key;
            const active = activePhase === p.key;
            return <span key={p.key} className={`text-[10px] px-2 py-0.5 rounded-full border ${active ? "border-accent bg-accent-soft text-accent" : done ? "border-accent-2/40 bg-accent-2-soft text-accent-2" : "border-line text-fg-mute"}`}>{active && <span className="inline-block w-2 h-2 mr-1 border border-accent border-t-transparent rounded-full animate-spin align-middle" />}{p.label}</span>;
          })}</div>
          <pre className="text-[11px] leading-relaxed text-fg-dim whitespace-pre-wrap max-h-40 overflow-auto">{log.join("\n")}</pre>
        </div>
      )}

      {err && <p className="text-xs text-alert">⚠ {err}</p>}

      {/* ── output ── */}
      {(hasVideo || persona || script) && (
        <div className="rounded-xl border border-accent/30 bg-accent-soft/30 p-4 space-y-4">
          <p className="text-sm font-semibold text-fg">Output{featureLabel ? <span className="text-fg-mute font-normal"> · {featureLabel}</span> : null}</p>

          {hasVideo && videos.seedance && (
            <div className="max-w-xs">
              <div className="rounded-lg border border-line overflow-hidden bg-surface">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-mute px-2 py-1">Feature reel</p>
                <video src={videos.seedance} controls playsInline className="w-full aspect-[9/16] object-cover bg-black" />
                <a href={videos.seedance} target="_blank" rel="noreferrer" className="block text-[11px] text-accent px-2 py-1 hover:underline">Open / download</a>
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-[auto_1fr] gap-3 items-start">
            {persona?.imageDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={persona.imageDataUrl} alt={persona.name} className="w-24 aspect-[3/4] object-cover rounded-lg border border-line" />
            )}
            <div className="space-y-2 text-xs min-w-0">
              {persona && <p><span className="font-semibold text-fg">Creator:</span> <span className="text-fg-dim">{persona.name}{typeof persona.qcScore === "number" ? ` · QC ${persona.qcScore}` : ""}</span></p>}
              {script && <p><span className="font-semibold text-fg">Script:</span> <span className="text-fg-dim italic">“{script}”</span></p>}
              {audioUrl && <audio src={audioUrl} controls className="w-full h-8" />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
