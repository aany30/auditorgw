/**
 * Pexels stock-footage fetch — the MoneyPrinterTurbo background source. Given keywords,
 * returns HD stock video clips (portrait/landscape) to stitch into a reaction-reel background.
 * Needs PEXELS_API_KEY (free from pexels.com/api; set in the deployment env).
 */

export function pexelsKey(): string {
  return (process.env.PEXELS_API_KEY ?? "").trim();
}
export function pexelsEnabled(): boolean {
  return !!pexelsKey();
}

interface PexelsFile { link: string; width: number; height: number; file_type: string; quality: string }
interface PexelsVideo { duration: number; video_files: PexelsFile[] }

/** Pick the best mp4 for the target orientation — highest resolution ≤ ~1440p that matches. */
function pickFile(files: PexelsFile[], portrait: boolean): string | null {
  const mp4 = files.filter(f => f.file_type === "video/mp4" && f.width && f.height);
  const oriented = mp4.filter(f => portrait ? f.height >= f.width : f.width >= f.height);
  const pool = oriented.length ? oriented : mp4;
  // Prefer ~1080–1440 on the long edge; fall back to the largest available.
  const scored = pool
    .map(f => ({ f, edge: portrait ? f.height : f.width }))
    .sort((a, b) => a.edge - b.edge);
  const good = scored.find(s => s.edge >= 1080) ?? scored[scored.length - 1];
  return good?.f.link ?? null;
}

export interface StockClip { url: string; durationSec: number }

/** Fetch up to `perKeyword` clips for each keyword. Never throws — returns [] on failure. */
export async function fetchPexelsClips(
  keywords: string[],
  opts?: { orientation?: "portrait" | "landscape"; perKeyword?: number; maxClips?: number; clipSec?: number },
): Promise<StockClip[]> {
  const key = pexelsKey();
  if (!key || !keywords.length) return [];
  const portrait = (opts?.orientation ?? "portrait") === "portrait";
  const perKeyword = opts?.perKeyword ?? 2;
  const maxClips = opts?.maxClips ?? 8;
  const clipSec = opts?.clipSec ?? 5;
  const out: StockClip[] = [];
  const seen = new Set<string>();

  for (const kw of keywords) {
    if (out.length >= maxClips) break;
    try {
      const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(kw)}&per_page=${perKeyword}&orientation=${portrait ? "portrait" : "landscape"}&size=medium`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000); // never let a hung request stall the pipeline
      let res: Response;
      try { res = await fetch(url, { headers: { Authorization: key }, signal: ctrl.signal }); }
      finally { clearTimeout(timer); }
      if (!res.ok) continue;
      const data = (await res.json()) as { videos?: PexelsVideo[] };
      for (const v of data.videos ?? []) {
        const link = pickFile(v.video_files ?? [], portrait);
        if (link && !seen.has(link)) {
          seen.add(link);
          out.push({ url: link, durationSec: Math.min(v.duration || clipSec, clipSec) });
          if (out.length >= maxClips) break;
        }
      }
    } catch { /* skip this keyword */ }
  }
  return out;
}
