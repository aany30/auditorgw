/**
 * Minimal .pptx → plain-text extractor for the cohort-campaign feature.
 *
 * A .pptx is a ZIP of OOXML parts. The slide text we want lives in
 * `ppt/slides/slideN.xml` inside `<a:t>…</a:t>` runs. We don't need a full
 * PowerPoint parser — stripping tags off the slide XML (in slide order) yields
 * clean, LLM-ready text, which is all the cohort extractor needs.
 */

import JSZip from "jszip";

const MAX_CHARS = 40_000; // plenty for an audience deck; keeps the LLM prompt bounded.

/** Decode the handful of XML entities that survive tag-stripping. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&"); // last, so we don't double-decode
}

/** One slide's XML → readable text (tags stripped, whitespace collapsed). */
function slideXmlToText(xml: string): string {
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Numeric sort for `slide1.xml`, `slide2.xml`, … `slide10.xml`. */
function slideNumber(path: string): number {
  return Number(path.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
}

/**
 * Extract all slide text from a .pptx buffer, in slide order. Returns "" if the
 * archive has no slides (caller should treat that as an unreadable deck).
 */
export async function extractPptxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);

  const slidePaths = Object.keys(zip.files)
    .filter(p => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const chunks: string[] = [];
  for (const path of slidePaths) {
    const xml = await zip.files[path].async("string");
    const text = slideXmlToText(xml);
    if (text) chunks.push(`--- slide ${slideNumber(path)} ---\n${text}`);
  }

  return chunks.join("\n\n").slice(0, MAX_CHARS);
}
