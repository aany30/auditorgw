
import { useRef, useState, useCallback } from "react";
import type { UGCRenderSubmit } from "@/lib/media-analyser/api-types";
import type { UGCRenderStatus } from "@/lib/media-analyser/api-types";
import type { UGCQcResponse } from "@/lib/media-analyser/api-types";
import type { UGCDirectorPlan, Shot, QcResult } from "@/lib/media-analyser/ugc/types";

// Coarse client-side render phases (the render is decoupled across 3 endpoints).
type RenderPhase = "" | "preparing" | "rendering" | "qc";
import ModelSelect from "@/components/media-analyser/ModelSelect";
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL_ID } from "@/lib/media-analyser/generation-models";
import { makeThumbs } from "@/lib/media-analyser/image-thumb";
import type { UGCFetchProductResponse } from "@/lib/media-analyser/api-types";
import type { UGCWorldResponse } from "@/lib/media-analyser/api-types";
import { WORLD_STYLE_OPTIONS, WORLD_TIME_OPTIONS, WORLD_LIGHTING_OPTIONS, worldSummary } from "@/lib/media-analyser/ugc/world-prompt";
import CohortCampaign from "@/components/media-analyser/ugc/CohortCampaign";
import PersonaBuilder from "@/components/media-analyser/ugc/PersonaBuilder";

// "quick" = images + brief only (the original flow). "descriptive" = also paste a
// product link to fetch details that ground the script.
type InputMode = "quick" | "descriptive" | "cohorts";
// Optional backdrop: upload a background OR generate a world from style/time/lighting.
type WorldMode = "upload" | "create";

type FalAspect = "9:16" | "1:1" | "4:5" | "16:9";
type Stage = "input" | "scripting" | "review" | "rendering" | "done" | "error";

interface UploadedImage {
  id: string;
  dataUrl: string;
  name: string;
}

interface FinalReel {
  attempt: number;
  videoUrl: string;
  durationSeconds?: number;
  /** set once QC has run for this take (undefined while still quality-checking) */
  qcDone?: boolean;
  qcPass?: boolean;
  qcSummary?: string;
  qcResult?: QcResult;
}

const MAX_PROD = 3;
// ≤2 talent shots of the same person. More than 2 identity references makes Seedance
// drift/invent the creator's face — fewer, consistent refs lock identity far better.
const MAX_MODEL = 2;
// Product + model images share the upload budget; never send more than this many.
const COMBINED_MAX = 5;

const ASPECTS: { key: FalAspect; label: string }[] = [
  { key: "9:16", label: "Vertical 9:16" },
];

// Voiceover language / accent for the spoken dialogue. id = the phrase fed to the
// Director; "" lets the Director choose. The Director writes the dialogue in this
// language/style and sets voice_characteristics to match, so Seedance speaks it.
const LANGUAGE_OPTIONS: { id: string; label: string }[] = [
  { id: "", label: "Default (Director decides)" },
  { id: "neutral English", label: "English (neutral)" },
  { id: "American-accented English", label: "English — American" },
  { id: "British-accented English", label: "English — British" },
  { id: "Indian-accented English", label: "English — Indian" },
  { id: "Australian-accented English", label: "English — Australian" },
  { id: "Hindi", label: "Hindi" },
  { id: "Hinglish — natural Hindi-English code-mixing", label: "Hinglish" },
  { id: "Punjabi-accented English", label: "English — Punjabi" },
  { id: "Tamil-accented English", label: "English — Tamil" },
  { id: "Spanish", label: "Spanish" },
  { id: "Arabic", label: "Arabic" },
];

// Video model the ad renders on (all via FAL). Seedance preserves the full pipeline
// (multi-reference + voiceover + 15s); Veo/Kling are image-to-video (best-effort).
// "Seedance 4K" = Seedance at 1080p (FAL caps Seedance at 1080p). "Kling 3" maps to
// FAL's latest Kling. Each option resolves to a registry videoModel id + resolution.
const VIDEO_OPTIONS: { id: string; label: string; videoModel: string; resolution?: string }[] = [
  { id: "seedance-2-5", label: "Seedance 2.5", videoModel: "seedance-2-5", resolution: "720p" },
  { id: "seedance-2", label: "Seedance 2.0", videoModel: "seedance-2", resolution: "720p" },
  { id: "seedance-4k", label: "Seedance 4K", videoModel: "seedance-2", resolution: "1080p" },
  { id: "veo-3", label: "Veo 3", videoModel: "veo-3", resolution: "1080p" },
  { id: "kling-3", label: "Kling 3", videoModel: "kling-2" },
];

// Vercel caps a serverless request body at ~4.5 MB. We send up to 5 reference
// images (product + model, combined) as base64 data URLs in one JSON body, so
// each image must stay well under that. Target ≤ ~780 KB encoded per image
// (base64 adds ~33%) by stepping the JPEG quality (and, if still too big, the
// dimensions) down until it fits — otherwise a large photo silently 413s at the
// edge and the browser surfaces it as "TypeError: network error". Worst case
// 5 × 780 KB ≈ 3.9 MB, comfortably under the 4.5 MB limit with JSON overhead.
const MAX_IMAGE_BYTES = 780_000;

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
      // base64 length ≈ bytes * 4/3; compare on the encoded string length directly.
      try {
        let dim = maxDim;
        let out = encodeAt(dim, 0.85);
        // Step quality down, then dimensions, until the payload is safely small.
        for (const q of [0.75, 0.65, 0.55]) {
          if (out.length <= MAX_IMAGE_BYTES) break;
          out = encodeAt(dim, q);
        }
        while (out.length > MAX_IMAGE_BYTES && dim > 640) {
          dim = Math.round(dim * 0.8);
          out = encodeAt(dim, 0.6);
        }
        resolve(out);
      } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
    img.src = url;
  });
}

// A bare fetch "TypeError: network error" / "Failed to fetch" usually means the
// request never reached the server — most often the upload was too large and the
// edge rejected it. Give a human hint instead of the raw TypeError.
function friendlyError(e: unknown): string {
  const msg = String(e instanceof Error ? e.message : e);
  if (/network error|failed to fetch|load failed/i.test(msg)) {
    return "Network error reaching the server — this usually means the uploaded images were too large or the connection dropped. Try smaller/fewer photos, or retry.";
  }
  return msg;
}

export function UGCAds() {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [modelImages, setModelImages] = useState<UploadedImage[]>([]);
  // Bumped by resetAll to remount PersonaBuilder (clears its internal persona state).
  const [personaResetKey, setPersonaResetKey] = useState(0);

  // Quick (images + brief) vs Descriptive (also a product link → fetched details).
  const [inputMode, setInputMode] = useState<InputMode>("quick");
  // "From URL" → auto-fill the Detailed-features text only (images are manual).
  const [productUrl, setProductUrl] = useState("");
  const [productFeatures, setProductFeatures] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  // Compact "brand + product" label captured on fetch — passed to PersonaBuilder for
  // brand-aware casting. The persona builder owns its own casting traits + toggles.
  const [brandProduct, setBrandProduct] = useState("");
  // World / background (optional) — the backdrop the ad takes place in.
  const [worldMode, setWorldMode] = useState<WorldMode>("create");
  const [worldImage, setWorldImage] = useState<string | null>(null);
  const [worldStyle, setWorldStyle] = useState("");
  const [worldTime, setWorldTime] = useState("");
  const [worldLighting, setWorldLighting] = useState("");
  const [worldDesc, setWorldDesc] = useState("");
  const [worldBusy, setWorldBusy] = useState(false);
  const [worldError, setWorldError] = useState("");
  const [description, setDescription] = useState("");
  const [aspect] = useState<FalAspect>("9:16");
  const [imageModel, setImageModel] = useState<string>(DEFAULT_IMAGE_MODEL_ID);
  const [language, setLanguage] = useState("");
  const [videoChoice, setVideoChoice] = useState("seedance-2-5");
  const [adSeconds, setAdSeconds] = useState<15 | 30>(15);   // ad length: 15s (5-beat) or 30s (stretched)
  // Audio: model-native voiceover vs an ElevenLabs voiceover (via FAL) lip-synced on.
  // The ElevenLabs voice is auto-picked from the language/accent + the script's voice.
  const [audioMode, setAudioMode] = useState<"model" | "elevenlabs">("model");
  // Render engine: direct Seedance (BytePlus ARK) vs FAL. Defaults to ARK.
  const [renderEngine, setRenderEngine] = useState<"ark" | "fal">("ark");

  const [stage, setStage] = useState<Stage>("input");
  const [statusMessage, setStatusMessage] = useState("");
  const [plan, setPlan] = useState<UGCDirectorPlan | null>(null);
  const [takes, setTakes] = useState<FinalReel[]>([]);
  const [viewTake, setViewTake] = useState(0);
  const [renderPhase, setRenderPhase] = useState<RenderPhase>("");
  // Reference frames sent to Seedance + any Nano-generated reference assets — shown while filming.
  const [renderRefs, setRenderRefs] = useState<{ url: string; role: string }[]>([]);
  const [nanoRefImages, setNanoRefImages] = useState<string[]>([]);
  // The exact prompt submitted to the video model — surfaced in a dropdown.
  const [seedancePrompt, setSeedancePrompt] = useState("");

  const MAX_TAKES = 3;

  const fileRef = useRef<HTMLInputElement>(null);
  const worldFileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const isScripting = stage === "scripting";
  const isRendering = stage === "rendering";
  const busy = isScripting || isRendering;

  // Product + model uploaders share one budget: each type has its own max, and
  // the two together never exceed COMBINED_MAX (the ~4.5 MB body cap).
  const addImages = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!list.length) return;
    const slots = Math.min(MAX_PROD - images.length, COMBINED_MAX - images.length - modelImages.length);
    if (slots <= 0) return;
    const added: UploadedImage[] = [];
    for (const file of list.slice(0, slots)) {
      try { added.push({ id: crypto.randomUUID(), dataUrl: await compressImage(file), name: file.name }); } catch { /* ignore */ }
    }
    if (added.length) setImages(p => [...p, ...added]);
  }, [images.length, modelImages.length]);

  const addModelImages = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!list.length) return;
    const slots = Math.min(MAX_MODEL - modelImages.length, COMBINED_MAX - images.length - modelImages.length);
    if (slots <= 0) return;
    const added: UploadedImage[] = [];
    for (const file of list.slice(0, slots)) {
      try { added.push({ id: crypto.randomUUID(), dataUrl: await compressImage(file), name: file.name }); } catch { /* ignore */ }
    }
    if (added.length) setModelImages(p => [...p, ...added]);
  }, [images.length, modelImages.length]);

  const removeImage = (id: string) => setImages(p => p.filter(i => i.id !== id));
  const removeModelImage = (id: string) => setModelImages(p => p.filter(i => i.id !== id));

  // Auto-fill the Detailed-features text from a product URL. Images are uploaded
  // manually — this scrapes ONLY the listing's text (title + bullets + description)
  // and replaces the textarea contents (an explicit, user-triggered action).
  const fetchProduct = useCallback(async () => {
    const url = productUrl.trim();
    if (!url || fetching || busy) return;
    setFetching(true);
    setFetchError("");
    try {
      const res = await fetch("/api/media-analyser/ugc-ads-fetch-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<UGCFetchProductResponse> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not fetch that product.");
      const detailParts = [data.title, ...(data.bullets ?? []), data.description].map(s => (s ?? "").trim()).filter(Boolean);
      if (!detailParts.length) throw new Error("Couldn't read product details from that page — type them in manually.");
      setProductFeatures(detailParts.join("\n").slice(0, 2000));
      // Keep a compact "brand + product" label for brand-aware character casting.
      setBrandProduct([data.brand, data.title].map(s => (s ?? "").trim()).filter(Boolean).join(" ").slice(0, 200));
    } catch (e) {
      setFetchError(friendlyError(e));
    } finally {
      setFetching(false);
    }
  }, [productUrl, fetching, busy]);

  // Add already-encoded talent data URLs (generated character, a reused saved persona,
  // or angle shots) into the shared talent set — budget-capped like the file uploader.
  const addModelDataUrls = useCallback((urls: string[], label = "Generated character") => {
    setModelImages(p => {
      const slots = Math.min(MAX_MODEL - p.length, COMBINED_MAX - images.length - p.length);
      if (slots <= 0) return p;
      const added = urls.slice(0, slots).map(dataUrl => ({ id: crypto.randomUUID(), dataUrl, name: label }));
      return [...p, ...added];
    });
  }, [images.length]);

  // World upload — compress a background photo into the world slot.
  const addWorldImage = useCallback(async (file: File) => {
    setWorldError("");
    try { setWorldImage(await compressImage(file)); } catch (e) { setWorldError(friendlyError(e)); }
  }, []);

  // Generate the backdrop from the style/time/lighting dropdowns + description.
  const generateWorld = useCallback(async () => {
    if (worldBusy || busy) return;
    if (!worldStyle && !worldTime && !worldLighting && !worldDesc.trim()) {
      setWorldError("Pick a style/time/lighting or describe the world.");
      return;
    }
    setWorldBusy(true);
    setWorldError("");
    try {
      const res = await fetch("/api/media-analyser/ugc-ads-world", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style: worldStyle, time: worldTime, lighting: worldLighting, description: worldDesc.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<UGCWorldResponse> & { error?: string };
      if (!res.ok || !data.imageDataUrl) throw new Error(data.error ?? "Could not create the world");
      setWorldImage(data.imageDataUrl);
    } catch (e) {
      setWorldError(friendlyError(e));
    } finally {
      setWorldBusy(false);
    }
  }, [worldBusy, busy, worldStyle, worldTime, worldLighting, worldDesc]);

  const resetAll = () => {
    setImages([]); setModelImages([]); setDescription(""); setPlan(null);
    setPersonaResetKey(k => k + 1); setBrandProduct("");
    setWorldMode("create"); setWorldImage(null); setWorldStyle(""); setWorldTime("");
    setWorldLighting(""); setWorldDesc(""); setWorldBusy(false); setWorldError("");
    setLanguage(""); setVideoChoice("seedance-2-5"); setAdSeconds(15); setAudioMode("model");
    setInputMode("quick"); setProductUrl(""); setProductFeatures(""); setFetching(false); setFetchError("");
    setTakes([]); setViewTake(0); setRenderPhase(""); setRenderRefs([]); setNanoRefImages([]); setSeedancePrompt("");
    setStage("input"); setStatusMessage("");
  };

  const backToReview = () => {
    setTakes([]); setViewTake(0); setRenderPhase("");
    setStage("review"); setStatusMessage("");
  };

  // STAGE 02 — Director: produce the structured 5-beat plan for review/approval.
  const handleGeneratePlan = async () => {
    if (!images.length || !description.trim() || busy) return;
    setStage("scripting");
    setPlan(null);
    setStatusMessage("Directing your ad — planning the 5-beat funnel…");
    try {
      const res = await fetch("/api/media-analyser/ugc-ads-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrls: images.map(i => i.dataUrl),
          modelImageDataUrls: modelImages.map(i => i.dataUrl),
          description: description.trim(),
          productFeatures: inputMode === "descriptive" ? productFeatures.trim() : "",
          language,
          worldImageDataUrl: worldImage ?? undefined,
          worldDescription: worldImage && worldMode === "create" ? worldSummary({ style: worldStyle, time: worldTime, lighting: worldLighting, description: worldDesc.trim() }) : "",
          aspect,
          durationSeconds: adSeconds,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { plan?: UGCDirectorPlan; error?: string };
      if (!res.ok || !data.plan) throw new Error(data.error ?? "Could not generate the ad plan");
      setPlan(data.plan);
      setStage("review");
      setStatusMessage("");
    } catch (e) {
      setStage("error");
      setStatusMessage(friendlyError(e));
    }
  };

  // Inline edits to a shot before approval.
  const updateShot = (idx: number, patch: Partial<Shot>) => {
    setPlan(prev => prev ? { ...prev, shots: prev.shots.map((s, i) => i === idx ? { ...s, ...patch } : s) } : prev);
  };

  /** Upsert a take by attempt number (candidate first, then filled in by QC). */
  const upsertTake = (attempt: number, patch: Partial<FinalReel>) => {
    setTakes(prev => {
      const idx = prev.findIndex(t => t.attempt === attempt);
      if (idx === -1) return [...prev, { attempt, videoUrl: "", ...patch }];
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  // STAGES 03–05 — render references → Seedance video → QC. Renders ONE take.
  //
  // The render is DECOUPLED across three short endpoints because a 15s/1080p
  // Seedance render routinely takes >10 min — longer than any single Vercel
  // function can live:
  //   1. POST /api/ugc-ads/render        → submits the job, returns a FAL handle
  //   2. POST /api/ugc-ads/render-status → polled every few seconds until ready
  //   3. POST /api/ugc-ads/qc            → runs the QC gate over the finished video
  //
  // First call: attempt 1. Regeneration (user-driven) calls again with the prior
  // take's QC strategy + fix notes so the next take addresses what was flagged.
  const RENDER_POLL_MS = 6000;
  const RENDER_DEADLINE_MS = 20 * 60 * 1000; // overall safety cap (~20 min)

  const runRender = async (opts?: { attempt?: number; regenStrategy?: string; qcFeedback?: string }) => {
    if (!plan || !images.length || busy) return;
    const attempt = opts?.attempt ?? 1;
    const videoOpt = VIDEO_OPTIONS.find(v => v.id === videoChoice) ?? VIDEO_OPTIONS[0];
    setStage("rendering");
    setRenderPhase("preparing");
    if (attempt === 1) { setTakes([]); setViewTake(0); setRenderRefs([]); setNanoRefImages([]); setSeedancePrompt(""); }
    setStatusMessage(attempt === 1 ? "Approved. Producing your ad…" : `Regenerating — producing take ${attempt} with the fixes…`);

    try {
      // 1 — submit the render job (fast: refs + uploads + FAL submit).
      const submitRes = await fetch("/api/media-analyser/ugc-ads-render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrls: images.map(i => i.dataUrl),
          modelImageDataUrls: modelImages.map(i => i.dataUrl),
          worldImageDataUrl: worldImage ?? undefined,
          plan,
          description: description.trim(),
          imageModel,
          videoModel: videoOpt.videoModel,
          videoResolution: videoOpt.resolution,
          audioMode,
          seedanceProvider: renderEngine,
          aspect,
          attempt,
          regenStrategy: opts?.regenStrategy,
          qcFeedback: opts?.qcFeedback,
        }),
      });
      if (!submitRes.ok) {
        const err = (await submitRes.json().catch(() => ({ error: "Request failed" }))) as { error?: string };
        throw new Error(err.error ?? "Request failed");
      }
      const handle = (await submitRes.json()) as UGCRenderSubmit;
      const at = handle.attempt || attempt;

      // Surface the reference frames going into Seedance + any Nano-generated assets.
      const dbg = handle.debug;
      if (dbg) {
        const refs: { url: string; role: string }[] = [];
        let i = 0;
        for (const m of dbg.referenceManifest ?? []) {
          for (let k = 0; k < m.count; k++) { if (dbg.referenceUrls[i]) refs.push({ url: dbg.referenceUrls[i], role: m.role }); i++; }
        }
        setRenderRefs(refs);
        setNanoRefImages(dbg.nanoRefImages ?? []);
        setSeedancePrompt(dbg.seedancePrompt ?? "");
      }

      // 2 — poll FAL (via our short status route) until the video is ready.
      setRenderPhase("rendering");
      setStatusMessage(at > 1 ? `Filming take ${at}… this takes a few minutes.` : "Filming your 15-second ad with voiceover… this takes a few minutes.");
      const deadline = Date.now() + RENDER_DEADLINE_MS;
      let videoUrl = "";
      let durationSeconds: number | undefined = handle.durationSeconds;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, RENDER_POLL_MS));
        const statusRes = await fetch("/api/media-analyser/ugc-ads-render-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statusUrl: handle.statusUrl, responseUrl: handle.responseUrl }),
        }).catch(() => null);
        if (!statusRes || !statusRes.ok) continue; // transient — keep polling
        const st = (await statusRes.json().catch(() => null)) as UGCRenderStatus | null;
        if (!st) continue;
        if (st.status === "failed") throw new Error(st.error || "The render failed. Please try again.");
        if (st.status === "rendered" && st.videoUrl) {
          videoUrl = st.videoUrl;
          if (typeof st.durationSeconds === "number") durationSeconds = st.durationSeconds;
          break;
        }
      }
      if (!videoUrl) throw new Error("The render is taking unusually long. Please try again.");

      // 2b — ElevenLabs voiceover + lip-sync (optional). The video rendered silent;
      // generate the VO via FAL, lip-sync it on, and swap in the synced video.
      // Best-effort: any failure keeps the silent take rather than blocking delivery.
      if (audioMode === "elevenlabs" && plan) {
        try {
          setStatusMessage("Generating the ElevenLabs voiceover…");
          const voRes = await fetch("/api/media-analyser/ugc-ads-voiceover", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shots: plan.shots.map(s => ({ dialogue: s.dialogue })), language, voiceCharacteristics: plan.meta.voice_characteristics }),
          });
          const voData = (await voRes.json().catch(() => ({}))) as { audioUrl?: string; error?: string };
          if (!voRes.ok || !voData.audioUrl) throw new Error(voData.error ?? "voiceover failed");

          setStatusMessage("Lip-syncing the voiceover onto the video…");
          const lipRes = await fetch("/api/media-analyser/ugc-ads-lipsync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoUrl, audioUrl: voData.audioUrl }),
          });
          if (!lipRes.ok) { const e = (await lipRes.json().catch(() => ({}))) as { error?: string }; throw new Error(e.error ?? "lip-sync failed"); }
          const lipHandle = (await lipRes.json()) as UGCRenderSubmit;

          const lipDeadline = Date.now() + RENDER_DEADLINE_MS;
          let syncedUrl = "";
          while (Date.now() < lipDeadline) {
            await new Promise(r => setTimeout(r, RENDER_POLL_MS));
            const sRes = await fetch("/api/media-analyser/ugc-ads-render-status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ statusUrl: lipHandle.statusUrl, responseUrl: lipHandle.responseUrl }),
            }).catch(() => null);
            if (!sRes || !sRes.ok) continue;
            const s = (await sRes.json().catch(() => null)) as UGCRenderStatus | null;
            if (!s) continue;
            if (s.status === "failed") throw new Error(s.error || "lip-sync failed");
            if (s.status === "rendered" && s.videoUrl) { syncedUrl = s.videoUrl; break; }
          }
          if (!syncedUrl) throw new Error("lip-sync is taking unusually long");
          videoUrl = syncedUrl;
        } catch (e) {
          setStatusMessage(`Voiceover/lip-sync didn't complete — delivering the silent take. (${friendlyError(e)})`);
        }
      }

      // Show the take the instant it renders, before/while QC runs.
      upsertTake(at, { videoUrl, durationSeconds });
      setViewTake(at - 1);

      // 3 — QC gate (best-effort; never blocks delivery).
      setRenderPhase("qc");
      setStatusMessage("Quality-checking your ad…");
      let qc: UGCQcResponse = { qcDone: false, qcPass: true, qcSummary: "" };
      const qcRes = await fetch("/api/media-analyser/ugc-ads-qc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl, plan, description: description.trim(), attempt: at }),
      }).catch(() => null);
      if (qcRes && qcRes.ok) {
        qc = (await qcRes.json().catch(() => qc)) as UGCQcResponse;
      }

      const finalReel: FinalReel = {
        attempt: at,
        videoUrl,
        durationSeconds,
        qcDone: qc.qcDone,
        qcPass: qc.qcPass,
        qcSummary: qc.qcSummary,
        qcResult: qc.qcResult,
      };
      upsertTake(at, finalReel);
      setViewTake(at - 1);
      setStage("done");
      setStatusMessage("");

      // Persist the finished take (best-effort).
      const referenceThumbnails = await makeThumbs(images.map(i => i.dataUrl));
      const title = plan.meta.scene_setting || description.slice(0, 60) || "UGC ad";
      fetch("/api/media-analyser/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "ugc_ad",
          product_name: title,
          result_count: 1,
          thumbnail_url: null,
          results: [{
            index: 0,
            concept: title,
            videoUrl: finalReel.videoUrl,
            durationSeconds: finalReel.durationSeconds,
            attempt: at,
            qcPass: qc.qcPass,
            qcSummary: qc.qcSummary,
          }],
          input: {
            description: description || title,
            imageModel,
            videoModel: videoOpt.videoModel,
            aspect,
            referenceThumbnails,
          },
        }),
      }).catch(() => {});
    } catch (e) {
      setStage("error");
      setStatusMessage(friendlyError(e));
    } finally {
      setRenderPhase("");
    }
  };

  const handleApproveRender = () => runRender({ attempt: 1 });

  // User clicked "Yes, regenerate" on a QC-flagged take → produce the next take
  // with the QC's chosen strategy + per-beat fix notes baked in.
  const handleRegenerate = () => {
    const last = takes[takes.length - 1];
    if (!last?.qcResult || takes.length >= MAX_TAKES || busy) return;
    const qc = last.qcResult;
    const fixNotes = [
      qc.summary,
      ...qc.failed_beats.map(b => `${b.beat_name}: ${b.issue} → ${b.required_fix}`),
    ].filter(Boolean).join("; ");
    runRender({
      attempt: last.attempt + 1,
      regenStrategy: qc.regeneration_strategy,
      qcFeedback: fixNotes,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">
          UGC Ads
          <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">director → approve → video ✦</span>
        </h3>
        <p className="text-xs text-fg-dim mt-0.5 leading-relaxed">
          Upload your product (and optionally a talent photo), say what you want, and our
          Ad Director plans a 15s, 5-beat UGC funnel. Approve it and we render one finished
          vertical video — with voiceover and lip-sync — then QC it before delivery.
        </p>
      </div>

      {/* ── input mode: Quick (images + brief) vs Descriptive (+ product link) ── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line self-start">
          {(["quick", "descriptive", "cohorts"] as InputMode[]).map(m => (
            <button key={m} type="button" disabled={busy}
              onClick={() => { setInputMode(m); if (m !== "descriptive") { setProductUrl(""); setProductFeatures(""); setFetchError(""); } }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${inputMode === m ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
              {m === "quick" ? "Quick" : m === "descriptive" ? "Descriptive" : "Cohorts"}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-fg-mute leading-snug">
          Quick = images + your prompt. Descriptive = also paste a product link. Cohorts = upload an audience deck; we write a tailored ad + creator per segment (no prompt needed).
        </p>
      </div>

      {/* ── product images (manual upload; both modes) ──── */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-fg">Product photo{MAX_PROD > 1 ? "s" : ""}</p>
        <p className="text-[11px] text-fg-mute leading-snug">1–{MAX_PROD} angles. The product stays locked and authentic in every beat.</p>

        <div
          className={`border-2 border-dashed rounded-xl p-4 cursor-pointer transition-colors ${isDragging ? "border-accent bg-accent-soft" : images.length ? "border-line bg-surface-2" : "border-line hover:border-accent/40 hover:bg-surface-2/50"}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files?.length) addImages(e.dataTransfer.files); }}
        >
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { if (e.target.files?.length) addImages(e.target.files); e.target.value = ""; }} />
          {images.length ? (
            <div className="space-y-2" onClick={e => e.stopPropagation()}>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {images.map(img => (
                  <div key={img.id} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.dataUrl} alt={img.name} className="w-full aspect-square object-contain rounded-md border border-line bg-surface" />
                    <button type="button" onClick={() => removeImage(img.id)}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      aria-label="Remove">×</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-fg-mute">{images.length}/{MAX_PROD}</p>
                {images.length < MAX_PROD && images.length + modelImages.length < COMBINED_MAX && (
                  <button type="button" onClick={() => fileRef.current?.click()} className="text-[11px] font-medium text-accent hover:text-accent shrink-0">+ Add more</button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm font-medium text-fg-dim">Drop your product photo here</p>
              <p className="text-[11px] text-fg-mute mt-0.5">JPG · PNG · WEBP · up to {MAX_PROD}</p>
            </div>
          )}
        </div>

        {/* detailed product features — Descriptive mode only: type, or fetch from a URL */}
        {inputMode === "descriptive" && (
          <div className="flex flex-col gap-1.5 mt-1">
            <label className="text-[11px] font-medium text-fg-dim">
              Detailed features <span className="font-normal text-fg-mute">(grounds the script in real specs)</span>
            </label>

            {/* paste a product URL → auto-fill the features text (images stay manual) */}
            <div className="flex gap-2">
              <input
                type="url"
                value={productUrl}
                disabled={busy || fetching}
                onChange={e => setProductUrl(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); fetchProduct(); } }}
                placeholder="Paste a product URL to auto-fill features (Amazon / Flipkart / brand site)"
                className="flex-1 min-w-0 rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
              />
              <button type="button" onClick={fetchProduct} disabled={busy || fetching || !productUrl.trim()}
                className="shrink-0 px-4 py-2 rounded-lg bg-accent text-bg text-sm font-medium hover:opacity-90 disabled:opacity-40">
                {fetching ? "Fetching…" : "Fetch"}
              </button>
            </div>
            {fetchError && <p className="text-[11px] text-alert leading-snug">{fetchError}</p>}

            <textarea
              value={productFeatures}
              disabled={busy}
              onChange={e => setProductFeatures(e.target.value)}
              rows={3}
              placeholder="Key specs, materials, ingredients, claims… (or fetch them from a URL above)"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm leading-snug resize-y focus:outline-none focus:border-accent disabled:opacity-50"
            />
          </div>
        )}
      </div>

      {/* ── unified persona / talent builder (create · reuse saved · upload · references · angles) ── */}
      {inputMode !== "cohorts" && (
        <PersonaBuilder
          key={personaResetKey}
          modelImages={modelImages}
          onAddDataUrls={addModelDataUrls}
          onAddFiles={addModelImages}
          onRemoveImage={removeModelImage}
          freeSlots={Math.min(MAX_MODEL - modelImages.length, COMBINED_MAX - images.length - modelImages.length)}
          maxModel={MAX_MODEL}
          busy={busy}
          aspect={aspect}
          brandProduct={brandProduct}
          productFeatures={productFeatures}
          renderEngine={renderEngine}
        />
      )}

      {/* ── optional world / background (upload OR create from style/time/lighting) ── */}
      {inputMode !== "cohorts" && (
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-fg">World / background <span className="font-normal text-fg-mute">(optional)</span></p>
        <p className="text-[11px] text-fg-mute leading-snug">The backdrop where the ad takes place. Leave empty and the Director sets a fitting scene.</p>

        {/* mode toggle */}
        <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line self-start">
          {(["upload", "create"] as WorldMode[]).map(m => (
            <button key={m} type="button" disabled={busy} onClick={() => { setWorldMode(m); setWorldError(""); }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${worldMode === m ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
              {m === "upload" ? "Upload background" : "Create world"}
            </button>
          ))}
        </div>

        <input ref={worldFileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) addWorldImage(f); e.target.value = ""; }} />

        {worldImage && (
          <div className="relative group w-44 max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={worldImage} alt="World / background" className="w-full aspect-[9/16] object-cover rounded-lg border border-line bg-surface" />
            <button type="button" onClick={() => setWorldImage(null)} disabled={busy}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center disabled:opacity-0"
              aria-label="Remove">×</button>
          </div>
        )}

        {worldMode === "upload" ? (
          !worldImage && (
            <button type="button" onClick={() => worldFileRef.current?.click()} disabled={busy}
              className="self-start text-[11px] font-medium text-accent hover:text-accent border border-accent/40 rounded-lg px-3 py-1.5 disabled:opacity-40">
              + Upload a background
            </button>
          )
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2/50 p-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ModelSelect label="Style" options={WORLD_STYLE_OPTIONS} value={worldStyle} onChange={setWorldStyle} disabled={worldBusy || busy} />
              <ModelSelect label="Time" options={WORLD_TIME_OPTIONS} value={worldTime} onChange={setWorldTime} disabled={worldBusy || busy} />
              <ModelSelect label="Lighting" options={WORLD_LIGHTING_OPTIONS} value={worldLighting} onChange={setWorldLighting} disabled={worldBusy || busy} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-fg-dim">Describe it yourself <span className="text-fg-mute">(optional)</span></label>
              <textarea value={worldDesc} onChange={e => setWorldDesc(e.target.value)} disabled={worldBusy || busy}
                rows={2} placeholder="e.g. a sunlit minimalist kitchen with marble counters and a window"
                className="w-full text-xs rounded-md border border-line p-2 resize-y focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
            </div>
            <button type="button" onClick={generateWorld} disabled={worldBusy || busy}
              className="self-start text-xs font-medium text-white bg-accent hover:bg-accent rounded-lg px-3 py-1.5 disabled:opacity-40 flex items-center gap-2">
              {worldBusy && <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}
              {worldBusy ? "Creating world…" : worldImage ? "Regenerate world" : "Generate world"}
            </button>
          </div>
        )}
        {worldError && <p className="text-[11px] text-alert">{worldError}</p>}
      </div>
      )}

      {inputMode !== "cohorts" && (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-fg">What do you want this ad to do?</p>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          disabled={busy}
          rows={3}
          placeholder="e.g. Woman walking into the gym, flexing with her water bottle — energetic UGC ad. Mention our Black Friday 20% off."
          className="w-full text-sm rounded-lg border border-line p-3 resize-y focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 disabled:opacity-50"
        />
      </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <p className="text-xs font-medium text-fg-dim mb-2">Format</p>
          <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line">
            {ASPECTS.map(a => (
              <button key={a.key} disabled
                className="flex-1 py-1.5 text-xs font-medium bg-accent text-bg">
                {a.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-fg-mute mt-1">Vertical · with audio</p>
        </div>
        <div>
          <p className="text-xs font-medium text-fg-dim mb-2">Length</p>
          <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line">
            {([15, 30] as const).map(s => (
              <button key={s} type="button" disabled={busy} onClick={() => setAdSeconds(s)}
                className={`flex-1 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${adSeconds === s ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
                {s}s
              </button>
            ))}
          </div>
        </div>
        <ModelSelect label="Video model" options={VIDEO_OPTIONS.map(v => ({ id: v.id, label: v.label }))} value={videoChoice} onChange={setVideoChoice} disabled={busy} />
        <ModelSelect label="Voiceover language / accent" options={LANGUAGE_OPTIONS} value={language} onChange={setLanguage} disabled={busy} />
        <ModelSelect label="Reference image model" options={IMAGE_MODELS.map(m => ({ id: m.id, label: m.label }))} value={imageModel} onChange={setImageModel} disabled={busy} />
      </div>

      {/* Audio: model-native voiceover vs ElevenLabs (via FAL) lip-synced on */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-fg-dim">Audio</p>
        <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line self-start">
          {(["model", "elevenlabs"] as const).map(m => (
            <button key={m} type="button" disabled={busy} onClick={() => setAudioMode(m)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${audioMode === m ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
              {m === "model" ? "Model native" : "ElevenLabs (FAL)"}
            </button>
          ))}
        </div>
        {audioMode === "elevenlabs" && (
          <p className="text-[11px] text-fg-mute leading-snug">We render the video silent, generate the voiceover with ElevenLabs, then lip-sync it on. The voice is auto-picked from the language/accent above + the script&apos;s voice description — a bit slower than model-native audio.</p>
        )}
      </div>

      {/* Render engine: direct Seedance (ARK) vs FAL — only Seedance can use ARK */}
      {VIDEO_OPTIONS.find(v => v.id === videoChoice)?.videoModel === "seedance-2" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-fg-dim">Render engine</p>
          <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line self-start">
            {(["ark", "fal"] as const).map(e => (
              <button key={e} type="button" disabled={busy} onClick={() => setRenderEngine(e)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${renderEngine === e ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
                {e === "ark" ? "Direct Seedance (ARK)" : "FAL"}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-fg-mute leading-snug">
            {renderEngine === "ark"
              ? "Renders Seedance directly on BytePlus ARK (skips the FAL queue). Product/model images are still hosted via FAL."
              : "Renders Seedance through the FAL queue (the original path)."}
          </p>
        </div>
      )}

      {inputMode !== "cohorts" && (stage === "input" || isScripting) ? (
        <div className="flex gap-2">
          <button onClick={handleGeneratePlan} disabled={!images.length || !description.trim() || busy}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${!images.length || !description.trim() || busy ? "bg-surface-2 text-fg-mute cursor-not-allowed" : "bg-accent text-bg hover:opacity-90"}`}>
            {isScripting ? "Directing…" : "Direct the ad"}
          </button>
          {(images.length > 0 || description) && !busy && (
            <button onClick={resetAll} className="px-4 py-2.5 text-sm text-fg-mute hover:text-fg-dim transition-colors">Clear</button>
          )}
        </div>
      ) : null}

      {inputMode === "cohorts" && stage === "input" && (
        <CohortCampaign
          productImages={images.map(i => i.dataUrl)}
          productFeatures=""
          description=""
          aspect={aspect}
          imageModel={imageModel}
          language={language}
          durationSeconds={adSeconds}
          disabled={!images.length}
        />
      )}

      {/* status line */}
      {statusMessage && (
        <div className="flex items-center gap-2 text-sm">
          {busy && <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />}
          <span className={stage === "error" ? "text-alert" : stage === "done" ? "text-accent-2 font-medium" : "text-fg-dim"}>{statusMessage}</span>
        </div>
      )}

      {/* ── plan review + approval gate ────────────────────────────── */}
      {plan && (stage === "review" || stage === "rendering" || stage === "done") && (
        <div className="border border-accent/30 bg-accent-soft/40 rounded-xl p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-fg">5-beat UGC funnel</p>
              <p className="text-xs text-fg-dim mt-0.5">{plan.meta.duration_seconds}s · {plan.shots.length} beats · {plan.meta.aspect_ratio}</p>
            </div>
            {stage === "review" && (
              <span className="text-[10px] font-semibold text-accent bg-surface border border-accent/40 px-2 py-1 rounded-full shrink-0">Review &amp; edit before rendering</span>
            )}
          </div>

          {plan.meta.voice_characteristics && (
            <div className="text-xs">
              <span className="font-semibold text-fg">Voice:</span>{" "}
              <span className="text-fg-dim italic">{plan.meta.voice_characteristics}</span>
            </div>
          )}

          <div className="space-y-3">
            {plan.shots.map((s, i) => (
              <div key={i} className="bg-surface border border-line rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-fg">{s.beat_name} <span className="font-normal text-fg-mute">· {s.time_range}</span></p>
                </div>
                {stage === "review" ? (
                  <>
                    <div>
                      <label className="text-[10px] font-medium text-fg-mute uppercase tracking-wide">Dialogue</label>
                      <textarea value={s.dialogue} onChange={e => updateShot(i, { dialogue: e.target.value })}
                        rows={2} className="w-full text-xs rounded-md border border-line p-2 mt-0.5 resize-y focus:outline-none focus:ring-1 focus:ring-accent/40" />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-fg-mute uppercase tracking-wide">Action</label>
                      <textarea value={s.subject_action} onChange={e => updateShot(i, { subject_action: e.target.value })}
                        rows={2} className="w-full text-xs rounded-md border border-line p-2 mt-0.5 resize-y focus:outline-none focus:ring-1 focus:ring-accent/40" />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-fg-mute uppercase tracking-wide">Text overlay (optional)</label>
                      <input value={s.text_overlay ?? ""} onChange={e => updateShot(i, { text_overlay: e.target.value || null })}
                        className="w-full text-xs rounded-md border border-line p-2 mt-0.5 focus:outline-none focus:ring-1 focus:ring-accent/40" placeholder="(none)" />
                    </div>
                  </>
                ) : (
                  <>
                    {s.dialogue && <p className="text-xs text-fg-dim italic">“{s.dialogue}”</p>}
                    {s.subject_action && <p className="text-[11px] text-fg-mute">{s.subject_action}</p>}
                    {s.text_overlay && <p className="text-[11px] text-accent">Overlay: {s.text_overlay}</p>}
                  </>
                )}
              </div>
            ))}
          </div>

          {stage === "review" && (
            <div className="flex gap-2 pt-1">
              <button onClick={handleApproveRender} disabled={busy}
                className="flex-1 py-2.5 px-4 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent transition-colors disabled:opacity-50">
                Approve &amp; render video
              </button>
              <button onClick={handleGeneratePlan} disabled={busy}
                className="px-4 py-2.5 text-sm text-fg-dim hover:text-fg transition-colors">Re-direct</button>
            </div>
          )}
        </div>
      )}

      {/* ── rendered take(s) + QC flag + user-driven regenerate ────── */}
      {takes.length > 0 && (() => {
        const current = takes[Math.min(viewTake, takes.length - 1)] ?? takes[takes.length - 1];
        const latest = takes[takes.length - 1];
        const showingLatest = current.attempt === latest.attempt;
        const renderingNow = stage === "rendering";
        const qc = current.qcResult;
        const qcFlagged = current.qcDone && current.qcPass === false;
        const canRegen = showingLatest && latest.qcDone && latest.qcPass === false
          && latest.qcResult?.regeneration_strategy !== "none"
          && takes.length < MAX_TAKES && !busy;

        return (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-fg">
              Your UGC ad{current.durationSeconds ? ` — ${current.durationSeconds}s` : ""}
            </p>
            {!busy && <button onClick={backToReview} className="text-xs text-fg-mute hover:text-fg-dim">Edit plan</button>}
          </div>

          {/* take switcher (appears once there is more than one take) */}
          {takes.length > 1 && (
            <div className="flex items-center gap-1.5">
              {takes.map(t => (
                <button key={t.attempt} onClick={() => setViewTake(t.attempt - 1)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${current.attempt === t.attempt ? "bg-accent text-bg border-accent" : "bg-surface text-fg-dim border-line hover:border-line"}`}>
                  Take {t.attempt}{t.qcDone ? (t.qcPass ? " ✓" : " ⚠") : "…"}
                </button>
              ))}
            </div>
          )}

          {/* live status while a take is rendering / being QC'd */}
          {renderingNow && (
            <div className="flex items-center gap-2 text-xs text-accent bg-accent-soft border border-accent/30 rounded-lg p-2.5">
              <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
              <span>
                {renderPhase === "qc" ? "Quality-checking this take…"
                  : renderPhase === "rendering" || renderPhase === "preparing"
                    ? (takes.length > 1 ? `Filming take ${takes.length}…` : "Filming your ad…")
                    : "Working…"}
              </span>
            </div>
          )}

          {/* the actual frames feeding the video model — shown while filming */}
          {(renderRefs.length > 0 || nanoRefImages.length > 0) && (
            <div className="space-y-2 rounded-lg border border-line bg-surface-2/60 p-2.5">
              {renderRefs.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-fg-dim">Reference frames sent to the video model</p>
                  <div className="flex flex-wrap gap-1.5">
                    {renderRefs.map((r, i) => (
                      <div key={i} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.url} alt={r.role} className="w-16 aspect-square object-cover rounded-md border border-line bg-surface" />
                        <span className="absolute bottom-0 inset-x-0 text-[8px] text-center text-white bg-black/55 capitalize rounded-b-md">{r.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {nanoRefImages.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-fg-dim">Nano Banana reference assets</p>
                  <div className="flex flex-wrap gap-1.5">
                    {nanoRefImages.map((u, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={u} alt="reference asset" className="w-16 aspect-square object-cover rounded-md border border-line bg-surface" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* the exact prompt submitted to the video model */}
          {seedancePrompt && (
            <details className="rounded-lg border border-line bg-surface-2/60 p-2.5">
              <summary className="text-[11px] font-medium text-fg-dim cursor-pointer hover:text-fg select-none">View the prompt sent to the video model</summary>
              <pre className="mt-1.5 text-[10px] leading-snug text-fg-dim whitespace-pre-wrap break-words max-h-72 overflow-auto">{seedancePrompt}</pre>
            </details>
          )}

          {/* QC verdict for the take being viewed */}
          {current.qcDone && current.qcPass === true && (
            <div className="flex items-start gap-2 text-xs rounded-lg border border-accent-2/40 bg-accent-2-soft text-accent-2 p-2.5">
              <span className="font-semibold shrink-0">✓ Passed QC</span>
              {current.qcSummary && <span className="text-fg-dim">{current.qcSummary}</span>}
            </div>
          )}
          {qcFlagged && (
            <div className="rounded-lg border border-accent/40 bg-accent-soft p-3 space-y-2">
              <p className="text-xs font-semibold text-accent">⚠ QC flagged this take</p>
              {current.qcSummary && <p className="text-xs text-accent">{current.qcSummary}</p>}
              {qc && qc.failed_beats.length > 0 && (
                <ul className="space-y-1.5">
                  {qc.failed_beats.map((b, i) => (
                    <li key={i} className="text-[11px] text-fg-dim">
                      <span className="font-semibold text-fg">{b.beat_name}:</span> {b.issue}
                      <span className="block text-accent-2">→ fix: {b.required_fix}</span>
                    </li>
                  ))}
                </ul>
              )}
              {qc && qc.regeneration_strategy !== "none" && (
                <p className="text-[11px] text-accent">
                  Suggested fix: <span className="font-medium">{qc.regeneration_strategy.replace(/_/g, " ")}</span>
                </p>
              )}
              {canRegen && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-fg-dim">Regenerate take {latest.attempt + 1} with this fix?</span>
                  <button onClick={handleRegenerate}
                    className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent transition-colors">
                    Yes, regenerate
                  </button>
                  <span className="text-[11px] text-fg-mute">or keep this take as-is</span>
                </div>
              )}
              {!canRegen && takes.length >= MAX_TAKES && (
                <p className="text-[11px] text-fg-mute">Reached the {MAX_TAKES}-take limit — pick the best take above.</p>
              )}
            </div>
          )}
          {current.qcDone && current.qcPass === undefined && current.qcSummary && (
            <div className="text-[11px] text-fg-mute">{current.qcSummary}</div>
          )}

          <div className="max-w-sm mx-auto border border-line rounded-xl overflow-hidden bg-surface shadow-sm">
            {current.videoUrl
              ? <video key={current.videoUrl} src={current.videoUrl} controls playsInline className="w-full aspect-[9/16] object-cover bg-black" />
              : <div className="w-full aspect-[9/16] bg-black/90 flex items-center justify-center text-xs text-fg-mute">Rendering…</div>}
            {current.videoUrl && (
              <div className="p-2.5">
                <a href={current.videoUrl} target="_blank" rel="noreferrer" className="inline-block text-[11px] text-accent hover:text-accent bg-accent-soft hover:bg-accent-soft px-2 py-1 rounded-md transition-colors">Open / download</a>
              </div>
            )}
          </div>
          {!busy && <button onClick={resetAll} className="text-xs text-fg-mute hover:text-fg-dim">Start a new UGC ad</button>}
        </div>
        );
      })()}
    </div>
  );
}
