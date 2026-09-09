/**
 * Meta Quota chip — small pill showing the currently connected Meta ad
 * account's live throttle usage percentage. Updated as endpoints return
 * their `metaQuota` field (populated from Meta's X-Business-Use-Case-Usage
 * header). Color codes:
 *   < 70% → green (healthy)
 *   70-85% → amber (near wall)
 *   > 85% → red (throttled or imminent)
 *
 * If no data yet or account not connected, renders nothing (returns null).
 */

import { useAuthStore } from "@/store/auth";
import { Activity } from "lucide-react";

export default function MetaQuotaChip() {
  const metaBusinessId = useAuthStore((s) => s.metaBusinessId);
  const metaQuota = useAuthStore((s) => s.metaQuota);

  if (!metaBusinessId) return null;
  const acctId = metaBusinessId.startsWith("act_") ? metaBusinessId : `act_${metaBusinessId}`;
  const q = metaQuota[acctId];
  if (!q) return null;

  const peak = Math.max(q.callPct, q.cpuPct, q.timePct);
  const color =
    peak >= 85
      ? "bg-red-50 text-red-700 border-red-200"
      : peak >= 70
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-emerald-50 text-emerald-700 border-emerald-200";

  const tooltip = `Meta API quota for ${acctId}\n` +
    `call_count: ${q.callPct}%\n` +
    `total_cputime: ${q.cpuPct}%\n` +
    `total_time: ${q.timePct}%` +
    (q.estCooldownSec > 0 ? `\nMeta estimated recovery: ~${q.estCooldownSec}s` : "");

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${color}`}
    >
      <Activity className="w-3 h-3" />
      Meta {peak}%
    </span>
  );
}
