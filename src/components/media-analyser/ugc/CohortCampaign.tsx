
import { useCallback, useRef, useState } from "react";
import type { Cohort } from "@/lib/media-analyser/ugc/cohort-prompt";
import type { UGCCohortsResponse } from "@/lib/media-analyser/api-types";
import type { UGCCharacterResponse } from "@/lib/media-analyser/api-types";
import type { UGCRenderSubmit } from "@/lib/media-analyser/api-types";
import type { UGCRenderStatus } from "@/lib/media-analyser/api-types";
import type { UGCQcResponse } from "@/lib/media-analyser/api-types";
import type { UGCDirectorPlan } from "@/lib/media-analyser/ugc/types";

// Upper bound for the uploaded deck once base64-encoded inside a JSON body
// (Vercel caps the request body around 4.5 MB). ~3.3 MB raw → ~4.4 MB base64.
const MAX_FILE_BYTES = 3.3 * 1024 * 1024;
const RENDER_POLL_MS = 6000;
const RENDER_DEADLINE_MS = 20 * 60 * 1000;
const PREP_CONCURRENCY = 2;

type Phase = "idle" | "parsing" | "cohorts" | "rendering" | "done";
type Prep = "queued" | "char" | "script" | "ready" | "error";
type RenderPhase = "" | "preparing" | "rendering" | "qc" | "done" | "error";

interface CohortRender {
  phase: RenderPhase;
  videoUrl?: string;
  qcPass?: boolean;
  qcSummary?: string;
  error?: string;
}

interface CohortItem {
  cohort: Cohort;
  charImages?: string[];
  plan?: UGCDirectorPlan;
  selected: boolean;
  prep: Prep;
  prepError?: string;
  render?: CohortRender;
  /** Per-step JSON actually transferred (images redacted) — for the debug dropdown. */
  debug?: Record<string, unknown>;
}

/** Replace base64 image data URLs with short placeholders so the JSON stays readable. */
function redactBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (Array.isArray(v) && v.length && v.every(x => typeof x === "string" && x.startsWith("data:"))) {
      out[k] = `[${v.length} image data URL(s) — redacted]`;
    } else if (typeof v === "string" && v.startsWith("data:")) {
      out[k] = "[image data URL — redacted]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

interface Props {
  productImages: string[]; // product photo data URLs (shared across all cohorts)
  productFeatures: string;
  description: string;
  aspect: string;
  imageModel: string;
  /** Voiceover language / accent (passed through to /script). */
  language?: string;
  /** Ad length in seconds (15 or 30), passed through to /script. */
  durationSeconds?: number;
  /** Block the uploader until the product photo + brief are filled in above. */
  disabled?: boolean;
}

function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m || "Something went wrong. Please try again.";
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read that file."));
    r.readAsDataURL(file);
  });
}

export default function CohortCampaign({ productImages, productFeatures, description, aspect, imageModel, language = "", durationSeconds = 15, disabled = false }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [items, setItems] = useState<CohortItem[]>([]);
  // Cohort ids whose script is collapsed (default: all expanded for review).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const toggleCollapsed = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Inline-edit a shot of a cohort's generated script (edited plan flows into render).
  const updateCohortShot = (
    cohortId: string,
    idx: number,
    patch: Partial<{ dialogue: string; subject_action: string; text_overlay: string | null }>,
  ) => setItems(prev => prev.map(it =>
    it.cohort.id === cohortId && it.plan
      ? { ...it, plan: { ...it.plan, shots: it.plan.shots.map((s, i) => i === idx ? { ...s, ...patch } : s) } }
      : it,
  ));

  const patchItem = useCallback((id: string, patch: Partial<CohortItem>) => {
    setItems(prev => prev.map(it => (it.cohort.id === id ? { ...it, ...patch } : it)));
  }, []);

  // Merge a step's transferred JSON into the item's debug record (for the dropdown).
  const patchDebug = useCallback((id: string, partial: Record<string, unknown>) => {
    setItems(prev => prev.map(it => (it.cohort.id === id ? { ...it, debug: { ...(it.debug ?? {}), ...partial } } : it)));
  }, []);

  // Generate a cohort's creator (2 consistent shots). Returns the data URLs.
  const runCharacter = useCallback(async (cohort: Cohort): Promise<string[]> => {
    const reqBody = {
      endpoint: "POST /api/ugc-ads/character",
      traits: { gender: cohort.character.gender, ageRange: cohort.character.ageRange, ethnicity: cohort.character.ethnicity },
      details: cohort.character.details,
      // Persona grounding so each cohort's creator is a distinct, on-persona person.
      personaName: cohort.personaName,
      personaContext: [cohort.problemStatement, cohort.keyInsight].filter(Boolean).join(" — "),
      count: 2,
    };
    patchDebug(cohort.id, { "2_character_request": reqBody });
    const { endpoint, ...body } = reqBody;
    void endpoint;
    const res = await fetch("/api/media-analyser/ugc-ads-character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<UGCCharacterResponse> & { error?: string };
    if (!res.ok || !data.imageDataUrls?.length) throw new Error(data.error ?? "Couldn't create this cohort's character.");
    patchDebug(cohort.id, {
      "2_character_response": { prompt: data.prompt, images: data.imageDataUrls.length },
      // The exact prompts sent to Nano Banana Pro for the creator (anchor + variations).
      "2_character_nano_prompts": data.debug ?? null,
    });
    return data.imageDataUrls;
  }, [patchDebug]);

  // Write a cohort's tailored 5-beat script using the given creator shots.
  const runScript = useCallback(async (cohort: Cohort, charImages: string[]): Promise<UGCDirectorPlan> => {
    const body = {
      imageDataUrls: productImages,
      modelImageDataUrls: charImages,
      description: description.trim(),
      productFeatures: productFeatures.trim(),
      language,
      aspect,
      durationSeconds,
      cohort,
    };
    patchDebug(cohort.id, { "3_script_request": { endpoint: "POST /api/ugc-ads/script", ...redactBody(body) } });
    const res = await fetch("/api/media-analyser/ugc-ads-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { plan?: UGCDirectorPlan; error?: string };
    if (!res.ok || !data.plan) throw new Error(data.error ?? "Couldn't write this cohort's script.");
    patchDebug(cohort.id, { "3_script_response_plan": data.plan });
    return data.plan;
  }, [productImages, productFeatures, description, aspect, language, durationSeconds, patchDebug]);

  // ── Prep one cohort: generate its character, then its tailored script ──────
  const prepCohort = useCallback(async (cohort: Cohort) => {
    try {
      patchItem(cohort.id, { prep: "char", prepError: undefined });
      const charImages = await runCharacter(cohort);
      patchItem(cohort.id, { charImages, prep: "script" });
      const plan = await runScript(cohort, charImages);
      patchItem(cohort.id, { plan, prep: "ready" });
    } catch (e) {
      patchItem(cohort.id, { prep: "error", prepError: friendly(e) });
    }
  }, [runCharacter, runScript, patchItem]);

  // Re-roll ONLY the creator (keep the script).
  const regenerateCharacter = useCallback(async (cohort: Cohort) => {
    patchItem(cohort.id, { prep: "char", prepError: undefined });
    try {
      const charImages = await runCharacter(cohort);
      patchItem(cohort.id, { charImages, prep: "ready" });
    } catch (e) {
      patchItem(cohort.id, { prep: "error", prepError: friendly(e) });
    }
  }, [runCharacter, patchItem]);

  // Re-roll ONLY the script (keep the current creator).
  const regenerateScript = useCallback(async (cohort: Cohort, charImages?: string[]) => {
    patchItem(cohort.id, { prep: "script", prepError: undefined });
    try {
      const imgs = charImages?.length ? charImages : await runCharacter(cohort);
      const plan = await runScript(cohort, imgs);
      patchItem(cohort.id, { charImages: imgs, plan, prep: "ready" });
    } catch (e) {
      patchItem(cohort.id, { prep: "error", prepError: friendly(e) });
    }
  }, [runCharacter, runScript, patchItem]);

  // Run prep across cohorts with a small concurrency cap (cards fill in live).
  const runPrep = useCallback(async (cohorts: Cohort[]) => {
    let next = 0;
    const worker = async () => {
      while (next < cohorts.length) {
        const c = cohorts[next++];
        await prepCohort(c);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PREP_CONCURRENCY, cohorts.length) }, worker));
  }, [prepCohort]);

  // ── Upload deck → extract cohorts → prep them ──────────────────────────────
  const onFile = useCallback(async (file: File) => {
    setError("");
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is too large (max ~3 MB). Try exporting a slimmer PDF.");
      return;
    }
    setPhase("parsing");
    setItems([]);
    try {
      const documentDataUrl = await fileToDataUrl(file);
      const res = await fetch("/api/media-analyser/ugc-ads-cohorts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentDataUrl, fileName: file.name }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<UGCCohortsResponse> & { error?: string };
      if (!res.ok || !data.cohorts?.length) throw new Error(data.error ?? "No cohorts found in that document.");
      const cohorts = data.cohorts;
      setItems(cohorts.map(c => ({ cohort: c, selected: true, prep: "queued" as Prep, debug: { "1_cohort": c } })));
      setPhase("cohorts");
      await runPrep(cohorts);
    } catch (e) {
      setError(friendly(e));
      setPhase("idle");
    }
  }, [runPrep]);

  const toggle = (id: string) => setItems(prev => prev.map(it => (it.cohort.id === id ? { ...it, selected: !it.selected } : it)));

  const regenOne = (cohort: Cohort) => {
    patchItem(cohort.id, { prep: "queued", plan: undefined, charImages: undefined, render: undefined });
    void prepCohort(cohort);
  };

  // ── Render ONE cohort (submit → poll → QC), mirroring UGCAds.runRender ──────
  const renderCohort = useCallback(async (item: CohortItem): Promise<void> => {
    const id = item.cohort.id;
    if (!item.plan) return;
    try {
      patchItem(id, { render: { phase: "preparing" } });
      const renderBody = {
        imageDataUrls: productImages,
        modelImageDataUrls: item.charImages ?? [],
        plan: item.plan,
        description: description.trim(),
        imageModel,
        aspect,
        attempt: 1,
      };
      patchDebug(id, { "4_render_request": { endpoint: "POST /api/ugc-ads/render", ...redactBody(renderBody) } });
      const submitRes = await fetch("/api/media-analyser/ugc-ads-render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(renderBody),
      });
      if (!submitRes.ok) {
        const err = (await submitRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Render request failed.");
      }
      const handle = (await submitRes.json()) as UGCRenderSubmit;
      patchDebug(id, {
        "4_render_handle": { requestId: handle.requestId, statusUrl: handle.statusUrl, durationSeconds: handle.durationSeconds },
        // What was actually submitted to Seedance: the assembled prompt + the photos
        // (reference image URLs + their roles) + any Nano Banana reference-asset prompts.
        "4_seedance_prompt": handle.debug?.seedancePrompt ?? null,
        "4_seedance_reference_photos": handle.debug ? { urls: handle.debug.referenceUrls, roles: handle.debug.referenceManifest } : null,
        "4_render_nano_ref_prompts": handle.debug?.nanoRefPrompts ?? [],
      });

      patchItem(id, { render: { phase: "rendering" } });
      const deadline = Date.now() + RENDER_DEADLINE_MS;
      let videoUrl = "";
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
        if (st.status === "rendered" && st.videoUrl) { videoUrl = st.videoUrl; break; }
      }
      if (!videoUrl) throw new Error("The render is taking unusually long.");

      patchItem(id, { render: { phase: "qc", videoUrl } });
      let qc: UGCQcResponse = { qcDone: false, qcPass: true, qcSummary: "" };
      const qcRes = await fetch("/api/media-analyser/ugc-ads-qc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl, plan: item.plan, description: description.trim(), attempt: 1 }),
      }).catch(() => null);
      if (qcRes && qcRes.ok) qc = (await qcRes.json().catch(() => qc)) as UGCQcResponse;

      patchDebug(id, { "5_qc": qc, "6_video_url": videoUrl });
      patchItem(id, { render: { phase: "done", videoUrl, qcPass: qc.qcPass, qcSummary: qc.qcSummary } });
    } catch (e) {
      patchItem(id, { render: { phase: "error", error: friendly(e) } });
    }
  }, [productImages, description, imageModel, aspect, patchItem, patchDebug]);

  // Render all ticked, ready cohorts ONE AT A TIME (sequential queue).
  const renderSelected = useCallback(async () => {
    const queue = items.filter(it => it.selected && it.prep === "ready" && it.plan);
    if (!queue.length) return;
    setPhase("rendering");
    for (const it of queue) {
      // re-read latest item state for charImages/plan
      await renderCohort(it);
    }
    setPhase("done");
  }, [items, renderCohort]);

  const selectedCount = items.filter(it => it.selected && it.prep === "ready").length;
  const prepping = items.some(it => it.prep === "char" || it.prep === "script" || it.prep === "queued");
  const isRendering = phase === "rendering";

  // ── UI ─────────────────────────────────────────────────────────────────────
  return (
    <div className="mt-6 border-t border-line pt-5">
      <p className="text-sm font-semibold text-fg">Scale this ad to audience cohorts</p>
      <p className="text-[11px] text-fg-dim mt-0.5 leading-snug">
        Upload a target-audience deck (.pptx or .pdf). We detect each cohort, cast a matching creator,
        and write a tailored script. Tick the ones you like and we render those videos — one at a time.
      </p>

      {phase === "idle" && (
        <div className="mt-3">
          <input ref={fileRef} type="file" accept=".pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          <button type="button" disabled={disabled} onClick={() => fileRef.current?.click()}
            className="px-4 py-2 rounded-lg bg-accent text-bg text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
            Upload audience deck
          </button>
          {disabled && <p className="text-[11px] text-fg-mute mt-2 leading-snug">Add a product photo above first.</p>}
          {error && <p className="text-[11px] text-alert mt-2 leading-snug">{error}</p>}
        </div>
      )}

      {phase === "parsing" && (
        <p className="text-xs text-fg-dim mt-3 flex items-center gap-2">
          <span className="w-3 h-3 border-2 border-line border-t-transparent rounded-full animate-spin" />
          Reading the deck and finding cohorts…
        </p>
      )}

      {items.length > 0 && phase !== "parsing" && (
        <div className="mt-4 space-y-3">
          {items.map(it => (
            <div key={it.cohort.id} className={`rounded-xl border p-3 transition-colors ${it.selected ? "border-accent/40 bg-accent-soft/30" : "border-line"}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={it.selected} disabled={it.prep !== "ready" || isRendering}
                  onChange={() => toggle(it.cohort.id)} className="mt-1 h-4 w-4 accent-indigo-600 disabled:opacity-40" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-fg">{it.cohort.name}</span>
                    {it.cohort.personaName && <span className="text-[11px] text-fg-dim">· {it.cohort.personaName}</span>}
                  </div>
                  {it.cohort.keyInsight && <p className="text-[11px] text-fg-dim italic mt-0.5 leading-snug">“{it.cohort.keyInsight}”</p>}

                  {/* creator review */}
                  {it.charImages?.length ? (
                    <div className="mt-2">
                      <p className="text-[10px] font-medium text-fg-mute uppercase tracking-wide mb-1">Creator</p>
                      <div className="flex gap-2">
                        {it.charImages.slice(0, 2).map((src, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={i} src={src} alt="creator" className="w-24 aspect-[3/4] object-cover rounded-lg border border-line bg-surface" />
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* script review */}
                  <div className="mt-2">
                    {it.prep === "ready" && it.plan ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-medium text-fg-mute uppercase tracking-wide">Script <span className="normal-case text-fg-mute">· editable</span></p>
                          <button type="button" onClick={() => toggleCollapsed(it.cohort.id)}
                            className="text-[11px] font-medium text-accent hover:text-accent">
                            {collapsed.has(it.cohort.id) ? "Show script" : "Hide script"}
                          </button>
                        </div>
                        {!collapsed.has(it.cohort.id) && (
                          <>
                            {(it.plan.meta.scene_setting || it.plan.meta.voice_characteristics) && (
                              <p className="text-[11px] text-fg-dim leading-snug">
                                {it.plan.meta.scene_setting && <span><span className="font-medium text-fg-dim">Scene:</span> {it.plan.meta.scene_setting} </span>}
                                {it.plan.meta.voice_characteristics && <span><span className="font-medium text-fg-dim">Voice:</span> {it.plan.meta.voice_characteristics}</span>}
                              </p>
                            )}
                            <ol className="space-y-2">
                              {it.plan.shots.map((s, idx) => (
                                <li key={s.shot_number} className="text-[11px] leading-snug">
                                  <p className="text-fg">
                                    <span className="font-medium">{s.beat_name}</span>
                                    <span className="text-fg-mute"> ({s.time_range})</span>
                                  </p>
                                  <label className="block text-[10px] text-fg-mute mt-1">Dialogue</label>
                                  <textarea value={s.dialogue} disabled={isRendering}
                                    onChange={e => updateCohortShot(it.cohort.id, idx, { dialogue: e.target.value })}
                                    rows={2}
                                    className="w-full text-[11px] rounded-md border border-line px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
                                  <label className="block text-[10px] text-fg-mute mt-1">Action</label>
                                  <input value={s.subject_action} disabled={isRendering}
                                    onChange={e => updateCohortShot(it.cohort.id, idx, { subject_action: e.target.value })}
                                    className="w-full text-[11px] rounded-md border border-line px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
                                  <label className="block text-[10px] text-fg-mute mt-1">Text overlay <span className="text-fg-mute">(optional)</span></label>
                                  <input value={s.text_overlay ?? ""} disabled={isRendering}
                                    onChange={e => updateCohortShot(it.cohort.id, idx, { text_overlay: e.target.value || null })}
                                    className="w-full text-[11px] rounded-md border border-line px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
                                </li>
                              ))}
                            </ol>
                          </>
                        )}
                      </div>
                    ) : it.prep === "error" ? (
                      <p className="text-[11px] text-alert">{it.prepError}
                        <button onClick={() => regenOne(it.cohort)} className="ml-2 underline hover:text-alert">Retry</button>
                      </p>
                    ) : (
                      <p className="text-[11px] text-fg-mute flex items-center gap-1.5">
                        <span className="w-3 h-3 border-2 border-line border-t-transparent rounded-full animate-spin" />
                        {it.prep === "char" ? "Casting the creator…" : it.prep === "script" ? "Writing the script…" : "Queued…"}
                      </p>
                    )}
                  </div>

                  {/* render status / result */}
                  {it.render && (
                    <div className="mt-2">
                      {it.render.phase === "done" && it.render.videoUrl ? (
                        <div className="space-y-1">
                          <video src={it.render.videoUrl} controls playsInline className="w-40 rounded-lg border border-line bg-black" />
                          <p className="text-[10px] text-fg-mute">{it.render.qcPass === false ? "⚠ QC flagged" : "✓ Ready"} · <a href={it.render.videoUrl} target="_blank" rel="noreferrer" className="underline">open</a></p>
                        </div>
                      ) : it.render.phase === "error" ? (
                        <p className="text-[11px] text-alert">{it.render.error}</p>
                      ) : (
                        <p className="text-[11px] text-accent flex items-center gap-1.5">
                          <span className="w-3 h-3 border-2 border-accent/40 border-t-transparent rounded-full animate-spin" />
                          {it.render.phase === "preparing" ? "Preparing…" : it.render.phase === "qc" ? "Quality-checking…" : "Filming… (a few minutes)"}
                        </p>
                      )}
                    </div>
                  )}

                  {it.prep === "ready" && !it.render && (
                    <div className="mt-2 flex items-center gap-3">
                      <button onClick={() => regenerateCharacter(it.cohort)} disabled={isRendering}
                        className="text-[11px] font-medium text-fg-dim hover:text-fg disabled:opacity-40">↻ Regenerate creator</button>
                      <button onClick={() => regenerateScript(it.cohort, it.charImages)} disabled={isRendering}
                        className="text-[11px] font-medium text-fg-dim hover:text-fg disabled:opacity-40">↻ Rewrite script</button>
                    </div>
                  )}

                  {/* debug: the JSON transferred at each step (images redacted) */}
                  {it.debug && (
                    <details className="mt-2">
                      <summary className="text-[10px] font-medium text-fg-mute cursor-pointer hover:text-fg-dim select-none">View JSON (each step)</summary>
                      <pre className="mt-1 text-[10px] leading-snug text-fg-dim bg-surface-2 border border-line rounded-md p-2 overflow-auto max-h-72 whitespace-pre-wrap break-words">
{JSON.stringify(it.debug, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={renderSelected} disabled={!selectedCount || prepping || isRendering}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent disabled:opacity-40">
              {isRendering ? "Rendering…" : `Generate ${selectedCount || ""} video${selectedCount === 1 ? "" : "s"}`}
            </button>
            {prepping && <span className="text-[11px] text-fg-mute">Preparing cohorts…</span>}
            {isRendering && <span className="text-[11px] text-fg-mute">Rendering one at a time — keep this tab open.</span>}
          </div>
          {error && <p className="text-[11px] text-alert leading-snug">{error}</p>}
        </div>
      )}
    </div>
  );
}
