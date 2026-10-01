
import { useState } from "react";
import type { MicroDramaAnalyzeResponse } from "@/lib/media-analyser/api-types";
import type { MicroDramaCharacterResponse } from "@/lib/media-analyser/api-types";
import type { MicroDramaShotListResponse } from "@/lib/media-analyser/api-types";
import type { DramaAnalysis, DramaScene, DramaCharacter, SceneShotList } from "@/lib/media-analyser/micro-drama";

/** Run async workers over items with a small concurrency cap (keeps the image API from rate-limiting). */
async function pool<T>(items: T[], size: number, worker: (item: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx], idx); }
  }));
}

export function MicroDrama() {
  const [script, setScript] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [err, setErr] = useState("");

  const [analysis, setAnalysis] = useState<DramaAnalysis | null>(null);
  const [scenes, setScenes] = useState<DramaScene[]>([]);
  const [characters, setCharacters] = useState<DramaCharacter[]>([]);
  const [portraits, setPortraits] = useState<Record<string, string>>({});
  const [portraitBusy, setPortraitBusy] = useState<Record<string, boolean>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [steer, setSteer] = useState<Record<string, string>>({});

  const [shotBusy, setShotBusy] = useState(false);
  const [shotList, setShotList] = useState<SceneShotList[]>([]);
  const [briefLocked, setBriefLocked] = useState(false);

  const anyBusy = analyzing || shotBusy || Object.values(portraitBusy).some(Boolean);
  const lockedCount = characters.filter(c => confirmed[c.id]).length;
  const allConfirmed = characters.length > 0 && lockedCount === characters.length;
  const shotCount = shotList.reduce((n, s) => n + s.shots.length, 0);
  const briefReady = allConfirmed && shotCount > 0;

  const genCharacter = async (c: DramaCharacter) => {
    setPortraitBusy(b => ({ ...b, [c.id]: true }));
    setConfirmed(s => ({ ...s, [c.id]: false }));
    try {
      const res = await fetch("/api/media-analyser/micro-drama-character", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character: c, steer: steer[c.id] ?? "", seed: Math.floor(Math.random() * 1_000_000_000) }),
      });
      const data = (await res.json().catch(() => ({}))) as MicroDramaCharacterResponse & { error?: string };
      if (!res.ok || !data.imageDataUrl) throw new Error(data.error ?? "Character generation failed");
      setPortraits(m => ({ ...m, [c.id]: data.imageDataUrl }));
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setPortraitBusy(b => ({ ...b, [c.id]: false })); }
  };

  const analyze = async () => {
    if (anyBusy || script.trim().length < 20) return;
    setAnalyzing(true); setErr(""); setAnalysis(null); setScenes([]); setCharacters([]); setPortraits({}); setConfirmed({}); setSteer({}); setShotList([]); setBriefLocked(false);
    try {
      const res = await fetch("/api/media-analyser/micro-drama-analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script: script.trim() }) });
      const data = (await res.json().catch(() => ({}))) as MicroDramaAnalyzeResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setAnalysis(data.analysis); setScenes(data.scenes ?? []); setCharacters(data.characters);
      setAnalyzing(false);
      pool(data.characters, 2, genCharacter); // fill in portraits, 2 at a time
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); setAnalyzing(false); }
  };

  const genShotList = async () => {
    if (anyBusy || !analysis || !scenes.length) return;
    setShotBusy(true); setErr(""); setBriefLocked(false);
    try {
      const res = await fetch("/api/media-analyser/micro-drama-shot-list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysis, scenes }) });
      const data = (await res.json().catch(() => ({}))) as MicroDramaShotListResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Shot list failed");
      setShotList(data.scenes ?? []);
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setShotBusy(false); }
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-fg-dim leading-snug">
        Paste a script → AI <b>analysis</b> (tone, pacing, beats per scene) → <b>shot list</b> (angle, movement, cuts) →
        <b> character builder</b> (generate &amp; confirm each) → lock the <b>production brief</b>. Keyframes → Seedance → assembly come next.
      </p>

      {/* Script input */}
      <div className="space-y-2">
        <textarea
          value={script}
          onChange={e => setScript(e.target.value)}
          disabled={anyBusy}
          rows={8}
          placeholder="Paste the full micro-drama script here — dialogue, action, characters…"
          className="w-full text-xs rounded-md border border-line px-3 py-2.5 leading-relaxed focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50 resize-y min-h-[140px]"
        />
        <div className="flex items-center gap-2">
          <button onClick={analyze} disabled={anyBusy || script.trim().length < 20}
            className="text-xs font-medium text-white bg-accent rounded-md px-4 py-2 disabled:opacity-40 flex items-center gap-1.5">
            {analyzing && <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}
            {analyzing ? "Analyzing script…" : "Analyze script"}
          </button>
          <span className="text-[10px] text-fg-mute">{script.trim().split(/\s+/).filter(Boolean).length} words</span>
        </div>
      </div>

      {err && <p className="text-xs text-alert">⚠ {err}</p>}

      {/* Analysis */}
      {analysis && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold text-fg">{analysis.title || "Untitled drama"}</p>
            {analysis.genre && <span className="text-[10px] font-medium text-accent border border-accent/40 rounded-full px-2 py-0.5">{analysis.genre}</span>}
          </div>
          {analysis.logline && <p className="text-[12px] text-fg-dim italic">{analysis.logline}</p>}
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-fg-dim">
            {analysis.summary && <p className="sm:col-span-2"><span className="text-fg-mute">Summary:</span> {analysis.summary}</p>}
            {analysis.tone && <p><span className="text-fg-mute">Tone:</span> {analysis.tone}</p>}
            {analysis.pacing && <p><span className="text-fg-mute">Pacing:</span> {analysis.pacing}</p>}
            {analysis.setting && <p><span className="text-fg-mute">Setting:</span> {analysis.setting}</p>}
            <p><span className="text-fg-mute">Scenes:</span> {scenes.length || analysis.sceneCountEstimate} · <span className="text-fg-mute">Cast:</span> {characters.length}</p>
          </div>
        </div>
      )}

      {/* Scenes + shot list */}
      {scenes.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[11px] font-semibold text-fg-mute">Scenes &amp; shot list</p>
            <button onClick={genShotList} disabled={anyBusy}
              className="text-[11px] font-medium text-white bg-accent rounded-md px-2.5 py-1 disabled:opacity-40 flex items-center gap-1.5">
              {shotBusy && <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}
              {shotBusy ? "Building shot list…" : shotList.length ? "Rebuild shot list" : "Generate shot list"}
            </button>
          </div>
          <div className="space-y-2">
            {scenes.map((s, i) => {
              const sl = shotList.find(x => x.sceneId === s.id) ?? shotList[i];
              return (
                <div key={s.id} className="rounded-lg border border-line p-2.5 space-y-1.5">
                  <p className="text-[11px] font-semibold text-fg">{i + 1}. {s.heading || s.location || `Scene ${i + 1}`}</p>
                  {s.beat && <p className="text-[11px] text-fg-dim leading-snug">{s.beat}</p>}
                  {sl && sl.shots.length > 0 && (
                    <div className="pl-2 border-l-2 border-accent/30 space-y-1 mt-1">
                      {sl.shots.map((sh, j) => (
                        <div key={sh.id} className="text-[10px] text-fg-dim leading-snug">
                          <span className="text-accent font-medium">Shot {j + 1}</span>
                          <span className="text-fg-mute"> · {[sh.angle, sh.movement, sh.cut].filter(Boolean).join(" · ")}{sh.durationSec ? ` · ${sh.durationSec}s` : ""}</span>
                          {sh.action && <> — {sh.action}</>}
                          {sh.dialogue && <span className="text-fg"> “{sh.dialogue}”</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Characters */}
      {characters.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[11px] font-semibold text-fg-mute">Cast — generate &amp; confirm each character</p>
            <span className="text-[11px] text-fg-mute">{lockedCount}/{characters.length} locked</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {characters.map(c => {
              const img = portraits[c.id]; const loading = portraitBusy[c.id]; const ok = confirmed[c.id];
              return (
                <div key={c.id} className={`rounded-lg border overflow-hidden ${ok ? "border-accent ring-1 ring-accent" : "border-line"}`}>
                  {img
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={img} alt={c.name} className="w-full aspect-[4/5] object-cover bg-black" />
                    : <div className="w-full aspect-[4/5] bg-surface-2 flex items-center justify-center text-[10px] text-fg-mute">{loading ? <span className="w-4 h-4 border-2 border-accent/50 border-t-transparent rounded-full animate-spin" /> : "no portrait"}</div>}
                  <div className="p-2 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-xs font-semibold text-fg leading-tight truncate">{c.name}</p>
                      {ok && <span className="text-[9px] font-medium text-accent shrink-0">✓ locked</span>}
                    </div>
                    <p className="text-[10px] text-fg-mute">{[c.role, c.gender, c.age].filter(Boolean).join(" · ")}</p>
                    {c.description && <p className="text-[11px] text-fg-dim leading-snug line-clamp-2">{c.description}</p>}
                    <input
                      value={steer[c.id] ?? ""}
                      onChange={e => setSteer(s => ({ ...s, [c.id]: e.target.value }))}
                      disabled={loading}
                      placeholder="Tweak (e.g. older, glasses)…"
                      className="w-full text-[10px] rounded border border-line px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50"
                    />
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <button onClick={() => genCharacter(c)} disabled={loading}
                        className="text-[10px] font-medium text-accent border border-accent/40 rounded px-2 py-1 disabled:opacity-40 flex items-center gap-1">
                        {loading && <span className="w-2.5 h-2.5 border-2 border-accent/60 border-t-transparent rounded-full animate-spin" />}
                        {img ? "Regenerate" : loading ? "Generating…" : "Generate"}
                      </button>
                      <button onClick={() => setConfirmed(s => ({ ...s, [c.id]: !s[c.id] }))} disabled={!img || loading}
                        className={`text-[10px] font-medium rounded px-2 py-1 disabled:opacity-40 ${ok ? "text-fg-mute border border-line" : "text-white bg-accent"}`}>
                        {ok ? "Unlock" : "Confirm"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Production brief (locked) = shot list + character sheet */}
      {characters.length > 0 && (
        <div className={`rounded-xl border p-4 space-y-3 ${briefLocked ? "border-accent bg-accent-soft/30" : briefReady ? "border-accent/60" : "border-dashed border-line"}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[11px] font-semibold text-fg-mute">Production brief {briefLocked && <span className="text-accent">· locked 🔒</span>}</p>
            {briefReady && (
              <button onClick={() => setBriefLocked(v => !v)}
                className={`text-[11px] font-medium rounded-md px-3 py-1 ${briefLocked ? "text-fg-mute border border-line" : "text-white bg-accent"}`}>
                {briefLocked ? "Unlock" : "Lock production brief"}
              </button>
            )}
          </div>

          {briefReady ? (
            <>
              <p className="text-[11px] text-fg-dim">{shotCount} shots across {shotList.length} scenes · {characters.length} characters locked. These character refs are reused in every clip prompt downstream.</p>
              <div className="flex flex-wrap gap-1.5">
                {characters.map(c => (
                  <span key={c.id} className="inline-flex items-center gap-1 text-[10px] text-fg-dim border border-line rounded-full pl-1 pr-2 py-0.5">
                    {portraits[c.id]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={portraits[c.id]} alt={c.name} className="w-4 h-4 rounded-full object-cover" />
                      : <span className="w-4 h-4 rounded-full bg-surface-2 inline-block" />}
                    {c.name}
                  </span>
                ))}
              </div>
              {briefLocked
                ? <p className="text-[12px] font-medium text-accent">✓ Brief locked. Next: Stage 1 keyframes (start/end frame per clip) → Stage 2 Seedance 2.5 (reference-to-video) → assembly → export. Building in the next update.</p>
                : <p className="text-[11px] text-fg-mute">Review the shot list + cast above, then lock the brief to freeze it as the input for keyframe generation.</p>}
            </>
          ) : (
            <p className="text-[11px] text-fg-mute">
              To build the production brief: {shotCount === 0 && <>generate the <b>shot list</b></>}{shotCount === 0 && !allConfirmed && " and "}{!allConfirmed && <>confirm all <b>{characters.length} characters</b> ({lockedCount}/{characters.length} done)</>}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
