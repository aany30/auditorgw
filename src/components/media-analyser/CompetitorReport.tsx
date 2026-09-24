
import { useMemo, useState } from "react";
import { buildCompetitorReportSet, type CompetitorReport } from "@/lib/media-analyser/competitor-report";
import type { BrandAds } from "@/lib/media-analyser/paid-ad-intel";

/* ────────────────────────────────────────────────────────────────────────────
   "Who to worry about first" — Ad-Intelligence report.
   Faithful reproduction of the Threezinc report layout: brand bar → masthead →
   hero rank cards + tug-bar → head-to-head matrix → per-brand detail panels →
   "Signals you wouldn't have seen" → ad library → final verdict.
   Every number is derived from the scraped Meta Ad Library (no spend is published
   for commercial ads — the spend verdict is an explicit directional model).
   ──────────────────────────────────────────────────────────────────────────── */

const PRODUCT = "Threezinc";
// Brand hues — index 0 ("you") is blue; competitors cycle. The top-threat competitor
// (most active ads) becomes the orange "fk" foil used in the hero / signals / verdict.
const HUES = ["#4C5FE0", "#EC7F2E", "#1FAE72", "#E64888", "#7c3aed", "#0891b2"];
const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const nf = (n: number) => Math.round(n).toLocaleString("en-IN");
const pct0 = (x: number) => `${Math.round(x * 100)}%`;
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;

type BrandStyle = React.CSSProperties & { "--brandc": string };
const brandVar = (c: string): BrandStyle => ({ "--brandc": c });

// ─── shared SVG chart helpers (viewBox 900×200, axis at 0 / 0.5 / 1) ───────────
const CW = 900, CH = 200, PADL = 44, PADT = 10, PADB = 18;
const INNER_W = CW - PADL - 8, INNER_H = CH - PADB - PADT;

function Grid({ max }: { max: number }) {
  return (
    <>
      {[0, 0.5, 1].map((f, i) => {
        const y = PADT + INNER_H - f * INNER_H;
        return (
          <g key={i}>
            <line x1={PADL} y1={y} x2={CW} y2={y} stroke="#E7E8F2" strokeWidth={1} />
            <text x={0} y={y + 4} style={{ fontFamily: 'var(--font-mono),"IBM Plex Mono",monospace' }} fontSize={11} fill="#9799AE">{nf(max * f)}</text>
          </g>
        );
      })}
    </>
  );
}

function LineChart({ data, color, months }: { data: number[]; color: string; months: string[] }) {
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => [PADL + (i / Math.max(1, data.length - 1)) * INNER_W, PADT + INNER_H - (v / max) * INNER_H] as const);
  const path = "M " + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L ");
  return (
    <>
      <div className="chartbox">
        <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
          <Grid max={max} />
          <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3.5} fill={color} />)}
        </svg>
      </div>
      <div className="chart-months">{months.map((m, i) => <span key={i}>{m}</span>)}</div>
    </>
  );
}

function BarChart({ data, color, labels }: { data: number[]; color: string; labels: string[] }) {
  const max = Math.max(1, ...data);
  const n = data.length;
  const cat = labels.length === n && n <= 12 && !MONTHS_ABBR.includes(labels[0]);
  const bw = cat ? (INNER_W / n) * 0.5 : (INNER_W / n) * 0.55;
  return (
    <>
      <div className="chartbox">
        <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
          <Grid max={max} />
          {data.map((v, i) => {
            const cx = cat ? PADL + (i + 0.5) * (INNER_W / n) : PADL + (i / Math.max(1, n - 1)) * INNER_W;
            const h = (v / max) * INNER_H;
            return <rect key={i} x={cx - bw / 2} y={PADT + INNER_H - h} width={bw} height={h} rx={3} fill={color} />;
          })}
        </svg>
      </div>
      <div className="chart-months">{labels.map((m, i) => <span key={i} title={m}>{m.length > 14 ? m.slice(0, 13) + "…" : m}</span>)}</div>
    </>
  );
}

function MultiLineChart({ series, months }: { series: { label: string; color: string; data: number[] }[]; months: string[] }) {
  const max = Math.max(1, ...series.flatMap(s => s.data));
  const n = Math.max(1, (series[0]?.data.length ?? 1) - 1);
  return (
    <>
      <div className="chartbox">
        <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
          <Grid max={max} />
          {series.map((sr, si) => {
            const pts = sr.data.map((v, i) => [PADL + (i / n) * INNER_W, PADT + INNER_H - (v / max) * INNER_H] as const);
            const path = "M " + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L ");
            return (
              <g key={si}>
                <path d={path} fill="none" stroke={sr.color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3} fill={sr.color} />)}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="chart-months">{months.map((m, i) => <span key={i}>{m}</span>)}</div>
      <div className="ov-legend">{series.map(s => <div key={s.label} className="lg"><span className="sw" style={{ background: s.color }} />{s.label}</div>)}</div>
    </>
  );
}

// ─── labelled % bars (the "barrow" primitive) ─────────────────────────────────
function BarRows({ rows }: { rows: { label: string; val: string; width: number; fill: string }[] }) {
  return (
    <>
      {rows.map((r, i) => (
        <div className="barrow" key={i}>
          <div className="toprow"><b>{r.label}</b><span className="val">{r.val}</span></div>
          <div className="track"><div className="fill" style={{ width: `${Math.max(r.width, r.width > 0 ? 0.4 : 0)}%`, background: r.fill }} /></div>
        </div>
      ))}
    </>
  );
}

// ─── CSV downloads (kept from the previous surface) ───────────────────────────
function dl(name: string, csv: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, "-");

function downloadRawCsv(reports: CompetitorReport[], name = "ad-library.csv") {
  const cols = ["Brand", "Ad ID", "Ad Link", "Format", "Destination", "Platforms", "Language", "Native/Influencer", "CTA", "Start", "Days Live", "Status", "Discount %", "Offer Types"];
  const rows: string[] = [];
  for (const report of reports) for (const r of report.adsTable) rows.push([
    report.brand, r.adId, r.url ?? "", r.format, r.channel, r.platforms, r.language, r.influencer ? "Influencer" : "Native",
    r.cta ?? "", r.start ?? "", r.days ?? "", r.active ? "Active" : "Inactive", r.discountPct ?? "", r.offerTypes,
  ].map(esc).join(","));
  dl(name, [cols.map(esc).join(","), ...rows].join("\r\n"));
}
function downloadInfluencerCsv(report: CompetitorReport) {
  const cols = ["Ad ID", "Date (start)", "Influencer", "Handle", "Format", "Destination", "Language", "CTA", "Discount %", "Days Live", "Ad Link"];
  const rows = report.influencerAds.map(a => [a.adId, a.start ?? "", a.influencerName, a.igHandle, a.format, a.channel, a.language, a.cta ?? "", a.discountPct ?? "", a.days ?? "", a.url ?? ""].map(esc).join(","));
  dl(`${slug(report.brand)}-influencer-ads.csv`, [cols.map(esc).join(","), ...rows].join("\r\n"));
}
function downloadDiscountCsv(report: CompetitorReport) {
  const cols = ["Ad ID", "Ad Link", "Discount %", "Start", "End"];
  const rows = report.discountHistory.map(d => [d.adId, d.url ?? "", `${d.pct}%`, d.start ?? "", d.end ?? ""].map(esc).join(","));
  dl(`${slug(report.brand)}-discount-ads.csv`, [cols.map(esc).join(","), ...rows].join("\r\n"));
}

// ─── weighted-average lifespan from the churn buckets (for the spend model) ───
const BUCKET_MID = [2, 5.5, 11, 22, 45, 75];
const avgLifespan = (r: CompetitorReport) => r.churnBuckets.reduce((s, b, i) => s + b.pct * BUCKET_MID[i], 0) || 20;

// ─── deterministic "Final Verdict" from the you-vs-top-threat deltas ──────────
function buildVerdict(you: CompetitorReport, foe: CompetitorReport) {
  const ratio = you.total ? foe.total / you.total : 0;
  const youPlat = you.platforms.filter(p => p.pct >= 0.3).length;
  const foePlat = foe.platforms.filter(p => p.pct >= 0.3).length;
  const youVid = you.formats.videoPct, foeVid = foe.formats.videoPct;
  const youDisc = you.discountHistory.length, foeDisc = foe.discountHistory.length;
  const youLangs = you.regionalAds.length, foeLangs = foe.regionalAds.length;
  const foeTopDest = foe.destinationsDetailed[0], youTopDest = you.destinationsDetailed[0];
  const adDaysYou = you.active * avgLifespan(you), adDaysFoe = foe.active * avgLifespan(foe);
  const spendX = adDaysYou ? adDaysFoe / adDaysYou : 0;

  const out: { tag: string; color: string; kind: "list" | "stat"; stat?: { num: string; lbl: string }; items: string[] }[] = [];

  out.push({
    tag: `Where ${foe.brand} out-executes`, color: "var(--flipkart)", kind: "list", items: [
      foePlat > youPlat ? `Distribution footprint — live on ${foePlat} Meta surfaces at ≥30% reach vs your ${youPlat}. Messenger / Threads / Audience Network are barely touched on your side.` : "",
      foeVid > youVid ? `Creative format — ${pct0(foeVid)} video-led vs your ${pct0(youVid)}; higher production, higher delivery cost, at scale.` : "",
      foeDisc > youDisc ? `Discount breadth — ${nf(foeDisc)} discount ads across ${foe.offerSignal.offerTypes.length} offer types vs your ${nf(youDisc)} across ${you.offerSignal.offerTypes.length}.` : "",
      foeLangs > youLangs ? `Regional reach — runs ${foe.regionalAds.slice(0, 3).map(l => l.label).join(", ")} alongside English; you're ${youLangs <= 1 ? "single-language" : "narrower"}.` : "",
      foeTopDest && youTopDest && foeTopDest.label !== youTopDest.label ? `Acquisition push — ${foeTopDest.label} is their #1 destination (${nf(foeTopDest.count)} ads); yours is ${youTopDest.label}.` : "",
    ].filter(Boolean),
  });

  out.push({
    tag: "Where you're ahead", color: "var(--amazon)", kind: "list", items: [
      (you.offerSignal.avgDiscountPct ?? 0) > (foe.offerSignal.avgDiscountPct ?? 0) ? `Discount depth over breadth — your avg discount is higher (${you.offerSignal.avgDiscountPct}% vs ${foe.offerSignal.avgDiscountPct}%): fewer promo ads, stronger individual offers.` : "",
      avgLifespan(you) > avgLifespan(foe) ? `Creative durability — your ads live ~${Math.round(avgLifespan(you))}d on average vs their ~${Math.round(avgLifespan(foe))}d. Worth confirming whether that's winning creative or just slower iteration.` : "",
      you.categoryTrend.categories[0] && foe.categoryTrend.categories[0] && you.categoryTrend.categories[0] !== foe.categoryTrend.categories[0] ? `Different centre of gravity — you lead in ${you.categoryTrend.categories[0]}, they lead in ${foe.categoryTrend.categories[0]} — either white space or a blind spot.` : "",
      you.concentration.topConceptPct > foe.concentration.topConceptPct ? `Message focus — your top concept carries ${pct0(you.concentration.topConceptPct)} of the library vs their ${pct0(foe.concentration.topConceptPct)}; a tighter, more repeatable hero message.` : "",
    ].filter(Boolean),
  });

  out.push({
    tag: "Spend verdict", color: "var(--risk)", kind: "stat",
    stat: { num: spendX >= 1 ? `~${spendX < 10 ? spendX.toFixed(1) : Math.round(spendX)}×` : `~${spendX.toFixed(2)}×`, lbl: `estimated relative Meta spend, ${foe.brand} vs you` },
    items: [
      `Active ads × avg creative lifespan → ~${spendX >= 1 ? (spendX < 10 ? spendX.toFixed(1) : Math.round(spendX)) : spendX.toFixed(2)}× more sustained ad presence (${nf(adDaysFoe)} vs ${nf(adDaysYou)} "ad-days").`,
      foeVid > youVid ? `Video-heavy mix (${pct0(foeVid)} vs ${pct0(youVid)}) typically costs more per impression, widening the real gap.` : `Similar format mix, so most of the gap is raw volume.`,
      foePlat > youPlat ? `Wider platform delivery (${foePlat} surfaces vs your ${youPlat}) buys more total inventory for the same push.` : "",
      `Meta doesn't disclose spend for commercial advertisers — this is a directional model from the ad data, not a scraped figure.`,
    ].filter(Boolean),
  });

  out.push({
    tag: "Recommended focus", color: "var(--green)", kind: "list", items: [
      foePlat > youPlat ? "Close the platform gap first — the untouched Meta surfaces are the cheapest lever: no new creative required." : "Hold your platform coverage — it already matches the threat.",
      avgLifespan(you) > avgLifespan(foe) ? `Diagnose the ~${Math.round(avgLifespan(you))}-day creative lifespan — check performance before assuming it's a strength; it may just be slower testing velocity.` : "Raise creative velocity — your ads turn over faster than theirs; make sure you're not under-testing.",
      foeTopDest && youTopDest && foeTopDest.label !== youTopDest.label ? `Consider a ${foeTopDest.label} push — you're ceding that acquisition surface to ${foe.brand}.` : "Keep pressure on your leading destination — it's the shared battleground.",
    ],
  });
  return { out, ratio, spendX };
}

// ─── the breakdown card (Advertisers / CTA mix / Ad destination toggle) ───────
function Breakdown({ report, color }: { report: CompetitorReport; color: string }) {
  const [mode, setMode] = useState<"advertisers" | "cta" | "destination">("cta");
  const caption = mode === "advertisers" ? "pages running these ads" : mode === "cta" ? "% of ads · lifespan" : "where ads actually redirect";
  let rows: { label: string; val: string; width: number; fill: string }[] = [];
  if (mode === "advertisers") rows = report.advertisers.map(a => ({ label: a.label, val: `${nf(a.count)} · ${pct0(a.pct)}`, width: a.pct * 100, fill: color }));
  else if (mode === "cta") rows = report.ctaMix.map(c => ({ label: c.label, val: `${pct0(c.pct)} · ${c.medianDays}d`, width: c.pct * 100, fill: color }));
  else rows = report.destinationsDetailed.map(d => ({ label: d.label, val: `${nf(d.count)} · ${pct0(d.pct)}`, width: d.pct * 100, fill: "linear-gradient(90deg,#1c6b4c,var(--green))" }));
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="ov-controls">
        <div className="seg-toggle">
          {(["advertisers", "cta", "destination"] as const).map(m => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>{m === "advertisers" ? "Advertisers" : m === "cta" ? "CTA mix" : "Ad destination"}</button>
          ))}
        </div>
        <div className="ov-caption">{caption}</div>
      </div>
      {rows.length ? <BarRows rows={rows} /> : <p className="empty">no data</p>}
    </div>
  );
}

// ─── Ads Overview (Ads bars / CTA multiline / Destination catbar) ─────────────
function Overview({ report, color }: { report: CompetitorReport; color: string }) {
  const [metric, setMetric] = useState<"ads" | "cta" | "destination">("ads");
  const rw = report.runway;
  const caption =
    metric === "ads" ? `${report.brand} · ads / month · last 12 months`
    : metric === "cta" ? `${report.brand} · CTA over time · last 12 months`
    : `${report.brand} · destination breakdown`;
  return (
    <div className="card">
      <h3>Ads Overview <span className="sub">selected brand · pick metric</span></h3>
      <div className="ov-controls">
        <div className="seg-toggle">
          {(["ads", "cta", "destination"] as const).map(m => (
            <button key={m} className={metric === m ? "active" : ""} onClick={() => setMetric(m)}>{m === "ads" ? "Ads" : m === "cta" ? "CTA" : "Destination"}</button>
          ))}
        </div>
        <div className="ov-caption">{caption}</div>
      </div>
      {metric === "ads" && <BarChart data={rw.count} color={color} labels={rw.months} />}
      {metric === "cta" && (rw.ctaBuckets.length
        ? <MultiLineChart months={rw.months} series={rw.ctaBuckets.map((b, i) => ({ label: b, color: HUES[i % HUES.length], data: rw.ctas[b] ?? [] }))} />
        : <p className="empty">no CTA signal in these ads</p>)}
      {metric === "destination" && (report.destinationsDetailed.length
        ? <BarChart data={report.destinationsDetailed.map(d => d.count)} color={color} labels={report.destinationsDetailed.map(d => d.label)} />
        : <p className="empty">no resolvable destinations</p>)}
    </div>
  );
}

// ─── per-brand detail panel ───────────────────────────────────────────────────
const CAT_FILLS = ["var(--brandc)", "var(--pink)", "linear-gradient(90deg,#1c6b4c,var(--green))", "linear-gradient(90deg,#8a5a2a,#e0a25a)", "linear-gradient(90deg,#4b2a8a,#9a6ae0)", "linear-gradient(90deg,#1c6b7a,#4fc6d6)", "linear-gradient(90deg,#8a7a1c,#e0cf4f)", "linear-gradient(90deg,#8a2a2a,#e05a5a)"];
const PLAT_FILL: Record<string, string> = { Instagram: "linear-gradient(90deg,#7a2b46,var(--pink))", Facebook: "var(--brandc)", Messenger: "linear-gradient(90deg,#1c5a8a,#4fb3e0)", Threads: "linear-gradient(90deg,#2a2a2a,#6a6a6a)", "Audience Network": "var(--brandc)", WhatsApp: "linear-gradient(90deg,#1c6b4c,#3ed698)" };

function DetailPanel({ report, color }: { report: CompetitorReport; color: string }) {
  const o = report.offerSignal;
  const namedCats = report.categoryTrend.categories.filter(c => c !== "Other");
  const catCounts = namedCats.map(c => report.categoryTrend.cells.filter(x => x.category === c).reduce((s, x) => s + x.count, 0));
  const catTotal = catCounts.reduce((s, n) => s + n, 0);
  const otherTotal = report.categoryTrend.cells.filter(x => x.category === "Other").reduce((s, x) => s + x.count, 0);
  const catRows = namedCats.map((c, i) => ({ label: c, count: catCounts[i] })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);
  const platMax = Math.max(1, ...report.platforms.map(p => p.count));

  return (
    <div className="panel active" style={brandVar(color)}>
      {/* ad decay */}
      <div className="card" style={{ marginBottom: 18 }}>
        <h3>Ad Decay · Ads / Month <span className="sub">last 12 months</span></h3>
        <LineChart data={report.adsPerMonth.map(m => m.count)} months={report.adsPerMonth.map(m => m.label)} color={color} />
      </div>

      <Breakdown report={report} color={color} />

      <div className="grid-2" style={{ marginBottom: 18 }}>
        {/* ad formats donut */}
        <div className="card">
          <h3>Ad Formats <span className="sub">video · static · carousel</span></h3>
          <div className="donut-wrap">
            <div className="donut" style={{ background: `conic-gradient(${color} 0% ${pct0(report.formats.videoPct)}, var(--surface-2) ${pct0(report.formats.videoPct)} 100%)` }} />
            <div className="legend">
              <div><span className="dot" style={{ background: color }} />Video<b>{pct0(report.formats.videoPct)} · {nf(report.formats.video)}</b></div>
              <div><span className="dot" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }} />Static<b>{pct0(report.formats.staticPct)} · {nf(report.formats.static)}</b></div>
              <div><span className="dot" style={{ background: "transparent", border: "1px solid var(--border)" }} />Carousel<b>{pct0(report.formats.carouselPct)} · {nf(report.formats.carousel)}</b></div>
            </div>
          </div>
        </div>
        {/* where ads run */}
        <div className="card">
          <h3>Where Ads Run <span className="sub">platforms · % of ads</span></h3>
          {report.platforms.length
            ? <BarRows rows={report.platforms.map(p => ({ label: p.label, val: `${nf(p.count)} · ${pct0(p.pct)}`, width: (p.count / platMax) * 100, fill: PLAT_FILL[p.label] ?? color }))} />
            : <p className="empty">platform not reported for these ads</p>}
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 18 }}>
        {/* regional ads */}
        <div className="card">
          <h3>Regional Ads <span className="sub">of {nf(report.total)} total</span></h3>
          <div className="kv-list">
            {report.regionalAds.map((l, i) => (
              <div className="kv-row" key={i}><span className="k">{l.label}</span><span className="v">{nf(l.count)} / {nf(report.total)}</span></div>
            ))}
          </div>
        </div>
        {/* influencer ads */}
        <div className="card">
          <h3>Influencer Ads</h3>
          <div className="influencer-big">
            <div>
              <div className="influencer-num" style={{ color }}>{pct0(report.influencerPct)}</div>
              <div className="influencer-desc">{nf(report.influencerCount)} of {nf(report.total)} ads are creator-led (influencer / paid-partnership)</div>
            </div>
            <button className="btn solid" style={{ background: color, borderColor: color, color: "#fff" }} disabled={!report.influencerCount} onClick={() => downloadInfluencerCsv(report)}>↓ Download data</button>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 18 }}>
        {/* offer signal */}
        <div className="card">
          <h3>Offer Signal <span className="sub">promo cues in copy</span></h3>
          <div className="statpair">
            <div className="stat-lg">
              <div className="num" style={{ color }}>{o.avgDiscountPct != null ? `${o.avgDiscountPct}%` : "—"}</div><div className="lbl">Avg Discount</div>
              <div className="kv-list">
                <div className="kv-row"><span className="k">Max Discount</span><span className="v">{o.maxDiscountPct != null ? `${o.maxDiscountPct}%` : "—"}{o.maxDiscountUrl && <a href={o.maxDiscountUrl} target="_blank" rel="noreferrer">↗</a>}</span></div>
                <div className="kv-row"><span className="k">Min Discount</span><span className="v">{o.minDiscountPct != null ? `${o.minDiscountPct}%` : "—"}{o.minDiscountUrl && <a href={o.minDiscountUrl} target="_blank" rel="noreferrer">↗</a>}</span></div>
                <div className="kv-row"><span className="k">Most Repeated</span><span className="v">{o.mostRepeatedDiscountPct != null ? `${o.mostRepeatedDiscountPct}%` : "—"}</span></div>
              </div>
            </div>
            <div className="stat-lg">
              <div className="num" style={{ color: "var(--flipkart)" }}>{pct0(o.limitedOfferPct)}</div><div className="lbl">Limited Offer</div>
              <div className="kv-list">
                <div className="kv-row"><span className="k">No. of Limited Offers</span><span className="v">{o.limitedOfferCount}</span></div>
                <div className="kv-row"><span className="k">Max L-Offer Ad Days</span><span className="v">{o.maxLimitedOfferDays != null ? `${o.maxLimitedOfferDays}d` : "—"}</span></div>
                <div className="kv-row"><span className="k">Most Active Month</span><span className="v">{o.mostActiveLimitedMonth}</span></div>
              </div>
            </div>
          </div>
          <p className="note-strip">* Discounts are the <b>&ldquo;up to&rdquo;</b> figure advertised in each ad&apos;s copy — e.g. &ldquo;60–90% off&rdquo; is read as up to 90%. Actual discount varies by product/category.</p>
        </div>
        {/* offer types */}
        <div className="card">
          <h3>Offer Types <span className="sub">% of ads · overlapping</span></h3>
          {o.offerTypes.length
            ? <BarRows rows={o.offerTypes.map(t => ({ label: t.label, val: `${nf(t.count)} · ${pct0(t.pct)}`, width: t.pct * 100, fill: "linear-gradient(90deg,#1c6b4c,var(--green))" }))} />
            : <p className="empty">no offer mechanics detected in copy</p>}
          {report.discountHistory.length > 0 && (
            <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>{nf(report.discountHistory.length)} discount ads · max {o.maxDiscountPct}% — download to see each ad&apos;s link, discount % and dates.</span>
              <button className="btn" onClick={() => downloadDiscountCsv(report)}>↓ Download</button>
            </div>
          )}
        </div>
      </div>

      {/* category mix */}
      {catRows.length >= 2 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3>Category Mix <span className="sub">share of categorised ads</span></h3>
          <BarRows rows={catRows.map((r, i) => ({ label: r.label, val: `${nf(r.count)} · ${pct0(r.count / catTotal)}`, width: (r.count / catTotal) * 100, fill: CAT_FILLS[i % CAT_FILLS.length] }))} />
          <p className="note-strip">% of {nf(catTotal)} categorised ads · {nf(otherTotal)} uncategorised (&ldquo;Other&rdquo;) not shown</p>
        </div>
      )}

      <Overview report={report} color={color} />
    </div>
  );
}

// ─── main section ─────────────────────────────────────────────────────────────
export function CompetitorReportSection({ you, competitors }: { you: BrandAds | null; competitors: BrandAds[] }) {
  const reports = useMemo(() => buildCompetitorReportSet(you, competitors), [you, competitors]);
  const [sel, setSel] = useState(0);
  if (!reports.length) return null;

  const colorOf = (i: number) => HUES[i % HUES.length];
  const me = reports[0];
  // Top-threat competitor = the non-you brand with the most active ads.
  const foeIdx = reports.length > 1
    ? reports.map((r, i) => [i, r] as const).slice(1).sort((a, b) => b[1].active - a[1].active)[0][0]
    : 0;
  const foe = reports[foeIdx];
  const hasFoe = foeIdx !== 0;
  const combined = reports.reduce((s, r) => s + r.total, 0);
  const combinedActive = reports.reduce((s, r) => s + r.active, 0);
  const shareYou = me.active + foe.active ? me.active / (me.active + foe.active) : 1;
  const volX = me.active ? foe.active / me.active : 0;
  const verdict = hasFoe ? buildVerdict(me, foe) : null;
  const selReport = reports[sel] ?? me;

  return (
    <div className="tzc">
      <style>{CSS}</style>

      {/* brand bar */}
      <div className="brandbar"><div className="brandbar-inner">
        <div className="brand-copy"><span className="brand-name">{PRODUCT}</span><span className="brand-tag">E-com intelligence · Meta ad analysis</span></div>
      </div></div>

      <div className="wrap">
        {/* masthead */}
        <header className="mast">
          <div className="eyebrow"><span className="dash" />META AD LIBRARY · MEDIA INTELLIGENCE</div>
          <h1>Who to worry about first.</h1>
          <p className="sub">Every brand measured on the same signals from the Ad Library — volume, cadence, longevity, creative churn and the video/static mix. Straight from the ads a brand actually runs.</p>
          <div className="mast-meta">
            <span>Scope: <b>{me.brand}{hasFoe ? ` vs ${foe.brand}` : ""}</b></span>
            <span>Brands tracked: <b>{reports.length}</b></span>
            <span>Combined ads tracked: <b>{nf(combined)}</b></span>
          </div>
        </header>

        {/* hero */}
        <section className="tight">
          <div className="hero-grid">
            <div className="rank-card" style={brandVar(colorOf(0))}>
              <div className="rank-label"><span>{me.brand}</span><span className="pill">reference</span></div>
              <div className="rank-num">{nf(me.active)}</div>
              <div className="rank-sub">active ads · {nf(me.newPerWeek)} launched this week</div>
              <div className="rank-fine">{nf(me.total)} in library · ≈{nf(me.versionsOnMeta)} versions on Meta</div>
            </div>
            {hasFoe && (
              <div className="rank-card" style={brandVar(colorOf(foeIdx))}>
                <div className="rank-label"><span>Rank 01 · {foe.brand}</span><span className="pill">top threat</span></div>
                <div className="rank-num">{nf(foe.active)}</div>
                <div className="rank-sub">active ads · {nf(foe.newPerWeek)} launched this week</div>
                <div className="rank-fine">{nf(foe.total)} in library · ≈{nf(foe.versionsOnMeta)} versions on Meta</div>
              </div>
            )}
          </div>
          {hasFoe && (
            <div className="tugbar-wrap">
              <div className="tugbar-top"><span>Share of combined active-ad volume</span><span>{nf(combinedActive)} active ads tracked</span></div>
              <div className="tugbar">
                <div className="seg" style={{ width: pct1(shareYou), background: colorOf(0), justifyContent: "flex-start", paddingLeft: 12 }}>{pct0(shareYou)}</div>
                <div className="seg" style={{ width: pct1(1 - shareYou), background: colorOf(foeIdx), justifyContent: "flex-end", paddingRight: 12 }}>{foe.brand} {pct0(1 - shareYou)}</div>
              </div>
              <div className="tugbar-foot"><span>{me.brand} · {nf(me.active)} active</span><span>{foe.brand} is running <b style={{ color: colorOf(foeIdx) }}>{volX >= 1 ? `${volX < 10 ? volX.toFixed(1) : Math.round(volX)}×` : `${volX.toFixed(2)}×`}</b> {me.brand}&apos;s ad volume</span></div>
            </div>
          )}
        </section>

        {/* comparison matrix */}
        <section>
          <div className="section-head"><div><div className="tag">Competitor Analysis Report</div><h2>Head-to-head, same six signals</h2></div><div className="section-note">Meta Ad Library · live snapshot</div></div>
          <div className="matrix">
            {reports.map((r, i) => (
              <div className="matrix-row" key={r.brand} style={brandVar(colorOf(i))}>
                <div className="matrix-brand">{r.brand}</div>
                {[nf(r.total), nf(r.active), nf(r.newPerWeek), nf(r.newThisMonth), nf(r.inactive), pct0(r.refreshPct)].map((v, j) => <div className="matrix-cell" key={j}>{v}</div>)}
              </div>
            ))}
            <div className="matrix-labels"><span /><span>Total Ads</span><span>Active Ads</span><span>New/Week</span><span>New/Month</span><span>Inactive</span><span>Refresh</span></div>
          </div>
        </section>

        {/* detail */}
        <section>
          <div className="section-head"><div><div className="tag">Detailed Report</div><h2>Pick a brand to drill in</h2></div>
            <div className="toggle-bar">
              {reports.map((r, i) => (
                <button key={r.brand} className={sel === i ? "active" : ""} style={sel === i ? { background: colorOf(i), color: "#fff" } : undefined} onClick={() => setSel(i)}>{r.brand}</button>
              ))}
            </div>
          </div>
          <DetailPanel report={selReport} color={colorOf(sel)} />
        </section>

        {/* signals */}
        {hasFoe && (
          <section>
            <div className="section-head"><div><div className="tag">Beyond The Standard Report</div><h2>Signals you wouldn&apos;t have seen</h2></div><div className="section-note">mined from raw ad copy, dates &amp; destinations</div></div>
            <div className="sig-legend">
              <div className="lg"><span className="dot" style={{ background: colorOf(0) }} />{me.brand}</div>
              <div className="lg"><span className="dot" style={{ background: colorOf(foeIdx) }} />{foe.brand}</div>
            </div>

            {/* festive event log */}
            <div className="card" style={{ marginBottom: 18 }}>
              <h3>Festive &amp; Sale Event Log <span className="sub">named campaigns detected in ad copy</span></h3>
              <div className="sig-grid" style={{ marginBottom: 0 }}>
                {[me, foe].map((b, bi) => (
                  <div className="event-col" key={bi}>
                    <h4 style={{ color: colorOf(bi === 0 ? 0 : foeIdx) }}>{b.brand}</h4>
                    {b.festiveEvents.length ? b.festiveEvents.slice(0, 6).map(e => (
                      <div className="event-row" key={e.name}>
                        <span className="event-name">{e.name} {e.live ? <span className="event-tag live">Live</span> : e.year ? <span className="event-tag">Historical · {e.year}</span> : null}</span>
                        <span className="event-count">{nf(e.count)} ads</span>
                      </div>
                    )) : <p className="empty">no named sale events detected</p>}
                  </div>
                ))}
              </div>
              <p className="sig-footnote">Oldest creative on record — {me.brand}: <b>{me.earliestAdMonth ?? "n/a"}</b>; {foe.brand}: <b>{foe.earliestAdMonth ?? "n/a"}</b>. A longer history is a multi-year sale-calendar fingerprint.</p>
            </div>

            {/* launch cadence */}
            <div className="card" style={{ marginBottom: 18 }}>
              <h3>Launch Cadence <span className="sub">% of that brand&apos;s ads, by weekday started</span></h3>
              {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day, di) => (
                <div className="pairrow" key={day}>
                  <span className="plabel">{day}</span>
                  {[me, foe].map((b, bi) => (
                    <div className="pair-bar" key={bi}>
                      <div className="pb-top"><span>{b.brand}</span><span>{pct1(b.launchCadence[di] ?? 0)}</span></div>
                      <div className="track"><div className="fill" style={{ width: pct1(b.launchCadence[di] ?? 0), background: colorOf(bi === 0 ? 0 : foeIdx) }} /></div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="grid-2" style={{ marginBottom: 18 }}>
              {/* creative churn */}
              <div className="card">
                <h3>Creative Churn Profile <span className="sub">% of ads by lifespan</span></h3>
                {me.churnBuckets.map((bucket, ci) => (
                  <div className="pairrow" key={bucket.label}>
                    <span className="plabel">{bucket.label}</span>
                    {[me, foe].map((b, bi) => (
                      <div className="pair-bar" key={bi}>
                        <div className="pb-top"><span>{b.brand}</span><span>{pct1(b.churnBuckets[ci]?.pct ?? 0)}</span></div>
                        <div className="track"><div className="fill" style={{ width: pct1(b.churnBuckets[ci]?.pct ?? 0), background: colorOf(bi === 0 ? 0 : foeIdx) }} /></div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {/* concentration */}
              <div className="card">
                <h3>Creative Concentration Index <span className="sub">distinct concepts vs total ads</span></h3>
                <div className="concentration-grid">
                  {[me, foe].map((b, bi) => (
                    <div className="conc-card" key={bi}>
                      <div className="cbrand" style={{ color: colorOf(bi === 0 ? 0 : foeIdx) }}>{b.brand}</div>
                      <div className="cnum" style={{ color: colorOf(bi === 0 ? 0 : foeIdx) }}>{nf(b.concentration.concepts)}</div>
                      <div className="clbl">Distinct concepts / {nf(b.total)} ads</div>
                      <div className="cnote">{b.concentration.variantsPerConcept.toFixed(1)} variants per concept avg.<br />Top concept = <b style={{ color: "var(--text)" }}>{pct1(b.concentration.topConceptPct)}</b> of the library.</div>
                    </div>
                  ))}
                </div>
                <p className="sig-footnote">Grouped by near-duplicate opening copy — brand-agnostic, doesn&apos;t rely on any platform-specific variant field.</p>
              </div>
            </div>

            <div className="grid-2">
              {/* emoji density */}
              <div className="card">
                <h3>Copy Tone · Emoji Density <span className="sub">emoji groups per ad, full body copy</span></h3>
                {(() => {
                  const mx = Math.max(0.01, me.emojiPerAd, foe.emojiPerAd);
                  return <BarRows rows={[
                    { label: me.brand, val: `${me.emojiPerAd.toFixed(2)} / ad`, width: (me.emojiPerAd / mx) * 100, fill: colorOf(0) },
                    { label: foe.brand, val: `${foe.emojiPerAd.toFixed(2)} / ad`, width: (foe.emojiPerAd / mx) * 100, fill: colorOf(foeIdx) },
                  ]} />;
                })()}
                <p className="sig-footnote">Emoji-per-ad is a proxy for copy tone: higher = punchier, more casual.</p>
              </div>
              {/* price anchors */}
              <div className="card">
                <h3>Price-Anchor Psychology <span className="sub">&ldquo;under ₹X&rdquo; mentions in ad copy</span></h3>
                {(() => {
                  const ma = me.priceAnchors[0], fa = foe.priceAnchors[0];
                  const mx = Math.max(1, ma?.count ?? 0, fa?.count ?? 0);
                  const rows = [] as { label: string; val: string; width: number; fill: string }[];
                  if (ma) rows.push({ label: `${me.brand} — ${ma.anchor}`, val: `${nf(ma.count)} mentions`, width: (ma.count / mx) * 100, fill: colorOf(0) });
                  if (fa) rows.push({ label: `${foe.brand} — ${fa.anchor}`, val: `${nf(fa.count)} mentions`, width: (fa.count / mx) * 100, fill: colorOf(foeIdx) });
                  return rows.length ? <BarRows rows={rows} /> : <p className="empty">no low-price anchors detected in copy</p>;
                })()}
                <p className="sig-footnote">A repeated low-price anchor is a signature acquisition hook.</p>
              </div>
            </div>
          </section>
        )}

        {/* library */}
        <section>
          <div className="section-head"><div><div className="tag">Ad Library</div><h2>{nf(combined)} ads across {reports.length} brand{reports.length !== 1 ? "s" : ""}</h2></div><div className="section-note">brand · link · format · destination · platforms · language · influencer · CTA · discount · offer type</div></div>
          <div className="lib-grid">
            {reports.map((r, i) => (
              <div className="lib-card" key={r.brand} style={{ borderColor: colorOf(i) + "55" }}>
                <h4 style={{ color: colorOf(i) }}>{r.brand}</h4>
                <p>{nf(r.total)} ads — raw export, discount-tagged subset, and influencer-tagged subset.</p>
                <div className="lib-btns">
                  <button className="btn" onClick={() => downloadRawCsv([r], `${slug(r.brand)}-ads.csv`)}>Full raw data ({nf(r.total)} ads) <span>↓</span></button>
                  <button className="btn" disabled={!r.discountHistory.length} onClick={() => downloadDiscountCsv(r)}>Discount ads ({nf(r.discountHistory.length)}) <span>↓</span></button>
                  <button className="btn" disabled={!r.influencerCount} onClick={() => downloadInfluencerCsv(r)}>Influencer ads ({nf(r.influencerCount)}) <span>↓</span></button>
                </div>
              </div>
            ))}
          </div>
          {reports.length > 1 && (
            <div style={{ marginTop: 14 }}>
              <button className="btn" onClick={() => downloadRawCsv(reports)}>↓ Download combined raw data ({nf(reports.reduce((s, r) => s + r.adsTable.length, 0))} ads)</button>
            </div>
          )}
        </section>

        {/* findings */}
        {verdict && (
          <section>
            <div className="section-head"><div><div className="tag">Final Verdict</div><h2>Who to worry about, and why</h2></div></div>
            <div className="headline-box">Threat level: {verdict.ratio >= 3 ? "high, and accelerating" : verdict.ratio >= 1.3 ? "material" : "contained"}. {foe.brand} is running {verdict.ratio >= 1 ? `${verdict.ratio < 10 ? verdict.ratio.toFixed(1) : Math.round(verdict.ratio)}×` : `${verdict.ratio.toFixed(2)}×`} your ad volume{verdict.spendX >= 2 ? ` — and very likely ${Math.round(verdict.spendX * 0.85)}–${Math.round(verdict.spendX)}× your Meta spend.` : "."}</div>
            <div className="findings-grid verdict">
              {verdict.out.map((f, i) => (
                <div className="finding-card" key={i}>
                  <div className="ftag" style={{ color: f.color }}>{f.tag}</div>
                  {f.kind === "stat" && f.stat && (
                    <div className="verdict-stat"><span className="vnum">{f.stat.num}</span><span className="vlbl">{f.stat.lbl}</span></div>
                  )}
                  <ul>{f.items.map((it, j) => <li key={j}>{it}</li>)}</ul>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer><p>{PRODUCT} · Meta Ad Library, slimmed export · same-signals competitive benchmark</p></footer>
      </div>
    </div>
  );
}

// ─── scoped CSS (ported from the target report; brand-scoped rules use --brandc) ─
const CSS = `
.tzc{
  --bg:#F3F4FA;--surface:#FFFFFF;--surface-2:#F4F5FB;--border:#E7E8F2;--border-soft:#EEEFF7;
  --text:#181A2A;--text-dim:#6B6F87;--text-faint:#9799AE;
  --amazon:#4C5FE0;--flipkart:#EC7F2E;--green:#1FAE72;--pink:#E64888;--risk:#E14A42;
  --shadow:0 1px 2px rgba(24,26,42,0.04),0 4px 16px rgba(24,26,42,0.05);
  --mono:var(--font-mono),'IBM Plex Mono',ui-monospace,monospace;--display:var(--font-display),'Space Grotesk',sans-serif;--body:var(--font-sans),'Inter',system-ui,sans-serif;
  --brandc:#4C5FE0;
  background:radial-gradient(1200px 600px at 85% -10%,rgba(76,95,224,0.06),transparent 60%),radial-gradient(1000px 500px at 10% 0%,rgba(236,127,46,0.05),transparent 55%),var(--bg);
  color:var(--text);font-family:var(--body);line-height:1.5;border-radius:16px;overflow:hidden;border:1px solid var(--border);
}
.tzc *{box-sizing:border-box;}
.tzc .brandbar{border-bottom:1px solid var(--border-soft);background:#fff;}
.tzc .brandbar-inner{display:flex;align-items:center;gap:14px;padding:16px 28px;}
.tzc .brand-copy{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
.tzc .brand-name{font-family:var(--display);font-weight:700;font-size:15px;letter-spacing:.02em;color:var(--text);}
.tzc .brand-tag{font-family:var(--mono);font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.08em;}
.tzc .wrap{max-width:1180px;margin:0 auto;padding:0 28px;}
.tzc .eyebrow{font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-faint);display:flex;align-items:center;gap:10px;}
.tzc .eyebrow .dash{width:22px;height:1px;background:var(--text-faint);display:inline-block;}
.tzc a{color:inherit;}
.tzc header.mast{padding:44px 0 30px;border-bottom:1px solid var(--border-soft);}
.tzc header.mast h1{font-family:var(--display);font-weight:600;font-size:clamp(30px,4vw,48px);margin:16px 0 12px;letter-spacing:-.02em;max-width:14ch;}
.tzc header.mast p.sub{color:var(--text-dim);max-width:640px;font-size:15px;margin:0 0 20px;}
.tzc .mast-meta{display:flex;gap:22px;flex-wrap:wrap;font-family:var(--mono);font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.06em;}
.tzc .mast-meta b{color:var(--text-dim);font-weight:500;}
.tzc section{padding:44px 0;border-bottom:1px solid var(--border-soft);}
.tzc section.tight{padding:34px 0;}
.tzc .section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:24px;flex-wrap:wrap;}
.tzc .section-head h2{font-family:var(--display);font-size:24px;font-weight:600;margin:6px 0 0;letter-spacing:-.01em;}
.tzc .section-head .tag{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-faint);}
.tzc .section-note{font-family:var(--mono);font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.05em;}
.tzc .hero-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:24px;}
.tzc .rank-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:26px 26px 24px;position:relative;overflow:hidden;box-shadow:var(--shadow);border-color:color-mix(in srgb,var(--brandc) 30%,var(--border));}
.tzc .rank-card::after{content:"";position:absolute;top:-40%;right:-20%;width:220px;height:220px;border-radius:50%;filter:blur(60px);opacity:.16;background:var(--brandc);}
.tzc .rank-label{display:flex;justify-content:space-between;align-items:center;font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-faint);margin-bottom:16px;position:relative;z-index:1;}
.tzc .rank-label .pill{padding:3px 10px;border-radius:20px;font-size:10px;border:1px solid color-mix(in srgb,var(--brandc) 35%,var(--border));color:var(--brandc);}
.tzc .rank-num{font-family:var(--display);font-size:52px;font-weight:700;line-height:1;position:relative;z-index:1;color:var(--brandc);}
.tzc .rank-sub{color:var(--text-dim);font-size:13.5px;margin-top:10px;position:relative;z-index:1;}
.tzc .rank-fine{font-family:var(--mono);font-size:11px;color:var(--text-faint);margin-top:6px;position:relative;z-index:1;}
.tzc .tugbar-wrap{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:22px 26px;box-shadow:var(--shadow);}
.tzc .tugbar-top{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;}
.tzc .tugbar{height:34px;border-radius:8px;overflow:hidden;display:flex;border:1px solid var(--border);}
.tzc .tugbar .seg{display:flex;align-items:center;font-family:var(--mono);font-size:12px;font-weight:600;color:#fff;transition:width 1.1s cubic-bezier(.16,1,.3,1);}
.tzc .tugbar-foot{display:flex;justify-content:space-between;margin-top:10px;font-size:12px;color:var(--text-dim);}
.tzc .matrix{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:22px 26px 26px;box-shadow:var(--shadow);overflow-x:auto;}
.tzc .matrix-row{display:grid;grid-template-columns:120px repeat(6,minmax(56px,1fr));gap:10px;align-items:center;margin-bottom:10px;}
.tzc .matrix-brand{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-dim);}
.tzc .matrix-cell{border-radius:8px;padding:12px 6px;text-align:center;font-family:var(--display);font-weight:600;font-size:18px;border:1px solid color-mix(in srgb,var(--brandc) 22%,var(--border));background:color-mix(in srgb,var(--brandc) 10%,transparent);color:var(--brandc);}
.tzc .matrix-labels{display:grid;grid-template-columns:120px repeat(6,minmax(56px,1fr));gap:10px;margin-top:12px;}
.tzc .matrix-labels span{text-align:center;font-family:var(--mono);font-size:10px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.04em;}
.tzc .toggle-bar{display:flex;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:30px;padding:4px;width:max-content;max-width:100%;overflow-x:auto;flex-wrap:wrap;}
.tzc .toggle-bar button{font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.06em;background:none;border:none;color:var(--text-faint);padding:9px 18px;border-radius:24px;cursor:pointer;transition:.25s;white-space:nowrap;}
.tzc .panel{animation:tzcfade .5s ease;}
@keyframes tzcfade{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}
.tzc .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
.tzc .card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:22px 24px;box-shadow:var(--shadow);}
.tzc .card h3{font-family:var(--mono);font-size:11.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-faint);margin:0 0 18px;font-weight:500;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;}
.tzc .card h3 .sub{color:var(--text-faint);font-weight:400;text-transform:none;letter-spacing:0;font-size:10.5px;}
.tzc .empty{font-family:var(--mono);font-size:12px;color:var(--text-faint);padding:8px 0;}
.tzc .ov-controls{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;}
.tzc .seg-toggle{display:flex;gap:6px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:3px;}
.tzc .seg-toggle button{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.05em;background:none;border:none;color:var(--text-faint);padding:6px 12px;border-radius:6px;cursor:pointer;transition:.2s;}
.tzc .seg-toggle button.active{background:var(--brandc);color:#fff;}
.tzc .ov-caption{font-family:var(--mono);font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.04em;}
.tzc .ov-legend{display:flex;gap:18px;flex-wrap:wrap;margin-top:14px;padding-left:38px;}
.tzc .ov-legend .lg{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text-dim);}
.tzc .ov-legend .lg .sw{width:14px;height:3px;border-radius:2px;}
.tzc .chartbox{position:relative;height:200px;margin-top:6px;}
.tzc .chart-months{display:flex;justify-content:space-between;font-family:var(--mono);font-size:9.5px;color:var(--text-faint);margin-top:6px;padding-left:38px;gap:2px;}
.tzc .chart-months span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tzc .barrow{margin-bottom:16px;}
.tzc .barrow:last-child{margin-bottom:0;}
.tzc .barrow .toprow{display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:7px;gap:8px;}
.tzc .barrow .toprow b{font-weight:500;}
.tzc .barrow .toprow .val{font-family:var(--mono);font-size:12.5px;color:var(--text-dim);white-space:nowrap;}
.tzc .track{height:7px;border-radius:5px;background:var(--surface-2);overflow:hidden;}
.tzc .fill{height:100%;border-radius:5px;transition:width 1s cubic-bezier(.16,1,.3,1);}
.tzc .statpair{display:flex;gap:14px;flex-wrap:wrap;}
.tzc .stat-lg{flex:1;min-width:180px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:16px 18px;}
.tzc .stat-lg .num{font-family:var(--display);font-size:32px;font-weight:700;}
.tzc .stat-lg .lbl{font-family:var(--mono);font-size:10.5px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.06em;margin-top:6px;}
.tzc .kv-list{margin-top:14px;font-size:13px;}
.tzc .kv-row{display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid var(--border-soft);}
.tzc .kv-row:first-child{border-top:none;}
.tzc .kv-row .k{color:var(--text-dim);}
.tzc .kv-row .v{font-family:var(--mono);font-weight:600;}
.tzc .kv-row .v a{color:var(--brandc);text-decoration:none;font-size:11px;margin-left:6px;}
.tzc .donut-wrap{display:flex;align-items:center;gap:22px;flex-wrap:wrap;}
.tzc .donut{width:108px;height:108px;border-radius:50%;flex:none;}
.tzc .legend div{display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:8px;}
.tzc .legend .dot{width:9px;height:9px;border-radius:50%;}
.tzc .legend b{font-family:var(--mono);margin-left:auto;padding-left:14px;}
.tzc .influencer-big{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.tzc .influencer-num{font-family:var(--display);font-size:44px;font-weight:700;}
.tzc .influencer-desc{color:var(--text-dim);font-size:13px;max-width:280px;}
.tzc .btn{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.06em;border:1px solid var(--border);background:var(--surface-2);color:var(--text);padding:10px 16px;border-radius:8px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:space-between;gap:8px;transition:.2s;white-space:nowrap;}
.tzc .btn:hover{border-color:var(--text-dim);}
.tzc .btn:disabled{opacity:.45;cursor:not-allowed;}
.tzc .note-strip{font-size:11.5px;color:var(--text-faint);margin-top:14px;line-height:1.6;}
.tzc .note-strip b{color:var(--text-dim);}
.tzc .sig-legend{display:flex;gap:22px;margin-bottom:20px;flex-wrap:wrap;}
.tzc .sig-legend .lg{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text-dim);}
.tzc .sig-legend .dot{width:9px;height:9px;border-radius:50%;}
.tzc .sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px;}
.tzc .event-col h4{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 10px;}
.tzc .event-row{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-top:1px solid var(--border-soft);gap:10px;}
.tzc .event-row:first-of-type{border-top:none;}
.tzc .event-name{font-size:13.5px;font-weight:500;}
.tzc .event-tag{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:20px;border:1px solid var(--border);color:var(--text-faint);margin-left:8px;white-space:nowrap;}
.tzc .event-tag.live{color:var(--green);border-color:rgba(62,214,152,.4);}
.tzc .event-count{font-family:var(--mono);font-size:12.5px;color:var(--text-dim);white-space:nowrap;}
.tzc .sig-footnote{font-size:11.5px;color:var(--text-faint);margin-top:16px;line-height:1.6;}
.tzc .sig-footnote b{color:var(--text-dim);}
.tzc .pairrow{display:grid;grid-template-columns:80px 1fr 1fr;gap:18px;align-items:center;margin-bottom:15px;}
.tzc .pairrow:last-child{margin-bottom:0;}
.tzc .pairrow .plabel{font-size:12.5px;color:var(--text-dim);}
.tzc .pair-bar .pb-top{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--text-faint);margin-bottom:5px;gap:6px;}
.tzc .concentration-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.tzc .conc-card{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:18px 20px;}
.tzc .conc-card .cbrand{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.06em;}
.tzc .conc-card .cnum{font-family:var(--display);font-size:34px;font-weight:700;line-height:1.1;margin-top:4px;}
.tzc .conc-card .clbl{font-size:11.5px;color:var(--text-dim);margin-top:2px;}
.tzc .conc-card .cnote{font-size:11.5px;color:var(--text-faint);margin-top:10px;line-height:1.5;}
.tzc .lib-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
.tzc .lib-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:22px 24px;box-shadow:var(--shadow);}
.tzc .lib-card h4{font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 4px;}
.tzc .lib-card p{font-size:12.5px;color:var(--text-faint);margin:0 0 16px;}
.tzc .lib-btns{display:flex;flex-direction:column;gap:9px;}
.tzc .lib-btns .btn{width:100%;}
.tzc .findings-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:22px;}
.tzc .findings-grid.verdict{grid-template-columns:1fr 1fr;}
.tzc .finding-card{border:1px solid var(--border);border-radius:12px;padding:18px 20px;background:var(--surface);box-shadow:var(--shadow);}
.tzc .finding-card .ftag{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px;}
.tzc .finding-card ul{margin:0;padding-left:18px;}
.tzc .finding-card li{font-size:13px;color:var(--text-dim);line-height:1.65;margin-bottom:8px;}
.tzc .finding-card li:last-child{margin-bottom:0;}
.tzc .finding-card li b{color:var(--text);font-weight:600;}
.tzc .verdict-stat{display:flex;align-items:baseline;gap:10px;margin-bottom:14px;}
.tzc .verdict-stat .vnum{font-family:var(--display);font-size:34px;font-weight:700;color:var(--risk);}
.tzc .verdict-stat .vlbl{font-size:12.5px;color:var(--text-dim);max-width:26ch;}
.tzc .headline-box{border-left:2px solid var(--amazon);padding-left:18px;font-family:var(--display);font-size:19px;font-weight:500;color:var(--text);max-width:70ch;}
.tzc footer{padding:30px 0 44px;text-align:center;}
.tzc footer p{font-family:var(--mono);font-size:11px;color:var(--text-faint);letter-spacing:.04em;}
@media(max-width:720px){.tzc .grid-2,.tzc .hero-grid,.tzc .sig-grid,.tzc .concentration-grid,.tzc .lib-grid,.tzc .findings-grid.verdict{grid-template-columns:1fr;}.tzc .pairrow{grid-template-columns:60px 1fr 1fr;gap:10px;}}
`;
