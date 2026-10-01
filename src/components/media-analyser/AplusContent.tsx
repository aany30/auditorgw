
import { useRef, useState, useCallback } from "react";
import type { AplusUpdate } from "@/lib/media-analyser/api-types";
import type { AplusModule } from "@/lib/media-analyser/aplus";
import type { AplusScrapeResult } from "@/lib/media-analyser/aplus-scrape";
import ModelSelect from "@/components/media-analyser/ModelSelect";
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL_ID } from "@/lib/media-analyser/generation-models";
import { makeThumbs } from "@/lib/media-analyser/image-thumb";

type InputMode = "link" | "upload" | "urls";
type GenPhase = "idle" | "analyzing" | "generating" | "done" | "error";

interface UploadedImage {
  id: string;
  dataUrl: string;
  name: string;
}

interface ModuleResult {
  index: number;
  status: "pending" | "generating" | "done" | "error";
  module: AplusModule;
  imageUrl?: string;
  error?: string;
}

interface PlanPreview {
  creativeConcept: string;
  pageStrategy: string;
  competitorBenchmark: string;
  palette: { name: string; hex: string }[];
}

const MAX_IMAGES = 6;

// ── Sample (the Samsonite Staren data pack) — lets the tab be tested instantly ────
const SAMPLE = {
  title:
    "SAMSONITE 4 Spinner Wheels Trolley Bag Suitcase for Travel | Staren 55 Cms Polycarbonate Hardsided Small Cabin Luggage Trolley Bag, Matte Green",
  brand: "Samsonite",
  price: "₹10,880.00",
  rating: "4.2 (138 ratings)",
  attributes: [
    "Wheel Type: Spinner",
    "Number of Wheels: 8",
    "Lock Type: Combination Lock",
    "Special Features: TSA Lock, Wheel",
    "Capacity: 45 litres",
    "Handle Type: Telescopic Extendable Handle",
    "Size: Cabin | 55 cm | Small",
    "Item Dimensions: 37L x 23W x 55H cm",
    "Item Weight: 2800 Grams",
    "Outer Material: Polycarbonate (PC)",
    "Shell Type: Hard",
    "Colour: Matte Green",
    "Warranty: 10 Years International Warranty",
  ].join("\n"),
  painPoints: [
    "Quality — poor build quality leading to product failure after minimal use (20 mentions)",
    "Wheels breaking or malfunctioning after short usage (10 mentions)",
    "Zippers breaking or malfunctioning (7 mentions)",
    "Handle breaking or coming off during use (6 mentions)",
    "High price point not justified by product quality (5 mentions)",
    "Product arriving damaged or defective upon delivery (5 mentions)",
  ].join("\n"),
  keywords: "polycarbonate suitcase, tsa lock, cabin luggage, travel suitcase, luggage trolley bag",
  imageUrls: [
    "https://m.media-amazon.com/images/I/81RcJb5PzCL.jpg",
    "https://m.media-amazon.com/images/I/717hKq707IL.jpg",
    "https://m.media-amazon.com/images/I/71RNABDjjsL.jpg",
    "https://m.media-amazon.com/images/I/81POPW5qXAL.jpg",
    "https://m.media-amazon.com/images/I/61UxUTe2kCL.jpg",
    "https://m.media-amazon.com/images/I/71W-wspcWvL.jpg",
  ].join("\n"),
};

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

function aspectClass(ar: string): string {
  if (ar === "9:16") return "aspect-[9/16]";
  if (ar === "4:5") return "aspect-[4/5]";
  if (ar === "1:1") return "aspect-square";
  if (ar === "21:9") return "aspect-[21/9]";
  return "aspect-video"; // 16:9 default
}

export function AplusContent() {
  const [inputMode, setInputMode] = useState<InputMode>("link");
  const [uploaded, setUploaded] = useState<UploadedImage[]>([]);
  const [imageUrlsText, setImageUrlsText] = useState("");
  const [productLink, setProductLink] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState("");

  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [price, setPrice] = useState("");
  const [rating, setRating] = useState("");
  const [attributesText, setAttributesText] = useState("");
  const [painPointsText, setPainPointsText] = useState("");
  const [keywords, setKeywords] = useState("");
  const [moduleCount, setModuleCount] = useState(6);
  // Default to a single uniform ratio so every module comes out the same size.
  // "Auto (per module)" is opt-in for those who want the planner to vary it.
  const [aspectRatio, setAspectRatio] = useState<string>("21:9");
  const [imageModel, setImageModel] = useState<string>(DEFAULT_IMAGE_MODEL_ID);
  // "standard" | "seamless" | "elements" (seamless + connector motifs)
  const [pageStyle, setPageStyle] = useState<"standard" | "seamless" | "elements">("standard");

  const [phase, setPhase] = useState<GenPhase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [plan, setPlan] = useState<PlanPreview | null>(null);
  const [results, setResults] = useState<ModuleResult[]>([]);

  const uploadRef = useRef<HTMLInputElement>(null);
  const isRunning = phase === "analyzing" || phase === "generating";

  const resetResults = () => { setPlan(null); setResults([]); if (phase !== "idle") setPhase("idle"); setStatusMsg(""); };

  const addImages = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    const slots = MAX_IMAGES - uploaded.length;
    if (slots <= 0) return;
    const added: UploadedImage[] = [];
    for (const file of list.slice(0, slots)) {
      try { added.push({ id: crypto.randomUUID(), dataUrl: await compressImage(file), name: file.name }); } catch { /* ignore */ }
    }
    if (added.length) { setUploaded((p) => [...p, ...added]); resetResults(); }
  }, [uploaded.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSample = () => {
    setInputMode("urls");
    setImageUrlsText(SAMPLE.imageUrls);
    setTitle(SAMPLE.title);
    setBrand(SAMPLE.brand);
    setPrice(SAMPLE.price);
    setRating(SAMPLE.rating);
    setAttributesText(SAMPLE.attributes);
    setPainPointsText(SAMPLE.painPoints);
    setKeywords(SAMPLE.keywords);
    resetResults();
  };

  // Paste a product link → scrape photos + verified facts, then fill the form (switches to
  // URL mode so the scraped URLs + facts are visible for review before Build).
  const fetchFromLink = async () => {
    if (!productLink.trim() || scraping || isRunning) return;
    setScraping(true);
    setScrapeMsg("Scraping product page for photos and facts…");
    resetResults();
    try {
      const res = await fetch("/api/media-analyser/aplus-scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: productLink.trim() }),
      });
      const data = (await res.json()) as Partial<AplusScrapeResult> & { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Scrape failed");

      const imgs = data.imageUrls ?? [];
      setImageUrlsText(imgs.join("\n"));
      setTitle(data.title ?? "");
      setBrand(data.brand ?? "");
      setPrice(data.price ?? "");
      setRating(data.rating ?? "");
      setAttributesText((data.attributes ?? []).map((a) => `${a.label}: ${a.value}`).join("\n"));
      setPainPointsText((data.painPoints ?? []).join("\n"));
      if (data.keywords?.length) setKeywords(data.keywords.join(", "));
      setInputMode("urls");
      setScrapeMsg(`Scraped ${imgs.length} photo${imgs.length !== 1 ? "s" : ""} + facts. Review below, then Build.`);
    } catch (e) {
      setScrapeMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setScraping(false);
    }
  };

  const urlList = () => imageUrlsText.split(/\s*\n\s*/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s)).slice(0, MAX_IMAGES);
  const hasImages = inputMode === "upload" ? uploaded.length > 0 : urlList().length > 0;

  const parseAttributes = () =>
    attributesText.split(/\n+/).map((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) return null;
      return { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    }).filter((a): a is { label: string; value: string } => Boolean(a && a.label && a.value));

  const handleGenerate = async () => {
    if (isRunning || !hasImages) return;
    setPhase("analyzing");
    setStatusMsg("Analysing product photos and planning the A+ argument…");
    setPlan(null);
    setResults([]);

    const payload = {
      ...(inputMode === "upload"
        ? { productImageDataUrls: uploaded.map((u) => u.dataUrl) }
        : { productImageUrls: urlList() }),
      title: title.trim() || undefined,
      brand: brand.trim() || undefined,
      price: price.trim() || undefined,
      rating: rating.trim() || undefined,
      attributes: parseAttributes(),
      painPoints: painPointsText.split(/\n+/).map((s) => s.trim()).filter(Boolean),
      keywords: keywords.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean),
      moduleCount,
      aspectRatio,
      imageModel,
      seamless: pageStyle !== "standard",
      connectorMotifs: pageStyle === "elements",
    };

    const accumulated: ModuleResult[] = [];
    try {
      const res = await fetch("/api/media-analyser/aplus-content", {
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
            const u = JSON.parse(line.slice(6)) as AplusUpdate;
            if (u.message) setStatusMsg(u.message);
            if (u.phase === "analyzing") {
              setPhase("analyzing");
            } else if (u.phase === "plan_ready") {
              setPlan({
                creativeConcept: u.creativeConcept ?? "",
                pageStrategy: u.pageStrategy ?? "",
                competitorBenchmark: u.competitorBenchmark ?? "",
                palette: u.palette ?? [],
              });
              setResults((u.modules ?? []).map((m, i) => ({ index: i, status: "pending", module: m })));
              setPhase("generating");
            } else if (u.phase === "generating" && u.index != null) {
              setResults((prev) => prev.map((r) => r.index === u.index ? { ...r, status: "generating", module: u.module ?? r.module } : r));
            } else if (u.phase === "result" && u.index != null && u.module) {
              const r: ModuleResult = { index: u.index, status: "done", module: u.module, imageUrl: u.imageUrl };
              accumulated.push(r);
              setResults((prev) => prev.map((existing) => existing.index === u.index ? r : existing));
            } else if (u.phase === "error" && u.index != null) {
              setResults((prev) => prev.map((r) => r.index === u.index ? { ...r, status: "error", error: u.message } : r));
            } else if (u.phase === "done") {
              setPhase("done");
            } else if (u.phase === "error" && u.index == null) {
              setPhase("error");
              setResults((prev) => prev.map((r) => r.status === "pending" ? { ...r, status: "error", error: u.message ?? "Failed" } : r));
            }
          } catch { /* skip */ }
        }
      }

      const rendered = accumulated.filter((r) => r.imageUrl);
      if (rendered.length) {
        const referenceThumbnails = await makeThumbs(uploaded.map((u) => u.dataUrl));
        fetch("/api/media-analyser/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "aplus_content",
            product_name: `A+ content · ${brand.trim() || title.trim().slice(0, 40) || "product"}`,
            result_count: rendered.length,
            thumbnail_url: rendered[0]?.imageUrl ?? null,
            results: accumulated.map((r) => ({ order: r.module.order, title: r.module.title, headline: r.module.headline, imageUrl: r.imageUrl })),
            input: { title, brand, imageModel, moduleCount, referenceThumbnails },
          }),
        }).catch(() => {});
      }
    } catch (e) {
      setPhase("error");
      setStatusMsg(String(e instanceof Error ? e.message : e));
    }
  };

  const reset = () => {
    setUploaded([]); setImageUrlsText(""); setProductLink(""); setScrapeMsg(""); setTitle(""); setBrand(""); setPrice(""); setRating("");
    setAttributesText(""); setPainPointsText(""); setKeywords(""); setModuleCount(6); setAspectRatio("21:9");
    resetResults();
  };

  const download = async (url: string, label: string) => {
    try {
      const blob = await fetch(url).then((r) => r.blob());
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `aplus-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.jpg`; a.click(); URL.revokeObjectURL(a.href);
    } catch { window.open(url, "_blank"); }
  };

  const fieldCls = "w-full text-sm border border-line rounded-lg px-3 py-2 outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/40 disabled:opacity-50 bg-surface";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">
            A+ Content
            <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">module agent ✦</span>
          </h3>
          <p className="text-xs text-fg-dim mt-0.5 leading-relaxed max-w-2xl">
            Upload your product photos (and any verified facts + review pain points) — we plan an ordered
            Amazon A+ page where every headline traces to evidence, then render each module. The comparison
            module stays a native table, and copy is never invented.
          </p>
        </div>
        <button onClick={loadSample} disabled={isRunning}
          className="text-[11px] font-medium text-accent hover:underline disabled:opacity-40 shrink-0">
          Load sample (Samsonite)
        </button>
      </div>

      {/* Image input mode toggle */}
      <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line max-w-md">
        {(["link", "upload", "urls"] as InputMode[]).map((m) => (
          <button key={m} onClick={() => { setInputMode(m); resetResults(); }} disabled={isRunning || scraping}
            className={`flex-1 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${inputMode === m ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
            {m === "link" ? "Product link" : m === "upload" ? "Upload photos" : "Image URLs"}
          </button>
        ))}
      </div>

      {/* Product link — auto-scrape photos + facts */}
      {inputMode === "link" && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-fg-dim">
            Paste a product link — we scrape the photos and facts automatically
            <span className="ml-1.5 text-[10px] text-fg-mute">(Amazon, Flipkart, Myntra, Nykaa, Croma)</span>
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              value={productLink}
              onChange={(e) => setProductLink(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchFromLink()}
              disabled={scraping || isRunning}
              placeholder="https://www.amazon.in/dp/B0BYJRPQ2L"
              className={fieldCls + " flex-1"}
            />
            <button
              onClick={fetchFromLink}
              disabled={!productLink.trim() || scraping || isRunning}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0 ${!productLink.trim() || scraping || isRunning ? "bg-surface-2 text-fg-mute cursor-not-allowed" : "bg-accent text-bg hover:opacity-90"}`}
            >
              {scraping ? (
                <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Scraping…</span>
              ) : "Scrape product"}
            </button>
          </div>
          {scrapeMsg && (
            <p className={`text-[11px] ${/fail|error|could|unsupported|not configured|no images|couldn/i.test(scrapeMsg) ? "text-alert" : "text-fg-dim"}`}>{scrapeMsg}</p>
          )}
        </div>
      )}

      {/* Upload */}
      {inputMode === "upload" && (
        <div
          className={`border-2 border-dashed rounded-xl p-4 cursor-pointer transition-colors ${uploaded.length ? "border-line bg-surface-2" : "border-line hover:border-accent/40 hover:bg-accent-soft/30"}`}
          onClick={() => uploadRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) addImages(e.dataTransfer.files); }}
        >
          <input ref={uploadRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { if (e.target.files?.length) addImages(e.target.files); e.target.value = ""; }} />
          {uploaded.length ? (
            <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {uploaded.map((img) => (
                  <div key={img.id} className="relative group aspect-square">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.dataUrl} alt="" className="w-full h-full object-contain rounded-md border border-line bg-surface" />
                    <button type="button" onClick={() => { setUploaded((p) => p.filter((i) => i.id !== img.id)); resetResults(); }}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">×</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-fg-mute">{uploaded.length}/{MAX_IMAGES}</p>
                {uploaded.length < MAX_IMAGES && (
                  <button type="button" onClick={() => uploadRef.current?.click()} className="text-[11px] font-medium text-accent hover:text-accent">+ Add more</button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-5">
              <p className="text-sm font-medium text-fg-dim">Drop product photos here</p>
              <p className="text-[11px] text-fg-mute mt-0.5">JPG · PNG · WEBP · up to {MAX_IMAGES} — use several angles for richer modules</p>
            </div>
          )}
        </div>
      )}

      {/* Image URLs */}
      {inputMode === "urls" && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-fg-dim">Product image URLs — one per line (up to {MAX_IMAGES})</p>
          <textarea value={imageUrlsText} onChange={(e) => { setImageUrlsText(e.target.value); resetResults(); }} disabled={isRunning}
            rows={4} placeholder={"https://…/photo-1.jpg\nhttps://…/photo-2.jpg"} className={`${fieldCls} font-mono text-xs`} />
          {urlList().length > 0 && <p className="text-[11px] text-fg-mute">{urlList().length} valid URL{urlList().length !== 1 ? "s" : ""} detected</p>}
        </div>
      )}

      {/* Verified facts */}
      <div className="space-y-3 rounded-xl border border-line p-4 bg-surface">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-fg-dim">Verified facts</p>
          <span className="text-[9px] font-semibold text-fg-mute bg-surface-2 px-1.5 py-0.5 rounded">optional — but the only claims A+ may make</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={isRunning} placeholder="Product title" className={fieldCls + " sm:col-span-2"} />
          <input value={brand} onChange={(e) => setBrand(e.target.value)} disabled={isRunning} placeholder="Brand" className={fieldCls} />
          <div className="grid grid-cols-2 gap-2.5">
            <input value={price} onChange={(e) => setPrice(e.target.value)} disabled={isRunning} placeholder="Price" className={fieldCls} />
            <input value={rating} onChange={(e) => setRating(e.target.value)} disabled={isRunning} placeholder="Rating" className={fieldCls} />
          </div>
        </div>
        <div>
          <p className="text-[11px] text-fg-mute mb-1">Attributes — one per line, <span className="font-mono">Label: Value</span></p>
          <textarea value={attributesText} onChange={(e) => setAttributesText(e.target.value)} disabled={isRunning} rows={4}
            placeholder={"Wheel Type: Spinner\nCapacity: 45 litres\nOuter Material: Polycarbonate"} className={`${fieldCls} font-mono text-xs`} />
        </div>
        <div>
          <p className="text-[11px] text-fg-mute mb-1">Customer pain points / wants — one per line</p>
          <textarea value={painPointsText} onChange={(e) => setPainPointsText(e.target.value)} disabled={isRunning} rows={3}
            placeholder={"Wheels breaking after short usage\nHandle breaking on first use"} className={`${fieldCls} text-xs`} />
        </div>
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} disabled={isRunning} placeholder="High-value keywords (comma separated)" className={fieldCls} />
      </div>

      {/* Settings row */}
      <div className="flex items-end gap-4 flex-wrap">
        <ModelSelect label="Image model" options={IMAGE_MODELS.map((m) => ({ id: m.id, label: m.label }))} value={imageModel} onChange={setImageModel} disabled={isRunning} />
        <ModelSelect
          label="Aspect ratio"
          options={[
            { id: "21:9", label: "21:9 — cinematic ultrawide" },
            { id: "16:9", label: "16:9 — wide banner" },
            { id: "4:5", label: "4:5 — portrait" },
            { id: "1:1", label: "1:1 — square" },
            { id: "9:16", label: "9:16 — vertical" },
            { id: "auto", label: "Auto (per module)" },
          ]}
          value={aspectRatio}
          onChange={setAspectRatio}
          disabled={isRunning}
        />
        <ModelSelect label="Modules" options={[4, 5, 6, 7, 8].map((n) => ({ id: String(n), label: `${n} modules` }))} value={String(moduleCount)} onChange={(v) => setModuleCount(Number(v))} disabled={isRunning} />
      </div>

      {/* Page style */}
      <div>
        <p className="text-xs font-medium text-fg-dim mb-1.5">Page style</p>
        <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line max-w-lg">
          {([
            ["standard", "Standard"],
            ["seamless", "Seamless"],
            ["elements", "Seamless + Elements"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setPageStyle(id)} disabled={isRunning}
              className={`flex-1 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${pageStyle === id ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-fg-mute mt-1 leading-relaxed">
          {pageStyle === "standard"
            ? "Independent modules — each is its own self-contained banner."
            : pageStyle === "seamless"
              ? "Every module is an edge-to-edge panel with locked, matching top/bottom background colours, so Amazon stitches them into one continuous scrolling page (no seams). Use one uniform aspect ratio."
              : "Seamless page PLUS brand-appropriate decorative motifs (foam, leaves, petals, droplets) that scatter across the seams so panels read as one continuous scene."}
        </p>
      </div>

      {/* Generate / Clear */}
      <div className="flex gap-2">
        <button onClick={handleGenerate} disabled={!hasImages || isRunning}
          className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${hasImages && !isRunning ? "bg-gradient-to-r from-accent to-accent text-white shadow-sm hover:opacity-90" : "bg-surface-2 text-fg-mute cursor-not-allowed"}`}>
          {phase === "analyzing" ? "Planning A+ argument…" : phase === "generating" ? "Rendering modules…" : `Build A+ content — ${moduleCount} modules`}
        </button>
        {(hasImages || results.length > 0) && !isRunning && (
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

      {/* Plan preview */}
      {plan && (
        <div className="rounded-xl border border-accent/30 bg-accent-soft/30 p-4 space-y-2">
          <p className="text-xs font-semibold text-accent">A+ page strategy</p>
          {plan.creativeConcept && <p className="text-xs text-fg leading-relaxed"><span className="text-fg-mute">Concept — </span>{plan.creativeConcept}</p>}
          {plan.pageStrategy && <p className="text-xs text-fg leading-relaxed">{plan.pageStrategy}</p>}
          {plan.competitorBenchmark && <p className="text-[11px] text-fg-dim italic leading-relaxed">{plan.competitorBenchmark}</p>}
          {plan.palette.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-[10px] text-fg-mute">Brand palette</span>
              {plan.palette.slice(0, 8).map((c) => (
                <div key={c.hex} className="w-5 h-5 rounded-full border-2 border-white shadow-sm shrink-0" style={{ backgroundColor: c.hex }} title={`${c.name} ${c.hex}`} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Module results — one card per module, in reading order (the argument) */}
      {results.length > 0 && (
        <div className="space-y-4">
          {results.map((r) => (
            <ModuleCard key={r.index} r={r} onDownload={download} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModuleCard({ r, onDownload }: { r: ModuleResult; onDownload: (url: string, label: string) => void }) {
  const m = r.module;
  const isComparison = m.kind === "comparison";
  return (
    <div className="border border-line rounded-xl overflow-hidden bg-surface shadow-sm">
      {/* Module header — the copy, always shown (traces to evidence) */}
      <div className="p-4 border-b border-line space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">Module {m.order}</span>
          <span className="text-[10px] font-medium text-fg-mute uppercase tracking-wide">{m.kind.replace(/_/g, " ")}</span>
          <span className="text-xs font-semibold text-fg">{m.title}</span>
        </div>
        {m.headline && <p className="text-base font-display font-semibold text-fg">{m.headline}</p>}
        {m.body && <p className="text-xs text-fg-dim leading-relaxed">{m.body}</p>}
        {m.proofPoints.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 pt-0.5">
            {m.proofPoints.map((p, i) => (
              <li key={i} className="text-[11px] text-fg-dim bg-surface-2 border border-line rounded-full px-2 py-0.5">{p}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Body — comparison shows the rendered graphic AND the native table; others show the image */}
      {isComparison ? (
        <>
          {(r.imageUrl || r.status === "generating" || r.status === "pending") && (
            <div className={`relative bg-surface-2 flex items-center justify-center w-full ${aspectClass(m.aspect)}`}>
              {r.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.imageUrl} alt={m.headline} className="w-full h-full object-cover absolute inset-0" loading="lazy" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-fg-mute">
                  <span className="w-5 h-5 border-2 border-accent/40 border-t-transparent rounded-full animate-spin" />
                  <span className="text-[10px]">{r.status === "generating" ? "Rendering…" : "Queued…"}</span>
                </div>
              )}
            </div>
          )}
        <div className="p-4 overflow-x-auto">
          {m.comparison?.rows.length ? (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left">
                  {(m.comparison.columns.length ? m.comparison.columns : ["Attribute", "This product", "Typical alternatives"]).map((c, i) => (
                    <th key={i} className={`py-2 px-3 border-b border-line font-semibold ${i === 1 ? "text-accent" : "text-fg-dim"}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.comparison.rows.map((row, i) => (
                  <tr key={i} className="align-top">
                    <td className="py-2 px-3 border-b border-line font-medium text-fg">{row.attribute}</td>
                    <td className="py-2 px-3 border-b border-line text-accent bg-accent-soft/40">{row.ours}</td>
                    <td className="py-2 px-3 border-b border-line text-fg-dim">{row.alternatives}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[11px] text-fg-mute">Comparison table pending…</p>
          )}
          <p className="text-[10px] text-fg-mute mt-2">Rendered as a graphic above, and kept as a native table here — paste these rows into a Seller Central comparison module (sorting + editing survive; a rendered picture would lose them).</p>
        </div>
        </>
      ) : (
        <div className={`relative bg-surface-2 flex items-center justify-center w-full ${aspectClass(m.aspect)}`}>
          {r.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.imageUrl} alt={m.headline} className="w-full h-full object-cover absolute inset-0" loading="lazy" />
          ) : r.status === "error" ? (
            <p className="text-[11px] text-alert text-center p-4 leading-snug">{r.error ?? "Render failed"}</p>
          ) : (
            <div className="flex flex-col items-center gap-2 text-fg-mute">
              <span className="w-5 h-5 border-2 border-accent/40 border-t-transparent rounded-full animate-spin" />
              <span className="text-[10px]">{r.status === "generating" ? "Rendering…" : "Queued…"}</span>
            </div>
          )}
        </div>
      )}

      {/* Footer — evidence + download */}
      <div className="p-3 flex items-center justify-between gap-3 flex-wrap">
        {m.evidence.length > 0 && (
          <p className="text-[10px] text-fg-mute leading-snug"><span className="font-semibold">Evidence:</span> {m.evidence.join(" · ")}</p>
        )}
        {r.imageUrl && (
          <button onClick={() => onDownload(r.imageUrl!, `${m.order}-${m.title}`)}
            className="text-[11px] text-accent hover:text-accent bg-accent-soft hover:bg-accent-soft px-2 py-1 rounded-md transition-colors shrink-0 ml-auto">
            Download image
          </button>
        )}
      </div>
    </div>
  );
}
