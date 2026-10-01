/**
 * Client-side saved-persona store. Talks to /api/ugc-ads/personas, which is backed
 * by Supabase when configured. When it isn't (the route replies `persisted: false`),
 * we transparently fall back to browser localStorage so the "save & reuse" feature
 * still works with zero backend — just scoped to this browser.
 */

import type { CharacterStyle } from "@/lib/media-analyser/ugc/character-prompt";

export interface UGCPersona {
  id: string;
  name: string;
  style: CharacterStyle;
  animatedStyle?: string;
  archetype?: string;
  source?: string;               // "create" | "upload" | "reference"
  images: string[];              // data URLs — anchor first
  createdAt?: string;
}

/** The shape we POST to save a persona. */
export interface NewPersona {
  name: string;
  style: CharacterStyle;
  animatedStyle?: string;
  archetype?: string;
  source?: string;
  images: string[];
  traits?: Record<string, unknown>;
  details?: string;
  productContext?: Record<string, unknown>;
}

const LS_KEY = "ugc_personas_v1";

/** Map the API/DB record (snake_case) to the client persona type. */
function fromRecord(r: Record<string, unknown>): UGCPersona {
  const imgs = Array.isArray(r.images) ? (r.images as unknown[]).map(String) : [];
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? "Untitled persona"),
    style: String(r.style ?? "real") === "animated" ? "animated" : "real",
    animatedStyle: r.animated_style ? String(r.animated_style) : undefined,
    archetype: r.archetype ? String(r.archetype) : undefined,
    source: r.source ? String(r.source) : undefined,
    images: imgs,
    createdAt: r.created_at ? String(r.created_at) : undefined,
  };
}

function readLocal(): UGCPersona[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
    return Array.isArray(arr) ? (arr as UGCPersona[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: UGCPersona[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // Quota exceeded (base64 images are heavy) — drop the oldest and retry once.
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, Math.max(1, list.length - 1))));
    } catch { /* give up silently */ }
  }
}

/** Merge server + local persona lists, deduped by id (server wins), newest first. */
function mergeDedupe(remote: UGCPersona[], local: UGCPersona[]): UGCPersona[] {
  const byId = new Map<string, UGCPersona>();
  for (const p of local) if (p.id) byId.set(p.id, p);
  for (const p of remote) if (p.id) byId.set(p.id, p); // server record wins on conflict
  return Array.from(byId.values()).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/**
 * List saved personas. ALWAYS merges the server list with this browser's localStorage
 * copy — so personas never appear to vanish when the server list is empty, flaky, or was
 * populated before Supabase was configured. (The previous version returned ONLY the server
 * list whenever `persisted` was true, which silently dropped every locally-saved persona.)
 */
export async function listPersonas(): Promise<UGCPersona[]> {
  const local = readLocal();
  try {
    const res = await fetch("/api/ugc-ads/personas", { method: "GET", cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { personas?: Record<string, unknown>[]; persisted?: boolean };
    if (res.ok && data.persisted && Array.isArray(data.personas)) {
      return mergeDedupe(data.personas.map(fromRecord), local);
    }
  } catch { /* fall through to local */ }
  return local;
}

/** Save a persona; returns the stored persona (with id). Never loses the save — always
 *  keeps a browser copy, and if the server save fails it persists locally instead of throwing. */
export async function savePersona(input: NewPersona): Promise<UGCPersona> {
  try {
    const res = await fetch("/api/ugc-ads/personas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as { persona?: Record<string, unknown>; error?: string };
    if (res.ok && data.persona) {
      const persona = fromRecord(data.persona);
      // Always keep a local copy too, so it survives an empty/flaky server list.
      writeLocal([persona, ...readLocal().filter(p => p.id !== persona.id)]);
      return persona;
    }
    throw new Error(data.error ?? "Could not save persona.");
  } catch {
    // Server save failed — persist to this browser so the user never loses the persona.
    const persona: UGCPersona = {
      id: (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `local-${readLocal().length}-${input.name}`),
      name: input.name.trim() || "Untitled persona",
      style: input.style,
      animatedStyle: input.animatedStyle,
      archetype: input.archetype,
      source: input.source,
      images: input.images,
      createdAt: new Date().toISOString(),
    };
    writeLocal([persona, ...readLocal().filter(p => p.id !== persona.id)]);
    return persona;
  }
}

/** Delete a saved persona. */
export async function removePersona(id: string): Promise<void> {
  try {
    await fetch(`/api/ugc-ads/personas?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch { /* ignore network error; still update local */ }
  writeLocal(readLocal().filter(p => p.id !== id));
}

/** Patch a persona's name and/or images (stable id). Returns the updated persona. */
async function patchPersona(id: string, patch: { name?: string; images?: string[] }): Promise<UGCPersona | null> {
  let persona: UGCPersona | null = null;
  try {
    const res = await fetch("/api/ugc-ads/personas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    const data = (await res.json().catch(() => ({}))) as { persona?: Record<string, unknown>; persisted?: boolean; error?: string };
    if (res.ok && data.persisted && data.persona) return fromRecord(data.persona);
    if (!res.ok) throw new Error(data.error ?? "Could not update persona.");
  } catch { /* fall through to local */ }
  // Not persisted (or network failed) — update the localStorage copy in place.
  const list = readLocal();
  const next = list.map(p => (p.id === id ? { ...p, ...patch } as UGCPersona : p));
  writeLocal(next);
  persona = next.find(p => p.id === id) ?? null;
  return persona;
}

/** Rename a saved persona. */
export async function renamePersona(id: string, name: string): Promise<UGCPersona | null> {
  return patchPersona(id, { name: name.trim() || "Untitled persona" });
}

/** Append newly generated angle images to a saved persona (stable id). */
export async function appendPersonaImages(persona: UGCPersona, newImages: string[]): Promise<UGCPersona> {
  const images = [...persona.images, ...newImages].slice(0, 8);
  const updated = await patchPersona(persona.id, { images });
  return updated ?? { ...persona, images };
}
