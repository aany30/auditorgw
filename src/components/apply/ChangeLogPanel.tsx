import { useState, useEffect, useCallback, useMemo } from "react";
import { Check, X, RotateCcw, Download, Trash2, AlertTriangle } from "lucide-react";
import {
  listHistory,
  markUndone,
  clearHistory,
  logApply,
  type AuditLogEntry,
} from "@/lib/apply/audit-log";
import { describeAction, type ApplyAction, type ApplyResult } from "@/lib/apply/types";
import { useAuthStore } from "@/store/auth";

const UNDO_WINDOW_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;

function relativeTime(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  const diff = now - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (diff < 2 * 86_400_000) {
    const d = new Date(t);
    return `Yesterday ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  const d = new Date(t);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function invertAction(a: ApplyAction): ApplyAction {
  const newId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  switch (a.kind) {
    case "set_budget":
      return { ...a, id: newId, from: a.to, to: a.from };
    case "set_status":
      return { ...a, id: newId, from: a.to, to: a.from };
    case "set_frequency_cap":
      return { ...a, id: newId, from: a.to, to: a.from ?? { impressions: 999999, days: a.to.days } };
    case "set_device_targeting":
      return { ...a, id: newId, from: a.to, to: a.from };
  }
}

function toCsv(entries: AuditLogEntry[]): string {
  const header = [
    "appliedAt",
    "platform",
    "entityType",
    "entityId",
    "entityName",
    "actionKind",
    "summary",
    "status",
    "error",
    "undoneAt",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = entries.map((e) =>
    [
      e.appliedAt,
      e.action.platform,
      e.action.entityType,
      e.action.entityId,
      e.action.entityName,
      e.action.kind,
      describeAction(e.action),
      e.undoneAt ? "undone" : e.result.success ? "applied" : "failed",
      e.result.error ?? "",
      e.undoneAt ?? "",
    ]
      .map(esc)
      .join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

export default function ChangeLogPanel() {
  const auth = useAuthStore();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [now, setNow] = useState(Date.now());
  const [confirmClear, setConfirmClear] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setEntries(listHistory());
    setNow(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const onUndo = useCallback(
    async (entry: AuditLogEntry) => {
      setUndoingId(entry.id);
      const inverse = invertAction(entry.action);
      const url = inverse.platform === "meta" ? "/api/apply/meta" : "/api/apply/dv360";
      const body: Record<string, unknown> = { action: inverse };
      if (inverse.platform === "meta") {
        if (auth.metaAccessToken) body.accessToken = auth.metaAccessToken;
        if (auth.metaBusinessId) body.businessId = auth.metaBusinessId;
      } else {
        if (auth.dv360ClientId) body.clientId = auth.dv360ClientId;
        if (auth.dv360ClientSecret) body.clientSecret = auth.dv360ClientSecret;
        if (auth.dv360RefreshToken) body.refreshToken = auth.dv360RefreshToken;
        if (auth.dv360AdvertiserId) body.advertiserId = auth.dv360AdvertiserId;
      }
      let result: ApplyResult;
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        result = (await r.json()) as ApplyResult;
      } catch (e: any) {
        result = {
          success: false,
          action: inverse,
          appliedAt: new Date().toISOString(),
          error: e?.message || "Network error.",
        };
      }
      logApply(inverse, result);
      if (result.success) markUndone(entry.id);
      setUndoingId(null);
      refresh();
    },
    [auth, refresh]
  );

  const onExport = useCallback(() => {
    const csv = toCsv(entries);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apply-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [entries]);

  const onClear = useCallback(() => {
    clearHistory();
    setConfirmClear(false);
    refresh();
  }, [refresh]);

  const hasEntries = entries.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Change Log</h2>
          <p className="mt-1 text-sm text-slate-600">
            History of recommendations applied to Meta and DV360. Changes within 5 minutes can be undone.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onExport}
            disabled={!hasEntries}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            disabled={!hasEntries}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Clear history
          </button>
        </div>
      </div>

      {confirmClear && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <div className="text-sm text-red-900">
            Clear all {entries.length} log entries? This cannot be undone (the changes themselves remain applied).
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="rounded-lg px-3 py-1 text-sm text-slate-700 hover:bg-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {!hasEntries ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <div className="text-sm text-slate-500">No changes have been applied yet.</div>
          <div className="mt-1 text-xs text-slate-400">
            When you apply an AI recommendation, it will show up here.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {entries.map((entry) => {
            const applied = entry.result.success;
            const undone = !!entry.undoneAt;
            const age = now - new Date(entry.appliedAt).getTime();
            const canUndo = applied && !undone && age < UNDO_WINDOW_MS;
            return (
              <div key={entry.id} className="flex items-start gap-4 px-5 py-4">
                <div className="mt-0.5 flex-shrink-0">
                  {undone ? (
                    <RotateCcw className="h-5 w-5 text-slate-500" />
                  ) : applied ? (
                    <Check className="h-5 w-5 text-green-600" />
                  ) : (
                    <X className="h-5 w-5 text-red-600" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        entry.action.platform === "meta"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-purple-100 text-purple-800"
                      }`}
                    >
                      {entry.action.platform === "meta" ? "Meta" : "DV360"}
                    </span>
                    <span className="text-xs text-slate-500">
                      {relativeTime(entry.appliedAt, now)}
                    </span>
                    <span
                      className={`text-[11px] font-semibold uppercase ${
                        undone
                          ? "text-slate-500"
                          : applied
                          ? "text-green-700"
                          : "text-red-700"
                      }`}
                    >
                      {undone ? "Undone" : applied ? "Applied" : "Failed"}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-900">
                    {describeAction(entry.action)}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {entry.action.entityType.replace("_", " ")}: {entry.action.entityName}
                  </div>
                  {!applied && entry.result.error && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-800">
                      <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                      <span>{entry.result.error}</span>
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0">
                  {canUndo && (
                    <button
                      type="button"
                      onClick={() => void onUndo(entry)}
                      disabled={undoingId === entry.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {undoingId === entry.id ? "Undoing…" : "Undo"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
