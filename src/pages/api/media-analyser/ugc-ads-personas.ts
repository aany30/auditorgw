/**
 * Saved UGC personas -- a reusable library of characters the user creates once and
 * drops into many reels. Backed by Neon (serverless Postgres) when DATABASE_URL is
 * set; falls back to Supabase if only that's configured; else every response carries
 * `persisted: false` so the client uses browser localStorage.
 *
 *   GET    -> { personas, persisted }
 *   POST   -> { persona, persisted }      (body = the persona to save)
 *   PATCH  -> { persona, persisted }      (body = { id, ...patch })
 *   DELETE -> { ok, persisted }           (?id=<persona id>)
 */

import type { NextApiRequest, NextApiResponse } from "next";
import {
  deletePersona as sbDelete,
  fetchPersonas as sbFetch,
  savePersona as sbSave,
  updatePersona as sbUpdate,
  supabaseConfigured,
  type PersonaRecord,
} from "@/lib/media-analyser/supabase";
import {
  neonConfigured, neonFetchPersonas, neonSavePersona, neonUpdatePersona, neonDeletePersona,
} from "@/lib/media-analyser/neon-personas";

export const config = { maxDuration: 30 };

const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

// Persistence backend: Neon first, then Supabase, else localStorage (persisted:false).
const backend = (): "neon" | "supabase" | null => neonConfigured() ? "neon" : supabaseConfigured() ? "supabase" : null;
const fetchAll = () => backend() === "neon" ? neonFetchPersonas() : backend() === "supabase" ? sbFetch() : Promise.resolve([]);
const saveOne = (p: Omit<PersonaRecord, "id" | "created_at">) => backend() === "neon" ? neonSavePersona(p) : sbSave(p);
const updateOne = (id: string, patch: Partial<Pick<PersonaRecord, "name" | "images">>) => backend() === "neon" ? neonUpdatePersona(id, patch) : sbUpdate(id, patch);
const deleteOne = (id: string) => backend() === "neon" ? neonDeletePersona(id) : sbDelete(id);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const persisted = backend() !== null;
    const personas = persisted ? await fetchAll() : [];
    return res.status(200).json({ personas, persisted });
  }

  if (req.method === "POST") {
    const persisted = backend() !== null;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const name = str(body.name, 80) || "Untitled persona";
    const style = str(body.style, 20) === "animated" ? "animated" : "real";
    const rawImages = Array.isArray(body.images) ? body.images : [];
    const images = rawImages
      .map(v => String(v ?? ""))
      .filter(v => v.startsWith("data:"))
      .slice(0, 8);

    if (!images.length) {
      return res.status(400).json({ error: "A persona needs at least one image." });
    }

    const persona: Omit<PersonaRecord, "id" | "created_at"> = {
      name,
      style,
      animated_style: str(body.animatedStyle, 200) || null,
      archetype: str(body.archetype, 200) || null,
      source: str(body.source, 20) || "create",
      traits: (body.traits && typeof body.traits === "object" ? body.traits : null) as Record<string, unknown> | null,
      details: str(body.details, 600) || null,
      product_context: (body.productContext && typeof body.productContext === "object" ? body.productContext : null) as Record<string, unknown> | null,
      images,
    };

    if (!persisted) {
      return res.status(200).json({ persona: { ...persona, id: crypto.randomUUID(), created_at: new Date().toISOString() }, persisted: false });
    }

    const result = await saveOne(persona);
    if (!result.ok) return res.status(502).json({ error: result.error ?? "Could not save persona." });
    return res.status(200).json({ persona: result.persona, persisted: true });
  }

  if (req.method === "PATCH") {
    const persisted = backend() !== null;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = str(body.id, 80);
    if (!id) return res.status(400).json({ error: "Missing persona id." });

    const patch: Partial<Pick<PersonaRecord, "name" | "images">> = {};
    if (typeof body.name === "string") patch.name = str(body.name, 80) || "Untitled persona";
    if (Array.isArray(body.images)) {
      patch.images = body.images.map(v => String(v ?? "")).filter(v => v.startsWith("data:")).slice(0, 8);
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to update." });

    if (!persisted) return res.status(200).json({ persona: { id, ...patch }, persisted: false });

    const result = await updateOne(id, patch);
    if (!result.ok) return res.status(502).json({ error: result.error ?? "Could not update persona." });
    return res.status(200).json({ persona: result.persona, persisted: true });
  }

  if (req.method === "DELETE") {
    const persisted = backend() !== null;
    const id = (req.query.id as string) ?? "";
    if (!id) return res.status(400).json({ error: "Missing persona id." });
    if (!persisted) return res.status(200).json({ ok: true, persisted: false });
    const result = await deleteOne(id);
    if (!result.ok) return res.status(502).json({ error: result.error ?? "Could not delete persona." });
    return res.status(200).json({ ok: true, persisted: true });
  }

  return res.status(405).end();
}
