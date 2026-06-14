/**
 * Minimal RFC-4180-compliant CSV serializer.
 * No deps. Handles commas, quotes, newlines in cell values via quoting + escaping.
 */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // RFC 4180: quote fields containing comma, quote, CR or LF; double internal quotes.
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCSV(headers: string[], rows: Array<Array<unknown>>): string {
  const out: string[] = [];
  out.push(headers.map(escapeCell).join(","));
  for (const row of rows) {
    out.push(row.map(escapeCell).join(","));
  }
  return out.join("\r\n");
}

/** Trigger a browser download for the given CSV string. */
export function downloadCSV(filename: string, csv: string): void {
  // Prepend BOM so Excel auto-detects UTF-8 (avoids garbled rupee / accented chars).
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
