
import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { AnalysisResponse } from "@/lib/media-analyser/types";
import { buildAnalysisHtml, buildAnalysisMarkdown, downloadFile, analysisTitle, slugify } from "@/lib/media-analyser/analysis-export";

/** "Download ▾" menu — exports the entire analysis (report HTML, Markdown, or raw JSON). */
export function AnalysisDownload({ result }: { result: AnalysisResponse }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const base = slugify(analysisTitle(result)) + "-intelligence-brief";
  const items: { label: string; hint: string; run: () => void }[] = [
    { label: "Report (HTML)", hint: "Styled · print to PDF", run: () => downloadFile(`${base}.html`, buildAnalysisHtml(result), "text/html") },
    { label: "Report (Markdown)", hint: "Portable text", run: () => downloadFile(`${base}.md`, buildAnalysisMarkdown(result), "text/markdown") },
    { label: "Raw data (JSON)", hint: "Complete dataset", run: () => downloadFile(`${base}.json`, JSON.stringify(result, null, 2), "application/json") },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-fg-dim hover:text-accent border border-line hover:border-accent rounded-sm px-2.5 py-1.5 transition-colors"
      >
        <Download size={13} /> Download
      </button>
      {open && (
        <div className="absolute right-0 mt-1.5 z-30 w-52 rounded-sm border border-line bg-surface shadow-lg overflow-hidden animate-rise">
          {items.map(it => (
            <button
              key={it.label}
              onClick={() => { it.run(); setOpen(false); }}
              className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-2 transition-colors border-b border-line last:border-b-0"
            >
              <span className="text-sm text-fg">{it.label}</span>
              <span className="font-mono text-[9px] uppercase tracking-wide text-fg-mute">{it.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
