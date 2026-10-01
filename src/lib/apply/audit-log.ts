/**
 * Client-side audit log for Apply actions. Backed by localStorage.
 *
 * No server storage: this is a convenience trail for the user to see what
 * they've changed and offer undo. Keeps the last 200 entries. All localStorage
 * access is wrapped in try/catch (private windows throw on reads/writes).
 */
import type { ApplyAction, ApplyResult } from "./types";

const KEY = "auditor.apply.history";
const MAX_ENTRIES = 200;

export interface AuditLogEntry {
  id: string;
  appliedAt: string;
  action: ApplyAction;
  result: ApplyResult;
  undoneAt?: string;
}

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readAll(): AuditLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuditLogEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: AuditLogEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = entries.slice(0, MAX_ENTRIES);
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // Private windows / quota — swallow.
  }
}

export function logApply(action: ApplyAction, result: ApplyResult): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: uuid(),
    appliedAt: result.appliedAt || new Date().toISOString(),
    action,
    result,
  };
  const existing = readAll();
  writeAll([entry, ...existing]);
  return entry;
}

export function listHistory(limit?: number): AuditLogEntry[] {
  const all = readAll();
  return typeof limit === "number" ? all.slice(0, limit) : all;
}

export function markUndone(id: string): void {
  const all = readAll();
  const updated = all.map((e) =>
    e.id === id ? { ...e, undoneAt: new Date().toISOString() } : e
  );
  writeAll(updated);
}

export function getEntry(id: string): AuditLogEntry | null {
  return readAll().find((e) => e.id === id) ?? null;
}

export function clearHistory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // swallow
  }
}
