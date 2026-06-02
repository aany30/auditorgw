/**
 * Inline "ⓘ" chip that surfaces the attribution window used to calculate
 * conversions / ROAS shown on the surrounding audit. Render it anywhere a
 * conversion-driven metric appears so the client knows the exact basis of
 * the number (and can reproduce it in Ads Manager by setting the same window).
 *
 * Two display modes:
 *   <AttributionInfo />            → small "ⓘ Attribution: 7-day click + 1-day view"
 *   <AttributionInfo compact />    → just the "ⓘ" icon; tooltip on hover
 *
 * The label + description come from META_ATTRIBUTION_WINDOW (single source
 * of truth — same string the API client sends to Meta).
 */

import { Info } from "lucide-react";
import { META_ATTRIBUTION_WINDOW } from "@/lib/api-clients/meta";

interface Props {
  /** Render icon-only with tooltip on hover (use inline next to a metric value). */
  compact?: boolean;
  /** Optional override label for the prefix word ("Attribution" by default). */
  prefix?: string;
}

export default function AttributionInfo({ compact = false, prefix = "Attribution" }: Props) {
  if (compact) {
    return (
      <span
        className="inline-flex items-center text-gray-400 hover:text-gray-600 cursor-help align-middle ml-1"
        title={`${prefix}: ${META_ATTRIBUTION_WINDOW.label}. ${META_ATTRIBUTION_WINDOW.description}`}
      >
        <Info className="w-3 h-3" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-[11px] font-medium text-blue-800"
      title={META_ATTRIBUTION_WINDOW.description}
    >
      <Info className="w-3 h-3" />
      <span>
        {prefix}: <span className="font-semibold">{META_ATTRIBUTION_WINDOW.label}</span>
      </span>
    </span>
  );
}
