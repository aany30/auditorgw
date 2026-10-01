
import { useRef, useState } from "react";
import type { VoiceCloneUpdate } from "@/lib/media-analyser/api-types";

/* Voice Clone — clone a creator's voice from one sample (FAL f5-tts) and speak scripts in it. */

interface ScriptResult { script: string; audioUrl?: string; error?: string; status: "pending" | "running" | "done" | "error" }

export function VoiceClone() {
  const [sampleDataUrl, setSampleDataUrl] = useState("");
  const [sampleName, setSampleName] = useState("");
  const [scripts, setScripts] = useState<string[]>([""]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<ScriptResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const setScript = (i: number, v: string) => setScripts(s => s.map((x, j) => (j === i ? v : x)));
  const addScript = () => setScripts(s => (s.length < 10 ? [...s, ""] : s));
  const removeScript = (i: number) => setScripts(s => (s.length > 1 ? s.filter((_, j) => j !== i) : s));

  const cleanScripts = scripts.map(s => s.trim()).filter(Boolean);
  const canRun = !running && !!sampleDataUrl && cleanScripts.length > 0;

  async function run() {
    setRunning(true); setError(""); setMessage("Starting…");
    setResults(cleanScripts.map(s => ({ script: s, status: "pending" })));
    const ac = new AbortController(); abortRef.current = ac;
    try {
      const res = await fetch("/api/media-analyser/voice-clone", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ voiceSampleDataUrl: sampleDataUrl, scripts: cleanScripts }),
      });
      if (!res.ok || !res.body) { setError((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`); setRunning(false); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const chunks = buf.split("\n\n"); buf = chunks.pop() || "";
        for (const c of chunks) {
          const line = c.split("\n").find(l => l.startsWith("data: ")); if (!line) continue;
          const u = JSON.parse(line.slice(6)) as VoiceCloneUpdate;
          if (u.message) setMessage(u.message);
          if (u.phase === "error") { setError(u.error || "Generation failed"); continue; }
          if (u.phase === "cloning" && typeof u.index === "number") {
            setResults(r => r.map((x, j) => (j === u.index ? { ...x, status: "running" } : x)));
          }
          if (u.phase === "result" && typeof u.index === "number") {
            setResults(r => r.map((x, j) => (j === u.index ? { ...x, status: "done", audioUrl: u.audioUrl } : x)));
          }
          if (u.phase === "item-error" && typeof u.index === "number") {
            setResults(r => r.map((x, j) => (j === u.index ? { ...x, status: "error", error: u.error } : x)));
          }
        }
      }
      setMessage("");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-mute focus:outline-none focus:border-accent";
  const lbl = "text-xs font-medium text-fg-dim";

  return (
    <div className="space-y-6 animate-rise">
      <div className="space-y-1">
        <p className="eyebrow">Creative Studio</p>
        <h2 className="text-xl font-semibold text-fg tracking-tight">Voice Clone</h2>
        <p className="text-sm text-fg-dim max-w-2xl">Upload one clean voice sample, then type any scripts — we clone the voice with FAL (f5-tts) and speak each script in it. Reference should be clear speech, ~5–15s, one speaker.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* inputs */}
        <div className="card px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label className={lbl}>Reference voice <span className="text-fg-mute">· required — clean speech, 5–15s (mp3, wav, m4a)</span></label>
            <label className={`${field} flex items-center justify-between cursor-pointer`}>
              <span className="truncate text-fg-mute">{sampleName || "Upload a voice sample"}</span>
              <span className="text-accent text-xs ml-2 shrink-0">{sampleDataUrl ? "Change" : "Browse"}</span>
              <input type="file" accept="audio/*" className="hidden" disabled={running}
                onChange={async e => { const f = e.target.files?.[0]; if (!f) return; setSampleName(f.name);
                  setSampleDataUrl(await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); })); }} />
            </label>
            {sampleDataUrl && <audio src={sampleDataUrl} controls className="w-full h-9" />}
          </div>

          <div className="space-y-2">
            <label className={lbl}>Scripts <span className="text-fg-mute">· one clip per script (up to 10)</span></label>
            {scripts.map((s, i) => (
              <div key={i} className="flex gap-2 items-start">
                <textarea className={field} rows={2} placeholder={`Script ${i + 1} — what the voice should say…`} value={s} onChange={e => setScript(i, e.target.value)} disabled={running} />
                {scripts.length > 1 && (
                  <button type="button" onClick={() => removeScript(i)} disabled={running} className="mt-1 text-fg-mute hover:text-alert text-lg leading-none shrink-0">×</button>
                )}
              </div>
            ))}
            {scripts.length < 10 && (
              <button type="button" onClick={addScript} disabled={running} className="text-xs font-medium text-accent hover:underline">+ Add script</button>
            )}
          </div>

          <button onClick={run} disabled={!canRun}
            className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${canRun ? "bg-accent text-white hover:opacity-90" : "bg-surface-2 text-fg-mute cursor-not-allowed"}`}>
            {running ? "Cloning…" : "Clone voice & speak scripts"}
          </button>
          {message && running && <p className="text-xs text-fg-dim">{message}</p>}
          {error && <p className="text-xs text-alert leading-relaxed">{error}</p>}
        </div>

        {/* outputs */}
        <div className="card px-6 py-5 space-y-3">
          <p className={lbl}>Cloned audio</p>
          {results.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line bg-surface-2/50 grid place-items-center text-xs text-fg-mute" style={{ minHeight: 200 }}>
              Your cloned clips will appear here, one per script.
            </div>
          ) : (
            <ul className="space-y-3">
              {results.map((r, i) => (
                <li key={i} className="rounded-lg border border-line p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-fg-dim line-clamp-2">{r.script}</p>
                    <span className="text-[10px] font-mono uppercase tracking-wide text-fg-mute shrink-0">
                      {r.status === "running" ? "cloning…" : r.status === "done" ? "ready" : r.status === "error" ? "failed" : "queued"}
                    </span>
                  </div>
                  {r.status === "running" && <div className="h-1 rounded-full bg-surface-2 overflow-hidden"><div className="h-full w-1/2 bg-accent animate-pulse" /></div>}
                  {r.audioUrl && (
                    <div className="space-y-1.5">
                      <audio src={r.audioUrl} controls className="w-full h-9" />
                      <a href={r.audioUrl} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">↓ Download</a>
                    </div>
                  )}
                  {r.error && <p className="text-[11px] text-alert">{r.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
