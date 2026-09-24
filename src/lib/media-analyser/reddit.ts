import type {
  CombinedScraperData,
  RawRedditItem,
  RedditReviewItem,
  RedditSnapshot,
  SourceCounts,
  ProductContext,
} from "./types";
import { productContextFromPayload } from "./product-match";
import { getApifyToken } from "./meta-social";
import { GEMINI_ROLLING_ALIAS, normalizeGeminiModel } from "./gemini-models";

export class RedditReviewsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedditReviewsError";
  }
}

const REDDIT_USER_AGENT = "ecom-analytics-agent/1.0 (product research)";
const REDDIT_SEARCH = "https://www.reddit.com/search.json";
const PULLPUSH_SEARCH = "https://api.pullpush.io/reddit/search/submission/";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface RedditConfig {
  enabled: boolean;
  maxPosts: number;
  maxCommentsPerPost: number;
  maxPostsWithComments: number;
  useApify: boolean;
  apifyToken: string;
  waitSecs: number;
}

function loadRedditConfig(): RedditConfig {
  const enabled = (process.env.REDDIT_REVIEWS_ENABLED ?? "true").toLowerCase();
  const isEnabled = !["0", "false", "no"].includes(enabled);
  const maxPosts = Math.max(5, parseInt(process.env.REDDIT_MAX_POSTS ?? "25", 10) || 25);
  const maxComments = Math.max(3, parseInt(process.env.REDDIT_MAX_COMMENTS_PER_POST ?? "12", 10) || 12);
  const maxWithComments = Math.max(3, parseInt(process.env.REDDIT_MAX_POSTS_WITH_COMMENTS ?? "8", 10) || 8);
  const apifyToken = getApifyToken();
  const useApifyEnv = (process.env.REDDIT_USE_APIFY ?? "").toLowerCase();
  let useApify: boolean;
  if (["1", "true", "yes"].includes(useApifyEnv)) useApify = true;
  else if (["0", "false", "no"].includes(useApifyEnv)) useApify = false;
  else useApify = Boolean(apifyToken);
  const wait = Math.max(60, parseInt(process.env.REDDIT_APIFY_WAIT_SECS ?? "120", 10) || 120);
  return {
    enabled: isEnabled,
    maxPosts,
    maxCommentsPerPost: maxComments,
    maxPostsWithComments: maxWithComments,
    useApify: useApify && Boolean(apifyToken),
    apifyToken: useApify ? apifyToken : "",
    waitSecs: wait,
  };
}

export function isRedditReviewsEnabled(): boolean {
  return loadRedditConfig().enabled;
}

function searchQueriesForProduct(brand: string, title: string): string[] {
  const titleShort = title.split(/\s+/).slice(0, 6).join(" ");
  const titleCore = title.split(/\s+/).slice(0, 4).join(" ");
  const queries: string[] = [];
  const seen = new Set<string>();
  const add = (q: string) => {
    q = q.trim();
    if (!q || seen.has(q.toLowerCase())) return;
    seen.add(q.toLowerCase());
    queries.push(q);
  };
  if (brand && titleShort) {
    add(`${brand} ${titleShort} review`);
    add(`${brand} ${titleCore}`);
    add(`${brand} ${titleShort}`);
  }
  if (titleShort) {
    add(`${titleShort} review`);
    add(titleShort);
  }
  if (brand) {
    add(`${brand} review`);
    add(brand);
  }
  return queries.slice(0, 5);
}

async function httpGetJson(url: string, userAgent: string, timeoutMs = 30000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent, "Accept": "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 2000));
      const res2 = await fetch(url, { headers: { "User-Agent": userAgent, "Accept": "application/json" } });
      return res2.json();
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchRedditPullpush(query: string, limit = 25): Promise<RawRedditItem[]> {
  const params = new URLSearchParams({ q: query, size: String(Math.min(limit, 100)), sort: "desc" });
  try {
    const data = await httpGetJson(`${PULLPUSH_SEARCH}?${params}`, BROWSER_UA, 18000) as unknown;
    const rows = Array.isArray(data) ? data : (data as Record<string, unknown>)?.data;
    if (!Array.isArray(rows)) return [];
    return rows.filter(d => typeof d === "object" && d !== null && (d as Record<string, unknown>).title).slice(0, limit).map(d => {
      const r = d as Record<string, unknown>;
      const pid = String(r.id ?? r.name ?? "").replace("t3_", "");
      const permalink = String(r.permalink ?? "");
      const url = permalink.startsWith("/") ? `https://www.reddit.com${permalink}` : permalink || `https://www.reddit.com/comments/${pid}/`;
      return { post_id: pid || String(r.title ?? "").slice(0, 24), subreddit: String(r.subreddit ?? ""), title: String(r.title ?? ""), body: String(r.selftext ?? r.body ?? ""), url, score: parseInt(String(r.score ?? 0), 10), num_comments: parseInt(String(r.num_comments ?? 0), 10), created_utc: parseFloat(String(r.created_utc ?? 0)) || null, kind: "post" };
    });
  } catch {
    return [];
  }
}

async function searchRedditPublic(query: string, limit = 25): Promise<RawRedditItem[]> {
  const params = new URLSearchParams({ q: query, sort: "relevance", limit: String(Math.min(limit, 100)), type: "link" });
  try {
    const data = await httpGetJson(`${REDDIT_SEARCH}?${params}`, REDDIT_USER_AGENT) as Record<string, unknown>;
    const children = (((data?.data as Record<string, unknown>)?.children) as Array<Record<string, unknown>>) ?? [];
    return children.filter(c => (c.data as Record<string, unknown>)?.title).map(c => {
      const d = c.data as Record<string, unknown>;
      const name = String(d.name ?? d.id ?? "");
      const pid = name.startsWith("t3_") ? name.slice(3) : name;
      const permalink = String(d.permalink ?? "");
      const url = permalink.startsWith("/") ? `https://www.reddit.com${permalink}` : permalink || `https://www.reddit.com/comments/${pid}/`;
      return { post_id: pid, subreddit: String(d.subreddit ?? ""), title: String(d.title ?? ""), body: String(d.selftext ?? ""), url, score: parseInt(String(d.score ?? 0), 10), num_comments: parseInt(String(d.num_comments ?? 0), 10), created_utc: parseFloat(String(d.created_utc ?? 0)) || null, kind: "post" };
    });
  } catch {
    return [];
  }
}

async function fetchPostComments(postId: string, limit = 12): Promise<RawRedditItem[]> {
  if (!postId) return [];
  try {
    const url = `https://www.reddit.com/comments/${postId}.json?limit=${limit}&sort=top`;
    const data = await httpGetJson(url, REDDIT_USER_AGENT) as unknown[];
    if (!Array.isArray(data) || data.length < 2) return [];
    const listing = ((data[1] as Record<string, unknown>)?.data as Record<string, unknown>)?.children as Array<Record<string, unknown>> ?? [];
    return listing.filter(c => {
      const body = String((c.data as Record<string, unknown>)?.body ?? "").trim();
      return body && body !== "[deleted]" && body !== "[removed]";
    }).slice(0, limit).map(c => {
      const d = c.data as Record<string, unknown>;
      const name = String(d.name ?? "");
      const cid = name.startsWith("t3_") ? name.slice(3) : name;
      return { post_id: cid, subreddit: String(d.subreddit ?? ""), title: "", body: String(d.body ?? "").slice(0, 500), url: `https://www.reddit.com/comments/${postId}/_/${cid}/`, score: parseInt(String(d.score ?? 0), 10), num_comments: 0, kind: "comment", parent_post_id: postId };
    });
  } catch {
    return [];
  }
}

async function fetchViaApify(queries: string[], config: RedditConfig): Promise<RawRedditItem[]> {
  if (!config.apifyToken || !queries.length) return [];
  const searchUrls = queries.slice(0, 2).map(q => ({ url: `https://www.reddit.com/search/?q=${encodeURIComponent(q)}&type=link` }));
  const actorInput = {
    searches: queries.slice(0, 3),
    maxItems: config.maxPosts,
    searchPosts: true,
    searchComments: false,
    sort: "relevance",
    startUrls: searchUrls,
    proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
  };
  try {
    const apifyHeaders = { "Content-Type": "application/json", "Authorization": `Bearer ${config.apifyToken}` };
    const runUrl = `https://api.apify.com/v2/acts/trudax~reddit-scraper-lite/runs?memory=256&waitForFinish=${Math.min(config.waitSecs, 300)}`;
    const res = await fetch(runUrl, { method: "POST", headers: apifyHeaders, body: JSON.stringify(actorInput) });
    if (!res.ok) return [];
    const runData = await res.json() as Record<string, unknown>;
    const run = (runData.data as Record<string, unknown> | undefined) ?? {};
    const runId = run.id as string | undefined;
    const datasetId = run.defaultDatasetId as string | undefined;
    if (!runId) return [];
    const itemsUrl = datasetId
      ? `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&clean=true`
      : `https://api.apify.com/v2/actor-runs/${runId}/dataset/items`;
    const dataRes = await fetch(itemsUrl, { headers: { "Authorization": `Bearer ${config.apifyToken}` } });
    if (!dataRes.ok) return [];
    const items = await dataRes.json() as Record<string, unknown>[];
    return items.filter(i => typeof i === "object").map(item => {
      const title = String(item.title ?? "");
      const body = String(item.body ?? item.text ?? item.selftext ?? "");
      if (!title && !body) return null;
      const rawId = String(item.parsedId ?? item.id ?? item.postId ?? "");
      const pid = rawId.replace("t3_", "").trim() || title.slice(0, 24);
      let url = String(item.url ?? item.permalink ?? "");
      if (url.startsWith("/")) url = `https://www.reddit.com${url}`;
      const community = String(item.subreddit ?? item.communityName ?? "").replace(/^r\//, "");
      return { post_id: pid, subreddit: community, title, body, url: url || `https://www.reddit.com/search/?q=${encodeURIComponent(title.slice(0, 40))}`, score: parseInt(String(item.upVotes ?? item.score ?? item.upvotes ?? 0), 10), num_comments: parseInt(String(item.numberOfComments ?? item.num_comments ?? item.comments ?? 0), 10), kind: "post" } as RawRedditItem;
    }).filter((i): i is RawRedditItem => i !== null);
  } catch {
    return [];
  }
}

async function fetchRedditItems(brand: string, title: string, config: RedditConfig): Promise<RawRedditItem[]> {
  const queries = searchQueriesForProduct(brand, title);
  const seen = new Set<string>();
  const items: RawRedditItem[] = [];

  if (config.useApify) {
    for (const raw of await fetchViaApify(queries, config)) {
      const key = raw.post_id || raw.url;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(raw);
      if (items.length >= config.maxPosts) return items;
    }
  }

  for (const q of queries) {
    let found = await searchRedditPullpush(q, config.maxPosts);
    if (!found.length) found = await searchRedditPublic(q, config.maxPosts);
    for (const raw of found) {
      const key = raw.post_id || raw.url;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(raw);
    }
    if (items.length >= config.maxPosts) break;
    await new Promise(r => setTimeout(r, 500));
  }
  return items.slice(0, config.maxPosts);
}

async function enrichWithComments(posts: RawRedditItem[], config: RedditConfig): Promise<RawRedditItem[]> {
  const ranked = [...posts].sort((a, b) => b.score - a.score);
  const extra: RawRedditItem[] = [];
  for (const post of ranked.slice(0, config.maxPostsWithComments)) {
    if (post.kind !== "post") continue;
    const comments = await fetchPostComments(post.post_id, config.maxCommentsPerPost);
    for (const c of comments) {
      if (!c.subreddit) c.subreddit = post.subreddit;
    }
    extra.push(...comments);
    await new Promise(r => setTimeout(r, 800));
  }
  return [...posts, ...extra];
}

function ruleSentiment(text: string): string {
  const t = text.toLowerCase();
  const negWords = ["bad", "worst", "waste", "don't buy", "do not buy", "irritat", "breakout", "fake", "scam", "overpriced"];
  const posWords = ["love", "best", "recommend", "holy grail", "repurchase", "worth it", "amazing", "great", "works"];
  const n = negWords.filter(w => t.includes(w)).length;
  const p = posWords.filter(w => t.includes(w)).length;
  if (p > n && p >= 2) return "positive";
  if (n > p && n >= 2) return "negative";
  if (p && n) return "mixed";
  return "neutral";
}

function filterProductPosts(items: RawRedditItem[], ctx: ProductContext, minScore = 0.25): Array<[RawRedditItem, string, number]> {
  const STOP_WORDS = new Set(["with", "for", "and", "the", "from", "new", "buy", "online", "pack", "set", "ml", "gm", "oz", "free", "off", "offers"]);
  const keywords = new Set(
    `${ctx.title} ${ctx.brand} ${ctx.category}`.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter(w => !STOP_WORDS.has(w)) ?? []
  );

  const matched: Array<[RawRedditItem, string, number]> = [];
  for (const item of items) {
    const blob = `${item.title} ${item.body} ${item.url}`.toLowerCase();

    if (ctx.asin_or_id && blob.includes(ctx.asin_or_id.toLowerCase())) {
      matched.push([item, "asin_match", 1.0]);
      continue;
    }

    if (keywords.size === 0) continue;
    const hits = [...keywords].filter(k => blob.includes(k)).length;
    const ratio = hits / Math.max(keywords.size, 1);
    const titleTokens = (ctx.title.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(w => !STOP_WORDS.has(w));
    const titleHits = titleTokens.slice(0, 6).filter(w => blob.includes(w)).length;
    if (titleTokens.length && titleHits >= Math.max(2, Math.floor(titleTokens.length / 2))) {
      if (0.85 >= minScore) matched.push([item, "title_keywords", 0.85]);
    } else if (ratio >= 0.35 && hits >= 3 && Math.min(0.9, ratio) >= minScore) {
      matched.push([item, "keywords", Math.min(0.9, ratio)]);
    }
  }
  return matched;
}

async function analyzeRedditReviews(reviews: RedditReviewItem[], ctx: ProductContext): Promise<string> {
  if (!reviews.length) return "";
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) {
    const pos = reviews.filter(r => r.sentiment === "positive").length;
    const neg = reviews.filter(r => r.sentiment === "negative").length;
    return `**${reviews.length}** Reddit posts/comments mention this product (${pos} positive-leaning, ${neg} negative-leaning by keyword rules).`;
  }

  const sample = reviews.slice(0, 20).map(r => ({
    subreddit: r.subreddit, kind: r.kind, sentiment: r.sentiment, score: r.score,
    text: `${r.title} ${r.body}`.slice(0, 350),
  }));
  const prompt = `Analyze Reddit discussions about "${ctx.title}" (brand: ${ctx.brand}).
Posts/comments JSON: ${JSON.stringify(sample)}
Return JSON: {"headline":"one line","whatPeopleLike":["bullets"],"whatPeopleDislike":["bullets"],"commonQuestions":["bullets"],"recommendationsForBrand":["2-3 actions"]}`;

  try {
    const model = normalizeGeminiModel(process.env.GEMINI_TEXT_MODEL ?? GEMINI_ROLLING_ALIAS);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 1024, responseMimeType: "application/json" } }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    const candidates = (data.candidates as Array<Record<string, unknown>> | undefined) ?? [];
    const parts = (((candidates[0]?.content as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined) ?? []);
    const raw = String(parts[0]?.text ?? "").replace(/```[a-z]*\n?/g, "").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const lines = [`**${parsed.headline ?? "Reddit voice-of-customer"}**`, ""];
    for (const [key2, label] of [["whatPeopleLike", "What people like"], ["whatPeopleDislike", "Pain points & complaints"], ["commonQuestions", "Common questions"], ["recommendationsForBrand", "Implications for listing & positioning"]] as [string, string][]) {
      const vals = (parsed[key2] as string[] | undefined) ?? [];
      if (vals.length) { lines.push(`- **${label}:**`); lines.push(...vals.slice(0, 5).map(v => `  - ${v}`)); }
    }
    return lines.join("\n");
  } catch {
    const pos = reviews.filter(r => r.sentiment === "positive").length;
    const neg = reviews.filter(r => r.sentiment === "negative").length;
    return `**${reviews.length}** Reddit posts/comments mention this product (${pos} positive-leaning, ${neg} negative-leaning).`;
  }
}

export async function fetchProductRedditReviews(
  productUrl: string,
  ecomPayload: CombinedScraperData
): Promise<[RedditSnapshot | null, SourceCounts | null, string | null]> {
  if (!isRedditReviewsEnabled()) return [null, null, null];

  const config = loadRedditConfig();
  const ctx = productContextFromPayload(productUrl, ecomPayload);
  const brand = ctx.brand || ctx.title.split(/\s+/)[0] || "";
  const title = ctx.title;

  if (!brand && !title) return [null, null, "Could not infer brand/title for Reddit search."];

  try {
    const queries = searchQueriesForProduct(brand, title);
    const rawPosts = await fetchRedditItems(brand, title, config);

    if (!rawPosts.length) {
      const hasApify = Boolean(getApifyToken());
      const brief = "No Reddit posts found for this product search. " + (
        !hasApify
          ? "Reddit blocks direct access from this server — add APIFY_API_TOKEN to .env and restart."
          : "Apify is configured but returned no results — try a shorter brand name or check Apify credits."
      );
      return [{ searchQueries: queries, totalFetchedCount: 0, matchedCount: 0, analysisBrief: brief, reviews: [], bySentiment: [], postCount: 0, commentCount: 0, avgScore: null }, { ecomProjects: 0, ecomCompetitors: 0, ecomCompetitorsAnalyzed: 0, socialPosts: 0, socialMetrics: 0, redditReviews: 0, competitorRuns: 0 }, "No Reddit results for product search queries."];
    }

    const enriched = await enrichWithComments(rawPosts, config);
    let matchedTuples = filterProductPosts(enriched, ctx);

    if (!matchedTuples.length && brand) {
      const brandL = brand.toLowerCase();
      const brandMatches: typeof matchedTuples = [];
      for (const item of enriched) {
        const blob = `${item.title} ${item.body}`.toLowerCase();
        if (blob.includes(brandL) && blob.length > 20) {
          brandMatches.push([item, "brand_mention", 0.5]);
        }
        if (brandMatches.length >= 12) break;
      }
      matchedTuples = brandMatches;
    }

    if (!matchedTuples.length) {
      return [{ searchQueries: queries, totalFetchedCount: enriched.length, matchedCount: 0, analysisBrief: "Reddit posts were fetched but none clearly matched this product URL/title.", reviews: [], bySentiment: [], postCount: 0, commentCount: 0, avgScore: null }, { ecomProjects: 0, ecomCompetitors: 0, ecomCompetitorsAnalyzed: 0, socialPosts: 0, socialMetrics: 0, redditReviews: 0, competitorRuns: 0 }, `Fetched ${enriched.length} Reddit items; 0 matched product.`];
    }

    const reviews: RedditReviewItem[] = matchedTuples.map(([raw, reason, score]) => {
      const text = `${raw.title} ${raw.body}`.trim();
      return {
        subreddit: raw.subreddit,
        title: raw.title || (raw.body.length > 80 ? raw.body.slice(0, 80) + "…" : raw.body),
        body: (raw.body || raw.title).slice(0, 500),
        url: raw.url,
        score: raw.score,
        numComments: raw.num_comments,
        kind: raw.kind,
        sentiment: ruleSentiment(text),
        matchReason: reason,
        matchScore: Math.round(score * 100) / 100,
      };
    });

    const brief = await analyzeRedditReviews(reviews, ctx);
    const buckets: Record<string, number> = {};
    for (const r of reviews) { const k = r.sentiment ?? "neutral"; buckets[k] = (buckets[k] ?? 0) + 1; }
    const bySentiment = Object.entries(buckets).sort((a, b) => b[1] - a[1]).map(([key2, count]) => ({ key: key2, posts: count, avgEngagementRate: null }));

    const snapshot: RedditSnapshot = {
      searchQueries: queries,
      totalFetchedCount: enriched.length,
      matchedCount: reviews.length,
      postCount: reviews.filter(r => r.kind === "post").length,
      commentCount: reviews.filter(r => r.kind === "comment").length,
      avgScore: reviews.length ? Math.round(reviews.reduce((s, r) => s + r.score, 0) / reviews.length * 10) / 10 : null,
      bySentiment,
      reviews,
      analysisBrief: brief,
    };
    return [snapshot, { ecomProjects: 0, ecomCompetitors: 0, ecomCompetitorsAnalyzed: 0, socialPosts: 0, socialMetrics: 0, redditReviews: reviews.length, competitorRuns: 0 }, null];
  } catch (err) {
    throw new RedditReviewsError(String(err));
  }
}
