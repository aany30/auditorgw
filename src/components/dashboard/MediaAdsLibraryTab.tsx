import { useState, useRef } from "react";
import { AnalysisForm } from "@/components/media-analyser/AnalysisForm";
import { ProgressStream } from "@/components/media-analyser/ProgressStream";
import { BriefTabs } from "@/components/media-analyser/BriefTabs";
import { AnalysisDownload } from "@/components/media-analyser/AnalysisDownload";
import { ModuleTester } from "@/components/media-analyser/ModuleTester";
import type { AnalysisResponse } from "@/lib/media-analyser/types";
import type { StreamUpdate } from "@/lib/media-analyser/pipeline";

export default function MediaAdsLibraryTab() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [phase, setPhase] = useState<string>("");
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = async (
    url: string,
    useLlm: boolean,
    socialSource: string,
    instagramHandle: string,
    adLibraryUrl: string,
    coverCompetitors: boolean,
    competitors: { brand: string; instagramHandle: string; metaAdLibraryUrl: string; adKeyword: string; googleAdsUrl: string }[] = [],
    competitorsOnly: boolean = false,
    brandName: string = "",
    googleAds: { include: boolean; mode: "fast" | "rich"; url: string } = { include: false, mode: "fast", url: "" },
    linkedIn: { include: boolean; url: string } = { include: false, url: "" },
  ) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setResult(null);
    setStatus("Starting analysis…");
    setPhase("queued");

    try {
      const res = await fetch("/api/media-analyser/analyze-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url, useLlm, socialSource, instagramHandle, adLibraryUrl,
          coverCompetitors, competitors, competitorsOnly, brandName,
          includeGoogleAds: googleAds.include, googleAdsMode: googleAds.mode,
          googleAdsUrl: googleAds.url, includeLinkedIn: linkedIn.include,
          linkedInUrl: linkedIn.url,
        }),
        signal: ctrl.signal,
      });

      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const update = JSON.parse(line.slice(6)) as StreamUpdate;
            setStatus(update.status);
            setPhase(update.phase);
            if (update.result) setResult({ ...update.result, competitorsOnly, brandName } as AnalysisResponse);
          } catch {}
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setStatus(`Error: ${String(err)}`);
        setPhase("error");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    if (abortRef.current) abortRef.current.abort();
    setLoading(false);
    setStatus("");
    setPhase("");
    setResult(null);
  };

  return (
    <div className="ma-wrapper space-y-6">
      {/* Hero */}
      <div className="space-y-1.5">
        <p className="eyebrow">Competitive Intelligence</p>
        <h2 className="font-display text-2xl font-semibold text-fg tracking-tight">
          Media Ads Library
        </h2>
        <p className="text-sm text-fg-dim max-w-2xl">
          Paste any product URL to get competitive benchmarks, social insights, Reddit sentiment, and AI-powered strategic recommendations.
        </p>
      </div>

      {/* Module testing (dev) */}
      <ModuleTester />

      {/* Form card */}
      <div className="card p-6">
        <AnalysisForm onSubmit={handleSubmit} loading={loading} />
        {loading && (
          <button
            onClick={handleReset}
            className="mt-3 w-full py-2 font-mono text-[11px] uppercase tracking-wide text-fg-mute hover:text-fg transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Progress */}
      {status && !result && (
        <ProgressStream status={status} phase={phase} />
      )}

      {/* Results */}
      {result && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-0">
            <h3 className="font-display text-base font-semibold text-fg">Intelligence Brief</h3>
            <div className="flex items-center gap-3">
              <AnalysisDownload result={result} />
              <button
                onClick={handleReset}
                className="font-mono text-[11px] uppercase tracking-wide text-fg-mute hover:text-accent transition-colors"
              >
                New analysis →
              </button>
            </div>
          </div>
          <BriefTabs result={result} />
        </div>
      )}
    </div>
  );
}
