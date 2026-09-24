
import { useState, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import type { AnalysisResponse, SocialPaidAd } from "@/lib/media-analyser/types";
import {
  FOCUS_LENSES, buildFocusInput, computeDataConfidence, isFocusLensKey,
  type FocusLensKey, type FocusLensResult, type DataConfidenceReport, type ChiefAnalystResult,
} from "@/lib/media-analyser/focus-lenses";
import type { FocusTabResponse } from "@/lib/media-analyser/api-types";
import type { AnalystSynthesisResponse } from "@/lib/media-analyser/api-types";
import { formatOverview, formatMetaMarketing, formatRedditReviews } from "@/lib/media-analyser/brief";
import type { PaidAdBucketGroup, PaidAdsSummary } from "@/lib/media-analyser/paid-ad-buckets";
import { PaidAdsDashboard } from "@/components/media-analyser/PaidAdsDashboard";
import { AdIntelligence } from "@/components/media-analyser/AdIntelligence";
import { GoogleAdsReportSection } from "@/components/media-analyser/GoogleAdsReport";
import { LinkedInReportSection } from "@/components/media-analyser/LinkedInReport";
import type { LinkedInPost } from "@/lib/media-analyser/linkedin-report";
import { Input } from "@/components/media-analyser/ui/Input";

const TAB_ORDER = [
  { key: "overview", label: "Overview" },
  { key: "competitor_social", label: "Ad library" },
  { key: "instagram", label: "Instagram" },
  { key: "google_ads", label: "Google Ads" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "reddit", label: "Reddit" },
  { key: "raw", label: "JSON" },
] as const;

// Focus-Driven lenses live INSIDE the Overview tab (inner pills), not the top bar.
const LENS_PILLS = [
  ...FOCUS_LENSES.map(l => ({ key: l.key as string, label: l.label })),
  { key: "data_confidence", label: "Data Confidence" },
];

type TabKey = (typeof TAB_ORDER)[number]["key"];

interface Props {
  result: AnalysisResponse;
}

interface PostCard {
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  videoUrl?: string | null;
  title: string;
  metaLine: string;
  body: string;
  analysis?: string | null;
  linkUrl?: string | null;
  account?: string | null;
  isProductMatch?: boolean;
  isReel?: boolean;
}

function isPostVideo(post: Record<string, unknown>): boolean {
  const fmt = String(post.format ?? post.media_type ?? "");
  return /reel|video/i.test(fmt);
}

function TwoColumnMediaGrid({
  stillCards,
  videoCards,
  stillFooter,
  videoFooter,
  stillEmpty = "No still creatives in this run.",
  videoEmpty = "No reels or video ads in this run.",
}: {
  stillCards: PostCard[];
  videoCards: PostCard[];
  stillFooter?: ReactNode;
  videoFooter?: ReactNode;
  stillEmpty?: string;
  videoEmpty?: string;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-x-20 lg:gap-y-10">
      <div className="min-w-0 flex flex-col gap-6 lg:pr-4">
        <h3 className="text-sm font-semibold text-fg mb-1 flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-surface-2 text-fg-dim text-xs">📷</span>
          Still creatives
          <span className="text-xs font-normal text-fg-mute">({stillCards.length})</span>
        </h3>
        {stillCards.length ? (
          <div className="flex flex-col gap-5">
            {stillCards.map((card, i) => <ImageCard key={`still-${i}`} card={card} />)}
          </div>
        ) : (
          <p className="text-sm text-fg-mute py-6 px-3 border border-dashed border-line rounded-xl">{stillEmpty}</p>
        )}
        {stillFooter}
      </div>
      <div className="min-w-0 flex flex-col gap-6 lg:pl-4 lg:border-l lg:border-line">
        <h3 className="text-sm font-semibold text-fg mb-1 flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-surface-2 text-fg-dim text-xs">🎬</span>
          Reels & videos
          <span className="text-xs font-normal text-fg-mute">({videoCards.length})</span>
        </h3>
        {videoCards.length ? (
          <div className="flex flex-col gap-5">
            {videoCards.map((card, i) => <ImageCard key={`video-${i}`} card={card} />)}
          </div>
        ) : (
          <p className="text-sm text-fg-mute py-6 px-3 border border-dashed border-line rounded-xl">{videoEmpty}</p>
        )}
        {videoFooter}
      </div>
    </div>
  );
}

function proxyImageUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  // Route Instagram/FB CDN through our proxy; these block direct browser loads
  if (/cdninstagram\.com|fbcdn\.net|instagram\.com/.test(rawUrl)) {
    return `/api/media-analyser/image-proxy?url=${encodeURIComponent(rawUrl)}`;
  }
  return rawUrl;
}

function ImageCard({ card }: { card: PostCard }) {
  // For reels: imageUrl is already set to the thumbnail in parseApifyIgItem.
  // If it still fails, fall back to thumbnailUrl.
  const primary = proxyImageUrl(card.imageUrl);
  const fallback = proxyImageUrl(card.thumbnailUrl);
  const hasVideo = Boolean(card.videoUrl);
  const isVideo = hasVideo || Boolean(card.isReel);

  return (
    <div className="w-full border border-line rounded-xl p-3 bg-surface shadow-sm">
      <div className="relative w-full h-48 rounded-lg mb-3 overflow-hidden bg-surface-2">
        {hasVideo ? (
          <video
            src={card.videoUrl as string}
            className="w-full h-48 object-cover bg-black"
            controls
            preload="metadata"
            poster={primary ?? undefined}
          />
        ) : primary ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={primary}
            alt=""
            className="w-full h-48 object-cover"
            loading="lazy"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              if (fallback && img.src !== fallback) {
                img.src = fallback;
              } else {
                img.style.display = "none";
                const ph = img.nextElementSibling as HTMLElement | null;
                if (ph) ph.style.display = "flex";
              }
            }}
          />
        ) : null}
        <div
          className="absolute inset-0 items-center justify-center text-fg-mute text-sm"
          style={{ display: primary || hasVideo ? "none" : "flex" }}
        >
          {isVideo ? "🎬 Video" : "No preview"}
        </div>
        {isVideo && (
          <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full pointer-events-none">
            🎬 {card.isReel ? "Reel" : "Video"}
          </div>
        )}
        {card.linkUrl && (
          <a
            href={card.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute inset-0"
            aria-label="View post"
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 mb-1">
        {card.account ? (
          <p className="text-xs font-semibold text-accent">@{card.account}</p>
        ) : <span />}
        {card.isProductMatch && (
          <span className="text-[10px] font-semibold text-accent-2 bg-accent-2-soft px-1.5 py-0.5 rounded-full whitespace-nowrap">PRODUCT</span>
        )}
      </div>
      <p className="font-semibold text-sm text-fg mb-1">{card.title}</p>
      <p className="text-xs text-fg-mute mb-2">{card.metaLine}</p>
      <p className="text-sm text-fg leading-relaxed line-clamp-3">{card.body}</p>
      {card.analysis && (
        <p className="text-xs text-accent bg-accent-soft rounded-md px-2 py-1.5 mt-2 leading-relaxed">{card.analysis}</p>
      )}
      {card.linkUrl && (
        <a href={card.linkUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-accent hover:underline">View on Instagram →</a>
      )}
    </div>
  );
}

function InstagramTab({ result }: { result: AnalysisResponse }) {
  const social = result.socialSnapshot as Record<string, unknown> | null | undefined;

  if (!social) {
    return (
      <div className="py-8 space-y-2">
        <p className="text-sm text-fg-dim font-medium">Instagram scraping was not attempted.</p>
        <p className="text-xs text-fg-mute">The social step was skipped — ensure <code className="bg-surface-2 px-1 rounded">APIFY_API_TOKEN</code> is set in your environment.</p>
      </div>
    );
  }

  const dataSource = String(social.socialDataSource ?? "");
  const failureReason = dataSource.startsWith("failed:") ? dataSource.slice(7) : null;
  // Extract resolved account handle from "apify_public:@beminimalist"
  const resolvedAccount = dataSource.includes(":@") ? dataSource.split(":@")[1] : null;

  const rawPosts = (social.instagramProductPosts ?? social.marketingPosts ?? []) as Record<string, unknown>[];
  const posts = rawPosts.filter(p => !p.platform || String(p.platform).toLowerCase().includes("instagram"));

  if (!posts.length) {
    return (
      <div className="py-8 space-y-3">
        <p className="text-sm text-fg font-medium">No Instagram posts found for this product.</p>
        {failureReason && (
          <div className="bg-accent-soft border border-accent/30 rounded-lg p-3 text-xs text-accent">
            <span className="font-semibold">Reason: </span>{failureReason}
          </div>
        )}
        <p className="text-xs text-fg-mute">To force a specific brand account, set <code className="bg-surface-2 px-1 rounded">BRAND_INSTAGRAM_URL=https://www.instagram.com/&lt;handle&gt;/</code> in your Vercel env vars and re-run.</p>
      </div>
    );
  }

  // Sort: product-matched first, then most recent, then by engagement
  const sorted = [...posts].sort((a, b) => {
    const aMatch = a.productUrlMatched ? 1 : 0;
    const bMatch = b.productUrlMatched ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    const aDate = a.publishedAt ? new Date(String(a.publishedAt)).getTime() : 0;
    const bDate = b.publishedAt ? new Date(String(b.publishedAt)).getTime() : 0;
    if (aDate && bDate) return bDate - aDate;
    return (Number(b.likes ?? 0) + Number(b.comments ?? 0)) - (Number(a.likes ?? 0) + Number(a.comments ?? 0));
  });

  const buildCard = (p: Record<string, unknown>): PostCard => {
    const likes = Number(p.likes ?? 0);
    const comments = Number(p.comments ?? 0);
    const fmt = String(p.format ?? "Post");
    const isReel = isPostVideo(p);
    let meta = `${isReel ? "🎬 Reel" : fmt} · ${likes.toLocaleString()} likes · ${comments.toLocaleString()} comments`;
    if (p.engagementRate != null) meta += ` · ${p.engagementRate}% ER`;
    if (p.publishedAt) meta += ` · ${String(p.publishedAt).slice(0, 10)}`;
    return {
      imageUrl: (p.imageUrl ?? p.thumbnailUrl) as string | null,
      thumbnailUrl: p.thumbnailUrl as string | null,
      title: String(p.marketingAngle ?? p.hook ?? "Product post"),
      metaLine: meta,
      body: String(p.captionSnippet ?? p.hook ?? p.body ?? "—"),
      analysis: (p.postAnalysis ?? p.hook) as string | null,
      linkUrl: (p.postUrl ?? p.url) as string | null,
      account: (p.account ?? p.ownerUsername) as string | null,
      isProductMatch: Boolean(p.productUrlMatched),
      isReel,
    };
  };

  const limited = sorted.slice(0, 30);
  const stillCards = limited.filter(p => !isPostVideo(p)).map(buildCard);
  const videoCards = limited.filter(p => isPostVideo(p)).map(buildCard);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-fg-dim">
          <span className="font-semibold text-fg">{posts.length}</span> Instagram post(s) matched this product.
        </p>
        {resolvedAccount && (
          <a
            href={`https://www.instagram.com/${resolvedAccount}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-accent hover:underline bg-accent-soft px-2 py-1 rounded-full"
          >
            @{resolvedAccount} ↗
          </a>
        )}
      </div>
      <TwoColumnMediaGrid
        stillCards={stillCards}
        videoCards={videoCards}
        stillEmpty="No still image posts found."
        videoEmpty="No reels or video posts found."
      />
    </div>
  );
}

function PaidAdsTab({ result }: { result: AnalysisResponse }) {
  const social = result.socialSnapshot as Record<string, unknown> | null | undefined;

  if (!social) {
    return (
      <div className="py-8 space-y-2">
        <p className="text-sm text-fg-dim font-medium">Paid ads were not fetched in this run.</p>
        <p className="text-xs text-fg-mute">Set <code className="bg-surface-2 px-1 rounded">APIFY_API_TOKEN</code> or provide a Meta Ad Library URL when starting the audit.</p>
      </div>
    );
  }

  const ads = (social.paidAds ?? []) as SocialPaidAd[];
  const analysis = social.paidAdsAnalysis ? String(social.paidAdsAnalysis) : null;
  const buckets = (social.paidAdBuckets ?? []) as PaidAdBucketGroup[];
  const summary = (social.paidAdsSummary ?? null) as PaidAdsSummary | null;

  const paidAdsFetchError = social.paidAdsFetchError ? String(social.paidAdsFetchError) : null;

  if (!ads.length) {
    return (
      <div className="py-8 space-y-3">
        <p className="text-sm text-fg font-medium">No paid ads found for this brand in the Meta Ads Library.</p>
        {paidAdsFetchError ? (
          <div className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-xs text-accent leading-relaxed">
            <p className="font-semibold mb-1">Fetch issue</p>
            <p>{paidAdsFetchError}</p>
          </div>
        ) : (
          <p className="text-xs text-fg-mute">
            In Meta Ad Library, click the brand page and copy the <strong>full</strong> URL from your browser
            (must include <code className="bg-surface-2 px-1 rounded">view_all_page_id=</code> or <code className="bg-surface-2 px-1 rounded">q=</code>).
            Also confirm <code className="bg-surface-2 px-1 rounded">APIFY_API_TOKEN</code> is set on Vercel.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-fg-dim">
        <span className="font-semibold text-fg">{ads.length}</span> Meta ad(s) — visual intelligence dashboard
      </p>

      <PaidAdsDashboard
        ads={ads}
        buckets={buckets}
        summary={summary}
        analysis={analysis}
        result={result}
        showGenerators
      />
    </div>
  );
}

/** The Outpost competitive ad-ranking panel. Returns null when there's no ad data
 *  (so it can sit at the top of Overview without showing an empty placeholder). */
function AdIntelPanel({ result }: { result: AnalysisResponse }) {
  const social = result.socialSnapshot as Record<string, unknown> | null | undefined;
  const youAds = (social?.paidAds ?? []) as SocialPaidAd[];
  const competitorSocial = (result.competitorSocial ?? []) as Array<Record<string, unknown>>;
  const competitors = competitorSocial.map((c, i) => ({
    brand: String(c.brand ?? `Competitor ${i + 1}`),
    ads: (c.ads ?? []) as SocialPaidAd[],
  }));
  const hasAny = youAds.length > 0 || competitors.some(c => c.ads.length > 0);
  if (!hasAny) return null;
  // "Competitors only" — exclude the user's own brand from the comparison.
  const competitorsOnly = (result as Record<string, unknown>).competitorsOnly === true;
  const brandName = String((result as Record<string, unknown>).brandName ?? "").trim();
  const you = (!competitorsOnly && youAds.length) ? { brand: brandName || "You", ads: youAds } : null;
  return <AdIntelligence you={you} competitors={competitors} />;
}

function GoogleAdsTab({ result }: { result: AnalysisResponse }) {
  const social = result.socialSnapshot as Record<string, unknown> | null | undefined;
  const youAds = (social?.googleAds ?? []) as SocialPaidAd[];
  const fetchError = social?.googleAdsFetchError ? String(social.googleAdsFetchError) : null;
  const competitorSocial = (result.competitorSocial ?? []) as Array<Record<string, unknown>>;
  const competitors = competitorSocial
    .map((c, i) => ({ brand: String(c.brand ?? `Competitor ${i + 1}`), ads: (c.googleAds ?? []) as SocialPaidAd[] }))
    .filter(c => c.ads.length > 0);
  const hasAny = youAds.length > 0 || competitors.length > 0;

  if (!hasAny) {
    return (
      <div className="py-8 space-y-3">
        <p className="text-sm text-fg font-medium">No Google Ads found in the Transparency Center for this run.</p>
        {fetchError ? (
          <div className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-xs text-accent leading-relaxed">
            <p className="font-semibold mb-1">Fetch issue</p>
            <p>{fetchError}</p>
          </div>
        ) : (
          <p className="text-xs text-fg-mute">Tick <span className="font-medium text-fg-dim">&ldquo;Include Google Ads&rdquo;</span> before running an audit. We scan the Google Ads Transparency Center for you and your competitors (no spend data — creatives, formats and run dates).</p>
        )}
      </div>
    );
  }

  const competitorsOnly = (result as Record<string, unknown>).competitorsOnly === true;
  const brandName = String((result as Record<string, unknown>).brandName ?? "").trim();
  const you = (!competitorsOnly && youAds.length) ? { brand: brandName || "You", ads: youAds } : null;
  // most-common region across all scraped ads → masthead label
  const regionCount = new Map<string, number>();
  for (const ad of [...youAds, ...competitors.flatMap(c => c.ads)]) {
    const rg = (ad.categories?.[0] ?? "").trim();
    if (rg) regionCount.set(rg, (regionCount.get(rg) ?? 0) + 1);
  }
  const region = [...regionCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return <GoogleAdsReportSection you={you} competitors={competitors} region={region} />;
}

function LinkedInTab({ result }: { result: AnalysisResponse }) {
  const social = result.socialSnapshot as Record<string, unknown> | null | undefined;
  const youPosts = (social?.linkedInPosts ?? []) as unknown as LinkedInPost[];
  const competitorSocial = (result.competitorSocial ?? []) as Array<Record<string, unknown>>;
  const competitorsAll = competitorSocial
    .map((c, i) => ({ brand: String(c.brand ?? `Competitor ${i + 1}`), posts: (c.linkedInPosts ?? []) as unknown as LinkedInPost[] }));
  const competitors = competitorsAll.filter(c => c.posts.length > 0);
  const hasAny = youPosts.length > 0 || competitors.length > 0;

  if (!hasAny) {
    return (
      <div className="py-8 space-y-3">
        <p className="text-sm text-fg font-medium">No LinkedIn company posts found for this run.</p>
        <p className="text-xs text-fg-mute">Tick <span className="font-medium text-fg-dim">&ldquo;Include LinkedIn&rdquo;</span> (or set <code>LINKEDIN_ENABLED=true</code>) before running an audit. We scan each brand&apos;s LinkedIn company page for organic posts (cadence, media mix, engagement) — this is organic activity, not LinkedIn Ads.</p>
      </div>
    );
  }

  const competitorsOnly = (result as Record<string, unknown>).competitorsOnly === true;
  const brandName = String((result as Record<string, unknown>).brandName ?? "").trim();
  const you = (!competitorsOnly && youPosts.length) ? { brand: brandName || "You", posts: youPosts } : null;
  // Brands we scraped LinkedIn for but got 0 posts — surface them so they don't silently vanish.
  const emptyBrands = [
    ...(!competitorsOnly && brandName && youPosts.length === 0 ? [brandName] : []),
    ...competitorsAll.filter(c => c.posts.length === 0).map(c => c.brand),
  ];
  return <LinkedInReportSection you={you} competitors={competitors} emptyBrands={emptyBrands} />;
}

/** An ad matches when its copy/CTA/page contains EVERY whitespace term (AND). */
function adMatchesKeyword(ad: SocialPaidAd, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = `${ad.title ?? ""} ${ad.body ?? ""} ${ad.cta ?? ""} ${ad.pageName ?? ""} ${ad.adName ?? ""}`.toLowerCase();
  return terms.every(t => hay.includes(t));
}

/** Map an Apify Instagram post record to a PostCard. */
function buildPostCard(p: Record<string, unknown>): PostCard {
  const likes = Number(p.likes ?? 0);
  const comments = Number(p.comments ?? 0);
  const isReel = isPostVideo(p);
  let meta = `${isReel ? "🎬 Reel" : String(p.format ?? "Post")} · ${likes.toLocaleString()} likes · ${comments.toLocaleString()} comments`;
  if (p.publishedAt) meta += ` · ${String(p.publishedAt).slice(0, 10)}`;
  return {
    imageUrl: (p.imageUrl ?? p.thumbnailUrl) as string | null,
    thumbnailUrl: p.thumbnailUrl as string | null,
    title: String(p.marketingAngle ?? p.captionSnippet ?? "Post"),
    metaLine: meta,
    body: String(p.captionSnippet ?? "—"),
    linkUrl: (p.postUrl ?? null) as string | null,
    account: (p.account ?? null) as string | null,
    isReel,
  };
}

/** Handle directory — your brand + every competitor's Instagram handle (profile links). */
function InstagramHandles({ result }: { result: AnalysisResponse }) {
  const social = result.socialSnapshot as Record<string, unknown> | null | undefined;
  const dataSource = String(social?.socialDataSource ?? "");
  const ourHandle = dataSource.includes(":@") ? dataSource.split(":@")[1] : null;
  const brandName = String((result as Record<string, unknown>).brandName ?? "").trim();
  const competitors = (result.competitorSocial ?? []) as Array<Record<string, unknown>>;

  const chips: { label: string; handle: string | null; you: boolean }[] = [];
  if (ourHandle || brandName) chips.push({ label: brandName || "You", handle: ourHandle, you: true });
  for (const c of competitors) chips.push({ label: String(c.brand ?? "Competitor"), handle: c.handle ? String(c.handle) : null, you: false });
  if (!chips.length) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-fg-dim uppercase tracking-wider mb-3">Instagram handles</h3>
      <div className="flex flex-wrap gap-2">
        {chips.map((ch, i) => ch.handle ? (
          <a key={i} href={`https://www.instagram.com/${ch.handle}/`} target="_blank" rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border hover:opacity-90 ${ch.you ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-fg"}`}>
            <span className="font-semibold">{ch.label}</span>
            <span className={ch.you ? "opacity-80" : "text-fg-mute"}>@{ch.handle} ↗</span>
          </a>
        ) : (
          <span key={i} className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border border-line bg-surface-2 text-fg-mute">
            <span className="font-semibold text-fg-dim">{ch.label}</span>
            <span>handle not found</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Competitor Instagram posts + reels, one section per competitor. */
function CompetitorInstagramPosts({ result }: { result: AnalysisResponse }) {
  const competitors = (result.competitorSocial ?? []) as Array<Record<string, unknown>>;
  const withPosts = competitors.filter(c => ((c.posts ?? []) as unknown[]).length > 0);
  if (!withPosts.length) return null;
  return (
    <div className="space-y-10">
      <h2 className="text-base font-semibold text-fg">Competitor Instagram</h2>
      {withPosts.map((c, i) => {
        const brand = String(c.brand ?? `Competitor ${i + 1}`);
        const handle = c.handle ? String(c.handle) : null;
        const posts = (c.posts ?? []) as Record<string, unknown>[];
        const stills = posts.filter(p => !isPostVideo(p)).map(buildPostCard);
        const videos = posts.filter(p => isPostVideo(p)).map(buildPostCard);
        return (
          <div key={i} className="space-y-4">
            <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
              <h3 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent text-xs">#{i + 1}</span>
                {brand}
                {handle && <a href={`https://www.instagram.com/${handle}/`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-accent hover:underline bg-accent-soft px-2 py-0.5 rounded-full">@{handle} ↗</a>}
              </h3>
              <span className="text-xs text-fg-mute whitespace-nowrap">{posts.length} posts</span>
            </div>
            <TwoColumnMediaGrid stillCards={stills} videoCards={videos} stillEmpty="No still posts." videoEmpty="No reels." />
          </div>
        );
      })}
    </div>
  );
}

function CompetitorSocialTab({ result }: { result: AnalysisResponse }) {
  const social = result.socialSnapshot as Record<string, unknown> | null | undefined;
  const youAds = (social?.paidAds ?? []) as Record<string, unknown>[];
  const competitorsOnly = (result as Record<string, unknown>).competitorsOnly === true;
  const brandName = String((result as Record<string, unknown>).brandName ?? "").trim();
  const competitorSocial = (result.competitorSocial ?? []) as Array<Record<string, unknown>>;

  // Unified brand list — your brand first (if its ads were scraped), then each competitor.
  type BrandBlock = { brand: string; handle: string | null; why: string | null; ads: Record<string, unknown>[]; warning: string | null };
  const brands: BrandBlock[] = [];
  if (!competitorsOnly && youAds.length) brands.push({ brand: brandName || "You", handle: null, why: "Your brand", ads: youAds, warning: null });
  for (const c of competitorSocial) brands.push({
    brand: String(c.brand ?? "Competitor"),
    handle: c.handle ? String(c.handle) : null,
    why: c.why ? String(c.why) : null,
    ads: (c.ads ?? []) as Record<string, unknown>[],
    warning: c.warning ? String(c.warning) : null,
  });

  // Keyword search folded in from the old "Keyword Ads" tab — filters each brand's Meta ads.
  const [keyword, setKeyword] = useState("");
  const terms = keyword.toLowerCase().split(/\s+/).map(t => t.trim()).filter(Boolean);
  // Default to the first brand only — pick others (or add more for a side-by-side
  // comparison) from the dropdown, instead of scrolling through every brand stacked.
  const [selected, setSelected] = useState<number[]>(() => brands.length ? [0] : []);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!brands.length) {
    return (
      <div className="py-8 space-y-2">
        <p className="text-sm text-fg font-medium">No ad data in this run.</p>
        <p className="text-xs text-fg-mute">Add competitors (or a Meta Ad Library URL for your own brand) before running an analysis and we&apos;ll scrape their ads.</p>
      </div>
    );
  }

  const chosen = selected.filter(i => i < brands.length);
  const idxList = chosen.length ? chosen : brands.map((_, i) => i);
  const multi = idxList.length > 1;
  const toggle = (i: number) => setSelected(prev => prev.includes(i) ? (prev.length > 1 ? prev.filter(x => x !== i) : prev) : [...prev, i]);
  const pickerLabel = idxList.length === 1 ? brands[idxList[0]].brand : `${idxList.length} brands`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-fg-dim">
          <span className="font-semibold text-fg">{brands.length}</span> brand{brands.length !== 1 ? "s" : ""} — Meta Ad Library. Instagram posts are on the Instagram tab.
        </p>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {brands.length > 1 && (
            <div className="relative shrink-0">
              <button onClick={() => setPickerOpen(o => !o)} className="inline-flex items-center gap-1.5 rounded-full bg-accent text-bg text-xs font-medium px-4 py-2 whitespace-nowrap">
                {pickerLabel} ▾
              </button>
              {pickerOpen && (
                <div className="absolute right-0 z-30 mt-1.5 w-56 rounded-lg border border-line bg-surface shadow-lg p-1.5 max-h-72 overflow-auto">
                  {brands.map((b, i) => {
                    const on = idxList.includes(i);
                    return (
                      <button key={i} onClick={() => toggle(i)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-surface-2 text-left">
                        <span className={`h-4 w-4 rounded border flex items-center justify-center text-[10px] ${on ? "bg-accent border-accent text-bg" : "border-line text-transparent"}`}>✓</span>
                        <span className="text-sm text-fg truncate">{b.brand}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="w-full sm:w-72">
            <Input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="Search ads by keyword — e.g. serum, discount…"
            />
          </div>
        </div>
      </div>

      <div style={{ display: multi ? "flex" : "block", gap: 20, overflowX: multi ? "auto" : "visible", paddingBottom: multi ? 8 : 0 }}>
        {idxList.map(i => {
          const c = brands[i];
          const ads = c.ads;
          const typedAds = (ads as SocialPaidAd[]).filter(ad => adMatchesKeyword(ad, terms));

          return (
            <div key={i} className="space-y-4" style={{ flex: multi ? "0 0 460px" : "1 1 auto", minWidth: 0 }}>
              <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-fg flex items-center gap-2 flex-wrap">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent text-xs">#{i + 1}</span>
                    {c.brand}
                    {c.handle && (
                      <a href={`https://www.instagram.com/${c.handle}/`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-accent hover:underline bg-accent-soft px-2 py-0.5 rounded-full">@{c.handle} ↗</a>
                    )}
                  </h2>
                  {c.why && <p className="text-xs text-fg-dim mt-0.5">{c.why}</p>}
                </div>
                <span className="text-xs text-fg-mute whitespace-nowrap">{ads.length} ads</span>
              </div>

              {c.warning && ads.length === 0 && (
                <p className="text-xs text-accent bg-accent-soft border border-accent/30 rounded-md px-2.5 py-1.5">Could not fetch ads for this brand: {c.warning}</p>
              )}

              {ads.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-fg-dim uppercase tracking-wider mb-3">
                    Meta ads{terms.length ? ` · ${typedAds.length} of ${ads.length} match “${keyword.trim()}”` : ""}
                  </h3>
                  {typedAds.length > 0 ? (
                    <PaidAdsDashboard ads={typedAds} compact />
                  ) : (
                    <p className="text-sm text-fg-mute py-4 px-3 border border-dashed border-line rounded-lg">No ads match “{keyword.trim()}” for {c.brand}.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompetitorInstagramTab({ result }: { result: AnalysisResponse }) {
  const ecom = result.ecomSnapshot as Record<string, unknown> | null | undefined;
  const products = (ecom?.products as Record<string, unknown>[] | undefined) ?? [];
  const target = products[0];
  const competitors = (target?.competitors as Record<string, unknown>[] | undefined) ?? [];

  if (!competitors.length) {
    return <p className="text-sm text-fg-mute py-8">No competitor data available. Run an audit first.</p>;
  }

  // Collect any social/instagram posts tagged to competitors
  const social = result.socialSnapshot as Record<string, unknown> | null | undefined;
  const allPosts = ((social?.marketingPosts ?? []) as Record<string, unknown>[]);
  const competitorPosts = allPosts.filter(p => p.source === "competitor" || p.account);

  return (
    <div>
      <h2 className="text-base font-semibold text-fg mb-1">Competitor Instagram Analysis</h2>
      <p className="text-sm text-fg-dim mb-6">Instagram presence of the top {competitors.length} competitors analyzed in this audit.</p>

      {/* Competitor grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {competitors.slice(0, 6).map((c, i) => {
          const title = String(c.title ?? "—").slice(0, 50);
          const brand = String(c.brand ?? "—");
          const rating = c.rating != null ? `★ ${c.rating}` : "";
          const reviews = c.reviewCount != null ? `${Number(c.reviewCount).toLocaleString()} reviews` : "";
          const slug = brand.toLowerCase().replace(/\s+/g, "");
          const igSearchUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(slug)}/`;
          return (
            <div key={i} className="border border-line rounded-xl p-4 bg-surface">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="font-semibold text-sm text-fg">{title}</p>
                  <p className="text-xs text-fg-dim">{brand} · {[rating, reviews].filter(Boolean).join(" · ")}</p>
                </div>
                <span className="text-xs bg-surface-2 text-fg-dim px-2 py-0.5 rounded-full whitespace-nowrap">#{i + 1}</span>
              </div>
              {c.asin ? (
                <p className="text-xs text-fg-mute font-mono mb-2">ASIN: {String(c.asin)}</p>
              ) : null}
              <a href={igSearchUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">
                Search #{slug} on Instagram →
              </a>
              {c.battleCard ? (
                <div className="mt-3 bg-accent-soft border border-accent/30 rounded-lg p-2.5">
                  <p className="text-xs font-semibold text-accent mb-1">Battle card insight</p>
                  <p className="text-xs text-accent">{String((c.battleCard as Record<string, unknown>)?.verdict ?? (c.battleCard as Record<string, unknown>)?.attackVector ?? "—")}</p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Any competitor posts found via Apify */}
      {competitorPosts.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-fg mb-3">Competitor posts found via Apify</h3>
          <div className="flex flex-wrap gap-4">
            {competitorPosts.slice(0, 8).map((p, i) => {
              const likes = Number(p.likes ?? 0);
              const comments = Number(p.comments ?? 0);
              return (
                <ImageCard key={i} card={{
                  imageUrl: (p.imageUrl ?? p.thumbnailUrl) as string | null,
                  title: String(p.marketingAngle ?? p.hook ?? "Competitor post"),
                  metaLine: `${p.format ?? "Post"} · ${likes.toLocaleString()} likes · ${comments.toLocaleString()} comments`,
                  body: String(p.captionSnippet ?? p.body ?? "—"),
                  analysis: p.postAnalysis as string | null,
                  linkUrl: (p.postUrl ?? p.url) as string | null,
                  account: p.account as string | null,
                }} />
              );
            })}
          </div>
        </>
      )}

      {competitorPosts.length === 0 && (
        <div className="bg-accent-soft border border-accent/30 rounded-xl p-4 text-sm text-accent">
          <p className="font-semibold mb-1">To scrape competitor Instagram posts:</p>
          <p>Set <code className="bg-accent-soft px-1 rounded">APIFY_API_TOKEN</code> and re-run the audit. The system will automatically search Instagram for each competitor brand.</p>
        </div>
      )}
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown
        rehypePlugins={[rehypeRaw]}
        components={{
          p: ({ children }) => (
            <p className="text-sm text-fg leading-relaxed my-2">{children}</p>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold text-fg mt-6 mb-2 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-fg mt-4 mb-1.5">{children}</h3>
          ),
          ul: ({ children }) => <ul className="space-y-1 my-2 pl-4">{children}</ul>,
          li: ({ children }) => <li className="text-sm text-fg leading-relaxed list-disc">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
          table: ({ children }) => (
            <div className="overflow-x-auto my-4">
              <table className="w-full text-sm border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="text-left text-xs font-semibold text-fg-dim uppercase tracking-wider bg-surface-2 px-4 py-2.5 border-b border-line">{children}</th>
          ),
          td: ({ children }) => (
            <td className="text-sm text-fg px-4 py-2.5 border-b border-line">{children}</td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-line pl-4 text-fg-dim italic my-3">{children}</blockquote>
          ),
          code: ({ children }) => (
            <code className="bg-surface-2 text-fg px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ── Focus-lens rendering ──
type FocusCacheEntry = { status: "loading" | "done" | "error"; data?: FocusLensResult; error?: string };

const CONF_STYLE: Record<string, string> = {
  high: "text-emerald-600 bg-emerald-50 border-emerald-200",
  medium: "text-amber-600 bg-amber-50 border-amber-200",
  low: "text-rose-600 bg-rose-50 border-rose-200",
};

function ConfidenceBadge({ level, label }: { level: string; label?: string }) {
  return (
    <span className={`text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border ${CONF_STYLE[level] ?? CONF_STYLE.medium}`}>
      {label ?? `${level} confidence`}
    </span>
  );
}

function FocusLensView({ label, entry, onRetry }: { label: string; entry?: FocusCacheEntry; onRetry: () => void }) {
  if (!entry || entry.status === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-fg-dim py-10">
        <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        Analysing the audit through the {label} lens…
      </div>
    );
  }
  if (entry.status === "error") {
    return (
      <div className="py-8 space-y-3">
        <p className="text-sm text-alert">Couldn&apos;t generate the {label} lens. {entry.error}</p>
        <button onClick={onRetry} className="text-xs font-medium text-accent hover:underline">Retry</button>
      </div>
    );
  }
  const d = entry.data!;
  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h3 className="text-base font-semibold text-fg leading-snug">{d.headline || label}</h3>
        <ConfidenceBadge level={d.confidence} />
      </div>
      {d.verdict && <p className="text-sm text-fg-dim leading-relaxed border-l-2 border-accent pl-3">{d.verdict}</p>}
      {d.confidence_note && <p className="text-xs text-fg-mute">{d.confidence_note}</p>}
      <ul className="space-y-3">
        {d.insights.map((ins, i) => (
          <li key={i} className="border border-line rounded-lg p-3.5 bg-surface-2/30">
            <p className="text-sm font-semibold text-fg">{ins.title}</p>
            {ins.detail && <p className="text-sm text-fg-dim mt-0.5 leading-relaxed">{ins.detail}</p>}
            {ins.evidence && <p className="text-[11px] text-fg-mute mt-1 font-mono">↳ {ins.evidence}</p>}
          </li>
        ))}
      </ul>
      {d.watchouts.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-fg-dim uppercase tracking-wide mb-1.5">Watch-outs</p>
          <ul className="list-disc pl-5 space-y-1">
            {d.watchouts.map((w, i) => <li key={i} className="text-sm text-fg-dim leading-relaxed">{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

const STATUS_CHIP: Record<string, string> = {
  collected: "text-emerald-600 bg-emerald-50 border-emerald-200",
  partial: "text-amber-600 bg-amber-50 border-amber-200",
  missing: "text-rose-600 bg-rose-50 border-rose-200",
};

function DataConfidenceView({ report }: { report: DataConfidenceReport }) {
  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-base font-semibold text-fg">Data Confidence</h3>
        <ConfidenceBadge level={report.overall} label={`${report.overall} · ${report.scorePct}% coverage`} />
      </div>
      <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
        <div className={`h-full ${report.overall === "high" ? "bg-emerald-500" : report.overall === "medium" ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${report.scorePct}%` }} />
      </div>
      <ul className="divide-y divide-line border border-line rounded-lg overflow-hidden">
        {report.sources.map((s, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <div>
              <p className="text-sm font-medium text-fg">{s.name}</p>
              <p className="text-[11px] text-fg-mute">{s.detail}</p>
            </div>
            <span className={`text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${STATUS_CHIP[s.status]}`}>{s.status}</span>
          </li>
        ))}
      </ul>
      {report.notes.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-fg-dim uppercase tracking-wide mb-1.5">How much to trust the rest</p>
          <ul className="list-disc pl-5 space-y-1">
            {report.notes.map((n, i) => <li key={i} className="text-sm text-fg-dim leading-relaxed">{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

type SynthState = { status: "idle" | "loading" | "done" | "error"; data?: ChiefAnalystResult; error?: string };

function ChiefAnalystPanel({ state, onRun }: { state: SynthState; onRun: () => void }) {
  if (state.status === "idle") {
    return (
      <div className="rounded-xl border border-line bg-surface-2/40 p-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-xl">
          <p className="text-sm font-semibold text-fg">Chief Analyst — full multi-agent analysis</p>
          <p className="text-xs text-fg-dim mt-0.5 leading-relaxed">Runs four domain experts (Threat, Creative, Offer &amp; Pricing, Channel) over the audit, weights each by data confidence, then synthesises one brief — surfacing where the experts disagree instead of smoothing it over.</p>
        </div>
        <button onClick={onRun} className="shrink-0 rounded-lg bg-accent text-white text-sm font-medium px-4 py-2 hover:opacity-90">Run analysis</button>
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="rounded-xl border border-line bg-surface-2/40 p-4 flex items-center gap-2 text-sm text-fg-dim">
        <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        Convening the panel — domain experts then Chief Analyst synthesis… (this takes a bit)
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="rounded-xl border border-line p-4 space-y-2">
        <p className="text-sm text-alert">Synthesis failed. {state.error}</p>
        <button onClick={onRun} className="text-xs font-medium text-accent hover:underline">Retry</button>
      </div>
    );
  }
  const d = state.data!;
  return (
    <div className="rounded-xl border border-line p-4 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-sm font-semibold text-fg">Chief Analyst synthesis</p>
        <ConfidenceBadge level={d.overallConfidence} />
        <button onClick={onRun} className="ml-auto text-[11px] text-fg-mute hover:text-fg-dim">↻ Re-run</button>
      </div>
      {d.executiveSummary && <p className="text-sm text-fg-dim leading-relaxed">{d.executiveSummary}</p>}

      {d.topFindings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-fg-dim uppercase tracking-wide">Top findings</p>
          <ul className="space-y-2">
            {d.topFindings.map((f, i) => (
              <li key={i} className="border border-line rounded-lg p-3 bg-surface-2/30">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-fg">{f.title}</p>
                  <span className="flex items-center gap-1.5">
                    {f.domain && <span className="text-[10px] font-mono uppercase tracking-wide text-fg-mute">{f.domain}</span>}
                    <ConfidenceBadge level={f.confidence} label={f.confidence} />
                  </span>
                </div>
                {f.detail && <p className="text-sm text-fg-dim mt-0.5 leading-relaxed">{f.detail}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.conflicts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-fg-dim uppercase tracking-wide">Where the experts disagree</p>
          <ul className="space-y-2">
            {d.conflicts.map((c, i) => (
              <li key={i} className="border-l-2 border-amber-400 pl-3">
                <p className="text-sm font-medium text-fg">{c.topic}</p>
                {c.positions.map((p, j) => <p key={j} className="text-[13px] text-fg-mute leading-snug">• {p}</p>)}
                {c.resolution && <p className="text-[13px] text-fg-dim mt-0.5 leading-snug"><span className="font-medium text-fg">Resolution:</span> {c.resolution}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.prioritizedActions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-fg-dim uppercase tracking-wide mb-1.5">Prioritised actions</p>
          <ol className="list-decimal pl-5 space-y-1">
            {d.prioritizedActions.map((a, i) => <li key={i} className="text-sm text-fg-dim leading-relaxed">{a}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

export function BriefTabs({ result }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const social = result.socialSnapshot as Record<string, unknown> | null | undefined;

  // On-demand focus lenses: compute the compact input once; fetch each lens when its tab is
  // first opened and cache the result so switching tabs doesn't re-request.
  const focusInput = useMemo(() => buildFocusInput(result), [result]);
  const dataConfidence = useMemo(() => computeDataConfidence(result), [result]);
  const [lensCache, setLensCache] = useState<Record<string, FocusCacheEntry>>({});
  const [synth, setSynth] = useState<SynthState>({ status: "idle" });
  const [activeLens, setActiveLens] = useState<FocusLensKey | "data_confidence" | null>(null);

  const loadLens = (key: FocusLensKey) => {
    setLensCache(prev => ({ ...prev, [key]: { status: "loading" } }));
    fetch("/api/media-analyser/focus-tab", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lens: key, input: focusInput, qa: dataConfidence }),
    })
      .then(async res => {
        const data = (await res.json().catch(() => ({}))) as Partial<FocusTabResponse> & { error?: string };
        if (!res.ok || !data.result) throw new Error(data.error || "Generation failed");
        setLensCache(prev => ({ ...prev, [key]: { status: "done", data: data.result } }));
      })
      .catch(e => setLensCache(prev => ({ ...prev, [key]: { status: "error", error: e instanceof Error ? e.message : String(e) } })));
  };

  // Chief Analyst: runs all domain agents + synthesis, and pre-fills the individual lens tabs.
  const loadSynthesis = () => {
    setSynth({ status: "loading" });
    fetch("/api/media-analyser/analyst-synthesis", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: focusInput, qa: dataConfidence }),
    })
      .then(async res => {
        const data = (await res.json().catch(() => ({}))) as Partial<AnalystSynthesisResponse> & { error?: string };
        if (!res.ok || !data.synthesis) throw new Error(data.error || "Synthesis failed");
        setSynth({ status: "done", data: data.synthesis });
        if (data.agents) {
          setLensCache(prev => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(data.agents!)) if (v) next[k] = { status: "done", data: v };
            return next;
          });
        }
      })
      .catch(e => setSynth({ status: "error", error: e instanceof Error ? e.message : String(e) }));
  };

  // Inner Overview lens picker — load on first select, cache thereafter.
  const selectLens = (key: string) => {
    setActiveLens(key as FocusLensKey | "data_confidence");
    if (isFocusLensKey(key) && !lensCache[key]) loadLens(key);
  };

  const renderContent = () => {
    if (activeTab === "raw") {
      return (
        <pre className="text-xs bg-surface-2 border border-line rounded-lg p-4 overflow-auto max-h-[70vh] text-fg font-mono leading-relaxed">
          {JSON.stringify(result, null, 2)}
        </pre>
      );
    }
    if (activeTab === "competitor_social") return <CompetitorSocialTab result={result} />;
    if (activeTab === "instagram") return (
      <div className="space-y-12">
        <InstagramHandles result={result} />
        <InstagramTab result={result} />
        <CompetitorInstagramPosts result={result} />
      </div>
    );
    if (activeTab === "google_ads") return <GoogleAdsTab result={result} />;
    if (activeTab === "linkedin") return <LinkedInTab result={result} />;

    // Overview leads with the competitive ad-ranking panel (hidden when no ad data),
    // then the written brief.
    if (activeTab === "overview") {
      return (
        <div className="space-y-6">
          <ChiefAnalystPanel state={synth} onRun={loadSynthesis} />

          {/* Focus lenses — re-frame the same audit; each generated on demand when selected. */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-fg-dim uppercase tracking-wide">Focus lenses</p>
            <div className="flex gap-1.5 flex-wrap">
              {LENS_PILLS.map(p => (
                <button
                  key={p.key}
                  onClick={() => selectLens(p.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    activeLens === p.key ? "bg-accent text-white border-accent" : "border-line text-fg-dim hover:text-fg hover:bg-surface-2"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="pt-1">
              {activeLens === null && (
                <p className="text-sm text-fg-mute">Pick a lens to re-frame this audit through it — or run the full multi-agent analysis above.</p>
              )}
              {activeLens === "data_confidence" && <DataConfidenceView report={dataConfidence} />}
              {activeLens && activeLens !== "data_confidence" && (
                <FocusLensView
                  label={FOCUS_LENSES.find(l => l.key === activeLens)?.label ?? ""}
                  entry={lensCache[activeLens]}
                  onRetry={() => loadLens(activeLens as FocusLensKey)}
                />
              )}
            </div>
          </div>

          <AdIntelPanel result={result} />
          <MarkdownContent content={formatOverview(result)} />
        </div>
      );
    }

    const contentMap: Record<string, string> = {
      reddit: formatRedditReviews(result.redditSnapshot) || "_Reddit reviews were not included in this run._",
    };

    const content = contentMap[activeTab];
    if (!content) return <p className="text-sm text-fg-mute py-8">No data for this section.</p>;
    return <MarkdownContent content={content} />;
  };

  return (
    <div>
      <div className="border-b border-line px-4 sm:px-6 pt-3">
        <div className="flex gap-1 overflow-x-auto">
          {TAB_ORDER.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3.5 py-2 font-mono text-[11px] uppercase tracking-wide whitespace-nowrap transition-colors rounded-t-sm border-b-2 -mb-px ${
                activeTab === tab.key
                  ? "text-accent font-semibold border-accent bg-accent-soft"
                  : "text-fg-mute hover:text-fg border-transparent hover:bg-surface-2"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div key={activeTab} className="px-4 sm:px-6 py-6 min-h-[240px] animate-rise">
        {renderContent()}
      </div>
    </div>
  );
}
