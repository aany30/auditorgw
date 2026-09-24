
import { useMemo, useState } from "react";
import { buildChannelShift, type Channel, type ChannelShiftBrand } from "@/lib/media-analyser/channel-shift";
import type { BrandAds } from "@/lib/media-analyser/paid-ad-intel";

const P = {
  blue: "var(--accent)", amber: "var(--accent-2)", green: "var(--success)", red: "var(--alert)", gray: "var(--fg-mute)",
  text: "var(--fg)", muted: "var(--fg-dim)", muted2: "var(--fg-mute)",
  border: "var(--line)", surface: "var(--surface)", surface2: "var(--surface-2)",
  redSoft: "var(--alert-soft)", amberSoft: "var(--accent-2-soft)", greenSoft: "var(--success-soft)", blueSoft: "var(--accent-soft)",
};
const MONO = "var(--font-mono), 'IBM Plex Mono', ui-monospace, monospace";
const DISPLAY = "var(--font-display), 'Space Grotesk', sans-serif";

type Metric = Channel | "Video";
const channelColor = (c: Channel): string =>
  c === "Marketplace" ? P.amber : c === "Owned site" ? P.blue : c === "Social" ? P.green : P.gray;
const metricColor = (m: Metric): string => (m === "Video" ? P.red : channelColor(m));

// Distinct line colour per brand — you highlighted, competitors cycle a fixed palette.
const BRAND_PALETTE = ["#e08a00", "#0ea872", "#dc2626", "#7c5cff", "#0891b2", "#c026d3"];
const brandColor = (b: ChannelShiftBrand, i: number): string => (b.isYou ? P.blue : BRAND_PALETTE[(i - 1 + BRAND_PALETTE.length) % BRAND_PALETTE.length]);

const cardStyle: React.CSSProperties = { border: `1px solid ${P.border}`, background: P.surface, borderRadius: 14, padding: "20px 22px", boxShadow: "0 1px 2px rgba(20,23,31,0.03)" };

function CardHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: P.muted, fontWeight: 700 }}>{title}</span>
      {sub && <span style={{ fontSize: 12, color: P.muted2, fontFamily: MONO, fontWeight: 500 }}>{sub}</span>}
    </div>
  );
}

/** Auto-generated verdict sentences: who is pivoting where, you vs competitor. */
function Narrative({ lines }: { lines: { text: string; tone: "shift" | "compare" }[] }) {
  if (!lines.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
      {lines.map((l, i) => {
        const accent = l.tone === "compare" ? P.blue : P.amber;
        const soft = l.tone === "compare" ? P.blueSoft : P.amberSoft;
        return (
          <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: soft, border: `1px solid ${P.border}`, borderLeft: `3px solid ${accent}`, borderRadius: 10, padding: "12px 16px" }}>
            <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: accent, marginTop: 2, whiteSpace: "nowrap" }}>{l.tone === "compare" ? "You vs them" : "Shift"}</span>
            <span style={{ fontSize: 14, color: P.text, fontWeight: 500, lineHeight: 1.5 }}>{l.text}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Cross-brand trend: % of ads to the selected metric per month, one line per brand. */
function ComparisonChart({ brands, months, metric }: { brands: ChannelShiftBrand[]; months: { key: string; label: string }[]; metric: Metric }) {
  const n = months.length;
  const valueAt = (b: ChannelShiftBrand, key: string): number | null => {
    const mm = b.monthly.find((x) => x.key === key);
    if (!mm || mm.total === 0) return null;
    return metric === "Video" ? mm.videoPct : mm.mix[metric];
  };
  const x = (i: number) => 46 + 700 * (n > 1 ? i / (n - 1) : 0);
  const y = (p: number) => 22 + (1 - p) * 128; // 0..1 → top(22)…bottom(150)
  return (
    <>
      <svg viewBox="0 0 780 190" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
        {[{ p: 1, l: "100%" }, { p: 0.5, l: "50%" }, { p: 0, l: "0%" }].map((g, i) => (
          <g key={i}>
            <line x1="40" y1={y(g.p)} x2="780" y2={y(g.p)} stroke={P.border} strokeWidth="1" />
            <text x="0" y={y(g.p) + 4} fontFamily={MONO} fontSize="11" fontWeight="600" fill={P.muted2}>{g.l}</text>
          </g>
        ))}
        {brands.map((b, bi) => {
          const col = brandColor(b, bi);
          const pts = months.map((m, i) => ({ i, v: valueAt(b, m.key) })).filter((p): p is { i: number; v: number } => p.v !== null);
          if (!pts.length) return null;
          const line = pts.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
          return (
            <g key={b.brand}>
              <path d={line} fill="none" stroke={col} strokeWidth={b.isYou ? 3 : 2} strokeLinejoin="round" strokeLinecap="round" opacity={b.isYou ? 1 : 0.9} strokeDasharray={b.isYou ? undefined : "1 0"} />
              {pts.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={b.isYou ? 4.5 : 3.5} fill={col} />)}
            </g>
          );
        })}
        {months.map((m, i) => (
          <text key={m.key} x={x(i)} y="176" textAnchor="middle" fontFamily={MONO} fontSize="10.5" fontWeight="600" fill={P.muted}>{m.label}</text>
        ))}
      </svg>
      <div style={{ display: "flex", gap: 18, marginTop: 14, fontSize: 12.5, color: P.muted, flexWrap: "wrap", fontWeight: 600 }}>
        {brands.map((b, bi) => (
          <span key={b.brand} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span style={{ display: "inline-block", width: 14, height: b.isYou ? 4 : 3, borderRadius: 2, background: brandColor(b, bi) }} />
            <span style={{ color: b.isYou ? P.text : P.muted }}>{b.brand}{b.isYou ? " (you)" : ""}</span>
          </span>
        ))}
      </div>
    </>
  );
}

/** Post-analysis verdict — channel-strategy shift, you vs competitors, over time. */
export function ChannelShiftSection({ you, competitors }: { you: BrandAds | null; competitors: BrandAds[] }) {
  const set = useMemo(() => buildChannelShift(you, competitors), [you, competitors]);
  const metrics = useMemo<Metric[]>(() => [...set.channels, "Video" as Metric], [set.channels]);
  const [metric, setMetric] = useState<Metric>(set.headlineChannel);
  const activeMetric = metrics.includes(metric) ? metric : (set.headlineChannel as Metric);

  if (!set.hasData) return null;

  const metricLabel = activeMetric === "Video" ? "Video / reel ads" : `Ads sent to ${activeMetric}`;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: P.blue, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 20, height: 1, background: P.blue, display: "inline-block" }} />The verdict · Channel strategy shift
        </div>
        <h2 style={{ fontFamily: DISPLAY, color: P.text, fontSize: 24, fontWeight: 700, margin: "12px 0 2px", letterSpacing: "-0.02em" }}>How the ad strategy is moving — you vs them.</h2>
        <p style={{ fontSize: 13.5, color: P.muted, maxWidth: 680 }}>Where each brand sends its ad traffic (Marketplace, own site, social, video) and how that split has shifted over the last 6, 3 and 1 months — the read you&apos;d otherwise build by hand in Meta Ad Library.</p>
      </div>

      <Narrative lines={set.narrative} />

      {/* trend comparison */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <CardHead title="Destination trend · brand vs brand" sub={metricLabel} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {metrics.map((m) => {
            const on = m === activeMetric;
            const col = metricColor(m);
            return (
              <button key={m} onClick={() => setMetric(m)} style={{ cursor: "pointer", fontFamily: MONO, fontSize: 12, fontWeight: 600, letterSpacing: "0.02em", padding: "6px 12px", borderRadius: 999, border: `1px solid ${on ? col : P.border}`, background: on ? col : P.surface, color: on ? "#fff" : P.muted, transition: "all .12s" }}>
                {m === "Video" ? "Video %" : m}
              </button>
            );
          })}
        </div>
        <ComparisonChart brands={set.brands} months={set.months} metric={activeMetric} />
      </div>
    </div>
  );
}
