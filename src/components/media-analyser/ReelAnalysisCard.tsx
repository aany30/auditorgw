
import type { AdReelAnalysis } from "@/lib/media-analyser/ad-reel-analysis";

export const REEL_TYPE_LABELS: Record<AdReelAnalysis["reel_type"], string> = {
  influencer_reel: "Influencer reel",
  ugc_ad: "UGC ad",
  brand_produced_ad: "Brand-produced ad",
  product_showcase: "Product showcase",
  testimonial: "Testimonial",
  other: "Other",
};

/**
 * Renders one per-ad AI reel/creative verdict — shared by the paid-ads card grid
 * (PaidAdsDashboard) and the Ad Table (AdClassifyTable) so both surfaces present
 * the same influencer / UGC / actor breakdown identically.
 */
export function ReelAnalysisCard({
  reel,
  onRerun,
  rerunning,
  onClone,
}: {
  reel: AdReelAnalysis;
  onRerun: () => void;
  rerunning: boolean;
  onClone?: () => void;
}) {
  const typeLabel = reel.reel_type_label || REEL_TYPE_LABELS[reel.reel_type] || "Reel";
  const actor = reel.actor_name || reel.actor_description;
  const pct = Math.round((reel.confidence ?? 0) * 100);
  const Row = ({ label, value }: { label: string; value?: string }) =>
    value ? (
      <div className="flex gap-1.5">
        <dt className="text-[9px] font-semibold uppercase tracking-wide text-accent-2 shrink-0 w-16 pt-px">{label}</dt>
        <dd className="text-[10px] leading-snug text-fg-dim">{value}</dd>
      </div>
    ) : null;

  return (
    <div className="rounded-lg bg-accent-2-soft/50 border border-accent-2/30 p-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[9px] font-bold uppercase tracking-wide text-accent-2">AI · Reel analysis</span>
        <span className="text-[9px] font-bold uppercase tracking-wide bg-accent-2 text-white px-1.5 py-0.5 rounded">{typeLabel}</span>
        {reel.is_influencer && (
          <span className="text-[9px] font-semibold uppercase tracking-wide bg-accent-soft text-accent px-1.5 py-0.5 rounded">Influencer</span>
        )}
        <span className="text-[9px] font-medium text-fg-mute">{pct}% conf · {reel.source === "video" ? "video" : reel.source === "copy" ? "copy only" : "key frame"}</span>
      </div>
      {(reel.is_influencer || reel.actor_present) && (reel.influencer_brief || actor) && (
        <div className="flex gap-1.5 items-start rounded bg-accent-soft/60 border-l-2 border-accent px-1.5 py-1">
          <span className="text-[9px] font-bold uppercase tracking-wide text-accent shrink-0 pt-px">{reel.is_influencer ? "Influencer" : "Creator"}</span>
          <span className="text-[10px] leading-snug font-medium text-fg">{reel.influencer_brief || actor}</span>
        </div>
      )}
      <dl className="space-y-1">
        <Row label="Actor" value={actor || (reel.actor_present ? "Present (unnamed)" : "None")} />
        <Row label="Format" value={reel.format} />
        <Row label="Setting" value={reel.setting} />
        <Row label="Language" value={reel.spoken_language} />
        <Row label="Depicts" value={reel.depicts} />
        <Row label="Showcases" value={reel.showcases} />
        <Row label="Why" value={reel.reasoning} />
      </dl>
      <div className="flex items-center gap-3 pt-0.5">
        <button
          type="button"
          onClick={onRerun}
          disabled={rerunning}
          className="text-[9px] font-medium text-accent-2 hover:underline disabled:opacity-60"
        >
          {rerunning ? "Re-analyzing…" : "Re-analyze"}
        </button>
        {onClone && (
          <button
            type="button"
            onClick={onClone}
            className="text-[9px] font-bold uppercase tracking-wide bg-accent text-bg px-2 py-1 rounded hover:opacity-90"
          >
            ✦ Clone reel for my product
          </button>
        )}
      </div>
    </div>
  );
}
