import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Zap,
  Play,
  Pause,
  Loader2,
  Check,
  AlertTriangle,
  RotateCcw,
  X,
} from "lucide-react";
import { useAuthStore } from "@/store/auth";
import {
  describeAction,
  actionRisk,
  type ApplyAction,
  type ApplyResult,
} from "@/lib/apply/types";
import { logApply, markUndone } from "@/lib/apply/audit-log";

interface Props {
  action: ApplyAction;
  onApplied?: (result: ApplyResult) => void;
  compact?: boolean;
  disabled?: boolean;
}

const UNDO_WINDOW_MS = 5 * 60 * 1000;

type Phase = "idle" | "confirming" | "applying" | "success" | "error";

function buttonLabel(a: ApplyAction): string {
  switch (a.kind) {
    case "set_status":
      return a.to === "PAUSED" ? "Pause" : "Resume";
    case "set_budget":
      return "Set budget";
    case "set_frequency_cap":
      return "Set frequency cap";
    case "set_device_targeting":
      return "Update targeting";
  }
}

function buttonIcon(a: ApplyAction) {
  if (a.kind === "set_status") {
    return a.to === "PAUSED" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />;
  }
  return <Zap className="h-3.5 w-3.5" />;
}

function reauthLink(platform: "meta" | "dv360"): string {
  return platform === "meta" ? "/api/auth/meta/start" : "/api/auth/google/start";
}

function platformLabel(p: "meta" | "dv360"): string {
  return p === "meta" ? "Meta" : "DV360";
}

function invertAction(a: ApplyAction): ApplyAction {
  const baseId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  switch (a.kind) {
    case "set_budget":
      return { ...a, id: baseId, from: a.to, to: a.from };
    case "set_status":
      return { ...a, id: baseId, from: a.to, to: a.from };
    case "set_frequency_cap":
      // There's no clean inverse of "add a cap" if from was null — restore to
      // a huge-impressions cap as a best-effort "unlimited" fallback.
      return {
        ...a,
        id: baseId,
        from: a.to,
        to: a.from ?? { impressions: 999999, days: a.to.days },
      };
    case "set_device_targeting":
      return { ...a, id: baseId, from: a.to, to: a.from };
  }
}

export default function ApplyActionButton({ action, onApplied, compact, disabled }: Props) {
  const auth = useAuthStore();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [typedConfirm, setTypedConfirm] = useState("");
  const [appliedResult, setAppliedResult] = useState<ApplyResult | null>(null);
  const [lastEntryId, setLastEntryId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const risk = useMemo(() => actionRisk(action), [action]);
  const summary = useMemo(() => describeAction(action), [action]);

  // Tick for undo window countdown.
  useEffect(() => {
    if (!appliedResult) return;
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, [appliedResult]);

  const undoAvailable =
    appliedResult?.success &&
    lastEntryId &&
    now - new Date(appliedResult.appliedAt).getTime() < UNDO_WINDOW_MS;

  const scopeMissing =
    error &&
    (error.includes("Missing ads_management scope") ||
      error.includes("Missing display-video write scope"));

  const closeModal = useCallback(() => {
    setPhase("idle");
    setError(null);
    setTypedConfirm("");
  }, []);

  const runApply = useCallback(
    async (actionToRun: ApplyAction) => {
      setPhase("applying");
      setError(null);

      const url = actionToRun.platform === "meta" ? "/api/apply/meta" : "/api/apply/dv360";
      const body: Record<string, unknown> = { action: actionToRun };
      if (actionToRun.platform === "meta") {
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
          action: actionToRun,
          appliedAt: new Date().toISOString(),
          error: e?.message || "Network error.",
        };
      }

      const entry = logApply(actionToRun, result);
      setLastEntryId(entry.id);
      setAppliedResult(result);

      if (result.success) {
        setPhase("success");
        onApplied?.(result);
        setTimeout(() => setPhase("idle"), 1200);
      } else {
        setError(result.error || "Unknown error.");
        setPhase("error");
      }
    },
    [auth, onApplied]
  );

  const onConfirm = useCallback(() => {
    if (risk === "high" && typedConfirm.trim() !== action.entityName) return;
    void runApply(action);
  }, [action, risk, typedConfirm, runApply]);

  const onUndo = useCallback(async () => {
    const inverse = invertAction(action);
    await runApply(inverse);
    if (lastEntryId) markUndone(lastEntryId);
  }, [action, lastEntryId, runApply]);

  // ─── Rendering ────────────────────────────────────────────────────────────

  const btnBase =
    "inline-flex items-center gap-1.5 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const btnCompact = "px-2.5 py-1 text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200";
  const btnFull = "px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 shadow-sm";

  // Applied + undo-available state on the parent button
  if (appliedResult?.success && phase === "idle") {
    return (
      <div className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
          <Check className="h-3.5 w-3.5" />
          Applied
        </span>
        {undoAvailable && (
          <button
            type="button"
            onClick={() => void onUndo()}
            className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 underline"
          >
            <RotateCcw className="h-3 w-3" />
            Undo
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || phase === "applying"}
        onClick={() => setPhase("confirming")}
        title={summary}
        className={`${btnBase} ${compact ? btnCompact : btnFull}`}
      >
        {phase === "applying" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          buttonIcon(action)
        )}
        {buttonLabel(action)}
      </button>

      {phase !== "idle" && (
        <ConfirmModal
          action={action}
          summary={summary}
          risk={risk}
          phase={phase}
          error={error}
          scopeMissing={!!scopeMissing}
          typedConfirm={typedConfirm}
          onTypedConfirmChange={setTypedConfirm}
          onConfirm={onConfirm}
          onCancel={closeModal}
          onRetry={() => void runApply(action)}
        />
      )}
    </>
  );
}

// ─── Modal ──────────────────────────────────────────────────────────────────

interface ModalProps {
  action: ApplyAction;
  summary: string;
  risk: "low" | "medium" | "high";
  phase: Phase;
  error: string | null;
  scopeMissing: boolean;
  typedConfirm: string;
  onTypedConfirmChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry: () => void;
}

function ConfirmModal({
  action,
  summary,
  risk,
  phase,
  error,
  scopeMissing,
  typedConfirm,
  onTypedConfirmChange,
  onConfirm,
  onCancel,
  onRetry,
}: ModalProps) {
  const riskBadge = {
    low: "bg-green-100 text-green-800 border-green-200",
    medium: "bg-amber-100 text-amber-800 border-amber-200",
    high: "bg-red-100 text-red-800 border-red-200",
  }[risk];

  const confirmEnabled =
    phase === "confirming" &&
    (risk !== "high" || typedConfirm.trim() === action.entityName);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {phase === "success"
                ? "Change applied"
                : phase === "error"
                ? "Couldn't apply change"
                : phase === "applying"
                ? "Applying…"
                : "Apply this change?"}
            </h3>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${riskBadge}`}
              >
                {risk === "high" && <AlertTriangle className="h-3 w-3" />}
                {risk} risk
              </span>
              <span className="text-xs text-slate-500">
                on {action.platform === "meta" ? "Meta" : "DV360"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm font-medium text-slate-900">{summary}</p>

          {action.reason && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Why we recommend this
              </div>
              <div className="mt-1 text-xs text-slate-700">{action.reason}</div>
            </div>
          )}

          {phase === "confirming" && (
            <>
              {risk === "high" && (
                <div>
                  <label className="text-xs font-medium text-slate-700">
                    Type the entity name to confirm:
                  </label>
                  <div className="mt-1 text-[11px] text-slate-500 font-mono">
                    {action.entityName}
                  </div>
                  <input
                    type="text"
                    value={typedConfirm}
                    onChange={(e) => onTypedConfirmChange(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Entity name"
                  />
                </div>
              )}
              <p className="text-xs text-slate-500">
                I understand this applies immediately on{" "}
                {platformLabel(action.platform)} to the live account.
              </p>
            </>
          )}

          {phase === "applying" && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Sending request to {platformLabel(action.platform)}…
            </div>
          )}

          {phase === "success" && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <Check className="h-5 w-5" />
              Change applied successfully.
            </div>
          )}

          {phase === "error" && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-red-900">{error}</div>
                  {scopeMissing && (
                    <a
                      href={reauthLink(action.platform)}
                      className="mt-2 inline-block text-xs font-semibold text-red-700 underline hover:text-red-900"
                    >
                      Reconnect {platformLabel(action.platform)} account →
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          {phase === "confirming" && (
            <>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!confirmEnabled}
                onClick={onConfirm}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Apply change
              </button>
            </>
          )}
          {phase === "error" && (
            <>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Try again
              </button>
            </>
          )}
          {phase === "success" && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
            >
              Done
            </button>
          )}
          {phase === "applying" && (
            <button
              type="button"
              disabled
              className="rounded-lg bg-slate-300 px-3 py-1.5 text-sm font-medium text-white"
            >
              Applying…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
