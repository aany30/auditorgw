import type { AnalysisResponse, CombinedScraperData } from "./types";

export interface ScanMeta {
  project_id?: string | null;
  product_url?: string | null;
  asin?: string | null;
  scope?: string;
  product_name?: string | null;
  brand?: string | null;
  thumbnail_url?: string | null;
}

export interface ScanRecord {
  id: string;
  project_id?: string | null;
  product_url?: string | null;
  asin?: string | null;
  scope?: string;
  status?: string;
  brief?: Record<string, unknown> | null;
  product_name?: string | null;
  brand?: string | null;
  thumbnail_url?: string | null;
  created_at?: string;
}

/** The input that produced a generation batch — shown alongside the output in history. */
export interface GenerationInput {
  prompt?: string;
  description?: string;
  productUrl?: string;
  aspect?: string;
  imageModel?: string;
  videoModel?: string;
  /** Small (~200px) thumbnails of the uploaded reference/product images — never raw full-size base64. */
  referenceThumbnails?: string[];
}

export interface GenerationBatch {
  id: string;
  scan_id?: string | null;
  mode: string;
  product_name?: string | null;
  brand?: string | null;
  result_count: number;
  thumbnail_url?: string | null;
  results?: unknown[] | null;
  input?: GenerationInput | null;
  dna_confidence?: string | null;
  created_at?: string;
}

function getSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

async function supabaseRest(
  table: string,
  method: string,
  query: string,
  body?: unknown,
  timeoutMs = 8000,
): Promise<unknown> {
  const config = getSupabaseConfig();
  if (!config) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.");

  const endpoint = `${config.url}/rest/v1/${table}${query}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method,
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const raw = await res.text();
    // PostgREST returns an error BODY (not an array/representation) on 4xx/5xx.
    // Without this guard, an error body is treated as data — writes look like
    // they succeeded and reads silently return [] (e.g. missing table/column).
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${raw.slice(0, 300)}`);
    return raw ? JSON.parse(raw) : null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Scans ────────────────────────────────────────────────────────────────────

export async function fetchRecentScans(limit = 20): Promise<ScanRecord[]> {
  try {
    // Lightweight list — do NOT pull the full `brief`/`payload` here (can be MBs per
    // row). The detail page fetches the full record on demand via fetchScanById().
    const cols = "id,project_id,product_url,asin,scope,status,product_name,brand,thumbnail_url,created_at";
    const result = await supabaseRest(
      "analytics_scans",
      "GET",
      `?select=${cols}&order=created_at.desc&limit=${limit}`,
    );
    return (Array.isArray(result) ? result : []) as ScanRecord[];
  } catch {
    return [];
  }
}

/** Full scan record (brief + raw payload) for the history detail view. */
export async function fetchScanById(
  id: string,
): Promise<(ScanRecord & { payload?: Record<string, unknown> | null }) | null> {
  try {
    // Pull the brief (full analysis) — not `payload` (raw scraper dump, unused here).
    const cols = "id,project_id,product_url,asin,scope,status,brief,product_name,brand,thumbnail_url,created_at";
    const result = await supabaseRest(
      "analytics_scans",
      "GET",
      `?id=eq.${encodeURIComponent(id)}&select=${cols}&limit=1`,
      undefined,
      15000, // the brief carries the whole analysis — give it room
    );
    const row = Array.isArray(result) ? result[0] : null;
    return (row ?? null) as (ScanRecord & { payload?: Record<string, unknown> | null }) | null;
  } catch (e) {
    console.error("[supabase] fetchScanById failed:", String(e));
    return null;
  }
}

/** Overwrite a scan's `brief` (used by the deep-scrape backfill to merge in more ads).
 *  Direct fetch (NOT supabaseRest) so we can use Prefer:return=minimal — a big-brand brief
 *  is ~15-20 MB and echoing it back (return=representation) would double the transfer and
 *  blow the timeout. Returns the error string so callers can surface WHY a save failed. */
export async function updateScanBrief(id: string, brief: unknown): Promise<{ ok: boolean; error?: string }> {
  const config = getSupabaseConfig();
  if (!config) return { ok: false, error: "supabase not configured" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180000);
  try {
    const res = await fetch(`${config.url}/rest/v1/analytics_scans?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ brief }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const msg = `HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
      console.error("[supabase] updateScanBrief failed:", msg);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    console.error("[supabase] updateScanBrief failed:", msg);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function saveScan(
  meta: ScanMeta,
  _payload: CombinedScraperData, // no longer persisted (see below) — kept for call-site compat
  result: AnalysisResponse
): Promise<boolean> {
  const config = getSupabaseConfig();
  if (!config) return true; // persistence not configured — not a failure
  try {
    await supabaseRest("analytics_scans", "POST", "", {
      project_id: meta.project_id ?? null,
      product_url: meta.product_url ?? null,
      asin: meta.asin ?? null,
      scope: meta.scope ?? "ecom",
      product_name: meta.product_name ?? null,
      brand: meta.brand ?? null,
      thumbnail_url: meta.thumbnail_url ?? null,
      // The raw scraper `payload` is NEVER read back (getScanById pulls only `brief`), so we
      // no longer persist it — for a big multi-thousand-ad run it doubled the row size and
      // risked the insert being rejected. Everything the UI needs is in `brief`.
      payload: null,
      brief: result,
      status: "analyzed",
    });
    return true;
  } catch (e) {
    // Persistence is best-effort, but log the real reason so failures aren't invisible.
    console.error("[supabase] saveScan failed:", String(e));
    return false;
  }
}

// ── Generation batches ───────────────────────────────────────────────────────

export async function fetchRecentGenerations(limit = 20): Promise<GenerationBatch[]> {
  try {
    const cols = "id,scan_id,mode,product_name,brand,result_count,thumbnail_url,dna_confidence,created_at,results,input";
    const result = await supabaseRest(
      "generation_batches",
      "GET",
      `?select=${cols}&order=created_at.desc&limit=${limit}`,
    );
    return (Array.isArray(result) ? result : []) as GenerationBatch[];
  } catch {
    return [];
  }
}

export async function saveGenerationBatch(
  batch: Omit<GenerationBatch, "id" | "created_at">
): Promise<{ ok: boolean; error?: string }> {
  const config = getSupabaseConfig();
  if (!config) return { ok: false, error: "Supabase not configured" };
  try {
    await supabaseRest("generation_batches", "POST", "", batch);
    return { ok: true };
  } catch (e) {
    // Return the real reason so the API route can surface it (and we can diagnose).
    const error = String(e);
    console.error("[supabase] saveGenerationBatch failed:", error);
    return { ok: false, error };
  }
}

// ── UGC personas (saved, reusable characters) ─────────────────────────────────
//
// A saved character/persona the user can reuse across many reels. `images` holds
// compressed JPEG data URLs (anchor first, then any on-demand angle shots), so a
// small library is a handful of MB of base64 — acceptable inline in a jsonb column.
// Requires a `ugc_personas` table:
//   create table ugc_personas (
//     id uuid primary key default gen_random_uuid(),
//     name text, style text, animated_style text, archetype text, source text,
//     traits jsonb, details text, product_context jsonb, images jsonb,
//     created_at timestamptz default now()
//   );

export interface PersonaRecord {
  id: string;
  name: string;
  style: string;                 // "real" | "animated"
  animated_style?: string | null;
  archetype?: string | null;
  source?: string | null;        // "create" | "upload" | "reference"
  traits?: Record<string, unknown> | null;
  details?: string | null;
  product_context?: Record<string, unknown> | null;
  images: string[];              // data URLs — anchor first
  created_at?: string;
}

/** True when Supabase persistence is configured (drives the localStorage fallback). */
export function supabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

export async function fetchPersonas(limit = 60): Promise<PersonaRecord[]> {
  try {
    const cols = "id,name,style,animated_style,archetype,source,traits,details,product_context,images,created_at";
    const result = await supabaseRest(
      "ugc_personas",
      "GET",
      `?select=${cols}&order=created_at.desc&limit=${limit}`,
      undefined,
      15000, // images are inline base64 — give the read room
    );
    return (Array.isArray(result) ? result : []) as PersonaRecord[];
  } catch (e) {
    console.error("[supabase] fetchPersonas failed:", String(e));
    return [];
  }
}

export async function savePersona(
  persona: Omit<PersonaRecord, "id" | "created_at"> & { id?: string },
): Promise<{ ok: boolean; persona?: PersonaRecord; error?: string }> {
  const config = getSupabaseConfig();
  if (!config) return { ok: false, error: "Supabase not configured" };
  try {
    const rows = await supabaseRest("ugc_personas", "POST", "", persona, 20000);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { ok: true, persona: (row ?? undefined) as PersonaRecord | undefined };
  } catch (e) {
    const error = String(e);
    console.error("[supabase] savePersona failed:", error);
    return { ok: false, error };
  }
}

/** Patch a persona's mutable fields (name / images). Used by rename + add-angles. */
export async function updatePersona(
  id: string,
  patch: Partial<Pick<PersonaRecord, "name" | "images">>,
): Promise<{ ok: boolean; persona?: PersonaRecord; error?: string }> {
  const config = getSupabaseConfig();
  if (!config) return { ok: false, error: "Supabase not configured" };
  try {
    const rows = await supabaseRest("ugc_personas", "PATCH", `?id=eq.${encodeURIComponent(id)}`, patch, 20000);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { ok: true, persona: (row ?? undefined) as PersonaRecord | undefined };
  } catch (e) {
    const error = String(e);
    console.error("[supabase] updatePersona failed:", error);
    return { ok: false, error };
  }
}

export async function deletePersona(id: string): Promise<{ ok: boolean; error?: string }> {
  const config = getSupabaseConfig();
  if (!config) return { ok: false, error: "Supabase not configured" };
  try {
    await supabaseRest("ugc_personas", "DELETE", `?id=eq.${encodeURIComponent(id)}`);
    return { ok: true };
  } catch (e) {
    const error = String(e);
    console.error("[supabase] deletePersona failed:", error);
    return { ok: false, error };
  }
}
