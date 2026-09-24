
import Link from "next/link";
import { History, ChevronRight } from "lucide-react";
import type { ScanRecord } from "@/lib/media-analyser/supabase";

interface Props {
  scans: ScanRecord[];
}

export function ScanHistory({ scans }: Props) {
  if (!scans.length) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <span className="grid place-items-center w-11 h-11 rounded-full bg-brand-soft text-brand mb-3">
          <History size={20} />
        </span>
        <p className="text-sm font-medium text-fg">No scans yet</p>
        <p className="text-xs text-fg-mute mt-1 max-w-xs">
          Analyzed products will appear here once Supabase is configured.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-line">
      {scans.map(scan => {
        const date = scan.created_at
          ? new Date(scan.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
          : "—";
        const statusColor =
          scan.status === "analyzed"
            ? "text-accent-2 bg-accent-2-soft"
            : scan.status === "pending"
            ? "text-accent bg-accent-soft"
            : "text-alert bg-alert-soft";

        // Prefer the comparison label / brand identity; fall back to the input URL's host,
        // then asin, before the generic placeholder.
        const urlHost = (() => {
          try { return scan.product_url ? new URL(scan.product_url).hostname.replace(/^www\./, "") : null; }
          catch { return scan.product_url || null; }
        })();
        const title =
          scan.product_name ||
          scan.brand ||
          urlHost ||
          scan.asin ||
          scan.project_id ||
          "Untitled scan";
        // Show the input URL as a sub-line when it isn't already the title.
        const inputUrl = scan.product_url && scan.product_url !== title ? scan.product_url : undefined;

        return (
          <Link
            key={scan.id}
            href={`/scans/${scan.id}`}
            className="py-4 flex items-start justify-between gap-4 group -mx-2 px-2 rounded-lg hover:bg-surface-2 transition-colors"
          >
            <div className="min-w-0 flex-1 flex items-start gap-3">
              {scan.thumbnail_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={scan.thumbnail_url}
                  alt=""
                  className="w-10 h-10 rounded-md object-cover border border-line bg-surface flex-shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg truncate group-hover:text-accent transition-colors">{title}</p>
                {scan.brand && scan.product_name && scan.brand !== scan.product_name && (
                  <p className="text-xs text-fg-dim mt-0.5 truncate">{scan.brand}</p>
                )}
                {inputUrl && (
                  <p className="text-xs text-fg-mute mt-0.5 truncate">{inputUrl}</p>
                )}
                {scan.asin && (
                  <p className="text-xs text-fg-mute font-mono mt-0.5">{scan.asin}</p>
                )}
              </div>
            </div>
            <div className="flex-shrink-0 flex flex-col items-end gap-1">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor}`}>
                {scan.status ?? "unknown"}
              </span>
              <span className="text-xs text-fg-mute">{date}</span>
              <span className="text-[11px] text-fg-mute inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                View <ChevronRight size={12} />
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
