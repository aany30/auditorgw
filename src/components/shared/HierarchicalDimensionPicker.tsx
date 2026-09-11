/**
 * Tree-checkbox dropdown used by the Aggregate section's Objective/Creative
 * combo views. Same trigger UX as CampaignMultiPicker ("Add" button opens a
 * popover), but the body is a 4-level tree:
 *
 *   dimensionValue (Video/Awareness/…)  →  campaign  →  adSet/IO  →  ad/LI
 *
 * Ticking a checkbox at any level means "everything at and below counts".
 * Leaves out of tick = narrower selection. Selection round-trips through the
 * `HierNodeSelection[]` roll-up rule declared in types/planning.ts.
 */

import { useMemo, useState, useRef, startTransition, useEffect, useCallback } from "react";
import { Plus, X, Search, Check, ChevronRight, ChevronDown } from "lucide-react";
import type { HierNodeSelection } from "@/types/planning";

export interface HierTreeAd { id: string; name: string }
export interface HierTreeAdSet { id: string; name: string; ads: HierTreeAd[] }
export interface HierTreeCampaign { id: string; name: string; status?: string; adSets: HierTreeAdSet[] }
export interface HierTreeNode { dimensionValue: string; campaigns: HierTreeCampaign[] }

// Human-friendly summary of the current selection for the trigger button.
function summarize(selection: HierNodeSelection[], allLabel: string): string {
  if (selection.length === 0) return allLabel;
  if (selection.length === 1) {
    const s = selection[0];
    if (s.adIds?.length) return `${s.adIds.length} ad${s.adIds.length === 1 ? "" : "s"}`;
    if (s.adSetIds?.length) return `${s.adSetIds.length} ad set${s.adSetIds.length === 1 ? "" : "s"}`;
    if (s.campaignIds?.length) return `${s.campaignIds.length} campaign${s.campaignIds.length === 1 ? "" : "s"}`;
    return s.dimensionValue;
  }
  return `${selection.length} selected`;
}

// Selection helpers. A `HierNodeSelection` where all narrower fields are
// undefined = "the entire subtree" (dimension value, campaign, or ad set).
function findNode(selection: HierNodeSelection[], dimensionValue: string): HierNodeSelection | undefined {
  return selection.find((n) => n.dimensionValue === dimensionValue);
}

// A dimension value is FULLY selected when its node exists and no narrower
// arrays are set (undefined = "all"), OR when campaignIds is set but empty
// (never — we drop nodes when they'd match nothing). Explicit `campaignIds: []`
// is not a shape we produce.
function isDimSelected(selection: HierNodeSelection[], v: string): boolean {
  const n = findNode(selection, v);
  return !!n && !n.campaignIds && !n.adSetIds && !n.adIds;
}
function isDimIndeterminate(selection: HierNodeSelection[], v: string): boolean {
  const n = findNode(selection, v);
  return !!n && (!!n.campaignIds?.length || !!n.adSetIds?.length || !!n.adIds?.length);
}
function isCampaignSelected(selection: HierNodeSelection[], v: string, cId: string): boolean {
  const n = findNode(selection, v);
  if (!n) return false;
  if (!n.campaignIds && !n.adSetIds && !n.adIds) return true; // whole dim selected
  return !!n.campaignIds?.includes(cId) && !n.adSetIds && !n.adIds;
}
function isCampaignIndeterminate(selection: HierNodeSelection[], v: string, cId: string): boolean {
  const n = findNode(selection, v);
  if (!n) return false;
  if (!n.campaignIds?.includes(cId)) return false;
  return !!n.adSetIds?.length || !!n.adIds?.length;
}
function isAdSetSelected(selection: HierNodeSelection[], v: string, cId: string, asId: string): boolean {
  const n = findNode(selection, v);
  if (!n) return false;
  if (!n.campaignIds && !n.adSetIds && !n.adIds) return true;
  if (!n.campaignIds?.includes(cId)) return false;
  if (!n.adSetIds && !n.adIds) return true; // whole campaign
  return !!n.adSetIds?.includes(asId) && !n.adIds;
}
function isAdSetIndeterminate(selection: HierNodeSelection[], v: string, cId: string, asId: string): boolean {
  const n = findNode(selection, v);
  if (!n || !n.campaignIds?.includes(cId) || !n.adSetIds?.includes(asId)) return false;
  return !!n.adIds?.length;
}
function isAdSelected(selection: HierNodeSelection[], v: string, cId: string, asId: string, adId: string): boolean {
  const n = findNode(selection, v);
  if (!n) return false;
  if (!n.campaignIds && !n.adSetIds && !n.adIds) return true;
  if (!n.campaignIds?.includes(cId)) return false;
  if (!n.adSetIds && !n.adIds) return true;
  if (!n.adSetIds?.includes(asId)) return false;
  if (!n.adIds) return true;
  return n.adIds.includes(adId);
}

// Toggle helpers — always produce the minimal shape (drop empty campaign/adSet/ad arrays).
function toggleDim(selection: HierNodeSelection[], v: string): HierNodeSelection[] {
  const has = !!findNode(selection, v);
  if (has) return selection.filter((n) => n.dimensionValue !== v);
  return [...selection, { dimensionValue: v }];
}
function toggleCampaign(selection: HierNodeSelection[], tree: HierTreeNode, cId: string): HierNodeSelection[] {
  const v = tree.dimensionValue;
  const node = findNode(selection, v);
  const other = selection.filter((n) => n.dimensionValue !== v);
  // If the whole dim is currently selected, materialise it as "all campaigns except this one".
  if (node && !node.campaignIds && !node.adSetIds && !node.adIds) {
    const remaining = tree.campaigns.map((c) => c.id).filter((id) => id !== cId);
    return remaining.length === 0 ? other : [...other, { dimensionValue: v, campaignIds: remaining }];
  }
  if (!node) return [...other, { dimensionValue: v, campaignIds: [cId] }];
  const cur = new Set(node.campaignIds ?? []);
  if (cur.has(cId)) cur.delete(cId); else cur.add(cId);
  // Clear narrower ad-set/ad picks when toggling the whole campaign row.
  if (cur.size === 0) return other;
  return [...other, { dimensionValue: v, campaignIds: [...cur] }];
}
function toggleAdSet(selection: HierNodeSelection[], tree: HierTreeNode, cId: string, asId: string): HierNodeSelection[] {
  const v = tree.dimensionValue;
  const node = findNode(selection, v);
  const other = selection.filter((n) => n.dimensionValue !== v);
  // Whole dim selected → materialise as "all ad sets except this one under this campaign".
  const campaign = tree.campaigns.find((c) => c.id === cId);
  if (!campaign) return selection;
  if (node && !node.campaignIds && !node.adSetIds && !node.adIds) {
    const otherCampaigns = tree.campaigns.map((c) => c.id).filter((id) => id !== cId);
    const otherAdSets = campaign.adSets.map((a) => a.id).filter((id) => id !== asId);
    if (otherAdSets.length === 0) {
      return otherCampaigns.length === 0 ? other : [...other, { dimensionValue: v, campaignIds: otherCampaigns }];
    }
    return [...other, { dimensionValue: v, campaignIds: [cId, ...otherCampaigns], adSetIds: otherAdSets }];
  }
  if (!node) return [...other, { dimensionValue: v, campaignIds: [cId], adSetIds: [asId] }];
  const cIds = new Set(node.campaignIds ?? []);
  cIds.add(cId);
  // Whole campaign selected → materialise as "all ad sets under it minus this one".
  if (cIds.has(cId) && !node.adSetIds && !node.adIds && node.campaignIds?.includes(cId)) {
    const otherAdSets = campaign.adSets.map((a) => a.id).filter((id) => id !== asId);
    if (otherAdSets.length === 0) {
      const cRest = [...cIds].filter((id) => id !== cId);
      return cRest.length === 0 ? other : [...other, { dimensionValue: v, campaignIds: cRest }];
    }
    return [...other, { dimensionValue: v, campaignIds: [...cIds], adSetIds: otherAdSets }];
  }
  const asSet = new Set(node.adSetIds ?? []);
  if (asSet.has(asId)) asSet.delete(asId); else asSet.add(asId);
  if (asSet.size === 0) {
    // Fall back to campaign-level selection when all ad sets are dropped.
    if (cIds.size === 0) return other;
    return [...other, { dimensionValue: v, campaignIds: [...cIds] }];
  }
  return [...other, { dimensionValue: v, campaignIds: [...cIds], adSetIds: [...asSet] }];
}
function toggleAd(selection: HierNodeSelection[], tree: HierTreeNode, cId: string, asId: string, adId: string): HierNodeSelection[] {
  const v = tree.dimensionValue;
  const node = findNode(selection, v);
  const other = selection.filter((n) => n.dimensionValue !== v);
  const campaign = tree.campaigns.find((c) => c.id === cId);
  const adSet = campaign?.adSets.find((a) => a.id === asId);
  if (!campaign || !adSet) return selection;
  // Nothing selected yet under this dim → this click ADDS only this ad.
  if (!node) return [...other, { dimensionValue: v, campaignIds: [cId], adSetIds: [asId], adIds: [adId] }];
  // Whole dim / whole campaign / whole ad set is implicitly on for this ad,
  // meaning the click INTENDS to REMOVE it — materialise the sibling ads then
  // drop this one. `implicitlyOn` covers all three cases.
  const implicitlyOn =
    (!node.campaignIds && !node.adSetIds && !node.adIds) ||
    (node.campaignIds?.includes(cId) && !node.adSetIds && !node.adIds) ||
    (node.adSetIds?.includes(asId) && !node.adIds);
  if (implicitlyOn) {
    const otherAds = adSet.ads.map((a) => a.id).filter((id) => id !== adId);
    if (otherAds.length === 0) return toggleAdSet(selection, tree, cId, asId);
    const cIds = new Set(node.campaignIds ?? []); cIds.add(cId);
    const asIds = new Set(node.adSetIds ?? []); asIds.add(asId);
    return [...other, { dimensionValue: v, campaignIds: [...cIds], adSetIds: [...asIds], adIds: otherAds }];
  }
  // Otherwise we're already at the ad-list level — simple add/remove.
  const cIds = new Set(node.campaignIds ?? []); cIds.add(cId);
  const asIds = new Set(node.adSetIds ?? []); asIds.add(asId);
  const adIds = new Set(node.adIds ?? []);
  if (adIds.has(adId)) adIds.delete(adId); else adIds.add(adId);
  if (adIds.size === 0) {
    asIds.delete(asId);
    if (asIds.size === 0) {
      if (cIds.size === 0) return other;
      return [...other, { dimensionValue: v, campaignIds: [...cIds] }];
    }
    return [...other, { dimensionValue: v, campaignIds: [...cIds], adSetIds: [...asIds] }];
  }
  return [...other, { dimensionValue: v, campaignIds: [...cIds], adSetIds: [...asIds], adIds: [...adIds] }];
}

interface Props {
  tree: HierTreeNode[];
  selection: HierNodeSelection[];
  onChange: (next: HierNodeSelection[]) => void;
  allLabelText: string;
  entityLabel: string;
  loading?: boolean;
  /** When the source hook reports an error (Meta throttled, network failure,
   *  etc.), pass its message here. Instead of "No X match." we render an
   *  honest "Meta is throttling this account — retry in 2 min" block with a
   *  retry button. Distinguishes an empty-because-throttled state from
   *  empty-because-account-really-has-none. */
  throttleError?: string | null;
  /** Called when the user clicks the retry button. Should re-fire the
   *  source hook (usually by bumping a `reloadTick` state). */
  onRetry?: () => void;
}

const CheckBox = ({ state }: { state: "unchecked" | "checked" | "indeterminate" }) => (
  <span
    className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition ${
      state === "checked" || state === "indeterminate" ? "bg-blue-600 border border-blue-600" : "border border-gray-300 bg-white"
    }`}
  >
    {state === "checked" && <Check className="w-3 h-3 text-white" />}
    {state === "indeterminate" && <span className="w-2 h-[2px] bg-white rounded" />}
  </span>
);

export default function HierarchicalDimensionPicker({
  tree, selection, onChange, allLabelText, entityLabel, loading = false, throttleError = null, onRetry,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside — more reliable than a fixed overlay div
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Optimistic local selection — updates instantly on click while the heavy
  // parent re-render (useMemos over 1000+ campaigns) runs in a transition.
  const [localSel, setLocalSel] = useState(selection);
  const parentRef = useRef(selection);
  useEffect(() => { parentRef.current = selection; setLocalSel(selection); }, [selection]);
  const effectiveSel = localSel;
  const fireChange = (next: HierNodeSelection[]) => {
    setLocalSel(next);
    startTransition(() => onChange(next));
  };

  const isActive = (s?: string) => !!s && /active/i.test(s);
  const sortCampaigns = (camps: HierTreeCampaign[]) =>
    [...camps].sort((a, b) => {
      const aa = isActive(a.status) ? 0 : 1;
      const ba = isActive(b.status) ? 0 : 1;
      return aa - ba || a.name.localeCompare(b.name);
    });

  const filteredTree = useMemo(() => {
    const sortNode = (node: HierTreeNode): HierTreeNode => ({ ...node, campaigns: sortCampaigns(node.campaigns) });
    if (!query.trim()) return tree.map(sortNode);
    const q = query.toLowerCase();
    return tree
      .map((node) => {
        if (node.dimensionValue.toLowerCase().includes(q)) return sortNode(node);
        const campaigns = node.campaigns.filter((c) =>
          c.name.toLowerCase().includes(q) ||
          c.adSets.some((as) => as.name.toLowerCase().includes(q) || as.ads.some((a) => a.name.toLowerCase().includes(q)))
        );
        return campaigns.length > 0 ? sortNode({ ...node, campaigns }) : null;
      })
      .filter((n): n is HierTreeNode => n !== null);
  }, [tree, query]);

  const label = summarize(effectiveSel, allLabelText);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div ref={containerRef} className="relative inline-flex items-center gap-2">
      <span className="text-xs italic text-gray-500">{label}</span>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700"
      >
        <Plus className="w-3 h-3" /> Add
      </button>
      {effectiveSel.length > 0 && (
        <button
          onClick={() => fireChange([])}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-gray-500 hover:text-gray-700"
          title="Clear"
        >
          <X className="w-3 h-3" />
        </button>
      )}
      {open && (
        <>
          <div className="absolute right-0 top-full mt-1.5 z-50 w-[460px] max-w-[92vw] bg-white text-gray-800 rounded-xl shadow-xl border border-gray-200 overflow-hidden" style={{ maxWidth: "min(460px, calc(100vw - 32px))" }}>
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${entityLabel}, campaigns, ad sets, ads…`}
                  className="w-full pl-8 pr-3 py-2 rounded-lg text-xs border border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {filteredTree.length === 0 ? (
                loading && tree.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-gray-400">Loading {entityLabel}…</div>
                ) : throttleError ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-xs font-semibold text-amber-700 mb-1">Meta is throttling this account</p>
                    <p className="text-[11px] text-gray-500 mb-3">
                      {throttleError.length > 120 ? "Try again in ~2 min — Meta usually recovers within that window." : throttleError}
                    </p>
                    {onRetry && (
                      <button
                        onClick={onRetry}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="px-3 py-6 text-center text-xs text-gray-400">No {entityLabel} match.</div>
                )
              ) : filteredTree.map((node) => {
                const dimKey = `dim:${node.dimensionValue}`;
                const dimOpen = expanded.has(dimKey);
                const dimChecked = isDimSelected(effectiveSel, node.dimensionValue);
                const dimIndet = isDimIndeterminate(effectiveSel, node.dimensionValue);
                return (
                  <div key={node.dimensionValue} className="border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-blue-50">
                      <button onClick={() => toggle(dimKey)} className="p-1 -m-0.5 text-gray-400 hover:text-gray-700" aria-label={dimOpen ? "Collapse" : "Expand"}>
                        {dimOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => fireChange(toggleDim(effectiveSel, node.dimensionValue))}
                        className="flex-1 text-left text-xs font-semibold flex items-center gap-2 py-0.5"
                      >
                        <CheckBox state={dimChecked ? "checked" : dimIndet ? "indeterminate" : "unchecked"} />
                        {node.campaigns.length === 1 && isActive(node.campaigns[0].status) && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="Active" />}
                        <span className="text-gray-800">{node.dimensionValue}</span>
                        <span className="text-[10px] text-gray-400 ml-auto">{node.campaigns.length} camp.</span>
                      </button>
                    </div>
                    {dimOpen && node.campaigns.map((c) => {
                      const campKey = `camp:${node.dimensionValue}:${c.id}`;
                      const campOpen = expanded.has(campKey);
                      const cChecked = isCampaignSelected(effectiveSel, node.dimensionValue, c.id);
                      const cIndet = isCampaignIndeterminate(effectiveSel, node.dimensionValue, c.id);
                      return (
                        <div key={c.id}>
                          <div className="flex items-center gap-1 pl-6 pr-2 py-1 hover:bg-blue-50/50">
                            <button onClick={() => toggle(campKey)} className="p-1 -m-0.5 text-gray-400 hover:text-gray-700" aria-label={campOpen ? "Collapse" : "Expand"}>
                              {campOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            </button>
                            <button
                              onClick={() => fireChange(toggleCampaign(effectiveSel, node, c.id))}
                              className="flex-1 text-left text-[11px] flex items-center gap-2 py-0.5 min-w-0"
                            >
                              <CheckBox state={cChecked ? "checked" : cIndet ? "indeterminate" : "unchecked"} />
                              {isActive(c.status) && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="Active" />}
                              <span className="truncate text-gray-700" title={c.name}>{c.name}</span>
                              <span className="text-[10px] text-gray-400 ml-auto shrink-0">{c.adSets.length}</span>
                            </button>
                          </div>
                          {campOpen && c.adSets.map((as) => {
                            const asKey = `as:${node.dimensionValue}:${c.id}:${as.id}`;
                            const asOpen = expanded.has(asKey);
                            const aChecked = isAdSetSelected(effectiveSel, node.dimensionValue, c.id, as.id);
                            const aIndet = isAdSetIndeterminate(effectiveSel, node.dimensionValue, c.id, as.id);
                            return (
                              <div key={as.id}>
                                <div className="flex items-center gap-1 pl-11 pr-2 py-1 hover:bg-blue-50/50">
                                  <button onClick={() => toggle(asKey)} className="p-1 -m-0.5 text-gray-400 hover:text-gray-700" aria-label={asOpen ? "Collapse" : "Expand"}>
                                    {asOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                  </button>
                                  <button
                                    onClick={() => fireChange(toggleAdSet(effectiveSel, node, c.id, as.id))}
                                    className="flex-1 text-left text-[11px] flex items-center gap-2 py-0.5 min-w-0"
                                  >
                                    <CheckBox state={aChecked ? "checked" : aIndet ? "indeterminate" : "unchecked"} />
                                    <span className="truncate text-gray-600" title={as.name}>{as.name}</span>
                                    <span className="text-[10px] text-gray-400 ml-auto shrink-0">{as.ads.length}</span>
                                  </button>
                                </div>
                                {asOpen && as.ads.map((ad) => {
                                  const adChecked = isAdSelected(effectiveSel, node.dimensionValue, c.id, as.id, ad.id);
                                  return (
                                    <button
                                      key={ad.id}
                                      onClick={() => fireChange(toggleAd(effectiveSel, node, c.id, as.id, ad.id))}
                                      className="w-full pl-16 pr-2 py-1 text-left text-[11px] flex items-center gap-2 hover:bg-blue-50/60"
                                    >
                                      <CheckBox state={adChecked ? "checked" : "unchecked"} />
                                      <span className="truncate text-gray-600" title={ad.name}>{ad.name}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between text-xs">
              <button
                onClick={() => fireChange(tree.map((n) => ({ dimensionValue: n.dimensionValue })))}
                className="font-semibold text-blue-600 hover:underline"
              >
                Select all
              </button>
              <button onClick={() => fireChange([])} className="font-semibold text-gray-500 hover:text-gray-700">Clear</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
