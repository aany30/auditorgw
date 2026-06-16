/**
 * POST /api/reporting/pdf
 *
 * Renders the report design (PdfReportPages) to a REAL vector PDF using
 * Puppeteer's page.pdf(). Output has crisp, selectable text — not screenshots.
 *
 * Body: the same props passed to <PdfReportPages /> on the client
 *   { campaigns, pubRows, ageRows, genderRows, countryRows, deviceRows, currency, startDate, endDate, platform }
 *
 * Returns: application/pdf binary stream.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PdfReportPages, { type PdfReportPagesProps } from "@/components/dashboard/reports/PdfReportPages";

export const config = {
  api: { bodyParser: { sizeLimit: "8mb" } },
  // Force Node.js runtime (Puppeteer cannot run on the edge runtime)
  runtime: "nodejs",
};

function buildHtml(props: PdfReportPagesProps): string {
  const body = renderToStaticMarkup(React.createElement(PdfReportPages, props));
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: 1280px 720px; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #EEF1F6; }
  /* The wrapper flex column has gap:0; each page (1280×720) sets page-break-after */
</style>
</head>
<body>${body}</body>
</html>`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const props = req.body as PdfReportPagesProps;
  if (!props || !Array.isArray(props.campaigns)) {
    return res.status(400).json({ error: "Missing or invalid report data" });
  }

  let browser: import("puppeteer").Browser | null = null;
  try {
    const puppeteer = (await import("puppeteer")).default;

    const html = buildHtml(props);

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });

    const pdf = await page.pdf({
      width: "1280px",
      height: "720px",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    const filename = `auditor-report-${props.startDate}-${props.endDate}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdf.length);
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    console.error("[/api/reporting/pdf] failed:", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "PDF generation failed" });
  } finally {
    if (browser) await browser.close();
  }
}
