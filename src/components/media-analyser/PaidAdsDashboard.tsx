
import { useEffect, useMemo, useState } from "react";
import type { AnalysisResponse, SocialPaidAd } from "@/lib/media-analyser/types";
import type { AdReelAnalysis } from "@/lib/media-analyser/ad-reel-analysis";
import { ReelAnalysisCard } from "@/components/media-analyser/ReelAnalysisCard";
import type { PaidAdBucketGroup, PaidAdsSummary } from "@/lib/media-analyser/paid-ad-buckets";
import {
  buildPaidAdBuckets,
  enrichPaidAd,
  PLATFORM_LABELS,
  DURATION_LABELS,
  formatPlatformIcons,
} from "@/lib/media-analyser/paid-ad-buckets";
import type { DurationBucket, PlatformBucket, StatusBucket } from "@/lib/media-analyser/paid-ad-buckets";
import {
  computePaidAdDashboardStats,
  countActiveFilters,
  DEFAULT_PAID_AD_FILTERS,
  filterPaidAds,
  isAdVideo,
  adLanguageLabel,
  influencerHandleOf,
  parseBrandBookMarkdown,
  sortTimelineItems,
  type PaidAdFilters,
  type PlatformOn,
  type FormatFilter,
  type TimelineSort,
} from "@/lib/media-analyser/paid-ad-stats";
import { adDestination } from "@/lib/media-analyser/paid-ad-intel";

const PLATFORM_ORDER: PlatformBucket[] = ["multi_platform", "facebook_only", "instagram_only", "other"];
const DURATION_ORDER: DurationBucket[] = ["new", "recent", "established", "long_running", "unknown"];

const PLATFORM_BAR_COLORS: Record<PlatformBucket, string> = {
  multi_platform: "bg-accent-2",
  facebook_only: "bg-accent",
  instagram_only: "bg-accent",
  other: "bg-fg-mute",
};

const DURATION_BAR_COLORS: Record<DurationBucket, string> = {
  new: "bg-accent",
  recent: "bg-accent",
  established: "bg-accent",
  long_running: "bg-accent",
  unknown: "bg-line",
};

function proxyImageUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  if (/cdninstagram\.com|fbcdn\.net|instagram\.com/.test(rawUrl)) {
    return `/api/media-analyser/image-proxy?url=${encodeURIComponent(rawUrl)}`;
  }
  return rawUrl;
}

function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-mute">{label}</p>
      <p className="text-xl font-bold text-fg mt-1">{value}</p>
      {sub && <p className="text-[11px] text-fg-dim mt-1 line-clamp-2">{sub}</p>}
    </div>
  );
}

function DistributionBar<T extends string>({
  title,
  segments,
  colors,
  labels,
  onSelect,
  activeKey,
}: {
  title: string;
  segments: Array<{ key: T; count: number }>;
  colors: Record<T, string>;
  labels: Record<T, string>;
  onSelect: (key: T) => void;
  activeKey: T | "all";
}) {
  const total = segments.reduce((n, s) => n + s.count, 0);
  const visible = segments.filter(s => s.count > 0);
  if (!total) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-fg-dim">{title}</p>
        <p className="text-[10px] text-fg-mute">{total} ads</p>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
        {visible.map(seg => (
          <button
            key={seg.key}
            type="button"
            title={`${labels[seg.key]}: ${seg.count}`}
            onClick={() => onSelect(seg.key)}
            className={`${colors[seg.key]} transition-opacity hover:opacity-90 ${activeKey === seg.key ? "ring-2 ring-accent ring-offset-1" : ""}`}
            style={{ width: `${(seg.count / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {visible.map(seg => (
          <button
            key={seg.key}
            type="button"
            onClick={() => onSelect(seg.key)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              activeKey === seg.key
                ? "border-accent bg-accent text-bg"
                : "border-line bg-surface text-fg-dim hover:border-line"
            }`}
          >
            <span className={`inline-block w-2 h-2 rounded-full mr-1 ${colors[seg.key]}`} />
            {labels[seg.key]} ({seg.count})
          </button>
        ))}
      </div>
    </div>
  );
}

function PaidAdRunningTimeline({
  items,
  rangeStartMs,
  rangeEndMs,
  sort,
  onSortChange,
}: {
  items: ReturnType<typeof computePaidAdDashboardStats>["timeline"];
  rangeStartMs: number;
  rangeEndMs: number;
  sort: TimelineSort;
  onSortChange: (s: TimelineSort) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = sortTimelineItems(items, sort);
  const shown = expanded ? sorted : sorted.slice(0, 15);
  const span = Math.max(rangeEndMs - rangeStartMs, 1);

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">Where ads are running</h3>
          <p className="text-[11px] text-fg-dim mt-0.5">
            {formatShortDate(rangeStartMs)} → {formatShortDate(rangeEndMs)} · bar length = run duration
          </p>
        </div>
        <div className="flex gap-1">
          {(["longest", "newest", "platform"] as TimelineSort[]).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => onSortChange(s)}
              className={`text-[10px] px-2 py-1 rounded-md font-medium capitalize ${
                sort === s ? "bg-accent text-bg" : "bg-surface-2 text-fg-dim hover:bg-surface-2"
              }`}
            >
              {s === "longest" ? "Longest" : s === "newest" ? "Newest" : "Platform"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
        {shown.map(item => {
          const leftPct = item.startMs != null
            ? ((item.startMs - rangeStartMs) / span) * 100
            : 0;
          const widthPct = item.startMs != null
            ? Math.max(((item.endMs - item.startMs) / span) * 100, 2)
            : 8;

          return (
            <div key={item.adId} className="group grid grid-cols-[minmax(0,140px)_1fr] gap-3 items-center">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-fg truncate" title={item.label}>{item.label}</p>
                <p className="text-[10px] text-fg-mute">
                  {item.runningDays != null ? `${item.runningDays}d` : "Unknown"}
                  {item.isActive ? " · Active" : " · Ended"}
                </p>
              </div>
              <div className="relative h-6 bg-surface-2 rounded-md overflow-hidden">
                {item.startMs == null ? (
                  <div className="absolute inset-y-1 left-1 right-[60%] rounded border-2 border-dashed border-line bg-surface-2" title="Start date unknown" />
                ) : (
                  <div
                    className={`absolute inset-y-1 rounded ${item.isActive ? "bg-accent-2" : "bg-fg-mute"} opacity-90 group-hover:opacity-100`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    title={`${item.label} · ${PLATFORM_LABELS[item.platformBucket]} · ${item.runningDays ?? "?"} days`}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {sorted.length > 15 && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="text-xs font-medium text-accent hover:underline"
        >
          {expanded ? "Show fewer" : `Show all ${sorted.length} ads`}
        </button>
      )}
    </div>
  );
}

function PaidAdCard({ ad, maxRunningDays, platform = "meta" }: { ad: SocialPaidAd; maxRunningDays: number; platform?: "meta" | "google" }) {
  const isVideo = isAdVideo(ad);
  const primary = proxyImageUrl(ad.imageUrl ?? ad.thumbnailUrl);
  const fallback = proxyImageUrl(ad.thumbnailUrl);
  const platforms = formatPlatformIcons(ad.publisherPlatforms);
  // Google ads link at their Transparency Center preview URL; Meta ads at the Ad Library.
  // (Meta: build the canonical URL from the archive id; fall back to a genuine ads/library snapshot.)
  const link = platform === "google"
    ? (ad.adSnapshotUrl || ad.linkUrl || null)
    : (ad.adId
      ? `https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.adId)}`
      : (ad.adSnapshotUrl && /\/ads\/library/i.test(ad.adSnapshotUrl) ? ad.adSnapshotUrl : null));
  const dest = adDestination(ad); // where the ad's click leads (platform/domain)
  const runPct = ad.runningDays != null ? Math.min(100, (ad.runningDays / maxRunningDays) * 100) : null;
  // Click-to-play: don't mount a <video> (which preloads metadata from fbcdn) until
  // the user actually clicks play. Mounting many videos at once makes the grid lag.
  const [playVideo, setPlayVideo] = useState(false);

  // On-demand per-ad reel analysis (the "Analyze" button).
  const [reel, setReel] = useState<AdReelAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [reelError, setReelError] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const analyzeReel = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setReelError(null);
    try {
      const res = await fetch("/api/media-analyser/analyze-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad }),
      });
      const data = (await res.json().catch(() => ({}))) as { analysis?: AdReelAnalysis; error?: string };
      if (!res.ok || !data.analysis) throw new Error(data.error ?? "Analysis failed");
      setReel(data.analysis);
    } catch (e) {
      setReelError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <article className="flex flex-col rounded-xl border border-line bg-surface shadow-sm overflow-hidden">
      <div className="relative h-44 bg-surface-2">
        {isVideo && ad.videoUrl && playVideo ? (
          <video
            src={ad.videoUrl}
            className="w-full h-full object-cover bg-black"
            controls
            autoPlay
            preload="metadata"
            poster={primary ?? undefined}
          />
        ) : isVideo && ad.videoUrl ? (
          <button
            type="button"
            onClick={() => setPlayVideo(true)}
            className="group relative w-full h-full bg-black"
            aria-label="Play video ad"
          >
            {primary ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={primary} alt="" className="w-full h-full object-cover opacity-90" loading="lazy" />
            ) : null}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex items-center justify-center w-12 h-12 rounded-full bg-black/55 group-hover:bg-black/70 transition-colors">
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white ml-0.5"><path d="M8 5v14l11-7z" /></svg>
              </span>
            </span>
          </button>
        ) : primary ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={primary}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              if (fallback && img.src !== fallback) img.src = fallback;
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-fg-mute">
            {isVideo ? "Video ad" : "No preview"}
          </div>
        )}
        <span
          className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${
            ad.isActive ? "bg-accent-2 text-white" : "bg-fg-mute text-white"
          }`}
        >
          {ad.isActive ? "Active" : "Inactive"}
        </span>
        <div className="absolute top-2 right-2 flex gap-1">
          {platforms.map(p => (
            <span
              key={p.key}
              className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/60 text-white"
              title={p.label}
            >
              {p.short}
            </span>
          ))}
        </div>
      </div>

      <div className="p-3 space-y-2 flex-1 flex flex-col">
        <p className="font-semibold text-sm text-fg line-clamp-2">
          {ad.title || ad.adName || "Paid ad"}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {ad.cta && (
            <span className="text-[10px] font-medium bg-accent-soft text-accent px-2 py-0.5 rounded-full">
              {ad.cta}
            </span>
          )}
          <span className="text-[10px] font-medium bg-surface-2 text-fg-dim px-2 py-0.5 rounded-full">
            {isVideo ? "Video" : "Still"}
          </span>
          {dest && (
            <span className="text-[10px] font-medium bg-accent-2-soft text-accent-2 px-2 py-0.5 rounded-full" title="Where this ad leads">
              → {dest}
            </span>
          )}
          {influencerHandleOf(ad) && (
            <a
              href={/^[a-z0-9._]{1,30}$/i.test(influencerHandleOf(ad)) ? `https://www.instagram.com/${influencerHandleOf(ad)}/` : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-semibold bg-purple-500/15 text-purple-600 px-2 py-0.5 rounded-full hover:underline"
              title="Creator / collaboration ad"
            >
              👤 @{influencerHandleOf(ad)}
            </a>
          )}
        </div>
        <p className="text-xs text-fg-dim line-clamp-2">{ad.body || "—"}</p>

        {/* Per-ad Gemini campaign analysis (copy + metadata) */}
        {ad.adCampaignAnalysis && (ad.adCampaignAnalysis.summary || ad.adCampaignAnalysis.angle) && (
          <div className="rounded-lg bg-accent-soft/60 border border-accent/30 p-2.5 space-y-1.5 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wide text-accent">Gemini · Campaign analysis</span>
              {ad.adCampaignAnalysis.funnelStage && (
                <span className="text-[9px] font-semibold uppercase tracking-wide bg-accent text-white px-1.5 py-0.5 rounded">
                  {ad.adCampaignAnalysis.funnelStage}
                </span>
              )}
            </div>
            {ad.adCampaignAnalysis.summary && (
              <p className="text-[11px] leading-snug text-fg">{ad.adCampaignAnalysis.summary}</p>
            )}
            <dl className="space-y-1">
              {ad.adCampaignAnalysis.angle && (
                <div className="flex gap-1.5">
                  <dt className="text-[9px] font-semibold uppercase tracking-wide text-accent shrink-0 w-14 pt-px">Angle</dt>
                  <dd className="text-[10px] leading-snug text-fg-dim">{ad.adCampaignAnalysis.angle}</dd>
                </div>
              )}
              {ad.adCampaignAnalysis.audience && (
                <div className="flex gap-1.5">
                  <dt className="text-[9px] font-semibold uppercase tracking-wide text-accent shrink-0 w-14 pt-px">Audience</dt>
                  <dd className="text-[10px] leading-snug text-fg-dim">{ad.adCampaignAnalysis.audience}</dd>
                </div>
              )}
              {ad.adCampaignAnalysis.messaging && (
                <div className="flex gap-1.5">
                  <dt className="text-[9px] font-semibold uppercase tracking-wide text-accent shrink-0 w-14 pt-px">Messaging</dt>
                  <dd className="text-[10px] leading-snug text-fg-dim">{ad.adCampaignAnalysis.messaging}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        <div className="space-y-1 pt-1 border-t border-line">
          {runPct != null ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full" style={{ width: `${runPct}%` }} />
              </div>
              <span className="text-[10px] font-semibold text-accent whitespace-nowrap">
                {ad.runningDays}d
              </span>
            </div>
          ) : null}
          <p className="text-[10px] text-fg-dim">
            {ad.startTime ? `Started ${ad.startTime.slice(0, 10)}` : "Start unknown"}
            {ad.isActive ? " · Running now" : ad.stopTime ? ` · Ended ${ad.stopTime.slice(0, 10)}` : ""}
          </p>
          {(ad.audienceSizeMin != null || ad.audienceSizeMax != null) && (
            <p className="text-[10px] text-fg-dim">
              Audience {ad.audienceSizeMin?.toLocaleString() ?? "?"}–{ad.audienceSizeMax?.toLocaleString() ?? "?"}
            </p>
          )}
        </div>

        {/* Per-ad Gemini creative analysis */}
        {ad.adCreativeAnalysis && (
          <div className="border-t border-line pt-2 space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wide text-accent-2">
                Gemini · {isVideo ? "What's in this video" : "What's in this creative"}
              </span>
            </div>
            {ad.adCreativeAnalysis.description && (
              <p className="text-[11px] leading-snug text-fg">{ad.adCreativeAnalysis.description}</p>
            )}
            <div className="flex flex-wrap gap-1">
              {ad.adCreativeAnalysis.visualStyle && (
                <span className="text-[9px] font-semibold uppercase tracking-wide bg-surface-2 text-fg-dim px-1.5 py-0.5 rounded">
                  {ad.adCreativeAnalysis.visualStyle.replace(/_/g, " ")}
                </span>
              )}
              {ad.adCreativeAnalysis.contentType && (
                <span className="text-[9px] font-semibold uppercase tracking-wide bg-accent-2-soft text-accent-2 px-1.5 py-0.5 rounded">
                  {ad.adCreativeAnalysis.contentType.replace(/_/g, " ")}
                </span>
              )}
              {ad.adCreativeAnalysis.mood && (
                <span className="text-[9px] font-semibold uppercase tracking-wide bg-accent-soft text-accent px-1.5 py-0.5 rounded">
                  {ad.adCreativeAnalysis.mood}
                </span>
              )}
              {ad.adCreativeAnalysis.hasTextOverlay && (
                <span className="text-[9px] font-semibold uppercase tracking-wide bg-accent-soft text-accent px-1.5 py-0.5 rounded">
                  Text overlay
                </span>
              )}
            </div>
            {ad.adCreativeAnalysis.dominantColors?.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-fg-mute uppercase tracking-wide">Palette</span>
                <div className="flex gap-1">
                  {ad.adCreativeAnalysis.dominantColors.slice(0, 4).map((c, i) => (
                    <span
                      key={i}
                      title={c}
                      className="w-3.5 h-3.5 rounded-sm border border-black/10 flex-shrink-0"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* On-demand reel analysis */}
        <div className="border-t border-line pt-2 mt-1">
          {!reel && (
            <button
              type="button"
              onClick={analyzeReel}
              disabled={analyzing}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold rounded-lg border border-accent-2/40 bg-accent-2-soft text-accent-2 px-2 py-1.5 hover:bg-accent-2/15 disabled:opacity-60 transition-colors"
            >
              {analyzing ? (
                <>
                  <span className="w-3 h-3 border-[1.5px] border-accent-2/40 border-t-accent-2 rounded-full animate-spin" />
                  {isVideo ? "Watching the reel…" : "Analyzing the creative…"}
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5zm0 12.5a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z"/></svg>
                  Analyze this reel
                </>
              )}
            </button>
          )}
          {reelError && (
            <p className="text-[10px] text-red-500 mt-1.5">
              {reelError}{" "}
              <button type="button" onClick={analyzeReel} className="underline font-medium">Retry</button>
            </p>
          )}
          {reel && <ReelAnalysisCard reel={reel} onRerun={analyzeReel} rerunning={analyzing} onClone={() => setCloneOpen(true)} />}
        </div>

        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-medium text-accent-2 hover:underline mt-1"
          >
            {platform === "google" ? "View on Google →" : "View in Ad Library →"}
          </a>
        )}
      </div>
    </article>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2.5 py-1 rounded-full font-medium border transition-colors ${
        active
          ? "border-accent bg-accent text-bg"
          : "border-line bg-surface text-fg-dim hover:border-line"
      }`}
    >
      {label}
    </button>
  );
}

// ── Creative Intelligence Section ────────────────────────────────────────────
// Aggregates the per-ad Gemini visual analysis (adCreativeAnalysis) across all ads
// and renders breakdown charts for visual style, content type, mood and palette.

const STYLE_COLORS: Record<string, string> = {
  minimalist: "bg-fg-mute",
  bold: "bg-accent",
  editorial: "bg-accent",
  lifestyle: "bg-accent",
  product_only: "bg-accent-2",
  text_heavy: "bg-accent",
  ugc: "bg-accent-2",
};
const TYPE_COLORS: Record<string, string> = {
  product_shot: "bg-accent-2",
  lifestyle: "bg-accent",
  text_overlay: "bg-accent",
  behind_scenes: "bg-accent-2",
  ugc: "bg-accent-2",
  announcement: "bg-accent",
  educational: "bg-accent",
};
const MOOD_COLORS: Record<string, string> = {
  energetic: "bg-accent",
  calm: "bg-accent-2",
  luxurious: "bg-accent",
  playful: "bg-accent",
  professional: "bg-surface-2",
  warm: "bg-orange-400",
};

function MiniBarChart({
  title,
  data,
  colorMap,
}: {
  title: string;
  data: Array<{ key: string; count: number; pct: number }>;
  colorMap: Record<string, string>;
}) {
  if (!data.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-mute">{title}</p>
      {data.slice(0, 5).map(({ key, count, pct }) => (
        <div key={key} className="flex items-center gap-2">
          <span className="w-24 text-[11px] text-fg-dim truncate capitalize">{key.replace(/_/g, " ")}</span>
          <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${colorMap[key] ?? "bg-fg-mute"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[10px] text-fg-dim w-8 text-right">{count}</span>
        </div>
      ))}
    </div>
  );
}

function CreativeIntelligence({ ads }: { ads: SocialPaidAd[] }) {
  const analysed = ads.filter(a => a.adCreativeAnalysis);
  if (analysed.length < 2) return null;

  const countMap = <T extends string>(arr: (T | null | undefined)[]) => {
    const m = new Map<T, number>();
    for (const v of arr) {
      if (!v) continue;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    const total = [...m.values()].reduce((s, n) => s + n, 0) || 1;
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count, pct: Math.round((count / total) * 100) }));
  };

  const styles  = countMap(analysed.map(a => a.adCreativeAnalysis?.visualStyle));
  const types   = countMap(analysed.map(a => a.adCreativeAnalysis?.contentType));
  const moods   = countMap(analysed.map(a => a.adCreativeAnalysis?.mood));

  // Top colors across all ads
  const colorFreq = new Map<string, number>();
  for (const a of analysed) {
    for (const c of a.adCreativeAnalysis?.dominantColors ?? []) {
      if (/^#[0-9A-Fa-f]{6}$/.test(c)) colorFreq.set(c.toUpperCase(), (colorFreq.get(c.toUpperCase()) ?? 0) + 1);
    }
  }
  const topColors = [...colorFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  // Has text overlay rate
  const textOverlayCount = analysed.filter(a => a.adCreativeAnalysis?.hasTextOverlay).length;
  const textOverlayPct = Math.round((textOverlayCount / analysed.length) * 100);

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-sm p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-fg">Creative Intelligence</h3>
          <p className="text-[11px] text-fg-dim mt-0.5">
            Gemini visual analysis across {analysed.length} ad creative{analysed.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-fg-dim">
          <span className="flex items-center gap-1">
            <span className="font-semibold text-fg">{textOverlayPct}%</span> have text overlay
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-1">
        <MiniBarChart title="Visual style" data={styles} colorMap={STYLE_COLORS} />
        <MiniBarChart title="Content type" data={types} colorMap={TYPE_COLORS} />
        <MiniBarChart title="Mood" data={moods} colorMap={MOOD_COLORS} />
      </div>

      {topColors.length > 0 && (
        <div className="border-t border-line pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-mute mb-3">
            Dominant color palette across ads
          </p>
          <div className="flex flex-wrap gap-2">
            {topColors.map(([hex, count]) => (
              <div key={hex} className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2 py-1">
                <span
                  className="w-4 h-4 rounded-sm flex-shrink-0 border border-black/10"
                  style={{ backgroundColor: hex }}
                />
                <span className="text-[10px] font-mono text-fg-dim">{hex}</span>
                <span className="text-[10px] text-fg-mute">×{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BrandBookPanel({ markdown }: { markdown: string }) {
  const sections = parseBrandBookMarkdown(markdown);
  if (!sections.length) return null;

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent-soft/30 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-fg">Brand book insights</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sections.map(sec => (
          <div key={sec.title} className="rounded-xl border border-white bg-surface p-3 shadow-sm">
            <p className="text-xs font-semibold text-accent mb-1">{sec.title}</p>
            {sec.body && <p className="text-xs text-fg leading-relaxed">{sec.body}</p>}
            {sec.items && sec.items.length > 0 && (
              <ul className="mt-2 space-y-1">
                {sec.items.map((item, i) => (
                  <li key={i} className="text-[11px] text-fg-dim flex gap-1.5">
                    <span className="text-accent">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface PaidAdsDashboardProps {
  ads: SocialPaidAd[];
  buckets?: PaidAdBucketGroup[];
  summary?: PaidAdsSummary | null;
  analysis?: string | null;
  result?: AnalysisResponse;
  showGenerators?: boolean;
  compact?: boolean;
  /** Ad source — drives the card's "View" link + label. Defaults to "meta". */
  platform?: "meta" | "google";
}

export function PaidAdsDashboard({
  ads,
  buckets: _legacyBuckets,
  summary,
  analysis,
  result,
  showGenerators = false,
  compact = false,
  platform = "meta",
}: PaidAdsDashboardProps) {
  const isGoogle = platform === "google";
  const enriched = useMemo(
    () =>
      ads.map(a => {
        const base = a.durationBucket != null ? a : enrichPaidAd(a);
        return { ...base, adId: String(base.adId ?? "") };
      }),
    [ads],
  );

  const builtBuckets = useMemo(() => buildPaidAdBuckets(enriched), [enriched]);
  // Groups are always rebuilt from `ads`; `_legacyBuckets` is ignored (may omit nested ads).
  void _legacyBuckets;

  const bucketSummary = useMemo(() => {
    const built = builtBuckets.summary;
    if (!summary?.byPlatform || !summary?.byDuration) return built;
    return {
      active: summary.active ?? built.active,
      inactive: summary.inactive ?? built.inactive,
      byPlatform: { ...built.byPlatform, ...summary.byPlatform },
      byDuration: { ...built.byDuration, ...summary.byDuration },
    };
  }, [builtBuckets.summary, summary]);

  const stats = useMemo(() => computePaidAdDashboardStats(enriched), [enriched]);

  const [filters, setFilters] = useState<PaidAdFilters>(DEFAULT_PAID_AD_FILTERS);
  const [timelineSort, setTimelineSort] = useState<TimelineSort>("longest");
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(() => new Set());

  const filteredAds = useMemo(() => filterPaidAds(enriched, filters), [enriched, filters]);
  // Languages present in this ad set (for the Language filter dropdown).
  const languageOptions = useMemo(
    () => [...new Set(enriched.map(adLanguageLabel))].sort((a, b) => a.localeCompare(b)),
    [enriched],
  );
  const filteredBuckets = useMemo(
    () => buildPaidAdBuckets(filteredAds).groups,
    [filteredAds],
  );

  useEffect(() => {
    setExpandedBuckets(prev => {
      const next = new Set(prev);
      for (const g of filteredBuckets) {
        if (g.status === "active") next.add(g.key);
      }
      if (next.size === 0 && filteredBuckets.length > 0) {
        next.add(filteredBuckets[0].key);
      }
      return next;
    });
  }, [filteredBuckets]);

  const toggleBucket = (key: string) => {
    setExpandedBuckets(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleFilter = <K extends keyof PaidAdFilters>(key: K, value: PaidAdFilters[K]) => {
    setFilters(prev => ({
      ...prev,
      [key]: prev[key] === value ? "all" : value,
    }));
  };

  if (!ads.length) return null;

  return (
    <div className="space-y-8">
      {!compact && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            <StatTile label="Total ads" value={String(stats.kpis.total)} sub={`${stats.kpis.active} active · ${stats.kpis.inactive} inactive`} />
            {/* Avg run (active) — hidden for Google (active is inferred from lastShown recency). */}
            {!isGoogle && (
              <StatTile
                label="Avg run (active)"
                value={stats.kpis.avgRunningDays != null ? `${stats.kpis.avgRunningDays}d` : "—"}
                sub="Mean duration of live campaigns"
              />
            )}
            <StatTile
              label="Still / Video"
              value={`${stats.kpis.stillCount} / ${stats.kpis.videoCount}`}
              sub="Creative format split"
            />
            <StatTile
              label="Longest running"
              value={stats.kpis.longestRunning ? `${stats.kpis.longestRunning.days}d` : "—"}
              sub={stats.kpis.longestRunning?.label}
            />
            {/* Newest ad — hidden for Google. */}
            {!isGoogle && (
              <StatTile
                label="Newest ad"
                value={stats.kpis.newestAd ? stats.kpis.newestAd.startTime.slice(0, 10) : "—"}
                sub={stats.kpis.newestAd?.label}
              />
            )}
          </div>

          {/* Distributions — hidden for Google (Platform is Meta-only; Duration per request). */}
          {!isGoogle && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DistributionBar
              title="Platform distribution"
              segments={PLATFORM_ORDER.map(key => ({ key, count: bucketSummary.byPlatform[key] }))}
              colors={PLATFORM_BAR_COLORS}
              labels={PLATFORM_LABELS}
              activeKey={filters.platform}
              onSelect={key => toggleFilter("platform", key)}
            />
            <DistributionBar
              title="Duration distribution"
              segments={DURATION_ORDER.map(key => ({ key, count: bucketSummary.byDuration[key] }))}
              colors={DURATION_BAR_COLORS}
              labels={DURATION_LABELS}
              activeKey={filters.duration}
              onSelect={key => toggleFilter("duration", key)}
            />
          </div>
          )}

          {/* Creative Intelligence (Gemini visual analysis) — hidden for Google per request. */}
          {!isGoogle && <CreativeIntelligence ads={enriched} />}

          <PaidAdRunningTimeline
            items={stats.timeline}
            rangeStartMs={stats.rangeStartMs}
            rangeEndMs={stats.rangeEndMs}
            sort={timelineSort}
            onSortChange={setTimelineSort}
          />
        </>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-fg-dim uppercase tracking-wider mr-1">Filters</span>
          {/* Active status */}
          <FilterChip label="Active" active={filters.status === "active"} onClick={() => toggleFilter("status", "active")} />
          <FilterChip label="Inactive" active={filters.status === "inactive"} onClick={() => toggleFilter("status", "inactive")} />
          <span className="text-fg-mute">|</span>
          {/* Media type — Google exposes Image/Text/Video; Meta uses Image/Video/Carousel. */}
          {((isGoogle ? ["image", "text", "video"] : ["image", "video", "carousel"]) as FormatFilter[]).map(f => (
            <FilterChip key={f} label={f[0].toUpperCase() + f.slice(1)} active={filters.format === f} onClick={() => toggleFilter("format", f)} />
          ))}
          {/* Meta-only: publisher-platform + influencer filters (both need Meta Ad Library data). */}
          {!isGoogle && <>
            <span className="text-fg-mute">|</span>
            {([["facebook", "FB"], ["instagram", "IG"], ["audience_network", "Aud Net"], ["messenger", "Msgr"]] as [PlatformOn, string][]).map(([k, l]) => (
              <FilterChip key={k} label={l} active={filters.platformOn === k} onClick={() => toggleFilter("platformOn", k)} />
            ))}
            <span className="text-fg-mute">|</span>
            <FilterChip label="Influencer" active={filters.influencer} onClick={() => setFilters(prev => ({ ...prev, influencer: !prev.influencer }))} />
          </>}
          {/* Language */}
          {languageOptions.length > 1 && (
            <select
              value={filters.language}
              onChange={e => setFilters(prev => ({ ...prev, language: e.target.value }))}
              className="text-[11px] rounded-full border border-line bg-surface text-fg-dim px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="all">All languages</option>
              {languageOptions.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          {/* Impressions by date range (on ad start date) */}
          <span className="inline-flex items-center gap-1 text-[11px] text-fg-mute">
            <input type="date" value={filters.dateFrom} onChange={e => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
              className="rounded-full border border-line bg-surface text-fg-dim px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent" title="From date" />
            <span>–</span>
            <input type="date" value={filters.dateTo} onChange={e => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
              className="rounded-full border border-line bg-surface text-fg-dim px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent" title="To date" />
          </span>
          {countActiveFilters(filters) > 0 && (
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_PAID_AD_FILTERS)}
              className="text-[11px] text-fg-dim hover:text-fg underline ml-1"
            >
              Clear all
            </button>
          )}
        </div>
        <p className="text-xs text-fg-dim">
          Showing <span className="font-semibold text-fg">{filteredAds.length}</span> of {ads.length} ads
        </p>
      </div>

      <div className="space-y-3">
        {filteredBuckets.map(group => {
          const open = expandedBuckets.has(group.key);
          return (
            <div key={group.key} className="rounded-xl border border-line bg-surface overflow-hidden shadow-sm">
              <button
                type="button"
                onClick={() => toggleBucket(group.key)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors"
              >
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${group.status === "active" ? "bg-accent-2-soft text-accent-2" : "bg-surface-2 text-fg-dim"}`}>
                    {group.status === "active" ? "Active" : "Inactive"}
                  </span>
                  <span className="text-xs font-semibold text-accent-2">{PLATFORM_LABELS[group.platformBucket as PlatformBucket]}</span>
                  <span className="text-xs text-accent">· {DURATION_LABELS[group.durationBucket as DurationBucket]}</span>
                </div>
                <span className="text-xs text-fg-dim flex-none">{group.count} ads {open ? "▾" : "▸"}</span>
              </button>
              {open && (
                <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 border-t border-line pt-4">
                  {group.ads.map((ad, i) => (
                    <PaidAdCard key={`${group.key}-${ad.adId || i}`} ad={ad} maxRunningDays={stats.maxRunningDays} platform={platform} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!filteredBuckets.length && (
          <p className="text-sm text-fg-mute py-6 text-center border border-dashed border-line rounded-xl">
            No ads match the current filters.
          </p>
        )}
      </div>

      {showGenerators && result && (
        <div className="pt-4 border-t border-line grid grid-cols-1 lg:grid-cols-2 gap-6">
        </div>
      )}

      {analysis && !compact && <BrandBookPanel markdown={analysis} />}
    </div>
  );
}
