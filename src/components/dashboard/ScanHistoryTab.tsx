import { useState, useEffect, useCallback } from "react";
import { History, ChevronRight, ArrowLeft } from "lucide-react";
import { BriefTabs } from "@/components/media-analyser/BriefTabs";
import { AnalysisDownload } from "@/components/media-analyser/AnalysisDownload";
import type { ScanRecord } from "@/lib/media-analyser/supabase";
import type { AnalysisResponse } from "@/lib/media-analyser/types";

export default function ScanHistoryTab() {
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedScan, setSelectedScan] = useState<ScanRecord | null>(null);

  const fetchScans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/media-analyser/scans?limit=50");
      if (!res.ok) throw new Error(`Failed to fetch scans (${res.status})`);
      const data = await res.json();
      setScans(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load scan history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScans();
  }, [fetchScans]);

  if (selectedScan) {
    return (
      <ScanDetail
        scan={selectedScan}
        onBack={() => setSelectedScan(null)}
      />
    );
  }

  return (
    <div className="ma-wrapper space-y-6">
      <div className="space-y-1">
        <p className="eyebrow">History</p>
        <h2 className="text-xl font-semibold text-gray-900 tracking-tight">Scan History</h2>
        <p className="text-sm text-gray-500">
          {loading
            ? "Loading..."
            : scans.length
            ? `${scans.length} recent analysis${scans.length === 1 ? "" : "es"}`
            : "Past product audits will appear here once Supabase is configured."}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 px-6">
        {loading ? (
          <div className="flex items-center justify-center py-14">
            <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <p className="text-sm font-medium text-red-600">{error}</p>
            <button
              onClick={fetchScans}
              className="mt-3 text-sm text-blue-600 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : !scans.length ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <span className="grid place-items-center w-11 h-11 rounded-full bg-blue-50 text-blue-600 mb-3">
              <History size={20} />
            </span>
            <p className="text-sm font-medium text-gray-900">No scans yet</p>
            <p className="text-xs text-gray-500 mt-1 max-w-xs">
              Analyzed products will appear here once Supabase is configured.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {scans.map((scan) => {
              const date = scan.created_at
                ? new Date(scan.created_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "—";
              const statusColor =
                scan.status === "analyzed"
                  ? "text-green-700 bg-green-50"
                  : scan.status === "pending"
                  ? "text-blue-700 bg-blue-50"
                  : "text-red-700 bg-red-50";

              const urlHost = (() => {
                try {
                  return scan.product_url
                    ? new URL(scan.product_url).hostname.replace(/^www\./, "")
                    : null;
                } catch {
                  return scan.product_url || null;
                }
              })();
              const title =
                scan.product_name ||
                scan.brand ||
                urlHost ||
                scan.asin ||
                scan.project_id ||
                "Untitled scan";
              const inputUrl =
                scan.product_url && scan.product_url !== title
                  ? scan.product_url
                  : undefined;

              return (
                <button
                  key={scan.id}
                  onClick={() => setSelectedScan(scan)}
                  className="w-full text-left py-4 flex items-start justify-between gap-4 group -mx-2 px-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0 flex-1 flex items-start gap-3">
                    {scan.thumbnail_url && (
                      <img
                        src={scan.thumbnail_url}
                        alt=""
                        className="w-10 h-10 rounded-md object-cover border border-gray-200 bg-gray-50 flex-shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate group-hover:text-blue-600 transition-colors">
                        {title}
                      </p>
                      {scan.brand &&
                        scan.product_name &&
                        scan.brand !== scan.product_name && (
                          <p className="text-xs text-gray-500 mt-0.5 truncate">
                            {scan.brand}
                          </p>
                        )}
                      {inputUrl && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">
                          {inputUrl}
                        </p>
                      )}
                      {scan.asin && (
                        <p className="text-xs text-gray-400 font-mono mt-0.5">
                          {scan.asin}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 flex flex-col items-end gap-1">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor}`}
                    >
                      {scan.status ?? "unknown"}
                    </span>
                    <span className="text-xs text-gray-400">{date}</span>
                    <span className="text-[11px] text-gray-400 inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      View <ChevronRight size={12} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ScanDetail({
  scan,
  onBack,
}: {
  scan: ScanRecord;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<ScanRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/media-analyser/scans?id=${scan.id}`);
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();
        setDetail(data);
      } catch {
        setDetail(scan);
      } finally {
        setLoading(false);
      }
    })();
  }, [scan]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const source = detail || scan;
  const brief = source.brief as unknown as AnalysisResponse & {
    brandName?: string;
  };

  if (!brief) {
    return (
      <div className="ma-wrapper space-y-4">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft size={15} /> Back to history
        </button>
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-sm font-medium text-gray-900">
            This analysis couldn&apos;t be loaded.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            It may have been removed, or history persistence (Supabase)
            isn&apos;t configured for this run.
          </p>
        </div>
      </div>
    );
  }

  const result = {
    ...brief,
    brandName:
      brief.brandName ||
      source.brand ||
      source.product_name ||
      undefined,
  } as AnalysisResponse;
  const title =
    source.product_name ||
    source.brand ||
    source.product_url ||
    source.asin ||
    "Past analysis";
  const when = source.created_at
    ? new Date(source.created_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <div className="ma-wrapper space-y-6">
      <div className="space-y-1.5">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft size={15} /> Back to history
        </button>
        <p className="eyebrow">History · Saved analysis</p>
        <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">
          {title}
        </h2>
        <p className="text-sm text-gray-500">
          {when && <span>Run on {when}</span>}
          {source.product_url && (
            <span className="text-gray-400"> · {source.product_url}</span>
          )}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-0">
          <h3 className="text-base font-semibold text-gray-900">
            Intelligence Brief
          </h3>
          <AnalysisDownload result={result} />
        </div>
        <BriefTabs result={result} />
      </div>
    </div>
  );
}
