
import { useMemo, useState } from "react";
import type { AnalysisResponse, SocialPaidAd } from "@/lib/media-analyser/types";
import { PaidAdsDashboard } from "@/components/media-analyser/PaidAdsDashboard";
import ModelSelect from "@/components/media-analyser/ModelSelect";
import { Input } from "@/components/media-analyser/ui/Input";

interface BrandAds { brand: string; ads: SocialPaidAd[] }

/** An ad matches when its copy/CTA/page contains EVERY whitespace term (AND). */
function matchAd(ad: SocialPaidAd, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = `${ad.title ?? ""} ${ad.body ?? ""} ${ad.cta ?? ""} ${ad.pageName ?? ""} ${ad.adName ?? ""}`.toLowerCase();
  return terms.every(t => hay.includes(t));
}

/**
 * "Keyword Ads" tab — narrow one brand's already-scraped Meta ads to a keyword.
 * A competitor sells many products; this filters their ad set to the matching ones.
 */
export function KeywordAds({ result }: { result: AnalysisResponse }) {
  // Searchable set: the product's own ads ("You") + every competitor with ads.
  const brands = useMemo<BrandAds[]>(() => {
    const social = result.socialSnapshot as Record<string, unknown> | null | undefined;
    const youAds = (social?.paidAds ?? []) as SocialPaidAd[];
    const list: BrandAds[] = [];
    if (youAds.length) list.push({ brand: "You", ads: youAds });
    for (const c of (result.competitorSocial ?? []) as Array<Record<string, unknown>>) {
      const ads = (c.ads ?? []) as SocialPaidAd[];
      if (ads.length) list.push({ brand: String(c.brand ?? "Competitor"), ads });
    }
    return list;
  }, [result]);

  // Default to the first competitor if present, else the first brand ("You").
  const [selected, setSelected] = useState<string>(() => {
    const firstComp = brands.find(b => b.brand !== "You");
    return (firstComp ?? brands[0])?.brand ?? "";
  });
  const [keyword, setKeyword] = useState("");

  if (!brands.length) {
    return (
      <div className="py-8 space-y-2">
        <p className="text-sm text-fg-dim font-medium">No scraped ads to search yet.</p>
        <p className="text-xs text-fg-mute">Run an analysis with a Meta Ad Library URL and/or <span className="font-medium text-fg-dim">competitors</span> — then search their ads by keyword here.</p>
      </div>
    );
  }

  const active = brands.find(b => b.brand === selected) ?? brands[0];
  const terms = keyword.toLowerCase().split(/\s+/).map(t => t.trim()).filter(Boolean);
  const filtered = active.ads.filter(ad => matchAd(ad, terms));

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">
          Keyword Ads
          <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">search a brand&apos;s ads ✦</span>
        </h3>
        <p className="text-xs text-fg-mute mt-0.5 leading-relaxed">
          A competitor runs ads across many products. Pick a brand and type a keyword to narrow their ads to
          the ones about that product or theme.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
        <ModelSelect
          label="Brand"
          options={brands.map(b => ({ id: b.brand, label: b.brand === "You" ? "You (your ads)" : b.brand }))}
          value={active.brand}
          onChange={v => setSelected(v)}
        />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-dim">Keyword</span>
          <Input
            type="text"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="e.g. running shoes, serum, discount…"
          />
        </div>
      </div>

      <p className="font-mono text-[11px] uppercase tracking-wide text-fg-mute">
        {keyword.trim()
          ? `${filtered.length} of ${active.ads.length} ads match “${keyword.trim()}”`
          : `${active.ads.length} ads for ${active.brand === "You" ? "you" : active.brand}`}
      </p>

      {filtered.length ? (
        <PaidAdsDashboard ads={filtered} compact />
      ) : (
        <p className="text-sm text-fg-mute py-6 px-3 border border-dashed border-line rounded-lg">
          No ads match “{keyword.trim()}” for {active.brand === "You" ? "you" : active.brand} — try a broader keyword.
        </p>
      )}
    </div>
  );
}
