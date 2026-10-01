/**
 * Saved UGC personas — Neon (serverless Postgres) data layer.
 *
 * Uses the Neon HTTP driver (@neondatabase/serverless), which works in Vercel's
 * serverless/edge runtimes without a connection pool. Configured via DATABASE_URL
 * (or NEON_DATABASE_URL). Table: `ugc_personas` (see supabase.ts for the schema).
 * When DATABASE_URL is unset the route falls back to browser localStorage.
 */
import { neon } from "@neondatabase/serverless";
import type { PersonaRecord } from "@/lib/media-analyser/supabase";

function db() {
  const url = (process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "").trim();
  if (!url) return null;
  return neon(url);
}

export function neonConfigured(): boolean {
  return !!(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL);
}

/** List saved personas, newest first. */
export async function neonFetchPersonas(limit = 60): Promise<PersonaRecord[]> {
  const sql = db();
  if (!sql) return [];
  try {
    const rows = await sql`
      select id, name, style, animated_style, archetype, source, traits, details, product_context, images, created_at
      from ugc_personas order by created_at desc limit ${limit}`;
    return rows as PersonaRecord[];
  } catch (e) {
    console.error("[neon] fetchPersonas failed:", String(e));
    return [];
  }
}

/** Insert a persona; returns the stored row. */
export async function neonSavePersona(
  p: Omit<PersonaRecord, "id" | "created_at">,
): Promise<{ ok: boolean; persona?: PersonaRecord; error?: string }> {
  const sql = db();
  if (!sql) return { ok: false, error: "Neon not configured" };
  try {
    const rows = await sql`
      insert into ugc_personas (name, style, animated_style, archetype, source, traits, details, product_context, images)
      values (
        ${p.name}, ${p.style}, ${p.animated_style ?? null}, ${p.archetype ?? null}, ${p.source ?? null},
        ${p.traits ? JSON.stringify(p.traits) : null}::jsonb, ${p.details ?? null},
        ${p.product_context ? JSON.stringify(p.product_context) : null}::jsonb, ${JSON.stringify(p.images)}::jsonb
      )
      returning id, name, style, animated_style, archetype, source, traits, details, product_context, images, created_at`;
    return { ok: true, persona: rows[0] as PersonaRecord };
  } catch (e) {
    console.error("[neon] savePersona failed:", String(e));
    return { ok: false, error: String(e) };
  }
}

/** Patch a persona's name and/or images. */
export async function neonUpdatePersona(
  id: string,
  patch: Partial<Pick<PersonaRecord, "name" | "images">>,
): Promise<{ ok: boolean; persona?: PersonaRecord; error?: string }> {
  const sql = db();
  if (!sql) return { ok: false, error: "Neon not configured" };
  try {
    let rows;
    if (patch.name !== undefined && patch.images !== undefined) {
      rows = await sql`update ugc_personas set name=${patch.name}, images=${JSON.stringify(patch.images)}::jsonb where id=${id}::uuid
        returning id, name, style, animated_style, archetype, source, traits, details, product_context, images, created_at`;
    } else if (patch.name !== undefined) {
      rows = await sql`update ugc_personas set name=${patch.name} where id=${id}::uuid
        returning id, name, style, animated_style, archetype, source, traits, details, product_context, images, created_at`;
    } else if (patch.images !== undefined) {
      rows = await sql`update ugc_personas set images=${JSON.stringify(patch.images)}::jsonb where id=${id}::uuid
        returning id, name, style, animated_style, archetype, source, traits, details, product_context, images, created_at`;
    } else {
      return { ok: false, error: "Nothing to update." };
    }
    if (!rows[0]) return { ok: false, error: "Persona not found." };
    return { ok: true, persona: rows[0] as PersonaRecord };
  } catch (e) {
    console.error("[neon] updatePersona failed:", String(e));
    return { ok: false, error: String(e) };
  }
}

/** Delete a persona by id. */
export async function neonDeletePersona(id: string): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  if (!sql) return { ok: false, error: "Neon not configured" };
  try {
    await sql`delete from ugc_personas where id=${id}::uuid`;
    return { ok: true };
  } catch (e) {
    console.error("[neon] deletePersona failed:", String(e));
    return { ok: false, error: String(e) };
  }
}
