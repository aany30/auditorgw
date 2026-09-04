/**
 * PdfReportPages — landscape 16:9 agency-deck report, rendered to a real
 * vector PDF server-side via Puppeteer's page.pdf() (see /api/reporting/pdf).
 *
 * Design language mirrors a professional media-review deck:
 *   • Cover: dark navy, brand pill, filter cards, KPI cards w/ trend badges
 *   • Content pages: light theme, dark header bar, 2×2 grid of white cards
 *     with colored icon badges, hand-rolled SVG/CSS charts, callout boxes.
 *
 * Constraints (static markup, no client JS):
 *   • No Recharts/ResponsiveContainer — all charts are inline SVG / CSS.
 *   • All colors explicit hex. lucide-react icons render to SVG fine here.
 *   • Each page is PDF_W×PDF_H with pageBreakAfter.
 */

import React from "react";
import {
  Calendar, MapPin, Share2, Wallet, Target, TrendingUp, Users, Image as ImageIcon,
  Layers, BarChart3, PieChart, Film, Activity, Award, AlertTriangle, Lightbulb,
  Globe, Megaphone, Filter, DollarSign, Zap, CheckCircle2, Eye, MousePointer,
} from "lucide-react";
import { formatMoney } from "@/lib/currency";
import type { CampaignData } from "@/types/index";
import type { AdInsightRow } from "@/pages/api/reporting/ad-insights/meta";

export const PDF_W = 1280;
export const PDF_H = 720;

// ── Palette ───────────────────────────────────────────────────────────────────
const INDIGO = "#6366F1";
const INDIGO_D = "#4F46E5";
const GREEN  = "#10B981";
const GREEN_D = "#059669";
const ORANGE = "#F59E0B";
const PINK   = "#EC4899";
const RED    = "#EF4444";
const BLUE   = "#3B82F6";

const PAGE_BG = "#EEF1F6";   // light slide bg
const CARD    = "#FFFFFF";
const CARD_BORDER = "#E5E9F0";
const HEADER_BG = "#0B1220"; // dark header bar
const NAVY    = "#0A0F28";   // cover bg
const NAVY2   = "#0E1533";

const TEXT    = "#1E293B";
const MUTED   = "#64748B";
const FAINT   = "#94A3B8";
const TRACK   = "#EEF1F6";   // bar track

const SERIES = [INDIGO, GREEN, ORANGE, PINK, RED, BLUE];

type Px = React.CSSProperties;
type IconType = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

const page: Px = {
  width: PDF_W, height: PDF_H, position: "relative", overflow: "hidden",
  backgroundColor: PAGE_BG, color: TEXT, boxSizing: "border-box", lineHeight: 1.2,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  pageBreakAfter: "always", breakAfter: "page",
};

// ── Number helpers ──────────────────────────────────────────────────────────
const fmtInt = (n: number) => Math.round(n || 0).toLocaleString("en-IN");
const fmtBig = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000   ? `${(n / 1_000).toFixed(1)}K`
  : fmtInt(n);
const pctStr = (a: number, b: number, dp = 2) => (b > 0 ? `${((a / b) * 100).toFixed(dp)}%` : "—");
const ratio = (a: number, b: number, suffix = "×") => (b > 0 && a > 0 ? `${(a / b).toFixed(2)}${suffix}` : "—");

// ─────────────────────────────────────────────────────────────────────────────
// Shared building blocks
// ─────────────────────────────────────────────────────────────────────────────

// ── BBD-style primitives ────────────────────────────────────────────────────
// These match Flipkart's BBD "Digital Performance Report" template: bordered
// KPI boxes in a strip, orange pacing circles between deliveries and targets,
// blue-headered tables with white bar-chart marks inside cells, and green
// heatmap cells for the Spend column of creative tables.

const BBD_BLUE = "#3773F1";
const BBD_ORANGE = "#F5A623";
const BBD_BAR_BLUE = "#4A9EFF";
const BBD_BAR_CYAN = "#5AC8D9";
const BBD_BAR_PINK = "#EC4899";
const BBD_BAR_GREEN = "#A3D96C";
const BBD_HEAT_1 = "#DBF3D3";
const BBD_HEAT_2 = "#A8E28C";
const BBD_HEAT_3 = "#66C947";

function BbdKpiBox({ label, value, active = true }: { label: string; value: string; active?: boolean }) {
  return (
    <div style={{
      flex: 1, minWidth: 120,
      border: `1.5px solid ${active ? BBD_BLUE : "#D6DEE9"}`,
      borderRadius: 6,
      padding: "10px 14px",
      textAlign: "center",
      background: "#FFFFFF",
    }}>
      <div style={{ fontSize: 10, color: MUTED, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: active ? "#111" : "#6B7280", lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

function BbdPacingCircle({ pct }: { pct: number | null }) {
  if (pct === null || !Number.isFinite(pct)) return <div style={{ width: 44 }} />;
  return (
    <div style={{
      width: 44, height: 44, borderRadius: 22,
      background: BBD_ORANGE, color: "#FFF",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, fontWeight: 800,
      boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
      flexShrink: 0, zIndex: 2, position: "relative",
    }}>
      {Math.round(pct)}%
    </div>
  );
}

/** Row that pairs a left-side label ("Overall Deliveries") with 4 KPI boxes.
 *  When `pacingBelow` is provided, pacing circles overlap the box borders
 *  between this row and the row below. */
function BbdKpiRow({
  label, values, active = true,
}: { label: string; values: { label: string; value: string }[]; active?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 160, fontSize: 14, fontWeight: 700, color: TEXT }}>{label}</div>
      <div style={{ flex: 1, display: "flex", gap: 8 }}>
        {values.map((v, i) => (
          <BbdKpiBox key={i} label={v.label} value={v.value} active={active} />
        ))}
      </div>
    </div>
  );
}

/** Table cell with a background bar sized to the value's share of the max. */
function InlineBarCell({ value, max, color, formatted }: {
  value: number; max: number; color: string; formatted: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <td style={{ padding: "6px 10px", position: "relative", fontSize: 11, textAlign: "right" }}>
      <div style={{
        position: "absolute", left: 8, right: 8, bottom: 4, top: "50%",
        background: color, opacity: 0.85, borderRadius: 1,
        width: `calc((100% - 16px) * ${pct / 100})`,
        transformOrigin: "left center",
      }} />
      <span style={{ position: "relative", zIndex: 1 }}>{formatted}</span>
    </td>
  );
}

/** Green-heatmap cell for the Spend column of creative tables. */
function HeatmapCell({ value, max, formatted }: { value: number; max: number; formatted: string }) {
  const share = max > 0 ? value / max : 0;
  const bg = share > 0.66 ? BBD_HEAT_3 : share > 0.33 ? BBD_HEAT_2 : share > 0 ? BBD_HEAT_1 : "transparent";
  return (
    <td style={{
      padding: "6px 10px", background: bg, fontSize: 11, textAlign: "right", fontWeight: 600,
    }}>{formatted}</td>
  );
}

function BbdTableHeader({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr style={{ background: BBD_BLUE, color: "#FFFFFF" }}>
        {cols.map((c, i) => (
          <th key={i} style={{
            padding: "8px 10px", fontSize: 11, fontWeight: 700,
            textAlign: i === 0 ? "left" : "right", whiteSpace: "nowrap",
          }}>{c}</th>
        ))}
      </tr>
    </thead>
  );
}

function IconBadge({ Icon, color, size = 34 }: { Icon: IconType; color: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 9, background: color,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      <Icon size={size * 0.5} color="#FFFFFF" strokeWidth={2.4} />
    </div>
  );
}

function SlideHeader({ num, title, badge, rightText, Icon }: {
  num: number; title: string; badge?: string; rightText?: string; Icon: IconType;
}) {
  return (
    <div style={{
      height: 64, background: HEADER_BG, display: "flex", alignItems: "center",
      padding: "0 36px", justifyContent: "space-between",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Icon size={26} color="#FFFFFF" strokeWidth={2.2} />
        <span style={{ fontSize: 23, fontWeight: 800, color: "#FFFFFF", letterSpacing: "-0.01em" }}>
          {num}. {title}
        </span>
        {badge && (
          <span style={{
            marginLeft: 6, background: "#2A2F52", color: "#C7CBF0",
            fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 14,
            textAlign: "center", lineHeight: 1.15,
          }}>{badge}</span>
        )}
      </div>
      {rightText && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#8B93B8", fontSize: 13 }}>
          <Calendar size={14} color="#8B93B8" />
          {rightText}
        </div>
      )}
    </div>
  );
}

function Card({ Icon, color, title, rightLabel, children, style }: {
  Icon: IconType; color: string; title: string; rightLabel?: string;
  children: React.ReactNode; style?: Px;
}) {
  return (
    <div style={{
      background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 14,
      padding: "16px 18px", boxShadow: "0 1px 3px rgba(15,23,42,0.05)",
      display: "flex", flexDirection: "column", ...style,
    }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <IconBadge Icon={Icon} color={color} />
        <span style={{ marginLeft: 11, fontSize: 16, fontWeight: 800, color: TEXT }}>{title}</span>
        {rightLabel && (
          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: INDIGO_D }}>{rightLabel}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Callout({ variant, label, text }: { variant: "insight" | "optimization"; label: string; text: string }) {
  const accent = variant === "insight" ? ORANGE : GREEN;
  const bg = variant === "insight" ? "#FEF9EC" : "#ECFDF5";
  const Ico = variant === "insight" ? Lightbulb : CheckCircle2;
  return (
    <div style={{
      background: bg, borderLeft: `3px solid ${accent}`, borderRadius: 6,
      padding: "9px 12px", display: "flex", gap: 8, alignItems: "flex-start", marginTop: "auto",
    }}>
      <Ico size={14} color={accent} strokeWidth={2.5} style={{ marginTop: 1, flexShrink: 0 }} />
      <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.45 }}>
        <span style={{ fontWeight: 800, color: accent === ORANGE ? "#B45309" : GREEN_D }}>{label}: </span>
        {text}
      </div>
    </div>
  );
}

function StatTile({ label, value, color = TEXT, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ background: "#F8FAFC", border: `1px solid ${CARD_BORDER}`, borderRadius: 9, padding: "10px 12px" }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: FAINT, letterSpacing: "0.06em", marginBottom: 5 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: FAINT, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ── Tables ──────────────────────────────────────────────────────────────────
function MiniTable({ headers, rows, aligns, maxRows = 8 }: {
  headers: string[]; rows: (string | number)[][]; aligns?: ("l" | "r")[]; maxRows?: number;
}) {
  const shown = rows.slice(0, maxRows);
  const al = (i: number) => (aligns?.[i] === "r" || (aligns === undefined && i > 0) ? "right" : "left");
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i} style={{
              textAlign: al(i), padding: "6px 8px", color: MUTED, fontWeight: 700,
              fontSize: 10, letterSpacing: "0.04em", borderBottom: `1.5px solid ${CARD_BORDER}`, whiteSpace: "nowrap",
            }}>{h.toUpperCase()}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shown.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, ci) => (
              <td key={ci} style={{
                textAlign: al(ci), padding: "6px 8px",
                color: ci === 0 ? TEXT : "#475569", fontWeight: ci === 0 ? 600 : 500,
                borderBottom: `1px solid #F1F5F9`, whiteSpace: "nowrap",
              }}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Horizontal bar chart (CSS) ───────────────────────────────────────────────
function HBarChart({ data, valueRight }: {
  data: { label: string; value: number; color?: string }[];
  valueRight?: (v: number, pct: number) => string;
}) {
  const max = Math.max(...data.map(d => d.value), 1);
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {data.map((d, i) => {
        const w = (d.value / max) * 100;
        const pct = total > 0 ? (d.value / total) * 100 : 0;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 56, fontSize: 11, fontWeight: 600, color: TEXT, textAlign: "right" }}>{d.label}</div>
            <div style={{ flex: 1, height: 16, background: TRACK, borderRadius: 8, overflow: "hidden" }}>
              <div style={{ width: `${w}%`, height: "100%", background: d.color || SERIES[i % SERIES.length], borderRadius: 8 }} />
            </div>
            <div style={{ width: 64, fontSize: 11, fontWeight: 700, color: "#334155", textAlign: "right" }}>
              {valueRight ? valueRight(d.value, pct) : `${pct.toFixed(0)}%`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Vertical bar chart (CSS) ─────────────────────────────────────────────────
function VBarChart({ data, height = 150, fmt }: {
  data: { label: string; value: number; color?: string }[]; height?: number; fmt?: (v: number) => string;
}) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height, paddingTop: 18 }}>
      {data.map((d, i) => {
        const h = Math.max(2, (d.value / max) * (height - 36));
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
              {fmt ? fmt(d.value) : fmtBig(d.value)}
            </div>
            <div style={{ width: "100%", maxWidth: 54, height: h, background: d.color || SERIES[i % SERIES.length], borderRadius: "6px 6px 0 0" }} />
            <div style={{ fontSize: 10, color: MUTED, marginTop: 6, textAlign: "center", lineHeight: 1.2 }}>{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Line chart (inline SVG, per-series independent scaling) ──────────────────
function LineChartSVG({ series, labels, width = 540, height = 170, area = false }: {
  series: { name: string; color: string; points: number[] }[];
  labels: string[]; width?: number; height?: number; area?: boolean;
}) {
  const padL = 8, padR = 8, padT = 12, padB = 22;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = Math.max(labels.length, 1);
  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      {/* gridlines */}
      {[0, 0.5, 1].map((g, i) => (
        <line key={i} x1={padL} x2={width - padR} y1={padT + g * innerH} y2={padT + g * innerH}
          stroke="#EDF1F7" strokeWidth={1} />
      ))}
      {series.map((s, si) => {
        const max = Math.max(...s.points, 1);
        const min = Math.min(...s.points, 0);
        const span = max - min || 1;
        const y = (v: number) => padT + innerH - ((v - min) / span) * innerH;
        const pts = s.points.map((v, i) => `${x(i)},${y(v)}`).join(" ");
        const areaPts = `${padL},${padT + innerH} ${pts} ${width - padR},${padT + innerH}`;
        return (
          <g key={si}>
            {area && si === 0 && (
              <polygon points={areaPts} fill={s.color} fillOpacity={0.12} />
            )}
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2.4}
              strokeLinejoin="round" strokeLinecap="round" />
            {s.points.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={2.6} fill={s.color} />
            ))}
          </g>
        );
      })}
      {/* x labels */}
      {labels.map((l, i) => (
        (i === 0 || i === labels.length - 1 || i % Math.ceil(labels.length / 6) === 0) && (
          <text key={i} x={x(i)} y={height - 6} fontSize={9} fill={FAINT}
            textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}>{l}</text>
        )
      ))}
    </svg>
  );
}

// ── Grouped bar chart — two series (e.g. Planned vs Actual) side by side per category ──
function GroupedBarChart({ data, seriesNames, colors, height = 150, fmt }: {
  data: { label: string; values: [number, number] }[];
  seriesNames: [string, string]; colors: [string, string]; height?: number; fmt?: (v: number) => string;
}) {
  const max = Math.max(...data.flatMap(d => d.values), 1);
  const f = fmt ?? fmtBig;
  return (
    <div>
      <Legend items={[{ name: seriesNames[0], color: colors[0] }, { name: seriesNames[1], color: colors[1] }]} />
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height, paddingTop: 22, marginTop: 8 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: "100%", width: "100%", justifyContent: "center" }}>
              {d.values.map((v, si) => (
                <div key={si} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", flex: 1, maxWidth: 26 }}>
                  <div style={{ fontSize: 8.5, fontWeight: 700, color: "#334155", marginBottom: 3 }}>{f(v)}</div>
                  <div style={{ width: "100%", height: Math.max(2, (v / max) * (height - 40)), background: colors[si], borderRadius: "4px 4px 0 0" }} />
                </div>
              ))}
            </div>
            <div style={{ fontSize: 9.5, color: MUTED, marginTop: 6, textAlign: "center", lineHeight: 1.2 }}>{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 14, justifyContent: "flex-end", flexWrap: "wrap" }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: MUTED, fontWeight: 600 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: it.color }} />
          {it.name}
        </div>
      ))}
    </div>
  );
}

// ── Donut chart (inline SVG) ─────────────────────────────────────────────────
function DonutSVG({ data, size = 150 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2 - 8;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {data.map((d, i) => {
          const frac = d.value / total;
          const len = frac * circ;
          const seg = (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color}
              strokeWidth={16} strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return seg;
        })}
      </g>
    </svg>
  );
}

// ── Funnel strip ──────────────────────────────────────────────────────────────
function FunnelStrip({ stages }: { stages: { label: string; value: number; color: string }[] }) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const next = i < stages.length - 1 ? stages[i + 1] : null;
        const dropNext = next && s.value > 0 ? (1 - next.value / s.value) * 100 : null;
        return (
          <React.Fragment key={i}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{
                width: "100%", background: s.color, borderRadius: 10, padding: "14px 8px",
                textAlign: "center", color: "#FFFFFF",
              }}>
                <div style={{ fontSize: 20, fontWeight: 900 }}>{fmtBig(s.value)}</div>
                <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.95, marginTop: 3 }}>{s.label}</div>
              </div>
              {i > 0 && prev && prev > 0 && (
                <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginTop: 6 }}>
                  {pctStr(s.value, prev, 1)} <span style={{ color: FAINT }}>pass-through</span>
                </div>
              )}
            </div>
            {next && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 6px", minWidth: 64 }}>
                <div style={{ fontSize: 18, color: FAINT, marginBottom: 4 }}>›</div>
                {dropNext !== null && (
                  <div style={{ background: "#FEE2E2", color: "#B91C1C", fontSize: 9.5, fontWeight: 800, padding: "3px 7px", borderRadius: 10, whiteSpace: "nowrap" }}>
                    -{dropNext.toFixed(0)}%
                  </div>
                )}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function PageFooter({ dateRange, pageNum, total }: { dateRange: string; pageNum: number; total: number }) {
  return (
    <div style={{
      position: "absolute", bottom: 0, left: 0, right: 0, height: 26,
      background: "#E2E7EF", display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 36px",
    }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, color: FAINT, letterSpacing: "0.06em" }}>AUDITOR · AD PERFORMANCE REPORT</span>
      <span style={{ fontSize: 9.5, color: FAINT }}>{dateRange}</span>
      <span style={{ fontSize: 9.5, fontWeight: 700, color: FAINT }}>{pageNum} / {total}</span>
    </div>
  );
}

// Body wrapper: 2×2 grid area beneath the header
function Body({ children, cols = "1fr 1fr", rows = "1fr 1fr" }: { children: React.ReactNode; cols?: string; rows?: string }) {
  return (
    <div style={{
      position: "absolute", top: 64, left: 0, right: 0, bottom: 26,
      padding: 24, display: "grid", gridTemplateColumns: cols, gridTemplateRows: rows, gap: 16,
    }}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Data shapes + helpers
// ─────────────────────────────────────────────────────────────────────────────

export type BreakdownRow = {
  label: string; spend: number; impressions: number; clicks: number;
  conversions: number; conversionValue: number;
};

interface WeekBucket {
  label: string; spend: number; impressions: number; clicks: number;
  conversions: number; conversionValue: number; cpm: number; ctr: number; cpc: number;
}

function weeklyBuckets(daily: BreakdownRow[]): WeekBucket[] {
  if (!daily || daily.length === 0) return [];
  const sorted = [...daily].sort((a, b) => a.label.localeCompare(b.label));
  const out: WeekBucket[] = [];
  for (let i = 0; i < sorted.length; i += 7) {
    const chunk = sorted.slice(i, i + 7);
    const spend = chunk.reduce((s, r) => s + (r.spend || 0), 0);
    const impressions = chunk.reduce((s, r) => s + (r.impressions || 0), 0);
    const clicks = chunk.reduce((s, r) => s + (r.clicks || 0), 0);
    const conversions = chunk.reduce((s, r) => s + (r.conversions || 0), 0);
    const conversionValue = chunk.reduce((s, r) => s + (r.conversionValue || 0), 0);
    out.push({
      label: `W${out.length + 1}`, spend, impressions, clicks, conversions, conversionValue,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
    });
  }
  return out;
}

const cleanLabel = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface PdfReportPagesProps {
  campaigns: CampaignData[];
  pubRows: BreakdownRow[];
  ageRows: BreakdownRow[];
  genderRows: BreakdownRow[];
  countryRows: BreakdownRow[];
  deviceRows: BreakdownRow[];
  dailyRows: BreakdownRow[];
  regionRows: BreakdownRow[];
  adRows: AdInsightRow[];
  currency: string;
  startDate: string;
  endDate: string;
  platform: string;
  // Raw (pre-merge) per-platform rows for the BBD-style detail/creative pages.
  // Optional — pages that need them degrade gracefully (real data or omitted,
  // never fabricated) when absent.
  metaDailyRows?: Array<{ label: string; breakdownValues?: Record<string, string>; spend: number; impressions: number; clicks: number; reach?: number }>;
  metaAdRowsRaw?: AdInsightRow[];
  dv360AdRowsRaw?: AdInsightRow[];
  // Customization (optional — defaults to a full "sales"-style standard deck).
  objective?: ReportObjective;
  length?: ReportLength;
  narrative?: ReportNarrative | null;
  tracking?: TrackingSnapshot | null;
  /** Which sections to include (ids: ai, campaigns, audience, creative,
   *  placement, budget, funnel, tracking). Undefined = all. */
  sections?: string[];
}

export type ReportObjective = "awareness" | "sales" | "traffic" | "lead";
export type ReportLength = "concise" | "standard" | "detailed";
export interface ReportNarrative {
  execSummary: string;
  highlights: string[];
  sectionInsights: Array<{ section: string; text: string }>;
  recommendations: string[];
}
export interface TrackingSnapshot {
  activePixels?: string;
  capiSharePct?: number;
  emqScore?: number;
  totalEvents?: number;
  avgFrequency?: number;
  accountStructure?: { campaigns: number; adSets: number };
  attribution?: Array<{ name: string; clickLookbackDays: number; viewLookbackDays: number }>;
  funnel?: Array<{ stage: string; value: number }>;
}

const OBJECTIVE_TITLE: Record<ReportObjective, { title: string; sub: string }> = {
  awareness: { title: "Brand Awareness Review", sub: "Reach, Frequency & Impression Efficiency" },
  sales:     { title: "Sales & ROI Review", sub: "Revenue, ROAS & Conversion Performance" },
  traffic:   { title: "Traffic & Engagement Review", sub: "Clicks, CTR & Cost-per-Click Efficiency" },
  lead:      { title: "Lead Generation Review", sub: "Leads, Cost-per-Lead & Conversion Rate" },
};

/** Objective-aware KPI cards for the cover (all values from real data). */
function objectiveKpis(
  objective: ReportObjective,
  d: { spend: number; impr: number; clicks: number; conv: number; rev: number; reach: number; views: number },
  currency: string,
): Array<{ label: string; value: string; trend: string; good: boolean; Icon: IconType }> {
  const cur0 = (n: number) => formatMoney(n, currency, 0);
  const roas = d.spend > 0 && d.rev > 0 ? d.rev / d.spend : 0;
  const ctr = d.impr > 0 ? (d.clicks / d.impr) * 100 : 0;
  const cpm = d.impr > 0 ? (d.spend / d.impr) * 1000 : 0;
  const cpc = d.clicks > 0 ? d.spend / d.clicks : 0;
  const cpa = d.conv > 0 ? d.spend / d.conv : 0;
  const freq = d.reach > 0 ? d.impr / d.reach : 0;
  const cvr = d.clicks > 0 ? (d.conv / d.clicks) * 100 : 0;

  if (objective === "awareness") return [
    { label: "Impressions", value: fmtBig(d.impr), trend: `${cur0(d.spend)} spend`, good: true, Icon: Eye as IconType },
    { label: "Reach", value: d.reach > 0 ? fmtBig(d.reach) : "—", trend: d.reach > 0 ? "↑ Unique users" : "No reach data", good: d.reach > 0, Icon: Users as IconType },
    { label: "Frequency", value: freq > 0 ? `${freq.toFixed(2)}×` : "—", trend: freq > 5 ? "↓ Too high" : freq >= 1.5 ? "→ Healthy" : "↑ Low", good: freq >= 1.5 && freq <= 5, Icon: Activity as IconType },
    { label: "CPM", value: d.impr > 0 ? cur0(cpm) : "—", trend: "Cost / 1k impr", good: true, Icon: TrendingUp as IconType },
  ];
  if (objective === "traffic") return [
    { label: "Clicks", value: fmtBig(d.clicks), trend: `${cur0(d.spend)} spend`, good: true, Icon: MousePointer as IconType },
    { label: "CTR", value: d.impr > 0 ? `${ctr.toFixed(2)}%` : "—", trend: ctr >= 1 ? "↑ Strong" : "→ Monitor", good: ctr >= 1, Icon: Activity as IconType },
    { label: "CPC", value: d.clicks > 0 ? formatMoney(cpc, currency, 2) : "—", trend: "Cost / click", good: true, Icon: Wallet as IconType },
    { label: "Impressions", value: fmtBig(d.impr), trend: `${fmtBig(d.reach)} reach`, good: true, Icon: Eye as IconType },
  ];
  if (objective === "lead") return [
    { label: "Leads", value: fmtInt(d.conv), trend: d.conv > 0 ? "↑ Generating" : "↓ None", good: d.conv > 0, Icon: Target as IconType },
    { label: "Cost / Lead", value: d.conv > 0 ? cur0(cpa) : "—", trend: "CPL", good: d.conv > 0, Icon: Wallet as IconType },
    { label: "Conv. Rate", value: d.clicks > 0 ? `${cvr.toFixed(2)}%` : "—", trend: cvr >= 2 ? "↑ Strong" : "→ Monitor", good: cvr >= 2, Icon: Activity as IconType },
    { label: "Total Spend", value: cur0(d.spend), trend: `${fmtInt(d.clicks)} clicks`, good: true, Icon: TrendingUp as IconType },
  ];
  // sales (default)
  return [
    { label: "Total Spend", value: cur0(d.spend), trend: `${fmtInt(d.conv)} conversions`, good: true, Icon: Wallet as IconType },
    { label: "Conversions", value: fmtInt(d.conv), trend: d.conv > 0 ? "↑ Converting" : "↓ None", good: d.conv > 0, Icon: Target as IconType },
    { label: "Revenue", value: cur0(d.rev), trend: d.rev > 0 ? "↑ Tracked" : "↓ No value", good: d.rev > 0, Icon: TrendingUp as IconType },
    { label: "ROAS", value: roas > 0 ? `${roas.toFixed(2)}×` : "—", trend: roas >= 2 ? "↑ Strong" : roas >= 1 ? "→ Monitor" : "↓ Needs lift", good: roas >= 1, Icon: Zap as IconType },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 1 — Cover (dark)
// ─────────────────────────────────────────────────────────────────────────────

function CoverPage(p: PdfReportPagesProps) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const spend = p.campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const impr  = p.campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const clicks = p.campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const conv  = p.campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const rev   = p.campaigns.reduce((s, c) => s + (c.conversionValue || 0), 0);
  const roas  = spend > 0 && rev > 0 ? rev / spend : 0;

  const reach = p.campaigns.reduce((s, c) => s + (c.reach || 0), 0);
  const views = p.campaigns.reduce((s, c) => s + (c.videoViews || 0), 0);
  const objective: ReportObjective = p.objective ?? "sales";
  const heading = OBJECTIVE_TITLE[objective];

  const platformLabel = p.platform === "meta" ? "Meta (FB/IG)" : p.platform === "dv360" ? "DV360" : "Meta + DV360";

  const filters = [
    { Icon: Calendar as IconType, color: INDIGO, label: "Period", value: `${p.startDate} – ${p.endDate}` },
    { Icon: Globe as IconType, color: GREEN, label: "Platform", value: platformLabel },
    { Icon: Share2 as IconType, color: ORANGE, label: "Campaigns", value: String(p.campaigns.length) },
  ];

  const kpis = objectiveKpis(objective, { spend, impr, clicks, conv, rev, reach, views }, p.currency);
  void roas;

  return (
    <div data-pdf-page="1" style={{ ...page, backgroundColor: NAVY, color: "#FFFFFF" }}>
      {/* glow */}
      <div style={{ position: "absolute", top: -160, right: -120, width: 520, height: 520, borderRadius: "50%", background: `radial-gradient(circle, ${INDIGO} 0%, transparent 70%)`, opacity: 0.16 }} />
      <div style={{ position: "absolute", bottom: -120, left: -80, width: 360, height: 360, borderRadius: "50%", background: `radial-gradient(circle, ${PINK} 0%, transparent 70%)`, opacity: 0.1 }} />

      <div style={{ position: "relative", padding: "44px 52px", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
        {/* brand row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#7C84B0", fontWeight: 600, letterSpacing: "0.1em" }}>
            {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
          </span>
          <div style={{ background: NAVY2, border: "1px solid #232A52", borderRadius: 20, padding: "8px 18px" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#FFFFFF", letterSpacing: "0.18em" }}>AUDITOR</span>
          </div>
        </div>

        {/* title */}
        <div style={{ marginTop: 56 }}>
          <div style={{ fontSize: 54, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.05 }}>{heading.title}</div>
          <div style={{ fontSize: 19, color: "#9098C4", marginTop: 14, fontWeight: 400 }}>{heading.sub}</div>
        </div>

        {/* filter cards */}
        <div style={{ display: "flex", gap: 16, marginTop: 36 }}>
          {filters.map((f, i) => (
            <div key={i} style={{ background: NAVY2, border: "1px solid #1E2547", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 13, minWidth: 230 }}>
              <IconBadge Icon={f.Icon} color={f.color} size={38} />
              <div>
                <div style={{ fontSize: 11, color: "#7C84B0", marginBottom: 3 }}>{f.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#FFFFFF" }}>{f.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* KPI cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, marginTop: "auto" }}>
          {kpis.map((k, i) => (
            <div key={i} style={{ background: NAVY2, border: "1px solid #1E2547", borderRadius: 14, padding: "18px 20px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: SERIES[i % SERIES.length] }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: "#8A92BE", fontWeight: 600 }}>{k.label}</span>
                <k.Icon size={16} color="#5B628F" />
              </div>
              <div style={{ fontSize: 30, fontWeight: 900, color: "#FFFFFF", marginBottom: 10 }}>{k.value}</div>
              <span style={{ fontSize: 11, fontWeight: 700, color: k.good ? "#34D399" : "#FB7185" }}>{k.trend}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 26, marginTop: 22, paddingTop: 16, borderTop: "1px solid #1A2044" }}>
          {[
            ["Impressions", fmtBig(impr)],
            ["Clicks", fmtBig(clicks)],
            ["CTR", pctStr(clicks, impr)],
            ["CPM", impr > 0 ? cur0(spend / impr * 1000) : "—"],
            ["CPC", clicks > 0 ? formatMoney(spend / clicks, p.currency, 2) : "—"],
          ].map(([l, v], i) => (
            <div key={i}>
              <div style={{ fontSize: 10, color: "#6B72A0", marginBottom: 4 }}>{l}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: "#FFFFFF" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      {/* accent bar */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 5, background: `linear-gradient(90deg, ${INDIGO}, ${PINK})` }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Budget Utilization & Trend
// ─────────────────────────────────────────────────────────────────────────────

function BudgetPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const weeks = weeklyBuckets(p.dailyRows);
  const sorted = [...p.campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));
  const totalSpend = sorted.reduce((s, c) => s + (c.spend || 0), 0);
  const totalRev = sorted.reduce((s, c) => s + (c.conversionValue || 0), 0);

  const budgetRows = sorted.slice(0, 6).map(c => {
    const monthly = (c.dailyBudget || 0) * 30;
    const util = monthly > 0 ? pctStr(c.spend || 0, monthly, 0) : "—";
    return [
      c.name.length > 26 ? c.name.slice(0, 26) + "…" : c.name,
      c.dailyBudget ? cur0(c.dailyBudget) + "/d" : "—",
      cur0(c.spend || 0),
      util,
    ];
  });

  const avgWoW = weeks.length > 1
    ? ((weeks[weeks.length - 1].spend - weeks[0].spend) / (weeks[0].spend || 1)) * 100
    : 0;

  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Budget Utilization & Trend" badge="Spend Analysis" rightText={`${p.startDate} – ${p.endDate}`} Icon={Wallet as IconType} />
      <Body>
        <Card Icon={DollarSign as IconType} color={INDIGO} title="Budget vs Spend" rightLabel="Top 6 by spend">
          <MiniTable
            headers={["Campaign", "Daily Budget", "Spend", "Util."]}
            rows={budgetRows}
            maxRows={6}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: "auto", paddingTop: 12 }}>
            <StatTile label="Total Spend" value={cur0(totalSpend)} color={INDIGO_D} />
            <StatTile label="Revenue" value={cur0(totalRev)} color={GREEN_D} />
          </div>
        </Card>

        <Card Icon={Activity as IconType} color={GREEN} title="Weekly Spend & Revenue" rightLabel={weeks.length ? `${weeks.length} weeks` : undefined}>
          {weeks.length > 0 ? (
            <>
              <Legend items={[{ name: "Spend", color: INDIGO }, { name: "Revenue", color: GREEN }]} />
              <LineChartSVG
                width={560} height={180}
                labels={weeks.map(w => w.label)}
                series={[
                  { name: "Spend", color: INDIGO, points: weeks.map(w => w.spend) },
                  { name: "Revenue", color: GREEN, points: weeks.map(w => w.conversionValue) },
                ]}
              />
            </>
          ) : <EmptyNote text="No daily time-series available for this range." />}
        </Card>

        <Card Icon={BarChart3 as IconType} color={ORANGE} title="Week-on-Week Performance">
          {weeks.length > 0 ? (
            <div style={{ display: "flex", gap: 10 }}>
              {weeks.slice(0, 6).map((w, i) => {
                const prev = i > 0 ? weeks[i - 1].spend : null;
                const chg = prev && prev > 0 ? ((w.spend - prev) / prev) * 100 : null;
                return (
                  <div key={i} style={{ flex: 1, background: "#F8FAFC", border: `1px solid ${CARD_BORDER}`, borderRadius: 9, padding: "10px 6px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: FAINT, marginBottom: 5 }}>{w.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{fmtInt(w.conversions)}</div>
                    <div style={{ fontSize: 8.5, color: FAINT, margin: "2px 0 4px" }}>conv</div>
                    {chg !== null && (
                      <div style={{ fontSize: 10, fontWeight: 700, color: chg >= 0 ? GREEN_D : RED }}>
                        {chg >= 0 ? "+" : ""}{chg.toFixed(0)}%
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : <EmptyNote text="No weekly data." />}
          {weeks.length > 1 && (
            <Callout variant="insight" label="Trend" text={`Weekly spend ${avgWoW >= 0 ? "grew" : "declined"} ${Math.abs(avgWoW).toFixed(0)}% from first to last week of the period.`} />
          )}
        </Card>

        <Card Icon={TrendingUp as IconType} color={PINK} title="Weekly Revenue">
          {weeks.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {weeks.slice(0, 6).map((w, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#F8FAFC", borderRadius: 8, border: `1px solid ${CARD_BORDER}` }}>
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>{w.label}</span>
                    <span style={{ fontSize: 10, color: FAINT, marginLeft: 8 }}>{fmtInt(w.conversions)} conv · {fmtBig(w.impressions)} impr</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: GREEN_D }}>{cur0(w.conversionValue)}</span>
                </div>
              ))}
            </div>
          ) : <EmptyNote text="No revenue trend data." />}
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: FAINT, fontSize: 12, fontStyle: "italic", textAlign: "center", padding: 16 }}>
      {text}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Campaign Performance
// ─────────────────────────────────────────────────────────────────────────────

function CampaignPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const sorted = [...p.campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));
  const best = [...sorted].filter(c => (c.conversions || 0) > 0)
    .sort((a, b) => ((b.conversionValue || 0) / (b.spend || 1)) - ((a.conversionValue || 0) / (a.spend || 1)))[0] || sorted[0];
  const worst = [...sorted].filter(c => (c.spend || 0) > 0 && c !== best)
    .sort((a, b) => ((a.conversionValue || 0) / (a.spend || 1)) - ((b.conversionValue || 0) / (b.spend || 1)))[0];

  const perfCard = (c: CampaignData, kind: "best" | "worst") => {
    const good = kind === "best";
    const accent = good ? GREEN : RED;
    const bg = good ? "#ECFDF5" : "#FEF2F2";
    const roasV = (c.spend || 0) > 0 && (c.conversionValue || 0) > 0 ? ((c.conversionValue || 0) / (c.spend || 1)) : 0;
    const metrics: [string, string][] = [
      ["Spend", cur0(c.spend || 0)],
      ["Conversions", fmtInt(c.conversions || 0)],
      ["ROAS", roasV > 0 ? `${roasV.toFixed(2)}×` : "—"],
      ["CPA", (c.conversions || 0) > 0 ? cur0((c.spend || 0) / (c.conversions || 1)) : "—"],
      ["Clicks", fmtInt(c.clicks || 0)],
      ["CTR", pctStr(c.clicks || 0, c.impressions || 0)],
    ];
    return (
      <div style={{ background: bg, border: `1px solid ${accent}33`, borderRadius: 10, padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
          {good ? <Award size={15} color={accent} /> : <AlertTriangle size={15} color={accent} />}
          <span style={{ fontSize: 10, fontWeight: 800, color: accent, letterSpacing: "0.06em" }}>
            {good ? "BEST PERFORMER" : "UNDERPERFORMING"}
          </span>
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: TEXT, marginBottom: 10, lineHeight: 1.3 }}>
          {c.name.length > 38 ? c.name.slice(0, 38) + "…" : c.name}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {metrics.map(([k, v]) => (
            <div key={k} style={{ background: "#FFFFFF", borderRadius: 7, padding: "7px 9px" }}>
              <div style={{ fontSize: 8.5, color: FAINT, marginBottom: 3 }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const tableRows = sorted.slice(0, 9).map(c => {
    const sp = c.spend || 0, rev = c.conversionValue || 0;
    return [
      c.name.length > 30 ? c.name.slice(0, 30) + "…" : c.name,
      cur0(sp), fmtBig(c.impressions || 0), pctStr(c.clicks || 0, c.impressions || 0),
      fmtInt(c.conversions || 0), ratio(rev, sp), (c.conversions || 0) > 0 ? cur0(sp / (c.conversions || 1)) : "—",
    ];
  });

  // comparison chart: best vs worst conversions
  const compData = [best, worst].filter(Boolean).map((c, i) => ({
    label: i === 0 ? "Best" : "Underperf.", value: c!.conversions || 0, color: i === 0 ? GREEN : RED,
  }));

  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Campaign Performance" badge="Best vs Underperforming" rightText={`${p.startDate} – ${p.endDate}`} Icon={Megaphone as IconType} />
      <Body rows="auto 1fr">
        <Card Icon={Award as IconType} color={GREEN} title="Best vs Underperforming" style={{ gridColumn: "1 / 3" }}>
          <div style={{ display: "flex", gap: 14 }}>
            {best && perfCard(best, "best")}
            {worst && perfCard(worst, "worst")}
          </div>
        </Card>

        <Card Icon={BarChart3 as IconType} color={INDIGO} title="All Campaigns" rightLabel={`${sorted.length} total`}>
          <MiniTable
            headers={["Campaign", "Spend", "Impr.", "CTR", "Conv.", "ROAS", "CPA"]}
            rows={tableRows}
            maxRows={9}
          />
        </Card>

        <Card Icon={PieChart as IconType} color={ORANGE} title="Conversions: Best vs Underperforming">
          {compData.length > 0 ? (
            <VBarChart data={compData} height={190} fmt={(v) => fmtInt(v)} />
          ) : <EmptyNote text="Not enough campaigns to compare." />}
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Funnel & Objective
// ─────────────────────────────────────────────────────────────────────────────

function FunnelPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const impr = p.campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const clicks = p.campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const conv = p.campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  const spend = p.campaigns.reduce((s, c) => s + (c.spend || 0), 0);

  const objMap = new Map<string, { spend: number; conv: number; rev: number; camps: number }>();
  p.campaigns.forEach(c => {
    const o = (c.objective || "Unknown").replace(/OUTCOME_/, "");
    const r = objMap.get(o) || { spend: 0, conv: 0, rev: 0, camps: 0 };
    r.spend += c.spend || 0; r.conv += c.conversions || 0; r.rev += c.conversionValue || 0; r.camps++;
    objMap.set(o, r);
  });
  const objRows = [...objMap.entries()].sort((a, b) => b[1].spend - a[1].spend).map(([o, r]) => [
    o, String(r.camps), cur0(r.spend), fmtInt(r.conv), ratio(r.rev, r.spend), r.conv > 0 ? cur0(r.spend / r.conv) : "—",
  ]);

  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Funnel & Objective Performance" badge="Conversion Efficiency" rightText={`${p.startDate} – ${p.endDate}`} Icon={Filter as IconType} />
      <Body rows="auto 1fr">
        <Card Icon={Filter as IconType} color={INDIGO} title="Ad Delivery Funnel" rightLabel="Impressions → Clicks → Conversions" style={{ gridColumn: "1 / 3" }}>
          <FunnelStrip stages={[
            { label: "Impressions", value: impr, color: INDIGO },
            { label: "Clicks", value: clicks, color: GREEN },
            { label: "Conversions", value: conv, color: PINK },
          ]} />
        </Card>

        <Card Icon={Activity as IconType} color={GREEN} title="Efficiency Metrics">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <StatTile label="CTR (Impr→Click)" value={pctStr(clicks, impr)} color={INDIGO_D} />
            <StatTile label="CVR (Click→Conv)" value={pctStr(conv, clicks)} color={GREEN_D} />
            <StatTile label="CPA" value={conv > 0 ? cur0(spend / conv) : "—"} color={ORANGE} />
            <StatTile label="End-to-End" value={pctStr(conv, impr, 3)} color={PINK} />
          </div>
          <Callout variant="insight" label="Note" text="This is the real ad-delivery funnel from Meta (impressions → link clicks → conversions). On-site stages (add-to-cart, checkout) are not exposed by the API." />
        </Card>

        <Card Icon={Target as IconType} color={ORANGE} title="Performance by Objective" rightLabel={`${objRows.length} objectives`}>
          <MiniTable
            headers={["Objective", "Camps", "Spend", "Conv.", "ROAS", "CPA"]}
            rows={objRows}
            maxRows={7}
          />
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Audience & Geography
// ─────────────────────────────────────────────────────────────────────────────

function AudiencePage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const ageSorted = [...p.ageRows].sort((a, b) => b.spend - a.spend).slice(0, 6);
  const ageDonut = ageSorted.map((r, i) => ({ label: r.label, value: r.spend, color: SERIES[i % SERIES.length] }));
  const ageTop = ageSorted[0];
  const ageTotal = ageSorted.reduce((s, r) => s + r.spend, 0);

  const genSorted = [...(p.genderRows as BreakdownRow[])].sort((a, b) => b.spend - a.spend).slice(0, 3);
  const genTotal = genSorted.reduce((s, r) => s + r.spend, 0);

  const geoRows = (p.regionRows.length > 0 ? p.regionRows : p.countryRows);
  const geoSorted = [...geoRows].sort((a, b) => b.spend - a.spend).slice(0, 6);

  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Audience Demographics & Geography" badge="Top Segments" rightText={`${p.startDate} – ${p.endDate}`} Icon={Users as IconType} />
      <Body>
        <Card Icon={Users as IconType} color={INDIGO} title="Age Distribution" rightLabel="By spend">
          {ageSorted.length > 0 ? (
            <>
              <HBarChart data={ageSorted.map((r, i) => ({ label: r.label, value: r.spend, color: SERIES[i % SERIES.length] }))} />
              {ageTop && (
                <Callout variant="insight" label="Key Insight" text={`The ${ageTop.label} bracket leads spend (${pctStr(ageTop.spend, ageTotal, 0)} of total), with ${fmtInt(ageTop.conversions)} conversions.`} />
              )}
            </>
          ) : <EmptyNote text="No age breakdown available." />}
        </Card>

        <Card Icon={PieChart as IconType} color={GREEN} title="Spend by Age" rightLabel="Share">
          {ageDonut.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <DonutSVG data={ageDonut} size={150} />
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {ageDonut.map((d, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color }} />
                    <span style={{ color: TEXT, fontWeight: 600, width: 48 }}>{d.label}</span>
                    <span style={{ color: MUTED }}>{pctStr(d.value, ageTotal, 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <EmptyNote text="No age data." />}
        </Card>

        <Card Icon={Users as IconType} color={PINK} title="Gender Split" rightLabel="By spend">
          {genSorted.length > 0 ? (
            <div style={{ display: "flex", gap: 12 }}>
              {genSorted.map((r, i) => (
                <div key={i} style={{ flex: 1, background: "#F8FAFC", border: `1px solid ${CARD_BORDER}`, borderRadius: 10, padding: "14px 10px", textAlign: "center", borderTop: `3px solid ${SERIES[i % SERIES.length]}` }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, textTransform: "capitalize", marginBottom: 6 }}>{r.label}</div>
                  <div style={{ fontSize: 26, fontWeight: 900, color: SERIES[i % SERIES.length] }}>{pctStr(r.spend, genTotal, 0)}</div>
                  <div style={{ fontSize: 10, color: FAINT, marginTop: 5 }}>{cur0(r.spend)} · {fmtInt(r.conversions)} conv</div>
                </div>
              ))}
            </div>
          ) : <EmptyNote text="No gender data." />}
        </Card>

        <Card Icon={MapPin as IconType} color={ORANGE} title={p.regionRows.length > 0 ? "Top Regions" : "Top Countries"} rightLabel="By spend">
          {geoSorted.length > 0 ? (
            <VBarChart
              data={geoSorted.map((r, i) => ({ label: r.label.length > 10 ? r.label.slice(0, 10) : r.label, value: r.spend, color: SERIES[i % SERIES.length] }))}
              height={180}
              fmt={(v) => cur0(v)}
            />
          ) : <EmptyNote text="No geographic data." />}
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Creative Performance
// ─────────────────────────────────────────────────────────────────────────────

function classifyCreative(row: AdInsightRow): "Video" | "Static" | "Carousel" {
  const t = (row.creativeType || "").toUpperCase();
  const n = row.name.toLowerCase();
  if (t === "CAROUSEL" || n.includes("carousel")) return "Carousel";
  if (t === "VIDEO" || t === "REEL" || n.includes("video") || n.includes("reel")) return "Video";
  return "Static";
}

function CreativePage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);

  const groups: Record<string, { spend: number; impr: number; clicks: number; conv: number; rev: number; n: number }> = {};
  p.adRows.forEach(a => {
    const k = classifyCreative(a);
    const g = groups[k] || { spend: 0, impr: 0, clicks: 0, conv: 0, rev: 0, n: 0 };
    g.spend += a.spend || 0; g.impr += a.impressions || 0; g.clicks += a.clicks || 0;
    g.conv += a.conversions || 0; g.rev += a.conversionValue || 0; g.n++;
    groups[k] = g;
  });

  const formatCard = (name: string, color: string, Icon: IconType) => {
    const g = groups[name];
    if (!g) return null;
    const metrics: [string, string][] = [
      ["Ads", String(g.n)],
      ["Spend", cur0(g.spend)],
      ["Conv.", fmtInt(g.conv)],
      ["CTR", pctStr(g.clicks, g.impr)],
      ["CAC", g.conv > 0 ? cur0(g.spend / g.conv) : "—"],
      ["ROAS", ratio(g.rev, g.spend)],
    ];
    return (
      <div style={{ flex: 1, border: `1px solid ${color}33`, borderRadius: 10, padding: "12px 14px", background: `${color}0D` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <IconBadge Icon={Icon} color={color} size={28} />
          <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{name} Creatives</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {metrics.map(([k, v]) => (
            <div key={k} style={{ background: "#FFFFFF", borderRadius: 7, padding: "7px 9px" }}>
              <div style={{ fontSize: 8.5, color: FAINT, marginBottom: 3 }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const topAds = [...p.adRows].sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 7).map(a => [
    a.name.length > 30 ? a.name.slice(0, 30) + "…" : a.name,
    classifyCreative(a),
    cur0(a.spend || 0),
    pctStr(a.clicks || 0, a.impressions || 0),
    fmtInt(a.conversions || 0),
    ratio(a.conversionValue || 0, a.spend || 0),
  ]);

  const effRows = (["Video", "Static", "Carousel"] as const)
    .filter(k => groups[k])
    .map(k => {
      const g = groups[k]!;
      return { name: k, roas: g.spend > 0 ? g.rev / g.spend : 0, color: k === "Video" ? INDIGO : k === "Static" ? ORANGE : PINK };
    });

  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Creative Performance" badge="Video vs Static" rightText={`${p.startDate} – ${p.endDate}`} Icon={Film as IconType} />
      <Body rows="auto 1fr">
        <Card Icon={Layers as IconType} color={INDIGO} title="Performance by Creative Format" style={{ gridColumn: "1 / 3" }}>
          <div style={{ display: "flex", gap: 14 }}>
            {formatCard("Video", INDIGO, Film as IconType)}
            {formatCard("Static", ORANGE, ImageIcon as IconType)}
            {formatCard("Carousel", PINK, Layers as IconType)}
          </div>
        </Card>

        <Card Icon={Award as IconType} color={GREEN} title="Top Creatives" rightLabel="By spend">
          {topAds.length > 0 ? (
            <MiniTable
              headers={["Creative", "Type", "Spend", "CTR", "Conv.", "ROAS"]}
              rows={topAds}
              maxRows={7}
            />
          ) : <EmptyNote text="No ad-level creative data for this range." />}
        </Card>

        <Card Icon={Activity as IconType} color={ORANGE} title="Creative Effectiveness" rightLabel="ROAS by format">
          {effRows.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {effRows.map((e, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#F8FAFC", border: `1px solid ${CARD_BORDER}`, borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: e.color }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{e.name} Creatives</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: e.roas >= 1 ? GREEN_D : RED }}>
                    {e.roas > 0 ? `${e.roas.toFixed(2)}× ROAS` : "—"}
                  </span>
                </div>
              ))}
            </div>
          ) : <EmptyNote text="No creative data." />}
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Platform Metrics (weekly)
// ─────────────────────────────────────────────────────────────────────────────

function PlatformPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const cur2 = (n: number) => formatMoney(n, p.currency, 2);
  const weeks = weeklyBuckets(p.dailyRows);
  const labels = weeks.map(w => w.label);

  const avgCpm = weeks.length ? weeks.reduce((s, w) => s + w.cpm, 0) / weeks.length : 0;
  const avgCtr = weeks.length ? weeks.reduce((s, w) => s + w.ctr, 0) / weeks.length : 0;
  const avgCpc = weeks.length ? weeks.reduce((s, w) => s + w.cpc, 0) / weeks.length : 0;

  const tableRows = weeks.slice(0, 6).map(w => [
    w.label, cur0(w.spend), cur0(w.cpm), `${w.ctr.toFixed(2)}%`, cur2(w.cpc), fmtBig(w.clicks), fmtInt(w.conversions),
  ]);

  const pubSorted = [...p.pubRows].sort((a, b) => b.spend - a.spend);
  const pubTotal = pubSorted.reduce((s, r) => s + r.spend, 0);

  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Platform Metrics — Weekly" badge="CPM / CTR / CPC" rightText={`${p.startDate} – ${p.endDate}`} Icon={BarChart3 as IconType} />
      <Body>
        <Card Icon={Activity as IconType} color={INDIGO} title="CPM Trend" rightLabel="Cost / 1,000 impr">
          {weeks.length > 0 ? (
            <>
              <LineChartSVG width={540} height={170} area labels={labels} series={[{ name: "CPM", color: INDIGO, points: weeks.map(w => w.cpm) }]} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                <StatTile label="Avg CPM" value={cur0(avgCpm)} color={INDIGO_D} />
                <StatTile label="Weeks" value={String(weeks.length)} />
              </div>
            </>
          ) : <EmptyNote text="No daily data for trend." />}
        </Card>

        <Card Icon={TrendingUp as IconType} color={GREEN} title="CTR & CPC Trends" rightLabel="Click performance">
          {weeks.length > 0 ? (
            <>
              <Legend items={[{ name: "CTR %", color: GREEN }, { name: "CPC", color: ORANGE }]} />
              <LineChartSVG width={540} height={170} labels={labels} series={[
                { name: "CTR", color: GREEN, points: weeks.map(w => w.ctr) },
                { name: "CPC", color: ORANGE, points: weeks.map(w => w.cpc) },
              ]} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                <StatTile label="Avg CTR" value={`${avgCtr.toFixed(2)}%`} color={GREEN_D} />
                <StatTile label="Avg CPC" value={cur2(avgCpc)} color={ORANGE} />
              </div>
            </>
          ) : <EmptyNote text="No daily data for trend." />}
        </Card>

        <Card Icon={BarChart3 as IconType} color={ORANGE} title="Weekly Performance Data">
          {tableRows.length > 0 ? (
            <MiniTable
              headers={["Week", "Spend", "CPM", "CTR", "CPC", "Clicks", "Conv."]}
              rows={tableRows}
              maxRows={6}
            />
          ) : <EmptyNote text="No weekly data." />}
        </Card>

        <Card Icon={Layers as IconType} color={PINK} title="Spend by Placement" rightLabel="Publisher platform">
          {pubSorted.length > 0 ? (
            <HBarChart
              data={pubSorted.slice(0, 5).map((r, i) => ({ label: cleanLabel(r.label).slice(0, 9), value: r.spend, color: SERIES[i % SERIES.length] }))}
              valueRight={(v, pct) => `${cur0(v)} · ${pct.toFixed(0)}%`}
            />
          ) : <EmptyNote text="No placement data." />}
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Executive Summary
// ─────────────────────────────────────────────────────────────────────────────

function ExecutivePage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const sorted = [...p.campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));
  const spend = sorted.reduce((s, c) => s + (c.spend || 0), 0);
  const conv = sorted.reduce((s, c) => s + (c.conversions || 0), 0);
  const rev = sorted.reduce((s, c) => s + (c.conversionValue || 0), 0);
  const roas = spend > 0 && rev > 0 ? rev / spend : 0;

  const wins = [...sorted].filter(c => (c.conversions || 0) > 0)
    .sort((a, b) => ((b.conversionValue || 0) / (b.spend || 1)) - ((a.conversionValue || 0) / (a.spend || 1))).slice(0, 3);
  const challenges = [...sorted].filter(c => (c.spend || 0) > 0)
    .sort((a, b) => ((a.conversionValue || 0) / (a.spend || 1)) - ((b.conversionValue || 0) / (b.spend || 1))).slice(0, 3);

  const col = (title: string, accent: string, Icon: IconType, items: { primary: string; secondary: string }[]) => (
    <div style={{ flex: 1, background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ background: `${accent}14`, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${accent}22` }}>
        <Icon size={15} color={accent} strokeWidth={2.5} />
        <span style={{ fontSize: 12, fontWeight: 800, color: accent, letterSpacing: "0.04em" }}>{title}</span>
      </div>
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 11 }}>
        {items.map((it, i) => (
          <div key={i}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT, marginBottom: 2, lineHeight: 1.3 }}>{it.primary}</div>
            <div style={{ fontSize: 10, color: MUTED }}>{it.secondary}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const fallbackActions = [
    { t: "Scale top performers", b: wins[0] ? `Increase budget 15–20% on "${wins[0].name.slice(0, 28)}".` : "Shift budget to highest-ROAS campaigns.", c: GREEN },
    { t: "Cut underperformers", b: "Pause ad sets with 7+ days of spend and ROAS below 1×.", c: RED },
    { t: "Validate attribution", b: roas > 0 ? `Blended ROAS is ${roas.toFixed(2)}×; check 7d/1d click ratio for inflation.` : "Review attribution windows across campaigns.", c: ORANGE },
    { t: "Strengthen tracking", b: "Verify Conversions API to reduce iOS signal loss.", c: INDIGO },
  ];
  // AI recommendations (when a narrative was generated) replace the generic ones.
  const aiRecs = p.narrative?.recommendations ?? [];
  const accent = [GREEN, INDIGO, ORANGE, RED, PINK, GREEN];
  const actions = aiRecs.length > 0
    ? aiRecs.slice(0, 6).map((r, i) => ({ t: "", b: r, c: accent[i % accent.length] }))
    : fallbackActions;

  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Executive Summary" badge="Wins · Challenges · Actions" rightText={`${p.startDate} – ${p.endDate}`} Icon={Award as IconType} />
      <Body rows="auto 1fr">
        <div style={{ gridColumn: "1 / 3", display: "flex", gap: 14 }}>
          {col("TOP WINS", GREEN, Award as IconType, wins.map(c => ({
            primary: c.name.length > 30 ? c.name.slice(0, 30) + "…" : c.name,
            secondary: `ROAS ${((c.conversionValue || 0) / (c.spend || 1)).toFixed(2)}× · ${fmtInt(c.conversions || 0)} conv`,
          })))}
          {col("KEY METRICS", INDIGO, BarChart3 as IconType, [
            { primary: cur0(spend), secondary: "Total spend" },
            { primary: roas > 0 ? `${roas.toFixed(2)}×` : "—", secondary: "Blended ROAS" },
            { primary: `${fmtInt(conv)} conversions`, secondary: `CPA ${conv > 0 ? cur0(spend / conv) : "—"}` },
          ])}
          {col("CHALLENGES", RED, AlertTriangle as IconType, challenges.map(c => ({
            primary: c.name.length > 30 ? c.name.slice(0, 30) + "…" : c.name,
            secondary: `ROAS ${((c.conversionValue || 0) / (c.spend || 1)).toFixed(2)}× · ${cur0(c.spend || 0)} spent`,
          })))}
        </div>

        <Card Icon={Zap as IconType} color={INDIGO} title="Immediate Actions" style={{ gridColumn: "1 / 3" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {actions.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#F8FAFC", border: `1px solid ${CARD_BORDER}`, borderRadius: 9, padding: "12px 14px", borderLeft: `3px solid ${a.c}` }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: a.c, color: "#FFFFFF", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
                <div>
                  {a.t ? <div style={{ fontSize: 12.5, fontWeight: 800, color: TEXT, marginBottom: 3 }}>{a.t}</div> : null}
                  <div style={{ fontSize: a.t ? 10.5 : 11.5, color: a.t ? MUTED : TEXT, lineHeight: 1.45 }}>{a.b}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — AI Analysis (only when a narrative was generated)
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_LABEL: Record<string, string> = {
  kpis: "Key Metrics", campaigns: "Campaigns", funnel: "Funnel", audience: "Audience",
  creative: "Creative", placement: "Placement", tracking: "Tracking & Data Quality", attribution: "Attribution",
};

function AiAnalysisPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const nar = p.narrative!;
  const insights = (nar.sectionInsights ?? []).slice(0, 6);
  const highlights = (nar.highlights ?? []).slice(0, 4);
  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="AI Analysis" badge={OBJECTIVE_TITLE[p.objective ?? "sales"].title} rightText={`${p.startDate} – ${p.endDate}`} Icon={Lightbulb as IconType} />
      <div style={{ position: "absolute", top: 64, left: 0, right: 0, bottom: 26, padding: 24, display: "flex", flexDirection: "column", gap: 13, overflow: "hidden" }}>
        {/* Executive summary */}
        <div style={{ background: "#EEF0FF", border: `1px solid ${INDIGO}33`, borderLeft: `4px solid ${INDIGO}`, borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: INDIGO_D, letterSpacing: "0.05em", marginBottom: 6 }}>EXECUTIVE SUMMARY</div>
          <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.5 }}>{nar.execSummary}</div>
        </div>
        {/* Highlights */}
        {highlights.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(highlights.length, 4)}, 1fr)`, gap: 12 }}>
            {highlights.map((h, i) => (
              <div key={i} style={{ background: "#F8FAFC", border: `1px solid ${CARD_BORDER}`, borderRadius: 9, padding: "11px 13px", borderTop: `3px solid ${SERIES[i % SERIES.length]}` }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT, lineHeight: 1.35 }}>{h}</div>
              </div>
            ))}
          </div>
        )}
        {/* Section insights */}
        {insights.length > 0 && (
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridAutoRows: "min-content", gap: 12, overflow: "hidden" }}>
            {insights.map((s, i) => (
              <div key={i} style={{ background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: INDIGO_D, marginBottom: 5 }}>{SECTION_LABEL[s.section] ?? s.section}</div>
                <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.45 }}>{s.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — Tracking & Data Quality (only when a tracking snapshot is present)
// ─────────────────────────────────────────────────────────────────────────────

function TrackingPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const tk = p.tracking!;
  const as = tk.accountStructure;
  const tiles: { label: string; value: string; color: string; sub?: string }[] = [
    { label: "Active Pixels", value: tk.activePixels ?? "—", color: INDIGO, sub: "Firing & healthy" },
    { label: "Server (CAPI) Share", value: tk.capiSharePct != null ? `${tk.capiSharePct}%` : "—", color: tk.capiSharePct != null && tk.capiSharePct >= 40 ? GREEN : ORANGE, sub: "Events server-side" },
    { label: "Event Match Quality", value: tk.emqScore != null ? String(tk.emqScore) : "—", color: tk.emqScore != null && tk.emqScore >= 60 ? GREEN : ORANGE, sub: "Signal match score" },
    { label: "Total Events", value: tk.totalEvents != null ? fmtBig(tk.totalEvents) : "—", color: TEXT, sub: "In selected range" },
    { label: "Avg Frequency", value: tk.avgFrequency != null ? `${tk.avgFrequency}×` : "—", color: tk.avgFrequency != null && tk.avgFrequency > 5 ? RED : TEXT, sub: "Impr / reach" },
    { label: "Campaigns", value: as ? String(as.campaigns) : "—", color: TEXT, sub: as && as.adSets > 0 ? `${as.adSets} ad sets / IOs` : "Account structure" },
  ];
  const funnel = (tk.funnel ?? []).filter(f => f.value > 0);
  const attr = tk.attribution ?? [];
  return (
    <div data-pdf-page={p.pageNum} style={page}>
      <SlideHeader num={p.pageNum - 1} title="Tracking, Data Quality & Attribution" badge="Audit · Tracking" rightText={`${p.startDate} – ${p.endDate}`} Icon={Activity as IconType} />
      <Body rows="auto 1fr">
        <div style={{ gridColumn: "1 / 3", display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
          {tiles.map((t, i) => <StatTile key={i} label={t.label} value={t.value} color={t.color} sub={t.sub} />)}
        </div>
        <Card Icon={Filter as IconType} color={INDIGO} title="Conversion Funnel">
          {funnel.length > 0
            ? <HBarChart data={funnel.map((f, i) => ({ label: f.stage, value: f.value, color: SERIES[i % SERIES.length] }))} valueRight={(v) => fmtBig(v)} />
            : <div style={{ fontSize: 12, color: MUTED, padding: "8px 2px" }}>No funnel event data available for this window.</div>}
          {p.narrative?.sectionInsights?.find(s => s.section === "tracking") && (
            <Callout variant="insight" label="Insight" text={p.narrative.sectionInsights.find(s => s.section === "tracking")!.text} />
          )}
        </Card>
        <Card Icon={Award as IconType} color={GREEN} title={attr.length ? "Floodlight Attribution Windows (DV360)" : "Attribution"}>
          {attr.length > 0
            ? <MiniTable headers={["Activity", "Click Lookback", "View Lookback"]} rows={attr.slice(0, 7).map(a => [a.name, `${a.clickLookbackDays}d`, `${a.viewLookbackDays}d`])} aligns={["l", "r", "r"]} />
            : <div style={{ fontSize: 12, color: MUTED, padding: "8px 2px", lineHeight: 1.5 }}>Conversions use each platform&apos;s default attribution window. DV360 Floodlight lookback windows appear here when a Floodlight/CM360 link is available.</div>}
          {p.narrative?.sectionInsights?.find(s => s.section === "attribution") && (
            <Callout variant="optimization" label="Note" text={p.narrative.sectionInsights.find(s => s.section === "attribution")!.text} />
          )}
        </Card>
      </Body>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────

// ─── BBD-style Overview page (mirrors page 1 of the reference deck) ────────
function BbdOverviewPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur = p.currency || "INR";
  const cs = p.campaigns || [];

  // Totals
  const totals = cs.reduce((a, c) => ({
    spend: a.spend + (c.spend || 0),
    impressions: a.impressions + (c.impressions || 0),
    reach: a.reach + (c.reach || 0),
    clicks: a.clicks + (c.clicks || 0),
    videoViews: a.videoViews + (c.videoViews || 0),
  }), { spend: 0, impressions: 0, reach: 0, clicks: 0, videoViews: 0 });
  const freq = totals.reach > 0 ? totals.impressions / totals.reach : 0;

  // Planned target row — read from the same localStorage key the Dashboard tab uses.
  // On server render (headless PDF) this is unavailable, so we fall back to `—`.
  let plannedTotals = { spend: 0, impressions: 0, reach: 0, freq: 0 } as { spend: number; impressions: number; reach: number; freq: number };
  try {
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem("dashboard-planned-overall");
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed) plannedTotals = {
        spend: Number(parsed.spend || 0),
        impressions: Number(parsed.impressions || 0),
        reach: Number(parsed.reach || 0),
        freq: Number(parsed.frequency || 0),
      };
    }
  } catch { /* ignore */ }

  const pacing = (delivered: number, planned: number): number | null =>
    planned > 0 ? Math.round((delivered / planned) * 100) : null;

  // Platform-Wise Performance: group campaigns by platform.
  const platforms: Record<string, { spend: number; impressions: number; reach: number; clicks: number; videoViews: number; }> = {};
  for (const c of cs) {
    const key = c.platform === "meta" ? "Meta" : c.platform === "dv360" ? "Google (DV360)" : (c.platform || "Other");
    if (!platforms[key]) platforms[key] = { spend: 0, impressions: 0, reach: 0, clicks: 0, videoViews: 0 };
    platforms[key].spend += c.spend || 0;
    platforms[key].impressions += c.impressions || 0;
    platforms[key].reach += c.reach || 0;
    platforms[key].clicks += c.clicks || 0;
    platforms[key].videoViews += c.videoViews || 0;
  }
  const platformRows = Object.entries(platforms).sort((a, b) => b[1].spend - a[1].spend);
  const maxPlatSpend = Math.max(1, ...platformRows.map(([, v]) => v.spend));
  const maxPlatImpr = Math.max(1, ...platformRows.map(([, v]) => v.impressions));
  const maxPlatReach = Math.max(1, ...platformRows.map(([, v]) => v.reach));

  // Objective-wise as "Audience Wise Performance" — group by campaign.objective (best available proxy for audience).
  const byObj: Record<string, { spend: number; impressions: number; reach: number; clicks: number; videoViews: number; count: number }> = {};
  for (const c of cs) {
    const key = (c.objective || "Unspecified");
    if (!byObj[key]) byObj[key] = { spend: 0, impressions: 0, reach: 0, clicks: 0, videoViews: 0, count: 0 };
    byObj[key].spend += c.spend || 0;
    byObj[key].impressions += c.impressions || 0;
    byObj[key].reach += c.reach || 0;
    byObj[key].clicks += c.clicks || 0;
    byObj[key].videoViews += c.videoViews || 0;
    byObj[key].count++;
  }
  const audRows = Object.entries(byObj).sort((a, b) => b[1].spend - a[1].spend).slice(0, 10);
  const maxAudSpend = Math.max(1, ...audRows.map(([, v]) => v.spend));
  const maxAudImpr = Math.max(1, ...audRows.map(([, v]) => v.impressions));
  const maxAudReach = Math.max(1, ...audRows.map(([, v]) => v.reach));

  return (
    <div style={page}>
      <div style={{ padding: "24px 32px 32px", height: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Title strip with two rows separated by pacing circles */}
        <div style={{ position: "relative" }}>
          <BbdKpiRow
            label="Overall Deliveries"
            values={[
              { label: "Net Spends", value: formatMoney(totals.spend, cur, 0) },
              { label: "Impression", value: fmtBig(totals.impressions) },
              { label: "Reach", value: fmtBig(totals.reach) },
              { label: "Freq", value: freq >= 1 ? freq.toFixed(2) : "—" },
            ]}
          />
          {/* Pacing circles */}
          <div style={{
            position: "absolute", left: 160, right: 0, top: "50%", height: 44,
            transform: "translateY(-50%)", display: "flex", gap: 8, alignItems: "center",
            pointerEvents: "none", zIndex: 3,
          }}>
            <div style={{ flex: 1 }} />
            {[
              pacing(totals.spend, plannedTotals.spend),
              pacing(totals.impressions, plannedTotals.impressions),
              pacing(totals.reach, plannedTotals.reach),
              pacing(freq, plannedTotals.freq),
            ].map((pc, i) => (
              <React.Fragment key={i}>
                <div style={{ marginLeft: -22, marginRight: -22 }}><BbdPacingCircle pct={pc} /></div>
                {i < 3 && <div style={{ flex: 1 }} />}
              </React.Fragment>
            ))}
            <div style={{ width: 8 }} />
          </div>
          <div style={{ height: 12 }} />
          <BbdKpiRow
            label="Overall Targets"
            active={false}
            values={[
              { label: "Net Spends", value: plannedTotals.spend > 0 ? formatMoney(plannedTotals.spend, cur, 0) : "—" },
              { label: "Impression", value: plannedTotals.impressions > 0 ? fmtBig(plannedTotals.impressions) : "—" },
              { label: "Reach", value: plannedTotals.reach > 0 ? fmtBig(plannedTotals.reach) : "—" },
              { label: "Freq", value: plannedTotals.freq > 0 ? plannedTotals.freq.toFixed(2) : "—" },
            ]}
          />
        </div>

        {/* Platform Wise Performance */}
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 6 }}>Platform Wise Performance</div>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#FFFFFF", border: `1px solid ${CARD_BORDER}` }}>
            <BbdTableHeader cols={["Platforms", "Net Spends", "Impressions", "Reach", "Frequency", "VTR %", "CTR %", "eCPM"]} />
            <tbody>
              {platformRows.map(([name, v]) => {
                const f = v.reach > 0 ? v.impressions / v.reach : 0;
                const vtr = v.impressions > 0 ? (v.videoViews / v.impressions) * 100 : 0;
                const ctr = v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0;
                const cpm = v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0;
                return (
                  <tr key={name} style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                    <td style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600 }}>{name}</td>
                    <InlineBarCell value={v.spend} max={maxPlatSpend} color={BBD_BAR_BLUE} formatted={formatMoney(v.spend, cur, 0)} />
                    <InlineBarCell value={v.impressions} max={maxPlatImpr} color={BBD_BAR_CYAN} formatted={fmtInt(v.impressions)} />
                    <InlineBarCell value={v.reach} max={maxPlatReach} color={BBD_BAR_PINK} formatted={fmtInt(v.reach)} />
                    <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{f > 0 ? f.toFixed(2) : "—"}</td>
                    <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{vtr > 0 ? `${vtr.toFixed(2)}%` : "—"}</td>
                    <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{ctr > 0 ? `${ctr.toFixed(2)}%` : "—"}</td>
                    <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{cpm > 0 ? formatMoney(cpm, cur, 0) : "—"}</td>
                  </tr>
                );
              })}
              <tr style={{ background: "#F7F9FC", fontWeight: 700 }}>
                <td style={{ padding: "6px 10px", fontSize: 11 }}>Grand total</td>
                <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{formatMoney(totals.spend, cur, 0)}</td>
                <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{fmtInt(totals.impressions)}</td>
                <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{fmtInt(totals.reach)}</td>
                <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{freq > 0 ? freq.toFixed(2) : "—"}</td>
                <td colSpan={2} />
                <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{totals.impressions > 0 ? formatMoney((totals.spend / totals.impressions) * 1000, cur, 0) : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Audience Wise Performance (uses campaign objective as the group key) */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 2 }}>Audience Wise Performance</div>
          <div style={{ fontSize: 9, color: FAINT, marginBottom: 6 }}>
            Frequency-distribution reach (1+/2+/4+…/10+) omitted — neither Meta nor DV360 exposes a reach-by-frequency-threshold report via the fetched APIs; showing it would require estimating, not real delivery data.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#FFFFFF", border: `1px solid ${CARD_BORDER}` }}>
            <BbdTableHeader cols={["Audience", "Net Spends", "Impressions", "Reach", "Frequency", "eCPM"]} />
            <tbody>
              {audRows.map(([name, v]) => {
                const f = v.reach > 0 ? v.impressions / v.reach : 0;
                const cpm = v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0;
                return (
                  <tr key={name} style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                    <td style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</td>
                    <InlineBarCell value={v.spend} max={maxAudSpend} color={BBD_BAR_BLUE} formatted={formatMoney(v.spend, cur, 0)} />
                    <InlineBarCell value={v.impressions} max={maxAudImpr} color={BBD_BAR_CYAN} formatted={fmtInt(v.impressions)} />
                    <InlineBarCell value={v.reach} max={maxAudReach} color={BBD_BAR_PINK} formatted={fmtInt(v.reach)} />
                    <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{f > 0 ? f.toFixed(2) : "—"}</td>
                    <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{cpm > 0 ? formatMoney(cpm, cur, 0) : "—"}</td>
                  </tr>
                );
              })}
              <tr style={{ background: "#F7F9FC", fontWeight: 700 }}>
                <td style={{ padding: "6px 10px", fontSize: 11 }}>Grand total</td>
                <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{formatMoney(totals.spend, cur, 0)}</td>
                <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{fmtInt(totals.impressions)}</td>
                <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{fmtInt(totals.reach)}</td>
                <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{freq > 0 ? freq.toFixed(2) : "—"}</td>
                <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{totals.impressions > 0 ? formatMoney((totals.spend / totals.impressions) * 1000, cur, 0) : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─── Reach Build Up + Day-Wise Reach/Impressions + Spend vs Impressions ────
// Mirrors the reference deck's page 2. Reach is Meta-only (honest — DV360's
// fetched daily breakdown carries no reach field); Spend/Impressions are real
// merged Meta+DV360 daily totals from `dailyRows`.
function ReachTrendsPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const metaDaily = p.metaDailyRows ?? [];
  const dateOf = (r: { label: string; breakdownValues?: Record<string, string> }) => r.breakdownValues?.date || r.label;
  const sortedMeta = [...metaDaily].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  let cum = 0;
  const reachSeries = sortedMeta.map((r) => { cum += r.reach ?? 0; return cum; });
  const reachLabels = sortedMeta.map((r) => {
    const d = dateOf(r);
    const parsed = new Date(d + "T00:00:00");
    return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  });
  const hasReach = sortedMeta.some((r) => (r.reach ?? 0) > 0);

  const sortedDaily = [...p.dailyRows].sort((a, b) => a.label.localeCompare(b.label));
  const dailyLabels = sortedDaily.map((r) => {
    const parsed = new Date(r.label + "T00:00:00");
    return Number.isNaN(parsed.getTime()) ? r.label : parsed.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  });
  const dailyImpr = sortedDaily.map((r) => r.impressions || 0);
  const dailySpend = sortedDaily.map((r) => r.spend || 0);
  const dailyReach = sortedMeta.map((r) => r.reach ?? 0);

  return (
    <div style={page}>
      <div style={{ padding: "24px 32px 32px", height: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>Daily Trends</div>

        {hasReach ? (
          <div style={{ background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 10, padding: "14px 16px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, marginBottom: 2 }}>Reach Build Up</div>
            <div style={{ fontSize: 9.5, color: FAINT, marginBottom: 8 }}>Cumulative unique reach over time (Meta only — DV360 daily reach not exposed by the fetched report)</div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <LineChartSVG series={[{ name: "Reach", color: BBD_BLUE, points: reachSeries }]} labels={reachLabels} height={170} area />
            </div>
          </div>
        ) : (
          <div style={{ background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 10, padding: "14px 16px", fontSize: 11, color: FAINT }}>
            Reach Build Up — no Meta reach data in this window.
          </div>
        )}

        <div style={{ background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 10, padding: "14px 16px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, marginBottom: 2 }}>Day-Wise Unique Reach &amp; Impressions</div>
          <div style={{ fontSize: 9.5, color: FAINT, marginBottom: 8 }}>Daily reach (Meta only) vs total impressions (Meta + DV360)</div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <LineChartSVG
              series={[
                { name: "Daily Unique Reach (Meta)", color: BBD_BLUE, points: dailyReach.length ? dailyReach : [0] },
                { name: "Impressions", color: ORANGE, points: dailyImpr.length ? dailyImpr : [0] },
              ]}
              labels={dailyLabels.length ? dailyLabels : [""]}
              height={160}
            />
          </div>
          <Legend items={[{ name: "Daily Unique Reach", color: BBD_BLUE }, { name: "Impressions", color: ORANGE }]} />
        </div>

        <div style={{ background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 10, padding: "14px 16px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, marginBottom: 8 }}>Spend vs Impressions</div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <LineChartSVG
              series={[
                { name: "Spend", color: BBD_BLUE, points: dailySpend.length ? dailySpend : [0] },
                { name: "Impressions", color: ORANGE, points: dailyImpr.length ? dailyImpr : [0] },
              ]}
              labels={dailyLabels.length ? dailyLabels : [""]}
              height={150}
            />
          </div>
          <Legend items={[{ name: "Spend", color: BBD_BLUE }, { name: "Impressions", color: ORANGE }]} />
        </div>
      </div>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─── Overall Planned vs Spends (weekly) ────────────────────────────────────
// Real weekly actual spend from dailyRows. "Planned" is the user's own total
// planned spend (entered in the Dashboard tab's Overall Targets), split evenly
// across the weeks shown — an explicit pacing reference, not fabricated
// delivery data. Falls back to a note when no planned figure was entered.
function PlannedVsActualPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur0 = (n: number) => formatMoney(n, p.currency, 0);
  const weeks = weeklyBuckets(p.dailyRows);

  let plannedSpendTotal = 0;
  try {
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem("dashboard-planned-overall");
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed) plannedSpendTotal = Number(parsed.spend || 0);
    }
  } catch { /* ignore */ }

  const perWeekPlanned = weeks.length > 0 ? plannedSpendTotal / weeks.length : 0;
  const chartData = weeks.map((w) => ({ label: w.label, values: [perWeekPlanned, w.spend] as [number, number] }));

  return (
    <div style={page}>
      <div style={{ padding: "24px 32px 32px", height: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>Overall Planned vs Spends</div>
          {plannedSpendTotal > 0 ? (
            <div style={{ fontSize: 9.5, color: FAINT, marginTop: 2 }}>
              &quot;Planned&quot; is your total planned spend ({cur0(plannedSpendTotal)}) split evenly across {weeks.length} week{weeks.length === 1 ? "" : "s"} — an even pacing reference, not a per-week target you entered.
            </div>
          ) : (
            <div style={{ fontSize: 9.5, color: FAINT, marginTop: 2 }}>
              No planned spend entered yet on the Dashboard tab — showing actual spend only.
            </div>
          )}
        </div>
        <div style={{ background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 10, padding: "16px 18px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {chartData.length > 0 ? (
            <GroupedBarChart
              data={chartData}
              seriesNames={["Planned (even pace)", "Actual"]}
              colors={[BBD_BLUE, ORANGE]}
              height={260}
              fmt={(v) => cur0(v)}
            />
          ) : (
            <div style={{ fontSize: 11, color: FAINT }}>No daily delivery data in this window.</div>
          )}
        </div>
      </div>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─── Google (DV360) Detailed Performance — hero + Audience Wise + Format Wise ──
function GoogleDetailPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur = p.currency || "INR";
  const dv = p.campaigns.filter((c) => c.platform === "dv360");
  const totals = dv.reduce((a, c) => ({
    spend: a.spend + (c.spend || 0), impressions: a.impressions + (c.impressions || 0),
    reach: a.reach + (c.reach || 0), clicks: a.clicks + (c.clicks || 0),
  }), { spend: 0, impressions: 0, reach: 0, clicks: 0 });
  const freq = totals.reach > 0 ? totals.impressions / totals.reach : 0;

  const byObj: Record<string, { spend: number; impressions: number; reach: number; count: number }> = {};
  for (const c of dv) {
    const key = (c.objective || "Unspecified").replace(/^OUTCOME_/, "").replace(/_/g, " ");
    if (!byObj[key]) byObj[key] = { spend: 0, impressions: 0, reach: 0, count: 0 };
    byObj[key].spend += c.spend || 0; byObj[key].impressions += c.impressions || 0;
    byObj[key].reach += c.reach || 0; byObj[key].count++;
  }
  const audRows = Object.entries(byObj).sort((a, b) => b[1].spend - a[1].spend).slice(0, 8);
  const maxAudSpend = Math.max(1, ...audRows.map(([, v]) => v.spend));

  const dvAds = p.dv360AdRowsRaw ?? [];
  const byFmt: Record<string, { spend: number; impressions: number; clicks: number }> = {};
  for (const a of dvAds) {
    const key = a.creativeType || "Unspecified";
    if (!byFmt[key]) byFmt[key] = { spend: 0, impressions: 0, clicks: 0 };
    byFmt[key].spend += a.spend || 0; byFmt[key].impressions += a.impressions || 0; byFmt[key].clicks += a.clicks || 0;
  }
  const fmtRows = Object.entries(byFmt).sort((a, b) => b[1].spend - a[1].spend);

  return (
    <div style={page}>
      <div style={{ padding: "24px 32px 32px", height: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>Google (DV360) Detailed Performance</div>
        <div style={{ display: "flex", gap: 8 }}>
          <BbdKpiBox label="Net Spends" value={formatMoney(totals.spend, cur, 0)} />
          <BbdKpiBox label="Impressions" value={fmtBig(totals.impressions)} />
          <BbdKpiBox label="Reach" value={fmtBig(totals.reach)} />
          <BbdKpiBox label="Frequency" value={freq > 0 ? freq.toFixed(2) : "—"} />
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 6 }}>Audience Wise Performance</div>
          {audRows.length === 0 ? (
            <div style={{ fontSize: 11, color: FAINT }}>No DV360 campaigns in this window.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", background: "#FFFFFF", border: `1px solid ${CARD_BORDER}` }}>
              <BbdTableHeader cols={["Objective", "Net Spends", "Impressions", "Reach", "Campaigns"]} />
              <tbody>
                {audRows.map(([name, v]) => (
                  <tr key={name} style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                    <td style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600 }}>{name}</td>
                    <InlineBarCell value={v.spend} max={maxAudSpend} color={BBD_BAR_BLUE} formatted={formatMoney(v.spend, cur, 0)} />
                    <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{fmtInt(v.impressions)}</td>
                    <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{v.reach > 0 ? fmtInt(v.reach) : "—"}</td>
                    <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{v.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 2 }}>Format Wise Performance</div>
          <div style={{ fontSize: 9, color: FAINT, marginBottom: 6 }}>VTR/views omitted — DV360 creative rows fetched here carry no TrueView view metric.</div>
          {fmtRows.length === 0 ? (
            <div style={{ fontSize: 11, color: FAINT }}>No DV360 creative data available for this window.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", background: "#FFFFFF", border: `1px solid ${CARD_BORDER}` }}>
              <BbdTableHeader cols={["Format", "Net Spends", "Impressions", "Clicks", "CTR", "eCPM"]} />
              <tbody>
                {fmtRows.map(([name, v]) => {
                  const ctr = v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0;
                  const cpm = v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0;
                  return (
                    <tr key={name} style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                      <td style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600 }}>{name}</td>
                      <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{formatMoney(v.spend, cur, 0)}</td>
                      <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{fmtInt(v.impressions)}</td>
                      <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{fmtInt(v.clicks)}</td>
                      <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{ctr > 0 ? `${ctr.toFixed(2)}%` : "—"}</td>
                      <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{cpm > 0 ? formatMoney(cpm, cur, 0) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─── Google (DV360) Creative Performance — consolidated per-creative heatmap table ──
// The reference deck splits this into YT Films / YT VRC / Non-Skip / Display —
// that sub-classification isn't derivable from what DV360's creative report
// returns here (no line-item-type / skip-behavior field), so this is one real,
// honestly-labeled table rather than fabricated sub-buckets.
function GoogleCreativePage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur = p.currency || "INR";
  const rows = [...(p.dv360AdRowsRaw ?? [])].sort((a, b) => b.spend - a.spend).slice(0, 16);
  const maxSpend = Math.max(1, ...rows.map((r) => r.spend));
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalImpr = rows.reduce((s, r) => s + r.impressions, 0);
  const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);

  return (
    <div style={page}>
      <div style={{ padding: "24px 32px 32px", height: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>Google (DV360) Creative Performance</div>
        {rows.length === 0 ? (
          <div style={{ fontSize: 11, color: FAINT }}>No DV360 creative-level data available for this window.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#FFFFFF", border: `1px solid ${CARD_BORDER}` }}>
            <BbdTableHeader cols={["Creative", "Type", "Net Spends", "Impressions", "Clicks", "CTR", "eCPM"]} />
            <tbody>
              {rows.map((r) => {
                const ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
                const cpm = r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0;
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                    <td style={{ padding: "6px 10px", fontSize: 10.5, fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>{r.name}</td>
                    <td style={{ padding: "6px 10px", fontSize: 10.5, color: MUTED }}>{r.creativeType || "—"}</td>
                    <HeatmapCell value={r.spend} max={maxSpend} formatted={formatMoney(r.spend, cur, 0)} />
                    <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{fmtInt(r.impressions)}</td>
                    <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{fmtInt(r.clicks)}</td>
                    <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{ctr > 0 ? `${ctr.toFixed(2)}%` : "—"}</td>
                    <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{cpm > 0 ? formatMoney(cpm, cur, 0) : "—"}</td>
                  </tr>
                );
              })}
              <tr style={{ background: "#F7F9FC", fontWeight: 700 }}>
                <td style={{ padding: "6px 10px", fontSize: 10.5 }} colSpan={2}>Grand total</td>
                <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{formatMoney(totalSpend, cur, 0)}</td>
                <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{fmtInt(totalImpr)}</td>
                <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{fmtInt(totalClicks)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        )}
      </div>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─── Facebook (Meta) Detailed Performance — hero + Audience Wise + Format Wise ──
function FacebookDetailPage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur = p.currency || "INR";
  const meta = p.campaigns.filter((c) => c.platform === "meta");
  const totals = meta.reduce((a, c) => ({
    spend: a.spend + (c.spend || 0), impressions: a.impressions + (c.impressions || 0),
    reach: a.reach + (c.reach || 0), clicks: a.clicks + (c.clicks || 0),
  }), { spend: 0, impressions: 0, reach: 0, clicks: 0 });
  const freq = totals.reach > 0 ? totals.impressions / totals.reach : 0;
  const cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;

  const byObj: Record<string, { spend: number; impressions: number; reach: number; count: number }> = {};
  for (const c of meta) {
    const key = (c.objective || "Unspecified").replace(/^OUTCOME_/, "").replace(/_/g, " ");
    if (!byObj[key]) byObj[key] = { spend: 0, impressions: 0, reach: 0, count: 0 };
    byObj[key].spend += c.spend || 0; byObj[key].impressions += c.impressions || 0;
    byObj[key].reach += c.reach || 0; byObj[key].count++;
  }
  const audRows = Object.entries(byObj).sort((a, b) => b[1].spend - a[1].spend).slice(0, 8);
  const maxAudSpend = Math.max(1, ...audRows.map(([, v]) => v.spend));

  const metaAds = p.metaAdRowsRaw ?? [];
  const byFmt: Record<string, { spend: number; impressions: number; clicks: number; videoViews: number }> = {};
  for (const a of metaAds) {
    const key = classifyCreative(a);
    if (!byFmt[key]) byFmt[key] = { spend: 0, impressions: 0, clicks: 0, videoViews: 0 };
    byFmt[key].spend += a.spend || 0; byFmt[key].impressions += a.impressions || 0;
    byFmt[key].clicks += a.clicks || 0; byFmt[key].videoViews += a.videoViews || 0;
  }
  const fmtRows = Object.entries(byFmt).sort((a, b) => b[1].spend - a[1].spend);

  return (
    <div style={page}>
      <div style={{ padding: "24px 32px 32px", height: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>Facebook (Meta) Detailed Performance</div>
        <div style={{ display: "flex", gap: 8 }}>
          <BbdKpiBox label="Net Spends" value={formatMoney(totals.spend, cur, 0)} />
          <BbdKpiBox label="Impressions" value={fmtBig(totals.impressions)} />
          <BbdKpiBox label="Reach" value={fmtBig(totals.reach)} />
          <BbdKpiBox label="Delivered CPM" value={cpm > 0 ? formatMoney(cpm, cur, 0) : "—"} />
          <BbdKpiBox label="Frequency" value={freq > 0 ? freq.toFixed(2) : "—"} />
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 6 }}>Audience Wise Performance</div>
          {audRows.length === 0 ? (
            <div style={{ fontSize: 11, color: FAINT }}>No Meta campaigns in this window.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", background: "#FFFFFF", border: `1px solid ${CARD_BORDER}` }}>
              <BbdTableHeader cols={["Objective", "Net Spends", "Impressions", "Reach", "Campaigns"]} />
              <tbody>
                {audRows.map(([name, v]) => (
                  <tr key={name} style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                    <td style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600 }}>{name}</td>
                    <InlineBarCell value={v.spend} max={maxAudSpend} color={BBD_BAR_BLUE} formatted={formatMoney(v.spend, cur, 0)} />
                    <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{fmtInt(v.impressions)}</td>
                    <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{fmtInt(v.reach)}</td>
                    <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{v.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 6 }}>Format Wise Performance</div>
          {fmtRows.length === 0 ? (
            <div style={{ fontSize: 11, color: FAINT }}>No Meta creative-level data available for this window.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", background: "#FFFFFF", border: `1px solid ${CARD_BORDER}` }}>
              <BbdTableHeader cols={["Format", "Net Spends", "Impressions", "Clicks", "CTR", "Views", "eCPM"]} />
              <tbody>
                {fmtRows.map(([name, v]) => {
                  const ctr = v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0;
                  const rcpm = v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0;
                  return (
                    <tr key={name} style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                      <td style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600 }}>{name}</td>
                      <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{formatMoney(v.spend, cur, 0)}</td>
                      <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{fmtInt(v.impressions)}</td>
                      <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{fmtInt(v.clicks)}</td>
                      <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{ctr > 0 ? `${ctr.toFixed(2)}%` : "—"}</td>
                      <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{v.videoViews > 0 ? fmtInt(v.videoViews) : "—"}</td>
                      <td style={{ padding: "6px 10px", fontSize: 11, textAlign: "right" }}>{rcpm > 0 ? formatMoney(rcpm, cur, 0) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

// ─── Facebook (Meta) Creative Performance — consolidated per-creative heatmap table ──
// The reference splits Creative Name (TVCs) vs Creative Name (IG Reels) by
// placement — this app's ad-insights fetch doesn't carry placement per ad, so
// (as with the DV360 creative page) this is one honestly-labeled table.
function FacebookCreativePage(p: PdfReportPagesProps & { pageNum: number; total: number }) {
  const cur = p.currency || "INR";
  const rows = [...(p.metaAdRowsRaw ?? [])].sort((a, b) => b.spend - a.spend).slice(0, 14);
  const maxSpend = Math.max(1, ...rows.map((r) => r.spend));
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalImpr = rows.reduce((s, r) => s + r.impressions, 0);
  const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
  const totalViews = rows.reduce((s, r) => s + (r.videoViews || 0), 0);

  return (
    <div style={page}>
      <div style={{ padding: "24px 32px 32px", height: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>Facebook (Meta) Creative Performance</div>
        {rows.length === 0 ? (
          <div style={{ fontSize: 11, color: FAINT }}>No Meta creative-level data available for this window.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#FFFFFF", border: `1px solid ${CARD_BORDER}` }}>
            <BbdTableHeader cols={["Creative", "Net Spends", "Impressions", "Clicks", "CTR", "Views", "VTR", "eCPM"]} />
            <tbody>
              {rows.map((r) => {
                const ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
                const vtr = r.impressions > 0 && r.videoViews > 0 ? (r.videoViews / r.impressions) * 100 : 0;
                const cpm = r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0;
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                    <td style={{ padding: "6px 10px", fontSize: 10.5, fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>{r.name}</td>
                    <HeatmapCell value={r.spend} max={maxSpend} formatted={formatMoney(r.spend, cur, 0)} />
                    <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{fmtInt(r.impressions)}</td>
                    <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{fmtInt(r.clicks)}</td>
                    <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{ctr > 0 ? `${ctr.toFixed(2)}%` : "—"}</td>
                    <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{r.videoViews > 0 ? fmtInt(r.videoViews) : "—"}</td>
                    <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{vtr > 0 ? `${vtr.toFixed(2)}%` : "—"}</td>
                    <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{cpm > 0 ? formatMoney(cpm, cur, 0) : "—"}</td>
                  </tr>
                );
              })}
              <tr style={{ background: "#F7F9FC", fontWeight: 700 }}>
                <td style={{ padding: "6px 10px", fontSize: 10.5 }}>Grand total</td>
                <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{formatMoney(totalSpend, cur, 0)}</td>
                <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{fmtInt(totalImpr)}</td>
                <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{fmtInt(totalClicks)}</td>
                <td />
                <td style={{ padding: "6px 10px", fontSize: 10.5, textAlign: "right" }}>{totalViews > 0 ? fmtInt(totalViews) : "—"}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        )}
      </div>
      <PageFooter dateRange={`${p.startDate} – ${p.endDate}`} pageNum={p.pageNum} total={p.total} />
    </div>
  );
}

export default function PdfReportPages(props: PdfReportPagesProps) {
  const length: ReportLength = props.length ?? "standard";
  const hasNarrative = !!props.narrative && !!props.narrative.execSummary;
  const hasTracking = !!props.tracking && (
    props.tracking.activePixels != null || props.tracking.capiSharePct != null ||
    props.tracking.emqScore != null || (props.tracking.funnel?.length ?? 0) > 0 ||
    (props.tracking.attribution?.length ?? 0) > 0 || props.tracking.accountStructure != null
  );

  const hasDaily = props.dailyRows.length > 0;
  const hasAudience = props.ageRows.length > 0 || props.genderRows.length > 0 || props.countryRows.length > 0 || props.regionRows.length > 0;
  const hasCreative = props.adRows.length > 0;
  const hasPlatform = hasDaily || props.pubRows.length > 0;

  // Section selection is authoritative for inclusion (undefined = all). Length
  // still nudges the "heavy" pages: at "concise" the budget-trend and
  // placement/weekly pages stay off unless the user explicitly kept them.
  const sel = props.sections ?? ["ai", "campaigns", "audience", "creative", "placement", "budget", "funnel", "tracking"];
  const has = (id: string) => sel.includes(id);
  const inc = {
    ai:       hasNarrative && has("ai"),
    budget:   hasDaily && has("budget") && length !== "concise",
    campaign: has("campaigns"),
    funnel:   has("funnel"),
    audience: hasAudience && has("audience"),
    creative: hasCreative && has("creative"),
    platform: hasPlatform && has("placement") && length !== "concise",
    tracking: hasTracking && has("tracking"),
  };

  // Dynamic page numbering
  let n = 2; // cover is 1
  const pages: React.ReactNode[] = [<CoverPage key="cover" {...props} />];

  // BBD-style Overview page — matches the reference deck's page 1 layout
  // (deliveries + targets with pacing circles, Platform Wise Performance,
  // Audience Wise Performance). Always included when campaigns are present.
  if (props.campaigns.length > 0) {
    pages.push(<BbdOverviewPage key="bbd-overview" {...props} pageNum={n} total={0} />);
    n++;
  }

  // BBD-style trend + per-platform detail/creative pages — real data only,
  // skipped at "concise" length (same convention as BudgetPage below).
  if (length !== "concise") {
    if (props.dailyRows.length > 0) {
      pages.push(<ReachTrendsPage key="reach-trends" {...props} pageNum={n} total={0} />); n++;
      pages.push(<PlannedVsActualPage key="planned-vs-actual" {...props} pageNum={n} total={0} />); n++;
    }
    const hasDvCampaigns = props.campaigns.some((c) => c.platform === "dv360");
    const hasMetaCampaigns = props.campaigns.some((c) => c.platform === "meta");
    if (hasDvCampaigns) {
      pages.push(<GoogleDetailPage key="google-detail" {...props} pageNum={n} total={0} />); n++;
      if ((props.dv360AdRowsRaw ?? []).length > 0) {
        pages.push(<GoogleCreativePage key="google-creative" {...props} pageNum={n} total={0} />); n++;
      }
    }
    if (hasMetaCampaigns) {
      pages.push(<FacebookDetailPage key="fb-detail" {...props} pageNum={n} total={0} />); n++;
      if ((props.metaAdRowsRaw ?? []).length > 0) {
        pages.push(<FacebookCreativePage key="fb-creative" {...props} pageNum={n} total={0} />); n++;
      }
    }
  }

  if (inc.ai)       { pages.push(<AiAnalysisPage key="ai" {...props} pageNum={n} total={0} />); n++; }
  if (inc.budget)   { pages.push(<BudgetPage key="budget" {...props} pageNum={n} total={0} />); n++; }
  if (inc.campaign) { pages.push(<CampaignPage key="camp" {...props} pageNum={n} total={0} />); n++; }
  if (inc.funnel)   { pages.push(<FunnelPage key="funnel" {...props} pageNum={n} total={0} />); n++; }
  if (inc.audience) { pages.push(<AudiencePage key="aud" {...props} pageNum={n} total={0} />); n++; }
  if (inc.creative) { pages.push(<CreativePage key="creative" {...props} pageNum={n} total={0} />); n++; }
  if (inc.platform) { pages.push(<PlatformPage key="platform" {...props} pageNum={n} total={0} />); n++; }
  if (inc.tracking) { pages.push(<TrackingPage key="tracking" {...props} pageNum={n} total={0} />); n++; }
  pages.push(<ExecutivePage key="exec" {...props} pageNum={n} total={0} />);
  const total = n;

  // Re-inject total into the page props by cloning
  const withTotal = pages.map((el) =>
    React.isValidElement(el) && (el.props as any).pageNum
      ? React.cloneElement(el as React.ReactElement<any>, { total })
      : el
  );

  return <div style={{ display: "flex", flexDirection: "column" }}>{withTotal}</div>;
}
