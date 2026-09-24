
import ReactMarkdown from "react-markdown";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface Props {
  status: string;
  phase: string;
}

const PHASES = ["queued", "scraping", "social", "reddit", "analyzing", "done"];

const phaseLabels: Record<string, string> = {
  queued: "Queued",
  scraping: "Scraping product",
  social: "Fetching social",
  reddit: "Searching Reddit",
  analyzing: "Analyzing",
  done: "Complete",
  error: "Error",
};

export function ProgressStream({ status, phase }: Props) {
  const currentIndex = PHASES.indexOf(phase);
  const isDone = phase === "done";
  const isError = phase === "error";

  return (
    <div className="card overflow-hidden animate-rise">
      {/* Step bar */}
      <div className="flex border-b border-line">
        {PHASES.filter(p => p !== "queued").map((p, i) => {
          const stepIndex = PHASES.indexOf(p);
          const past = !isError && currentIndex > stepIndex;
          const active = !isError && currentIndex === stepIndex;
          return (
            <div
              key={p}
              className={`flex-1 py-2.5 text-center font-mono text-[11px] uppercase tracking-wide transition-colors border-b-2 ${
                past
                  ? "text-accent bg-accent-soft border-accent"
                  : active
                  ? "text-accent bg-surface border-accent"
                  : "text-fg-mute bg-surface border-transparent"
              }`}
            >
              <span className="hidden sm:inline">{phaseLabels[p]}</span>
              <span className="sm:hidden">{i + 1}</span>
            </div>
          );
        })}
      </div>

      {/* Status message */}
      <div className="p-5">
        <div className="flex items-center gap-2 mb-3">
          {!isDone && !isError && (
            <Loader2 size={15} className="text-accent animate-spin flex-shrink-0" />
          )}
          {isDone && (
            <CheckCircle2 size={15} className="text-accent-2 flex-shrink-0" />
          )}
          {isError && (
            <AlertCircle size={15} className="text-alert flex-shrink-0" />
          )}
          <span className="font-mono text-xs uppercase tracking-wide text-fg">
            {phaseLabels[phase] ?? phase}
          </span>
        </div>
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown>{status}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
