
import { useState } from "react";

export interface ManualCompetitorRow {
  brand: string;
  instagramHandle: string;
  metaAdLibraryUrl: string;
  adKeyword: string;
  googleAdsUrl: string;
  linkedInUrl: string;
}

export interface GoogleAdsOptions {
  include: boolean;
  mode: "fast" | "rich";
  url: string;
}

interface Props {
  onSubmit: (url: string, useLlm: boolean, socialSource: string, instagramHandle: string, adLibraryUrl: string, coverCompetitors: boolean, competitors: ManualCompetitorRow[], competitorsOnly: boolean, brandName: string, googleAds: GoogleAdsOptions, linkedIn: { include: boolean; url: string }) => void;
  loading: boolean;
}

const emptyCompetitor = (): ManualCompetitorRow => ({ brand: "", instagramHandle: "", metaAdLibraryUrl: "", adKeyword: "", googleAdsUrl: "", linkedInUrl: "" });

// Channel accent colours (Instagram / Meta / Google / LinkedIn).
const CHAN = { insta: "#c1387b", meta: "#0866ff", google: "#ea4335", linkedin: "#0a66c2" };

/** One channel input with a coloured-dot label (shared by the brand + competitor cards). */
function ChannelField({ label, color, value, onChange, placeholder, type = "text", disabled }:
  { label: string; color: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string; disabled?: boolean }) {
  return (
    <div>
      <label className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wide text-fg-dim mb-1.5">
        <span className="inline-block w-[7px] h-[7px] rounded-full shrink-0" style={{ background: color }} />{label}
      </label>
      <input type={type} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 border border-line rounded-sm text-sm text-fg placeholder-fg-mute bg-bg focus:outline-none focus:ring-1 focus:ring-accent" />
    </div>
  );
}

/** iOS-style toggle used in the settings card. */
function Switch({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <div onClick={() => !disabled && onToggle()} className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${on ? "bg-accent" : "bg-line"}`}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-bg rounded-full shadow-sm transition-transform ${on ? "translate-x-4" : "translate-x-0"}`} />
    </div>
  );
}

const SECTION_LABEL = "font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-fg-dim";
const CARD_CHIPS = [
  { key: "insta" as const, label: "Insta" },
  { key: "meta" as const, label: "Meta" },
  { key: "google" as const, label: "Google" },
  { key: "linkedin" as const, label: "LinkedIn" },
];

export function AnalysisForm({ onSubmit, loading }: Props) {
  const [brandName, setBrandName] = useState("");
  const [url, setUrl] = useState("");
  const [useLlm, setUseLlm] = useState(true);
  const [socialSource] = useState("auto");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [adLibraryUrl, setAdLibraryUrl] = useState("");
  const [competitorsOnly, setCompetitorsOnly] = useState(false);
  const [competitors, setCompetitors] = useState<ManualCompetitorRow[]>([]);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  // LinkedIn + Google Ads (opt-in). Enabled by presence of a URL — no separate checkbox,
  // so they read like the other labelled input fields above.
  const [linkedInUrl, setLinkedInUrl] = useState("");
  const [googleAdsUrl, setGoogleAdsUrl] = useState("");
  const [brandOpen, setBrandOpen] = useState(true);
  const includeLinkedIn = linkedInUrl.trim().length > 0;
  const includeGoogleAds = googleAdsUrl.trim().length > 0;
  const googleAdsMode: "fast" | "rich" = "rich";

  // A Google Ads scan can seed a run on its own: a Transparency URL (rich) or the brand
  // name (fast search) — parity with the Meta Ad Library URL as a standalone source.
  const googleSeed = includeGoogleAds && !!(googleAdsUrl.trim() || brandName.trim());
  const mainProvided = !!(url.trim() || instagramHandle.trim() || adLibraryUrl.trim() || googleSeed);
  const pinsUsable = competitors.some(c => c.brand.trim() || c.instagramHandle.trim() || c.metaAdLibraryUrl.trim());
  // Main brand is OPTIONAL when competitors are pinned — but we still need SOMETHING
  // to run (our own brand to auto-discover from, or a pinned competitor list).
  const canSubmit = mainProvided || pinsUsable;

  const setRow = (i: number, patch: Partial<ManualCompetitorRow>) =>
    setCompetitors(rows => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;
    const cleanHandle = instagramHandle.trim().replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "").replace(/\/$/, "");
    const cleanCompetitors = competitors
      .map(c => ({
        brand: c.brand.trim(),
        instagramHandle: c.instagramHandle.trim().replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "").replace(/\/$/, ""),
        metaAdLibraryUrl: c.metaAdLibraryUrl.trim(),
        adKeyword: c.adKeyword.trim(),
        googleAdsUrl: c.googleAdsUrl.trim(),
        linkedInUrl: c.linkedInUrl.trim(),
      }))
      .filter(c => c.brand || c.instagramHandle || c.metaAdLibraryUrl);
    // Competitors are user-pinned only (Gemini auto-discovery removed) — coverCompetitors is always false.
    onSubmit(url.trim(), useLlm, socialSource, cleanHandle, adLibraryUrl.trim(), false, cleanCompetitors, competitorsOnly, brandName.trim(), { include: includeGoogleAds, mode: googleAdsMode, url: googleAdsUrl.trim() }, { include: includeLinkedIn, url: linkedInUrl.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* ── Your brand ── */}
      <div className={SECTION_LABEL}>Your brand</div>
      <div className="rounded-lg overflow-hidden border-2 border-accent">
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-surface-2 border-b border-line cursor-pointer select-none" onClick={() => setBrandOpen(o => !o)}>
          <span className="shrink-0 w-6 h-6 rounded-md text-bg font-mono text-[11px] font-bold flex items-center justify-center bg-accent">★</span>
          <input value={brandName} disabled={loading} onClick={e => e.stopPropagation()} onChange={e => setBrandName(e.target.value)} placeholder="Brand name"
            className="shrink-0 w-36 bg-transparent border-none outline-none text-sm font-semibold text-fg placeholder-fg-mute" />
          <div className="flex-1 flex gap-1.5 flex-wrap">
            {CARD_CHIPS.map(ch => {
              const set = ({ insta: instagramHandle, meta: adLibraryUrl, google: googleAdsUrl, linkedin: linkedInUrl }[ch.key]).trim().length > 0;
              return (
                <span key={ch.key} className="inline-flex items-center gap-1.5 font-mono text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-1 rounded"
                  style={set ? { color: CHAN[ch.key], background: "var(--surface)", border: "1px solid var(--line)" } : { color: "var(--fg-mute)", background: "var(--surface)" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: set ? CHAN[ch.key] : "var(--line)" }} />{ch.label}
                </span>
              );
            })}
          </div>
          <span className="text-fg-mute text-xs transition-transform shrink-0" style={{ transform: brandOpen ? "rotate(180deg)" : "none" }}>▾</span>
        </div>
        {brandOpen && (
          <div className="p-3.5 space-y-3.5">
            <div>
              <label className="block font-mono text-[10.5px] uppercase tracking-wide text-fg-dim mb-1.5">Brand name</label>
              <input type="text" value={brandName} disabled={loading} onChange={e => setBrandName(e.target.value)}
                placeholder="e.g. Mokobara — the label shown in the report"
                className="w-full px-3 py-2 border border-line rounded-sm text-sm text-fg placeholder-fg-mute bg-bg focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <label className="block font-mono text-[10.5px] uppercase tracking-wide text-fg-dim mb-1.5">Product URL <span className="normal-case tracking-normal text-fg-mute">(optional — Amazon, Flipkart, Myntra, Nykaa, Croma, or brand site)</span></label>
              <input type="url" value={url} disabled={loading} onChange={e => setUrl(e.target.value)} placeholder="https://www.amazon.com/dp/B0C…"
                className="w-full px-3 py-2 border border-line rounded-sm text-sm text-fg placeholder-fg-mute bg-bg focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div className="h-px bg-line-soft" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ChannelField label="Instagram" color={CHAN.insta} value={instagramHandle} onChange={setInstagramHandle} placeholder="@beminimalist or instagram.com/handle" disabled={loading} />
              <ChannelField label="Meta Ad Library" color={CHAN.meta} value={adLibraryUrl} onChange={setAdLibraryUrl} placeholder="facebook.com/ads/library/?q=BRAND" type="url" disabled={loading} />
              <ChannelField label="Google Ads Transparency" color={CHAN.google} value={googleAdsUrl} onChange={setGoogleAdsUrl} placeholder="adstransparency.google.com/advertiser/AR…" type="url" disabled={loading} />
              <ChannelField label="LinkedIn" color={CHAN.linkedin} value={linkedInUrl} onChange={setLinkedInUrl} placeholder="linkedin.com/company/your-company" type="url" disabled={loading} />
            </div>
            <p className="text-xs text-fg-mute">Leave any field blank to auto-detect from the others. No sign-in required — paste public URLs only. LinkedIn (organic posts) &amp; Google Ads are optional add-on sources.</p>
          </div>
        )}
      </div>


      {/* User-pinned competitors — collapsible entity-cards (same channel fields as your brand). */}
      <div className="space-y-3">
        <p className="data">Competitors <span className="normal-case tracking-normal font-normal text-fg-mute">({competitors.length} / 5 — optional)</span></p>
        <p className="text-xs text-fg-mute -mt-1.5">Add competitors with the same channels — Instagram, Meta, Google &amp; LinkedIn. We scrape each and rank the set in the Ad Intelligence tab.</p>

        {competitors.map((c, i) => {
          const open = !collapsed[i];
          const chips = [
            { key: "insta" as const, label: "Insta", set: !!c.instagramHandle.trim() },
            { key: "meta" as const, label: "Meta", set: !!c.metaAdLibraryUrl.trim() },
            { key: "google" as const, label: "Google", set: !!c.googleAdsUrl.trim() },
            { key: "linkedin" as const, label: "LinkedIn", set: !!c.linkedInUrl.trim() },
          ];
          const chan = (label: string, colorKey: keyof typeof CHAN, value: string, field: keyof ManualCompetitorRow, placeholder: string, type = "text") => (
            <div>
              <label className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wide text-fg-dim mb-1.5">
                <span className="inline-block w-[7px] h-[7px] rounded-full shrink-0" style={{ background: CHAN[colorKey] }} />{label}
              </label>
              <input type={type} value={value} disabled={loading} onChange={e => setRow(i, { [field]: e.target.value } as Partial<ManualCompetitorRow>)} placeholder={placeholder}
                className="w-full px-3 py-2 border border-line rounded-sm text-sm text-fg placeholder-fg-mute bg-bg focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
          );
          return (
            <div key={i} className="rounded-lg border border-line overflow-hidden">
              <div className="flex items-center gap-2.5 px-3 py-2.5 bg-surface-2 border-b border-line cursor-pointer select-none" onClick={() => setCollapsed(s => ({ ...s, [i]: !s[i] }))}>
                <span className="shrink-0 w-6 h-6 rounded-md bg-fg text-bg font-mono text-[11px] font-bold flex items-center justify-center">{String(i + 1).padStart(2, "0")}</span>
                <input value={c.brand} disabled={loading} onClick={e => e.stopPropagation()} onChange={e => setRow(i, { brand: e.target.value })} placeholder="Competitor name"
                  className="shrink-0 w-36 bg-transparent border-none outline-none text-sm font-semibold text-fg placeholder-fg-mute" />
                <div className="flex-1 flex gap-1.5 flex-wrap">
                  {chips.map(ch => (
                    <span key={ch.key} className="inline-flex items-center gap-1.5 font-mono text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-1 rounded"
                      style={ch.set ? { color: CHAN[ch.key], background: "var(--surface)", border: "1px solid var(--line)" } : { color: "var(--fg-mute)", background: "var(--surface)" }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: ch.set ? CHAN[ch.key] : "var(--line)" }} />{ch.label}
                    </span>
                  ))}
                </div>
                <span className="text-fg-mute text-xs transition-transform shrink-0" style={{ transform: open ? "rotate(180deg)" : "none" }}>▾</span>
                <button type="button" disabled={loading} title="Remove"
                  onClick={e => { e.stopPropagation(); setCompetitors(rows => rows.filter((_, j) => j !== i)); setCollapsed({}); }}
                  className="shrink-0 text-fg-mute hover:text-alert text-lg leading-none px-1">×</button>
              </div>
              {open && (
                <div className="p-3.5 space-y-3.5">
                  <div>
                    <label className="block font-mono text-[10.5px] uppercase tracking-wide text-fg-dim mb-1.5">Brand name</label>
                    <input type="text" value={c.brand} disabled={loading} onChange={e => setRow(i, { brand: e.target.value })}
                      placeholder="e.g. Moxie Beauty — the label shown in the report"
                      className="w-full px-3 py-2 border border-line rounded-sm text-sm text-fg placeholder-fg-mute bg-bg focus:outline-none focus:ring-1 focus:ring-accent" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {chan("Instagram", "insta", c.instagramHandle, "instagramHandle", "@handle or instagram.com/handle")}
                    {chan("Meta Ad Library", "meta", c.metaAdLibraryUrl, "metaAdLibraryUrl", "facebook.com/ads/library/… or facebook.com/BRAND", "url")}
                    {chan("Google Ads Transparency", "google", c.googleAdsUrl, "googleAdsUrl", "adstransparency.google.com/advertiser/AR…", "url")}
                    {chan("LinkedIn", "linkedin", c.linkedInUrl, "linkedInUrl", "linkedin.com/company/…", "url")}
                  </div>
                  <div>
                    <label className="block font-mono text-[10.5px] uppercase tracking-wide text-fg-dim mb-1.5">Keyword <span className="normal-case tracking-normal text-fg-mute">(optional — filter Meta ads)</span></label>
                    <input type="text" value={c.adKeyword} disabled={loading} onChange={e => setRow(i, { adKeyword: e.target.value })}
                      placeholder="e.g. “fan”, “mixer” — scrape only matching ads"
                      className="w-full px-3 py-2 border border-line rounded-sm text-sm text-fg placeholder-fg-mute bg-bg focus:outline-none focus:ring-1 focus:ring-accent" />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <button type="button" onClick={() => setCompetitors(r => [...r, emptyCompetitor()])} disabled={loading || competitors.length >= 5}
          className="w-full border border-dashed border-line rounded-lg py-3 font-mono text-[12px] uppercase tracking-wide text-accent hover:bg-accent-soft hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          + Add competitor
        </button>
      </div>

      {/* ── Settings ── */}
      <div className="rounded-lg border border-line divide-y divide-line-soft">
        <div className="flex items-center justify-between gap-4 p-4">
          <div>
            <div className="text-sm font-medium text-fg">Gemini AI enrichment</div>
            <div className="text-xs text-fg-mute mt-0.5">Adds strategic recommendations and Reddit sentiment on top of raw scrape data.</div>
          </div>
          <Switch on={useLlm} onToggle={() => setUseLlm(v => !v)} disabled={loading} />
        </div>
        <div className="flex items-center justify-between gap-4 p-4">
          <div>
            <div className="text-sm font-medium text-fg">Competitors only — leave my brand out</div>
            <div className="text-xs text-fg-mute mt-0.5">
              Show the analysis for the competitors you pin above, excluding your own brand from the results.
              {competitorsOnly && !pinsUsable && <span className="block text-alert mt-1">Pin at least one competitor above — we can&apos;t run &ldquo;competitors only&rdquo; with none.</span>}
            </div>
          </div>
          <Switch on={competitorsOnly} onToggle={() => setCompetitorsOnly(v => !v)} disabled={loading} />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || !canSubmit}
        className="btn w-full py-3.5 px-4 disabled:!bg-line disabled:!text-fg-mute text-sm font-mono uppercase tracking-[0.1em] disabled:pointer-events-none"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-3.5 h-3.5 border-2 border-bg/30 border-t-bg rounded-full animate-spin" />
            Analyzing…
          </span>
        ) : "Run analysis"}
      </button>
      {!canSubmit && (
        <p className="text-xs text-center text-fg-mute">Fill at least one field for your brand to get started. Competitors are optional but power the comparison.</p>
      )}
    </form>
  );
}
