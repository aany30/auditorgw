
import { useMemo } from "react";
import { buildAdIntel, type BrandAdMetrics, type BrandAds } from "@/lib/media-analyser/paid-ad-intel";
import { CompetitorReportSection } from "@/components/media-analyser/CompetitorReport";

// Palette — mapped to the theme tokens so the panel follows light/dark.
const C = {
  ink: "var(--surface)", inkSoft: "var(--surface-2)", inkLine: "var(--line)",
  amber: "var(--accent)", amberDim: "var(--accent-dim)", teal: "var(--accent-2)", tealDim: "var(--accent-2-dim)",
  alert: "var(--alert)", ash: "var(--fg-dim)", ashDim: "var(--fg-mute)", paper: "var(--fg)",
};
const MONO = "var(--font-mono), 'IBM Plex Mono', ui-monospace, monospace";
const DISPLAY = "var(--font-display), 'Space Grotesk', sans-serif";

// "Dreame Ad-Scan" palette (clear names) → theme tokens.
const P = {
  blue: "var(--accent)", amber: "var(--accent-2)", green: "var(--success)",
  text: "var(--fg)", muted: "var(--fg-dim)", muted2: "var(--fg-mute)",
  border: "var(--line)", surface: "var(--surface)", surface2: "var(--surface-2)",
  greenSoft: "var(--success-soft)", blueSoft: "var(--accent-soft)",
};

function ArchTag({ archetype }: { archetype: BrandAdMetrics["archetype"] }) {
  const c = archetype === "Volume Scaler" ? C.amber : archetype === "Quality Tester" ? C.teal : C.ash;
  return (
    <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 2, color: c, border: `1px solid ${c}`, background: "transparent", whiteSpace: "nowrap" }}>
      {archetype}
    </span>
  );
}

function ReadoutCol({ m }: { m: BrandAdMetrics }) {
  const label = m.isYou ? `${m.brand} · you` : `Rank 0${m.rank} · ${m.brand}`;
  const color = m.isYou ? C.teal : C.amber;
  return (
    <div style={{ padding: "24px 28px", flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color, marginBottom: 12 }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 42, fontWeight: 600, color: C.paper, lineHeight: 1 }}>{m.activeAds}</div>
      <div style={{ fontSize: 13, color: C.ashDim, marginTop: 6 }}>active ads · {m.newThisWeek} launched this week</div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.ashDim, marginTop: 3 }} title="Meta's “~N results” header counts every collated ad VERSION; the list shows grouped cards. Active = currently running only.">
        {m.totalAds} in library{m.totalVersions > m.totalAds ? ` · ≈${m.totalVersions} versions on Meta` : ""}
      </div>
    </div>
  );
}

// ── Dreame "Ad Scan" building blocks ──────────────────────────────────────

const cardStyle: React.CSSProperties = {
  border: `1px solid ${P.border}`, background: P.surface, borderRadius: 14,
  padding: "20px 22px", boxShadow: "0 1px 2px rgba(20,23,31,0.04)",
};

function ScanCard({ title, sub, span, children }: { title: string; sub?: string; span?: boolean; children: React.ReactNode }) {
  return (
    <div className={span ? "sm:col-span-2" : undefined} style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <span style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: P.muted, fontWeight: 700 }}>{title}</span>
        {sub && <span style={{ fontSize: 12, color: P.muted2, fontFamily: MONO, fontWeight: 500 }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

/** Survival area chart — % of ads still live at day 5/10/20/30. */
function SurvivalChart({ survival }: { survival: BrandAdMetrics["survival"] }) {
  const pts = survival;
  const n = pts.length;
  const x = (i: number) => 60 + 700 * (n > 1 ? i / (n - 1) : 0);
  const y = (p: number) => 30 + (1 - p) * 120;
  const line = pts.map((s, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(s.pct).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},150 L${x(0).toFixed(1)},150 Z`;
  return (
    <svg viewBox="0 0 780 190" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id="survFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={P.blue} stopOpacity="0.16" />
          <stop offset="100%" stopColor={P.blue} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[{ yy: 30, l: "100%" }, { yy: 90, l: "50%" }, { yy: 150, l: "0%" }].map((g, i) => (
        <g key={i}>
          <line x1="0" y1={g.yy} x2="780" y2={g.yy} stroke={P.border} strokeWidth="1" />
          <text x="0" y={g.yy - 4} fontFamily={MONO} fontSize="11" fontWeight="600" fill={P.muted2}>{g.l}</text>
        </g>
      ))}
      <path d={area} fill="url(#survFill)" />
      <path d={line} fill="none" stroke={P.blue} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((s, i) => {
        const last = i === n - 1;
        return <circle key={i} cx={x(i)} cy={y(s.pct)} r={last ? 5.5 : 5} fill={last ? P.amber : P.blue} />;
      })}
      {pts.map((s, i) => {
        const last = i === n - 1;
        return <text key={i} x={x(i)} y={y(s.pct) - 14} textAnchor="middle" fontFamily={MONO} fontWeight="700" fontSize="15" fill={last ? P.amber : P.text}>{Math.round(s.pct * 100)}%</text>;
      })}
      {pts.map((s, i) => (
        <text key={i} x={x(i)} y="176" textAnchor="middle" fontFamily={MONO} fontSize="12" fontWeight="600" fill={P.muted}>d{s.day}</text>
      ))}
    </svg>
  );
}

/** Nested creative-format breakdown: static vs video, then each split by sub-type. */
function FormatBreakdown({ m }: { m: BrandAdMetrics }) {
  const fb = m.formatBreakdown;
  const total = Math.max(1, fb.static + fb.video);
  const staticPct = Math.round((fb.static / total) * 100);
  const videoPct = 100 - staticPct;
  const CAROUSEL = "var(--accent-2-dim, #f0b429)";
  const BRANDVID = "var(--accent-dim, #9db4f0)";
  const lifeOf = (k: string) => m.formatLifespans.find(f => f.key === k)?.medianDays ?? 0;
  const videoMed = lifeOf("Video");
  const staticMed = lifeOf("Image") || lifeOf("Carousel");

  const staticRows = [
    { label: "Single image", n: fb.staticImage, col: P.amber },
    { label: "Carousel", n: fb.staticCarousel, col: CAROUSEL },
    { label: "Other", n: fb.staticOther, col: P.muted2 },
  ].filter(r => r.n > 0);
  const videoRows = [
    { label: "Influencer reel", n: fb.videoInfluencer, col: P.blue },
    { label: "UGC reel", n: fb.videoUgc, col: P.green },
    { label: "Brand video", n: fb.videoBrand, col: BRANDVID },
  ].filter(r => r.n > 0);

  const SubList = ({ rows, of, tint }: { rows: { label: string; n: number; col: string }[]; of: number; tint: string }) => (
    <div style={{ flex: 1, minWidth: 200, border: `1px solid ${P.border}`, borderRadius: 12, background: P.surface2, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: tint }}>{of === fb.static ? "Static" : "Video"}</span>
        <span style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: P.text }}>{of}<span style={{ fontSize: 12, color: P.muted, fontWeight: 500, marginLeft: 3 }}>ads</span></span>
      </div>
      {of === 0 ? (
        <p style={{ fontFamily: MONO, fontSize: 11.5, color: P.muted2 }}>none</p>
      ) : rows.map((r, i) => {
        const pct = Math.round((r.n / of) * 100);
        return (
          <div key={i} style={{ marginBottom: i === rows.length - 1 ? 0 : 11 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: P.text }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, display: "inline-block", marginRight: 7, background: r.col }} />{r.label}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 13, color: P.muted }}>{r.n} · <b style={{ color: P.text }}>{pct}%</b></span>
            </div>
            <div style={{ height: 7, borderRadius: 999, background: P.border, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 999, width: `${pct}%`, background: r.col }} />
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      {/* top-level static vs video split */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, fontFamily: MONO, fontSize: 13, fontWeight: 700 }}>
        <span style={{ color: P.amber }}>Static {fb.static} · {staticPct}%{staticMed ? ` · ${staticMed}d` : ""}</span>
        <span style={{ color: P.blue }}>{videoMed ? `${videoMed}d · ` : ""}{videoPct}% · {fb.video} Video</span>
      </div>
      <div style={{ display: "flex", height: 26, borderRadius: 8, overflow: "hidden", border: `1px solid ${P.border}`, marginBottom: 18 }}>
        {fb.static > 0 && <div style={{ width: `${staticPct}%`, background: P.amber, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 11, fontWeight: 700, color: "#fff" }}>{staticPct >= 12 ? "Static" : ""}</div>}
        {fb.video > 0 && <div style={{ width: `${videoPct}%`, background: P.blue, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 11, fontWeight: 700, color: "#fff" }}>{videoPct >= 12 ? "Video" : ""}</div>}
      </div>
      {/* sub-breakdowns side by side */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <SubList rows={staticRows} of={fb.static} tint={P.amber} />
        <SubList rows={videoRows} of={fb.video} tint={P.blue} />
      </div>
      <p style={{ fontFamily: MONO, fontSize: 11, color: P.muted2, marginTop: 12, lineHeight: 1.5 }}>
        Video reels split by the influencer classifier: partnership / creator signal → influencer reel, a real person / UGC look → UGC reel, product-only → brand video.
      </p>
    </div>
  );
}

function OfferTile({ pct, label }: { pct: number; label: string }) {
  const v = Math.round(pct * 100);
  const on = v > 0;
  return (
    <div style={{ flex: 1, minWidth: 130, border: `1px solid ${P.border}`, background: P.surface2, borderRadius: 10, padding: 16, position: "relative", overflow: "hidden" }}>
      <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, color: on ? P.blue : P.muted, position: "relative", zIndex: 1 }}>{v}%</div>
      <div style={{ fontSize: 13, color: P.muted, marginTop: 5, fontWeight: 600, position: "relative", zIndex: 1 }}>{label}</div>
      <div style={{ position: "absolute", left: 0, bottom: 0, height: 4, width: `${v}%`, background: on ? P.blue : P.muted2, opacity: 0.5 }} />
    </div>
  );
}

function StatTile({ top, frac, label, lang }: { top: string; frac: number; label: string; lang?: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 160, border: `1px solid ${P.border}`, background: P.surface, borderRadius: 14, padding: "18px 20px", boxShadow: "0 1px 2px rgba(20,23,31,0.03)" }}>
      <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, color: P.muted, marginBottom: 10 }} dangerouslySetInnerHTML={{ __html: top }} />
      <div style={{ fontSize: 12, color: P.muted, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <div style={{ height: 6, borderRadius: 999, background: P.border, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 999, width: `${Math.round(frac * 100)}%`, background: lang ? P.blue : P.muted2 }} />
      </div>
    </div>
  );
}

/** One brand rendered as the full Dreame "Ad Scan" dashboard. */
function BrandScanCard({ m, column }: { m: BrandAdMetrics; column?: boolean }) {
  const archColor = m.archetype === "Volume Scaler" ? P.blue : m.archetype === "Quality Tester" ? P.amber : P.green;
  const archSoft = m.archetype === "Volume Scaler" ? P.blueSoft : m.archetype === "Quality Tester" ? "var(--accent-2-soft)" : P.greenSoft;
  const first = m.monthly[0]?.label, last = m.monthly[m.monthly.length - 1]?.label;
  const topLang = m.languages[0];
  const mom = (() => {
    if (m.coldStart || !m.momReliable) return { text: "Baseline scan", color: P.muted2 };
    const d = Math.round(m.momDelta * 100);
    const up = d > 5, down = d < -5;
    return { text: `${up ? "▲" : down ? "▼" : "—"} ${d > 0 ? "+" : ""}${d}% mom`, color: up ? P.blue : down ? P.amber : P.muted };
  })();
  return (
    <div style={{ marginBottom: column ? 0 : 20 }}>
      {/* header */}
      <div style={{ border: `1px solid ${P.border}`, background: P.surface, borderRadius: 16, padding: column ? "18px 20px 14px" : "22px 26px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: P.text }}>{m.brand}{m.isYou && <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: P.blue, marginLeft: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>· you</span>}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", padding: "5px 10px", borderRadius: 999, border: `1px solid ${archColor}`, background: archSoft, color: archColor, textTransform: "uppercase" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: archColor }} />{m.archetype}
            </span>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: P.text, fontFamily: MONO, lineHeight: 1 }}>{m.totalAds}</div>
            <div style={{ fontSize: 11, color: P.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginTop: 4 }}>Ads total · {m.activeAds} active</div>
            {m.totalVersions > m.totalAds && (
              <div style={{ fontFamily: MONO, fontSize: 10.5, color: P.muted2, marginTop: 3 }} title="Meta's “~N results” header counts every collated ad version">≈{m.totalVersions} versions on Meta</div>
            )}
          </div>
        </div>
        {first && last && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, paddingTop: 14, borderTop: `1px solid ${P.border}`, fontSize: 13, color: P.muted, fontWeight: 600 }}>
            <span style={{ fontFamily: MONO }}>{first}</span>
            <div style={{ flex: 1, margin: "0 24px", height: 1, background: "repeating-linear-gradient(90deg, var(--line) 0 6px, transparent 6px 10px)" }} />
            <span style={{ fontFamily: MONO }}>{last}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 13, fontWeight: 600 }}>
          <span style={{ textTransform: "uppercase", letterSpacing: "0.06em", color: P.muted2 }}>Ad decay · ads / month</span>
          <span style={{ fontFamily: MONO, color: mom.color, letterSpacing: "0.03em" }}>{mom.text}</span>
        </div>
      </div>

      {/* grid — single column when shown side-by-side, so sections align across brands */}
      <div className={column ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 sm:grid-cols-2 gap-4"}>
        <ScanCard title="Survival" sub="% live at day" span>
          {m.survival.some(s => s.pct > 0) ? <SurvivalChart survival={m.survival} /> : <p style={{ fontFamily: MONO, fontSize: 12, color: P.muted2 }}>no dated ads to plot</p>}
        </ScanCard>

        <ScanCard title="Format breakdown" sub="static / video · median lifespan" span>
          <FormatBreakdown m={m} />
        </ScanCard>

        <ScanCard title="CTA mix" sub="% of ads · lifespan">
          {m.ctas.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {m.ctas.slice(0, 3).map((c, i) => (
                <div key={i} style={{ border: `1px solid ${P.border}`, borderRadius: 10, padding: "14px 16px", background: P.surface2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: P.text }}>{c.label}</span>
                    <div style={{ display: "flex", gap: 18 }}>
                      {[{ v: `${Math.round(c.pct * 100)}%`, k: "Share", hi: true }, { v: String(c.count), k: "Ads" }, { v: `${c.medianDays}d`, k: "Life" }].map((s, j) => (
                        <div key={j} style={{ textAlign: "right" }}>
                          <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color: s.hi ? P.blue : P.text }}>{s.v}</div>
                          <div style={{ fontSize: 11, color: P.muted, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>{s.k}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: P.border, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 999, width: `${Math.round(c.pct * 100)}%`, background: "linear-gradient(90deg, var(--accent), #6E90F0)" }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <p style={{ fontFamily: MONO, fontSize: 12, color: P.muted2 }}>no CTA on these ads</p>}
        </ScanCard>

        <ScanCard title="Leads to" sub="destination">
          {m.destinations.length > 0 ? m.destinations.slice(0, 4).map((d, i) => (
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${P.border}`, borderRadius: 10, padding: "14px 16px", background: P.surface2, marginBottom: 8, gap: 12 }}>
                <span style={{ fontFamily: MONO, fontSize: 15, color: P.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
                <span style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color: P.blue }}>{Math.round(d.pct * 100)}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: P.border, overflow: "hidden", marginBottom: 10 }}>
                <div style={{ height: "100%", borderRadius: 999, width: `${Math.round(d.pct * 100)}%`, background: "linear-gradient(90deg, var(--accent), #6E90F0)" }} />
              </div>
            </div>
          )) : <p style={{ fontFamily: MONO, fontSize: 12, color: P.muted2 }}>destination not captured</p>}
        </ScanCard>

        <ScanCard title="Offer signal in copy" span>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <OfferTile pct={m.offerDiscountPct} label="Mention discount" />
            <OfferTile pct={m.offerUrgencyPct} label="“Limited time”" />
          </div>
        </ScanCard>
      </div>

      {/* footer stat strip */}
      <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
        <StatTile top={`${m.influencerAds} <span style="color:${P.muted2}">/ ${m.totalAds}</span>`} frac={m.totalAds ? m.influencerAds / m.totalAds : 0} label="Influencer ads" />
        <StatTile top={`${m.regionalAds} <span style="color:${P.muted2}">/ ${m.totalAds}</span>`} frac={m.totalAds ? m.regionalAds / m.totalAds : 0} label="Regional-language ads" />
        {topLang && <StatTile top={`<span style="color:${P.blue}">${topLang.count}</span>`} frac={1} label={topLang.label} lang />}
      </div>
    </div>
  );
}

export function AdIntelligence({ you, competitors, lean = false }: { you: BrandAds | null; competitors: BrandAds[]; lean?: boolean }) {
  const intel = useMemo(() => buildAdIntel(you, competitors), [you, competitors]);

  if (!intel.hasData) {
    return (
      <div className="py-8 space-y-2">
        <p className="text-sm text-fg-dim font-medium">No paid-ad data to compare yet.</p>
        <p className="text-xs text-fg-mute">Run an analysis with a Meta Ad Library URL and/or <span className="font-medium text-fg-dim">competitors</span> so we can rank ad activity across the set.</p>
      </div>
    );
  }

  const topComp = intel.brands.find(b => !b.isYou);
  const th = { fontFamily: MONO, fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.06em", color: C.ashDim, fontWeight: 500, textAlign: "left" as const, padding: "13px 16px", borderBottom: `1px solid ${C.inkLine}` };
  const td = { padding: "13px 16px", borderBottom: `1px solid ${C.inkLine}`, fontFamily: MONO, fontSize: 13, color: C.ash };

  return (
    <div style={{ background: C.ink, border: `1px solid ${C.inkLine}`, borderRadius: 8, overflow: "hidden", color: C.ash }}>
      <div style={{ padding: "22px 28px 6px" }}>
        <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: C.amber, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 20, height: 1, background: C.amber, display: "inline-block" }} />{lean ? "Google Ads Transparency · Media Intelligence" : "Meta Ad Library · Media Intelligence"}
        </div>
        <h2 style={{ fontFamily: DISPLAY, color: C.paper, fontSize: 24, fontWeight: 600, margin: "12px 0 2px", letterSpacing: "-0.02em" }}>Who to worry about first.</h2>
        <p style={{ fontSize: 13.5, color: C.ashDim, maxWidth: 620 }}>Every brand measured on the same signals from the Ad Library — volume (active ads), cadence (new ads this week), longevity (how long ads survive), creative churn and the video/static mix. Straight from the ads a brand actually runs.</p>
      </div>

      {/* readout — You vs the top competitor */}
      {(intel.you || topComp) && (
        <div style={{ margin: "18px 28px 0", border: `1px solid ${C.inkLine}`, background: C.inkSoft, borderRadius: 4, display: "flex", flexWrap: "wrap" }}>
          {intel.you && <ReadoutCol m={intel.you} />}
          {intel.you && topComp && <div style={{ width: 1, background: C.inkLine }} />}
          {topComp && <ReadoutCol m={topComp} />}
        </div>
      )}

      {/* ranking table — for Meta this Total/Active/New/Refresh data is repeated in the
          Competitor Analysis grid below, so only render it in the lean (Google) view,
          which has no grid. */}
      {lean && (
      <div style={{ padding: "26px 28px 8px" }}>
        <div style={{ overflowX: "auto", border: `1px solid ${C.inkLine}`, borderRadius: 4 }}>
          <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Rank", "Brand", "Total", "Active", "New this week", "Refresh"].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {intel.brands.map(m => {
                const hl = m.isYou ? "var(--accent-2-soft)" : m.rank === 1 ? "var(--accent-soft)" : "transparent";
                const brandColor = m.isYou ? C.teal : m.rank === 1 ? C.amber : C.ash;
                return (
                  <tr key={`${m.brand}-${m.rank}`} style={{ background: hl }}>
                    <td style={{ ...td, color: C.ashDim }}>{String(m.rank).padStart(2, "0")}</td>
                    <td style={{ ...td, color: brandColor, fontWeight: m.isYou || m.rank === 1 ? 600 : 400 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {m.brand}{m.isYou && <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: C.teal, border: `1px solid ${C.teal}`, borderRadius: 999, padding: "1px 6px", textTransform: "uppercase", letterSpacing: "0.04em" }}>you</span>}<ArchTag archetype={m.archetype} />
                      </span>
                    </td>
                    <td style={{ ...td, fontWeight: 600, color: C.paper }} title={`All collated ad cards in the library (active + inactive).${m.totalVersions > m.totalAds ? ` ≈${m.totalVersions} versions — Meta's “~N results” header counts each collated variant.` : " Meta's “~N results” header counts each collated variant, so it can read higher."}`}>{m.totalAds}{m.totalVersions > m.totalAds ? <span style={{ color: C.ashDim, fontWeight: 400 }}> / ≈{m.totalVersions}</span> : null}</td>
                    <td style={td} title="Currently running ads">{m.activeAds}</td>
                    <td style={td}>{m.newThisWeek}</td>
                    <td style={td}>{Math.round(m.refreshRate * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* The per-brand Competitor Analysis Report (Total-Ads template) — matches the PDF.
          The per-brand ad-scan cards and channel-shift section were removed as extra info
          not present in the report spec. */}
      {!lean && (
        <div style={{ padding: "18px 28px 28px" }}>
          <CompetitorReportSection you={you} competitors={competitors} />
        </div>
      )}
      {lean && <div style={{ height: 20 }} />}
    </div>
  );
}
