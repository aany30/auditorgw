
import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Check, X, Trash2, Sparkles, Loader2 } from "lucide-react";
import ModelSelect from "@/components/media-analyser/ModelSelect";
import {
  GENDER_OPTIONS, AGE_OPTIONS, ETHNICITY_OPTIONS, SKIN_TONE_OPTIONS,
  ANIMATED_STYLE_OPTIONS, ANGLE_OPTIONS,
  type CharacterTraits, type CharacterStyle,
} from "@/lib/media-analyser/ugc/character-prompt";
import type { UGCCharacterResponse } from "@/lib/media-analyser/api-types";
import type { UGCCharacterAnglesResponse } from "@/lib/media-analyser/api-types";
import {
  listPersonas, savePersona, renamePersona, removePersona, appendPersonaImages,
  type UGCPersona,
} from "@/lib/media-analyser/ugc/persona-store";

function friendly(e: unknown): string {
  const m = String(e instanceof Error ? e.message : e);
  if (/network error|failed to fetch|load failed/i.test(m)) return "Network error — the images may be too large. Try again.";
  return m;
}

const EMPTY_TRAITS: CharacterTraits = { gender: "", ageRange: "", ethnicity: "", skinTone: "", hair: "", eyes: "", distinguishingMark: "", build: "", name: "" };

export function PersonaManager() {
  const [personas, setPersonas] = useState<UGCPersona[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    listPersonas().then(p => { if (alive) { setPersonas(p); setLoading(false); } }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // ── Create panel ───────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [style, setStyle] = useState<CharacterStyle>("real");
  const [animatedStyle, setAnimatedStyle] = useState("");
  const [traits, setTraits] = useState<CharacterTraits>(EMPTY_TRAITS);
  const [vibe, setVibe] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState("");
  const [preview, setPreview] = useState<string[]>([]);
  const [previewQc, setPreviewQc] = useState<{ score?: number; notes?: string } | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);

  const resetCreate = () => {
    setName(""); setStyle("real"); setAnimatedStyle(""); setTraits(EMPTY_TRAITS);
    setVibe(""); setPreview([]); setPreviewQc(null); setGenError("");
  };

  const generate = useCallback(async () => {
    if (genBusy) return;
    setGenBusy(true); setGenError(""); setPreview([]); setPreviewQc(null);
    try {
      const res = await fetch("/api/media-analyser/ugc-ads-character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traits,
          details: vibe.trim(),
          count: 2,
          aspect: "9:16",
          style,
          animatedStyle: style === "animated" ? animatedStyle : undefined,
          // A described vibe grounds the casting LLM (real style) so the face reflects it.
          personaContext: style === "real" && vibe.trim() ? vibe.trim() : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<UGCCharacterResponse> & { error?: string };
      const urls = data.imageDataUrls?.length ? data.imageDataUrls : data.imageDataUrl ? [data.imageDataUrl] : [];
      if (!res.ok || !urls.length) throw new Error(data.error ?? "Could not create the character");
      setPreview(urls);
      setPreviewQc(typeof data.qcScore === "number" ? { score: data.qcScore, notes: data.qcNotes } : null);
    } catch (e) {
      setGenError(friendly(e));
    } finally {
      setGenBusy(false);
    }
  }, [genBusy, traits, vibe, style, animatedStyle]);

  const saveNew = useCallback(async () => {
    if (!preview.length || saveBusy) return;
    setSaveBusy(true); setGenError("");
    try {
      const saved = await savePersona({
        name: name.trim() || "Untitled persona",
        style,
        animatedStyle: style === "animated" ? animatedStyle : undefined,
        source: "create",
        images: preview,
        traits: traits as unknown as Record<string, unknown>,
        details: vibe.trim() || undefined,
      });
      setPersonas(prev => [saved, ...prev.filter(p => p.id !== saved.id)]);
      resetCreate(); setCreateOpen(false);
    } catch (e) {
      setGenError(friendly(e));
    } finally {
      setSaveBusy(false);
    }
  }, [preview, saveBusy, name, style, animatedStyle, traits, vibe]);

  // ── Rename ─────────────────────────────────────────────────────────────────
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const commitRename = async (p: UGCPersona) => {
    const nn = editName.trim();
    setEditId(null);
    if (!nn || nn === p.name) return;
    setPersonas(prev => prev.map(x => x.id === p.id ? { ...x, name: nn } : x)); // optimistic
    const updated = await renamePersona(p.id, nn).catch(() => null);
    if (updated) setPersonas(prev => prev.map(x => x.id === p.id ? updated : x));
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const doDelete = async (id: string) => {
    setConfirmDel(null);
    setPersonas(prev => prev.filter(p => p.id !== id));
    await removePersona(id).catch(() => {});
  };

  // ── Add angles ─────────────────────────────────────────────────────────────
  const [angleFor, setAngleFor] = useState<string | null>(null);
  const [angleSel, setAngleSel] = useState<Set<string>>(new Set());
  const [angleBusy, setAngleBusy] = useState(false);
  const [angleError, setAngleError] = useState("");
  const toggleAngle = (id: string) => setAngleSel(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const generateAngles = async (p: UGCPersona) => {
    if (angleBusy || !angleSel.size) return;
    setAngleBusy(true); setAngleError("");
    try {
      const res = await fetch("/api/media-analyser/ugc-ads-character-angles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceImageDataUrl: p.images[0], angles: Array.from(angleSel).slice(0, 3), style: p.style, animatedStyle: p.animatedStyle }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<UGCCharacterAnglesResponse> & { error?: string };
      if (!res.ok || !data.imageDataUrls?.length) throw new Error(data.error ?? "Could not generate angles.");
      const updated = await appendPersonaImages(p, data.imageDataUrls);
      setPersonas(prev => prev.map(x => x.id === p.id ? updated : x));
      setAngleFor(null); setAngleSel(new Set());
    } catch (e) {
      setAngleError(friendly(e));
    } finally {
      setAngleBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Create ── */}
      <div className="card p-5">
        <button type="button" onClick={() => setCreateOpen(o => !o)}
          className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Plus size={16} className={`transition-transform ${createOpen ? "rotate-45" : ""}`} />
          Create a new persona
        </button>

        {createOpen && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-fg-dim">Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={genBusy || saveBusy}
                  placeholder="e.g. Maya — travel creator"
                  className="w-full text-sm rounded-md border border-line px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-fg-dim">Style</label>
                <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line self-start">
                  {(["real", "animated"] as CharacterStyle[]).map(s => (
                    <button key={s} type="button" disabled={genBusy || saveBusy} onClick={() => setStyle(s)}
                      className={`px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${style === s ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
                      {s === "real" ? "Real human" : "Animated"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {style === "animated" && (
              <div className="max-w-xs">
                <ModelSelect label="Animation style" options={ANIMATED_STYLE_OPTIONS} value={animatedStyle} onChange={setAnimatedStyle} disabled={genBusy || saveBusy} />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <ModelSelect label="Gender" options={GENDER_OPTIONS} value={traits.gender ?? ""} onChange={v => setTraits(t => ({ ...t, gender: v }))} disabled={genBusy || saveBusy} />
              <ModelSelect label="Age range" options={AGE_OPTIONS} value={traits.ageRange ?? ""} onChange={v => setTraits(t => ({ ...t, ageRange: v }))} disabled={genBusy || saveBusy} />
              <ModelSelect label="Ethnicity" options={ETHNICITY_OPTIONS} value={traits.ethnicity ?? ""} onChange={v => setTraits(t => ({ ...t, ethnicity: v }))} disabled={genBusy || saveBusy} />
              {style === "real" && <ModelSelect label="Skin tone" options={SKIN_TONE_OPTIONS} value={traits.skinTone ?? ""} onChange={v => setTraits(t => ({ ...t, skinTone: v }))} disabled={genBusy || saveBusy} />}
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-fg-dim">Describe the character / vibe <span className="text-fg-mute">(optional)</span></label>
              <textarea value={vibe} onChange={e => setVibe(e.target.value)} disabled={genBusy || saveBusy}
                rows={2} placeholder="e.g. energetic gym creator, warm smile, casual athleisure"
                className="w-full text-xs rounded-md border border-line p-2 resize-y focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
            </div>

            {preview.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {preview.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt={`preview ${i + 1}`} className="w-28 aspect-[3/4] object-cover rounded-lg border border-line bg-surface" />
                ))}
                {typeof previewQc?.score === "number" && (
                  <p className={`w-full text-[11px] ${previewQc.score >= 60 ? "text-accent-2" : "text-alert"}`}>QC {previewQc.score} · {previewQc.notes || "looks good"}</p>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={generate} disabled={genBusy || saveBusy}
                className="inline-flex items-center gap-2 text-sm font-medium text-white bg-accent rounded-lg px-3.5 py-2 disabled:opacity-40">
                {genBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {genBusy ? "Generating…" : preview.length ? "Regenerate" : "Generate"}
              </button>
              {preview.length > 0 && (
                <button type="button" onClick={saveNew} disabled={saveBusy || genBusy}
                  className="inline-flex items-center gap-2 text-sm font-medium text-accent border border-accent/40 rounded-lg px-3.5 py-2 disabled:opacity-40">
                  {saveBusy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  {saveBusy ? "Saving…" : "Save to library"}
                </button>
              )}
              <button type="button" onClick={() => { resetCreate(); setCreateOpen(false); }} disabled={genBusy || saveBusy}
                className="text-sm text-fg-mute hover:text-fg-dim disabled:opacity-40">Cancel</button>
            </div>
            {genError && <p className="text-xs text-alert">{genError}</p>}
          </div>
        )}
      </div>

      {/* ── Library ── */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-fg-dim"><Loader2 size={16} className="animate-spin" /> Loading personas…</div>
      ) : personas.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm font-medium text-fg-dim">No saved personas yet</p>
          <p className="text-xs text-fg-mute mt-1">Create one above, or save a character from the UGC Ads flow — they&apos;ll all appear here to name, reuse and manage.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {personas.map(p => (
            <div key={p.id} className="card p-3 flex flex-col gap-2.5">
              {/* image gallery */}
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {p.images.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt={`${p.name} ${i + 1}`} className="h-32 aspect-[3/4] object-cover rounded-lg border border-line bg-surface shrink-0" />
                ))}
              </div>

              {/* name + rename */}
              <div className="flex items-center gap-2">
                {editId === p.id ? (
                  <>
                    <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") commitRename(p); if (e.key === "Escape") setEditId(null); }}
                      className="flex-1 min-w-0 text-sm rounded-md border border-accent/50 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/40" />
                    <button type="button" onClick={() => commitRename(p)} className="text-accent-2 hover:opacity-80" aria-label="Save name"><Check size={16} /></button>
                    <button type="button" onClick={() => setEditId(null)} className="text-fg-mute hover:text-fg-dim" aria-label="Cancel"><X size={16} /></button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 min-w-0 text-sm font-semibold text-fg truncate">{p.name}</span>
                    <button type="button" onClick={() => { setEditId(p.id); setEditName(p.name); }} className="text-fg-mute hover:text-accent" aria-label="Rename"><Pencil size={14} /></button>
                  </>
                )}
              </div>

              {/* meta */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[9px] uppercase tracking-wide text-fg-mute border border-line rounded-full px-1.5 py-px">{p.style === "animated" ? "Animated" : "Real"}</span>
                <span className="text-[10px] text-fg-mute">{p.images.length} shot{p.images.length === 1 ? "" : "s"}</span>
                {p.source && <span className="text-[10px] text-fg-mute">· {p.source}</span>}
              </div>

              {/* actions */}
              <div className="flex items-center gap-2.5 flex-wrap pt-0.5 border-t border-line mt-0.5">
                <button type="button" onClick={() => { setAngleFor(angleFor === p.id ? null : p.id); setAngleSel(new Set()); setAngleError(""); }}
                  disabled={angleBusy} className="text-[11px] font-medium text-accent hover:text-accent disabled:opacity-40 pt-2">+ Add angles</button>
                {confirmDel === p.id ? (
                  <span className="text-[11px] pt-2">
                    <span className="text-alert">Delete?</span>
                    <button type="button" onClick={() => doDelete(p.id)} className="ml-1.5 font-medium text-alert hover:underline">Yes</button>
                    <button type="button" onClick={() => setConfirmDel(null)} className="ml-1.5 text-fg-mute hover:text-fg-dim">No</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmDel(p.id)}
                    className="inline-flex items-center gap-1 text-[11px] text-fg-mute hover:text-alert pt-2"><Trash2 size={12} /> Delete</button>
                )}
              </div>

              {/* angle picker */}
              {angleFor === p.id && (
                <div className="rounded-md border border-line bg-surface-2/60 p-2 flex flex-col gap-2">
                  <p className="text-[10px] text-fg-dim">Pick up to 3 angles (identity-locked to this persona):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ANGLE_OPTIONS.map(a => (
                      <button key={a.id} type="button" onClick={() => toggleAngle(a.id)} disabled={angleBusy}
                        className={`text-[10px] px-2 py-1 rounded-full border transition-colors disabled:opacity-40 ${angleSel.has(a.id) ? "bg-accent text-bg border-accent" : "bg-surface text-fg-dim border-line hover:border-accent/40"}`}>
                        {a.id.replace(/_/g, " ")}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => generateAngles(p)} disabled={angleBusy || !angleSel.size}
                    className="self-start inline-flex items-center gap-1.5 text-[11px] font-medium text-white bg-accent rounded-md px-2.5 py-1 disabled:opacity-40">
                    {angleBusy && <Loader2 size={12} className="animate-spin" />}
                    {angleBusy ? "Generating…" : `Generate ${angleSel.size || ""} angle${angleSel.size === 1 ? "" : "s"}`}
                  </button>
                  {angleError && <p className="text-[10px] text-alert">{angleError}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
