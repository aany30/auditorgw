
import { useState } from "react";

type ModuleKey = "ecom" | "social" | "reddit" | "paid-ads";
type RunState = "idle" | "running" | "done" | "error";

interface ActiveResult {
  module: ModuleKey;
  data: Record<string, unknown>;
}

// ─── Proxy helper (same as BriefTabs) ────────────────────────────────────────
function proxyImageUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  if (/cdninstagram\.com|fbcdn\.net|instagram\.com/.test(rawUrl)) {
    return `/api/media-analyser/image-proxy?url=${encodeURIComponent(rawUrl)}`;
  }
  return rawUrl;
}

// ─── Shared image card ────────────────────────────────────────────────────────
function PostCard({ imageUrl, thumbnailUrl, videoUrl, title, meta, body, linkUrl, badge, isReel }: {
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  videoUrl?: string | null;
  title: string;
  meta: string;
  body: string;
  linkUrl?: string | null;
  badge?: string;
  isReel?: boolean;
}) {
  const primary = proxyImageUrl(imageUrl);
  const fallback = proxyImageUrl(thumbnailUrl);
  const hasVideo = !!videoUrl;
  return (
    <div className="flex-none w-64 border border-line rounded-xl overflow-hidden bg-surface shadow-sm">
      <div className="relative w-full h-44 bg-surface-2">
        {hasVideo ? (
          <video
            src={videoUrl as string}
            className="w-full h-44 object-cover bg-black"
            controls
            preload="metadata"
            poster={primary ?? undefined}
          />
        ) : primary ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={primary} alt="" className="w-full h-44 object-cover" loading="lazy"
            onError={e => {
              const img = e.target as HTMLImageElement;
              if (fallback && img.src !== fallback) { img.src = fallback; }
              else { img.style.display = "none"; }
            }} />
        ) : (
          <div className="w-full h-44 flex items-center justify-center text-xs text-fg-mute">{isReel ? "🎬 Reel" : "No preview"}</div>
        )}
        {(isReel || hasVideo) && (
          <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full pointer-events-none">🎬 Video</div>
        )}
      </div>
      <div className="p-3">
        {badge && <span className="text-[10px] font-semibold text-accent-2 bg-accent-2-soft px-1.5 py-0.5 rounded-full">{badge}</span>}
        <p className="font-semibold text-xs text-fg mt-1 mb-0.5 line-clamp-2">{title}</p>
        <p className="text-[10px] text-fg-mute mb-1">{meta}</p>
        <p className="text-xs text-fg-dim line-clamp-3">{body}</p>
        {linkUrl && (
          <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block text-[10px] text-accent hover:underline">View →</a>
        )}
      </div>
    </div>
  );
}

// ─── Social result preview ────────────────────────────────────────────────────
function SocialPreview({ data }: { data: Record<string, unknown> }) {
  const social = (data.social ?? {}) as Record<string, unknown>;
  const rawPosts = ([...(social.instagramProductPosts as unknown[] ?? []), ...(social.marketingPosts as unknown[] ?? [])]) as Record<string, unknown>[];
  const paidAds = (social.paidAds as Record<string, unknown>[] | undefined) ?? [];
  const dataSource = String(social.socialDataSource ?? "");
  const resolvedAccount = dataSource.includes(":@") ? dataSource.split(":@")[1] : null;
  const warning = data.warning ? String(data.warning) : null;

  // Deduplicate by postUrl
  const seen = new Set<string>();
  const posts = rawPosts
    .filter(p => {
      const key = String(p.post_id ?? p.postUrl ?? Math.random());
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    // Sort: product-matched first, then most recent
    .sort((a, b) => {
      const aMatch = a.productUrlMatched ? 1 : 0;
      const bMatch = b.productUrlMatched ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      const aDate = a.publishedAt ? new Date(String(a.publishedAt)).getTime() : 0;
      const bDate = b.publishedAt ? new Date(String(b.publishedAt)).getTime() : 0;
      return bDate - aDate;
    });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-fg">Social Intelligence Result</p>
          <p className="text-xs text-fg-mute">
            {posts.length} post(s) · {paidAds.length} paid ad(s)
            {resolvedAccount && <> · <span className="text-accent">@{resolvedAccount}</span></>}
          </p>
        </div>
        {resolvedAccount && (
          <a href={`https://www.instagram.com/${resolvedAccount}/`} target="_blank" rel="noopener noreferrer"
            className="text-xs text-accent bg-accent-soft px-2.5 py-1 rounded-full hover:bg-accent-soft">
            @{resolvedAccount} ↗
          </a>
        )}
      </div>

      {warning && (
        <div className="bg-accent-soft border border-accent/30 rounded-lg px-3 py-2 text-xs text-accent">{warning}</div>
      )}

      {/* Instagram posts */}
      {posts.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-fg uppercase tracking-wider mb-3">Instagram Posts</p>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {posts.slice(0, 20).map((p, i) => {
              const likes = Number(p.likes ?? 0);
              const comments = Number(p.comments ?? 0);
              const er = p.engagementRate != null ? ` · ${p.engagementRate}% ER` : "";
              const fmt = String(p.format ?? p.media_type ?? "");
              const isReel = /reel|video/i.test(fmt);
              return (
                <PostCard key={i}
                  imageUrl={(p.imageUrl ?? p.thumbnailUrl) as string | null}
                  thumbnailUrl={p.thumbnailUrl as string | null}
                  isReel={isReel}
                  title={String(p.marketingAngle ?? p.hook ?? "Post")}
                  meta={`${isReel ? "🎬 Reel · " : ""}${likes.toLocaleString()} likes · ${comments.toLocaleString()} comments${er}`}
                  body={String(p.captionSnippet ?? p.body ?? "—")}
                  linkUrl={(p.postUrl ?? p.url) as string | null}
                  badge={p.productUrlMatched ? "PRODUCT" : undefined}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Paid ads */}
      {paidAds.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-fg uppercase tracking-wider mb-3">Paid Ads · Meta ({paidAds.length})</p>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {paidAds.slice(0, 30).map((ad, i) => (
              <PostCard key={i}
                imageUrl={(ad.imageUrl ?? ad.thumbnailUrl) as string | null}
                title={String(ad.title || ad.adName || "Paid ad")}
                meta={[ad.pageName, ad.cta, ad.status].filter(Boolean).join(" · ")}
                body={String(ad.body || ad.title || "—").slice(0, 280)}
                linkUrl={(ad.linkUrl ?? ad.instagramUrl) as string | null}
                badge={ad.matchReason ? String(ad.matchReason).replace("Match: ", "") : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {posts.length === 0 && paidAds.length === 0 && (
        <p className="text-sm text-fg-mute py-4">No posts or ads found. Check your Apify token and try a brand URL.</p>
      )}
    </div>
  );
}

// ─── Ecom result preview ──────────────────────────────────────────────────────
function EcomPreview({ data }: { data: Record<string, unknown> }) {
  const result = (data.result ?? {}) as Record<string, unknown>;
  const payload = (result.payload ?? {}) as Record<string, unknown>;
  const ecom = (payload.ecom ?? {}) as Record<string, unknown>;
  const products = (ecom.products as Record<string, unknown>[] | undefined) ?? [];
  const target = products[0] ?? {};
  const competitors = (target.competitors as Record<string, unknown>[] | undefined) ?? [];

  return (
    <div className="space-y-5">
      <p className="text-sm font-semibold text-fg">Ecom Scraper Result</p>

      {/* Target product */}
      {!!target.title && (
        <div className="border border-line rounded-xl p-4 bg-surface">
          <p className="text-xs text-fg-mute mb-1">Target product</p>
          <p className="font-semibold text-sm text-fg mb-1">{String(target.title)}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-dim">
            {!!target.brand && <span>Brand: <strong>{String(target.brand)}</strong></span>}
            {!!target.price && <span>Price: <strong>{String(target.price)}</strong></span>}
            {target.rating != null && <span>★ {Number(target.rating).toFixed(1)}</span>}
            {target.reviewCount != null && <span>{Number(target.reviewCount).toLocaleString()} reviews</span>}
            {!!target.asin && <span className="font-mono text-fg-mute">{String(target.asin)}</span>}
          </div>
        </div>
      )}

      {/* Competitors */}
      {competitors.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-fg uppercase tracking-wider mb-3">
            {competitors.length} Competitor(s) scraped
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {competitors.map((c, i) => (
              <div key={i} className="border border-line rounded-xl p-3 bg-surface">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-xs font-semibold text-fg line-clamp-2">{String(c.title ?? "—").slice(0, 60)}</p>
                  <span className="flex-none text-[10px] bg-surface-2 text-fg-dim px-1.5 py-0.5 rounded-full">#{i + 1}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-fg-dim">
                  {!!c.brand && <span>{String(c.brand)}</span>}
                  {!!c.price && <span>{String(c.price)}</span>}
                  {c.rating != null && <span>★ {Number(c.rating).toFixed(1)}</span>}
                  {c.reviewCount != null && <span>{Number(c.reviewCount).toLocaleString()} reviews</span>}
                </div>
                {!!c.deepAnalyzed && (
                  <span className="mt-1.5 inline-block text-[9px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">Deep analyzed</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!target.title && competitors.length === 0 && (
        <p className="text-sm text-fg-mute py-4">No product data returned. Check your RAINFOREST_API_KEY.</p>
      )}
    </div>
  );
}

// ─── Reddit result preview ────────────────────────────────────────────────────
function RedditPreview({ data }: { data: Record<string, unknown> }) {
  const reddit = (data.reddit ?? {}) as Record<string, unknown>;
  const reviews = (reddit.reviews as Record<string, unknown>[] | undefined) ?? [];
  const matched = Number(reddit.matchedCount ?? 0);
  const total = Number(reddit.totalFetchedCount ?? 0);

  const sentimentColor = (s?: string) => {
    if (!s) return "bg-surface-2 text-fg-dim";
    const sl = s.toLowerCase();
    if (sl.includes("positive")) return "bg-accent-2-soft text-accent-2";
    if (sl.includes("negative")) return "bg-alert-soft text-alert";
    return "bg-accent-soft text-accent";
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-fg">Reddit Reviews Result</p>
        <p className="text-xs text-fg-mute">{matched} matched · {total} fetched</p>
      </div>

      {!!data.warning && (
        <div className="bg-accent-soft border border-accent/30 rounded-lg px-3 py-2 text-xs text-accent">{String(data.warning)}</div>
      )}

      {reviews.length > 0 && (
        <div className="space-y-2">
          {reviews.slice(0, 20).map((r, i) => (
            <div key={i} className="border border-line rounded-xl p-3 bg-surface">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-xs font-semibold text-fg line-clamp-2">{String(r.title ?? "—")}</p>
                <div className="flex items-center gap-1.5 flex-none">
                  {!!r.sentiment && (
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${sentimentColor(String(r.sentiment))}`}>
                      {String(r.sentiment)}
                    </span>
                  )}
                  <span className="text-[10px] text-fg-mute">↑{Number(r.score ?? 0).toLocaleString()}</span>
                </div>
              </div>
              <p className="text-[10px] text-accent mb-1">r/{String(r.subreddit ?? "—")} · {String(r.kind ?? "post")}</p>
              {!!r.body && (
                <p className="text-xs text-fg-dim line-clamp-2">{String(r.body).slice(0, 200)}</p>
              )}
              {!!r.url && (
                <a href={String(r.url)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[10px] text-accent-2 hover:underline">View on Reddit →</a>
              )}
            </div>
          ))}
        </div>
      )}

      {reviews.length === 0 && (
        <p className="text-sm text-fg-mute py-4">No Reddit posts matched. Try a more specific product URL.</p>
      )}
    </div>
  );
}

// ─── Paid Ads result preview ──────────────────────────────────────────────────
function PaidAdsPreview({ data }: { data: Record<string, unknown> }) {
  const ads = (data.ads as Record<string, unknown>[] | undefined) ?? [];
  const label = String(data.label ?? "");
  const warning = data.warning ? String(data.warning) : null;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-fg">Paid Ads — Meta Ad Library</p>
        <p className="text-xs text-fg-mute">
          {ads.length} ad(s) fetched
          {label && <> · <span className="font-medium text-fg-dim">{label}</span></>}
        </p>
      </div>

      {warning && (
        <div className="bg-accent-soft border border-accent/30 rounded-lg px-3 py-2 text-xs text-accent">{warning}</div>
      )}

      {ads.length > 0 ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {ads.map((ad, i) => (
            <PostCard key={i}
              imageUrl={(ad.imageUrl ?? ad.thumbnailUrl) as string | null}
              thumbnailUrl={ad.thumbnailUrl as string | null}
              videoUrl={ad.videoUrl as string | null}
              title={String(ad.title || ad.adName || "Paid ad")}
              meta={[ad.pageName, ad.cta, ad.status].filter(Boolean).join(" · ")}
              body={String(ad.body || ad.title || "—").slice(0, 280)}
              linkUrl={(ad.linkUrl ?? ad.instagramUrl) as string | null}
              badge={ad.status ? String(ad.status) : undefined}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-fg-mute py-4">No ads found. Check the Meta Ad Library URL and your Apify token.</p>
      )}
    </div>
  );
}

// ─── Module control card ──────────────────────────────────────────────────────
interface ModuleCardProps {
  moduleKey: ModuleKey;
  title: string;
  description: string;
  endpoint: string;
  extraFields?: React.ReactNode;
  buildBody: (url: string) => Record<string, unknown>;
  isActive: boolean;
  onResult: (module: ModuleKey, data: Record<string, unknown>) => void;
  onError: (module: ModuleKey, error: string) => void;
  urlPlaceholder?: string;
  urlLabel?: string;
}

function ModuleCard({ moduleKey, title, description, endpoint, extraFields, buildBody, isActive, onResult, onError, urlPlaceholder, urlLabel }: ModuleCardProps) {
  const [url, setUrl] = useState("");
  const [runState, setRunState] = useState<RunState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const run = async () => {
    if (!url.trim()) return;
    setRunState("running");
    setErrorMsg("");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(url.trim())),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok || data.error) {
        const msg = String(data.error ?? "Request failed");
        setRunState("error");
        setErrorMsg(msg);
        onError(moduleKey, msg);
      } else {
        setRunState("done");
        onResult(moduleKey, data);
      }
    } catch (e) {
      const msg = String(e);
      setRunState("error");
      setErrorMsg(msg);
      onError(moduleKey, msg);
    }
  };

  const isRunning = runState === "running";

  return (
    <div className={`border rounded-xl p-4 bg-surface transition-colors ${
      isActive ? "border-accent/40 ring-1 ring-accent/40" :
      runState === "done" ? "border-accent-2/40" :
      runState === "error" ? "border-alert/40" :
      "border-line"
    }`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-sm font-semibold text-fg">{title}</p>
          <p className="text-xs text-fg-mute mt-0.5">{description}</p>
        </div>
        <span className={`flex-none text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          runState === "done" ? "bg-accent-2-soft text-accent-2" :
          runState === "error" ? "bg-alert-soft text-alert" :
          runState === "running" ? "bg-accent-soft text-accent" :
          "bg-surface-2 text-fg-mute"
        }`}>
          {runState === "running" ? "running…" : runState === "done" ? "done" : runState === "error" ? "error" : "idle"}
        </span>
      </div>

      <div className="space-y-2">
        {urlLabel && <p className="text-[10px] text-fg-mute font-medium uppercase tracking-wider">{urlLabel}</p>}
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === "Enter" && run()}
          placeholder={urlPlaceholder ?? "https://www.amazon.com/dp/… or brand URL"}
          disabled={isRunning}
          className="w-full px-3 py-2 border border-line rounded-lg text-xs text-fg placeholder-fg-mute bg-surface focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
        />
        {extraFields}
        <button
          onClick={run}
          disabled={isRunning || !url.trim()}
          className="w-full py-2 px-3 bg-accent hover:opacity-90 disabled:bg-surface-2 disabled:text-fg-mute text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5"
        >
          {isRunning && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          {isRunning ? "Running…" : `Run ${title}`}
        </button>
      </div>

      {runState === "error" && (
        <p className="mt-2 text-xs text-alert bg-alert-soft rounded-lg px-3 py-2">{errorMsg}</p>
      )}
    </div>
  );
}

// ─── Main module tester ───────────────────────────────────────────────────────
export function ModuleTester() {
  const [open, setOpen] = useState(false);
  const [socialSource, setSocialSource] = useState("auto");
  const [igHandle, setIgHandle] = useState("");
  const [activeResult, setActiveResult] = useState<ActiveResult | null>(null);

  const handleResult = (module: ModuleKey, data: Record<string, unknown>) => {
    setActiveResult({ module, data });
  };
  const handleError = (_module: ModuleKey, _error: string) => {
    // error is shown inline in the card; clear any previous result preview
    setActiveResult(null);
  };

  return (
    <div className="border border-dashed border-line rounded-xl bg-surface-2/50">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-fg-dim uppercase tracking-wider">Module Testing</span>
          <span className="text-[10px] text-fg-mute bg-surface-2 px-2 py-0.5 rounded-full">dev</span>
        </div>
        <span className="text-fg-mute text-sm">{open ? "↑" : "↓"}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          <p className="text-xs text-fg-mute">Run each scraping module independently to verify API keys and data quality before a full analysis.</p>

          {/* Control cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <ModuleCard
              moduleKey="ecom"
              title="Ecom Scraper"
              description="Amazon/marketplace product + competitors"
              endpoint="/api/media-analyser/test-ecom"
              isActive={activeResult?.module === "ecom"}
              onResult={handleResult}
              onError={handleError}
              buildBody={url => ({ url })}
            />

            <ModuleCard
              moduleKey="social"
              title="Social Intelligence"
              description="Instagram posts + paid ads via Apify or Meta Graph"
              endpoint="/api/media-analyser/test-social"
              isActive={activeResult?.module === "social"}
              onResult={handleResult}
              onError={handleError}
              extraFields={
                <div className="flex gap-2">
                  <select
                    value={socialSource}
                    onChange={e => setSocialSource(e.target.value)}
                    className="flex-1 text-xs text-fg border border-line rounded-md px-2 py-1.5 bg-surface focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="graph">Meta Graph</option>
                    <option value="public">Apify public</option>
                  </select>
                  <input
                    type="text"
                    value={igHandle}
                    onChange={e => setIgHandle(e.target.value)}
                    placeholder="@handle"
                    className="flex-1 px-2 py-1.5 border border-line rounded-md text-xs text-fg placeholder-fg-mute bg-surface focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              }
              buildBody={url => ({ url, socialSource, instagramHandle: igHandle.replace(/^@/, "") })}
            />

            <ModuleCard
              moduleKey="reddit"
              title="Reddit Reviews"
              description="Product discussions + sentiment from Reddit"
              endpoint="/api/media-analyser/test-reddit"
              isActive={activeResult?.module === "reddit"}
              onResult={handleResult}
              onError={handleError}
              buildBody={url => ({ url })}
            />

            <ModuleCard
              moduleKey="paid-ads"
              title="Paid Ads Library"
              description="Paste any Meta Ad Library URL — page-specific or keyword search"
              endpoint="/api/media-analyser/test-paid-ads"
              isActive={activeResult?.module === "paid-ads"}
              onResult={handleResult}
              onError={handleError}
              urlPlaceholder="https://www.facebook.com/ads/library/?view_all_page_id=… or ?q=BRAND"
              urlLabel="Meta Ad Library URL"
              buildBody={url => ({ adLibraryUrl: url, limit: 30 })}
            />
          </div>

          {/* Full-width result preview */}
          {activeResult && (
            <div className="border border-line rounded-xl p-5 bg-surface">
              {activeResult.module === "social" && <SocialPreview data={activeResult.data} />}
              {activeResult.module === "ecom" && <EcomPreview data={activeResult.data} />}
              {activeResult.module === "reddit" && <RedditPreview data={activeResult.data} />}
              {activeResult.module === "paid-ads" && <PaidAdsPreview data={activeResult.data} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
