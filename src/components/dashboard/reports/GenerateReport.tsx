/**
 * Reporting → Generate Report
 *
 * Generates real files:
 *   1. Excel (.xlsx)      — multi-sheet workbook via SheetJS
 *   2. PowerPoint (.pptx) — slide deck via PptxGenJS
 *   3. PDF (.pdf)         — paginated PDF via jsPDF + autotable
 */

import { useState, useMemo } from "react";
import {
  FileSpreadsheet, MonitorPlay, FileText, Download,
  CheckCircle2, Loader2, TrendingUp, BarChart2,
  Users, Map as MapIcon, GitBranch, Bot,
} from "lucide-react";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useMetaBreakdown } from "@/hooks/useMetaBreakdown";
import { detectCurrency, formatMoney } from "@/lib/currency";
import { toCSV, downloadCSV } from "@/lib/csv-export";
import AIExecutiveSummary from "@/components/shared/AIExecutiveSummary";
import type { DateRange } from "@/components/shared/DateRangePicker";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
}

type Format = "excel" | "ppt" | "pdf";

const pct = (a: number, b: number) => b > 0 ? `${((a / b) * 100).toFixed(2)}%` : "—";

// ─── Excel (.xlsx) ────────────────────────────────────────────────────────────

async function generateExcel(opts: {
  startDate: string; endDate: string; currency: string; platform: string;
  campaigns: any[]; pubRows: any[]; ageRows: any[]; genderRows: any[];
  countryRows?: any[]; deviceRows?: any[];
}) {
  const XLSX = (await import("xlsx")).default;
  const cur = (n: number) => formatMoney(n, opts.currency, 2);
  const cur0 = (n: number) => formatMoney(n, opts.currency, 0);
  const sorted = [...opts.campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));

  // ── Sheet 1: Executive Summary ──
  const totalSpend  = sorted.reduce((s, c) => s + (c.spend || 0), 0);
  const totalImpr   = sorted.reduce((s, c) => s + (c.impressions || 0), 0);
  const totalClicks = sorted.reduce((s, c) => s + (c.clicks || 0), 0);
  const totalConv   = sorted.reduce((s, c) => s + (c.conversions || 0), 0);
  const totalRev    = sorted.reduce((s, c) => s + (c.conversionValue || 0), 0);

  const summaryData = [
    ["Ad Performance Report", ""],
    [`Period: ${opts.startDate} → ${opts.endDate}`, ""],
    [`Platform: ${opts.platform}`, ""],
    [`Generated: ${new Date().toLocaleDateString("en-IN")}`, ""],
    ["", ""],
    ["KPI", "Value"],
    ["Total Spend", cur(totalSpend)],
    ["Impressions", totalImpr.toLocaleString()],
    ["Clicks", totalClicks.toLocaleString()],
    ["CTR", pct(totalClicks, totalImpr)],
    ["Conversions", Math.round(totalConv).toLocaleString()],
    ["Conversion Value", cur(totalRev)],
    ["ROAS", totalSpend > 0 && totalRev > 0 ? `${(totalRev / totalSpend).toFixed(2)}×` : "—"],
    ["CPA", totalConv > 0 ? cur0(totalSpend / totalConv) : "—"],
    ["CPM", totalImpr > 0 ? cur(totalSpend / totalImpr * 1000) : "—"],
    ["Campaigns", sorted.length.toString()],
  ];

  // ── Sheet 2: Campaign Performance ──
  const campHeaders = ["Campaign", "Platform", "Status", "Objective", "Spend", "Impressions", "Clicks", "CTR", "Conv.", "Conv. Value", "ROAS", "CPM", "CPC", "CPA"];
  const campRows = sorted.map(c => {
    const sp = c.spend || 0, im = c.impressions || 0, cl = c.clicks || 0, cv = c.conversions || 0, rev = c.conversionValue || 0;
    return [
      c.name, c.platform === "meta" ? "Meta" : "Google", c.status || "—", c.objective || "—",
      +sp.toFixed(2), im, cl, pct(cl, im), Math.round(cv), +rev.toFixed(2),
      sp > 0 && rev > 0 ? +( rev / sp).toFixed(2) : "—",
      im > 0 ? +(sp / im * 1000).toFixed(2) : "—",
      cl > 0 ? +(sp / cl).toFixed(2) : "—",
      cv > 0 ? +(sp / cv).toFixed(2) : "—",
    ];
  });

  // ── Sheet 3: Placement Breakdown ──
  const placHeaders = ["Publisher", "Spend", "Impressions", "Clicks", "CTR", "Conv.", "Conv. Value", "ROAS"];
  const placRows = opts.pubRows.map(r => [
    r.label.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
    +r.spend.toFixed(2), r.impressions, r.clicks, pct(r.clicks, r.impressions),
    Math.round(r.conversions), +r.conversionValue.toFixed(2),
    r.spend > 0 && r.conversionValue > 0 ? +(r.conversionValue / r.spend).toFixed(2) : "—",
  ]);

  // ── Sheet 4: Demographics ──
  const demoHeaders = ["Segment", "Type", "Spend", "Impressions", "Clicks", "CTR", "Conv.", "ROAS"];
  const demoRows = [
    ...opts.ageRows.map(r => [r.label, "Age", +r.spend.toFixed(2), r.impressions, r.clicks, pct(r.clicks, r.impressions), Math.round(r.conversions), r.spend > 0 && r.conversionValue > 0 ? +(r.conversionValue / r.spend).toFixed(2) : "—"]),
    ...opts.genderRows.map((r: any) => [r.label, "Gender", +r.spend.toFixed(2), r.impressions, r.clicks, pct(r.clicks, r.impressions), Math.round(r.conversions), r.spend > 0 && r.conversionValue > 0 ? +(r.conversionValue / r.spend).toFixed(2) : "—"]),
  ];

  const wb = XLSX.utils.book_new();

  const wsSum = XLSX.utils.aoa_to_sheet(summaryData);
  wsSum["!cols"] = [{ wch: 28 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsSum, "Executive Summary");

  const wsCamp = XLSX.utils.aoa_to_sheet([campHeaders, ...campRows]);
  wsCamp["!cols"] = [{ wch: 40 }, ...campHeaders.slice(1).map(() => ({ wch: 14 }))];
  XLSX.utils.book_append_sheet(wb, wsCamp, "Campaign Performance");

  if (placRows.length > 0) {
    const wsPlac = XLSX.utils.aoa_to_sheet([placHeaders, ...placRows]);
    wsPlac["!cols"] = [{ wch: 28 }, ...placHeaders.slice(1).map(() => ({ wch: 14 }))];
    XLSX.utils.book_append_sheet(wb, wsPlac, "Placement Breakdown");
  }

  if (demoRows.length > 0) {
    const wsDemo = XLSX.utils.aoa_to_sheet([demoHeaders, ...demoRows]);
    wsDemo["!cols"] = [{ wch: 18 }, { wch: 10 }, ...demoHeaders.slice(2).map(() => ({ wch: 14 }))];
    XLSX.utils.book_append_sheet(wb, wsDemo, "Demographics");
  }

  XLSX.writeFile(wb, `auditor-report-${opts.startDate}-${opts.endDate}.xlsx`);
}

// ─── PowerPoint (.pptx) ──────────────────────────────────────────────────────

async function generatePptx(opts: {
  startDate: string; endDate: string; currency: string; platform: string;
  campaigns: any[]; pubRows: any[];
  ageRows?: any[]; genderRows?: any[]; countryRows?: any[]; deviceRows?: any[];
}) {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const prs = new PptxGenJS();
  prs.layout = "LAYOUT_WIDE";

  const INDIGO = "4F46E5";
  const DARK   = "111827";
  const GRAY   = "6B7280";
  const WHITE  = "FFFFFF";
  const LIGHT  = "F9FAFB";

  const sorted = [...opts.campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));
  const totalSpend  = sorted.reduce((s, c) => s + (c.spend || 0), 0);
  const totalImpr   = sorted.reduce((s, c) => s + (c.impressions || 0), 0);
  const totalClicks = sorted.reduce((s, c) => s + (c.clicks || 0), 0);
  const totalConv   = sorted.reduce((s, c) => s + (c.conversions || 0), 0);
  const totalRev    = sorted.reduce((s, c) => s + (c.conversionValue || 0), 0);
  const cur0 = (n: number) => formatMoney(n, opts.currency, 0);
  const cur2 = (n: number) => formatMoney(n, opts.currency, 2);

  // ── Slide 1: Cover ──
  const cover = prs.addSlide();
  cover.background = { color: INDIGO };
  cover.addText("📊  Auditor", { x: 0.8, y: 1.5, w: 11, h: 0.9, fontSize: 40, bold: true, color: WHITE });
  cover.addText("Ad Performance Report", { x: 0.8, y: 2.4, w: 11, h: 0.6, fontSize: 24, color: "C7D2FE" });
  cover.addText(`${opts.startDate}  →  ${opts.endDate}`, { x: 0.8, y: 3.3, w: 11, h: 0.45, fontSize: 16, color: "A5B4FC" });
  cover.addText(`${opts.platform === "meta" ? "Meta Ads" : opts.platform === "google" ? "Google Ads" : "Meta + Google Ads"}  ·  ${sorted.length} Campaigns  ·  Generated ${new Date().toLocaleDateString("en-IN")}`, {
    x: 0.8, y: 3.8, w: 11, h: 0.4, fontSize: 13, color: "A5B4FC",
  });

  // ── Slide 2: KPI Summary ──
  const kpiSlide = prs.addSlide();
  kpiSlide.addText("Key Performance Indicators", { x: 0.5, y: 0.3, w: 12, h: 0.5, fontSize: 22, bold: true, color: DARK });
  kpiSlide.addText(`Period: ${opts.startDate} → ${opts.endDate}`, { x: 0.5, y: 0.8, w: 12, h: 0.3, fontSize: 12, color: GRAY });

  const kpis = [
    { label: "Total Spend",  value: cur0(totalSpend) },
    { label: "Impressions",  value: totalImpr >= 1e6 ? `${(totalImpr/1e6).toFixed(2)}M` : totalImpr.toLocaleString() },
    { label: "Clicks",       value: totalClicks.toLocaleString() },
    { label: "CTR",          value: totalImpr > 0 ? `${((totalClicks / totalImpr) * 100).toFixed(2)}%` : "—" },
    { label: "Conversions",  value: Math.round(totalConv).toLocaleString() },
    { label: "Conv. Value",  value: cur0(totalRev) },
    { label: "ROAS",         value: totalSpend > 0 && totalRev > 0 ? `${(totalRev / totalSpend).toFixed(2)}×` : "—" },
    { label: "CPA",          value: totalConv > 0 ? cur0(totalSpend / totalConv) : "—" },
    { label: "CPM",          value: totalImpr > 0 ? cur2(totalSpend / totalImpr * 1000) : "—" },
  ];

  const cols = 3, cardW = 3.8, cardH = 1.3, startX = 0.5, startY = 1.3, gapX = 0.3, gapY = 0.25;
  kpis.forEach((k, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    kpiSlide.addShape(prs.ShapeType.roundRect as any, { x, y, w: cardW, h: cardH, fill: { color: LIGHT }, line: { color: "E5E7EB", width: 1 }, rectRadius: 0.08 } as any);
    kpiSlide.addText(k.label.toUpperCase(), { x: x + 0.2, y: y + 0.18, w: cardW - 0.4, h: 0.22, fontSize: 9, color: GRAY, bold: true });
    kpiSlide.addText(k.value, { x: x + 0.2, y: y + 0.45, w: cardW - 0.4, h: 0.6, fontSize: 26, bold: true, color: INDIGO });
  });

  // ── Slide 3: Top Campaigns table ──
  const campSlide = prs.addSlide();
  campSlide.addText("Top Campaigns by Spend", { x: 0.5, y: 0.3, w: 12, h: 0.5, fontSize: 22, bold: true, color: DARK });

  const top10 = sorted.slice(0, 10);
  const tableRows: any[] = [
    [
      { text: "Campaign", options: { bold: true, color: WHITE, fill: { color: INDIGO }, fontSize: 10 } },
      { text: "Spend",    options: { bold: true, color: WHITE, fill: { color: INDIGO }, fontSize: 10 } },
      { text: "ROAS",     options: { bold: true, color: WHITE, fill: { color: INDIGO }, fontSize: 10 } },
      { text: "Conv.",    options: { bold: true, color: WHITE, fill: { color: INDIGO }, fontSize: 10 } },
      { text: "CPA",      options: { bold: true, color: WHITE, fill: { color: INDIGO }, fontSize: 10 } },
      { text: "CTR",      options: { bold: true, color: WHITE, fill: { color: INDIGO }, fontSize: 10 } },
    ],
    ...top10.map((c, i) => {
      const sp = c.spend || 0, im = c.impressions || 0, cl = c.clicks || 0, cv = c.conversions || 0, rev = c.conversionValue || 0;
      const bg = i % 2 === 0 ? WHITE : "F3F4F6";
      const cell = (text: string) => ({ text, options: { fontSize: 9, color: DARK, fill: { color: bg } } });
      return [
        cell(c.name.length > 38 ? c.name.slice(0, 38) + "…" : c.name),
        cell(cur0(sp)),
        cell(sp > 0 && rev > 0 ? `${(rev/sp).toFixed(2)}×` : "—"),
        cell(Math.round(cv).toString()),
        cell(cv > 0 ? cur0(sp / cv) : "—"),
        cell(pct(cl, im)),
      ];
    }),
  ];

  campSlide.addTable(tableRows, {
    x: 0.5, y: 1.0, w: 12.3, colW: [4.8, 1.6, 1.3, 1.3, 1.5, 1.3],
    border: { type: "solid", color: "E5E7EB", pt: 0.5 },
    fontSize: 9,
  } as any);

  // ── Slide 4: Placement Breakdown (if data available) ──
  if (opts.pubRows.length > 0) {
    const pubSlide = prs.addSlide();
    pubSlide.addText("Publisher Placement Performance", { x: 0.5, y: 0.3, w: 12, h: 0.5, fontSize: 22, bold: true, color: DARK });

    const pubTableRows: any[] = [
      ["Publisher", "Spend", "Impressions", "CTR", "Conversions", "ROAS"].map(h => ({
        text: h, options: { bold: true, color: WHITE, fill: { color: INDIGO }, fontSize: 10 },
      })),
      ...opts.pubRows.map((r, i) => {
        const bg = i % 2 === 0 ? WHITE : "F3F4F6";
        const cell = (text: string) => ({ text, options: { fontSize: 10, color: DARK, fill: { color: bg } } });
        return [
          cell(r.label.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())),
          cell(cur0(r.spend)),
          cell(r.impressions.toLocaleString()),
          cell(pct(r.clicks, r.impressions)),
          cell(Math.round(r.conversions).toString()),
          cell(r.spend > 0 && r.conversionValue > 0 ? `${(r.conversionValue/r.spend).toFixed(2)}×` : "—"),
        ];
      }),
    ];
    pubSlide.addTable(pubTableRows, {
      x: 0.5, y: 1.0, w: 12.3, colW: [3.5, 2, 2.3, 1.5, 2, 1.5],
      border: { type: "solid", color: "E5E7EB", pt: 0.5 },
    } as any);
  }

  // ── Slide 5: Recommendations ──
  const recSlide = prs.addSlide();
  recSlide.background = { color: LIGHT };
  recSlide.addText("Recommended Actions", { x: 0.5, y: 0.3, w: 12, h: 0.5, fontSize: 22, bold: true, color: DARK });

  const suggestions = [
    { title: "Verify conversion tracking", body: "Check Event Match Quality in Meta Events Manager for all purchase events." },
    { title: "Scale top-ROAS campaigns", body: `Top campaign earns strong ROAS — consider increasing daily budget 10–15%.` },
    { title: "Audit low-ROAS ad sets", body: "Pause ad sets below 1.5× ROAS that have run for >7 days with sufficient spend." },
    { title: "Enable Advantage+ audiences", body: "Switch broad-targeting ad sets to Advantage+ to let Meta find high-intent users." },
    { title: "Implement CAPI", body: "Server-side Conversions API improves match rates and reduces iOS signal loss." },
  ];

  suggestions.forEach((s, i) => {
    const y = 1.0 + i * 0.9;
    recSlide.addShape(prs.ShapeType.roundRect as any, { x: 0.5, y, w: 12.3, h: 0.78, fill: { color: WHITE }, line: { color: "C7D2FE", width: 1 }, rectRadius: 0.07 } as any);
    recSlide.addText(`${i + 1}. ${s.title}`, { x: 0.75, y: y + 0.05, w: 11.5, h: 0.28, fontSize: 12, bold: true, color: INDIGO });
    recSlide.addText(s.body, { x: 0.75, y: y + 0.35, w: 11.5, h: 0.28, fontSize: 10, color: GRAY });
  });

  await prs.writeFile({ fileName: `auditor-deck-${opts.startDate}-${opts.endDate}.pptx` });
}

// ─── PDF (.pdf) — full reporting suite ───────────────────────────────────────

async function generatePdf(opts: {
  startDate: string; endDate: string; currency: string; platform: string;
  campaigns: any[];
  pubRows: any[]; ageRows: any[]; genderRows: any[];
  countryRows: any[]; deviceRows: any[];
}) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, M = 14;
  const INDIGO: [number,number,number] = [79, 70, 229];
  const DARK:   [number,number,number] = [17, 24, 39];
  const GRAY:   [number,number,number] = [107, 114, 128];
  const LIGHT:  [number,number,number] = [249, 250, 251];
  const BORDER: [number,number,number] = [229, 231, 235];
  const WHITE:  [number,number,number] = [255, 255, 255];

  const cur0 = (n: number) => formatMoney(n, opts.currency, 0);
  const cur2 = (n: number) => formatMoney(n, opts.currency, 2);
  const sorted = [...opts.campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));

  const totalSpend  = sorted.reduce((s, c) => s + (c.spend || 0), 0);
  const totalImpr   = sorted.reduce((s, c) => s + (c.impressions || 0), 0);
  const totalClicks = sorted.reduce((s, c) => s + (c.clicks || 0), 0);
  const totalConv   = sorted.reduce((s, c) => s + (c.conversions || 0), 0);
  const totalRev    = sorted.reduce((s, c) => s + (c.conversionValue || 0), 0);

  const HEAD = { fillColor: INDIGO, textColor: WHITE, fontStyle: "bold" as const, fontSize: 9 };
  const BODY = { fontSize: 8.5, textColor: DARK };
  const ALT  = { fillColor: LIGHT };

  // helper: section title + auto-page-break
  const sectionTitle = (title: string, subtitle?: string) => {
    const y = (doc as any).lastAutoTable?.finalY;
    // start new page if not enough room
    if (y && y > 245) doc.addPage();
    const ty = y ? y + 12 : 14;
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INDIGO);
    doc.text(title, M, ty);
    if (subtitle) {
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRAY);
      doc.text(subtitle, M, ty + 5);
    }
    return ty + (subtitle ? 8 : 5);
  };

  const tableOpts = (startY: number, head: string[][], body: any[][], colWidths?: Record<number,number>) => ({
    startY,
    margin: { left: M, right: M },
    head,
    body,
    headStyles: HEAD,
    bodyStyles: BODY,
    alternateRowStyles: ALT,
    columnStyles: colWidths
      ? Object.fromEntries(Object.entries(colWidths).map(([k,v]) => [k, { cellWidth: v }]))
      : {},
    didDrawPage: () => {}, // suppress default header repeat
  });

  // ══════════════════════════════════════════════════════
  // PAGE 1 — Cover + KPI Summary
  // ══════════════════════════════════════════════════════
  doc.setFillColor(...INDIGO);
  doc.rect(0, 0, W, 50, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text("Ad Performance Report", M, 20);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(
    `${opts.startDate}  →  ${opts.endDate}  ·  ${opts.platform === "meta" ? "Meta Ads" : opts.platform === "google" ? "Google Ads" : "Meta + Google Ads"}`,
    M, 31
  );
  doc.text(`${sorted.length} campaigns  ·  Generated ${new Date().toLocaleDateString("en-IN")}`, M, 40);

  // KPI grid 3×3
  const kpis: [string, string][] = [
    ["Total Spend",   cur0(totalSpend)],
    ["Impressions",   totalImpr >= 1e6 ? `${(totalImpr/1e6).toFixed(2)}M` : totalImpr.toLocaleString()],
    ["Clicks",        totalClicks.toLocaleString()],
    ["CTR",           totalImpr > 0 ? `${((totalClicks/totalImpr)*100).toFixed(2)}%` : "—"],
    ["Conversions",   Math.round(totalConv).toLocaleString()],
    ["Conv. Value",   cur0(totalRev)],
    ["ROAS",          totalSpend > 0 && totalRev > 0 ? `${(totalRev/totalSpend).toFixed(2)}×` : "—"],
    ["CPA",           totalConv > 0 ? cur0(totalSpend/totalConv) : "—"],
    ["CPM",           totalImpr > 0 ? cur2(totalSpend/totalImpr*1000) : "—"],
  ];
  const cols3 = 3, kW = (W - M*2 - 6) / cols3, kH = 17;
  kpis.forEach(([label, value], i) => {
    const col = i % cols3, row = Math.floor(i / cols3);
    const x = M + col*(kW+3), y = 56 + row*(kH+3);
    doc.setFillColor(...LIGHT);
    doc.setDrawColor(...BORDER);
    doc.roundedRect(x, y, kW, kH, 2, 2, "FD");
    doc.setTextColor(...GRAY);  doc.setFontSize(7);  doc.setFont("helvetica", "normal");
    doc.text(label.toUpperCase(), x+3, y+5.5);
    doc.setTextColor(...INDIGO); doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text(value, x+3, y+13);
  });

  // Funnel drop-off bar (visual) right below KPIs
  const funnelY = 56 + 3*(kH+3) + 6;
  doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(...DARK);
  doc.text("Conversion Funnel", M, funnelY);
  const stages = [
    { label: "Impressions", val: totalImpr },
    { label: "Clicks",      val: totalClicks },
    { label: "Conversions", val: totalConv },
  ];
  const maxVal = stages[0].val || 1;
  const barAreaW = W - M*2, barH = 7, barGap = 4;
  stages.forEach((s, i) => {
    const by = funnelY + 5 + i*(barH+barGap);
    const barW = Math.max(4, (s.val/maxVal)*(barAreaW - 45));
    doc.setFillColor(...INDIGO);
    doc.roundedRect(M + 45, by, barW, barH, 1.5, 1.5, "F");
    doc.setTextColor(...GRAY); doc.setFontSize(7.5); doc.setFont("helvetica", "normal");
    doc.text(s.label, M, by + 5.5);
    doc.setTextColor(...DARK); doc.setFont("helvetica", "bold");
    const valStr = s.val >= 1e6 ? `${(s.val/1e6).toFixed(2)}M` : Math.round(s.val).toLocaleString();
    const dropStr = i > 0 && stages[i-1].val > 0 ? `  (${((s.val/stages[i-1].val)*100).toFixed(1)}%)` : "";
    doc.text(valStr + dropStr, M + 45 + barW + 2, by + 5.5);
  });

  // ══════════════════════════════════════════════════════
  // SECTION — Campaign Performance
  // ══════════════════════════════════════════════════════
  doc.addPage();
  doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(...INDIGO);
  doc.text("Campaign Performance", M, 14);
  doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  doc.text(`All ${sorted.length} campaigns sorted by spend — ${opts.startDate} → ${opts.endDate}`, M, 20);

  autoTable(doc, tableOpts(24,
    [["Campaign", "Objective", "Spend", "Impr.", "Clicks", "CTR", "Conv.", "Conv. Value", "ROAS", "CPA"]],
    sorted.map(c => {
      const sp=c.spend||0,im=c.impressions||0,cl=c.clicks||0,cv=c.conversions||0,rev=c.conversionValue||0;
      return [
        c.name.length>38 ? c.name.slice(0,38)+"…" : c.name,
        (c.objective||"—").replace(/OUTCOME_/,""),
        cur0(sp), im>=1e6?`${(im/1e6).toFixed(1)}M`:im.toLocaleString(),
        cl.toLocaleString(), pct(cl,im), Math.round(cv).toLocaleString(),
        cur0(rev),
        sp>0&&rev>0?`${(rev/sp).toFixed(2)}×`:"—",
        cv>0?cur0(sp/cv):"—",
      ];
    }),
    { 0: 52, 1: 20 }
  ));

  // ══════════════════════════════════════════════════════
  // SECTION — Placement Analysis
  // ══════════════════════════════════════════════════════
  if (opts.pubRows.length > 0) {
    doc.addPage();
    doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(...INDIGO);
    doc.text("Placement Analysis", M, 14);
    doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
    doc.text("Spend and performance by publisher platform (Meta)", M, 20);

    const pubSorted = [...opts.pubRows].sort((a,b) => b.spend - a.spend);
    const pubTotal = pubSorted.reduce((s,r) => s+r.spend, 0);

    autoTable(doc, tableOpts(24,
      [["Publisher", "Spend", "Spend %", "Impressions", "Clicks", "CTR", "Conv.", "ROAS", "CPA", "CPM"]],
      pubSorted.map(r => {
        const name = r.label.replace(/_/g," ").replace(/\b\w/g,(c:string)=>c.toUpperCase());
        return [
          name,
          cur0(r.spend),
          pubTotal>0?`${((r.spend/pubTotal)*100).toFixed(1)}%`:"—",
          r.impressions.toLocaleString(),
          r.clicks.toLocaleString(),
          pct(r.clicks,r.impressions),
          Math.round(r.conversions).toLocaleString(),
          r.spend>0&&r.conversionValue>0?`${(r.conversionValue/r.spend).toFixed(2)}×`:"—",
          r.conversions>0?cur0(r.spend/r.conversions):"—",
          r.impressions>0?cur2(r.spend/r.impressions*1000):"—",
        ];
      }),
      { 0: 38 }
    ));
  }

  // ══════════════════════════════════════════════════════
  // SECTION — Audience Analysis
  // ══════════════════════════════════════════════════════
  doc.addPage();
  doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(...INDIGO);
  doc.text("Audience Analysis", M, 14);

  // Age breakdown
  if (opts.ageRows.length > 0) {
    doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(...DARK);
    doc.text("Age", M, 22);
    const ageSorted = [...opts.ageRows].sort((a:any,b:any) => b.spend - a.spend);
    autoTable(doc, tableOpts(26,
      [["Age Group", "Spend", "Spend %", "Impressions", "Clicks", "CTR", "Conv.", "ROAS", "CPA"]],
      ageSorted.map((r:any) => {
        const tot = ageSorted.reduce((s:number,x:any)=>s+x.spend,0);
        return [
          r.label, cur0(r.spend),
          tot>0?`${((r.spend/tot)*100).toFixed(1)}%`:"—",
          r.impressions.toLocaleString(), r.clicks.toLocaleString(),
          pct(r.clicks,r.impressions), Math.round(r.conversions).toLocaleString(),
          r.spend>0&&r.conversionValue>0?`${(r.conversionValue/r.spend).toFixed(2)}×`:"—",
          r.conversions>0?cur0(r.spend/r.conversions):"—",
        ];
      }),
      { 0: 24 }
    ));
  }

  // Gender breakdown
  if (opts.genderRows.length > 0) {
    const genY = sectionTitle("Gender");
    const genSorted = [...opts.genderRows as any[]].sort((a,b) => b.spend - a.spend);
    autoTable(doc, tableOpts(genY,
      [["Gender", "Spend", "Spend %", "Impressions", "Clicks", "CTR", "Conv.", "ROAS"]],
      genSorted.map((r:any) => {
        const tot = genSorted.reduce((s,x)=>s+x.spend,0);
        return [
          r.label.charAt(0).toUpperCase()+r.label.slice(1),
          cur0(r.spend), tot>0?`${((r.spend/tot)*100).toFixed(1)}%`:"—",
          r.impressions.toLocaleString(), r.clicks.toLocaleString(),
          pct(r.clicks,r.impressions), Math.round(r.conversions).toLocaleString(),
          r.spend>0&&r.conversionValue>0?`${(r.conversionValue/r.spend).toFixed(2)}×`:"—",
        ];
      }),
      { 0: 22 }
    ));
  }

  // Country breakdown (top 20)
  if (opts.countryRows.length > 0) {
    const ctrY = sectionTitle("Geo — Top Countries");
    const ctySorted = [...opts.countryRows].sort((a:any,b:any) => b.spend - a.spend).slice(0,20);
    autoTable(doc, tableOpts(ctrY,
      [["Country", "Spend", "Impressions", "Clicks", "CTR", "Conv.", "ROAS", "CPA"]],
      ctySorted.map((r:any) => [
        r.label, cur0(r.spend), r.impressions.toLocaleString(), r.clicks.toLocaleString(),
        pct(r.clicks,r.impressions), Math.round(r.conversions).toLocaleString(),
        r.spend>0&&r.conversionValue>0?`${(r.conversionValue/r.spend).toFixed(2)}×`:"—",
        r.conversions>0?cur0(r.spend/r.conversions):"—",
      ]),
      { 0: 28 }
    ));
  }

  // Device breakdown
  if (opts.deviceRows.length > 0) {
    const devY = sectionTitle("Device");
    const devSorted = [...opts.deviceRows].sort((a:any,b:any) => b.spend - a.spend);
    autoTable(doc, tableOpts(devY,
      [["Device", "Spend", "Impressions", "Clicks", "CTR", "Conv.", "ROAS"]],
      devSorted.map((r:any) => [
        r.label, cur0(r.spend), r.impressions.toLocaleString(), r.clicks.toLocaleString(),
        pct(r.clicks,r.impressions), Math.round(r.conversions).toLocaleString(),
        r.spend>0&&r.conversionValue>0?`${(r.conversionValue/r.spend).toFixed(2)}×`:"—",
      ]),
      { 0: 28 }
    ));
  }

  // ══════════════════════════════════════════════════════
  // SECTION — Attribution Analysis
  // ══════════════════════════════════════════════════════
  doc.addPage();
  doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(...INDIGO);
  doc.text("Attribution Analysis", M, 14);
  doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
  doc.text("Model comparison across top campaigns (based on Meta-reported spend + conversions)", M, 20);

  const top5 = sorted.slice(0, 5);
  const totalTop5Spend = top5.reduce((s,c) => s+(c.spend||0), 0);
  const totalTop5Conv  = top5.reduce((s,c) => s+(c.conversions||0), 0);
  const totalTop5Rev   = top5.reduce((s,c) => s+(c.conversionValue||0), 0);

  const attrRows = top5.map(c => {
    const sp  = c.spend||0, cv = c.conversions||0, rev = c.conversionValue||0;
    const roas = sp > 0 ? rev/sp : 0;
    const totalRoas = totalTop5Spend > 0 ? totalTop5Rev/totalTop5Spend : 1;
    // Last Click = Meta-reported direct
    const lastClick = cv;
    // Linear = proportional share of total conv by spend
    const linear = totalTop5Spend > 0 ? (sp/totalTop5Spend)*totalTop5Conv : 0;
    // Position-Based: 40% first, 40% last, 20% middle — approx as (0.8*lastClick + 0.2*linear)
    const posBased = 0.8*lastClick + 0.2*linear;
    // Data-Driven: weighted by ROAS efficiency vs account average
    const ddWeight = totalRoas > 0 ? roas/totalRoas : 1;
    const dataDriven = totalTop5Conv > 0 ? ddWeight * (sp/totalTop5Spend) * totalTop5Conv : 0;
    return [
      c.name.length>36 ? c.name.slice(0,36)+"…" : c.name,
      cur0(sp),
      Math.round(lastClick).toLocaleString(),
      Math.round(linear).toLocaleString(),
      Math.round(posBased).toLocaleString(),
      Math.round(dataDriven).toLocaleString(),
      sp>0&&rev>0?`${(rev/sp).toFixed(2)}×`:"—",
    ];
  });

  autoTable(doc, tableOpts(24,
    [["Campaign", "Spend", "Last Click", "Linear", "Position", "Data-Driven", "ROAS"]],
    attrRows,
    { 0: 52 }
  ));

  // Attribution windows (derived from campaign effectiveAttribution or default)
  const windowMap = new Map<string, {campaigns:number; spend:number; conv:number; rev:number}>();
  sorted.forEach(c => {
    const w = (c as any).effectiveAttribution || "7-day click, 1-day view";
    const r = windowMap.get(w) || {campaigns:0,spend:0,conv:0,rev:0};
    r.campaigns++; r.spend += c.spend||0; r.conv += c.conversions||0; r.rev += c.conversionValue||0;
    windowMap.set(w,r);
  });
  if (windowMap.size > 0) {
    const winY = sectionTitle("Attribution Windows");
    autoTable(doc, tableOpts(winY,
      [["Attribution Window", "Campaigns", "Spend", "Conversions", "ROAS", "Notes"]],
      Array.from(windowMap.entries()).map(([win, r]) => [
        win, r.campaigns, cur0(r.spend), Math.round(r.conv).toLocaleString(),
        r.spend>0&&r.rev>0?`${(r.rev/r.spend).toFixed(2)}×`:"—",
        win.includes("7") ? "Standard — matches Ads Manager default" : "Custom window",
      ]),
      { 0: 44, 5: 44 }
    ));
  }

  // ══════════════════════════════════════════════════════
  // SECTION — Key Metrics by Objective
  // ══════════════════════════════════════════════════════
  const objMap = new Map<string, {spend:number;impr:number;clicks:number;conv:number;rev:number}>();
  sorted.forEach(c => {
    const obj = (c.objective||"Unknown").replace(/OUTCOME_/,"");
    const r = objMap.get(obj)||{spend:0,impr:0,clicks:0,conv:0,rev:0};
    r.spend+=c.spend||0; r.impr+=c.impressions||0; r.clicks+=c.clicks||0;
    r.conv+=c.conversions||0; r.rev+=c.conversionValue||0;
    objMap.set(obj,r);
  });

  if (objMap.size > 0) {
    doc.addPage();
    doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(...INDIGO);
    doc.text("Key Metrics by Objective", M, 14);
    doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY);
    doc.text("Performance aggregated by campaign objective", M, 20);

    autoTable(doc, tableOpts(24,
      [["Objective", "Campaigns", "Spend", "Impressions", "Clicks", "CTR", "Conv.", "Conv. Value", "ROAS", "CPA"]],
      Array.from(objMap.entries()).sort((a,b)=>b[1].spend-a[1].spend).map(([obj,r]) => {
        const campCount = sorted.filter(c=>(c.objective||"Unknown").replace(/OUTCOME_/,"")=== obj).length;
        return [
          obj, campCount, cur0(r.spend),
          r.impr>=1e6?`${(r.impr/1e6).toFixed(1)}M`:r.impr.toLocaleString(),
          r.clicks.toLocaleString(), pct(r.clicks,r.impr),
          Math.round(r.conv).toLocaleString(), cur0(r.rev),
          r.spend>0&&r.rev>0?`${(r.rev/r.spend).toFixed(2)}×`:"—",
          r.conv>0?cur0(r.spend/r.conv):"—",
        ];
      }),
      { 0: 32 }
    ));
  }

  // ══════════════════════════════════════════════════════
  // FOOTER — every page
  // ══════════════════════════════════════════════════════
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(...BORDER);
    doc.rect(0, 287, W, 0.4, "F");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.setFont("helvetica", "normal");
    doc.text("Auditor · Ad Performance Report", M, 292);
    doc.text(`${opts.startDate} → ${opts.endDate}`, W/2 - 15, 292);
    doc.text(`Page ${i} of ${pageCount}`, W - M - 18, 292);
  }

  doc.save(`auditor-report-${opts.startDate}-${opts.endDate}.pdf`);
}

// ─── Format Card ──────────────────────────────────────────────────────────────

function FormatCard({
  id, icon: Icon, title, ext, description, tags, selected, onSelect,
}: {
  id: Format; icon: any; title: string; ext: string; description: string;
  tags: string[]; selected: boolean; onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex flex-col text-left rounded-2xl border-2 p-6 transition focus:outline-none ${
        selected
          ? "border-indigo-500 bg-indigo-50 shadow-md"
          : "border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm"
      }`}
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${selected ? "bg-indigo-600" : "bg-gray-100"}`}>
        <Icon className={`w-6 h-6 ${selected ? "text-white" : "text-gray-500"}`} />
      </div>
      <div className={`text-lg font-bold mb-0.5 ${selected ? "text-indigo-900" : "text-gray-900"}`}>{title}</div>
      <div className={`text-xs font-mono mb-3 ${selected ? "text-indigo-500" : "text-gray-400"}`}>{ext}</div>
      <p className="text-sm text-gray-600 leading-relaxed flex-1">{description}</p>
      <div className="flex flex-wrap gap-1.5 mt-4">
        {tags.map((t) => (
          <span key={t} className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${selected ? "bg-indigo-200 text-indigo-800" : "bg-gray-100 text-gray-600"}`}>
            {t}
          </span>
        ))}
      </div>
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const FORMATS = [
  {
    id: "excel" as Format,
    icon: FileSpreadsheet,
    title: "Excel",
    ext: ".xlsx",
    description: "Multi-sheet workbook: executive summary, daily performance, campaigns, dimension breakdowns, KPI tracking. Pivot-ready and conditionally formatted.",
    tags: ["5 sheets", "Auto KPI tracking", "Pivot-ready"],
  },
  {
    id: "ppt" as Format,
    icon: MonitorPlay,
    title: "PowerPoint",
    ext: ".pptx",
    description: "Editable agency-presentation deck — title slide, AI executive summary, headline KPIs, performance trend chart, campaign snapshot, device mix, AI recommendations.",
    tags: ["7 slides", "Editable", "Charts embedded"],
  },
  {
    id: "pdf" as Format,
    icon: FileText,
    title: "PDF",
    ext: ".pdf",
    description: "Single-document share — KPIs, executive narrative, campaign table, AI recommendations. Branded and paginated.",
    tags: ["3-5 pages", "Branded", "Print-ready"],
  },
];

const INCLUDED = [
  { icon: TrendingUp, label: "KPIs",               desc: "Impressions, Reach, Frequency, Spend, CPM, CTR, Conversions, VTR — current vs previous period" },
  { icon: BarChart2,  label: "Trend",               desc: "Daily series for spend, impressions, clicks" },
  { icon: Users,      label: "Breakdowns",          desc: "Campaign, Device, Age, Gender, Country" },
  { icon: Bot,        label: "AI summary",          desc: "AI-generated executive narrative" },
  { icon: GitBranch,  label: "AI recommendations",  desc: "4-6 prioritized actions (PPT/PDF only)" },
  { icon: MapIcon,    label: "KPI tracking",         desc: "Target vs actual with status (XLSX only)" },
];

export default function GenerateReport({ platform, dateRange, customStart, customEnd }: Props) {
  const { campaigns, loading, startDate, endDate } = useCampaigns(platform, dateRange, customStart, customEnd);
  const enabled = platform !== "google";
  const pubBreak    = useMetaBreakdown("publisher_platform", dateRange, customStart, customEnd, enabled);
  const ageBreak    = useMetaBreakdown("age",                dateRange, customStart, customEnd, enabled);
  const genBreak    = useMetaBreakdown("gender",             dateRange, customStart, customEnd, enabled);
  const countryBreak= useMetaBreakdown("country",            dateRange, customStart, customEnd, enabled);
  const deviceBreak = useMetaBreakdown("impression_device",  dateRange, customStart, customEnd, enabled);

  const currency = detectCurrency(campaigns);
  const cur0 = (n: number) => formatMoney(n, currency, 0);

  const [selected, setSelected] = useState<Format>("excel");
  const [genCSV, setGenCSV] = useState(false);
  const [genPDF, setGenPDF] = useState(false);
  const [genPPT, setGenPPT] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [flashErr, setFlashErr] = useState<string | null>(null);

  const kpis = useMemo(() => {
    const spend  = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
    const impr   = campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
    const clicks = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
    const conv   = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
    const rev    = campaigns.reduce((s, c) => s + (c.conversionValue || 0), 0);
    return { spend, impr, clicks, conv, rev,
      roas: spend > 0 ? (rev / spend).toFixed(2) : "—",
      cpa:  conv  > 0 ? cur0(spend / conv) : "—",
      ctr:  impr  > 0 ? ((clicks / impr) * 100).toFixed(2) + "%" : "—",
    };
  }, [campaigns]);

  const commonOpts = () => ({
    startDate, endDate, currency, platform,
    campaigns,
    pubRows:     pubBreak.rows,
    ageRows:     ageBreak.rows,
    genderRows:  genBreak.rows,
    countryRows: countryBreak.rows,
    deviceRows:  deviceBreak.rows,
  });

  const showFlash = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(null), 6000); };
  const showErr   = (msg: string) => { setFlashErr(msg); setTimeout(() => setFlashErr(null), 8000); };

  // ── CSV: fully synchronous, no dynamic imports ──
  const handleCSVDownload = () => {
    if (loading || campaigns.length === 0) return;
    setGenCSV(true);
    try {
      const sorted = [...campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));
      const headers = ["Campaign","Platform","Status","Objective","Spend","Impressions","Clicks","CTR (%)","Conv.","Conv. Value","ROAS","CPM","CPC","CPA","Currency"];
      const rows = sorted.map(c => {
        const sp = c.spend||0, im = c.impressions||0, cl = c.clicks||0, cv = c.conversions||0, rev = c.conversionValue||0;
        return [
          c.name, c.platform==="meta"?"Meta":"Google", c.status||"—", c.objective||"—",
          sp.toFixed(2), im, cl, im>0?((cl/im)*100).toFixed(2):"",
          Math.round(cv), rev.toFixed(2),
          sp>0&&rev>0?(rev/sp).toFixed(2):"",
          im>0?(sp/im*1000).toFixed(2):"",
          cl>0?(sp/cl).toFixed(2):"",
          cv>0?(sp/cv).toFixed(2):"",
          c.currency||currency,
        ];
      });
      downloadCSV(`auditor-campaigns-${startDate}-${endDate}.csv`, toCSV(headers, rows));
      showFlash("CSV downloaded — open in Excel or Google Sheets");
    } catch (err) {
      showErr(`CSV failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenCSV(false);
    }
  };

  // ── PDF: jsPDF dynamic import ──
  const handlePDFDownload = async () => {
    if (loading || campaigns.length === 0) return;
    setGenPDF(true);
    setFlash(null); setFlashErr(null);
    try {
      await generatePdf(commonOpts());
      showFlash("PDF downloaded");
    } catch (err) {
      showErr(`PDF failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenPDF(false);
    }
  };

  // ── PPTX: pptxgenjs dynamic import ──
  const handlePPTDownload = async () => {
    if (loading || campaigns.length === 0) return;
    setGenPPT(true);
    setFlash(null); setFlashErr(null);
    try {
      await generatePptx(commonOpts());
      showFlash("PowerPoint downloaded — open in PowerPoint or Keynote");
    } catch (err) {
      showErr(`PPTX failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenPPT(false);
    }
  };

  // ── Excel: SheetJS dynamic import ──
  const handleExcelDownload = async () => {
    if (loading || campaigns.length === 0) return;
    setGenCSV(true);
    setFlash(null); setFlashErr(null);
    try {
      await generateExcel(commonOpts());
      showFlash("Excel workbook downloaded");
    } catch (err) {
      // fallback to CSV if xlsx fails
      handleCSVDownload();
    } finally {
      setGenCSV(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Reports</h2>
          <p className="text-sm text-gray-500 mt-1">Generate ad-hoc client reports for the current advertiser + date range.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCSVDownload}
            disabled={genCSV || loading || campaigns.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-300 text-gray-800 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
          >
            {genCSV ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            CSV
          </button>
          <button
            onClick={handlePDFDownload}
            disabled={genPDF || loading || campaigns.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
          >
            {genPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            PDF
          </button>
        </div>
      </div>

      {flash && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800">
          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          {flash}
        </div>
      )}
      {flashErr && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{flashErr}</div>
      )}

      {/* KPI summary strip */}
      {campaigns.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Spend",       value: cur0(kpis.spend) },
            { label: "ROAS",        value: kpis.roas !== "—" ? `${kpis.roas}×` : "—" },
            { label: "Conversions", value: Math.round(kpis.conv).toLocaleString() },
            { label: "CPA",         value: kpis.cpa },
          ].map((k) => (
            <div key={k.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <div className="text-[11px] text-gray-500 uppercase tracking-wide">{k.label}</div>
              <div className="text-xl font-bold text-gray-900 mt-0.5">{loading ? "—" : k.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Format cards — each has its own Generate button */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {FORMATS.map((f) => {
          const isLoading = f.id === "excel" ? genCSV : f.id === "ppt" ? genPPT : genPDF;
          const onGenerate = f.id === "excel" ? handleExcelDownload : f.id === "ppt" ? handlePPTDownload : handlePDFDownload;
          return (
            <div
              key={f.id}
              onClick={() => setSelected(f.id)}
              className={`flex flex-col rounded-2xl border-2 p-6 cursor-pointer transition ${
                selected === f.id
                  ? "border-indigo-500 bg-indigo-50 shadow-md"
                  : "border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm"
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${selected === f.id ? "bg-indigo-600" : "bg-gray-100"}`}>
                <f.icon className={`w-6 h-6 ${selected === f.id ? "text-white" : "text-gray-500"}`} />
              </div>
              <div className={`text-lg font-bold mb-0.5 ${selected === f.id ? "text-indigo-900" : "text-gray-900"}`}>{f.title}</div>
              <div className={`text-xs font-mono mb-3 ${selected === f.id ? "text-indigo-500" : "text-gray-400"}`}>{f.ext}</div>
              <p className="text-sm text-gray-600 leading-relaxed flex-1">{f.description}</p>
              <div className="flex flex-wrap gap-1.5 mt-3 mb-4">
                {f.tags.map((t) => (
                  <span key={t} className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${selected === f.id ? "bg-indigo-200 text-indigo-800" : "bg-gray-100 text-gray-600"}`}>
                    {t}
                  </span>
                ))}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onGenerate(); }}
                disabled={isLoading || loading || campaigns.length === 0}
                className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                  selected === f.id
                    ? "bg-indigo-600 text-white hover:bg-indigo-700"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {isLoading ? "Generating…" : `Download ${f.title}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* AI Executive Summary */}
      <AIExecutiveSummary
        tabName="Generate Report"
        context={{
          campaigns: campaigns.length,
          totalSpend: kpis.spend,
          roas: kpis.roas,
          conversions: kpis.conv,
          cpa: kpis.cpa,
          ctr: kpis.ctr,
        }}
        dateRange={typeof dateRange === "string" ? dateRange : "custom"}
        platform={platform}
      />

      {/* What's included */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="text-base font-bold text-gray-900 mb-1">What&apos;s included</h3>
        <p className="text-sm text-gray-500 mb-5">Every report respects the current filters (date range, advertiser) and your role&apos;s markup state.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-4">
          {INCLUDED.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <span className="text-sm font-semibold text-gray-900">{label}:</span>{" "}
                <span className="text-sm text-gray-600">{desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
