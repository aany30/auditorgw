import type { SocialPaidAd } from "@/lib/media-analyser/types";
import type { BrandAds } from "@/lib/media-analyser/paid-ad-intel";
import { adDestination } from "@/lib/media-analyser/paid-ad-intel";
import { adFormatKey } from "@/lib/media-analyser/paid-ad-stats";

/**
 * "Channel strategy shift" — where each brand SENDS its ad traffic and how that
 * mix has MOVED over time. This is the business read a strategist would build by
 * hand in Meta Ad Library: e.g. "they used to send 50% of ads to Amazon, now
 * it's 25% — they're pivoting to their own site." We compute it per brand and
 * across the set (you vs competitors), all from launch-month + click-destination
 * + format. Counts only — no spend estimates.
 */

export type Channel = "Marketplace" | "Owned site" | "Social" | "Other";
export const CHANNELS: Channel[] = ["Marketplace", "Owned site", "Social", "Other"];

const MARKET_RE = /amazon|flipkart|myntra|nykaa|croma|ajio|meesho|tatacliq|jiomart|snapdeal|shopee|lazada|\bnoon\b|reliancedigital|1mg|pharmeasy|walmart|target\.com|ebay|etsy|bigbasket|blinkit|zepto/i;
const SOCIAL_RE = /instagram|facebook|youtube|tiktok|\bfb\b/i;
const OTHER_RE = /whatsapp|telegram|app store|play store/i;

function channelOf(ad: SocialPaidAd): Channel {
  const dest = adDestination(ad);
  if (!dest) return "Other";
  if (SOCIAL_RE.test(dest)) return "Social";
  if (OTHER_RE.test(dest)) return "Other";
  if (MARKET_RE.test(dest)) return "Marketplace";
  return "Owned site";
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key: string) => MONTH_LABELS[Number(key.split("-")[1]) - 1] ?? key;
const emptyMix = (): Record<Channel, number> => ({ "Marketplace": 0, "Owned site": 0, "Social": 0, "Other": 0 });

interface AdRow { key: string | null; channel: Channel; video: boolean }

interface WindowMix { total: number; mix: Record<Channel, number>; videoPct: number }

export interface ChannelShiftBrand {
  brand: string;
  isYou: boolean;
  total: number;
  monthly: { key: string; label: string; total: number; mix: Record<Channel, number>; videoPct: number }[];
  windows: Record<"1m" | "3m" | "6m", WindowMix>;
  shifts: { channel: Channel; from: number; to: number; deltaPts: number }[]; // 6-mo avg → last month, |Δ| desc
  topShift: { channel: Channel; from: number; to: number; deltaPts: number } | null;
}

export interface ChannelShiftSet {
  brands: ChannelShiftBrand[];
  months: { key: string; label: string }[];
  channels: Channel[];              // channels actually present across the set
  headlineChannel: Channel;         // the most strategically-moving channel
  comparison: { key: string; label: string; byBrand: { brand: string; isYou: boolean; pct: number }[] }[];
  narrative: { text: string; tone: "shift" | "compare" }[];
  hasData: boolean;
}

function windowMix(rows: AdRow[], keys: string[]): WindowMix {
  const inWin = rows.filter(r => r.key && keys.includes(r.key));
  const total = inWin.length;
  const mix = emptyMix();
  let video = 0;
  for (const r of inWin) { mix[r.channel]++; if (r.video) video++; }
  if (total) for (const c of CHANNELS) mix[c] = mix[c] / total;
  return { total, mix, videoPct: total ? video / total : 0 };
}

function rowsOf(ads: SocialPaidAd[]): AdRow[] {
  return ads.map(ad => {
    const start = ad.startTime ? new Date(ad.startTime) : null;
    return {
      key: start && !Number.isNaN(start.getTime()) ? monthKey(start) : null,
      channel: channelOf(ad),
      video: adFormatKey(ad) === "video",
    };
  });
}

/** Build the channel-shift read for you + competitors, aligned on a shared month axis. */
export function buildChannelShift(you: BrandAds | null, competitors: BrandAds[]): ChannelShiftSet {
  const raw: { brand: string; isYou: boolean; rows: AdRow[] }[] = [];
  if (you && you.ads.length) raw.push({ brand: you.brand || "You", isYou: true, rows: rowsOf(you.ads) });
  for (const c of competitors) if (c.ads.length) raw.push({ brand: c.brand || "Competitor", isYou: false, rows: rowsOf(c.ads) });

  if (!raw.length) return { brands: [], months: [], channels: [], headlineChannel: "Marketplace", comparison: [], narrative: [], hasData: false };

  // Shared month axis: the last 6 months ending at the set-wide latest launch month.
  const allKeys = raw.flatMap(r => r.rows.map(x => x.key)).filter((k): k is string => !!k).sort();
  const months: { key: string; label: string }[] = [];
  if (allKeys.length) {
    const [ey, em] = allKeys[allKeys.length - 1].split("-").map(Number);
    const cursor = new Date(ey, em - 1, 1);
    const seq: string[] = [];
    for (let i = 0; i < 6; i++) { seq.unshift(monthKey(cursor)); cursor.setMonth(cursor.getMonth() - 1); }
    for (const k of seq) months.push({ key: k, label: monthLabel(k) });
  }
  const axisKeys = months.map(m => m.key);
  const win1 = axisKeys.slice(-1);
  const win3 = axisKeys.slice(-3);
  const win6 = axisKeys;

  const brands: ChannelShiftBrand[] = raw.map(r => {
    const monthly = months.map(m => {
      const rows = r.rows.filter(x => x.key === m.key);
      const mix = emptyMix();
      let video = 0;
      for (const x of rows) { mix[x.channel]++; if (x.video) video++; }
      if (rows.length) for (const c of CHANNELS) mix[c] = mix[c] / rows.length;
      return { key: m.key, label: m.label, total: rows.length, mix, videoPct: rows.length ? video / rows.length : 0 };
    });
    const windows = { "1m": windowMix(r.rows, win1), "3m": windowMix(r.rows, win3), "6m": windowMix(r.rows, win6) };
    const shifts = CHANNELS
      .map(channel => {
        const from = windows["6m"].mix[channel];
        const to = windows["1m"].mix[channel];
        return { channel, from, to, deltaPts: Math.round((to - from) * 100) };
      })
      .filter(s => windows["6m"].mix[s.channel] > 0 || windows["1m"].mix[s.channel] > 0)
      .sort((a, b) => Math.abs(b.deltaPts) - Math.abs(a.deltaPts));
    return { brand: r.brand, isYou: r.isYou, total: r.rows.length, monthly, windows, shifts, topShift: shifts[0] ?? null };
  });

  // Channels actually present.
  const channels = CHANNELS.filter(c => brands.some(b => b.windows["6m"].mix[c] > 0 || b.windows["1m"].mix[c] > 0));

  // Headline channel = the one with the biggest move by any (preferably competitor) brand.
  const competitorsOnly = brands.filter(b => !b.isYou);
  const shiftPool = (competitorsOnly.length ? competitorsOnly : brands).flatMap(b => b.shifts);
  const headlineChannel = shiftPool.length
    ? shiftPool.reduce((best, s) => Math.abs(s.deltaPts) > Math.abs(best.deltaPts) ? s : best).channel
    : (channels[0] ?? "Marketplace");

  const comparison = months.map(m => ({
    key: m.key,
    label: m.label,
    byBrand: brands.map(b => {
      const mm = b.monthly.find(x => x.key === m.key);
      return { brand: b.brand, isYou: b.isYou, pct: mm && mm.total ? mm.mix[headlineChannel] : 0 };
    }),
  }));

  // ── narrative ──
  const narrative: { text: string; tone: "shift" | "compare" }[] = [];
  const p = (x: number) => Math.round(x * 100);
  const movers = [...brands]
    .filter(b => b.topShift && Math.abs(b.topShift.deltaPts) >= 10)
    .sort((a, b) => Math.abs(b.topShift!.deltaPts) - Math.abs(a.topShift!.deltaPts));
  for (const b of movers.slice(0, 3)) {
    const s = b.topShift!;
    const dir = s.deltaPts < 0 ? "cut" : "grew";
    const pivotTo = s.deltaPts < 0
      ? b.shifts.find(x => x.deltaPts > 0 && x.channel !== s.channel)
      : null;
    const tail = pivotTo ? ` — shifting toward ${pivotTo.channel} (${p(pivotTo.from)}% → ${p(pivotTo.to)}%).` : ".";
    narrative.push({
      tone: "shift",
      text: `${b.brand} ${dir} ${s.channel} from ${p(s.from)}% (6-mo avg) to ${p(s.to)}% last month (${s.deltaPts > 0 ? "+" : ""}${s.deltaPts} pts)${tail}`,
    });
  }
  // You-vs-top-competitor on the headline channel.
  const youB = brands.find(b => b.isYou);
  const topComp = competitorsOnly.sort((a, b) => b.total - a.total)[0];
  if (youB && topComp) {
    narrative.push({
      tone: "compare",
      text: `On ${headlineChannel}: you send ${p(youB.windows["1m"].mix[headlineChannel])}% of ads there, ${topComp.brand} sends ${p(topComp.windows["1m"].mix[headlineChannel])}% (last month).`,
    });
  }

  return { brands, months, channels, headlineChannel, comparison, narrative, hasData: brands.length > 0 && months.length > 0 };
}
