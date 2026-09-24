/**
 * LinkedIn organic company-posts fetch (Apify · apimaestro/linkedin-company-posts, no cookies).
 * Returns raw post objects (text, posted_at, post_type, author, stats, media) for the
 * linkedin-report model. Never throws — returns [] on any failure so it can't break a run.
 */
import { getApifyToken, startApifyRun, getApifyRunStatus, fetchApifyDatasetRaw } from "./meta-social";

const LINKEDIN_ACTOR = "apimaestro/linkedin-company-posts";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Brand name → LinkedIn company vanity ("Nasher Miles" → "nasher-miles"). */
function toVanity(brand: string): string {
  return brand.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Resolve a brand name OR a pasted LinkedIn company URL → the company vanity slug. */
function resolveVanity(input: string): string {
  const m = input.match(/linkedin\.com\/(?:company|school|showcase)\/([^/?#\s]+)/i);
  if (m) return m[1].toLowerCase();
  return toVanity(input);
}

export function linkedInEnabled(): boolean {
  return process.env.LINKEDIN_ENABLED === "true" && !!getApifyToken();
}

export async function fetchLinkedInPosts(brandOrUrl: string, limit = 100): Promise<Record<string, unknown>[]> {
  const token = getApifyToken();
  if (!token || !brandOrUrl.trim()) return [];
  const vanity = resolveVanity(brandOrUrl);
  try {
    const { runId, datasetId } = await startApifyRun(token, LINKEDIN_ACTOR, { company_name: vanity, limit, page_number: 1, sort: "recent" }, 1024);
    if (!datasetId || !runId) return [];
    const waitMs = (parseInt(process.env.LINKEDIN_WAIT_SECS ?? "150", 10) || 150) * 1000;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(4000);
      let status: string;
      try { status = (await getApifyRunStatus(token, runId)).status; } catch { continue; }
      if (status === "SUCCEEDED") break;
      if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") return [];
    }
    const items = await fetchApifyDatasetRaw(datasetId, limit);
    // apimaestro emits a single {message:"No posts found…"} stub when a page is empty — drop it.
    return items.filter(it => !(it && typeof it === "object" && "message" in it && !("text" in it)));
  } catch (e) {
    console.error(`[linkedin] fetch failed for "${brandOrUrl}": ${e instanceof Error ? e.message : e}`);
    return [];
  }
}
