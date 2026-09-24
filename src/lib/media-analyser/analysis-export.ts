/**
 * Client-side export of the ENTIRE analysis — the full Intelligence Brief
 * (Overview, Social, Competitors, Reddit, Ad Intelligence) as one document.
 * Reuses the same markdown formatters the tabs render from, plus a self-contained
 * styled HTML report (printable to PDF) and the raw JSON. No server round-trip.
 */

import type { AnalysisResponse, SocialSnapshot, RedditSnapshot, EcomSnapshot, SocialPaidAd } from "./types";
import { formatOverview, formatMetaMarketing, formatRedditReviews, formatCompetitiveLandscape } from "./brief";
import { buildAdIntel } from "./paid-ad-intel";

function nonEmpty(md: string, fallback = ""): string {
  const t = (md ?? "").trim();
  return t || fallback;
}

/** Run a section formatter defensively — one failing section never breaks the export. */
function safe(fn: () => string, fallback = ""): string {
  try { return nonEmpty(fn(), fallback); } catch { return fallback; }
}

/** Ad Intelligence → markdown (leaderboard + per-brand + verdicts). */
function adIntelMarkdown(result: AnalysisResponse): string {
  const social = result.socialSnapshot as Record<string, unknown> | null | undefined;
  const youAds = (social?.paidAds ?? []) as SocialPaidAd[];
  const competitors = ((result.competitorSocial ?? []) as Array<Record<string, unknown>>).map((c, i) => ({
    brand: String(c.brand ?? `Competitor ${i + 1}`),
    ads: (c.ads ?? []) as SocialPaidAd[],
  }));
  const you = youAds.length ? { brand: "You", ads: youAds } : null;
  const intel = buildAdIntel(you, competitors);
  if (!intel.hasData || !intel.brands.length) return "";

  const lines: string[] = ["## Competitive Ad Intelligence", "",
    "_Ranked by ad activity — all figures from the Meta Ad Library, no spend or placement estimates._", "",
    "| Rank | Brand | Archetype | Active | New/wk | Median days | Refresh | Video/Static |",
    "|---|---|---|---|---|---|---|---|",
  ];
  const vidStatic = (m: typeof intel.brands[number]) => {
    const v = m.formats.video, t = v + m.formats.image + m.formats.carousel + m.formats.other;
    return t ? `${Math.round(v / t * 100)}% / ${100 - Math.round(v / t * 100)}%` : "—";
  };
  for (const m of intel.brands) {
    lines.push(`| ${String(m.rank).padStart(2, "0")} | ${m.isYou ? "You" : m.brand} | ${m.archetype} | ${m.activeAds} | ${m.newThisWeek} | ${m.medianDaysLive} | ${Math.round(m.refreshRate * 100)}% | ${vidStatic(m)} |`);
  }
  lines.push("", "### Per-brand read", "");
  for (const m of intel.brands) {
    const fmt = m.formatLifespans.map(f => `${f.key} ${f.count}·${f.medianDays}d`).join(", ") || "—";
    const cta = m.ctas.map(c => `${c.label} ${Math.round(c.pct * 100)}%·${c.medianDays}d`).join(", ") || "—";
    const dest = m.destinations.map(d => `${d.label} ${Math.round(d.pct * 100)}%`).join(", ") || "—";
    const langs = m.languages.map(l => `${l.label} ${l.count}`).join(", ") || "—";
    const mom = (m.coldStart || !m.momReliable) ? "baseline scan" : `${m.momDelta > 0 ? "+" : ""}${Math.round(m.momDelta * 100)}% MoM`;
    lines.push(
      `**${m.isYou ? "You" : m.brand}** — ${m.archetype} · ${m.totalAds} ads · ${vidStatic(m)} video/static`,
      `- ${m.read}`,
      `- Ad decay: ${mom} · λ ${m.decayLambda.toFixed(3)}/d (half-life ${m.adstockHalfLifeDays}d)`,
      `- Formats × lifespan: ${fmt}`,
      `- CTA mix (% · lifespan): ${cta}`,
      `- Leads to: ${dest}`,
      `- Refresh rate: ${Math.round(m.refreshRate * 100)}% (${m.refreshNote})`,
      `- Offer copy: ${Math.round(m.offerDiscountPct * 100)}% discount · ${Math.round(m.offerUrgencyPct * 100)}% urgency`,
      `- Influencer: ${m.influencerAds}/${m.totalAds} · Regional-language: ${m.regionalAds}/${m.totalAds} · Languages: ${langs}`,
      "",
    );
  }
  if (intel.verdicts.length) {
    lines.push("### The verdict", "");
    for (const v of intel.verdicts) {
      lines.push(`**${v.kind}${v.brand ? ` · ${v.brand}` : ""}** — ${v.headline}`,
        v.refs.length ? `_${v.refs.map(r => r.label).join(" · ")}_` : "", "");
    }
  }
  return lines.join("\n");
}

/** Product's own paid Meta ads → markdown (summary + narrative + ad list). */
function paidAdsMarkdown(result: AnalysisResponse): string {
  const social = result.socialSnapshot as Record<string, unknown> | null | undefined;
  const ads = (social?.paidAds ?? []) as SocialPaidAd[];
  if (!ads.length) return "";
  const summary = social?.paidAdsSummary as Record<string, unknown> | undefined;
  const analysis = String(social?.paidAdsAnalysis ?? "").trim();
  const lines: string[] = ["## Paid Media — your Meta ads", ""];
  if (summary) lines.push(`_${summary.active ?? 0} active · ${summary.inactive ?? 0} inactive_`, "");
  if (analysis) lines.push(analysis, "");
  lines.push("| Ad | Format | CTA | Days live | Status | Platforms | Link |", "|---|---|---|---|---|---|---|");
  for (const ad of ads.slice(0, 25)) {
    const o = ad as Record<string, unknown>;
    const fmt = String(o.format ?? ad.mediaType ?? "—");
    const days = ad.runningDays != null ? `${ad.runningDays}d` : "—";
    const status = ad.isActive === false ? "Inactive" : "Active";
    const plats = (ad.publisherPlatforms ?? []).join("/") || "—";
    const link = ad.adSnapshotUrl ? `[view](${ad.adSnapshotUrl})` : "—";
    const label = String(ad.title || ad.adName || ad.body || ad.adId || "Ad").replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 40);
    lines.push(`| ${label} | ${fmt} | ${ad.cta ?? "—"} | ${days} | ${status} | ${plats} | ${link} |`);
  }
  return lines.join("\n");
}

/** Competitor social (posts + ad activity) → markdown, per competitor. */
function competitorSocialMarkdown(result: AnalysisResponse): string {
  const comps = (result.competitorSocial ?? []) as Array<Record<string, unknown>>;
  if (!comps.length) return "";
  const lines: string[] = ["## Competitor Social", "",
    "_Per-competitor posts + ad activity. Ad-level metrics are ranked in Competitive Ad Intelligence above._", ""];
  for (const c of comps) {
    const brand = String(c.brand ?? "Competitor");
    const handle = c.handle ? ` @${String(c.handle)}` : "";
    const posts = (c.posts ?? []) as Record<string, unknown>[];
    const ads = (c.ads ?? []) as SocialPaidAd[];
    lines.push(`### ${brand}${handle}`, `_${posts.length} posts · ${ads.length} ads_`, "");
    for (const p of posts.slice(0, 5)) {
      const cap = String(p.caption ?? p.captionSnippet ?? p.hook ?? "").replace(/\s+/g, " ").slice(0, 120);
      const url = p.postUrl ?? p.permalink ?? p.linkUrl;
      lines.push(`- ${cap || "(no caption)"} — ${p.likes ?? 0} likes${url ? ` · [post](${String(url)})` : ""}`);
    }
    if (!posts.length) lines.push("- _No posts captured._");
    lines.push("");
  }
  return lines.join("\n");
}

/** Product/brand title for the export filename + header. */
export function analysisTitle(result: AnalysisResponse): string {
  const ecom = result.ecomSnapshot as Record<string, unknown> | null | undefined;
  const product = ((ecom?.products as Record<string, unknown>[] | undefined) ?? [])[0];
  const brand = String(product?.brand ?? product?.name ?? "").trim();
  const title = String(product?.title ?? product?.name ?? "").trim();
  return brand || title || "Product Intelligence Brief";
}

/** The entire analysis as one markdown document. */
export function buildAnalysisMarkdown(result: AnalysisResponse): string {
  const social = result.socialSnapshot as SocialSnapshot | null | undefined;
  const sections = [
    `# ${analysisTitle(result)} — Intelligence Brief`,
    "",
    safe(() => formatOverview(result)),
    safe(() => adIntelMarkdown(result)),
    safe(() => paidAdsMarkdown(result)),
    safe(() => formatMetaMarketing(social), "## Social\n\n_No brand social posts in this run._"),
    safe(() => competitorSocialMarkdown(result)),
    safe(() => formatCompetitiveLandscape(result.ecomSnapshot as EcomSnapshot | null | undefined), "## Competitive Landscape\n\n_Not available in this run._"),
    safe(() => formatRedditReviews(result.redditSnapshot as RedditSnapshot | null | undefined), "## Reddit\n\n_Reddit reviews were not included in this run._"),
  ];
  return sections.filter(Boolean).join("\n\n---\n\n") + "\n";
}

// ── Minimal markdown → HTML (headings, bold/italic/code/links, lists, tables, hr) ──
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s: string): string {
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(^|[^*_])[*_]([^*_]+)[*_]([^*_]|$)/g, "$1<em>$2</em>$3");
}
function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  while (i < lines.length) {
    const line = lines[i];
    // table
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      closeList();
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      const header = cells(line);
      out.push('<table><thead><tr>' + header.map(h => `<th>${inline(h)}</th>`).join("") + "</tr></thead><tbody>");
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        out.push("<tr>" + cells(lines[i]).map(c => `<td>${inline(c)}</td>`).join("") + "</tr>");
        i++;
      }
      out.push("</tbody></table>");
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*---\s*$/.test(line) || /^\s*\*\*\*\s*$/.test(line)) { closeList(); out.push("<hr/>"); i++; continue; }
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(li[1])}</li>`); i++; continue; }
    const bq = /^\s*>\s?(.*)$/.exec(line);
    if (bq) { closeList(); out.push(`<blockquote>${inline(bq[1])}</blockquote>`); i++; continue; }
    if (!line.trim()) { closeList(); i++; continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  closeList();
  return out.join("\n");
}

/** The entire analysis as a self-contained, printable HTML report (Outpost paper look). */
export function buildAnalysisHtml(result: AnalysisResponse): string {
  const title = analysisTitle(result);
  const body = markdownToHtml(buildAnalysisMarkdown(result));
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — Intelligence Brief</title>
<style>
  :root{ --bg:#ede7d8; --surface:#f7f3e8; --line:#d8d0bc; --fg:#1b2027; --dim:#6b6555; --mute:#8a8368; --amber:#a6621e; --teal:#2e7a72; }
  *{ box-sizing:border-box; }
  body{ margin:0; background:var(--bg); color:var(--fg); font-family:"IBM Plex Sans","Helvetica Neue",Arial,sans-serif; line-height:1.55; }
  .wrap{ max-width:900px; margin:0 auto; padding:48px 40px 80px; }
  h1{ font-family:"Space Grotesk",Georgia,serif; font-size:30px; letter-spacing:-0.01em; margin:0 0 6px; }
  h2{ font-family:"Space Grotesk",Georgia,serif; font-size:20px; margin:34px 0 12px; padding-top:14px; border-top:1px solid var(--line); color:var(--fg); }
  h3{ font-size:15px; text-transform:uppercase; letter-spacing:0.06em; color:var(--amber); margin:22px 0 8px; font-family:"IBM Plex Mono",monospace; }
  p{ margin:8px 0; color:var(--dim); }
  strong{ color:var(--fg); } a{ color:var(--amber); } em{ color:var(--dim); }
  code{ font-family:"IBM Plex Mono",monospace; background:var(--surface); border:1px solid var(--line); border-radius:3px; padding:1px 5px; font-size:0.85em; }
  ul{ margin:8px 0 8px 18px; color:var(--dim); } li{ margin:3px 0; }
  hr{ border:none; border-top:1px solid var(--line); margin:26px 0; }
  blockquote{ border-left:3px solid var(--amber); margin:10px 0; padding:2px 0 2px 14px; color:var(--mute); }
  table{ width:100%; border-collapse:collapse; margin:12px 0; font-size:13px; background:var(--surface); border:1px solid var(--line); }
  th,td{ text-align:left; padding:9px 12px; border-bottom:1px solid var(--line); }
  th{ font-family:"IBM Plex Mono",monospace; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:var(--mute); background:var(--bg); }
  .meta{ font-family:"IBM Plex Mono",monospace; font-size:12px; color:var(--mute); margin-bottom:24px; }
  @media print{ body{ background:#fff; } .wrap{ padding:0; } }
</style></head>
<body><div class="wrap">
<div class="meta">OUTPOST · Competitive Intelligence · exported ${new Date().toISOString().slice(0, 10)}</div>
${body}
</div></body></html>`;
}

/** Resolve the public link to an ad — Meta Ad Library or Google Transparency. */
function adSourceLink(ad: SocialPaidAd): string {
  if (ad.platform === "google") return ad.adSnapshotUrl || ad.linkUrl || "";
  if (ad.adSnapshotUrl && /ads\/library/i.test(ad.adSnapshotUrl)) return ad.adSnapshotUrl;
  if (ad.adId) return `https://www.facebook.com/ads/library/?id=${ad.adId}`;
  return ad.linkUrl || "";
}

const CSV_COLS = ["Brand", "Platform", "Advertiser", "Ad ID", "Format", "Status", "First shown", "Last shown", "Running days", "CTA", "Destination", "Ad link", "Headline", "Body"];

function adRow(brand: string, ad: SocialPaidAd): (string | number)[] {
  return [
    brand,
    ad.platform === "google" ? "Google" : "Meta",
    ad.pageName ?? "",
    ad.adId ?? "",
    String((ad as Record<string, unknown>).format ?? ad.mediaType ?? ""),
    ad.status ?? (ad.isActive ? "ACTIVE" : "INACTIVE"),
    ad.startTime ?? "",
    ad.stopTime ?? "",
    ad.runningDays ?? "",
    ad.cta ?? "",
    String((ad as Record<string, unknown>).destinationUrl ?? ad.linkUrl ?? ""),
    adSourceLink(ad),
    ad.title ?? "",
    (ad.body ?? "").replace(/\s+/g, " ").trim(),
  ];
}

/**
 * "Download data source" — a CSV (opens in Excel) of every ad across the analysis
 * (target + competitors, Meta + Google) with its public link and relevant fields,
 * so the numbers can be verified against the Ad Library / Transparency Center.
 */
export function buildAdDataSourceCsv(result: AnalysisResponse): string {
  const social = result.socialSnapshot as Record<string, unknown> | null | undefined;
  const brandName = String((result as Record<string, unknown>).brandName ?? "").trim() || "You";
  const rows: (string | number)[][] = [];

  for (const ad of (social?.paidAds ?? []) as SocialPaidAd[]) rows.push(adRow(brandName, ad));
  for (const ad of (social?.googleAds ?? []) as SocialPaidAd[]) rows.push(adRow(brandName, ad));
  for (const c of (result.competitorSocial ?? []) as Array<Record<string, unknown>>) {
    const b = String(c.brand ?? "Competitor");
    for (const ad of (c.ads ?? []) as SocialPaidAd[]) rows.push(adRow(b, ad));
    for (const ad of (c.googleAds ?? []) as SocialPaidAd[]) rows.push(adRow(b, ad));
  }

  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel opens UTF-8 (Hindi/vernacular copy) correctly.
  return "﻿" + [CSV_COLS, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
}

/** Trigger a client-side file download. */
export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(s: string): string {
  return (s || "analysis").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "analysis";
}
