/**
 * Convert the dashboard's `DateRange` selector value into concrete ISO
 * (YYYY-MM-DD) start/end dates that backend endpoints understand.
 *
 * Pulled out so every campaigns-fetching tab (AccountStructure, Naming,
 * AuditTabShell-driven Audience/Creative/Platform audits, etc.) shares one
 * source of truth. Mirrors the same calculation already used inside
 * `useAudit()` so audit + campaign tabs stay aligned on the selected window.
 */
export function rangeToDates(
  range: string,
  customStart?: string,
  customEnd?: string
): { startDate: string; endDate: string } {
  if (range === "custom" && customStart && customEnd) {
    return { startDate: customStart, endDate: customEnd };
  }
  const today = new Date();
  const start = new Date(today);
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  start.setDate(today.getDate() - days);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: today.toISOString().slice(0, 10),
  };
}
