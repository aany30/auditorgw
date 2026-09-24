/**
 * Google Ads Transparency Center fetch layer (Apify).
 *
 * Thin fetch+map layer mirroring the Meta ad-fetch section of meta-social.ts.
 * Reuses runApifyActor + getApifyToken from meta-social.ts. Enrichment
 * (enrichPaidAd + attachAdAnalyses) is delegated to callers, exactly like the
 * Meta path — this module never enriches or throws.
 *
 * Two actors, selected by mode:
 *  - "fast": automation-lab/google-ads-scraper — search by brand name / domain.
 *  - "rich": scrapers-hub/google-ads-transparency-scraper — needs the advertiser's
 *            Transparency Center URL; falls back to Fast when no URL is supplied.
 */

import { getApifyToken, runApifyActor } from "./meta-social";
import type { SocialPaidAdLike } from "./paid-ad-mapper";
import { mapGoogleFastItem, mapGoogleRichItem, sortGoogleItemsByFirstShown, dedupeGoogleAds } from "./google-ad-mapper";

const GOOGLE_ADS_SCRAPE_MAX = parseInt(process.env.GOOGLE_ADS_SCRAPE_MAX ?? "1000", 10) || 1000;
const GOOGLE_ADS_WAIT_SECS = parseInt(process.env.GOOGLE_ADS_WAIT_SECS ?? "180", 10) || 180;
const GOOGLE_ADS_ACTOR_MEMORY = parseInt(process.env.GOOGLE_ADS_ACTOR_MEMORY ?? "2048", 10) || 2048;
// Default: scrape ALL countries (region omitted → the actor returns ads across every
// region, so the region breakdown is meaningful). Set GOOGLE_ADS_REGION to an ISO code
// to restrict to one country. "" / "ALL" / "GLOBAL" all mean all-countries.
const GOOGLE_ADS_REGION_RAW = (process.env.GOOGLE_ADS_REGION ?? "").trim().toUpperCase();
const GOOGLE_ADS_REGION = ["", "ALL", "GLOBAL", "WW"].includes(GOOGLE_ADS_REGION_RAW) ? undefined : GOOGLE_ADS_REGION_RAW;

const FAST_ACTOR = "automation-lab/google-ads-scraper";
const RICH_ACTOR = "scrapers-hub/google-ads-transparency-scraper";

export type GoogleAdsMode = "fast" | "rich";

export interface GoogleAdsFetchResult {
  ads: SocialPaidAdLike[];
  fetchError?: string;
}

/** Feature gate — mirrors META_ADS_ENABLED semantics. */
export function googleAdsEnabled(): boolean {
  const raw = (process.env.GOOGLE_ADS_ENABLED ?? "true").toLowerCase();
  return !["0", "false", "no"].includes(raw);
}

/** Fast actor: search the Transparency Center by advertiser name (or domains/ids). */
async function fetchGoogleAdsFast(
  token: string,
  brand: string,
  opts: { domains?: string[]; advertiserIds?: string[]; region?: string; maxAds: number },
): Promise<SocialPaidAdLike[]> {
  const input: Record<string, unknown> = { maxAds: opts.maxAds };
  // Omit region entirely to scrape ALL countries (the actor returns ads across every region).
  if (opts.region) input.region = opts.region;
  if (opts.advertiserIds?.length) input.advertiserIds = opts.advertiserIds;
  else if (opts.domains?.length) input.domains = opts.domains;
  else input.searchTerms = [brand];

  console.log(`[ads] Searching Google Ads Transparency (fast) for: "${brand}" (region: ${opts.region ?? "ALL"})`);
  const items = await runApifyActor(token, FAST_ACTOR, input, GOOGLE_ADS_WAIT_SECS, GOOGLE_ADS_ACTOR_MEMORY);
  const mapped = sortGoogleItemsByFirstShown(items)
    .map(item => mapGoogleFastItem(item, { matchPrefix: "via Transparency" }))
    .filter((ad): ad is SocialPaidAdLike => ad !== null);
  return dedupeGoogleAds(mapped).slice(0, opts.maxAds);
}

/** Rich actor: scrape an advertiser's Transparency Center URL (has ad copy + CTA). */
async function fetchGoogleAdsRich(
  token: string,
  transparencyUrl: string,
  opts: { maxAds: number },
): Promise<SocialPaidAdLike[]> {
  console.log(`[ads] Scraping Google Ads Transparency (rich) URL: ${transparencyUrl}`);
  const items = await runApifyActor(
    token,
    RICH_ACTOR,
    { startUrls: [{ url: transparencyUrl }], maxAds: opts.maxAds },
    GOOGLE_ADS_WAIT_SECS,
    GOOGLE_ADS_ACTOR_MEMORY,
  );
  const mapped = sortGoogleItemsByFirstShown(items)
    .map(item => mapGoogleRichItem(item, { matchPrefix: "via Transparency" }))
    .filter((ad): ad is SocialPaidAdLike => ad !== null);
  return dedupeGoogleAds(mapped).slice(0, opts.maxAds);
}

const TRANSPARENCY_URL_RE = /adstransparency\.google\.com|google\.com\/ads\/transparency/i;

/** Pull the advertiser id (AR…), region, domain and query out of a Google Ads Transparency URL. */
function parseTransparencyUrl(url: string): { advertiserId?: string; region?: string; domain?: string; query?: string } {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/advertiser\/(AR[0-9]+)/i);
    const region = u.searchParams.get("region") || undefined;
    // A `?domain=brand.com` or `?query=/?q=` Transparency URL scopes to a specific advertiser
    // domain / search — far more precise than a bare brand-name search.
    const domain = u.searchParams.get("domain") || undefined;
    const query = u.searchParams.get("query") || u.searchParams.get("q") || undefined;
    return { advertiserId: m?.[1], region: region ? region.toUpperCase() : undefined, domain: domain || undefined, query: query || undefined };
  } catch {
    return {};
  }
}

/** The Rich actor is a paid rental — this is its "trial expired / not rented" 403. */
function isActorRentalError(err: unknown): boolean {
  return /actor-is-not-rented|must rent a paid Actor|402|403/i.test(String(err));
}

/**
 * Single entry point (parallels fetchMetaAdsLibrary). Never throws — returns
 * { ads, fetchError }. Rich mode uses the paid Transparency actor; if that actor
 * isn't rented (or returns nothing), it degrades to the FREE Fast actor targeted by
 * the advertiser id parsed from the URL (precise, but no ad copy/CTA). With no URL,
 * Rich falls back to a Fast brand-name search.
 */
export async function fetchGoogleAds(
  brandCtx: { brand: string; domains?: string[]; googleAdsUrl?: string },
  mode: GoogleAdsMode,
): Promise<GoogleAdsFetchResult> {
  if (!googleAdsEnabled()) {
    return { ads: [], fetchError: "Google ads are disabled (GOOGLE_ADS_ENABLED=false)." };
  }
  const token = getApifyToken();
  if (!token) {
    return { ads: [], fetchError: "APIFY_API_TOKEN (or SR_APIFY_TOKEN) is not set — Google ads cannot be fetched." };
  }
  const brand = (brandCtx.brand ?? "").trim();
  const url = (brandCtx.googleAdsUrl ?? "").trim();
  const maxAds = GOOGLE_ADS_SCRAPE_MAX;
  const parsed = url ? parseTransparencyUrl(url) : {};

  try {
    if (mode === "rich" && TRANSPARENCY_URL_RE.test(url)) {
      const { advertiserId } = parsed;
      let richNote = "";
      // 1) Try the paid Rich actor (ad copy + CTA) — only works when the actor is rented.
      try {
        const ads = await fetchGoogleAdsRich(token, url, { maxAds });
        if (ads.length) {
          console.log(`[ads] Google (rich) → ${ads.length} ads for ${brand || url}`);
          return { ads };
        }
        richNote = "The Rich actor returned no ads — ";
      } catch (e) {
        if (!isActorRentalError(e)) throw e;
        console.warn("[ads] Rich Google actor not rented — falling back to the free advertiser-id search.");
        richNote = "Rich actor not rented — ";
      }
      // 2) Free fallback: Fast actor targeted by the advertiser id from the URL.
      if (advertiserId) {
        const ads = await fetchGoogleAdsFast(token, brand, {
          advertiserIds: [advertiserId],
          region: parsed.region ?? GOOGLE_ADS_REGION,
          maxAds,
        });
        console.log(`[ads] Google (fast by advertiserId ${advertiserId}) → ${ads.length} ads`);
        return {
          ads,
          fetchError: ads.length === 0
            ? `${richNote}no ads found for advertiser ${advertiserId} (${GOOGLE_ADS_REGION ?? "all countries"}).`
            : `${richNote}used the free advertiser-id search (no ad copy/CTA).`,
        };
      }
      // No advertiser id in the URL — fall through to a Fast brand search below.
    }

    // Fast path — prefer a domain from the URL (precise) over a bare brand-name search.
    const domains = brandCtx.domains?.length ? brandCtx.domains : (parsed.domain ? [parsed.domain] : undefined);
    const region = parsed.region ?? GOOGLE_ADS_REGION;
    if (!brand && !domains?.length && !parsed.query) {
      return { ads: [], fetchError: "No brand or domain to search Google Ads Transparency." };
    }
    const ads = await fetchGoogleAdsFast(token, parsed.query || brand, { domains, region, maxAds });
    console.log(`[ads] Google (fast) → ${ads.length} ads for ${domains?.join(",") || parsed.query || brand}`);
    const fallbackNote = mode === "rich" && !parsed.advertiserId && !domains?.length
      ? "Rich URL missing/invalid — used Fast brand search (no ad copy/CTA). "
      : "";
    return {
      ads,
      fetchError: ads.length === 0
        ? `${fallbackNote}No Google ads found for "${brand}" (${GOOGLE_ADS_REGION ?? "all countries"}).`
        : (fallbackNote || undefined),
    };
  } catch (err) {
    const msg = String(err);
    console.warn(`[ads] Google Ads fetch failed: ${msg}`);
    return { ads: [], fetchError: msg };
  }
}
