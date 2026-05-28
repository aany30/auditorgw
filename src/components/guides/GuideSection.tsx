import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

interface SubStep {
  /** Optional sub-heading (e.g., "Step 1.1 — Create a basic Meta app"). */
  heading?: string;
  /** Ordered click-by-click items. Each becomes a numbered list row. */
  steps: ReactNode[];
}

interface Props {
  /** Section number badge (e.g., "1"). */
  number: number;
  /** Short section title. */
  title: string;
  /** One-line summary shown in the collapsed header. */
  summary: string;
  /** Optional "you'll get" badge text (e.g., "Access Token"). */
  yieldsLabel?: string;
  /** Sub-step groups. */
  subSteps: SubStep[];
  /** Whether to start expanded (true for Section 1). */
  defaultOpen?: boolean;
}

export default function GuideSection({
  number,
  title,
  summary,
  yieldsLabel,
  subSteps,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full bg-gray-50 hover:bg-gray-100 p-4 flex items-start gap-4 transition text-left"
      >
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center font-bold text-white text-sm">
          {number}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-gray-900">{title}</h4>
            {yieldsLabel && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                {yieldsLabel}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 mt-0.5">{summary}</p>
        </div>
        {open ? (
          <ChevronUp className="w-5 h-5 text-gray-500 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-500 flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="bg-white px-5 py-4 space-y-5">
          {subSteps.map((group, i) => (
            <div key={i}>
              {group.heading && (
                <div className="text-sm font-semibold text-gray-900 mb-2">{group.heading}</div>
              )}
              <ol className="list-decimal list-outside ml-5 space-y-1.5 text-sm text-gray-700 leading-relaxed">
                {group.steps.map((step, j) => (
                  <li key={j}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Inline link with an external-link icon — used in the guide steps to point to
 * each platform's UI URL.
 */
export function GuideLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:text-blue-700 font-semibold underline decoration-blue-300 hover:decoration-blue-600 inline-flex items-center gap-0.5"
    >
      {children}
      <ExternalLink className="w-3 h-3 inline" />
    </a>
  );
}

/** Inline highlight for UI elements ("click the **Add** button"). */
export function GuideButton({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs font-semibold text-gray-800 mx-0.5">
      {children}
    </span>
  );
}

/** Inline code (for IDs, URLs, scopes). */
export function GuideCode({ children }: { children: ReactNode }) {
  return (
    <code className="bg-gray-100 text-gray-900 px-1.5 py-0.5 rounded text-xs font-mono">
      {children}
    </code>
  );
}
