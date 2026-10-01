/**
 * UGC New — Firecrawl research (ported from the source pipeline's firecrawl.ts):
 * scrape the product page + search competitors and ad-style references. Best-effort;
 * returns "" on any failure so the brief still generates from the product description.
 */
const MAX_SCRAPE_CHARS = 2000;

function key(): string { return process.env.FIRECRAWL_API_KEY ?? ""; }

/** v2 scrape → markdown (48h cache), capped. */
export async function firecrawlScrape(url: string): Promise<string> {
  if (!key() || !url) return "";
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, maxAge: 172_800_000 }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { data?: { markdown?: string } };
    return (data.data?.markdown ?? "").slice(0, MAX_SCRAPE_CHARS);
  } catch { return ""; }
}

export interface ResearchSource { title?: string; url?: string; snippet?: string; markdown?: string }

/** v1 search (+ optional scrape of the top N results). */
export async function researchTopic(query: string, limit = 4, scrapeCount = 0): Promise<ResearchSource[]> {
  if (!key() || !query.trim()) return [];
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { title?: string; url?: string; description?: string }[] };
    const sources: ResearchSource[] = (data.data ?? []).slice(0, limit).map(s => ({ title: s.title, url: s.url, snippet: s.description }));
    for (let i = 0; i < Math.min(scrapeCount, sources.length); i++) {
      if (sources[i].url) sources[i].markdown = await firecrawlScrape(sources[i].url!);
    }
    return sources;
  } catch { return []; }
}

/** Render sources under a heading, preferring scraped page copy over the snippet. */
export function formatResearchSources(heading: string, sources: ResearchSource[]): string {
  if (!sources.length) return "";
  const lines = sources.map((s, i) => {
    const body = (s.markdown && s.markdown.trim()) || s.snippet || "";
    return `${i + 1}. ${s.title ?? s.url ?? "source"}${s.url ? ` (${s.url})` : ""}${body ? `\n${body.slice(0, 600)}` : ""}`;
  });
  return `${heading}\n${lines.join("\n\n")}`;
}
