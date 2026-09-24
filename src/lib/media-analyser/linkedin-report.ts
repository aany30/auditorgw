/**
 * LinkedIn company-page report model — "Quiet and loud aren't the same as losing and
 * winning." Reads organic company posts (apimaestro/linkedin-company-posts shape) and
 * derives followers, posting cadence, media mix, content themes, engagement depth and
 * posting rhythm. Organic only — NOT LinkedIn Ads.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;

/** Loose shape of an apimaestro LinkedIn post (only the fields we read). */
export interface LinkedInPost {
  text?: string;
  post_type?: string;                 // regular | quote | repost
  posted_at?: { date?: string; timestamp?: number; relative?: string };
  author?: { name?: string; follower_count?: number; type?: string };
  stats?: { total_reactions?: number; like?: number; comments?: number; reposts?: number; [k: string]: number | undefined };
  media?: { type?: string } | null;
  brand?: string;
}

export interface LinkedInBrandPosts { brand: string; posts: LinkedInPost[] }

const HIRING_RE = /\bhiring\b|we'?re looking for|join (our|the) team|\brecruit|apply now|job opening|now hiring|store manager|brand consultant|we are hiring|\bcareers?\b|\bvacan/i;
const STORE_RE = /store launch|now open|new store|\boutlet\b|\bmall\b|palladium|phoenix|retail (launch|expansion)|store team|opening (soon|our)/i;

function themeOf(text: string): "Hiring / Recruitment" | "Store / Retail Launch" | "Other / Product / Brand" {
  if (HIRING_RE.test(text)) return "Hiring / Recruitment";
  if (STORE_RE.test(text)) return "Store / Retail Launch";
  return "Other / Product / Brand";
}

function mediaTypeOf(p: LinkedInPost): "video" | "image" | "article" | "none" {
  const t = String(p.media?.type ?? "").toLowerCase();
  if (t.includes("video")) return "video";
  if (t.includes("image")) return "image";
  if (t.includes("article") || t.includes("document") || t.includes("link")) return "article";
  return "none";
}

const reactionsOf = (p: LinkedInPost) => Number(p.stats?.total_reactions ?? p.stats?.like ?? 0) || 0;
const commentsOf = (p: LinkedInPost) => Number(p.stats?.comments ?? 0) || 0;
const repostsOf = (p: LinkedInPost) => Number(p.stats?.reposts ?? 0) || 0;
const msOf = (p: LinkedInPost) => {
  const ts = p.posted_at?.timestamp; if (ts) return Number(ts);
  const d = p.posted_at?.date ? new Date(p.posted_at.date).getTime() : NaN;
  return d;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface LinkedInReport {
  brand: string;
  followers: number;
  ownPosts: number;
  avgReactions: number; avgComments: number; avgReposts: number;
  engagementRate: number;               // avgReactions / followers
  cadenceDays: number | null;           // avg days between posts
  daysSinceLast: number | null;
  activeWindowDays: number;
  monthly: { counts: number[]; labels: string[] };
  mediaMix: { none: number; image: number; video: number; article: number };
  videoAvgReactions: number | null;
  themes: { label: string; count: number; pct: number; avgReactions: number }[];
  hiringAvg: number | null; otherAvg: number | null;
  topPost: { text: string; date: string; reactions: number; comments: number } | null;
  topHashtags: { tag: string; count: number }[];
}

export function buildLinkedInReport(input: LinkedInBrandPosts, now = new Date()): LinkedInReport | null {
  const brand = input.brand;
  const all = input.posts ?? [];
  // Own posts only: drop reposts and posts authored by a person/other page (employees, press).
  const brandKey = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  const own = all.filter(p => {
    if (String(p.post_type ?? "").toLowerCase() === "repost") return false;
    const author = String(p.author?.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return !author || !brandKey || author.includes(brandKey) || brandKey.includes(author);
  });
  const posts = own.length ? own : all.filter(p => String(p.post_type ?? "").toLowerCase() !== "repost");
  if (!posts.length) return null;

  // Followers = the brand's OWN company-page follower count — from its own posts only.
  // Using max across ALL scraped posts wrongly picked up a press outlet / founder that
  // posted about the brand (e.g. Inc42's 690k leaking in as "Fix My Curls followers").
  const followers = Math.max(0, ...posts.map(p => Number(p.author?.follower_count ?? 0) || 0));
  const n = posts.length;
  const react = posts.map(reactionsOf);
  const avgReactions = round1(react.reduce((a, b) => a + b, 0) / n);
  const avgComments = round1(posts.map(commentsOf).reduce((a, b) => a + b, 0) / n);
  const avgReposts = round1(posts.map(repostsOf).reduce((a, b) => a + b, 0) / n);
  const engagementRate = followers ? avgReactions / followers : 0;

  // cadence + recency
  const dated = posts.map(msOf).filter(ms => !Number.isNaN(ms)).sort((a, b) => a - b);
  const first = dated[0], last = dated[dated.length - 1];
  const activeWindowDays = dated.length ? Math.round((last - first) / DAY) : 0;
  const cadenceDays = dated.length > 1 ? round1(activeWindowDays / (dated.length - 1)) : null;
  const daysSinceLast = dated.length ? Math.max(0, Math.round((now.getTime() - last) / DAY)) : null;

  // monthly cadence — last 12 months
  const monthCount = new Map<string, number>();
  for (const ms of dated) { const d = new Date(ms); monthCount.set(`${d.getUTCFullYear()}-${d.getUTCMonth()}`, (monthCount.get(`${d.getUTCFullYear()}-${d.getUTCMonth()}`) ?? 0) + 1); }
  const monthly = { counts: [] as number[], labels: [] as string[] };
  for (let k = 11; k >= 0; k--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    monthly.labels.push(`${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`);
    monthly.counts.push(monthCount.get(`${d.getUTCFullYear()}-${d.getUTCMonth()}`) ?? 0);
  }

  // media mix + video avg
  const mediaMix = { none: 0, image: 0, video: 0, article: 0 };
  const videoReacts: number[] = [];
  for (const p of posts) { const m = mediaTypeOf(p); mediaMix[m]++; if (m === "video") videoReacts.push(reactionsOf(p)); }
  const videoAvgReactions = videoReacts.length ? round1(videoReacts.reduce((a, b) => a + b, 0) / videoReacts.length) : null;

  // content themes
  const themeMap = new Map<string, { count: number; react: number }>();
  for (const p of posts) { const t = themeOf(String(p.text ?? "")); const e = themeMap.get(t) ?? { count: 0, react: 0 }; e.count++; e.react += reactionsOf(p); themeMap.set(t, e); }
  const themes = [...themeMap.entries()].map(([label, e]) => ({ label, count: e.count, pct: e.count / n, avgReactions: round1(e.react / e.count) })).sort((a, b) => b.count - a.count);
  const hiring = themeMap.get("Hiring / Recruitment");
  const other = themeMap.get("Other / Product / Brand");
  const hiringAvg = hiring ? round1(hiring.react / hiring.count) : null;
  const otherAvg = other ? round1(other.react / other.count) : null;

  // top post
  const top = [...posts].sort((a, b) => reactionsOf(b) - reactionsOf(a))[0];
  const topText = String(top?.text ?? "").replace(/\s+/g, " ").trim();
  const topPost = top ? { text: topText.length > 140 ? topText.slice(0, 140) + "…" : topText, date: top.posted_at?.date?.slice(0, 10) ?? top.posted_at?.relative ?? "", reactions: reactionsOf(top), comments: commentsOf(top) } : null;

  // hashtags
  const tagMap = new Map<string, number>();
  for (const p of posts) for (const m of String(p.text ?? "").matchAll(/#(\w+)/g)) { const t = "#" + m[1].toLowerCase(); tagMap.set(t, (tagMap.get(t) ?? 0) + 1); }
  const topHashtags = [...tagMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count }));

  return {
    brand, followers, ownPosts: n, avgReactions, avgComments, avgReposts, engagementRate,
    cadenceDays, daysSinceLast, activeWindowDays, monthly, mediaMix, videoAvgReactions,
    themes, hiringAvg, otherAvg, topPost, topHashtags,
  };
}

export function buildLinkedInReportSet(you: LinkedInBrandPosts | null, competitors: LinkedInBrandPosts[], now = new Date()): LinkedInReport[] {
  const out: LinkedInReport[] = [];
  if (you && you.posts.length) { const r = buildLinkedInReport({ ...you, brand: you.brand || "You" }, now); if (r) out.push(r); }
  for (const c of competitors) { if (!c.posts.length) continue; const r = buildLinkedInReport({ ...c, brand: c.brand || "Competitor" }, now); if (r) out.push(r); }
  return out;
}
