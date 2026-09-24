import type { AnalysisResponse, CombinedScraperData } from "./types";
import { CombinedScraperDataSchema } from "./types";
import {
  EcomScraperError,
  EcomScraperUnavailable,
  healthCheck,
  startAsyncAudit,
  pollAsyncAudit,
  fetchEcomAudit,
} from "./ecom-client";
import {
  fetchProductSocialInsights,
  fetchCompetitorSocial,
  isSocialStepEnabled,
  resolveSocialSource,
  MetaSocialError,
} from "./meta-social";
import type { CompetitorSocial } from "./types";
import { fetchProductRedditReviews, isRedditReviewsEnabled, RedditReviewsError } from "./reddit";
import { fetchLinkedInPosts } from "./linkedin";
import { analyzeScraperInsights } from "./service";
import { formatBrief } from "./brief";
import { saveScan } from "./supabase";
import { cleanUserError } from "./user-errors";

export type SocialSource = "auto" | "graph" | "public";

export interface StreamUpdate {
  status: string;
  phase: "queued" | "scraping" | "social" | "competitors" | "reddit" | "analyzing" | "done" | "error";
  result?: AnalysisResponse;
}

// Build product context for competitor identification from the merged payload.
function productContextFrom(payload: Record<string, unknown>): { brand?: string; productTitle?: string; category?: string } {
  const ecom = payload.ecom as Record<string, unknown> | undefined;
  const product = ((ecom?.products as Record<string, unknown>[] | undefined) ?? [])[0] as Record<string, unknown> | undefined;
  const social = payload.social as Record<string, unknown> | undefined;
  const igProfile = social?.instagramBrandProfile as Record<string, unknown> | undefined;
  return {
    brand: String(product?.brand ?? product?.name ?? igProfile?.brandName ?? "").trim() || undefined,
    productTitle: String(product?.title ?? product?.name ?? "").trim() || undefined,
    category: String(product?.category ?? igProfile?.industry ?? "").trim() || undefined,
  };
}

// Best-effort preview image for a scan, used as the History thumbnail.
function thumbnailFrom(payload: Record<string, unknown>): string | undefined {
  const ecom = payload.ecom as Record<string, unknown> | undefined;
  const product = ((ecom?.products as Record<string, unknown>[] | undefined) ?? [])[0] as Record<string, unknown> | undefined;
  const fromProduct =
    (typeof product?.mainImage === "string" && product.mainImage) ||
    (typeof product?.imageUrl === "string" && product.imageUrl) ||
    (Array.isArray(product?.images) && typeof product.images[0] === "string" && product.images[0]) ||
    (Array.isArray(product?.imageUrls) && typeof product.imageUrls[0] === "string" && product.imageUrls[0]);
  if (fromProduct) return String(fromProduct);

  const social = payload.social as Record<string, unknown> | undefined;
  if (typeof social?.brandProfilePicUrl === "string" && social.brandProfilePicUrl) return social.brandProfilePicUrl;
  const igPosts = (social?.instagramProductPosts as Record<string, unknown>[] | undefined) ?? [];
  const topPosts = (social?.topPosts as Record<string, unknown>[] | undefined) ?? [];
  for (const post of [...igPosts, ...topPosts]) {
    const url = post?.imageUrl ?? post?.thumbnailUrl;
    if (typeof url === "string" && url) return url;
  }
  return undefined;
}

function progressBar(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.floor(p / 5);
  return `\`[${"█".repeat(filled)}${"░".repeat(20 - filled)}]\` **${p}%**`;
}

function stepBanner(step: number, total: number, title: string, detail = ""): string {
  return `### Step ${step} of ${total}: ${title}${detail ? `\n\n${detail}` : ""}`;
}

function socialStepTitle(sourceMode: SocialSource): string {
  const resolved = resolveSocialSource(sourceMode);
  if (resolved === "public") return "Social (public profiles · Apify)";
  if (resolved === "graph") return "Social (Meta Graph API)";
  return "Social insights";
}

async function mergeMetaSocial(
  payload: Record<string, unknown>,
  productUrl: string,
  sourceMode: SocialSource,
  instagramHandle?: string,
  adLibraryUrl?: string,
  googleAdsOpts?: { include: boolean; mode: "fast" | "rich"; url?: string; brandName?: string },
): Promise<string | null> {
  if (!isSocialStepEnabled(sourceMode)) return null;
  try {
    const data = CombinedScraperDataSchema.parse(payload);
    const [social, counts, warning] = await fetchProductSocialInsights(productUrl, data, sourceMode, instagramHandle, adLibraryUrl, googleAdsOpts);
    if (social) {
      payload.social = social;
      payload.scope = "both";
      const sc = (payload.sourceCounts as Record<string, unknown>) ?? {};
      if (counts) {
        sc.socialPosts = counts.socialPosts;
        sc.socialMetrics = counts.socialMetrics;
      }
      payload.sourceCounts = sc;
    }
    return warning ?? null;
  } catch (err) {
    if (err instanceof MetaSocialError) return String(err);
    return null;
  }
}

async function mergeRedditReviews(
  payload: Record<string, unknown>,
  productUrl: string
): Promise<string | null> {
  if (!isRedditReviewsEnabled()) return null;
  try {
    const data = CombinedScraperDataSchema.parse(payload);
    const [reddit, counts, warning] = await fetchProductRedditReviews(productUrl, data);
    if (reddit) {
      payload.reddit = reddit;
      payload.scope = "both";
      const sc = (payload.sourceCounts as Record<string, unknown>) ?? {};
      if (counts) sc.redditReviews = counts.redditReviews;
      payload.sourceCounts = sc;
    }
    return warning ?? null;
  } catch (err) {
    if (err instanceof RedditReviewsError) return String(err);
    return null;
  }
}

async function persistRun(meta: Record<string, unknown>, payload: Record<string, unknown>, result: AnalysisResponse): Promise<boolean> {
  try {
    const { brand, productTitle } = productContextFrom(payload);
    // Scans are comparisons — title them "Brand vs Competitor" (we usually compare brands;
    // falls back to a single name, or the competitor set, so it's never "Unknown product").
    const r = result as unknown as Record<string, unknown>;
    const target = (brand || (typeof r.brandName === "string" ? r.brandName : "") || productTitle || "").trim();
    const compBrands = Array.isArray(r.competitorSocial)
      ? (r.competitorSocial as Record<string, unknown>[]).map(c => String(c?.brand ?? "").trim()).filter(Boolean)
      : [];
    const uniqComps = [...new Set(compBrands)].filter(b => b.toLowerCase() !== target.toLowerCase());
    const vsSuffix = (first: string, rest: number) => (rest > 0 ? `${first} +${rest} more` : first);
    let displayName: string | null = target || null;
    if (target && uniqComps.length) displayName = `${target} vs ${vsSuffix(uniqComps[0], uniqComps.length - 1)}`;
    else if (!target && uniqComps.length) displayName = vsSuffix(uniqComps[0], uniqComps.length - 1);

    return await saveScan(
      {
        project_id: meta.asin as string ?? null,
        product_url: meta.productUrl as string ?? null,
        asin: meta.asin as string ?? null,
        scope: (payload.scope as string) ?? "ecom",
        product_name: displayName ?? productTitle ?? null,
        brand: brand ?? null,
        thumbnail_url: thumbnailFrom(payload) ?? null,
      },
      payload as unknown as CombinedScraperData,
      result
    );
  } catch (e) {
    // Persistence is best-effort, but LOG the reason — a silent save failure (e.g. a huge
    // big-brand payload rejected by Supabase) looks identical to a timeout from the client.
    console.error(`[persist] saveScan failed — scan NOT saved to history: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export async function runProductAnalysis(
  productUrl: string,
  opts?: { useLlm?: boolean; socialSource?: SocialSource; persist?: boolean; instagramHandle?: string; adLibraryUrl?: string }
): Promise<AnalysisResponse> {
  const { useLlm = true, socialSource = "auto", persist = true, instagramHandle = "", adLibraryUrl = "" } = opts ?? {};

  if (!await healthCheck()) {
    throw new EcomScraperUnavailable(
      "No scraper API key configured. Set RAINFOREST_API_KEY or CUSTOM_SCRAPER_URL in your environment."
    );
  }

  const url = productUrl.trim();
  const audit = await fetchEcomAudit(url);
  const payload = { ...(audit.payload as Record<string, unknown>) };
  const meta = (audit.meta as Record<string, unknown>) ?? {};

  await mergeMetaSocial(payload, url, socialSource, instagramHandle, adLibraryUrl);
  await mergeRedditReviews(payload, url);

  const data = CombinedScraperDataSchema.parse(payload);
  const result = await analyzeScraperInsights(data, { useLlm });

  if (persist) await persistRun(meta, payload, result);
  return result;
}

/** A competitor the user pinned by hand (skips Gemini discovery for these). */
export interface ManualCompetitor {
  brand: string;
  instagramHandle?: string;
  metaAdLibraryUrl?: string;
  /** Optional keyword — scope this competitor's ad scrape to matching ads only. */
  adKeyword?: string;
  /** Optional Google Ads Transparency Center URL (for rich-mode Google ad scraping). */
  googleAdsUrl?: string;
  /** Optional LinkedIn company page URL (overrides name→vanity resolution for LinkedIn posts). */
  linkedInUrl?: string;
}

/** Best-effort display name from a competitor's pasted URLs (Meta q=/page slug, LinkedIn slug). */
function nameFromUrls(c: { metaAdLibraryUrl?: string; linkedInUrl?: string }): string {
  const meta = (c.metaAdLibraryUrl ?? "").trim();
  if (meta) {
    try {
      const u = new URL(meta.startsWith("http") ? meta : "https://" + meta);
      const q = u.searchParams.get("q");
      if (q) return q;
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (seg && !/^(ads|profile\.php)$/i.test(seg)) return seg.replace(/[-_.]+/g, " ");
    } catch { /* ignore */ }
  }
  const li = (c.linkedInUrl ?? "").match(/linkedin\.com\/(?:company|school|showcase)\/([^/?#]+)/i);
  if (li) return li[1].replace(/-/g, " ");
  return "";
}

export async function* runProductAnalysisStream(
  productUrl: string,
  opts?: { useLlm?: boolean; socialSource?: SocialSource; instagramHandle?: string; adLibraryUrl?: string; coverCompetitors?: boolean; competitors?: ManualCompetitor[]; brandName?: string; includeGoogleAds?: boolean; googleAdsMode?: "fast" | "rich"; googleAdsUrl?: string; includeLinkedIn?: boolean; linkedInUrl?: string; competitorsOnly?: boolean }
): AsyncGenerator<StreamUpdate> {
  const { useLlm = true, socialSource = "auto", instagramHandle, adLibraryUrl, brandName = "", includeGoogleAds = false, googleAdsMode = "fast", googleAdsUrl = "", includeLinkedIn = false, linkedInUrl = "", competitorsOnly = false } = opts ?? {};
  // User-pinned competitors — when present we scrape THESE and skip Gemini discovery.
  const manualCompetitors = (opts?.competitors ?? [])
    .map(c => ({
      brand: (c.brand ?? "").trim(),
      instagramHandle: (c.instagramHandle ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "").replace(/\/$/, ""),
      metaAdLibraryUrl: (c.metaAdLibraryUrl ?? "").trim(),
      adKeyword: (c.adKeyword ?? "").trim(),
      googleAdsUrl: (c.googleAdsUrl ?? "").trim(),
      linkedInUrl: (c.linkedInUrl ?? "").trim(),
    }))
    // A competitor is usable if it has a brand/handle to scrape IG, or an Ad Library URL.
    .filter(c => c.brand || c.instagramHandle || c.metaAdLibraryUrl)
    // If only a link/handle is given, derive a display brand from the handle.
    // Give every competitor a readable name even when the name field is left blank —
    // derive it from the Meta Ad Library / LinkedIn / Google URL so cards never say "Competitor".
    .map(c => ({ ...c, brand: c.brand || c.instagramHandle || nameFromUrls(c) || "Competitor" }))
    .slice(0, 5);
  const hasManualCompetitors = manualCompetitors.length > 0;
  const url = (productUrl ?? "").trim();
  const hasHandle = !!(instagramHandle ?? "").trim();
  const hasAdLibrary = !!(adLibraryUrl ?? "").trim();
  const hasProduct = !!url;

  // Google Ads Transparency — env flag (default on) AND the form opt-in must both be true.
  // A Google scan can seed a run on its own: a Transparency URL (rich) or the brand name (fast).
  const googleFeatureOn = !["0", "false", "no"].includes((process.env.GOOGLE_ADS_ENABLED ?? "true").toLowerCase());
  const runGoogleAds = googleFeatureOn && includeGoogleAds;
  const hasGoogleSeed = runGoogleAds && !!((googleAdsUrl ?? "").trim() || (brandName ?? "").trim());

  // Need at least one input source
  if (!hasProduct && !hasHandle && !hasAdLibrary && !hasGoogleSeed) {
    yield { status: "## Provide at least one source\n\nEnter a **product URL**, an **Instagram handle**, a **Meta Ad Library URL**, or enable **Google Ads** (with a brand name or Transparency URL) to begin.", phase: "error" };
    return;
  }

  // Ecom scraper only needed when a product URL is given
  if (hasProduct && !await healthCheck()) {
    yield {
      status: `## Scraper unavailable\n\nNo scraper API key configured. Set \`RAINFOREST_API_KEY\` (or \`CUSTOM_SCRAPER_URL\`) in your environment variables.`,
      phase: "error",
    };
    return;
  }

  // Decide which steps run
  const competitorsEnabled = (process.env.COMPETITOR_SOCIAL_ENABLED ?? "true").toLowerCase();
  const competitorsFeatureOn = !["0", "false", "no"].includes(competitorsEnabled);
  const googleAdsOpts = { include: runGoogleAds, mode: googleAdsMode, url: googleAdsUrl || undefined, brandName: brandName || undefined };
  const runEcom = hasProduct;
  const runSocial = isSocialStepEnabled(socialSource) && (hasProduct || hasHandle || hasAdLibrary || hasGoogleSeed);
  // Competitors are user-pinned only now (Gemini auto-identification removed).
  const runCompetitors = competitorsFeatureOn && hasManualCompetitors;
  const runReddit = isRedditReviewsEnabled() && hasProduct; // Reddit needs a product to search for

  const totalSteps = (runEcom ? 1 : 0) + (runSocial ? 1 : 0) + (runCompetitors ? 1 : 0) + (runReddit ? 1 : 0) + 1;
  let stepIdx = 1;
  const stepEcom = runEcom ? stepIdx++ : null;
  const stepMeta = runSocial ? stepIdx++ : null;
  const stepCompetitors = runCompetitors ? stepIdx++ : null;
  const stepReddit = runReddit ? stepIdx++ : null;
  const analyzeStep = stepIdx;
  const socialTitle = socialStepTitle(socialSource);

  try {
    let payload: Record<string, unknown> = { scope: "social" };
    let meta: Record<string, unknown> = {};

    // ── Step: Ecom audit (only when a product URL is given) ──────────────────
    if (runEcom && stepEcom) {
      yield {
        status: stepBanner(stepEcom, totalSteps, "AI e-commerce audit", "Scraping product and competitors…") + "\n\n" + progressBar(5),
        phase: "scraping",
      };

      const auditId = await startAsyncAudit(url);
      let auditPayload: Record<string, unknown> | null = null;

      while (true) {
        const row = await pollAsyncAudit(auditId);
        const pct = Number(row.progress ?? 0);
        const msg = String(row.message ?? "Working…");
        const barPct = Math.max(5, Math.min(55, Math.floor(pct * 0.55)));
        yield {
          status: stepBanner(stepEcom, totalSteps, "AI e-commerce audit", msg) + "\n\n" + progressBar(barPct),
          phase: "scraping",
        };
        if (row.error) throw new EcomScraperError(String(row.error));
        if (row.result) {
          const resultBody = row.result;
          auditPayload = { ...((resultBody.payload as Record<string, unknown>) ?? {}) };
          meta = (resultBody.meta as Record<string, unknown>) ?? {};
          break;
        }
        await new Promise(r => setTimeout(r, 1500));
      }

      if (!auditPayload) throw new EcomScraperError("Audit finished without payload");
      payload = auditPayload;
    }

    let socialWarning: string | null = null;
    let redditWarning: string | null = null;
    let competitorSocial: CompetitorSocial[] = [];

    // ── Kick off competitor scraping CONCURRENTLY with the target's own scrape ──
    // Previously the target Meta scrape and each competitor's Meta scrape ran as separate
    // SEQUENTIAL steps, so a 2-brand run (you vs Amazon) paid ~2× the scrape wall-time and
    // blew the 800s budget. Starting the competitor promise here lets both brands scrape in
    // parallel — total wall-clock ≈ the single slowest scrape, not the sum.
    const maxPosts = parseInt(process.env.COMPETITOR_MAX_POSTS ?? "10", 10) || 10;
    const competitorTargets = (runCompetitors && stepCompetitors)
      ? manualCompetitors.map(c => ({
          brand: c.brand, why: "Provided by you",
          instagramHandle: c.instagramHandle || undefined,
          metaAdLibraryUrl: c.metaAdLibraryUrl || undefined,
          adKeyword: c.adKeyword || undefined,
          googleAdsUrl: c.googleAdsUrl || undefined,
          linkedInUrl: c.linkedInUrl || undefined,
        }))
      : [];
    let competitorPromise: Promise<PromiseSettledResult<CompetitorSocial | null>[]> | null = null;
    if (competitorTargets.length) {
      const ctx = productContextFrom(payload);
      competitorPromise = Promise.allSettled(
        competitorTargets.map(t => fetchCompetitorSocial(
          { brand: t.brand, category: ctx.category, productTitle: ctx.productTitle, why: t.why, instagramHandle: t.instagramHandle, metaAdLibraryUrl: t.metaAdLibraryUrl, adKeyword: t.adKeyword, googleAdsUrl: t.googleAdsUrl },
          { maxPosts, googleAds: { include: runGoogleAds, mode: googleAdsMode } },
        )),
      );
    }

    // ── Step: Social (Instagram + paid ads) ──────────────────────────────────
    if (runSocial && stepMeta) {
      const resolved = resolveSocialSource(socialSource) ?? "graph";
      const fetchDetail = resolved === "public"
        ? "Scraping public Instagram & Facebook (Apify) + Meta Ad Library for paid ads…"
        : "Fetching Page/IG posts (Meta Graph) + paid ads from Ad Library…";
      yield {
        status: stepBanner(stepMeta, totalSteps, socialTitle, fetchDetail) + "\n\n" + progressBar(65),
        phase: "social",
      };
      socialWarning = await mergeMetaSocial(payload, url, socialSource, instagramHandle, adLibraryUrl, googleAdsOpts);
      yield {
        status: stepBanner(stepMeta, totalSteps, socialTitle, socialWarning ?? "Social posts and paid ads merged into analysis.") + "\n\n" + progressBar(75),
        phase: "social",
      };
    }

    // ── Step: Competitor social — await the scrape kicked off in PARALLEL above ──
    if (runCompetitors && stepCompetitors && competitorPromise) {
      yield {
        status: stepBanner(stepCompetitors, totalSteps, "Competitor intelligence", `Collecting Instagram + Meta ads for your ${competitorTargets.length} competitor(s): ${competitorTargets.map(t => t.brand).join(", ")} (scraped in parallel with your brand)…`) + "\n\n" + progressBar(82),
        phase: "competitors",
      };
      // Promise.allSettled never rejects, so nothing here fails silently — each competitor
      // that errored is reported in the count below instead of vanishing.
      const settled = await competitorPromise;
      competitorSocial = settled
        .filter((s): s is PromiseFulfilledResult<CompetitorSocial> => s.status === "fulfilled" && s.value !== null)
        .map(s => s.value);
      const failed = settled.length - competitorSocial.length;
      settled.forEach((s, i) => {
        if (s.status === "rejected") console.error(`[pipeline] competitor "${competitorTargets[i]?.brand}" scrape failed: ${s.reason}`);
      });
      const totalPosts = competitorSocial.reduce((n, c) => n + c.postCount, 0);
      const totalAds = competitorSocial.reduce((n, c) => n + c.adCount, 0);
      const failNote = failed > 0 ? ` · ⚠ ${failed} competitor(s) failed to scrape` : "";
      yield {
        status: stepBanner(stepCompetitors, totalSteps, "Competitor intelligence", `${competitorSocial.length} competitor(s) · ${totalPosts} posts · ${totalAds} ads collected${failNote}.`) + "\n\n" + progressBar(86),
        phase: "competitors",
      };
    }

    // ── Step: LinkedIn company posts (organic) ───────────────────────────────
    // Isolated from meta-social: scrape you + each competitor's LinkedIn page and attach
    // the raw posts to the snapshot / competitor records. Gated by the includeLinkedIn
    // toggle or LINKEDIN_ENABLED env. Never throws (fetchLinkedInPosts returns []).
    const runLinkedIn = includeLinkedIn || process.env.LINKEDIN_ENABLED === "true";
    if (runLinkedIn) {
      yield { status: "### LinkedIn presence\n\nCollecting organic LinkedIn company posts for you + competitors…\n\n" + progressBar(87), phase: "competitors" };
      // Target uses the pasted company URL when given (precise); competitors resolve by brand name.
      const queries: { key: string; q: string }[] = [];
      if (brandName.trim()) queries.push({ key: brandName.trim(), q: linkedInUrl.trim() || brandName.trim() });
      // Per-competitor LinkedIn URL override (from the competitor cards), else resolve by name.
      const compLi = new Map(competitorTargets.map(t => [t.brand, t.linkedInUrl]));
      for (const c of competitorSocial) { const b = (c.brand || "").trim(); if (b && !queries.some(x => x.key === b)) queries.push({ key: b, q: (compLi.get(b) || "").trim() || b }); }
      const results = await Promise.allSettled(queries.map(x => fetchLinkedInPosts(x.q)));
      const byBrand = new Map<string, Record<string, unknown>[]>();
      queries.forEach((x, i) => { const r = results[i]; if (r.status === "fulfilled" && r.value.length) byBrand.set(x.key, r.value); });
      const soc = (payload as Record<string, unknown>).social as Record<string, unknown> | undefined;
      if (soc && brandName.trim() && byBrand.has(brandName.trim())) soc.linkedInPosts = byBrand.get(brandName.trim());
      for (const c of competitorSocial) { const p = byBrand.get((c.brand || "").trim()); if (p) (c as Record<string, unknown>).linkedInPosts = p; }
      const total = [...byBrand.values()].reduce((n, a) => n + a.length, 0);
      yield { status: `### LinkedIn presence\n\n${byBrand.size} page(s) · ${total} organic posts collected.\n\n` + progressBar(89), phase: "competitors" };
    }

    // ── Step: Reddit reviews ─────────────────────────────────────────────────
    if (runReddit && stepReddit) {
      yield {
        status: stepBanner(stepReddit, totalSteps, "Reddit reviews", "Searching Reddit for posts and comments about this product…") + "\n\n" + progressBar(72),
        phase: "reddit",
      };
      redditWarning = await mergeRedditReviews(payload, url);
      yield {
        status: stepBanner(stepReddit, totalSteps, "Reddit reviews", redditWarning ?? "Reddit discussions merged into analysis.") + "\n\n" + progressBar(80),
        phase: "reddit",
      };
    }

    yield {
      status: stepBanner(analyzeStep, totalSteps, "Strategic analysis", "Building evidence-backed insights…") + "\n\n" + progressBar(90),
      phase: "analyzing",
    };

    const data = CombinedScraperDataSchema.parse(payload);
    const analysis = await analyzeScraperInsights(data, { useLlm });
    if (competitorSocial.length) analysis.competitorSocial = competitorSocial;
    // Surface the user's label + competitors-only choice so the report tabs can name the
    // brand (instead of the generic "You") and exclude it when requested. Read via cast by
    // the tabs (result.brandName / result.competitorsOnly).
    const a = analysis as Record<string, unknown>;
    if (brandName.trim()) a.brandName = brandName.trim();
    a.competitorsOnly = competitorsOnly;
    const saved = await persistRun(meta, payload, analysis);

    let elapsed = "";
    if (meta.asin) elapsed += `\n\n_Product: **${meta.asin}** · domain \`${meta.amazonDomain ?? "—"}\`_`;
    if (socialWarning) elapsed += `\n\n_Meta social note: ${socialWarning}_`;
    if (redditWarning) elapsed += `\n\n_Reddit note: ${redditWarning}_`;
    // Surface a failed save instead of letting the run vanish from history silently.
    if (!saved) elapsed += `\n\n_⚠ **Analysis completed but could NOT be saved to history** — the dataset was likely too large for the database. It won't appear under History; download the raw data now if you need it._`;

    yield {
      status: stepBanner(totalSteps, totalSteps, "Complete", "Your intelligence brief is ready.") + elapsed + "\n\n---\n\n" + formatBrief(analysis),
      phase: "done",
      result: analysis,
    };
  } catch (err) {
    if (err instanceof EcomScraperUnavailable) {
      yield { status: `## Scraper unavailable\n\n${err.message}`, phase: "error" };
    } else if (err instanceof EcomScraperError) {
      yield { status: `## Audit failed\n\n${err.message}`, phase: "error" };
    } else if (err instanceof MetaSocialError) {
      yield { status: `## Meta social failed\n\n${err.message}`, phase: "error" };
    } else if (err instanceof RedditReviewsError) {
      yield { status: `## Reddit reviews failed\n\n${err.message}`, phase: "error" };
    } else {
      yield { status: `## Something went wrong\n\n${cleanUserError(err)}`, phase: "error" };
    }
  }
}
