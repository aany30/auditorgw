
import { useState, useRef, useCallback } from "react";
import { UGCCohortStudio } from "@/components/media-analyser/UGCCohortStudio";
import type { GeneratedScript, GeneratedPersona } from "@/lib/media-analyser/ugc-new/types";
import type { UGCScriptsResponse } from "@/lib/media-analyser/api-types";
import type { UGCPersonasResponse } from "@/lib/media-analyser/api-types";
import type { UGCRenderUpdate } from "@/lib/media-analyser/api-types";

// ── image compression (client) ──────────────────────────────────────────────
const MAX_IMG_BYTES = 780_000;
function compressImage(file: File, maxDim = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const enc = (dim: number, q: number) => {
        const scale = Math.min(1, dim / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL("image/jpeg", q);
      };
      try { let out = enc(maxDim, 0.82); for (const q of [0.72, 0.6]) { if (out.length <= MAX_IMG_BYTES) break; out = enc(maxDim, q); } resolve(out); }
      catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
    img.src = url;
  });
}
const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("read failed")); r.readAsDataURL(f); });

const secondsFor = (words: number) => (words / 1.9).toFixed(1);
const qcColor = (s?: number) => typeof s !== "number" ? "text-fg-mute" : s >= 70 ? "text-emerald-500" : s >= 55 ? "text-amber-500" : "text-red-500";

export function UGCNew() {
  // Manual staged studio vs the new Claude Cohort Studio (URL → analysis → cohorts → personas).
  const [studioMode, setStudioMode] = useState<"manual" | "cohort">("manual");

  // ── inputs ──
  const [pastedText, setPastedText] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [pdfDataUrl, setPdfDataUrl] = useState(""); const [pdfName, setPdfName] = useState("");
  const [productImages, setProductImages] = useState<string[]>([]);
  const [steering, setSteering] = useState("");
  const [timeOfDay, setTimeOfDay] = useState("18:00");
  const imgRef = useRef<HTMLInputElement>(null); const pdfRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");

  // ── step 1: scripts ──
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [ctx, setCtx] = useState<{ audienceLabel: string; audienceDescription: string; productDescription: string; brief: string } | null>(null);
  const [chosenScript, setChosenScript] = useState(-1);
  const [scriptsLoading, setScriptsLoading] = useState(false);

  // ── step 2: personas ──
  const [personas, setPersonas] = useState<GeneratedPersona[]>([]);
  const [chosenPersona, setChosenPersona] = useState(-1);
  const [personasLoading, setPersonasLoading] = useState(false);

  // ── step 3: render ──
  const [rendering, setRendering] = useState(false);
  const [renderLog, setRenderLog] = useState<string[]>([]);
  const [activePhase, setActivePhase] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  const addImages = useCallback(async (files: FileList) => {
    const list = Array.from(files).filter(f => f.type.startsWith("image/")).slice(0, 3 - productImages.length);
    const added: string[] = []; for (const f of list) { try { added.push(await compressImage(f)); } catch { /* ignore */ } }
    if (added.length) setProductImages(p => [...p, ...added].slice(0, 3));
  }, [productImages.length]);

  const busy = scriptsLoading || personasLoading || rendering;

  // reset downstream steps
  const resetFromPersonas = () => { setPersonas([]); setChosenPersona(-1); setVideoUrl(""); setAudioUrl(""); setRenderLog([]); };
  const resetFromScripts = () => { setScripts([]); setChosenScript(-1); resetFromPersonas(); };

  // ── Step 1 · generate / regenerate scripts ──
  const genScripts = async (regen = false) => {
    if (busy) return;
    if (!regen && !pastedText.trim() && !pdfDataUrl) { setErr("Paste some material or attach a PDF to start."); return; }
    setScriptsLoading(true); setErr(""); resetFromScripts();
    try {
      const payload: Record<string, unknown> = { pastedText, productUrl, pdfDataUrl, productImageDataUrls: productImages, steering };
      if (regen && ctx) { payload.brief = ctx.brief; payload.audienceLabel = ctx.audienceLabel; payload.audienceDescription = ctx.audienceDescription; payload.productDescription = ctx.productDescription; }
      const res = await fetch("/api/media-analyser/ugc-new-scripts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = (await res.json().catch(() => ({}))) as UGCScriptsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Script generation failed");
      setScripts(data.scripts.filter(s => s.content));
      setCtx({ audienceLabel: data.audienceLabel, audienceDescription: data.audienceDescription, productDescription: data.productDescription, brief: data.brief });
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setScriptsLoading(false); }
  };

  // ── Step 2 · generate / regenerate personas ──
  const genPersonas = async () => {
    if (busy || chosenScript < 0 || !ctx) return;
    if (productImages.length < 2) { setErr("Add 2–3 product images so the creator can hold the product."); return; }
    setPersonasLoading(true); setErr(""); resetFromPersonas();
    try {
      const s = scripts[chosenScript];
      const res = await fetch("/api/media-analyser/ugc-new-personas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productImageDataUrls: productImages, productDescription: ctx.productDescription, audienceLabel: ctx.audienceLabel, audienceDescription: ctx.audienceDescription, scriptAngle: s.angle, scriptContent: s.content }) });
      const data = (await res.json().catch(() => ({}))) as UGCPersonasResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Persona casting failed");
      setPersonas(data.personas);
      // preselect the best-QC persona that has a portrait
      const best = data.personas.map((p, i) => ({ p, i })).filter(x => x.p.imageDataUrl).sort((a, b) => (b.p.qcScore ?? 0) - (a.p.qcScore ?? 0))[0];
      if (best) setChosenPersona(best.i);
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setPersonasLoading(false); }
  };

  // ── Step 3 · render the chosen persona + script ──
  const renderVideo = async () => {
    if (busy || chosenScript < 0 || chosenPersona < 0) return;
    const persona = personas[chosenPersona]; const s = scripts[chosenScript];
    if (!persona?.imageDataUrl) { setErr("That persona has no portrait — pick another."); return; }
    setRendering(true); setErr(""); setRenderLog([]); setVideoUrl(""); setAudioUrl(""); setActivePhase("voice");
    try {
      const res = await fetch("/api/media-analyser/ugc-new-render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personaImageDataUrl: persona.imageDataUrl, personaName: persona.name, personaDescription: persona.description, scriptContent: s.content, timeOfDay }) });
      if (!res.ok || !res.body) { const e = (await res.json().catch(() => ({}))) as { error?: string }; throw new Error(e.error ?? "Render failed"); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.split("\n").find(l => l.startsWith("data: ")); if (!line) continue;
          let u: UGCRenderUpdate; try { u = JSON.parse(line.slice(6)); } catch { continue; }
          if (u.phase === "error") { setErr(u.message ?? "Render failed"); continue; }
          setActivePhase(u.phase);
          if (u.message) setRenderLog(l => [...l, `${u.phase}: ${u.message}`]);
          if (u.audioUrl) setAudioUrl(u.audioUrl);
          if (u.videoUrl) setVideoUrl(u.videoUrl);
        }
      }
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setRendering(false); setActivePhase(""); }
  };

  const canStart = (!!pastedText.trim() || !!pdfDataUrl) && productImages.length >= 2 && !busy;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">UGC New
          <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">guided studio ✦</span>
        </h2>
        <p className="text-xs text-fg-dim mt-0.5">Write 3 script angles → cast a persona grid (Seedream 5 Pro, QC-scored) → render on ByteDance Seedance 2.5. Pick and regenerate at each step.</p>
      </div>

      {/* ── studio mode ── */}
      <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line self-start w-fit">
        {(["manual", "cohort"] as const).map(m => (
          <button key={m} type="button" onClick={() => setStudioMode(m)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${studioMode === m ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
            {m === "manual" ? "Manual studio" : "Claude Cohort Studio ✦"}
          </button>
        ))}
      </div>

      {studioMode === "cohort" && <UGCCohortStudio />}

      {studioMode === "manual" && (<>
      {/* ── inputs ── */}
      <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
        <textarea value={pastedText} onChange={e => setPastedText(e.target.value)} disabled={busy} rows={3} placeholder="Paste product brief / notes / competitor info…"
          className="w-full text-xs rounded-md border border-line p-2 resize-y focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
        <div className="flex flex-wrap gap-2 items-center">
          <input value={productUrl} onChange={e => setProductUrl(e.target.value)} disabled={busy} placeholder="Product URL (optional)"
            className="flex-1 min-w-[200px] text-xs rounded-md border border-line px-2 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
          <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { setPdfDataUrl(await fileToDataUrl(f)); setPdfName(f.name); } e.target.value = ""; }} />
          <button type="button" onClick={() => pdfRef.current?.click()} disabled={busy} className="text-[11px] font-medium text-accent border border-accent/40 rounded-md px-2 py-1.5 disabled:opacity-40">{pdfName ? `PDF: ${pdfName.slice(0, 16)}` : "+ PDF"}</button>
          <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { if (e.target.files) addImages(e.target.files); e.target.value = ""; }} />
          <button type="button" onClick={() => imgRef.current?.click()} disabled={busy || productImages.length >= 3} className="text-[11px] font-medium text-accent border border-accent/40 rounded-md px-2 py-1.5 disabled:opacity-40">+ Product image ({productImages.length}/3)</button>
        </div>
        {productImages.length > 0 && <div className="flex gap-1.5 flex-wrap">{productImages.map((u, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <div key={i} className="relative group"><img src={u} alt="" className="w-14 h-14 object-cover rounded-md border border-line" />{!busy && <button onClick={() => setProductImages(p => p.filter((_, j) => j !== i))} className="absolute top-0 right-0 w-4 h-4 rounded-full bg-black/60 text-white text-[10px]">×</button>}</div>
        ))}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <input value={steering} onChange={e => setSteering(e.target.value)} disabled={busy} placeholder="Steering (optional) — e.g. lean playful, avoid medical claims"
            className="flex-1 min-w-[220px] text-xs rounded-md border border-line px-2 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
          <label className="flex items-center gap-1 text-[11px] text-fg-mute">Time <input type="time" value={timeOfDay} onChange={e => setTimeOfDay(e.target.value)} disabled={busy} className="rounded-md border border-line px-2 py-1" /></label>
        </div>
        {productImages.length < 2 && <p className="text-[11px] text-fg-mute">Add 2–3 product photos so the creator can hold the product.</p>}
        <button onClick={() => genScripts(false)} disabled={!canStart} className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${!canStart ? "bg-surface-2 text-fg-mute cursor-not-allowed" : "bg-accent text-white hover:opacity-90"}`}>
          {scriptsLoading ? "Writing 3 scripts…" : scripts.length ? "Start over — write 3 new scripts" : "Generate 3 scripts"}
        </button>
      </div>

      {err && <p className="text-xs text-alert">⚠ {err}</p>}

      {/* ── Step 1 · script cards ── */}
      {scripts.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold text-fg">1 · Pick a script angle</p>
            <button onClick={() => genScripts(true)} disabled={busy} className="text-[11px] font-medium text-white bg-accent rounded-md px-3 py-1.5 disabled:opacity-40">{scriptsLoading ? "Regenerating…" : "Regenerate 3 scripts"}</button>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {scripts.map((s, i) => (
              <button key={i} type="button" onClick={() => { setChosenScript(i); resetFromPersonas(); }} disabled={busy}
                className={`text-left rounded-lg border p-3 transition-colors ${chosenScript === i ? "border-accent ring-1 ring-accent bg-accent-soft/30" : "border-line hover:border-accent/40"}`}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-accent">{s.label}</p>
                <p className="text-xs text-fg-dim mt-1.5 leading-snug">{s.content}</p>
                <p className="text-[10px] text-fg-mute mt-2">✓ {s.wordCount} words · ~{secondsFor(s.wordCount)}s of 15s</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 2 · persona grid ── */}
      {chosenScript >= 0 && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold text-fg">2 · Cast a creator {personas.length > 0 && <span className="font-normal text-fg-mute">— pick one</span>}</p>
            {personas.length > 0
              ? <button onClick={genPersonas} disabled={busy} className="text-[11px] font-medium text-white bg-accent rounded-md px-3 py-1.5 disabled:opacity-40">{personasLoading ? "Regenerating…" : "Regenerate 4 personas"}</button>
              : <button onClick={genPersonas} disabled={busy || productImages.length < 2} className="text-[11px] font-medium text-white bg-accent rounded-md px-3 py-1.5 disabled:opacity-40">{personasLoading ? "Casting…" : "Generate 4 personas"}</button>}
          </div>
          {personasLoading && personas.length === 0 && <p className="text-[11px] text-fg-mute">Rendering 4 portraits on Seedream 5 Pro… (~2–4 min)</p>}
          {personas.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {personas.map((p, i) => {
                const usable = !!p.imageDataUrl;
                return (
                  <button key={i} type="button" onClick={() => usable && setChosenPersona(i)} disabled={busy || !usable}
                    className={`text-left rounded-lg border overflow-hidden transition-colors ${!usable ? "border-line opacity-70 cursor-not-allowed" : chosenPersona === i ? "border-accent ring-1 ring-accent" : "border-line hover:border-accent/40"}`}>
                    {usable
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.imageDataUrl} alt={p.name} className="w-full aspect-[3/4] object-cover bg-black" />
                      : <div className="w-full aspect-[3/4] bg-surface-2 p-2 overflow-auto"><p className="text-[9px] text-red-500 leading-tight">Portrait failed: {p.qcNotes}</p></div>}
                    <div className="p-2">
                      {p.provider && <p className="text-[9px] font-semibold uppercase tracking-wide text-accent-2">{p.provider}</p>}
                      <p className="text-xs font-semibold text-fg truncate">{p.name}</p>
                      {typeof p.qcScore === "number" && <p className={`text-[10px] ${qcColor(p.qcScore)}`}>✓ QC {p.qcScore}/100</p>}
                      {p.qcNotes && usable && <p className="text-[9px] text-fg-mute leading-tight mt-0.5 line-clamp-2">{p.qcNotes}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {chosenPersona >= 0 && personas[chosenPersona]?.imageDataUrl && (
            <button onClick={renderVideo} disabled={busy} className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${busy ? "bg-surface-2 text-fg-mute cursor-not-allowed" : "bg-accent text-white hover:opacity-90"}`}>
              {rendering ? "Rendering the video…" : `3 · Render video with ${personas[chosenPersona].name}`}
            </button>
          )}
        </div>
      )}

      {/* ── Step 3 · render progress + output ── */}
      {(rendering || renderLog.length > 0) && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
          <div className="flex flex-wrap gap-1.5">{(["voice", "video"] as const).map(k => {
            const active = activePhase === k; const done = renderLog.some(l => l.startsWith(k)) && !active;
            return <span key={k} className={`text-[10px] px-2 py-0.5 rounded-full border capitalize ${active ? "border-accent bg-accent-soft text-accent" : done ? "border-accent-2/40 bg-accent-2-soft text-accent-2" : "border-line text-fg-mute"}`}>{active && <span className="inline-block w-2 h-2 mr-1 border border-accent border-t-transparent rounded-full animate-spin align-middle" />}{k}</span>;
          })}</div>
          <pre className="text-[11px] leading-relaxed text-fg-dim whitespace-pre-wrap max-h-32 overflow-auto">{renderLog.join("\n")}</pre>
        </div>
      )}

      {(videoUrl || audioUrl) && (
        <div className="rounded-xl border border-accent/30 bg-accent-soft/30 p-4 space-y-3">
          <p className="text-sm font-semibold text-fg">Output</p>
          {videoUrl && (
            <div className="max-w-xs">
              <div className="rounded-lg border border-line overflow-hidden bg-surface">
                <video src={videoUrl} controls playsInline className="w-full aspect-[9/16] object-cover bg-black" />
                <a href={videoUrl} target="_blank" rel="noreferrer" className="block text-[11px] text-accent px-2 py-1 hover:underline">Open / download</a>
              </div>
            </div>
          )}
          {audioUrl && <audio src={audioUrl} controls className="w-full h-8 max-w-xs" />}
        </div>
      )}
      </>)}
    </div>
  );
}
