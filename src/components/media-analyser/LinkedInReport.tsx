
import { useMemo, useState } from "react";
import { buildLinkedInReportSet, type LinkedInReport, type LinkedInBrandPosts } from "@/lib/media-analyser/linkedin-report";

/* LinkedIn company-page report — "Quiet and loud aren't the same as losing and winning." */

const PRODUCT = "Threezinc";
const HUES = ["#4C5FE0", "#EC7F2E", "#1FAE72", "#E64888", "#7c3aed", "#0891b2"];
// Fixed media-format colours (match the target): text-only=faint, article=pink, video=blue, image=green.
const MEDIA = { none: "var(--text-faint)", article: "var(--pink)", video: "#4C5FE0", image: "var(--green)" };

const nf = (n: number) => Math.round(n).toLocaleString("en-IN");
const pct0 = (x: number) => `${Math.round(x * 100)}%`;
const d1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-IN");
type BrandStyle = React.CSSProperties & { "--brandc": string };
const brandVar = (c: string): BrandStyle => ({ "--brandc": c });
const totalReactions = (r: LinkedInReport) => Math.round(r.avgReactions * r.ownPosts);

const CW = 900, PADL = 44, PADT = 10, PADB = 18, CH = 200;
const innerW = CW - PADL - 8, innerH = CH - PADB - PADT;

function SparkBars({ data, color, labels }: { data: number[]; color: string; labels: string[] }) {
  const max = Math.max(1, ...data);
  const n = Math.max(1, data.length);
  const bw = Math.max((innerW / n) * 0.55, 4);
  return (
    <>
      <div className="chartbox">
        <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
          {[0, 0.5, 1].map((f, i) => {
            const y = PADT + innerH - f * innerH;
            return <g key={i}><line x1={PADL} y1={y} x2={CW} y2={y} stroke="#E7E8F2" strokeWidth={1} /><text x={0} y={y + 4} style={{ fontFamily: 'var(--font-mono),"IBM Plex Mono",monospace' }} fontSize={11} fill="#9799AE">{nf(max * f)}</text></g>;
          })}
          {data.map((v, i) => { const cx = PADL + (i / Math.max(1, n - 1)) * innerW; const h = (v / max) * innerH; return <rect key={i} x={cx - bw / 2} y={PADT + innerH - h} width={bw} height={Math.max(h, v > 0 ? 2 : 0)} rx={1.5} fill={color} />; })}
        </svg>
      </div>
      <div className="chart-months">{labels.map((m, i) => <span key={i}>{m}</span>)}</div>
    </>
  );
}

function BarRows({ rows }: { rows: { label: string; val: string; width: number; fill: string }[] }) {
  return <>{rows.map((r, i) => (
    <div className="barrow" key={i}><div className="toprow"><b>{r.label}</b><span className="val">{r.val}</span></div><div className="track"><div className="fill" style={{ width: `${Math.max(r.width, r.width > 0 ? 0.4 : 0)}%`, background: r.fill }} /></div></div>
  ))}</>;
}

function PairRows({ rows, meColor, foeColor, meName, foeName }: { rows: { label: string; me: number; foe: number; fmt: (n: number) => string }[]; meColor: string; foeColor: string; meName: string; foeName: string }) {
  return <>{rows.map(r => {
    const mx = Math.max(r.me, r.foe, 0.0001);
    return (
      <div className="pairrow" key={r.label}>
        <span className="plabel">{r.label}</span>
        <div className="pair-bar"><div className="pb-top"><span>{meName}</span><span>{r.fmt(r.me)}</span></div><div className="track"><div className="fill" style={{ width: `${(r.me / mx) * 100}%`, background: meColor }} /></div></div>
        <div className="pair-bar"><div className="pb-top"><span>{foeName}</span><span>{r.fmt(r.foe)}</span></div><div className="track"><div className="fill" style={{ width: `${(r.foe / mx) * 100}%`, background: foeColor }} /></div></div>
      </div>
    );
  })}</>;
}

function Donut({ mix }: { mix: LinkedInReport["mediaMix"] }) {
  const total = mix.none + mix.image + mix.video + mix.article || 1;
  const order: [keyof typeof MEDIA, string, number][] = [["none", "Text-only", mix.none], ["article", "Article", mix.article], ["video", "Video", mix.video], ["image", "Image", mix.image]];
  const present = order.filter(([, , v]) => v > 0);
  let acc = 0; const stops: string[] = [];
  for (const [k, , v] of present) { const from = (acc / total) * 100; acc += v; const to = (acc / total) * 100; stops.push(`${MEDIA[k]} ${from}% ${to}%`); }
  return (
    <div className="donut-wrap">
      <div className="donut" style={{ background: `conic-gradient(${stops.join(", ")})` }} />
      <div className="legend">
        {present.map(([k, label, v]) => <div key={k}><span className="dot" style={{ background: MEDIA[k] }} />{label}<b>{pct0(v / total)} · {v}</b></div>)}
      </div>
    </div>
  );
}

function DetailPanel({ r, color, foeName }: { r: LinkedInReport; color: string; foeName?: string }) {
  void foeName;
  return (
    <div className="panel active" style={brandVar(color)}>
      <div className="card" style={{ marginBottom: 18 }}>
        <h3>Posting Cadence <span className="sub">own posts per month · last 12 months</span></h3>
        <SparkBars data={r.monthly.counts} labels={r.monthly.labels} color={color} />
        {r.daysSinceLast != null && r.daysSinceLast > 90 && <p className="sig-footnote">No posts in <b>{r.daysSinceLast} days</b> — a long silence and counting.</p>}
      </div>

      <div className="grid-2" style={{ marginBottom: 18 }}>
        <div className="card">
          <h3>Media Mix <span className="sub">text · article · image · video</span></h3>
          <Donut mix={r.mediaMix} />
          {r.videoAvgReactions != null && r.mediaMix.video > 0 && <p className="sig-footnote">Video posts average <b>{d1(r.videoAvgReactions)} reactions</b>.</p>}
        </div>
        <div className="card">
          <h3>Content Themes <span className="sub">share of posts · avg reactions</span></h3>
          <BarRows rows={r.themes.map(t => ({ label: t.label, val: `${t.count} · ${pct0(t.pct)} · avg ${d1(t.avgReactions)}`, width: t.pct * 100, fill: color }))} />
          {r.hiringAvg != null && r.otherAvg != null && r.otherAvg > r.hiringAvg && <p className="sig-footnote">Hiring posts earn <b>{d1(r.otherAvg / Math.max(1, r.hiringAvg))}× less</b> engagement than other content.</p>}
        </div>
      </div>

      {r.topPost && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3>Top Post <span className="sub">by total reactions</span></h3>
          <div className="quote-card">
            <p>&ldquo;{r.topPost.text}&rdquo;</p>
            <div className="qmeta"><span>{r.topPost.date}</span><span>{nf(r.topPost.reactions)} reactions · {nf(r.topPost.comments)} comments</span></div>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Top Hashtags <span className="sub">used across own posts</span></h3>
        {r.topHashtags.length ? (
          <div>{r.topHashtags.map(h => <span className="hashtag-chip" key={h.tag}>{h.tag} <b>{h.count}</b></span>)}</div>
        ) : <p className="empty">No hashtags used across these posts.</p>}
      </div>
    </div>
  );
}

export function LinkedInReportSection({ you, competitors, emptyBrands = [] }: { you: LinkedInBrandPosts | null; competitors: LinkedInBrandPosts[]; emptyBrands?: string[] }) {
  const reports = useMemo(() => buildLinkedInReportSet(you, competitors), [you, competitors]);
  const [sel, setSel] = useState(0);
  if (!reports.length) return null;

  const colorOf = (i: number) => HUES[i % HUES.length];
  const me = reports[0];
  const foeIdx = reports.length > 1 ? reports.map((r, i) => [i, r] as const).slice(1).sort((a, b) => b[1].followers - a[1].followers)[0][0] : 0;
  const foe = reports[foeIdx];
  const hasFoe = foeIdx !== 0;
  const totalPosts = reports.reduce((s, r) => s + r.ownPosts, 0);
  const combinedReact = totalReactions(me) + (hasFoe ? totalReactions(foe) : 0);
  const shareYou = combinedReact ? totalReactions(me) / combinedReact : 1;
  const selR = reports[sel] ?? me;

  const pill = (r: LinkedInReport) => r.daysSinceLast != null && r.daysSinceLast > 60 ? `dormant ${r.daysSinceLast}d` : r.cadenceDays != null && r.cadenceDays <= 10 ? "posting weekly" : "active";
  const fine = (r: LinkedInReport) => `${nf(r.ownPosts)} own posts${r.cadenceDays != null ? ` · 1 every ${d1(r.cadenceDays)}d` : ""}${r.daysSinceLast != null ? ` · last post ${r.daysSinceLast}d ago` : ""}`;

  return (
    <div className="tzc">
      <style>{CSS}</style>
      <div className="brandbar"><div className="brandbar-inner"><div className="brand-copy"><span className="brand-name">{PRODUCT}</span><span className="brand-tag">E-com intelligence · LinkedIn presence analysis</span></div></div></div>

      <div className="wrap">
        <header className="mast">
          <div className="eyebrow"><span className="dash" />LINKEDIN COMPANY PAGES · MEDIA INTELLIGENCE</div>
          <h1>Quiet and loud aren&apos;t the same as losing and winning.</h1>
          <p className="sub">{me.brand}{hasFoe ? ` vs ${foe.brand}` : ""}, measured on their own LinkedIn company pages — followers, posting cadence, reactions, comments and content mix. Organic company activity, not paid LinkedIn Ads; figures as publicly exposed at scrape time.</p>
          <div className="mast-meta">
            <span>Scope: <b>{me.brand}{hasFoe ? ` vs ${foe.brand}` : ""}</b></span>
            <span>Source: <b>LinkedIn company posts (organic)</b></span>
            <span>Own-page posts: <b>{nf(totalPosts)}</b></span>
          </div>
        </header>

        <div className="caveat-banner"><b>Reading this right:</b> this is organic LinkedIn content, not ad spend — engagement reflects what each brand&apos;s own audience saw and did, not paid reach. Small post samples should be read as directional, not statistically firm. Reposts/mentions by employees or press are excluded from all &ldquo;own post&rdquo; figures for a fair comparison.</div>
        {emptyBrands.length > 0 && (
          <div className="caveat-banner" style={{ marginTop: 10 }}><b>Also tracked · no public posts found:</b> {emptyBrands.join(", ")}. Their LinkedIn company page was checked but returned no scrapable posts — the page is inactive, posts are login-gated, or they simply don&apos;t post on their company page. (Verified across multiple cookieless scrapers.)</div>
        )}

        {/* hero */}
        <section className="tight">
          <div className="hero-grid">
            {[me, ...(hasFoe ? [foe] : [])].map((b, k) => {
              const i = k === 0 ? 0 : foeIdx;
              return (
                <div className="rank-card" key={b.brand} style={brandVar(colorOf(i))}>
                  <div className="rank-label"><span>{b.brand}</span><span className="pill">{pill(b)}</span></div>
                  <div className="rank-num">{nf(b.followers)}</div>
                  <div className="rank-sub">LinkedIn followers</div>
                  <div className="rank-fine">{fine(b)}</div>
                </div>
              );
            })}
          </div>
          {hasFoe && (
            <div className="tugbar-wrap">
              <div className="tugbar-top"><span>Share of combined engagement (total reactions, own posts)</span><span>{nf(combinedReact)} reactions combined</span></div>
              <div className="tugbar">
                <div className="seg" style={{ width: `${shareYou * 100}%`, background: colorOf(0), justifyContent: "flex-start", paddingLeft: 12 }}>{me.brand} {pct0(shareYou)}</div>
                <div className="seg" style={{ width: `${(1 - shareYou) * 100}%`, background: colorOf(foeIdx), justifyContent: "flex-end", paddingRight: 12 }}>{pct0(1 - shareYou)}</div>
              </div>
              <div className="tugbar-foot"><span>{me.brand} · {nf(totalReactions(me))} reactions / {nf(me.ownPosts)} posts</span><span>{foe.brand} · {nf(totalReactions(foe))} reactions / {nf(foe.ownPosts)} posts</span></div>
            </div>
          )}
        </section>

        {/* matrix */}
        <section>
          <div className="section-head"><div><div className="tag">Head-to-Head Report</div><h2>Same six signals, both pages</h2></div><div className="section-note">LinkedIn company posts · own-page only</div></div>
          <div className="matrix">
            {reports.map((r, i) => (
              <div className="matrix-row" key={r.brand} style={brandVar(colorOf(i))}>
                <div className="matrix-brand">{r.brand}</div>
                {[nf(r.followers), nf(r.ownPosts), d1(r.avgReactions), d1(r.avgComments), r.cadenceDays != null ? `${d1(r.cadenceDays)}d` : "—", r.daysSinceLast != null ? `${nf(r.daysSinceLast)}d` : "—"].map((v, j) => <div className="matrix-cell" key={j}>{v}</div>)}
              </div>
            ))}
            <div className="matrix-labels"><span /><span>Followers</span><span>Own Posts</span><span>Avg Reactions</span><span>Avg Comments</span><span>Post Cadence</span><span>Days Since Last</span></div>
          </div>
        </section>

        {/* detail */}
        <section>
          <div className="section-head"><div><div className="tag">Detailed Report</div><h2>Pick a page to drill in</h2></div>
            <div className="toggle-bar">{reports.map((r, i) => <button key={r.brand} className={sel === i ? "active" : ""} style={sel === i ? { background: colorOf(i), color: "#fff" } : undefined} onClick={() => setSel(i)}>{r.brand}</button>)}</div>
          </div>
          <DetailPanel r={selR} color={colorOf(sel)} />
        </section>

        {/* signals */}
        {hasFoe && (
          <section>
            <div className="section-head"><div><div className="tag">Beyond The Standard Report</div><h2>Signals you wouldn&apos;t have seen</h2></div><div className="section-note">engagement depth, content mix &amp; posting rhythm</div></div>
            <div className="sig-legend"><div className="lg"><span className="dot" style={{ background: colorOf(0) }} />{me.brand}</div><div className="lg"><span className="dot" style={{ background: colorOf(foeIdx) }} />{foe.brand}</div></div>

            <div className="card" style={{ marginBottom: 18 }}>
              <h3>Engagement Depth <span className="sub">average per own post</span></h3>
              <PairRows meColor={colorOf(0)} foeColor={colorOf(foeIdx)} meName={me.brand} foeName={foe.brand} rows={[
                { label: "Reactions", me: me.avgReactions, foe: foe.avgReactions, fmt: d1 },
                { label: "Comments", me: me.avgComments, foe: foe.avgComments, fmt: d1 },
                { label: "Reposts", me: me.avgReposts, foe: foe.avgReposts, fmt: d1 },
                { label: "Eng. rate*", me: me.engagementRate, foe: foe.engagementRate, fmt: (n: number) => `${(n * 100).toFixed(3)}%` },
              ]} />
              <p className="sig-footnote">*Avg reactions ÷ follower count. Volume drives combined totals; per-post, the smaller/rarer poster can still hit harder.</p>
            </div>

            <div className="grid-2">
              <div className="card">
                <h3>Hiring vs. Other Content <span className="sub">avg reactions, both brands</span></h3>
                {(() => {
                  const rows = [
                    { label: `${me.brand} — Other/Product`, v: me.otherAvg ?? 0, fill: colorOf(0) },
                    { label: `${me.brand} — Hiring`, v: me.hiringAvg ?? 0, fill: colorOf(0) },
                    { label: `${foe.brand} — Other/Product`, v: foe.otherAvg ?? 0, fill: colorOf(foeIdx) },
                    { label: `${foe.brand} — Hiring`, v: foe.hiringAvg ?? 0, fill: colorOf(foeIdx) },
                  ].filter(r => r.v > 0);
                  const mx = Math.max(1, ...rows.map(r => r.v));
                  return <BarRows rows={rows.map(r => ({ label: r.label, val: `${d1(r.v)} avg`, width: (r.v / mx) * 100, fill: r.fill }))} />;
                })()}
                <p className="sig-footnote">Non-hiring content typically outperforms hiring content — worth rebalancing the feed mix.</p>
              </div>
              <div className="card">
                <h3>Posting Rhythm <span className="sub">cadence &amp; recency</span></h3>
                <div className="statpair">
                  {[me, foe].map((b, bi) => (
                    <div className="stat-lg" key={bi}>
                      <div className="num" style={{ color: colorOf(bi === 0 ? 0 : foeIdx) }}>{b.cadenceDays != null ? `${d1(b.cadenceDays)}d` : "—"}</div>
                      <div className="lbl">{b.brand} Cadence</div>
                      <div className="kv-list">
                        <div className="kv-row"><span className="k">Days since last post</span><span className="v">{b.daysSinceLast != null ? `${nf(b.daysSinceLast)}d` : "—"}</span></div>
                        <div className="kv-row"><span className="k">Active window</span><span className="v">{nf(b.activeWindowDays)}d</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        <footer><p>{PRODUCT} · LinkedIn company-posts export · organic data, not LinkedIn Ads · scraped via apimaestro/linkedin-company-posts</p></footer>
      </div>
    </div>
  );
}

const CSS = `
.tzc{--bg:#F3F4FA;--surface:#FFFFFF;--surface-2:#F4F5FB;--border:#E7E8F2;--border-soft:#EEEFF7;--text:#181A2A;--text-dim:#6B6F87;--text-faint:#9799AE;--amazon:#4C5FE0;--flipkart:#EC7F2E;--green:#1FAE72;--pink:#E64888;--risk:#E14A42;--shadow:0 1px 2px rgba(24,26,42,0.04),0 4px 16px rgba(24,26,42,0.05);--mono:var(--font-mono),'IBM Plex Mono',ui-monospace,monospace;--display:var(--font-display),'Space Grotesk',sans-serif;--body:var(--font-sans),'Inter',system-ui,sans-serif;--brandc:#4C5FE0;background:radial-gradient(1200px 600px at 85% -10%,rgba(76,95,224,0.06),transparent 60%),radial-gradient(1000px 500px at 10% 0%,rgba(236,127,46,0.05),transparent 55%),var(--bg);color:var(--text);font-family:var(--body);line-height:1.5;border-radius:16px;overflow:hidden;border:1px solid var(--border);}
.tzc *{box-sizing:border-box;}
.tzc .brandbar{border-bottom:1px solid var(--border-soft);background:#fff;}
.tzc .brandbar-inner{display:flex;align-items:center;gap:14px;padding:16px 28px;}
.tzc .brand-copy{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
.tzc .brand-name{font-family:var(--display);font-weight:700;font-size:15px;letter-spacing:.02em;color:var(--text);}
.tzc .brand-tag{font-family:var(--mono);font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.08em;}
.tzc .wrap{max-width:1180px;margin:0 auto;padding:0 28px;}
.tzc .eyebrow{font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-faint);display:flex;align-items:center;gap:10px;}
.tzc .eyebrow .dash{width:22px;height:1px;background:var(--text-faint);display:inline-block;}
.tzc header.mast{padding:44px 0 26px;border-bottom:1px solid var(--border-soft);}
.tzc header.mast h1{font-family:var(--display);font-weight:600;font-size:clamp(28px,3.6vw,44px);margin:16px 0 12px;letter-spacing:-.02em;max-width:20ch;}
.tzc header.mast p.sub{color:var(--text-dim);max-width:680px;font-size:15px;margin:0 0 20px;}
.tzc .mast-meta{display:flex;gap:22px;flex-wrap:wrap;font-family:var(--mono);font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.06em;}
.tzc .mast-meta b{color:var(--text-dim);font-weight:500;}
.tzc .caveat-banner{background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin:22px 0 4px;font-size:13px;color:var(--text-dim);line-height:1.6;}
.tzc .caveat-banner b{color:var(--text);}
.tzc section{padding:40px 0;border-bottom:1px solid var(--border-soft);}
.tzc section.tight{padding:30px 0;}
.tzc .section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:24px;flex-wrap:wrap;}
.tzc .section-head h2{font-family:var(--display);font-size:24px;font-weight:600;margin:6px 0 0;letter-spacing:-.01em;}
.tzc .section-head .tag{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-faint);}
.tzc .section-note{font-family:var(--mono);font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.05em;}
.tzc .hero-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:24px;}
.tzc .rank-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:26px 26px 24px;position:relative;overflow:hidden;box-shadow:var(--shadow);border-color:color-mix(in srgb,var(--brandc) 30%,var(--border));}
.tzc .rank-card::after{content:"";position:absolute;top:-40%;right:-20%;width:220px;height:220px;border-radius:50%;filter:blur(60px);opacity:.16;background:var(--brandc);}
.tzc .rank-label{display:flex;justify-content:space-between;align-items:center;font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-faint);margin-bottom:16px;position:relative;z-index:1;}
.tzc .rank-label .pill{padding:3px 10px;border-radius:20px;font-size:10px;border:1px solid color-mix(in srgb,var(--brandc) 35%,var(--border));color:var(--brandc);}
.tzc .rank-num{font-family:var(--display);font-size:48px;font-weight:700;line-height:1;position:relative;z-index:1;color:var(--brandc);}
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
.tzc .quote-card{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:16px 18px;}
.tzc .quote-card p{font-size:13px;color:var(--text-dim);line-height:1.6;margin:0 0 10px;font-style:italic;}
.tzc .quote-card .qmeta{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--text-faint);gap:8px;flex-wrap:wrap;}
.tzc .hashtag-chip{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11.5px;background:var(--surface-2);border:1px solid var(--border);border-radius:20px;padding:5px 12px;margin:0 8px 8px 0;color:var(--text-dim);}
.tzc .hashtag-chip b{color:var(--text);font-weight:600;}
.tzc .statpair{display:flex;gap:14px;flex-wrap:wrap;}
.tzc .stat-lg{flex:1;min-width:170px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:16px 18px;}
.tzc .stat-lg .num{font-family:var(--display);font-size:32px;font-weight:700;}
.tzc .stat-lg .lbl{font-family:var(--mono);font-size:10.5px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.06em;margin-top:6px;}
.tzc .kv-list{margin-top:14px;font-size:13px;}
.tzc .kv-row{display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid var(--border-soft);}
.tzc .kv-row:first-child{border-top:none;}
.tzc .kv-row .k{color:var(--text-dim);}
.tzc .kv-row .v{font-family:var(--mono);font-weight:600;}
.tzc .sig-legend{display:flex;gap:22px;margin-bottom:20px;flex-wrap:wrap;}
.tzc .sig-legend .lg{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text-dim);}
.tzc .sig-legend .dot{width:9px;height:9px;border-radius:50%;}
.tzc .sig-footnote{font-size:11.5px;color:var(--text-faint);margin-top:16px;line-height:1.6;}
.tzc .sig-footnote b{color:var(--text-dim);}
.tzc .pairrow{display:grid;grid-template-columns:92px 1fr 1fr;gap:18px;align-items:center;margin-bottom:15px;}
.tzc .pairrow:last-child{margin-bottom:0;}
.tzc .pairrow .plabel{font-size:12.5px;color:var(--text-dim);}
.tzc .pair-bar .pb-top{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--text-faint);margin-bottom:5px;gap:6px;}
.tzc footer{padding:30px 0 44px;text-align:center;}
.tzc footer p{font-family:var(--mono);font-size:11px;color:var(--text-faint);letter-spacing:.04em;}
@media(max-width:720px){.tzc .grid-2,.tzc .hero-grid,.tzc .sig-legend{grid-template-columns:1fr;}.tzc .pairrow{grid-template-columns:60px 1fr 1fr;gap:10px;}}
`;
