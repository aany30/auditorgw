
import { useState, useCallback } from "react";
import type { AdReelAnalysis } from "@/lib/media-analyser/ad-reel-analysis";
import type { CloneReelPlan } from "@/lib/media-analyser/api-types";
import type { VibeCloneKeyframeResponse } from "@/lib/media-analyser/api-types";
import type { CloneReelClipResponse } from "@/lib/media-analyser/api-types";

/* Clone Reel — recreate a competitor's analysed reel for the user's own product.
   Plan (Gemini) → keyframe (Seedream) → single 15s clip (Seedance). */

type Phase = "input" | "planning" | "keyframe" | "rendering" | "done" | "error";

const readFile = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f);
});
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export function CloneReelModal({ reel, onClose }: { reel: AdReelAnalysis; onClose: () => void }) {
  const [productImages, setProductImages] = useState<string[]>([]);
  const [modelImages, setModelImages] = useState<string[]>([]);
  const [productName, setProductName] = useState("");
  const [aspect, setAspect] = useState<"9:16" | "16:9">("9:16");
  const [adSeconds, setAdSeconds] = useState<15 | 30>(15);   // reel length: 15s or 30s (Seedance 2.5)

  const [phase, setPhase] = useState<Phase>("input");
  const [status, setStatus] = useState("");
  const [script, setScript] = useState("");
  const [keyframeUrl, setKeyframeUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState("");

  const busy = phase === "planning" || phase === "keyframe" || phase === "rendering";
  const canRun = !busy && productImages.length > 0;

  const upload = useCallback(async (files: FileList | null, which: "product" | "model") => {
    if (!files?.length) return;
    const max = which === "product" ? 3 : 1;
    const arr = await Promise.all(Array.from(files).slice(0, max).map(readFile));
    const clean = arr.filter(u => u.startsWith("data:image/"));
    if (which === "product") setProductImages(p => [...p, ...clean].slice(0, 3));
    else setModelImages(clean.slice(0, 1));
  }, []);

  const run = useCallback(async () => {
    if (!canRun) return;
    setError(""); setVideoUrl(""); setKeyframeUrl(""); setScript("");
    try {
      setPhase("planning"); setStatus("Writing the 15s script for your product…");
      const plan = await postJson<CloneReelPlan>("/api/clone-reel/plan", { reel, productName: productName.trim(), aspect });
      setScript(plan.script);

      setPhase("keyframe"); setStatus("Generating the hero keyframe (Seedream)…");
      const kf = await postJson<VibeCloneKeyframeResponse>("/api/vibe-clone-ugc/keyframe", {
        keyframePrompt: plan.keyframePrompt, productImageDataUrls: productImages, modelImageDataUrls: modelImages, aspect,
      });
      setKeyframeUrl(kf.imageUrl);

      setPhase("rendering"); setStatus("Rendering the 15-second reel (Seedance)… this takes a few minutes.");
      const clip = await postJson<CloneReelClipResponse>("/api/clone-reel/clip", {
        imageUrl: kf.imageUrl, prompt: plan.motionPrompt, aspect, durationSec: adSeconds,
      });
      setVideoUrl(clip.videoUrl);
      setPhase("done"); setStatus("Done.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [canRun, reel, productName, aspect, adSeconds, productImages, modelImages]);

  const steps: { key: Phase; label: string }[] = [
    { key: "planning", label: "Script" }, { key: "keyframe", label: "Keyframe" }, { key: "rendering", label: "15s render" },
  ];
  const order = (p: Phase) => ({ input: -1, planning: 0, keyframe: 1, rendering: 2, done: 3, error: -1 }[p]);

  const fld = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-mute focus:outline-none focus:border-accent";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-bg p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-fg">Clone this reel for your product</h3>
            <p className="text-xs text-fg-mute mt-0.5">Mirrors the competitor reel&apos;s structure ({reel.reel_type_label || reel.reel_type}) with your product — 15s, one Seedance render.</p>
          </div>
          <button onClick={onClose} className="text-fg-mute hover:text-fg text-xl leading-none">×</button>
        </div>

        {phase !== "done" && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-dim">Your product photo(s) <span className="text-fg-mute">· up to 3, required</span></label>
              <div className="flex gap-2 flex-wrap">
                {productImages.map((u, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <div key={i} className="relative"><img src={u} alt="" className="w-16 h-16 object-cover rounded-md border border-line" />
                    <button onClick={() => setProductImages(p => p.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-fg text-bg text-[10px] leading-none">×</button>
                  </div>
                ))}
                {productImages.length < 3 && (
                  <label className="w-16 h-16 rounded-md border border-dashed border-line grid place-items-center cursor-pointer text-fg-mute hover:border-accent text-xl">
                    +<input type="file" accept="image/*" multiple className="hidden" onChange={e => upload(e.target.files, "product")} />
                  </label>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-fg-dim">Product name <span className="text-fg-mute">(optional)</span></label>
                <input className={fld} value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. Mokobara Trunk" disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-fg-dim">Aspect</label>
                <select className={fld} value={aspect} onChange={e => setAspect(e.target.value as "9:16" | "16:9")} disabled={busy}>
                  <option value="9:16">9:16 · vertical</option>
                  <option value="16:9">16:9 · landscape</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-fg-dim">Length</label>
                <select className={fld} value={adSeconds} onChange={e => setAdSeconds(Number(e.target.value) === 30 ? 30 : 15)} disabled={busy}>
                  <option value={15}>15 seconds</option>
                  <option value={30}>30 seconds</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-dim">Talent photo <span className="text-fg-mute">(optional — if the reel features a person)</span></label>
              <div className="flex gap-2">
                {modelImages[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <div className="relative"><img src={modelImages[0]} alt="" className="w-16 h-16 object-cover rounded-md border border-line" />
                    <button onClick={() => setModelImages([])} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-fg text-bg text-[10px] leading-none">×</button>
                  </div>
                ) : (
                  <label className="w-16 h-16 rounded-md border border-dashed border-line grid place-items-center cursor-pointer text-fg-mute hover:border-accent text-xl">
                    +<input type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files, "model")} />
                  </label>
                )}
              </div>
            </div>

            <button onClick={run} disabled={!canRun}
              className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium ${canRun ? "bg-accent text-bg hover:opacity-90" : "bg-surface-2 text-fg-mute cursor-not-allowed"}`}>
              {busy ? "Generating…" : "Generate 15s clone reel"}
            </button>
          </>
        )}

        {(busy || phase === "done") && (
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => {
              const cur = order(phase); const st = phase === "done" || cur > i ? "done" : cur === i ? "active" : "todo";
              return <div key={s.key} className="flex-1"><div className={`h-1.5 rounded-full ${st === "done" ? "bg-accent" : st === "active" ? "bg-accent/50 animate-pulse" : "bg-surface-2"}`} /><p className="mt-1 text-[10px] text-fg-mute">{s.label}</p></div>;
            })}
          </div>
        )}
        {busy && <p className="text-xs text-fg-dim">{status}</p>}
        {error && <p className="text-xs text-alert">{error}</p>}

        {videoUrl && (
          <div className="space-y-2">
            <video src={videoUrl} controls autoPlay loop className="w-full rounded-lg border border-line bg-black" style={{ maxHeight: 420 }} />
            <a href={videoUrl} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">↓ Download reel</a>
          </div>
        )}
        {script && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-fg-dim">Script</p>
            <p className="text-xs text-fg-dim leading-relaxed whitespace-pre-wrap rounded-lg border border-line bg-surface-2/50 px-3 py-2">{script}</p>
          </div>
        )}
      </div>
    </div>
  );
}
