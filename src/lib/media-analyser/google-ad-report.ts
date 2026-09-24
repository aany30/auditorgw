import type { BrandAds } from "@/lib/media-analyser/paid-ad-intel";

/**
 * Google Ads Transparency report model — "Same category, different playbook".
 * Every panel is derived ONLY from the free-tier Transparency fields the scraper
 * returns: advertiser, adFormat (text/image/video), firstShown (→ startTime),
 * lastShown (→ stopTime), region. No spend, no CTA, no copy, no surface split —
 * so this is a pure time-series read of each brand's creative operation.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");
const dateStr = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const monthKey = (y: number, m: number) => `${y}-${pad(m + 1)}`;
const monthLabel = (y: number, m: number) => MONTHS[m] + (m === 0 ? ` '${String(y).slice(2)}` : "");
export const gFormatLabel = (f: string) => f === "text" ? "Text" : f === "image" ? "Image" : f === "video" ? "Video" : "Other";

export interface GoogleAdReport {
  brand: string;
  total: number;
  // hero
  concurrentActiveNow: number;
  asOfLabel: string;
  trackedSinceYear: number | null;
  peak: { count: number; label: string };
  rangeStart: { year: number; month: number } | null;
  // matrix
  liveCount: number; dormantCount: number; avgLifespan: number; maxLifespan: number; evergreenPct: number;
  // detail panels
  launch: { counts: number[]; labels: string[] };
  formatMix: { text: number; image: number; video: number; other: number };
  liveDormant: { label: string; count: number; pct: number }[];
  formatEvolution: { year: number; n: number; text: number; image: number; video: number }[];
  hallOfFame: { format: string; first: string; last: string; days: number; live: boolean }[];
  batchDays: { date: string; count: number }[];
  // signals
  lifespanProfile: { label: string; pct: number }[];
  formatLifespan: { format: string; avg: number; max: number }[];
  seasonality: number[];                 // 12 months, fraction of dated ads by first-shown calendar month
  concByMonth: Record<string, number>;   // "YYYY-MM" → concurrently-active count (brand range → now)
  advertisers: { name: string; count: number }[]; // distinct advertiser accounts running these ads
}

const round = (n: number) => Math.round(n);

export function buildGoogleAdReport(brand: BrandAds, now = new Date()): GoogleAdReport | null {
  const ads = brand.ads;
  if (!ads.length) return null;
  const nowMs = now.getTime();

  const rows = ads.map(ad => {
    const firstMs = ad.startTime ? new Date(ad.startTime).getTime() : NaN;
    const stop = (ad as Record<string, unknown>).stopTime as string | null | undefined;
    const lastMs = stop ? new Date(stop).getTime() : nowMs;      // no lastShown → treated as still running
    const lastEff = Number.isNaN(lastMs) ? nowMs : lastMs;
    const lifespan = Number.isNaN(firstMs) ? null : Math.max(0, (lastEff - firstMs) / DAY);
    const daysSince = Math.max(0, (nowMs - lastEff) / DAY);
    const fmt = String((ad as Record<string, unknown>).format ?? "other").toLowerCase();
    return { firstMs, lastMs: lastEff, lifespan, daysSince, fmt };
  });

  const total = ads.length;
  const dated = rows.filter(r => !Number.isNaN(r.firstMs));
  const firstMsSorted = dated.map(r => r.firstMs).sort((a, b) => a - b);
  const rangeStart = firstMsSorted.length ? { year: new Date(firstMsSorted[0]).getUTCFullYear(), month: new Date(firstMsSorted[0]).getUTCMonth() } : null;

  // concurrent-active at a given month = ads whose [firstShown, lastShown] overlaps that month
  const iv = dated.map(r => [r.firstMs, r.lastMs] as const);
  const concAt = (y: number, m: number) => {
    const s = Date.UTC(y, m, 1), e = Date.UTC(y, m + 1, 0, 23, 59, 59);
    let c = 0; for (const [a, b] of iv) if (a <= e && b >= s) c++; return c;
  };

  // walk the brand's whole timeline → launch calendar + concurrent series
  const launchCounts = new Map<string, number>();
  for (const r of dated) { const d = new Date(r.firstMs); launchCounts.set(monthKey(d.getUTCFullYear(), d.getUTCMonth()), (launchCounts.get(monthKey(d.getUTCFullYear(), d.getUTCMonth())) ?? 0) + 1); }
  const launch = { counts: [] as number[], labels: [] as string[] };
  const concByMonth: Record<string, number> = {};
  let peak = { count: 0, label: "" };
  if (rangeStart) {
    let y = rangeStart.year, m = rangeStart.month;
    const endY = now.getUTCFullYear(), endM = now.getUTCMonth();
    while (y < endY || (y === endY && m <= endM)) {
      const k = monthKey(y, m);
      launch.labels.push(monthLabel(y, m));
      launch.counts.push(launchCounts.get(k) ?? 0);
      const c = concAt(y, m);
      concByMonth[k] = c;
      if (c > peak.count) peak = { count: c, label: `${MONTHS[m]} ${y}` };
      m++; if (m === 12) { m = 0; y++; }
    }
  }
  const concurrentActiveNow = concAt(now.getUTCFullYear(), now.getUTCMonth());
  const asOfLabel = `${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`;

  // matrix signals
  const lifespans = rows.map(r => r.lifespan).filter((d): d is number => d != null);
  const liveCount = rows.filter(r => r.daysSince <= 7).length;
  const dormantCount = rows.filter(r => r.daysSince >= 180).length;
  const avgLifespan = lifespans.length ? round(lifespans.reduce((a, b) => a + b, 0) / lifespans.length) : 0;
  const maxLifespan = lifespans.length ? round(Math.max(...lifespans)) : 0;
  const evergreenPct = lifespans.length ? lifespans.filter(d => d >= 365).length / lifespans.length : 0;

  // format mix
  const formatMix = { text: 0, image: 0, video: 0, other: 0 };
  for (const r of rows) (formatMix as Record<string, number>)[["text", "image", "video"].includes(r.fmt) ? r.fmt : "other"]++;

  // live vs dormant (by days since last shown)
  const LD: [string, (d: number) => boolean][] = [
    ["0–7d (currently live)", d => d <= 7], ["8–30d", d => d > 7 && d <= 30],
    ["31–90d", d => d > 30 && d <= 90], ["91–180d", d => d > 90 && d <= 180], ["180d+ (dormant)", d => d > 180],
  ];
  const liveDormant = LD.map(([label, t]) => { const count = rows.filter(r => t(r.daysSince)).length; return { label, count, pct: total ? count / total : 0 }; });

  // format-mix evolution by launch year
  const yearMap = new Map<number, { n: number; text: number; image: number; video: number }>();
  for (const r of dated) {
    const y = new Date(r.firstMs).getUTCFullYear();
    const e = yearMap.get(y) ?? { n: 0, text: 0, image: 0, video: 0 };
    e.n++; if (r.fmt === "text") e.text++; else if (r.fmt === "image") e.image++; else if (r.fmt === "video") e.video++;
    yearMap.set(y, e);
  }
  const formatEvolution = [...yearMap.entries()].sort((a, b) => a[0] - b[0]).map(([year, e]) => ({ year, n: e.n, text: e.text / e.n, image: e.image / e.n, video: e.video / e.n }));

  // hall of fame — longest-running individual ads
  const hallOfFame = rows.filter(r => !Number.isNaN(r.firstMs) && r.lifespan != null)
    .sort((a, b) => (b.lifespan ?? 0) - (a.lifespan ?? 0)).slice(0, 3)
    .map(r => ({ format: gFormatLabel(r.fmt), first: dateStr(r.firstMs), last: dateStr(r.lastMs), days: round(r.lifespan ?? 0), live: r.daysSince <= 7 }));

  // batch launch days
  const dayMap = new Map<string, number>();
  for (const r of dated) { const k = dateStr(r.firstMs); dayMap.set(k, (dayMap.get(k) ?? 0) + 1); }
  const batchDays = [...dayMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([date, count]) => ({ date, count }));

  // advertiser accounts running these ads (a domain can front several — surface who they are)
  const advMap = new Map<string, number>();
  for (const ad of ads) { const n = String((ad as Record<string, unknown>).pageName ?? "").trim() || "Unknown advertiser"; advMap.set(n, (advMap.get(n) ?? 0) + 1); }
  const advertisers = [...advMap.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));

  // creative lifespan profile
  const LP: [string, (d: number) => boolean][] = [
    ["Single day", d => d < 1], ["2–7d", d => d >= 1 && d <= 7], ["8–30d", d => d > 7 && d <= 30],
    ["31–90d", d => d > 30 && d <= 90], ["91–365d", d => d > 90 && d <= 365], ["365d+", d => d > 365],
  ];
  const lifespanProfile = LP.map(([label, t]) => ({ label, pct: lifespans.length ? lifespans.filter(t).length / lifespans.length : 0 }));

  // which format lasts longest
  const formatLifespan = (["text", "image", "video"] as const).map(f => {
    const ls = rows.filter(r => r.fmt === f && r.lifespan != null).map(r => r.lifespan as number);
    return { format: gFormatLabel(f), avg: ls.length ? round(ls.reduce((a, b) => a + b, 0) / ls.length) : 0, max: ls.length ? round(Math.max(...ls)) : 0 };
  }).filter(x => x.avg > 0 || x.max > 0);

  // seasonality — % of dated ads by first-shown calendar month
  const seaCount = Array(12).fill(0);
  for (const r of dated) seaCount[new Date(r.firstMs).getUTCMonth()]++;
  const seasonality = seaCount.map(c => dated.length ? c / dated.length : 0);

  return {
    brand: brand.brand, total, concurrentActiveNow, asOfLabel, trackedSinceYear: rangeStart?.year ?? null, peak, rangeStart,
    liveCount, dormantCount, avgLifespan, maxLifespan, evergreenPct,
    launch, formatMix, liveDormant, formatEvolution, hallOfFame, batchDays,
    lifespanProfile, formatLifespan, seasonality, concByMonth, advertisers,
  };
}

export function buildGoogleAdReportSet(you: BrandAds | null, competitors: BrandAds[], now = new Date()): GoogleAdReport[] {
  const out: GoogleAdReport[] = [];
  if (you && you.ads.length) { const r = buildGoogleAdReport({ ...you, brand: you.brand || "You" }, now); if (r) out.push(r); }
  for (const c of competitors) { if (!c.ads.length) continue; const r = buildGoogleAdReport({ ...c, brand: c.brand || "Competitor" }, now); if (r) out.push(r); }
  return out;
}
