
import { useMemo, useState } from "react";
import { buildAdTrends, type BrandTrend, type MonthTrend } from "@/lib/media-analyser/ad-trends";
import type { BrandAds } from "@/lib/media-analyser/paid-ad-intel";

const P = {
  blue: "var(--accent)", amber: "var(--accent-2)", text: "var(--fg)", muted: "var(--fg-dim)",
  muted2: "var(--fg-mute)", border: "var(--line)", surface: "var(--surface)",
};
const MONO = "var(--font-mono), 'IBM Plex Mono', ui-monospace, monospace";
const DISPLAY = "var(--font-display), 'Space Grotesk', sans-serif";

const BRAND_PALETTE = ["#e08a00", "#0ea872", "#dc2626", "#7c5cff", "#0891b2", "#c026d3"];
const brandColor = (b: BrandTrend, i: number): string => (b.isYou ? P.blue : BRAND_PALETTE[(i - 1 + BRAND_PALETTE.length) % BRAND_PALETTE.length]);

// Dash patterns distinguish the 1–3 series of a split within one brand's colour.
const DASHES = [undefined, "7 4", "2 4"];
const CTA_COLORS = ["var(--accent)", "#e08a00", "#0ea872", "#dc2626", "#7c5cff"];

type NumKey = Exclude<keyof MonthTrend, "key" | "label" | "ctas">;
interface MetricDef { key: string; label: string; series: { label: string; field: NumKey }[] }

const METRICS: MetricDef[] = [
  { key: "count", label: "No. of ads", series: [{ label: "Ads", field: "total" }] },
  { key: "brandPartner", label: "Brand vs Partner ads", series: [{ label: "Brand", field: "brandOwn" }, { label: "Partner", field: "partner" }] },
  { key: "videoStatic", label: "Video vs Static", series: [{ label: "Video", field: "video" }, { label: "Static", field: "staticc" }] },
  { key: "channel", label: "Website/App vs Marketplaces vs Others", series: [{ label: "Website/App", field: "ownedSite" }, { label: "Marketplaces", field: "marketplace" }, { label: "Others", field: "otherChannel" }] },
  { key: "lang", label: "English vs Vernacular", series: [{ label: "English", field: "english" }, { label: "Vernacular", field: "vernacular" }] },
  { key: "influencer", label: "Native vs Influencers", series: [{ label: "Native", field: "native" }, { label: "Influencers", field: "influencer" }] },
  { key: "cta", label: "CTAs", series: [] }, // special-cased: one brand, top CTA buckets as lines
];

interface Line { color: string; dash?: string; values: (number | null)[] }

export function AdTrendGraph({ you, competitors }: { you: BrandAds | null; competitors: BrandAds[] }) {
  const set = useMemo(() => buildAdTrends(you, competitors), [you, competitors]);
  const [metricKey, setMetricKey] = useState("count");
  const [selected, setSelected] = useState<Set<string>>(() => {
    const names = set.brands.map(b => b.brand);
    // Default: You + the top competitor checked.
    const def = new Set<string>();
    const youB = set.brands.find(b => b.isYou);
    if (youB) def.add(youB.brand);
    const firstComp = set.brands.find(b => !b.isYou);
    if (firstComp) def.add(firstComp.brand);
    return def.size ? def : new Set(names.slice(0, 2));
  });

  if (!set.hasData) return null;

  const metric = METRICS.find(m => m.key === metricKey) ?? METRICS[0];
  const isCta = metric.key === "cta";
  const n = set.months.length;
  const shown = set.brands.filter(b => selected.has(b.brand));
  // CTA view is single-brand (top buckets as lines); use the first selected brand.
  const ctaBrand = isCta ? (shown[0] ?? set.brands[0]) : null;
  const ctaBuckets = set.ctaBuckets.slice(0, 4);

  // Build the line set + legend for the active metric.
  const lines: Line[] = [];
  const legend: { color: string; dash?: string; label: string }[] = [];
  if (isCta && ctaBrand) {
    ctaBuckets.forEach((bucket, i) => {
      lines.push({ color: CTA_COLORS[i % CTA_COLORS.length], values: ctaBrand.monthly.map(m => m.ctas[bucket] ?? 0) });
      legend.push({ color: CTA_COLORS[i % CTA_COLORS.length], label: bucket });
    });
  } else {
    shown.forEach(b => {
      const i = set.brands.indexOf(b);
      const col = brandColor(b, i);
      metric.series.forEach((s, si) => {
        lines.push({ color: col, dash: DASHES[si], values: b.monthly.map(m => m[s.field] as number) });
      });
    });
    // Legend: brand colours + (for splits) what each dash means.
    shown.forEach(b => { const i = set.brands.indexOf(b); legend.push({ color: brandColor(b, i), label: b.brand + (b.isYou ? " (you)" : "") }); });
  }

  const maxVal = Math.max(1, ...lines.flatMap(l => l.values.map(v => v ?? 0)));
  const x = (i: number) => 46 + 700 * (n > 1 ? i / (n - 1) : 0);
  const y = (v: number) => 22 + (1 - v / maxVal) * 128;
  const gridVals = [maxVal, Math.round(maxVal / 2), 0];

  const toggleBrand = (name: string) =>
    setSelected(prev => { const s = new Set(prev); if (s.has(name)) s.delete(name); else s.add(name); return s; });

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: P.blue, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 20, height: 1, background: P.blue, display: "inline-block" }} />Ad strategy · you vs them
        </div>
        <h2 style={{ fontFamily: DISPLAY, color: P.text, fontSize: 24, fontWeight: 700, margin: "12px 0 2px", letterSpacing: "-0.02em" }}>How the ad strategy is moving.</h2>
        <p style={{ fontSize: 13.5, color: P.muted, maxWidth: 680 }}>Pick a metric and the brands to compare. Every brand plots over the last 6 months — one line for volume, two or three lines for the splits. Counts from the Meta Ad Library, no spend estimates.</p>
      </div>

      {/* controls: metric dropdown + brand checkboxes */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <select value={metricKey} onChange={e => setMetricKey(e.target.value)}
          style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, padding: "8px 12px", borderRadius: 8, border: `1px solid ${P.border}`, background: P.surface, color: P.text, cursor: "pointer" }}>
          {METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          {set.brands.map((b, i) => (
            <label key={b.brand} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: P.muted, cursor: "pointer", fontWeight: 600 }}>
              <input type="checkbox" checked={selected.has(b.brand)} onChange={() => toggleBrand(b.brand)}
                style={{ accentColor: brandColor(b, i), width: 15, height: 15, cursor: "pointer" }} />
              <span style={{ display: "inline-block", width: 12, height: 3, borderRadius: 2, background: brandColor(b, i) }} />
              {b.brand}{b.isYou ? " (you)" : ""}
            </label>
          ))}
        </div>
      </div>

      {isCta && ctaBrand && <p style={{ fontSize: 12, color: P.muted2, fontFamily: MONO, marginBottom: 10 }}>CTAs shown for <strong style={{ color: P.text }}>{ctaBrand.brand}</strong> — top {ctaBuckets.length} calls-to-action.</p>}

      {/* chart */}
      <svg viewBox="0 0 780 190" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
        {gridVals.map((gv, i) => (
          <g key={i}>
            <line x1="40" y1={y(gv)} x2="780" y2={y(gv)} stroke={P.border} strokeWidth="1" />
            <text x="0" y={y(gv) + 4} fontFamily={MONO} fontSize="11" fontWeight="600" fill={P.muted2}>{gv}</text>
          </g>
        ))}
        {lines.map((l, li) => {
          const pts = l.values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v !== null);
          if (!pts.length) return null;
          const path = pts.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
          return (
            <g key={li}>
              <path d={path} fill="none" stroke={l.color} strokeWidth={2.2} strokeDasharray={l.dash} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map(p => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={3} fill={l.color} />)}
            </g>
          );
        })}
        {set.months.map((m, i) => (
          <text key={m.key} x={x(i)} y="176" textAnchor="middle" fontFamily={MONO} fontSize="10.5" fontWeight="600" fill={P.muted}>{m.label}</text>
        ))}
      </svg>

      {/* legends */}
      <div style={{ display: "flex", gap: 18, marginTop: 14, fontSize: 12.5, color: P.muted, flexWrap: "wrap", fontWeight: 600 }}>
        {legend.map((l, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span style={{ display: "inline-block", width: 16, height: 3, borderRadius: 2, background: l.color }} />{l.label}
          </span>
        ))}
      </div>
      {!isCta && metric.series.length > 1 && (
        <div style={{ display: "flex", gap: 18, marginTop: 8, fontSize: 12, color: P.muted2, flexWrap: "wrap", fontFamily: MONO }}>
          {metric.series.map((s, si) => (
            <span key={si} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke={P.muted} strokeWidth="2.2" strokeDasharray={DASHES[si]} /></svg>{s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
