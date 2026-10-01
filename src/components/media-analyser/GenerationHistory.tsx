
import { useState } from "react";
import { Images } from "lucide-react";
import type { GenerationBatch } from "@/lib/media-analyser/supabase";

const MODE_LABELS: Record<string, string> = {
  instagram: "Instagram Posts",
  meta_ad: "Meta Ads",
  video: "Video Reels",
  video_meta_ad: "Video Ads",
  vibe_instagram: "Vibe · Instagram",
  vibe_meta_ad: "Vibe · Meta Ads",
  vibe_video: "Vibe · Reels",
  vibe_clone: "Vibe Clone",
  vibe_match: "Vibe Match",
  insta_grid: "Insta Grid",
  ugc_ad: "UGC Ad",
};

const MODE_COLORS: Record<string, string> = {
  instagram: "text-accent bg-accent-soft",
  meta_ad: "text-accent-2 bg-accent-2-soft",
  video: "text-accent bg-accent-soft",
  video_meta_ad: "text-accent bg-accent-soft",
  vibe_instagram: "text-accent bg-accent",
  vibe_meta_ad: "text-accent bg-accent",
  vibe_video: "text-accent bg-accent",
  vibe_clone: "text-accent bg-accent",
  vibe_match: "text-accent bg-accent-soft",
  insta_grid: "text-accent bg-accent-soft",
  ugc_ad: "text-accent bg-accent-soft",
};

interface GeneratedPost {
  index: number;
  concept: string;
  imageUrl: string;
  caption?: string;
  headline?: string;
  primaryText?: string;
  cta?: string;
}

interface GeneratedReel {
  index: number;
  concept: string;
  videoUrl?: string;
  posterUrl?: string;
  durationSeconds?: number;
  caption?: string;
  status?: string;
  // UGC ad scene clips reuse this branch with these extra fields.
  voiceover?: string;
  onScreen?: string;
  sceneIndex?: number;
}

function isVideoMode(mode: string) {
  return mode === "video" || mode === "video_meta_ad" || mode === "vibe_video" || mode === "ugc_ad";
}

// The input (prompt/description + reference thumbnails + model/aspect) that produced a batch.
function InputBlock({ batch }: { batch: GenerationBatch }) {
  const input = batch.input;
  if (!input) return null;
  const text = input.prompt || input.description;
  const thumbs = input.referenceThumbnails ?? [];
  const badges = [input.imageModel, input.videoModel, input.aspect].filter(Boolean) as string[];
  if (!text && !thumbs.length && !badges.length && !input.productUrl) return null;
  return (
    <div className="mb-3 rounded-xl border border-line bg-surface-2/70 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-mute mb-1.5">Input</p>
      {text && <p className="text-[11px] text-fg leading-relaxed">{text}</p>}
      {input.productUrl && (
        <p className="text-[11px] text-fg-mute mt-0.5 truncate">{input.productUrl}</p>
      )}
      {thumbs.length > 0 && (
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {thumbs.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt="" className="w-12 h-12 rounded-md object-cover border border-line bg-surface" />
          ))}
        </div>
      )}
      {badges.length > 0 && (
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {badges.map((b, i) => (
            <span key={i} className="text-[9px] font-medium text-fg-dim bg-surface border border-line px-1.5 py-0.5 rounded-full">{b}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function BatchExpanded({ batch }: { batch: GenerationBatch }) {
  const results = (batch.results ?? []) as unknown[];
  const video = isVideoMode(batch.mode);

  if (!results.length) {
    return (
      <>
        <InputBlock batch={batch} />
        <p className="text-xs text-fg-mute px-1 pb-3">No results stored.</p>
      </>
    );
  }

  if (video) {
    const reels = results as GeneratedReel[];
    const isUgc = batch.mode === "ugc_ad";
    return (
      <div className="space-y-3 pb-3">
        <InputBlock batch={batch} />
        {reels.map((r, i) => (
          <div key={i} className="border border-line rounded-xl overflow-hidden bg-surface">
            {r.videoUrl ? (
              <video
                src={r.videoUrl}
                className="w-full aspect-[9/16] max-h-72 object-cover bg-black"
                controls
                preload="metadata"
                poster={r.posterUrl}
              />
            ) : r.posterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.posterUrl} alt="" className="w-full aspect-[9/16] max-h-72 object-cover" />
            ) : null}
            <div className="p-2.5">
              <p className="text-[11px] font-semibold text-fg">
                {r.concept || r.onScreen || (isUgc ? `Scene ${(r.sceneIndex ?? i) + 1}` : `Reel ${i + 1}`)}
              </p>
              {(r.caption || r.voiceover) && (
                <p className="text-[11px] text-fg-dim mt-0.5 line-clamp-2">{r.caption || r.voiceover}</p>
              )}
              {r.durationSeconds && <p className="text-[10px] text-fg-mute mt-0.5">{r.durationSeconds}s</p>}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const posts = results as GeneratedPost[];
  const isIg = batch.mode === "instagram" || batch.mode === "vibe_instagram";
  return (
    <>
    <InputBlock batch={batch} />
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pb-3">
      {posts.map((p, i) => (
        <div key={i} className="border border-line rounded-xl overflow-hidden bg-surface shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.imageUrl}
            alt={p.concept}
            className={`w-full object-cover ${isIg ? "aspect-[4/5]" : "aspect-square"}`}
            loading="lazy"
          />
          <div className="p-2 space-y-1">
            <p className="text-[10px] font-semibold text-fg line-clamp-1">{p.concept}</p>
            {isIg && p.caption && (
              <p className="text-[10px] text-fg-dim line-clamp-2 leading-relaxed">{p.caption}</p>
            )}
            {!isIg && p.headline && (
              <p className="text-[10px] font-semibold text-fg">{p.headline}</p>
            )}
            {!isIg && p.cta && (
              <span className="inline-block text-[9px] font-semibold text-white bg-accent px-1 py-0.5 rounded">{p.cta}</span>
            )}
          </div>
        </div>
      ))}
    </div>
    </>
  );
}

function BatchRow({ batch }: { batch: GenerationBatch }) {
  const [expanded, setExpanded] = useState(false);
  const label = MODE_LABELS[batch.mode] ?? batch.mode;
  const color = MODE_COLORS[batch.mode] ?? "text-fg-dim bg-surface-2";
  const date = batch.created_at
    ? new Date(batch.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
  const isVibe = batch.mode.startsWith("vibe_");

  return (
    <div className="border-b border-line last:border-0">
      <button
        className="w-full py-4 flex items-center gap-3 text-left hover:bg-surface-2/60 transition-colors rounded-lg px-1"
        onClick={() => setExpanded(v => !v)}
      >
        {/* Thumbnail */}
        <div className="w-12 h-12 rounded-lg overflow-hidden bg-surface-2 border border-line shrink-0">
          {batch.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={batch.thumbnail_url} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-fg-mute text-lg">
              {isVideoMode(batch.mode) ? "🎬" : "🖼"}
            </div>
          )}
        </div>

        {/* Meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${color}`}>{label}</span>
            {isVibe && batch.dna_confidence && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                batch.dna_confidence === "high" ? "text-accent-2 bg-accent-2-soft" :
                batch.dna_confidence === "medium" ? "text-accent bg-accent-soft" :
                "text-alert bg-alert-soft"
              }`}>
                DNA: {batch.dna_confidence}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-fg truncate">
            {[batch.product_name, batch.brand].filter(Boolean).join(" — ") || "Untitled generation"}
          </p>
          <p className="text-xs text-fg-mute">
            {batch.result_count} creative{batch.result_count !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Date + chevron */}
        <div className="flex-shrink-0 flex flex-col items-end gap-1">
          <span className="text-xs text-fg-mute">{date}</span>
          <span className="text-fg-mute text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="pb-1 px-1">
          <BatchExpanded batch={batch} />
        </div>
      )}
    </div>
  );
}

interface Props {
  batches: GenerationBatch[];
}

export function GenerationHistory({ batches }: Props) {
  if (!batches.length) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <span className="grid place-items-center w-11 h-11 rounded-full bg-brand-soft text-brand mb-3">
          <Images size={20} />
        </span>
        <p className="text-sm font-medium text-fg">No creatives yet</p>
        <p className="text-xs text-fg-mute mt-1 max-w-xs">
          Generated posts, ads, and reels will appear here once Supabase is configured.
        </p>
      </div>
    );
  }

  return (
    <div>
      {batches.map(batch => (
        <BatchRow key={batch.id} batch={batch} />
      ))}
    </div>
  );
}
