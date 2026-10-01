
import { useCallback, useEffect, useRef, useState } from "react";
import ModelSelect from "@/components/media-analyser/ModelSelect";
import {
  GENDER_OPTIONS, AGE_OPTIONS, ETHNICITY_OPTIONS, SKIN_TONE_OPTIONS,
  ANIMATED_STYLE_OPTIONS, ANGLE_OPTIONS,
  type CharacterTraits, type CharacterStyle,
} from "@/lib/media-analyser/ugc/character-prompt";
import type { UGCCharacterResponse } from "@/lib/media-analyser/api-types";
import type { UGCCharacterAnglesResponse } from "@/lib/media-analyser/api-types";
import type { UGCCohortsResponse } from "@/lib/media-analyser/api-types";
import type { Cohort } from "@/lib/media-analyser/ugc/cohort-prompt";
import {
  listPersonas, savePersona, removePersona, appendPersonaImages, type UGCPersona,
} from "@/lib/media-analyser/ugc/persona-store";

// Top-level talent source: PERSONA (create / saved) · COHORT (deck → 1 creator) · UPLOAD (photo / reference).
type Group = "persona" | "cohort" | "upload";
type Source = "create" | "upload" | "reference"; // effective character-route mode

interface ModelImage { id: string; dataUrl: string; name: string }

interface Props {
  modelImages: ModelImage[];
  onAddDataUrls: (dataUrls: string[], label?: string) => void;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveImage: (id: string) => void;
  freeSlots: number;
  maxModel: number;
  busy: boolean;
  aspect: "9:16" | "1:1" | "4:5" | "16:9";
  brandProduct: string;
  productFeatures: string;
  renderEngine: "ark" | "fal";
}

function friendly(e: unknown): string {
  const m = String(e instanceof Error ? e.message : e);
  if (/network error|failed to fetch|load failed/i.test(m)) return "Network error reaching the server — the images may be too large. Try again.";
  return m;
}
const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("read failed")); r.readAsDataURL(f); });

export default function PersonaBuilder({
  modelImages, onAddDataUrls, onAddFiles, onRemoveImage,
  freeSlots, maxModel, busy, aspect, brandProduct, productFeatures, renderEngine,
}: Props) {
  // ── tabs ──
  const [group, setGroup] = useState<Group>("persona");
  const [personaTab, setPersonaTab] = useState<"create" | "saved">("create");
  const [uploadTab, setUploadTab] = useState<"character" | "reference">("character");
  // Effective character-route mode derived from the tab selection.
  const source: Source = group === "upload" ? (uploadTab === "reference" ? "reference" : "upload") : "create";

  // ── persona identity + create form ──
  const [name, setName] = useState("");
  const [style, setStyle] = useState<CharacterStyle>("real");
  const [animatedStyle, setAnimatedStyle] = useState("");
  const [traits, setTraits] = useState<CharacterTraits>({ gender: "", ageRange: "", ethnicity: "", skinTone: "", hair: "", eyes: "", distinguishingMark: "", build: "", name: "" });
  const [details, setDetails] = useState("");
  const [castFromBrand, setCastFromBrand] = useState(true);
  const [refUrls, setRefUrls] = useState<string[]>(["", "", ""]);

  const [charBusy, setCharBusy] = useState(false);
  const [charError, setCharError] = useState("");
  const [lastGenerated, setLastGenerated] = useState<string[]>([]);
  const [lastQc, setLastQc] = useState<{ score?: number; notes?: string } | null>(null);

  // ── saved library ──
  const [personas, setPersonas] = useState<UGCPersona[]>([]);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [angleFor, setAngleFor] = useState<string | null>(null);
  const [angleSel, setAngleSel] = useState<Set<string>>(new Set());
  const [angleBusy, setAngleBusy] = useState(false);
  const [angleError, setAngleError] = useState("");

  // ── cohort ──
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [cohortBusy, setCohortBusy] = useState(false);
  const [cohortError, setCohortError] = useState("");
  const [cohortFileName, setCohortFileName] = useState("");
  const [cohortCasting, setCohortCasting] = useState<string | null>(null);

  const uploadRef = useRef<HTMLInputElement>(null);
  const cohortRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    listPersonas().then(p => { if (alive) setPersonas(p); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const brandCtx = () => {
    if (!castFromBrand) return undefined;
    const bp = brandProduct.trim(); const pf = productFeatures.trim();
    if (!bp && !pf) return undefined;
    return { product: bp || pf.split("\n")[0].slice(0, 120), moodDirection: pf.slice(0, 400) || undefined };
  };

  // ── generate a character (create / reference) ──
  const generate = useCallback(async () => {
    if (charBusy || busy || freeSlots <= 0) return;
    const references = refUrls.map(s => s.trim()).filter(Boolean);
    if (source === "reference" && !references.length) { setCharError("Paste at least one Instagram post link to match."); return; }
    setCharBusy(true); setCharError(""); setSaveMsg("");
    try {
      const res = await fetch("/api/media-analyser/ugc-ads-character", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traits, details: details.trim(), aspect, count: Math.min(2, freeSlots), style,
          animatedStyle: style === "animated" ? animatedStyle : undefined,
          referenceUrls: source === "reference" ? references : undefined,
          productContext: style === "real" ? brandCtx() : undefined,
          provider: renderEngine,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<UGCCharacterResponse> & { error?: string };
      const urls = data.imageDataUrls?.length ? data.imageDataUrls : data.imageDataUrl ? [data.imageDataUrl] : [];
      if (!res.ok || !urls.length) throw new Error(data.error ?? "Could not create the character");
      setLastGenerated(urls);
      setLastQc(typeof data.qcScore === "number" ? { score: data.qcScore, notes: data.qcNotes } : null);
      onAddDataUrls(urls, "Generated character");
    } catch (e) { setCharError(friendly(e)); }
    finally { setCharBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charBusy, busy, freeSlots, refUrls, source, traits, details, aspect, style, animatedStyle, brandProduct, productFeatures, castFromBrand, onAddDataUrls, renderEngine]);

  // ── COHORT: upload a deck/image → extract segments ──
  const onCohortFile = async (file: File) => {
    setCohortBusy(true); setCohortError(""); setCohorts([]); setCohortFileName(file.name);
    try {
      const documentDataUrl = await fileToDataUrl(file);
      const res = await fetch("/api/media-analyser/ugc-ads-cohorts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentDataUrl, fileName: file.name }) });
      const data = (await res.json().catch(() => ({}))) as Partial<UGCCohortsResponse> & { error?: string };
      if (!res.ok || !data.cohorts?.length) throw new Error(data.error ?? "No cohorts found in that document.");
      setCohorts(data.cohorts);
    } catch (e) { setCohortError(friendly(e)); }
    finally { setCohortBusy(false); }
  };

  // ── COHORT: cast one creator from a picked segment ──
  const castFromCohort = async (c: Cohort) => {
    if (freeSlots <= 0 || cohortCasting || busy) return;
    setCohortCasting(c.id); setCohortError(""); setSaveMsg("");
    try {
      const res = await fetch("/api/media-analyser/ugc-ads-character", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traits: { gender: c.character.gender, ageRange: c.character.ageRange, ethnicity: c.character.ethnicity, skinTone: "", hair: "", eyes: "", distinguishingMark: "", build: "", name: c.personaName },
          details: [c.character.details, c.scriptBrief].filter(Boolean).join(". ").slice(0, 500),
          aspect, count: Math.min(2, freeSlots), style: "real",
          productContext: brandCtx(), provider: renderEngine,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<UGCCharacterResponse> & { error?: string };
      const urls = data.imageDataUrls?.length ? data.imageDataUrls : data.imageDataUrl ? [data.imageDataUrl] : [];
      if (!res.ok || !urls.length) throw new Error(data.error ?? "Could not cast a creator from that cohort.");
      setLastGenerated(urls);
      setLastQc(typeof data.qcScore === "number" ? { score: data.qcScore, notes: data.qcNotes } : null);
      if (!name.trim()) setName(c.personaName);
      onAddDataUrls(urls, c.name);
    } catch (e) { setCohortError(friendly(e)); }
    finally { setCohortCasting(null); }
  };

  // ── save / reuse ──
  const doSave = useCallback(async () => {
    const images = lastGenerated.length ? lastGenerated : modelImages.map(m => m.dataUrl);
    if (!images.length) { setSaveMsg("Generate or add a character first."); return; }
    setSaveBusy(true); setSaveMsg("");
    try {
      const saved = await savePersona({
        name: name.trim() || "Untitled persona", style,
        animatedStyle: style === "animated" ? animatedStyle : undefined, source, images,
        traits: traits as unknown as Record<string, unknown>, details: details.trim() || undefined,
        productContext: brandCtx() as Record<string, unknown> | undefined,
      });
      setPersonas(prev => [saved, ...prev.filter(p => p.id !== saved.id)]);
      setSaveMsg(`Saved “${saved.name}” to your library.`);
    } catch (e) { setSaveMsg(friendly(e)); }
    finally { setSaveBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastGenerated, modelImages, name, style, animatedStyle, source, traits, details, brandProduct, productFeatures, castFromBrand]);

  const applyPersona = (p: UGCPersona) => {
    if (freeSlots <= 0) return;
    onAddDataUrls(p.images.slice(0, Math.max(1, freeSlots)), p.name);
    if (!name.trim()) setName(p.name);
    setStyle(p.style);
    if (p.animatedStyle) setAnimatedStyle(p.animatedStyle);
  };
  const deletePersona = async (id: string) => { setPersonas(prev => prev.filter(p => p.id !== id)); await removePersona(id).catch(() => {}); };

  const toggleAngle = (id: string) => setAngleSel(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const generateAngles = async (p: UGCPersona) => {
    if (angleBusy || !angleSel.size) return;
    setAngleBusy(true); setAngleError("");
    try {
      const res = await fetch("/api/media-analyser/ugc-ads-character-angles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceImageDataUrl: p.images[0], angles: Array.from(angleSel).slice(0, 3), style: p.style, animatedStyle: p.animatedStyle }) });
      const data = (await res.json().catch(() => ({}))) as Partial<UGCCharacterAnglesResponse> & { error?: string };
      if (!res.ok || !data.imageDataUrls?.length) throw new Error(data.error ?? "Could not generate angles.");
      const updated = await appendPersonaImages(p, data.imageDataUrls);
      setPersonas(prev => [updated, ...prev.filter(x => x.id !== p.id && x.id !== updated.id)]);
      setAngleFor(null); setAngleSel(new Set());
    } catch (e) { setAngleError(friendly(e)); }
    finally { setAngleBusy(false); }
  };

  const canGenerate = freeSlots > 0 && !charBusy && !busy;
  const budgetNote = freeSlots <= 0 ? (modelImages.length >= maxModel ? `Max ${maxModel} talent shots.` : "Image budget full — remove a product or talent photo to add more.") : "";
  const tabBtn = (active: boolean) => `px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${active ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-semibold text-fg">Persona / talent <span className="font-normal text-fg-mute">(optional)</span></p>
        <p className="text-[11px] text-fg-mute leading-snug">The character who appears in the ad. Create or reuse a persona, derive one from a cohort deck, or upload a photo/reference. Leave empty and the Director invents a fitting creator.</p>
      </div>

      {/* persona name */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-fg-dim">Persona name <span className="text-fg-mute">(optional — used when you save)</span></label>
        <input type="text" value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="e.g. Maya — travel creator"
          className="w-full max-w-sm text-xs rounded-md border border-line px-2 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
      </div>

      {/* talent preview + save (shared across tabs) */}
      {modelImages.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-3">
            {modelImages.map(img => (
              <div key={img.id} className="relative group w-44 max-w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.dataUrl} alt={img.name} className="w-full aspect-[3/4] object-cover rounded-lg border border-line bg-surface" />
                <button type="button" onClick={() => onRemoveImage(img.id)} disabled={busy} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center disabled:opacity-0" aria-label="Remove">×</button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-[11px] text-fg-mute">{modelImages.length}/{maxModel} talent shots · 2 consistent shots of the same person lock identity best</p>
            {typeof lastQc?.score === "number" && <p className={`text-[11px] ${lastQc.score >= 60 ? "text-accent-2" : "text-alert"}`}>QC {lastQc.score} · {lastQc.notes || "looks good"}</p>}
            <button type="button" onClick={doSave} disabled={saveBusy || busy || !modelImages.length} className="text-[11px] font-medium text-accent hover:text-accent border border-accent/40 rounded-md px-2 py-1 disabled:opacity-40 flex items-center gap-1.5">
              {saveBusy && <span className="w-3 h-3 border-2 border-accent/60 border-t-transparent rounded-full animate-spin" />}{saveBusy ? "Saving…" : "★ Save persona"}
            </button>
          </div>
          {saveMsg && <p className="text-[11px] text-fg-dim">{saveMsg}</p>}
        </div>
      )}

      {/* ── top-level 3-tab bar: PERSONA · COHORT · UPLOAD ── */}
      <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line self-start">
        {(["persona", "cohort", "upload"] as Group[]).map(g => (
          <button key={g} type="button" disabled={busy} onClick={() => { setGroup(g); setCharError(""); }}
            className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors disabled:opacity-40 ${group === g ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
            {g}
          </button>
        ))}
      </div>

      {/* ══════════ PERSONA ══════════ */}
      {group === "persona" && (
        <>
          <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line self-start">
            {(["create", "saved"] as const).map(t => (
              <button key={t} type="button" disabled={busy} onClick={() => setPersonaTab(t)} className={tabBtn(personaTab === t)}>
                {t === "create" ? "Create persona" : `Saved persona${personas.length ? ` · ${personas.length}` : ""}`}
              </button>
            ))}
          </div>

          {/* Create persona */}
          {personaTab === "create" && (
            <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2/50 p-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-fg-dim">Style</label>
                <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line self-start">
                  {(["real", "animated"] as CharacterStyle[]).map(s => (
                    <button key={s} type="button" disabled={charBusy || busy} onClick={() => setStyle(s)} className={tabBtn(style === s)}>{s === "real" ? "Real human" : "Animated character"}</button>
                  ))}
                </div>
                {style === "animated" && <div className="mt-1 max-w-xs"><ModelSelect label="Animation style" options={ANIMATED_STYLE_OPTIONS} value={animatedStyle} onChange={setAnimatedStyle} disabled={charBusy || busy} /></div>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <ModelSelect label="Gender" options={GENDER_OPTIONS} value={traits.gender ?? ""} onChange={v => setTraits(t => ({ ...t, gender: v }))} disabled={charBusy || busy} />
                <ModelSelect label="Age range" options={AGE_OPTIONS} value={traits.ageRange ?? ""} onChange={v => setTraits(t => ({ ...t, ageRange: v }))} disabled={charBusy || busy} />
                <ModelSelect label="Ethnicity" options={ETHNICITY_OPTIONS} value={traits.ethnicity ?? ""} onChange={v => setTraits(t => ({ ...t, ethnicity: v }))} disabled={charBusy || busy} />
                {style === "real" && <ModelSelect label="Skin tone" options={SKIN_TONE_OPTIONS} value={traits.skinTone ?? ""} onChange={v => setTraits(t => ({ ...t, skinTone: v }))} disabled={charBusy || busy} />}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  ["hair", "Hair", "colour · style · part — e.g. dark brown, loose waves, center part"],
                  ["eyes", "Eyes", "colour + shape — e.g. almond dark brown eyes"],
                  ["distinguishingMark", "Distinguishing mark", "optional — e.g. small mole left jawline"],
                  ["build", "Build", "height + body type — e.g. slim, 5'9\""],
                ] as const).map(([key, label, ph]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-fg-dim">{label}</label>
                    <input type="text" value={(traits[key] as string) ?? ""} disabled={charBusy || busy} onChange={e => setTraits(t => ({ ...t, [key]: e.target.value }))} placeholder={ph}
                      className="w-full text-xs rounded-md border border-line px-2 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-fg-dim">Extra details <span className="text-fg-mute">(optional)</span></label>
                <textarea value={details} onChange={e => setDetails(e.target.value)} disabled={charBusy || busy} rows={2} placeholder="e.g. warm smile, casual streetwear"
                  className="w-full text-xs rounded-md border border-line p-2 resize-y focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
              </div>
              {style === "real" && (
                <label className="flex items-start gap-2 text-[11px] text-fg-dim cursor-pointer select-none">
                  <input type="checkbox" checked={castFromBrand} onChange={e => setCastFromBrand(e.target.checked)} disabled={charBusy || busy} className="mt-0.5" />
                  <span>Cast from brand data — make the creator relevant to the product<span className="block text-fg-mute">{(brandProduct.trim() || productFeatures.trim()) ? `Using: ${(brandProduct.trim() || productFeatures.trim().split("\n")[0]).slice(0, 60)}` : "Fetch or describe a product above to use this"}</span></span>
                </label>
              )}
              {canGenerate ? (
                <button type="button" onClick={generate} disabled={charBusy || busy} className="self-start text-xs font-medium text-white bg-accent rounded-lg px-3 py-1.5 disabled:opacity-40 flex items-center gap-2">
                  {charBusy && <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}{charBusy ? (style === "animated" ? "Designing character…" : "Creating character…") : modelImages.length ? "Generate another" : "Generate character"}
                </button>
              ) : <p className="text-[11px] text-fg-mute">{budgetNote}</p>}
              {charError && <p className="text-[11px] text-alert">{charError}</p>}
            </div>
          )}

          {/* Saved persona */}
          {personaTab === "saved" && (
            personas.length === 0
              ? <p className="text-[11px] text-fg-mute rounded-lg border border-line bg-surface-2/40 p-3">No saved personas yet. Create a character, then “★ Save persona” above to reuse it in future reels.</p>
              : <div className="flex flex-col gap-2">
                {personas.map(p => (
                  <div key={p.id} className="rounded-lg border border-line bg-surface p-2">
                    <div className="flex items-start gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.images[0]} alt={p.name} className="w-12 h-16 object-cover rounded-md border border-line bg-surface-2 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-fg truncate">{p.name}</span>
                          <span className="text-[9px] uppercase tracking-wide text-fg-mute border border-line rounded-full px-1.5 py-px">{p.style === "animated" ? "Animated" : "Real"}</span>
                          {p.images.length > 1 && <span className="text-[9px] text-fg-mute">{p.images.length} shots</span>}
                        </div>
                        <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
                          <button type="button" onClick={() => applyPersona(p)} disabled={freeSlots <= 0 || busy} className="text-[11px] font-medium text-white bg-accent rounded-md px-2 py-1 disabled:opacity-40">Add to reel</button>
                          <button type="button" onClick={() => { setAngleFor(angleFor === p.id ? null : p.id); setAngleSel(new Set()); setAngleError(""); }} disabled={busy || angleBusy} className="text-[11px] font-medium text-accent hover:text-accent disabled:opacity-40">+ Add angles</button>
                          <button type="button" onClick={() => deletePersona(p.id)} disabled={busy} className="text-[11px] text-fg-mute hover:text-alert disabled:opacity-40">Delete</button>
                        </div>
                        {angleFor === p.id && (
                          <div className="mt-2 rounded-md border border-line bg-surface-2/60 p-2 flex flex-col gap-2">
                            <p className="text-[10px] text-fg-dim">Pick up to 3 angles (identity-locked to this persona):</p>
                            <div className="flex flex-wrap gap-1.5">
                              {ANGLE_OPTIONS.map(a => (
                                <button key={a.id} type="button" onClick={() => toggleAngle(a.id)} disabled={angleBusy} className={`text-[10px] px-2 py-1 rounded-full border transition-colors disabled:opacity-40 ${angleSel.has(a.id) ? "bg-accent text-bg border-accent" : "bg-surface text-fg-dim border-line hover:border-accent/40"}`}>{a.id.replace(/_/g, " ")}</button>
                              ))}
                            </div>
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => generateAngles(p)} disabled={angleBusy || !angleSel.size} className="text-[11px] font-medium text-white bg-accent rounded-md px-2.5 py-1 disabled:opacity-40 flex items-center gap-1.5">
                                {angleBusy && <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}{angleBusy ? "Generating…" : `Generate ${angleSel.size || ""} angle${angleSel.size === 1 ? "" : "s"}`}
                              </button>
                              <span className="text-[10px] text-fg-mute">added to this persona for reuse</span>
                            </div>
                            {angleError && <p className="text-[10px] text-alert">{angleError}</p>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
          )}
        </>
      )}

      {/* ══════════ COHORT ══════════ */}
      {group === "cohort" && (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2/50 p-3">
          <p className="text-[11px] text-fg-dim leading-snug">Upload a cohort deck (PDF/PPTX) or a slide image. We read the audience segments — pick one and we cast a creator that fits it as this ad’s talent.</p>
          <input ref={cohortRef} type="file" accept=".pdf,.pptx,application/pdf,image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onCohortFile(f); e.target.value = ""; }} />
          <button type="button" onClick={() => cohortRef.current?.click()} disabled={cohortBusy || busy} className="self-start text-xs font-medium text-white bg-accent rounded-lg px-3 py-1.5 disabled:opacity-40 flex items-center gap-2">
            {cohortBusy && <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}{cohortBusy ? "Reading the deck…" : cohorts.length ? "Upload a different deck/image" : "Upload cohort PDF / image"}
          </button>
          {cohortFileName && !cohortBusy && <p className="text-[10px] text-fg-mute">{cohortFileName}{cohorts.length ? ` · ${cohorts.length} segment${cohorts.length === 1 ? "" : "s"}` : ""}</p>}
          {cohortError && <p className="text-[11px] text-alert">{cohortError}</p>}
          {cohorts.length > 0 && (
            <div className="flex flex-col gap-2">
              {cohorts.map(c => (
                <div key={c.id} className="rounded-lg border border-line bg-surface p-2.5">
                  <p className="text-xs font-semibold text-fg">{c.name} <span className="font-normal text-fg-mute">· {c.personaName}</span></p>
                  {c.problemStatement && <p className="text-[11px] text-fg-dim mt-0.5 line-clamp-2">{c.problemStatement}</p>}
                  <p className="text-[10px] text-fg-mute mt-1">{[c.character.gender, c.character.ageRange, c.character.ethnicity].filter(Boolean).join(" · ")}</p>
                  <button type="button" onClick={() => castFromCohort(c)} disabled={freeSlots <= 0 || busy || !!cohortCasting} className="mt-2 text-[11px] font-medium text-white bg-accent rounded-md px-2.5 py-1 disabled:opacity-40 flex items-center gap-1.5">
                    {cohortCasting === c.id && <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}{cohortCasting === c.id ? "Casting…" : "Cast this creator"}
                  </button>
                </div>
              ))}
              {freeSlots <= 0 && <p className="text-[11px] text-fg-mute">{budgetNote}</p>}
            </div>
          )}
        </div>
      )}

      {/* ══════════ UPLOAD ══════════ */}
      {group === "upload" && (
        <>
          <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line self-start">
            {(["character", "reference"] as const).map(t => (
              <button key={t} type="button" disabled={busy} onClick={() => { setUploadTab(t); setCharError(""); }} className={tabBtn(uploadTab === t)}>
                {t === "character" ? "Upload a character" : "Upload a reference"}
              </button>
            ))}
          </div>

          {/* Upload a character */}
          {uploadTab === "character" && (
            <>
              <input ref={uploadRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { if (e.target.files?.length) onAddFiles(e.target.files); e.target.value = ""; }} />
              {freeSlots > 0 ? (
                <button type="button" onClick={() => uploadRef.current?.click()} disabled={busy} className="self-start text-[11px] font-medium text-accent hover:text-accent border border-accent/40 rounded-lg px-3 py-1.5 disabled:opacity-40">
                  {modelImages.length ? "+ Add another shot" : "+ Upload character photo"}
                </button>
              ) : <p className="text-[11px] text-fg-mute">{budgetNote}</p>}
            </>
          )}

          {/* Upload a reference */}
          {uploadTab === "reference" && (
            <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2/50 p-3">
              <p className="text-[11px] text-fg-dim leading-snug">Paste 1–3 Instagram posts with a creator. We match their aesthetic, lighting and vibe (a new face — not a copy).</p>
              <div className="flex flex-col gap-2">
                {refUrls.map((u, i) => (
                  <input key={i} type="url" value={u} disabled={charBusy || busy} onChange={e => setRefUrls(prev => prev.map((v, j) => j === i ? e.target.value : v))} placeholder={`Instagram post link ${i + 1}${i === 0 ? "" : " (optional)"}`}
                    className="w-full text-xs rounded-md border border-line px-2 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-fg-dim">Notes <span className="text-fg-mute">(optional)</span></label>
                <textarea value={details} onChange={e => setDetails(e.target.value)} disabled={charBusy || busy} rows={2} placeholder="e.g. lean into the moody lighting; keep it gym-casual"
                  className="w-full text-xs rounded-md border border-line p-2 resize-y focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
              </div>
              <label className="flex items-start gap-2 text-[11px] text-fg-dim cursor-pointer select-none">
                <input type="checkbox" checked={castFromBrand} onChange={e => setCastFromBrand(e.target.checked)} disabled={charBusy || busy} className="mt-0.5" />
                <span>Cast from brand data — make the creator relevant to the product<span className="block text-fg-mute">{(brandProduct.trim() || productFeatures.trim()) ? `Using: ${(brandProduct.trim() || productFeatures.trim().split("\n")[0]).slice(0, 60)}` : "Fetch or describe a product above to use this"}</span></span>
              </label>
              {canGenerate ? (
                <button type="button" onClick={generate} disabled={charBusy || busy} className="self-start text-xs font-medium text-white bg-accent rounded-lg px-3 py-1.5 disabled:opacity-40 flex items-center gap-2">
                  {charBusy && <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}{charBusy ? "Matching the aesthetic…" : modelImages.length ? "Generate another" : "Generate character"}
                </button>
              ) : <p className="text-[11px] text-fg-mute">{budgetNote}</p>}
              {charError && <p className="text-[11px] text-alert">{charError}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
