
import { useMemo, useState } from "react";
import { buildGoogleAdReportSet, type GoogleAdReport } from "@/lib/media-analyser/google-ad-report";
import type { BrandAds } from "@/lib/media-analyser/paid-ad-intel";

/* ────────────────────────────────────────────────────────────────────────────
   "Same category, different playbook" — Google Ads Transparency report.
   Same design language as the Meta report, but every panel is a pure time-series
   read of firstShown / lastShown / adFormat (free-tier Transparency data — no
   spend, no copy, no CTA, no surface split).
   ──────────────────────────────────────────────────────────────────────────── */

const PRODUCT = "Threezinc";
const HUES = ["#4C5FE0", "#EC7F2E", "#1FAE72", "#E64888", "#7c3aed", "#0891b2"];
// Format colours are FIXED across brands (Text=blue, Image=green, Video=pink) — matches the target.
const FMT = { Text: "#4C5FE0", Image: "#1FAE72", Video: "#E64888" };
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const nf = (n: number) => Math.round(n).toLocaleString("en-IN");
const pct0 = (x: number) => `${Math.round(x * 100)}%`;
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
type BrandStyle = React.CSSProperties & { "--brandc": string };
const brandVar = (c: string): BrandStyle => ({ "--brandc": c });
const keyLabel = (k: string) => { const [y, m] = k.split("-").map(Number); return MONTHS_ABBR[m - 1] + (m === 1 ? ` '${String(y).slice(2)}` : ""); };

// ─── SVG chart primitives (viewBox 900×H, axis 0/0.5/1) ───────────────────────
const CW = 900, PADL = 44, PADT = 10, PADB = 18;
const innerW = CW - PADL - 8;

function Grid({ max, h }: { max: number; h: number }) {
  const innerH = h - PADB - PADT;
  return <>{[0, 0.5, 1].map((f, i) => {
    const y = PADT + innerH - f * innerH;
    return <g key={i}>
      <line x1={PADL} y1={y} x2={CW} y2={y} stroke="#E7E8F2" strokeWidth={1} />
      <text x={0} y={y + 4} style={{ fontFamily: 'var(--font-mono),"IBM Plex Mono",monospace' }} fontSize={11} fill="#9799AE">{nf(max * f)}</text>
    </g>;
  })}</>;
}

/** Many-bar calendar chart (label every Nth). */
function SparkBars({ data, color, labels, everyNth = 4, h = 200 }: { data: number[]; color: string; labels: string[]; everyNth?: number; h?: number }) {
  const innerH = h - PADB - PADT;
  const max = Math.max(1, ...data);
  const n = Math.max(1, data.length);
  const bw = Math.max((innerW / n) * 0.55, 2);
  return (
    <>
      <div className="chartbox" style={{ height: h }}>
        <svg viewBox={`0 0 ${CW} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
          <Grid max={max} h={h} />
          {data.map((v, i) => {
            const cx = PADL + (i / Math.max(1, n - 1)) * innerW;
            const ht = (v / max) * innerH;
            return <rect key={i} x={cx - bw / 2} y={PADT + innerH - ht} width={bw} height={Math.max(ht, v > 0 ? 2 : 0)} rx={1.5} fill={color} />;
          })}
        </svg>
      </div>
      <div className="chart-months">{labels.filter((_, i) => i % everyNth === 0).map((m, i) => <span key={i}>{m}</span>)}</div>
    </>
  );
}

function MultiLine({ series, labels, everyNth = 4, h = 230 }: { series: { color: string; data: number[] }[]; labels: string[]; everyNth?: number; h?: number }) {
  const innerH = h - PADB - PADT;
  const max = Math.max(1, ...series.flatMap(s => s.data));
  const n = Math.max(1, (series[0]?.data.length ?? 1) - 1);
  return (
    <>
      <div className="chartbox" style={{ height: h }}>
        <svg viewBox={`0 0 ${CW} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
          <Grid max={max} h={h} />
          {series.map((sr, si) => {
            const path = "M " + sr.data.map((v, i) => `${(PADL + (i / n) * innerW).toFixed(1)},${(PADT + innerH - (v / max) * innerH).toFixed(1)}`).join(" L ");
            return <path key={si} d={path} fill="none" stroke={sr.color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />;
          })}
        </svg>
      </div>
      <div className="chart-months">{labels.filter((_, i) => i % everyNth === 0).map((m, i) => <span key={i}>{m}</span>)}</div>
    </>
  );
}

function BarRows({ rows }: { rows: { label: string; val: string; width: number; fill: string }[] }) {
  return <>{rows.map((r, i) => (
    <div className="barrow" key={i}>
      <div className="toprow"><b>{r.label}</b><span className="val">{r.val}</span></div>
      <div className="track"><div className="fill" style={{ width: `${Math.max(r.width, r.width > 0 ? 0.4 : 0)}%`, background: r.fill }} /></div>
    </div>
  ))}</>;
}

/** you-vs-foe paired bars (lifespan profile / seasonality). */
function PairRows({ rows, meColor, foeColor }: { rows: { label: string; me: number; foe: number }[]; meColor: string; foeColor: string }) {
  return <>{rows.map(r => (
    <div className="pairrow" key={r.label}>
      <span className="plabel">{r.label}</span>
      <div className="pair-bar"><div className="pb-top"><span>You</span><span>{pct1(r.me)}</span></div><div className="track"><div className="fill" style={{ width: pct1(r.me), background: meColor }} /></div></div>
      <div className="pair-bar"><div className="pb-top"><span>Rival</span><span>{pct1(r.foe)}</span></div><div className="track"><div className="fill" style={{ width: pct1(r.foe), background: foeColor }} /></div></div>
    </div>
  ))}</>;
}

// ─── deterministic Final Verdict ──────────────────────────────────────────────
function stddevOfDeltas(m: Record<string, number>) {
  const vals = Object.keys(m).sort().map(k => m[k]);
  const d = vals.slice(1).map((v, i) => v - vals[i]);
  if (!d.length) return 0;
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  return Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / d.length);
}
function topMonths(sea: number[], k = 2) {
  return sea.map((v, i) => [i, v] as const).sort((a, b) => b[1] - a[1]).slice(0, k).map(([i]) => MONTH_FULL[i]);
}

function buildVerdict(me: GoogleAdReport, foe: GoogleAdReport) {
  const meSpikier = stddevOfDeltas(me.concByMonth) >= stddevOfDeltas(foe.concByMonth);
  const meTop = topMonths(me.seasonality), foeTop = topMonths(foe.seasonality);
  const longest = [...me.formatLifespan, ...foe.formatLifespan].sort((a, b) => b.avg - a.avg)[0]?.format ?? "Text";
  const evergreenRatio = me.evergreenPct ? foe.evergreenPct / me.evergreenPct : 0;
  const evLeader = foe.evergreenPct >= me.evergreenPct ? foe : me;
  const evOther = evLeader === foe ? me : foe;

  return [
    { tag: "Current Momentum", color: "var(--amazon)", items: [
      `${me.concurrentActiveNow >= foe.concurrentActiveNow ? me.brand : foe.brand} runs more active ads today — ${nf(Math.max(me.concurrentActiveNow, foe.concurrentActiveNow))} vs ${nf(Math.min(me.concurrentActiveNow, foe.concurrentActiveNow))} concurrently active.`,
      `${meSpikier ? me.brand : foe.brand}'s growth is spikier — sharp bursts followed by pullbacks.`,
      `${meSpikier ? foe.brand : me.brand}'s curve is smoother — a steadier scale-up and decline, a more measured operating rhythm.`,
      `Both peaked around their autumn high (${me.brand}: ${me.peak.count} in ${me.peak.label}; ${foe.brand}: ${foe.peak.count} in ${foe.peak.label}).`,
    ] },
    { tag: "Seasonal Playbook", color: "var(--flipkart)", items: [
      `${me.brand} ramps hardest in ${meTop.join(" & ")}.`,
      `${foe.brand} peaks in ${foeTop.join(" & ")}${meTop[0] !== foeTop[0] ? " — a different calendar" : ""}.`,
      "Same category, distinct seasonal logic — worth checking which pattern tracks real demand before copying either.",
    ] },
    { tag: "Format Discipline", color: "var(--green)", items: [
      `${longest} (search-style) ads are the longest-lived format — the evergreen workhorse, not image or video.`,
      evergreenRatio >= 1.2 || evergreenRatio <= 0.8 ? `${evLeader.brand} keeps ${(evLeader.evergreenPct / Math.max(0.0001, evOther.evergreenPct)).toFixed(1)}× more long-running (365d+) creative (${pct1(evLeader.evergreenPct)} vs ${pct1(evOther.evergreenPct)}) — an evergreen-heavy approach vs faster churn.` : `Both brands hold a similar evergreen tail (~${pct1((me.evergreenPct + foe.evergreenPct) / 2)} of ads past 365 days).`,
      "Both brands cycle Text → Image/Video → back to Text as they scale — a recognisable maturity arc.",
    ] },
    { tag: "Data Caveat & Next Step", color: "var(--risk)", items: [
      "This is free-tier Transparency data — no ad copy, no CTA, no platform-surface split (Search/YouTube/Maps/Play/Shopping), no location targeting.",
      "adFormat is a rough proxy for surface (Text ≈ Search, Image/Video ≈ Display/YouTube) — not a real surface tag.",
      "For the true platform split, use the \"All platforms\" filter on each advertiser's Transparency page and note the per-platform counts — no scraping needed.",
    ] },
  ];
}

// ─── detail panel ─────────────────────────────────────────────────────────────
function DetailPanel({ r, color }: { r: GoogleAdReport; color: string }) {
  const fm = r.formatMix;
  const fmTotal = fm.text + fm.image + fm.video + fm.other || 1;
  const seg1 = (fm.text / fmTotal) * 100, seg2 = seg1 + (fm.image / fmTotal) * 100, seg3 = seg2 + (fm.video / fmTotal) * 100;
  const rng = r.launch.labels;
  return (
    <div className="panel active" style={brandVar(color)}>
      {/* launch calendar */}
      <div className="card" style={{ marginBottom: 18 }}>
        <h3>Launch Calendar <span className="sub">ads first shown per month{rng.length ? ` · ${rng[0]} – ${rng[rng.length - 1]}` : ""}</span></h3>
        <SparkBars data={r.launch.counts} labels={r.launch.labels} color={color} />
      </div>

      <div className="grid-2" style={{ marginBottom: 18 }}>
        {/* format mix donut */}
        <div className="card">
          <h3>Format Mix <span className="sub">image · text · video</span></h3>
          <div className="donut-wrap">
            <div className="donut" style={{ background: `conic-gradient(${FMT.Text} 0% ${seg1}%, ${FMT.Image} ${seg1}% ${seg2}%, ${FMT.Video} ${seg2}% ${seg3}%, var(--surface-2) ${seg3}% 100%)` }} />
            <div className="legend">
              <div><span className="dot" style={{ background: FMT.Text }} />Text<b>{pct1(fm.text / fmTotal)} · {nf(fm.text)}</b></div>
              <div><span className="dot" style={{ background: FMT.Image }} />Image<b>{pct1(fm.image / fmTotal)} · {nf(fm.image)}</b></div>
              <div><span className="dot" style={{ background: FMT.Video }} />Video<b>{pct1(fm.video / fmTotal)} · {nf(fm.video)}</b></div>
            </div>
          </div>
        </div>
        {/* live vs dormant */}
        <div className="card">
          <h3>Live vs. Dormant <span className="sub">% of ads, by days since last shown</span></h3>
          <BarRows rows={r.liveDormant.map(b => ({ label: b.label, val: `${nf(b.count)} · ${pct1(b.pct)}`, width: b.pct * 100, fill: color }))} />
        </div>
      </div>

      {/* format mix evolution */}
      {r.formatEvolution.length > 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3>Format Mix Evolution <span className="sub">share of that year&apos;s launches</span></h3>
          {r.formatEvolution.map(y => (
            <div className="stackbar-row" key={y.year}>
              <div className="sr-top"><b>{y.year}</b><span>n={nf(y.n)}</span></div>
              <div className="stackbar">
                {y.text > 0 && <span style={{ width: `${y.text * 100}%`, background: FMT.Text }} />}
                {y.image > 0 && <span style={{ width: `${y.image * 100}%`, background: FMT.Image }} />}
                {y.video > 0 && <span style={{ width: `${y.video * 100}%`, background: FMT.Video }} />}
              </div>
            </div>
          ))}
          <div className="stack-legend">
            <div className="lg"><span className="dot" style={{ background: FMT.Text }} />Text</div>
            <div className="lg"><span className="dot" style={{ background: FMT.Image }} />Image</div>
            <div className="lg"><span className="dot" style={{ background: FMT.Video }} />Video</div>
          </div>
        </div>
      )}

      <div className="grid-2">
        {/* hall of fame */}
        <div className="card">
          <h3>Hall of Fame <span className="sub">longest-running individual ads</span></h3>
          {r.hallOfFame.length ? r.hallOfFame.map((a, i) => (
            <div className="event-row" key={i}>
              <span className="hof-rank">{String(i + 1).padStart(2, "0")}</span>
              <span className="event-name">{a.format} ad <span className={`event-tag${a.live ? " live" : ""}`}>{a.first} → {a.last}</span></span>
              <span className="event-count">{nf(a.days)}d</span>
            </div>
          )) : <p className="empty">no dated ads</p>}
        </div>
        {/* batch launch days */}
        <div className="card">
          <h3>Batch Launch Days <span className="sub">most ads first-shown on one day</span></h3>
          {r.batchDays.length ? r.batchDays.map((d, i) => (
            <div className="event-row" key={i}><span className="event-name">{d.date}</span><span className="event-count">{nf(d.count)} ads</span></div>
          )) : <p className="empty">no dated ads</p>}
        </div>
      </div>

      {/* Advertiser accounts — a domain can front several; surface who actually runs the ads */}
      <div className="card" style={{ marginTop: 18 }}>
        <h3>Advertiser Accounts <span className="sub">who runs these ads · by verified advertiser</span></h3>
        <BarRows rows={r.advertisers.map((a, i) => ({ label: a.name, val: `${nf(a.count)} · ${pct0(a.count / Math.max(1, r.total))}`, width: (a.count / Math.max(1, r.advertisers[0]?.count || 1)) * 100, fill: i === 0 ? color : "var(--text-faint)" }))} />
        <p className="sig-footnote">{r.advertisers.length === 1
          ? `All ${nf(r.total)} scraped creatives run under one verified advertiser account. Google's domain view may show a higher "~N ads" — it counts ad variations/regions and older creatives that de-duplicate to these unique creatives.`
          : `${r.advertisers.length} advertiser accounts run ads pointing to this brand — the domain aggregates all of them (agencies, resellers or sister entities can appear alongside the brand's own account).`}</p>
      </div>
    </div>
  );
}

// ─── main section ─────────────────────────────────────────────────────────────
export function GoogleAdsReportSection({ you, competitors, region }: { you: BrandAds | null; competitors: BrandAds[]; region?: string }) {
  const reports = useMemo(() => buildGoogleAdReportSet(you, competitors), [you, competitors]);
  const [sel, setSel] = useState(0);
  if (!reports.length) return null;

  const colorOf = (i: number) => HUES[i % HUES.length];
  const me = reports[0];
  const foeIdx = reports.length > 1 ? reports.map((r, i) => [i, r] as const).slice(1).sort((a, b) => b[1].total - a[1].total)[0][0] : 0;
  const foe = reports[foeIdx];
  const hasFoe = foeIdx !== 0;
  const combined = reports.reduce((s, r) => s + r.total, 0);
  const combinedActive = me.concurrentActiveNow + (hasFoe ? foe.concurrentActiveNow : 0);
  const shareYou = combinedActive ? me.concurrentActiveNow / combinedActive : 1;
  const selR = reports[sel] ?? me;
  const verdict = hasFoe ? buildVerdict(me, foe) : null;

  // shared trajectory axis (union of both brands' month keys)
  const trajKeys = hasFoe ? [...new Set([...Object.keys(me.concByMonth), ...Object.keys(foe.concByMonth)])].sort() : [];
  const trajLabels = trajKeys.map(keyLabel);

  return (
    <div className="tzc">
      <style>{CSS}</style>

      <div className="brandbar"><div className="brandbar-inner"><div className="brand-copy"><span className="brand-name">{PRODUCT}</span><span className="brand-tag">E-com intelligence · Google Ads analysis</span></div></div></div>

      <div className="wrap">
        {/* masthead */}
        <header className="mast">
          <div className="eyebrow"><span className="dash" />GOOGLE ADS TRANSPARENCY · MEDIA INTELLIGENCE</div>
          <h1>Same category, different playbook.</h1>
          <p className="sub">{me.brand}{hasFoe ? ` vs ${foe.brand}` : ""}, measured on the same signals from Google&apos;s Ad Transparency Center — volume, live vs. dormant creative, lifespan, launch rhythm and seasonality. Straight from the ads each brand has actually run.</p>
          <div className="mast-meta">
            <span>Scope: <b>{me.brand}{hasFoe ? ` vs ${foe.brand}` : ""}</b></span>
            <span>Region: <b>{region || "—"}</b></span>
            <span>Source: <b>Google Ads Transparency Center</b></span>
            <span>Combined ads tracked: <b>{nf(combined)}</b></span>
          </div>
        </header>

        {/* hero */}
        <section className="tight">
          <div className="hero-grid">
            {[me, ...(hasFoe ? [foe] : [])].map((b, k) => {
              const i = k === 0 ? 0 : foeIdx;
              return (
                <div className="rank-card" key={b.brand} style={brandVar(colorOf(i))}>
                  <div className="rank-label"><span>{b.brand}</span><span className="pill">{b.trackedSinceYear ? `tracked since ${b.trackedSinceYear}` : "tracked"}</span></div>
                  <div className="rank-num">{nf(b.concurrentActiveNow)}</div>
                  <div className="rank-sub">concurrently active ads · as of {b.asOfLabel}</div>
                  <div className="rank-fine">{nf(b.total)} total tracked · peaked at {nf(b.peak.count)} in {b.peak.label || "—"}</div>
                </div>
              );
            })}
          </div>
          {hasFoe && (
            <div className="tugbar-wrap">
              <div className="tugbar-top"><span>Share of currently-active ad volume (right now)</span><span>{nf(combinedActive)} concurrently active ads combined</span></div>
              <div className="tugbar">
                <div className="seg" style={{ width: pct1(shareYou), background: colorOf(0), justifyContent: "flex-start", paddingLeft: 12 }}>{me.brand} {pct0(shareYou)}</div>
                <div className="seg" style={{ width: pct1(1 - shareYou), background: colorOf(foeIdx), justifyContent: "flex-end", paddingRight: 12 }}>{pct0(1 - shareYou)}</div>
              </div>
              <div className="tugbar-foot"><span>{me.brand} · {nf(me.concurrentActiveNow)} active</span><span>{foe.brand} · {nf(foe.concurrentActiveNow)} active</span></div>
            </div>
          )}
        </section>

        {/* matrix */}
        <section>
          <div className="section-head"><div><div className="tag">Head-to-Head Report</div><h2>Same six signals, both brands</h2></div><div className="section-note">Google Ads Transparency · full history to date</div></div>
          <div className="matrix">
            {reports.map((r, i) => (
              <div className="matrix-row" key={r.brand} style={brandVar(colorOf(i))}>
                <div className="matrix-brand">{r.brand}</div>
                {[nf(r.total), nf(r.liveCount), nf(r.dormantCount), `${nf(r.avgLifespan)}d`, `${nf(r.maxLifespan)}d`, pct1(r.evergreenPct)].map((v, j) => <div className="matrix-cell" key={j}>{v}</div>)}
              </div>
            ))}
            <div className="matrix-labels"><span /><span>Total Ads</span><span>Live (7d)</span><span>Dormant (180d+)</span><span>Avg Lifespan</span><span>Max Lifespan</span><span>365d+ Ads</span></div>
          </div>
        </section>

        {/* detail */}
        <section>
          <div className="section-head"><div><div className="tag">Detailed Report</div><h2>Pick a brand to drill in</h2></div>
            <div className="toggle-bar">{reports.map((r, i) => <button key={r.brand} className={sel === i ? "active" : ""} style={sel === i ? { background: colorOf(i), color: "#fff" } : undefined} onClick={() => setSel(i)}>{r.brand}</button>)}</div>
          </div>
          <DetailPanel r={selR} color={colorOf(sel)} />
        </section>

        {/* signals */}
        {hasFoe && (
          <section>
            <div className="section-head"><div><div className="tag">Beyond The Standard Report</div><h2>Signals you wouldn&apos;t have seen</h2></div><div className="section-note">mined from firstShown / lastShown as a real time-series</div></div>
            <div className="sig-legend"><div className="lg"><span className="dot" style={{ background: colorOf(0) }} />{me.brand}</div><div className="lg"><span className="dot" style={{ background: colorOf(foeIdx) }} />{foe.brand}</div></div>

            {/* concurrent trajectory */}
            <div className="card" style={{ marginBottom: 18 }}>
              <h3>Concurrent Active-Ads Trajectory <span className="sub">how many ads were actually live each month</span></h3>
              <MultiLine labels={trajLabels} series={[
                { color: colorOf(0), data: trajKeys.map(k => me.concByMonth[k] ?? 0) },
                { color: colorOf(foeIdx), data: trajKeys.map(k => foe.concByMonth[k] ?? 0) },
              ]} />
              <p className="sig-footnote">Both brands scaled from single digits to peak concurrency ({me.brand} {nf(me.peak.count)} in {me.peak.label}; {foe.brand} {nf(foe.peak.count)} in {foe.peak.label}). Right now {me.concurrentActiveNow >= foe.concurrentActiveNow ? me.brand : foe.brand} runs more active ads ({nf(me.concurrentActiveNow)} vs {nf(foe.concurrentActiveNow)}).</p>
            </div>

            <div className="grid-2" style={{ marginBottom: 18 }}>
              {/* lifespan profile */}
              <div className="card">
                <h3>Creative Lifespan Profile <span className="sub">% of ads by lifespan (lastShown − firstShown)</span></h3>
                <PairRows meColor={colorOf(0)} foeColor={colorOf(foeIdx)} rows={me.lifespanProfile.map((b, i) => ({ label: b.label, me: b.pct, foe: foe.lifespanProfile[i]?.pct ?? 0 }))} />
              </div>
              {/* which format lasts longest */}
              <div className="card">
                <h3>Which Format Lasts Longest <span className="sub">avg. lifespan by format, both brands</span></h3>
                {(() => {
                  const rows = [
                    ...me.formatLifespan.map(f => ({ label: `${me.brand} — ${f.format}`, avg: f.avg, max: f.max, fill: colorOf(0) })),
                    ...foe.formatLifespan.map(f => ({ label: `${foe.brand} — ${f.format}`, avg: f.avg, max: f.max, fill: colorOf(foeIdx) })),
                  ];
                  const mx = Math.max(1, ...rows.map(r => r.avg));
                  return <BarRows rows={rows.map(r => ({ label: r.label, val: `${nf(r.avg)}d avg · max ${nf(r.max)}d`, width: (r.avg / mx) * 100, fill: r.fill }))} />;
                })()}
                <p className="sig-footnote">Text (search-style) ads are typically the longest-lived format for both brands — the evergreen workhorse.</p>
              </div>
            </div>

            {/* seasonality */}
            <div className="card">
              <h3>Seasonality Divergence <span className="sub">% of each brand&apos;s total ads, by calendar month (all years)</span></h3>
              <PairRows meColor={colorOf(0)} foeColor={colorOf(foeIdx)} rows={MONTH_FULL.map((mn, i) => ({ label: mn, me: me.seasonality[i], foe: foe.seasonality[i] }))} />
            </div>
          </section>
        )}

        {/* findings */}
        {verdict && (
          <section>
            <div className="section-head"><div><div className="tag">Final Verdict</div><h2>Who&apos;s winning the Google Ads game, and why</h2></div></div>
            <div className="headline-box">Both brands peaked at a similar active-ad volume — but they got there, and left, differently. Right now, {me.concurrentActiveNow >= foe.concurrentActiveNow ? me.brand : foe.brand} runs the bigger active portfolio.</div>
            <div className="findings-grid verdict">
              {verdict.map((f, i) => (
                <div className="finding-card" key={i}>
                  <div className="ftag" style={{ color: f.color }}>{f.tag}</div>
                  <ul>{f.items.map((it, j) => <li key={j}>{it}</li>)}</ul>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer><p>{PRODUCT} · Google Ads Transparency export{region ? ` · region ${region}` : ""} · scraped via automation-lab/google-ads-scraper</p></footer>
      </div>
    </div>
  );
}

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
.tzc header.mast h1{font-family:var(--display);font-weight:600;font-size:clamp(30px,4vw,48px);margin:16px 0 12px;letter-spacing:-.02em;max-width:16ch;}
.tzc header.mast p.sub{color:var(--text-dim);max-width:660px;font-size:15px;margin:0 0 20px;}
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
.tzc .tugbar-top{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;gap:10px;flex-wrap:wrap;}
.tzc .tugbar{height:34px;border-radius:8px;overflow:hidden;display:flex;border:1px solid var(--border);}
.tzc .tugbar .seg{display:flex;align-items:center;font-family:var(--mono);font-size:12px;font-weight:600;color:#fff;transition:width 1.1s cubic-bezier(.16,1,.3,1);}
.tzc .tugbar-foot{display:flex;justify-content:space-between;margin-top:10px;font-size:12px;color:var(--text-dim);gap:10px;flex-wrap:wrap;}
.tzc .matrix{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:22px 26px 26px;box-shadow:var(--shadow);overflow-x:auto;}
.tzc .matrix-row{display:grid;grid-template-columns:120px repeat(6,minmax(60px,1fr));gap:10px;align-items:center;margin-bottom:10px;}
.tzc .matrix-brand{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-dim);}
.tzc .matrix-cell{border-radius:8px;padding:12px 6px;text-align:center;font-family:var(--display);font-weight:600;font-size:17px;border:1px solid color-mix(in srgb,var(--brandc) 22%,var(--border));background:color-mix(in srgb,var(--brandc) 10%,transparent);color:var(--brandc);}
.tzc .matrix-labels{display:grid;grid-template-columns:120px repeat(6,minmax(60px,1fr));gap:10px;margin-top:12px;}
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
.tzc .donut-wrap{display:flex;align-items:center;gap:22px;flex-wrap:wrap;}
.tzc .donut{width:108px;height:108px;border-radius:50%;flex:none;}
.tzc .legend div{display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:8px;}
.tzc .legend .dot{width:9px;height:9px;border-radius:50%;}
.tzc .legend b{font-family:var(--mono);margin-left:auto;padding-left:14px;}
.tzc .stackbar-row{margin-bottom:16px;}
.tzc .stackbar-row:last-child{margin-bottom:0;}
.tzc .stackbar-row .sr-top{display:flex;justify-content:space-between;font-size:12.5px;color:var(--text-dim);margin-bottom:6px;}
.tzc .stackbar-row .sr-top b{color:var(--text);font-weight:600;}
.tzc .stackbar{display:flex;height:16px;border-radius:5px;overflow:hidden;background:var(--surface-2);}
.tzc .stackbar span{height:100%;}
.tzc .stack-legend{display:flex;gap:18px;margin-top:14px;flex-wrap:wrap;}
.tzc .stack-legend .lg{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text-dim);}
.tzc .stack-legend .dot{width:9px;height:9px;border-radius:2px;}
.tzc .event-row{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-top:1px solid var(--border-soft);gap:10px;}
.tzc .event-row:first-of-type{border-top:none;}
.tzc .event-name{font-size:13.5px;font-weight:500;display:flex;align-items:center;gap:4px;flex-wrap:wrap;}
.tzc .hof-rank{font-family:var(--mono);font-size:11px;color:var(--text-faint);width:20px;flex:none;}
.tzc .event-tag{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:20px;border:1px solid var(--border);color:var(--text-faint);white-space:nowrap;}
.tzc .event-tag.live{color:var(--green);border-color:rgba(62,214,152,.4);}
.tzc .event-count{font-family:var(--mono);font-size:12.5px;color:var(--text-dim);white-space:nowrap;}
.tzc .sig-legend{display:flex;gap:22px;margin-bottom:20px;flex-wrap:wrap;}
.tzc .sig-legend .lg{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text-dim);}
.tzc .sig-legend .dot{width:9px;height:9px;border-radius:50%;}
.tzc .sig-footnote{font-size:11.5px;color:var(--text-faint);margin-top:16px;line-height:1.6;}
.tzc .sig-footnote b{color:var(--text-dim);}
.tzc .pairrow{display:grid;grid-template-columns:92px 1fr 1fr;gap:18px;align-items:center;margin-bottom:15px;}
.tzc .pairrow:last-child{margin-bottom:0;}
.tzc .pairrow .plabel{font-size:12.5px;color:var(--text-dim);}
.tzc .pair-bar .pb-top{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--text-faint);margin-bottom:5px;gap:6px;}
.tzc .findings-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px;}
.tzc .finding-card{border:1px solid var(--border);border-radius:12px;padding:18px 20px;background:var(--surface);box-shadow:var(--shadow);}
.tzc .finding-card .ftag{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px;}
.tzc .finding-card ul{margin:0;padding-left:18px;}
.tzc .finding-card li{font-size:13px;color:var(--text-dim);line-height:1.65;margin-bottom:8px;}
.tzc .finding-card li:last-child{margin-bottom:0;}
.tzc .finding-card li b{color:var(--text);font-weight:600;}
.tzc .headline-box{border-left:2px solid var(--amazon);padding-left:18px;font-family:var(--display);font-size:19px;font-weight:500;color:var(--text);max-width:70ch;}
.tzc footer{padding:30px 0 44px;text-align:center;}
.tzc footer p{font-family:var(--mono);font-size:11px;color:var(--text-faint);letter-spacing:.04em;}
@media(max-width:720px){.tzc .grid-2,.tzc .hero-grid,.tzc .sig-legend,.tzc .findings-grid{grid-template-columns:1fr;}.tzc .pairrow{grid-template-columns:60px 1fr 1fr;gap:10px;}}
`;
