/**
 * Hierarchical drill-down tree for the Naming Convention audit.
 *
 * Renders campaigns as the top level; each row expands to reveal its ad sets;
 * each ad set expands to reveal its ads. Every row shows the same metrics
 * columns (Impressions / Clicks / CTR / CPM / CPC / Spend) where available,
 * plus a per-row Rename button that hits `/api/naming/rename/meta` — the same
 * generalised endpoint handles campaign / ad-set / ad IDs.
 *
 * Data: Meta `listCampaigns` already fetches the nested ad-sets + ads + insights;
 * this component just renders + computes derived metrics (CTR / CPM / CPC).
 */

import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import type { CampaignData } from "@/types";
import { detectCurrency } from "@/lib/currency";

interface Props {
  campaigns: CampaignData[];
  currency?: string;
}

type NodeType = "CAMP" | "AS" | "AD";

const CHIP_STYLES: Record<NodeType, string> = {
  CAMP: "bg-gray-100 text-gray-700",
  AS: "bg-blue-100 text-blue-700",
  AD: "bg-pink-100 text-pink-700",
};

const CHIP_LABEL: Record<NodeType, string> = {
  CAMP: "CAMP",
  AS: "AS",
  AD: "AD",
};

function formatCompact(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCurrency(n: number | undefined, currency = "USD"): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function formatPct(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

interface DerivedMetrics {
  impressions?: number;
  clicks?: number;
  spend?: number;
  ctr?: number;
  cpm?: number;
  cpc?: number;
}

function derive(impressions?: number, clicks?: number, spend?: number): DerivedMetrics {
  const m: DerivedMetrics = { impressions, clicks, spend };
  if (impressions && impressions > 0) {
    if (clicks !== undefined) m.ctr = (clicks / impressions) * 100;
    if (spend !== undefined) m.cpm = (spend / impressions) * 1000;
  }
  if (clicks && clicks > 0 && spend !== undefined) m.cpc = spend / clicks;
  return m;
}

export default function CampaignDrillTree({ campaigns, currency }: Props) {
  // Auto-detect from campaign data if no explicit currency passed (e.g. from Naming Convention tab)
  const cur = currency || detectCurrency(campaigns);
  const { metaAccessToken } = useAuthStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [renameState, setRenameState] = useState<
    Record<string, "loading" | "success" | { error: string } | undefined>
  >({});

  const toggle = (id: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startEdit = (id: string, currentName: string) => {
    setEditingId(id);
    setDraft((d) => ({ ...d, [id]: currentName }));
  };

  const saveRename = async (id: string, originalName: string) => {
    const newName = (draft[id] ?? originalName).trim();
    if (!newName || newName === originalName) {
      setEditingId(null);
      return;
    }
    setRenameState((s) => ({ ...s, [id]: "loading" }));
    try {
      const r = await fetch("/api/naming/rename/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: metaAccessToken, nodeId: id, newName }),
      });
      const data = await r.json();
      if (r.ok && data.success) {
        setRenameState((s) => ({ ...s, [id]: "success" }));
        setEditingId(null);
        setTimeout(() => setRenameState((s) => {
          const { [id]: _, ...rest } = s;
          return rest;
        }), 3000);
      } else {
        setRenameState((s) => ({ ...s, [id]: { error: data.error || `HTTP ${r.status}` } }));
      }
    } catch (e) {
      setRenameState((s) => ({ ...s, [id]: { error: e instanceof Error ? e.message : "Network error" } }));
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-3 py-2 text-left font-semibold text-gray-700 min-w-[280px]">Campaigns / Ad Sets / Ads</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-700">Impressions</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-700">Clicks</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-700">CTR</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-700">CPM</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-700">CPC</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-700">Spend</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-700 w-24">Action</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-gray-500">No campaigns.</td>
            </tr>
          )}
          {campaigns.map((c) => {
            const cId = c.id;
            const cOpen = expanded.has(cId);
            const adSets = c.adSets || [];
            const cMetrics = derive(c.impressions, c.clicks, c.spend);
            const cur = c.currency || detectCurrency(campaigns);
            return (
              <RowFragment key={`c-${cId}`}>
                <Row
                  indent={0}
                  type="CAMP"
                  hasChildren={adSets.length > 0}
                  expanded={cOpen}
                  onToggle={() => toggle(cId)}
                  id={cId}
                  name={c.name}
                  metrics={cMetrics}
                  currency={cur}
                  editing={editingId === cId}
                  draft={draft[cId]}
                  status={renameState[cId]}
                  onEdit={() => startEdit(cId, c.name)}
                  onCancel={() => setEditingId(null)}
                  onChange={(v) => setDraft((d) => ({ ...d, [cId]: v }))}
                  onSave={() => saveRename(cId, c.name)}
                />
                {cOpen && adSets.map((as) => {
                  const asOpen = expanded.has(as.id);
                  const asMetrics = derive(as.impressions, as.clicks, as.spend);
                  return (
                    <RowFragment key={`as-${as.id}`}>
                      <Row
                        indent={1}
                        type="AS"
                        hasChildren={as.ads.length > 0}
                        expanded={asOpen}
                        onToggle={() => toggle(as.id)}
                        id={as.id}
                        name={as.name}
                        metrics={asMetrics}
                        currency={cur}
                        editing={editingId === as.id}
                        draft={draft[as.id]}
                        status={renameState[as.id]}
                        onEdit={() => startEdit(as.id, as.name)}
                        onCancel={() => setEditingId(null)}
                        onChange={(v) => setDraft((d) => ({ ...d, [as.id]: v }))}
                        onSave={() => saveRename(as.id, as.name)}
                      />
                      {asOpen && as.ads.map((ad) => (
                        <Row
                          key={`ad-${ad.id}`}
                          indent={2}
                          type="AD"
                          hasChildren={false}
                          expanded={false}
                          onToggle={() => {}}
                          id={ad.id}
                          name={ad.name}
                          metrics={{}}
                          currency={cur}
                          editing={editingId === ad.id}
                          draft={draft[ad.id]}
                          status={renameState[ad.id]}
                          onEdit={() => startEdit(ad.id, ad.name)}
                          onCancel={() => setEditingId(null)}
                          onChange={(v) => setDraft((d) => ({ ...d, [ad.id]: v }))}
                          onSave={() => saveRename(ad.id, ad.name)}
                        />
                      ))}
                    </RowFragment>
                  );
                })}
              </RowFragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Inline fragment wrapper to satisfy React key requirements without an extra wrapper element. */
function RowFragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

interface RowProps {
  indent: number;
  type: NodeType;
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
  id: string;
  name: string;
  metrics: DerivedMetrics;
  currency: string;
  editing: boolean;
  draft: string | undefined;
  status: "loading" | "success" | { error: string } | undefined;
  onEdit: () => void;
  onCancel: () => void;
  onChange: (v: string) => void;
  onSave: () => void;
}

function Row({
  indent, type, hasChildren, expanded, onToggle, id, name, metrics, currency,
  editing, draft, status, onEdit, onCancel, onChange, onSave,
}: RowProps) {
  const isError = typeof status === "object";
  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50 align-middle">
        <td className="px-3 py-2.5" style={{ paddingLeft: `${12 + indent * 22}px` }}>
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={hasChildren ? onToggle : undefined}
              className={`shrink-0 ${hasChildren ? "text-gray-500 hover:text-gray-900 cursor-pointer" : "text-transparent cursor-default"}`}
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {hasChildren ? (expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : <ChevronRight className="w-4 h-4 opacity-0" />}
            </button>
            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${CHIP_STYLES[type]}`}>{CHIP_LABEL[type]}</span>
            {editing ? (
              <>
                <input
                  type="text"
                  value={draft ?? name}
                  onChange={(e) => onChange(e.target.value)}
                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
                  autoFocus
                />
                <button
                  onClick={onSave}
                  disabled={status === "loading"}
                  className="shrink-0 px-2 py-1 rounded bg-blue-600 text-white font-semibold text-xs hover:bg-blue-700 disabled:opacity-50"
                >
                  {status === "loading" ? "Saving…" : "Save"}
                </button>
                <button onClick={onCancel} className="shrink-0 px-2 py-1 rounded bg-gray-100 text-gray-700 font-semibold text-xs hover:bg-gray-200">
                  Cancel
                </button>
              </>
            ) : (
              <span className="font-mono text-gray-900 truncate" title={name}>{name}</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5 text-right text-gray-900 whitespace-nowrap">{formatCompact(metrics.impressions)}</td>
        <td className="px-3 py-2.5 text-right text-gray-900 whitespace-nowrap">{formatCompact(metrics.clicks)}</td>
        <td className="px-3 py-2.5 text-right text-gray-900 whitespace-nowrap">{formatPct(metrics.ctr)}</td>
        <td className="px-3 py-2.5 text-right text-gray-900 whitespace-nowrap">{formatCurrency(metrics.cpm, currency)}</td>
        <td className="px-3 py-2.5 text-right text-gray-900 whitespace-nowrap">{formatCurrency(metrics.cpc, currency)}</td>
        <td className="px-3 py-2.5 text-right text-gray-900 whitespace-nowrap font-semibold">{formatCurrency(metrics.spend, currency)}</td>
        <td className="px-3 py-2.5 text-right">
          {!editing && (
            <button
              onClick={onEdit}
              className="px-2 py-1 rounded bg-gray-100 text-gray-700 font-semibold text-xs hover:bg-gray-200"
              title={`Rename this ${type === "CAMP" ? "campaign" : type === "AS" ? "ad set" : "ad"}`}
            >
              Rename
            </button>
          )}
        </td>
      </tr>
      {status === "success" && (
        <tr><td colSpan={8} className="px-3 py-1 bg-green-50 text-green-700 text-[11px]">✓ Renamed in Meta (id {id})</td></tr>
      )}
      {isError && (
        <tr><td colSpan={8} className="px-3 py-1 bg-red-50 text-red-700 text-[11px]">✗ {(status as { error: string }).error}</td></tr>
      )}
    </>
  );
}
