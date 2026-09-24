
import { Fragment, useMemo, useState } from "react";
import type { AnalysisResponse, SocialPaidAd } from "@/lib/media-analyser/types";
import type { AdReelAnalysis } from "@/lib/media-analyser/ad-reel-analysis";
import { classifyInfluencer, adLanguageLabel, adFormatKey } from "@/lib/media-analyser/paid-ad-stats";
import ModelSelect from "@/components/media-analyser/ModelSelect";
import { ReelAnalysisCard } from "@/components/media-analyser/ReelAnalysisCard";

interface BrandAds { brand: string; ads: SocialPaidAd[] }
type Only = "all" | "influencer" | "regional" | "live";
type RangeKey = "1m" | "6m" | "all";
/** Precise per-ad verdict from the opt-in deep scan (video + audio). */
interface DeepVerdict { adId: string; isInfluencer: boolean; confidence: number; personTalking: boolean; language: string; isRegional: boolean }

const DAY = 86_400_000;
const withinDays = (ad: SocialPaidAd, days: number, now: number) => {
  const t = ad.startTime ? new Date(ad.startTime).getTime() : 0;
  return !!t && now - t <= days * DAY;
};
const rangeFilter = (ads: SocialPaidAd[], key: RangeKey, now: number) =>
  key === "all" ? ads : ads.filter(a => withinDays(a, key === "1m" ? 30 : 180, now));

/** Route CDN images through the CORS-safe proxy (fbcdn / cdninstagram expire otherwise). */
function proxyImageUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  if (/cdninstagram\.com|fbcdn\.net|instagram\.com/.test(rawUrl)) return `/api/media-analyser/image-proxy?url=${encodeURIComponent(rawUrl)}`;
  return rawUrl;
}

/** Canonical public Ad Library URL for one ad (never the product/IG link). */
function adLibraryUrl(ad: SocialPaidAd): string | null {
  if (ad.adId) return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.adId)}`;
  return ad.adSnapshotUrl && /\/ads\/library/i.test(ad.adSnapshotUrl) ? ad.adSnapshotUrl : null;
}

/**
 * "Ad Table ✦" — per-ad classification: influencer? · language (regional?) · live?
 * Confirms, at a glance, which of a brand's ads are influencer/creator ads and which
 * run in a regional language — and whether they're still live. (Signals come from the
 * ad copy + the first-frame Gemini vision pass; audio-only language isn't captured.)
 */
export function AdClassifyTable({ result }: { result: AnalysisResponse }) {
  const brands = useMemo<BrandAds[]>(() => {
    const social = result.socialSnapshot as Record<string, unknown> | null | undefined;
    const youAds = (social?.paidAds ?? []) as SocialPaidAd[];
    const list: BrandAds[] = [];
    if (youAds.length) list.push({ brand: "You", ads: youAds });
    for (const c of (result.competitorSocial ?? []) as Array<Record<string, unknown>>) {
      const ads = (c.ads ?? []) as SocialPaidAd[];
      if (ads.length) list.push({ brand: String(c.brand ?? "Competitor"), ads });
    }
    return list;
  }, [result]);

  const [selected, setSelected] = useState<string>(() => {
    const firstComp = brands.find(b => b.brand !== "You");
    return (firstComp ?? brands[0])?.brand ?? "";
  });
  const [only, setOnly] = useState<Only>("all");
  // Phase-2 deep-scan state (precise per-ad verdicts, keyed by adId).
  const [deep, setDeep] = useState<Map<string, DeepVerdict>>(() => new Map());
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [precise, setPrecise] = useState(false);
  // Per-ad on-demand reel analysis (the "Analyze" button — same as the card grid).
  const [reels, setReels] = useState<Map<string, AdReelAnalysis>>(() => new Map());
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [reelErr, setReelErr] = useState<Map<string, string>>(() => new Map());
  const [expanded, setExpanded] = useState<string | null>(null);

  const active = brands.find(b => b.brand === selected) ?? brands[0];

  const analyzeAd = async (ad: SocialPaidAd) => {
    const id = ad.adId;
    if (analyzingId) return; // one at a time keeps the Gemini video pass within budget
    setAnalyzingId(id);
    setReelErr(prev => { const m = new Map(prev); m.delete(id); return m; });
    try {
      const res = await fetch("/api/media-analyser/analyze-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad }),
      });
      const data = (await res.json().catch(() => ({}))) as { analysis?: AdReelAnalysis; error?: string };
      if (!res.ok || !data.analysis) throw new Error(data.error ?? "Analysis failed");
      setReels(prev => { const m = new Map(prev); m.set(id, data.analysis!); return m; });
      setExpanded(id);
    } catch (e) {
      setReelErr(prev => { const m = new Map(prev); m.set(id, e instanceof Error ? e.message : "Analysis failed"); return m; });
    } finally {
      setAnalyzingId(null);
    }
  };

  // Classify every ad once. A precise deep-scan verdict (if run) overrides the estimate.
  // Priority for the verdict: per-ad AI analysis (r) > batch deep-scan (d) > fast estimate.
  const rows = useMemo(() => (active?.ads ?? []).map(ad => {
    const r = reels.get(ad.adId);
    const d = deep.get(ad.adId);
    const inf = classifyInfluencer(ad);
    const lang = r?.spoken_language || d?.language || adLanguageLabel(ad);
    return {
      ad,
      influencer: r ? r.is_influencer : d ? d.isInfluencer : inf.isInfluencer,
      influencerReason: r ? (r.reel_type_label || "AI reel analysis") : d ? (d.personTalking ? "Person talking to camera (video)" : "Video analysis") : inf.reason,
      influencerConf: r ? r.confidence : d ? d.confidence : inf.confidence,
      language: lang,
      regional: r ? lang !== "English" : d ? d.isRegional : lang !== "English",
      format: adFormatKey(ad),
      live: ad.isActive !== false,
      precise: !!(r || d),
    };
  }), [active, deep, reels]);

  if (!brands.length) {
    return (
      <div className="py-8 space-y-2">
        <p className="text-sm text-fg-dim font-medium">No scraped ads to classify yet.</p>
        <p className="text-xs text-fg-mute">Run an analysis with a Meta Ad Library URL and/or competitors, then break their ads down by influencer / language / live here.</p>
      </div>
    );
  }

  const shown = rows.filter(r =>
    only === "all" ? true :
    only === "influencer" ? r.influencer :
    only === "regional" ? r.regional :
    r.live,
  );

  const nInfluencer = rows.filter(r => r.influencer).length;
  const nRegional = rows.filter(r => r.regional).length;
  const nLive = rows.filter(r => r.live).length;
  const preciseCount = rows.filter(r => r.precise).length;

  // ── Phase 2: precise deep scan (video + audio) over a chosen time range ──
  const now = Date.now();
  const vidCount = (key: RangeKey) => rangeFilter(active.ads, key, now).filter(a => a.videoUrl).length;

  const runDeepScan = async (key: RangeKey) => {
    const ads = rangeFilter(active.ads, key, now);
    const total = ads.filter(a => a.videoUrl).length;
    if (!total) { setScanError("No video ads in this range."); return; }
    setScanning(true); setScanError(null); setProgress({ done: 0, total });
    try {
      const res = await fetch("/api/media-analyser/ad-deep-scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ads }) });
      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const u = JSON.parse(line.slice(6)) as { phase: string; done?: number; total?: number; message?: string; verdicts?: DeepVerdict[] };
            if (u.phase === "scanning" && u.total != null) setProgress({ done: u.done ?? 0, total: u.total });
            if (u.phase === "error") setScanError(u.message ?? "Scan failed");
            if (u.phase === "done") {
              setDeep(prev => { const m = new Map(prev); for (const v of (u.verdicts ?? [])) m.set(v.adId, v); return m; });
              setPrecise(true);
            }
          } catch { /* ignore partial */ }
        }
      }
    } catch (e) {
      setScanError(String(e));
    } finally {
      setScanning(false);
      setProgress(null);
    }
  };

  const Toggle = ({ k, label }: { k: Only; label: string }) => (
    <button
      type="button"
      onClick={() => setOnly(prev => (prev === k ? "all" : k))}
      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${only === k ? "border-accent text-accent bg-accent-soft" : "border-line text-fg-dim hover:text-fg"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">
          Ad Table
          <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">influencer · language · live ✦</span>
        </h3>
        <p className="text-xs text-fg-mute mt-0.5 leading-relaxed">
          Every ad classified — influencer/creator? · language (regional?) · live? You get a fast
          <span className="font-medium text-fg-dim"> estimate</span> up front (thumbnails + copy); run a
          <span className="font-medium text-fg-dim"> precise scan</span> below (video + audio) for exact numbers.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
        <ModelSelect
          label="Brand"
          options={brands.map(b => ({ id: b.brand, label: b.brand === "You" ? "You (your ads)" : b.brand }))}
          value={active.brand}
          onChange={v => { setSelected(v); setOnly("all"); setDeep(new Map()); setPrecise(false); setScanError(null); setReels(new Map()); setReelErr(new Map()); setExpanded(null); }}
        />
        <div className="flex flex-wrap items-center gap-2 pb-1">
          <span className="text-[11px] font-semibold text-fg-dim uppercase tracking-wider mr-1">Show</span>
          <Toggle k="influencer" label={`Influencer · ${nInfluencer}`} />
          <Toggle k="regional" label={`Regional · ${nRegional}`} />
          <Toggle k="live" label={`Live · ${nLive}`} />
        </div>
      </div>

      {/* Phase 2 — precise deep scan (video + audio) over a time range */}
      <div className="rounded-lg border border-line bg-surface p-3 space-y-2.5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-fg">
              {precise ? "Precise counts" : "Estimate"} · {nInfluencer} influencer · {nRegional} regional
            </p>
            <p className="text-[11px] text-fg-mute mt-0.5 max-w-xl leading-relaxed">
              {precise
                ? `Exact for ${preciseCount} video ad(s) analysed with audio — the rest stay estimates.`
                : "Fast estimate from thumbnails + copy. Run a precise scan (first 5s + audio of each video) for exact influencer & spoken-language counts."}
            </p>
          </div>
          {scanning && progress && (
            <span className="text-[11px] font-mono text-accent whitespace-nowrap">Scanning {progress.done}/{progress.total} videos…</span>
          )}
        </div>
        {!scanning && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-fg-mute uppercase tracking-wide mr-1">Precise scan</span>
            {(["1m", "6m", "all"] as RangeKey[]).map(k => (
              <button
                key={k}
                type="button"
                onClick={() => runDeepScan(k)}
                disabled={vidCount(k) === 0}
                className="text-[11px] px-2.5 py-1 rounded-full border border-line text-fg-dim hover:border-accent hover:text-accent transition-colors disabled:opacity-40 disabled:hover:border-line disabled:hover:text-fg-dim"
              >
                {k === "1m" ? "Last 1 month" : k === "6m" ? "Last 6 months" : "All"} · {vidCount(k)} videos
              </button>
            ))}
          </div>
        )}
        {scanError && <p className="text-alert text-[11px]">{scanError}</p>}
      </div>

      <p className="font-mono text-[11px] uppercase tracking-wide text-fg-mute">
        {shown.length} of {rows.length} ads · {nInfluencer} influencer · {nRegional} regional-language · {nLive} live
        {precise && preciseCount > 0 && <span className="text-accent-2"> · {preciseCount} precise</span>}
      </p>

      <div className="overflow-x-auto border border-line rounded-lg">
        <table className="w-full text-sm" style={{ minWidth: 640, borderCollapse: "collapse" }}>
          <thead>
            <tr className="bg-surface-2 text-fg-dim">
              {["Ad", "Format", "Influencer", "Language", "Live", "AI", ""].map(h => (
                <th key={h} className="text-left font-medium text-[11px] uppercase tracking-wider px-3 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const img = proxyImageUrl(r.ad.imageUrl ?? r.ad.thumbnailUrl);
              const url = adLibraryUrl(r.ad);
              const adId = r.ad.adId;
              const reel = reels.get(adId);
              const isAnalyzing = analyzingId === adId;
              const err = reelErr.get(adId);
              const isOpen = expanded === adId;
              return (
                <Fragment key={adId || i}>
                <tr className="border-t border-line align-top">
                  <td className="px-3 py-2">
                    <div className="flex items-start gap-2.5">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="" className="w-10 h-10 rounded object-cover flex-none bg-surface-2" loading="lazy" />
                      ) : <div className="w-10 h-10 rounded bg-surface-2 flex-none" />}
                      <div className="min-w-0">
                        <p className="text-fg font-medium truncate max-w-[220px]">{r.ad.title || r.ad.pageName || "Paid ad"}</p>
                        <p className="text-fg-mute text-xs truncate max-w-[220px]">{r.ad.body || "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-fg-dim capitalize">{r.format === "video" ? "Video" : r.format === "image" ? "Static" : r.format}</td>
                  <td className="px-3 py-2">
                    {r.influencer
                      ? <span
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-2 bg-accent-2-soft px-2 py-0.5 rounded-full"
                          title={`${r.influencerReason} · ${Math.round(r.influencerConf * 100)}% confidence`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.influencerConf >= 0.85 ? "currentColor" : "transparent", border: "1px solid currentColor" }} />
                          Influencer
                        </span>
                      : <span className="text-fg-mute text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={r.regional ? "text-[11px] font-medium text-accent bg-accent-soft px-2 py-0.5 rounded-full" : "text-fg-dim text-xs"}>
                      {r.language}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${r.live ? "bg-accent-2 text-white" : "bg-fg-mute text-white"}`}>
                      {r.live ? "Live" : "Ended"}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {reel ? (
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : adId)}
                        className="text-[11px] font-medium text-accent-2 hover:underline"
                      >
                        {isOpen ? "Hide" : "View"} analysis
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => analyzeAd(r.ad)}
                        disabled={!!analyzingId}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full border border-accent-2/40 bg-accent-2-soft text-accent-2 px-2 py-0.5 hover:bg-accent-2/15 disabled:opacity-50 transition-colors"
                        title="Deep-analyze this ad: influencer / UGC · actor · what it depicts"
                      >
                        {isAnalyzing ? (
                          <>
                            <span className="w-2.5 h-2.5 border-[1.5px] border-accent-2/40 border-t-accent-2 rounded-full animate-spin" />
                            Analyzing…
                          </>
                        ) : "Analyze"}
                      </button>
                    )}
                    {err && (
                      <p className="text-alert text-[10px] mt-1">
                        {err} <button type="button" onClick={() => analyzeAd(r.ad)} className="underline">Retry</button>
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {url && (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-accent-2 hover:underline">
                        Ad Library →
                      </a>
                    )}
                  </td>
                </tr>
                {reel && isOpen && (
                  <tr className="border-t border-line bg-surface-2/40">
                    <td colSpan={7} className="px-3 py-2">
                      <div className="max-w-xl">
                        <ReelAnalysisCard reel={reel} onRerun={() => analyzeAd(r.ad)} rerunning={isAnalyzing} />
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {!shown.length && (
        <p className="text-sm text-fg-mute py-6 px-3 border border-dashed border-line rounded-lg">
          No ads match this filter for {active.brand === "You" ? "you" : active.brand}.
        </p>
      )}
    </div>
  );
}
