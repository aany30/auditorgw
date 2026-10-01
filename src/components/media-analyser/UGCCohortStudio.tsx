
import { useState } from "react";
import type { BrandAnalyzeResponse, AnalyzeMode } from "@/lib/media-analyser/api-types";
import type { CohortPersonasResponse } from "@/lib/media-analyser/api-types";
import type { CohortScriptResponse } from "@/lib/media-analyser/api-types";
import type { UGCRenderUpdate } from "@/lib/media-analyser/api-types";
import type { CharacterWorldResponse } from "@/lib/media-analyser/api-types";
import type { UGCCharacterResponse } from "@/lib/media-analyser/api-types";
import type { BrandAnalysis, Cohort, CohortPersona } from "@/lib/media-analyser/ugc-new/cohort-studio";
import type { PenPortraitResponse } from "@/lib/media-analyser/api-types";
import { renderPenPortraitHtml } from "@/lib/media-analyser/ugc-new/pen-portrait";
import { savePersona } from "@/lib/media-analyser/ugc/persona-store";

const UGC_SECONDS = 30;

/** Run async workers over items with a small concurrency cap (keeps ARK from rate-limiting). */
async function pool<T>(items: T[], size: number, worker: (item: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx], idx); }
  }));
}

export function UGCCohortStudio() {
  const [url, setUrl] = useState("");
  const [country, setCountry] = useState("");
  const [mode, setMode] = useState<AnalyzeMode>("normal");
  const [err, setErr] = useState("");

  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<BrandAnalysis | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [engine, setEngine] = useState("");

  const [chosenCohort, setChosenCohort] = useState(-1);
  const [personasLoading, setPersonasLoading] = useState(false);
  const [personas, setPersonas] = useState<CohortPersona[]>([]);
  const [portraits, setPortraits] = useState<Record<string, string>>({});
  const [portraitBusy, setPortraitBusy] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, "saving" | "saved" | "error">>({});

  const [chosen, setChosen] = useState<string>("");
  const [docBusy, setDocBusy] = useState(false);
  const [penBusy, setPenBusy] = useState<Record<string, boolean>>({});
  const [penHtml, setPenHtml] = useState("");
  const [penName, setPenName] = useState("");
  // Character world (step 3) — keyed by persona id; worldPersonaId is the one under review.
  const [worlds, setWorlds] = useState<Record<string, CharacterWorldResponse>>({});
  const [worldBusy, setWorldBusy] = useState<Record<string, boolean>>({});
  const [worldPersonaId, setWorldPersonaId] = useState<string>("");
  const [scriptLoading, setScriptLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderLog, setRenderLog] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState("");

  const worldMaking = Object.values(worldBusy).some(Boolean);
  const busy = analyzing || personasLoading || worldMaking || scriptLoading || rendering;

  const analyze = async () => {
    if (busy || !url.trim()) return;
    setAnalyzing(true); setErr(""); setAnalysis(null); setCohorts([]);
    setChosenCohort(-1); setPersonas([]); setPortraits({}); setSaved({}); setChosen(""); setVideoUrl(""); setRenderLog([]);
    setWorlds({}); setWorldBusy({}); setWorldPersonaId("");
    try {
      const res = await fetch("/api/media-analyser/ugc-new-brand-analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim(), country: country.trim(), mode }) });
      const data = (await res.json().catch(() => ({}))) as BrandAnalyzeResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setAnalysis(data.analysis); setCohorts(data.cohorts); setEngine(data.engine);
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setAnalyzing(false); }
  };

  // Generate a portrait for one persona (reuses the character route; ARK Seedream 5 Pro).
  const genPortrait = async (p: CohortPersona) => {
    setPortraitBusy(b => ({ ...b, [p.id]: true }));
    try {
      const res = await fetch("/api/media-analyser/ugc-ads-character", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        traits: { gender: p.gender, ageRange: p.ageRange, ethnicity: p.ethnicity, skinTone: "", hair: "", eyes: "", distinguishingMark: "", build: "", name: p.name },
        details: [p.description, p.traits].filter(Boolean).join(". ").slice(0, 400), aspect: "9:16", count: 1, style: "real", provider: "ark",
      }) });
      const d = (await res.json().catch(() => ({}))) as Partial<UGCCharacterResponse> & { error?: string };
      const u = d.imageDataUrls?.length ? d.imageDataUrls[0] : d.imageDataUrl;
      if (u) setPortraits(m => ({ ...m, [p.id]: u }));
    } catch { /* leave without portrait */ }
    finally { setPortraitBusy(b => ({ ...b, [p.id]: false })); }
  };

  const getPersonas = async (cohortIdx: number) => {
    if (busy || !analysis) return;
    setChosenCohort(cohortIdx); setPersonas([]); setPortraits({}); setSaved({}); setChosen(""); setVideoUrl(""); setRenderLog([]);
    setWorlds({}); setWorldBusy({}); setWorldPersonaId("");
    setPersonasLoading(true); setErr("");
    try {
      const res = await fetch("/api/media-analyser/ugc-new-cohort-personas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysis, cohort: cohorts[cohortIdx], country: country.trim() }) });
      const data = (await res.json().catch(() => ({}))) as CohortPersonasResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Persona suggestion failed");
      setPersonas(data.personas);
      setPersonasLoading(false);
      // Generate portraits (2 at a time) so cards fill in with faces.
      pool(data.personas, 2, genPortrait);
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); setPersonasLoading(false); }
  };

  const savePersonaCard = async (p: CohortPersona) => {
    const img = portraits[p.id];
    if (!img) { setErr("Give it a second — the portrait is still generating."); return; }
    setSaved(s => ({ ...s, [p.id]: "saving" }));
    try {
      await savePersona({ name: p.name, style: "real", source: "create", images: [img], traits: { gender: p.gender, ageRange: p.ageRange, ethnicity: p.ethnicity, concern: p.concern, angle: p.angle } as Record<string, unknown>, details: [p.description, p.concern].filter(Boolean).join(" · ") });
      setSaved(s => ({ ...s, [p.id]: "saved" }));
    } catch { setSaved(s => ({ ...s, [p.id]: "error" })); }
  };

  // Expand a persona into the full "World + Persona" pen-portrait board (Fable).
  const generatePenPortrait = async (p: CohortPersona) => {
    if (!analysis || penBusy[p.id]) return;
    setPenBusy(b => ({ ...b, [p.id]: true })); setErr("");
    try {
      const res = await fetch("/api/media-analyser/ugc-new-pen-portrait", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysis, cohort: cohorts[chosenCohort], persona: p, country: country.trim() }) });
      const data = (await res.json().catch(() => ({}))) as PenPortraitResponse & { error?: string };
      if (!res.ok || !data.portrait) throw new Error(data.error ?? "Pen portrait failed");
      const html = renderPenPortraitHtml(data.portrait, { brand: analysis.brandName || "Brand", productSub: analysis.products?.slice(0, 40) || "", gender: p.gender });
      setPenHtml(html); setPenName(p.name);
      if (typeof window !== "undefined") setTimeout(() => document.getElementById("pen-board")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setPenBusy(b => ({ ...b, [p.id]: false })); }
  };

  const downloadPenPortrait = () => {
    if (!penHtml) return;
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([penHtml], { type: "text/html" }));
    link.download = `${penName.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "persona"}-pen-portrait.html`;
    link.click(); URL.revokeObjectURL(link.href);
  };

  // Step 3 — build the persona's character world (Claude bio + GPT-Image scene), then review.
  const genWorld = async (p: CohortPersona) => {
    if (busy || !analysis || chosenCohort < 0) return;
    const portrait = portraits[p.id];
    if (!portrait) { setErr("That persona's portrait is still generating — try again in a moment."); return; }
    setWorldBusy(b => ({ ...b, [p.id]: true })); setErr(""); setVideoUrl(""); setRenderLog([]); setChosen("");
    try {
      const res = await fetch("/api/media-analyser/ugc-new-character-world", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysis, cohort: cohorts[chosenCohort], persona: p, portraitDataUrl: portrait, country: country.trim() }) });
      const data = (await res.json().catch(() => ({}))) as CharacterWorldResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Character world failed");
      setWorlds(w => ({ ...w, [p.id]: data })); setWorldPersonaId(p.id);
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setWorldBusy(b => ({ ...b, [p.id]: false })); }
  };

  const selectAndRender = async (p: CohortPersona) => {
    if (busy || !analysis) return;
    const portrait = portraits[p.id];
    if (!portrait) { setErr("That persona's portrait is still generating — try again in a moment."); return; }
    const worldImageDataUrl = worlds[p.id]?.worldImageDataUrl ?? "";
    setChosen(p.id); setScriptLoading(true); setErr(""); setVideoUrl(""); setRenderLog([]);
    try {
      const sres = await fetch("/api/media-analyser/ugc-new-cohort-script", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysis, cohort: cohorts[chosenCohort], persona: p }) });
      const sdata = (await sres.json().catch(() => ({}))) as CohortScriptResponse & { error?: string };
      if (!sres.ok) throw new Error(sdata.error ?? "Script generation failed");
      setScriptLoading(false); setRendering(true);
      const res = await fetch("/api/media-analyser/ugc-new-render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personaImageDataUrl: portrait, worldImageDataUrl, personaName: p.name, personaDescription: p.description, scriptContent: sdata.script, timeOfDay: "12:00", durationSec: UGC_SECONDS }) });
      if (!res.ok || !res.body) { const e = (await res.json().catch(() => ({}))) as { error?: string }; throw new Error(e.error ?? "Render failed"); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find(l => l.startsWith("data: ")); if (!line) continue;
          let u: UGCRenderUpdate; try { u = JSON.parse(line.slice(6)); } catch { continue; }
          if (u.phase === "error") { setErr(u.message ?? "Render failed"); continue; }
          if (u.message) setRenderLog(l => [...l, `${u.phase}: ${u.message}`]);
          if (u.videoUrl) setVideoUrl(u.videoUrl);
        }
      }
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setScriptLoading(false); setRendering(false); }
  };

  const downloadReport = () => {
    if (!analysis) return;
    const a = analysis;
    const rows = (label: string, v?: string) => v ? `<tr><th>${label}</th><td>${escapeHtml(v)}</td></tr>` : "";
    const cohortsHtml = cohorts.map((c, i) => `<li${i === chosenCohort ? ' class="sel"' : ""}><b>${escapeHtml(c.name)}</b>${i === chosenCohort ? " — selected" : ""}<br><span>${escapeHtml(c.description)}</span></li>`).join("");
    const personasHtml = personas.map(p => `<div class="p"><b>${escapeHtml(p.name)}</b> <span class="meta">${escapeHtml([p.gender, p.ageRange, p.ethnicity].filter(Boolean).join(" · "))}</span><br><span class="d">${escapeHtml(p.description)}</span><br><span class="c"><b>Concern:</b> ${escapeHtml(p.concern)}</span><br><span class="c"><b>Angle:</b> ${escapeHtml(p.angle)}</span></div>`).join("");
    const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(a.brandName || "Brand")} — Cohort Studio analysis</title>
<style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:820px;margin:40px auto;padding:0 24px;color:#17181B;line-height:1.55}h1{letter-spacing:-.02em}h2{margin-top:32px;border-bottom:1px solid #E7E6E1;padding-bottom:6px}table{border-collapse:collapse;width:100%}th{text-align:left;color:#6A6E74;font-weight:600;width:180px;vertical-align:top;padding:6px 12px 6px 0;font-size:13px}td{padding:6px 0}ul{list-style:none;padding:0}li{border:1px solid #E7E6E1;border-radius:8px;padding:10px 12px;margin:6px 0}li.sel{border-color:#0F7A66;background:#E7F1EE}li span{color:#6A6E74;font-size:14px}.p{border:1px solid #E7E6E1;border-radius:8px;padding:10px 12px;margin:6px 0}.meta{color:#9A9DA3;font-size:12px}.d{color:#444}.c{color:#6A6E74;font-size:14px}small{color:#9A9DA3}</style>
<h1>${escapeHtml(a.brandName || "Brand")} — Cohort Studio analysis</h1>
<small>${escapeHtml(url)} · reasoning: ${escapeHtml(engine)}${country ? ` · market: ${escapeHtml(country)}` : ""}</small>
<h2>Brand analysis</h2><table>${rows("Visual identity", a.brandImage)}${rows("Products", a.products)}${rows("Creators used", a.charactersUsed)}${rows("Audience", a.targetAudience)}${rows("Features", (a.features || []).join(" · "))}</table>
<h2>Cohorts suggested</h2><ul>${cohortsHtml}</ul>
${personas.length ? `<h2>Personas${chosenCohort >= 0 ? ` — ${escapeHtml(cohorts[chosenCohort].name)}` : ""}</h2>${personasHtml}` : ""}`;
    const blob = new Blob([html], { type: "text/html" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `${(a.brandName || "brand").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-cohort-analysis.html`;
    link.click(); URL.revokeObjectURL(link.href);
  };

  // Generate the Cohort → Persona → Pen Portrait strategy document (Claude) and download as Word.
  const downloadStrategyDoc = async () => {
    if (!analysis || docBusy) return;
    setDocBusy(true); setErr("");
    try {
      const personaGroups = chosenCohort >= 0 && personas.length ? [{ cohort: cohorts[chosenCohort], personas }] : [];
      const res = await fetch("/api/media-analyser/ugc-new-cohort-doc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysis, country: country.trim(), cohorts, personaGroups }) });
      const data = (await res.json().catch(() => ({}))) as { markdown?: string; error?: string };
      if (!res.ok || !data.markdown) throw new Error(data.error ?? "Document generation failed");
      const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${escapeHtml(analysis.brandName || "Brand")} — TG Strategy</title><style>body{font-family:Calibri,Arial,sans-serif;color:#1a1a1a;line-height:1.5;max-width:800px}h1{font-size:24pt;margin-bottom:2px}h2{font-size:15pt;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:24px}h3{font-size:12pt;margin-top:16px}.sub{color:#666;font-style:italic}li{margin:2px 0}</style></head><body>${mdToHtml(data.markdown)}</body></html>`;
      const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([html], { type: "application/msword" }));
      link.download = `${(analysis.brandName || "brand").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-tg-strategy.doc`;
      link.click(); URL.revokeObjectURL(link.href);
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setDocBusy(false); }
  };

  const card = (active: boolean) => `text-left rounded-lg border p-3 transition-colors ${active ? "border-accent ring-1 ring-accent bg-accent-soft/30" : "border-line hover:border-accent/40"}`;

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-fg-dim leading-snug">Paste a product link. Claude analyses the brand + imagery, suggests <b>cohorts</b> → pick one for <b>5–6 country-specific personas</b> (portrait · description · concern) you can save → build a persona’s <b>character world</b> (Claude bio + GPT-Image scene) → render a <b>{UGC_SECONDS}s</b> UGC. {engine && <span className="text-fg-mute">· reasoning: {engine}</span>}</p>

      {/* URL + country + mode */}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={url} onChange={e => setUrl(e.target.value)} disabled={busy} placeholder="Product / brand URL" onKeyDown={e => { if (e.key === "Enter") analyze(); }}
          className="flex-1 min-w-[220px] text-xs rounded-md border border-line px-2 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
        <input value={country} onChange={e => setCountry(e.target.value)} disabled={busy} placeholder="Country / market (optional — auto-detects)"
          className="w-[220px] text-xs rounded-md border border-line px-2 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
        <button onClick={analyze} disabled={busy || !url.trim()} className="text-xs font-medium text-white bg-accent rounded-md px-4 py-2 disabled:opacity-40">{analyzing ? "Analyzing…" : "Analyze brand"}</button>
      </div>

      {/* Analysis mode: Normal (Sonnet) vs Deep (Fable) */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium text-fg-mute">Analysis mode</span>
        <div className="inline-flex rounded-md border border-line overflow-hidden text-[11px]">
          {([["normal", "Normal", "Sonnet"], ["deep", "Deep", "Fable"]] as const).map(([m, label, sub]) => (
            <button key={m} type="button" onClick={() => setMode(m)} disabled={busy}
              className={`px-3 py-1.5 transition-colors disabled:opacity-50 ${mode === m ? "bg-accent text-white" : "bg-surface text-fg-dim hover:bg-accent-soft/40"}`}>
              <span className="font-medium">{label}</span> <span className={mode === m ? "text-white/70" : "text-fg-mute"}>· {sub}</span>
            </button>
          ))}
        </div>
        <span className="text-[10px] text-fg-mute">{mode === "deep" ? "Slower, more thorough — reads more imagery." : "Fast pass for a quick read."}</span>
      </div>

      {err && <p className="text-xs text-alert">⚠ {err}</p>}

      {/* Analysis + cohorts */}
      {analysis && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold text-fg">{analysis.brandName || "Brand"} — analysis</p>
            <button onClick={downloadReport} className="text-[11px] font-medium text-accent border border-accent/40 rounded-md px-2.5 py-1 hover:bg-accent-soft">↓ Download analysis</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-fg-dim">
            {analysis.brandImage && <p><span className="text-fg-mute">Visual identity:</span> {analysis.brandImage}</p>}
            {analysis.targetAudience && <p><span className="text-fg-mute">Audience:</span> {analysis.targetAudience}</p>}
            {analysis.charactersUsed && <p><span className="text-fg-mute">Creators used:</span> {analysis.charactersUsed}</p>}
            {analysis.features?.length > 0 && <p><span className="text-fg-mute">Features:</span> {analysis.features.join(", ")}</p>}
          </div>
          <div>
            <p className="text-[11px] font-semibold text-fg-mute mb-1.5">1 · Pick a cohort</p>
            <div className="grid sm:grid-cols-3 gap-2">
              {cohorts.map((c, i) => (
                <button key={c.id} type="button" onClick={() => getPersonas(i)} disabled={busy} className={card(chosenCohort === i)}>
                  <p className="text-xs font-bold text-fg">{c.name}</p>
                  {c.description && <p className="text-[11px] text-fg-dim mt-0.5 leading-snug">{c.description}</p>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Personas — 5-6 cards with portrait · description · concern · save */}
      {chosenCohort >= 0 && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[11px] font-semibold text-fg-mute">2 · Personas in “{cohorts[chosenCohort]?.name}” {country && <span className="font-normal text-fg-mute">· {country}</span>}</p>
            {personas.length > 0 && (
              <button onClick={downloadStrategyDoc} disabled={docBusy} className="text-[11px] font-medium text-white bg-accent rounded-md px-2.5 py-1 disabled:opacity-50 flex items-center gap-1.5">
                {docBusy && <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}{docBusy ? "Writing doc…" : "↓ Download strategy doc"}
              </button>
            )}
          </div>
          {personasLoading && <p className="text-[11px] text-fg-mute">Claude is drafting 5–6 personas…</p>}
          {personas.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {personas.map(p => {
                const img = portraits[p.id]; const loading = portraitBusy[p.id];
                return (
                  <div key={p.id} className={`rounded-lg border overflow-hidden ${chosen === p.id ? "border-accent ring-1 ring-accent" : "border-line"}`}>
                    {img
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={img} alt={p.name} className="w-full aspect-[3/4] object-cover bg-black" />
                      : <div className="w-full aspect-[3/4] bg-surface-2 flex items-center justify-center text-[10px] text-fg-mute">{loading ? <span className="w-4 h-4 border-2 border-accent/50 border-t-transparent rounded-full animate-spin" /> : "no portrait"}</div>}
                    <div className="p-2 space-y-1">
                      <p className="text-xs font-semibold text-fg leading-tight">{p.name}</p>
                      <p className="text-[10px] text-fg-mute">{[p.gender, p.ageRange, p.ethnicity].filter(Boolean).join(" · ")}</p>
                      {p.description && <p className="text-[11px] text-fg-dim leading-snug">{p.description}</p>}
                      {p.concern && <p className="text-[11px] text-fg-dim leading-snug"><span className="text-accent font-medium">Concern:</span> {p.concern}</p>}
                      <div className="flex items-center flex-wrap gap-2 pt-1">
                        <button onClick={() => generatePenPortrait(p)} disabled={penBusy[p.id]} className="text-[10px] font-medium text-accent border border-accent/40 rounded px-2 py-1 disabled:opacity-50 flex items-center gap-1">
                          {penBusy[p.id] && <span className="w-2.5 h-2.5 border-2 border-accent/60 border-t-transparent rounded-full animate-spin" />}{penBusy[p.id] ? "Building…" : "Pen portrait"}
                        </button>
                        <button onClick={() => genWorld(p)} disabled={busy || !img} className="text-[10px] font-medium text-white bg-accent rounded px-2 py-1 disabled:opacity-40 flex items-center gap-1">
                          {worldBusy[p.id] && <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}
                          {worlds[p.id] ? "Rebuild world" : worldBusy[p.id] ? "Building…" : "Create character world"}
                        </button>
                        <button onClick={() => savePersonaCard(p)} disabled={!img || saved[p.id] === "saving"} className="text-[10px] font-medium text-accent border border-accent/40 rounded px-2 py-1 disabled:opacity-40">
                          {saved[p.id] === "saved" ? "★ Saved" : saved[p.id] === "saving" ? "Saving…" : saved[p.id] === "error" ? "Retry save" : "★ Save"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Character world review (step 3) — scene image + bio, then render */}
      {(() => {
        const wp = personas.find(p => p.id === worldPersonaId);
        const world = wp ? worlds[wp.id] : undefined;
        if (!wp || !world) return null;
        const { bio, worldImageDataUrl } = world;
        return (
          <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
            <p className="text-[11px] font-semibold text-fg-mute">3 · Character world — “{wp.name}”</p>
            <p className="text-[10px] text-fg-mute leading-snug">Review {wp.name}’s world below. This scene goes in as a visual reference for the reel. Happy with it? Render the {UGC_SECONDS}s UGC.</p>
            <div className="grid sm:grid-cols-[180px_1fr] gap-4">
              <div className="rounded-lg border border-line overflow-hidden bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={worldImageDataUrl} alt={`${wp.name} in their world`} className="w-full aspect-[9/16] object-cover" />
              </div>
              <div className="space-y-2 text-[11px] text-fg-dim leading-snug">
                {bio.summary && <p className="text-fg">{bio.summary}</p>}
                {bio.appearance && <p><span className="text-accent font-medium">Appearance:</span> {bio.appearance}</p>}
                {bio.world && <p><span className="text-accent font-medium">World:</span> {bio.world}</p>}
                {bio.likes?.length > 0 && <p><span className="text-accent font-medium">Likes:</span> {bio.likes.join(", ")}</p>}
                {bio.dislikes?.length > 0 && <p><span className="text-accent font-medium">Dislikes:</span> {bio.dislikes.join(", ")}</p>}
                <div className="pt-1">
                  <button onClick={() => selectAndRender(wp)} disabled={busy} className="text-[11px] font-medium text-white bg-accent rounded-md px-3 py-1.5 disabled:opacity-40">
                    {scriptLoading || rendering ? "Rendering…" : `Render ${UGC_SECONDS}s UGC →`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Pen-portrait board — the "World + Persona" strategy dashboard (downloadable) */}
      {penHtml && (
        <div id="pen-board" className="rounded-xl border border-line bg-surface p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[11px] font-semibold text-fg-mute">Pen portrait · {penName}</p>
            <div className="flex items-center gap-2">
              <button onClick={downloadPenPortrait} className="text-[11px] font-medium text-accent border border-accent/40 rounded-md px-2.5 py-1 hover:bg-accent-soft">↓ Download board</button>
              <button onClick={() => { setPenHtml(""); setPenName(""); }} className="text-[11px] font-medium text-fg-mute border border-line rounded-md px-2.5 py-1 hover:bg-surface-2">Close</button>
            </div>
          </div>
          <iframe title={`${penName} pen portrait`} srcDoc={penHtml} className="w-full rounded-lg border border-line bg-white" style={{ height: "1500px" }} />
        </div>
      )}

      {/* Render progress + output */}
      {(scriptLoading || rendering || renderLog.length > 0 || videoUrl) && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
          <p className="text-[11px] font-semibold text-fg-mute">4 · {UGC_SECONDS}s UGC render</p>
          {(scriptLoading || rendering) && <p className="text-[11px] text-fg-mute">{scriptLoading ? "Claude is writing the script…" : "Rendering on Seedance 2.5… (a few minutes)"}</p>}
          {renderLog.length > 0 && <pre className="text-[11px] leading-relaxed text-fg-dim whitespace-pre-wrap max-h-28 overflow-auto">{renderLog.join("\n")}</pre>}
          {videoUrl && (
            <div className="max-w-xs">
              <div className="rounded-lg border border-line overflow-hidden bg-surface">
                <video src={videoUrl} controls playsInline className="w-full aspect-[9/16] object-cover bg-black" />
                <a href={videoUrl} target="_blank" rel="noreferrer" className="block text-[11px] text-accent px-2 py-1 hover:underline">Open / download</a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Minimal markdown → HTML for the strategy doc (headings, bold, italics, bullets, blockquote). */
function mdToHtml(md: string): string {
  const inline = (s: string) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/_(.+?)_/g, "<i>$1</i>");
  const out: string[] = []; let inList = false;
  const close = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd(); let m: RegExpMatchArray | null;
    if (!line.trim()) { close(); continue; }
    if ((m = line.match(/^###\s+(.*)/))) { close(); out.push(`<h3>${inline(m[1])}</h3>`); }
    else if ((m = line.match(/^##\s+(.*)/))) { close(); out.push(`<h2>${inline(m[1])}</h2>`); }
    else if ((m = line.match(/^#\s+(.*)/))) { close(); out.push(`<h1>${inline(m[1])}</h1>`); }
    else if ((m = line.match(/^>\s?(.*)/))) { close(); out.push(`<p class="sub">${inline(m[1])}</p>`); }
    else if ((m = line.match(/^[-*]\s+(.*)/))) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(m[1])}</li>`); }
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close(); return out.join("\n");
}
