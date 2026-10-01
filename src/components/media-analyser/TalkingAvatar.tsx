
import { useRef, useState } from "react";

/* Talking Avatar — topic/script → AI presenter → voiceover → lip-synced talking video. */

type Phase = "script" | "background" | "avatar" | "presenter" | "voiceover" | "reference" | "animating" | "lipsync" | "compositing" | "done" | "error";
const STEPS_AVATAR: { key: Phase; label: string }[] = [
  { key: "script", label: "Script" },
  { key: "presenter", label: "Presenter" },
  { key: "voiceover", label: "Voiceover" },
  { key: "animating", label: "Animate" },
  { key: "lipsync", label: "Lip-sync" },
];
const STEPS_REEL: { key: Phase; label: string }[] = [
  { key: "script", label: "Script" },
  { key: "background", label: "Top footage" },
  { key: "avatar", label: "Avatar" },
  { key: "voiceover", label: "Voice" },
  { key: "animating", label: "Animate" },
  { key: "compositing", label: "Composite" },
];
// "reference"/"lipsync" are sub-steps of the bottom-avatar build — fold into "animating" on the rail.
const railPhase = (p: Phase): Phase => (p === "reference" || p === "lipsync" ? "animating" : p);

export function TalkingAvatar() {
  const [outputMode, setOutputMode] = useState<"avatar" | "reel">("avatar");
  const [mode, setMode] = useState<"topic" | "script">("topic");
  const [topic, setTopic] = useState("");
  const [script, setScript] = useState("");
  const [presenter, setPresenter] = useState("");
  const [aspect, setAspect] = useState<"9:16" | "16:9">("9:16");
  const [length, setLength] = useState<"short" | "medium" | "long">("medium");
  const [language, setLanguage] = useState("");
  const [voiceCharacteristics, setVoice] = useState("");
  const [productImages, setProductImages] = useState<string[]>([]);
  const [audioFile, setAudioFile] = useState("");      // reel: uploaded voice audio (avatar lip-syncs to it)
  const [audioName, setAudioName] = useState("");
  const [environment, setEnvironment] = useState("");  // reel: background appearance text for the avatar scene
  const [reelSeconds, setReelSeconds] = useState<15 | 30>(15);  // reel length cap: 15s or 30s
  const [reelStyle, setReelStyle] = useState<"broll" | "studio">("broll");  // reel look: b-roll vs studio multi-angle

  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [message, setMessage] = useState("");
  const [outScript, setOutScript] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const steps = outputMode === "reel" ? STEPS_REEL : STEPS_AVATAR;
  const order = (p: Phase) => steps.findIndex(s => s.key === p);
  const canRun = !running && (outputMode === "reel"
    ? (audioFile !== "" && productImages.length > 0)   // reel: audio + a face photo is all we need
    : (mode === "topic" ? topic.trim().length > 2 : script.trim().length > 2));

  async function run() {
    setRunning(true); setError(""); setVideoUrl(""); setOutScript(""); setPhase("script"); setMessage("Starting…");
    const ac = new AbortController(); abortRef.current = ac;
    try {
      const res = await fetch(outputMode === "reel" ? "/api/media-analyser/reaction-reel" : "/api/media-analyser/talking-avatar", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({
          mode, topic, script, presenter, avatarDesc: presenter, aspect, length, language, voiceCharacteristics,
          productImageDataUrls: productImages, avatarImageDataUrls: productImages,
          audioDataUrl: audioFile || undefined,
          environment: environment || undefined,
          maxSeconds: reelSeconds,
          reelStyle,
        }),
      });
      if (!res.ok || !res.body) { setError((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`); setRunning(false); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const chunks = buf.split("\n\n"); buf = chunks.pop() || "";
        for (const c of chunks) {
          const line = c.split("\n").find(l => l.startsWith("data: ")); if (!line) continue;
          const u = JSON.parse(line.slice(6)) as { phase: Phase; message?: string; script?: string; presenterUrl?: string; videoUrl?: string; error?: string };
          if (u.phase === "error") { setError(u.error || "Generation failed"); continue; }
          setPhase(u.phase);
          if (u.message) setMessage(u.message);
          if (u.script) setOutScript(u.script);
          if (u.videoUrl) setVideoUrl(u.videoUrl);
        }
      }
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
        <h2 className="text-xl font-semibold text-fg tracking-tight">Talking Avatar</h2>
        <p className="text-sm text-fg-dim">A topic or script → an AI presenter that speaks it, lip-synced to a voiceover. Rendered end-to-end on FAL.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── inputs ── */}
        <div className="card px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label className={lbl}>Output</label>
            <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-xs">
              {(["avatar", "reel"] as const).map(o => (
                <button key={o} onClick={() => setOutputMode(o)} disabled={running}
                  className={`px-3 py-1.5 rounded-md transition-colors ${outputMode === o ? "bg-accent text-white" : "text-fg-dim hover:text-fg"}`}>
                  {o === "avatar" ? "Talking head" : "Reaction reel"}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-fg-mute">{outputMode !== "reel" ? "A single AI presenter that speaks to camera." : reelStyle === "studio" ? "Studio: the speaker fills the frame, cut between 3 camera angles, + captions." : "Split screen: stock footage up top, a talking AI avatar down bottom, + captions."}</p>
          </div>

          {outputMode === "reel" ? (
            /* Reaction reel: driven by an uploaded audio + a face photo. Two styles: b-roll split-screen,
               or studio multi-angle (speaker full-frame, cutting between 3 camera angles). */
            <>
              <div className="space-y-1.5">
                <label className={lbl}>Style</label>
                <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-xs">
                  {([["broll", "Background video"], ["studio", "Studio · 3 angles"]] as const).map(([v, label]) => (
                    <button key={v} type="button" onClick={() => setReelStyle(v)} disabled={running}
                      className={`px-3 py-1.5 rounded-md transition-colors ${reelStyle === v ? "bg-accent text-white" : "text-fg-dim hover:text-fg"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={lbl}>Audio <span className="text-fg-mute">· required — the avatar speaks &amp; lip-syncs to this; it&apos;s transcribed to drive the b-roll &amp; captions</span></label>
                <label className={`${field} flex items-center justify-between cursor-pointer`}>
                  <span className="truncate text-fg-mute">{audioName || "Upload an audio file (mp3, wav, m4a…)"}</span>
                  <span className="text-accent text-xs ml-2 shrink-0">{audioFile ? "Change" : "Browse"}</span>
                  <input type="file" accept="audio/*" className="hidden" disabled={running}
                    onChange={async e => { const f = e.target.files?.[0]; if (!f) return; setAudioName(f.name);
                      setAudioFile(await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); })); }} />
                </label>
                {audioFile && <button type="button" onClick={() => { setAudioFile(""); setAudioName(""); }} className="text-[11px] text-fg-mute hover:text-alert">Remove</button>}
              </div>

              <div className="space-y-1.5">
                <label className={lbl}>Face photo <span className="text-fg-mute">· required — one clear photo of the person; the avatar is generated to look like them</span></label>
                <div className="flex gap-2 flex-wrap">
                  {productImages.map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <div key={i} className="relative"><img src={u} alt="" className="w-14 h-14 object-cover rounded-md border border-line" />
                      <button type="button" onClick={() => setProductImages(p => p.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-fg text-bg text-[10px] leading-none">×</button>
                    </div>
                  ))}
                  {productImages.length < 1 && (
                    <label className="w-14 h-14 rounded-md border border-dashed border-line grid place-items-center cursor-pointer text-fg-mute hover:border-accent text-xl">
                      +<input type="file" accept="image/*" className="hidden" disabled={running}
                        onChange={async e => {
                          const f = e.target.files?.[0]; if (!f) return;
                          const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
                          if (url.startsWith("data:image/")) setProductImages([url]);
                        }} />
                    </label>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={lbl}>{reelStyle === "studio" ? "Studio style" : "Background appearance"} <span className="text-fg-mute">(optional)</span></label>
                <textarea className={field} rows={2} placeholder={reelStyle === "studio" ? "e.g. sleek dark podcast studio, warm rim light, blurred neon set behind" : "e.g. cozy home office with a bookshelf and warm lamp light behind the person"} value={environment} onChange={e => setEnvironment(e.target.value)} disabled={running} />
              </div>

              <div className="space-y-1.5">
                <label className={lbl}>Max length</label>
                <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-xs">
                  {([15, 30] as const).map(s => (
                    <button key={s} type="button" onClick={() => setReelSeconds(s)} disabled={running}
                      className={`px-3 py-1.5 rounded-md transition-colors ${reelSeconds === s ? "bg-accent text-white" : "text-fg-dim hover:text-fg"}`}>
                      {s}s
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-fg-mute">The reel matches your audio length, capped here. 30s renders take longer.</p>
              </div>
            </>
          ) : (
            <>
              <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-xs">
                {(["topic", "script"] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)} disabled={running}
                    className={`px-3 py-1.5 rounded-md transition-colors ${mode === m ? "bg-accent text-white" : "text-fg-dim hover:text-fg"}`}>
                    {m === "topic" ? "From a topic" : "My own script"}
                  </button>
                ))}
              </div>

              {mode === "topic" ? (
                <div className="space-y-1.5">
                  <label className={lbl}>Topic</label>
                  <textarea className={field} rows={3} placeholder="e.g. Why hard-shell luggage beats soft-shell for frequent flyers" value={topic} onChange={e => setTopic(e.target.value)} disabled={running} />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className={lbl}>Script (what the presenter says)</label>
                  <textarea className={field} rows={5} placeholder="Paste the exact words the presenter should say…" value={script} onChange={e => setScript(e.target.value)} disabled={running} />
                </div>
              )}

              <div className="space-y-1.5">
                <label className={lbl}>Presenter (AI-generated from this description)</label>
                <input className={field} placeholder="e.g. a warm 30-something Indian woman, business-casual, studio backdrop" value={presenter} onChange={e => setPresenter(e.target.value)} disabled={running} />
              </div>

              <div className="space-y-1.5">
                <label className={lbl}>Product photo(s) <span className="text-fg-mute">· optional — the presenter will hold &amp; showcase it</span></label>
                <div className="flex gap-2 flex-wrap">
                  {productImages.map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <div key={i} className="relative"><img src={u} alt="" className="w-14 h-14 object-cover rounded-md border border-line" />
                      <button type="button" onClick={() => setProductImages(p => p.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-fg text-bg text-[10px] leading-none">×</button>
                    </div>
                  ))}
                  {productImages.length < 3 && (
                    <label className="w-14 h-14 rounded-md border border-dashed border-line grid place-items-center cursor-pointer text-fg-mute hover:border-accent text-xl">
                      +<input type="file" accept="image/*" multiple className="hidden" disabled={running}
                        onChange={async e => {
                          const files = Array.from(e.target.files ?? []).slice(0, 3);
                          const urls = await Promise.all(files.map(f => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); })));
                          setProductImages(p => [...p, ...urls.filter(u => u.startsWith("data:image/"))].slice(0, 3));
                        }} />
                    </label>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={lbl}>Aspect</label>
                  <select className={field} value={aspect} onChange={e => setAspect(e.target.value as "9:16" | "16:9")} disabled={running}>
                    <option value="9:16">9:16 · vertical</option>
                    <option value="16:9">16:9 · landscape</option>
                  </select>
                </div>
                {mode === "topic" && (
                  <div className="space-y-1.5">
                    <label className={lbl}>Length</label>
                    <select className={field} value={length} onChange={e => setLength(e.target.value as "short" | "medium" | "long")} disabled={running}>
                      <option value="short">Short · ~15s</option>
                      <option value="medium">Medium · ~30s</option>
                      <option value="long">Long · ~45s</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={lbl}>Language <span className="text-fg-mute">(optional)</span></label>
                  <input className={field} placeholder="e.g. Hinglish" value={language} onChange={e => setLanguage(e.target.value)} disabled={running} />
                </div>
                <div className="space-y-1.5">
                  <label className={lbl}>Voice style <span className="text-fg-mute">(optional)</span></label>
                  <input className={field} placeholder="e.g. warm, upbeat female" value={voiceCharacteristics} onChange={e => setVoice(e.target.value)} disabled={running} />
                </div>
              </div>
            </>
          )}

          <button onClick={run} disabled={!canRun}
            className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${canRun ? "bg-accent text-white hover:opacity-90" : "bg-surface-2 text-fg-mute cursor-not-allowed"}`}>
            {running ? "Generating…" : outputMode === "reel" ? "Generate reaction reel" : "Generate talking avatar"}
          </button>
          {error && <p className="text-xs text-alert leading-relaxed">{error}</p>}
        </div>

        {/* ── output ── */}
        <div className="card px-6 py-5 space-y-4">
          {/* progress rail */}
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => {
              const cur = phase ? order(railPhase(phase)) : -1;
              const state = phase === "done" || cur > i ? "done" : cur === i ? "active" : "todo";
              return (
                <div key={s.key} className="flex-1">
                  <div className={`h-1.5 rounded-full ${state === "done" ? "bg-accent" : state === "active" ? "bg-accent/50 animate-pulse" : "bg-surface-2"}`} />
                  <p className={`mt-1 text-[10px] ${state === "todo" ? "text-fg-mute" : "text-fg-dim"}`}>{s.label}</p>
                </div>
              );
            })}
          </div>
          {(running || message) && <p className="text-xs text-fg-dim">{phase === "done" ? "Done." : message}</p>}

          {videoUrl ? (
            <div className="space-y-2">
              <video src={videoUrl} controls autoPlay loop className="w-full rounded-lg border border-line bg-black" style={{ maxHeight: 460 }} />
              <a href={videoUrl} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">↓ Download video</a>
            </div>
          ) : (
            // Don't surface the intermediate presenter still — only show the placeholder
            // until the final lip-synced video is ready.
            <div className="rounded-lg border border-dashed border-line bg-surface-2/50 grid place-items-center text-xs text-fg-mute" style={{ minHeight: 220 }}>
              {running ? "Rendering…" : outputMode === "reel" ? "Your reel will appear here." : "Your talking avatar will appear here."}
            </div>
          )}

          {outScript && (
            <div className="space-y-1">
              <p className={lbl}>Script</p>
              <p className="text-sm text-fg-dim leading-relaxed whitespace-pre-wrap rounded-lg border border-line bg-surface-2/50 px-3 py-2">{outScript}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
