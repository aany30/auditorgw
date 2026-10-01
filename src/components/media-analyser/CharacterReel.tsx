
import { useRef, useState } from "react";
import ModelSelect from "@/components/media-analyser/ModelSelect";
import { TTS_VOICES, DEFAULT_TTS_VOICE } from "@/lib/media-analyser/generation-models";

// Mirrors the SSE Update shape emitted by /api/reaction-reel.
interface ReelUpdate {
  phase: "script" | "background" | "avatar" | "voiceover" | "reference" | "animating" | "lipsync" | "compositing" | "done" | "error";
  message?: string;
  script?: string;
  avatarUrl?: string;
  videoUrl?: string;
  error?: string;
}

type Phase = "idle" | "running" | "done" | "error";

const PHASE_LABEL: Record<string, string> = {
  script: "Preparing script",
  voiceover: "Recording the voice",
  avatar: "Building camera angles",
  animating: "Lip-syncing the character",
  reference: "Setting the scene",
  background: "Preparing footage",
  lipsync: "Lip-syncing",
  compositing: "Cutting the reel",
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

type Source = "script" | "audio";

const MAX_IMAGES = 10;

export function CharacterReel() {
  const [images, setImages] = useState<string[]>([]);
  const [pipeline, setPipeline] = useState<"seedance" | "kling">("seedance");
  const [source, setSource] = useState<Source>("script");
  const [script, setScript] = useState("");
  const [voiceId, setVoiceId] = useState<string>(DEFAULT_TTS_VOICE);
  const [audioData, setAudioData] = useState<string>("");   // uploaded audio as a data URL
  const [audioName, setAudioName] = useState("");
  const [seconds, setSeconds] = useState<20 | 30>(30);
  const [scene, setScene] = useState("");

  const [phase, setPhase] = useState<Phase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const running = phase === "running";

  const onAudio = (files: FileList | null) => {
    const f = files?.[0];
    if (!f || !f.type.startsWith("audio/")) return;
    const reader = new FileReader();
    reader.onload = () => { setAudioData(String(reader.result ?? "")); setAudioName(f.name); setVideoUrl(""); if (phase !== "idle") setPhase("idle"); };
    reader.readAsDataURL(f);
  };

  const onFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? []).filter(f => f.type.startsWith("image/"));
    if (!list.length) return;
    const slots = MAX_IMAGES - images.length;
    if (slots <= 0) return;
    const added: string[] = [];
    for (const f of list.slice(0, slots)) {
      try { added.push(await compressImage(f)); } catch { /* ignore */ }
    }
    if (added.length) { setImages(prev => [...prev, ...added]); setVideoUrl(""); if (phase !== "idle") setPhase("idle"); }
  };

  const generate = async () => {
    const ready = pipeline === "seedance" ? !!script.trim() : source === "audio" ? !!audioData : !!script.trim();
    if (running || !images.length || !ready) return;
    setPhase("running");
    setVideoUrl("");
    setStatusMsg("Starting…");

    const payload = {
      mode: "script",
      outputMode: "reel",
      pipeline,
      reelStyle: "studio",           // full-frame speaker, multi-angle — no b-roll library needed
      maxSeconds: seconds,
      avatarImageDataUrls: images,
      productImageDataUrls: images,
      environment: scene.trim() || undefined,
      // Seedance: script drives one Seedance 2.5 clip (its own audio). Kling: TTS voice reads the
      // script, or the character lip-syncs to your uploaded audio.
      ...(pipeline === "seedance"
        ? { script: script.trim() }
        : source === "audio"
          ? { audioDataUrl: audioData, script: "" }
          : { script: script.trim(), voiceId, language: "English" }),
    };

    try {
      const res = await fetch("/api/media-analyser/reaction-reel", {
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
            const u = JSON.parse(line.slice(6)) as ReelUpdate;
            if (u.phase === "error") { setPhase("error"); setStatusMsg(u.error ?? "Generation failed"); }
            else if (u.phase === "done") { setPhase("done"); setVideoUrl(u.videoUrl ?? ""); setStatusMsg("Done."); }
            else { setStatusMsg(u.message ?? PHASE_LABEL[u.phase] ?? "Working…"); }
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      setPhase("error");
      setStatusMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const reset = () => { setImages([]); setScript(""); setAudioData(""); setAudioName(""); setScene(""); setVideoUrl(""); setPhase("idle"); setStatusMsg(""); };

  const download = async () => {
    if (!videoUrl) return;
    try {
      const blob = await fetch(videoUrl).then(r => r.blob());
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "character-reel.mp4"; a.click(); URL.revokeObjectURL(a.href);
    } catch { window.open(videoUrl, "_blank"); }
  };

  const fieldCls = "w-full text-sm border border-line rounded-lg px-3 py-2 outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/40 disabled:opacity-50 bg-surface";
  const canGenerate = images.length > 0 && (pipeline === "seedance" ? !!script.trim() : source === "audio" ? !!audioData : !!script.trim()) && !running;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">
          Character Reel
          <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">lip-sync ✦</span>
        </h3>
        <p className="text-xs text-fg-dim mt-0.5 leading-relaxed max-w-2xl">
          Upload a character photo and a script → get a talking video. Seedance 2.5 renders the motion
          and audio from your script; or switch to Kling to lip-sync your exact uploaded face to a
          chosen voice (Indian or international) or your own uploaded audio.
        </p>
      </div>

      {/* Character images (up to 10) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-fg-dim">Character images</p>
          <span className="text-[10px] text-fg-mute">up to {MAX_IMAGES} — more angles/expressions = better consistency</span>
        </div>
        <div
          className={`border-2 border-dashed rounded-xl p-4 cursor-pointer transition-colors ${images.length ? "border-line bg-surface-2" : "border-line hover:border-accent/40 hover:bg-accent-soft/30"}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
        >
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { onFiles(e.target.files); e.target.value = ""; }} />
          {images.length ? (
            <div className="space-y-2" onClick={e => e.stopPropagation()}>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                {images.map((img, i) => (
                  <div key={i} className="relative group aspect-square">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img} alt="" className="w-full h-full object-cover rounded-md border border-line" />
                    <button type="button" onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">×</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-fg-mute">{images.length}/{MAX_IMAGES}</p>
                {images.length < MAX_IMAGES && (
                  <button type="button" onClick={() => fileRef.current?.click()} className="text-[11px] font-medium text-accent hover:underline">+ Add more</button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-5">
              <p className="text-sm font-medium text-fg-dim">Drop character photos here</p>
              <p className="text-[11px] text-fg-mute mt-0.5">JPG · PNG · WEBP · up to {MAX_IMAGES} — clear front-facing faces work best</p>
            </div>
          )}
        </div>
      </div>

      {/* Pipeline */}
      <div>
        <p className="text-xs font-medium text-fg-dim mb-1.5">Pipeline</p>
        <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line max-w-md">
          {([["seedance", "Seedance 2.5"], ["kling", "Kling — exact face"]] as const).map(([p, label]) => (
            <button key={p} onClick={() => { setPipeline(p); setVideoUrl(""); if (phase !== "idle") setPhase("idle"); }} disabled={running}
              className={`flex-1 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${pipeline === p ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-fg-mute mt-1">
          {pipeline === "seedance"
            ? "Seedance 2.5 renders the video and its own audio from your script (720p). Strong motion — but it won't preserve the exact uploaded face."
            : "Kling lip-syncs your exact uploaded character to a voice (TTS) or an audio file you upload."}
        </p>
      </div>

      {/* Kling: script (TTS voice) or upload your own audio */}
      {pipeline === "kling" && (
        <div className="flex rounded-lg border border-line overflow-hidden divide-x divide-line max-w-xs">
          {(["script", "audio"] as Source[]).map(s => (
            <button key={s} onClick={() => { setSource(s); setVideoUrl(""); if (phase !== "idle") setPhase("idle"); }} disabled={running}
              className={`flex-1 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${source === s ? "bg-accent text-bg" : "bg-surface text-fg-dim hover:bg-surface-2"}`}>
              {s === "script" ? "Write a script" : "Upload audio"}
            </button>
          ))}
        </div>
      )}

      {/* Script — Seedance always; Kling when in script mode */}
      {(pipeline === "seedance" || source === "script") && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-fg-dim">{pipeline === "seedance" ? "Script — what the character says (drives Seedance)" : "Script — the exact words the character says"}</p>
          <textarea value={script} onChange={e => setScript(e.target.value)} disabled={running} rows={6}
            placeholder={"Paste your script here — just the spoken lines, no stage directions."} className={`${fieldCls} leading-relaxed`} />
          <p className="text-[10px] text-fg-mute">{script.trim() ? `${script.trim().split(/\s+/).length} words` : "≈ 2.3 words/sec — 30s fits ~70 words"}</p>
        </div>
      )}

      {/* Audio upload — Kling audio mode only */}
      {pipeline === "kling" && source === "audio" && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-fg-dim">Voice audio — the character lip-syncs to this</p>
          <button type="button" onClick={() => audioRef.current?.click()} disabled={running}
            className="w-full flex items-center justify-between text-sm border border-line rounded-lg px-3 py-2.5 hover:bg-surface-2 disabled:opacity-50 transition-colors">
            <span className="truncate text-fg-dim">{audioName || "Upload an audio file (mp3, wav, m4a…)"}</span>
            <span className="text-accent text-xs ml-2 shrink-0">{audioData ? "Change" : "Browse"}</span>
          </button>
          <input ref={audioRef} type="file" accept="audio/*" className="hidden" disabled={running}
            onChange={e => { onAudio(e.target.files); e.target.value = ""; }} />
          {audioData && (
            <div className="flex items-center gap-3">
              <audio src={audioData} controls className="h-8 w-full max-w-xs" />
              <button type="button" onClick={() => { setAudioData(""); setAudioName(""); }} className="text-[11px] text-fg-mute hover:text-alert shrink-0">Remove</button>
            </div>
          )}
          <p className="text-[10px] text-fg-mute">Captions are auto-transcribed from your audio. The reel matches the audio length, capped below.</p>
        </div>
      )}

      {/* Settings row: voice (Kling script mode) + length */}
      <div className="flex items-end gap-4 flex-wrap">
        {pipeline === "kling" && source === "script" && (
          <ModelSelect label="Voice" options={TTS_VOICES.map(v => ({ id: v.id, label: v.label }))} value={voiceId} onChange={setVoiceId} disabled={running} />
        )}
        <ModelSelect
          label={pipeline === "kling" && source === "audio" ? "Length cap" : "Length"}
          options={[{ id: "20", label: "20 seconds" }, { id: "30", label: "30 seconds" }]}
          value={String(seconds)}
          onChange={v => setSeconds(Number(v) === 20 ? 20 : 30)}
          disabled={running}
        />
      </div>

      {/* Scene (optional) */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-fg-dim">Scene / studio look <span className="text-fg-mute">(optional)</span></p>
        <input value={scene} onChange={e => setScene(e.target.value)} disabled={running} placeholder="e.g. warm study with wooden bookshelves and soft lamp light behind her" className={fieldCls} />
      </div>

      {/* Generate / Clear */}
      <div className="flex gap-2">
        <button onClick={generate} disabled={!canGenerate}
          className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${canGenerate ? "bg-gradient-to-r from-accent to-accent text-white shadow-sm hover:opacity-90" : "bg-surface-2 text-fg-mute cursor-not-allowed"}`}>
          {running ? "Generating reel…" : `Generate ${seconds}s reel`}
        </button>
        {(images.length > 0 || script || audioData || videoUrl) && !running && (
          <button onClick={reset} className="px-4 py-2.5 text-sm text-fg-mute hover:text-fg-dim transition-colors">Clear</button>
        )}
      </div>

      {/* Status */}
      {phase !== "idle" && statusMsg && (
        <div className="flex items-center gap-2 text-sm">
          {running && <span className="w-3.5 h-3.5 border-2 border-accent/40 border-t-transparent rounded-full animate-spin shrink-0" />}
          <span className={phase === "error" ? "text-alert" : phase === "done" ? "text-accent-2 font-medium" : "text-fg-dim"}>{statusMsg}</span>
        </div>
      )}
      {running && (
        <p className="text-[11px] text-fg-mute">This takes several minutes{pipeline === "kling" ? " — the character is filmed from 3 angles and lip-synced" : " — Seedance is rendering the clip"}. Keep this tab open.</p>
      )}

      {/* Result */}
      {videoUrl && (
        <div className="space-y-2">
          <div className="relative bg-black rounded-xl overflow-hidden aspect-[9/16] max-w-xs mx-auto">
            <video src={videoUrl} className="w-full h-full object-cover" controls playsInline preload="metadata" />
          </div>
          <div className="flex justify-center">
            <button onClick={download} className="text-[11px] text-accent hover:text-accent bg-accent-soft hover:bg-accent-soft px-3 py-1.5 rounded-md transition-colors">Download video</button>
          </div>
        </div>
      )}
    </div>
  );
}
