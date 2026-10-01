/**
 * Talking Avatar b-roll library — curated clips ingested into the Supabase `avatar-broll`
 * bucket, each parsed (Gemini vision) into a description + tags + orientation. The reel's
 * top-half footage is matched from THIS library (per beat) instead of a live stock-video API.
 *
 * The manifest is committed as avatar-broll.json (single source of truth for the bundle);
 * an identical copy lives at avatar-broll/manifest.json in the bucket.
 */

import manifest from "./avatar-broll.json";

export interface BrollClip {
  id: string;
  set: string;            // "lib" | "pineapple"
  file: string;
  key: string;            // storage key
  url: string;            // public URL
  orientation: "portrait" | "landscape";
  width: number;
  height: number;
  durationSec: number;
  description: string;
  tags: string[];
  category: string;
}

export const BROLL_CLIPS: BrollClip[] = manifest as BrollClip[];
export const BROLL_ENABLED = BROLL_CLIPS.length > 0;

const STOP = new Set(["the", "a", "an", "of", "in", "on", "and", "with", "for", "to", "your", "you", "that", "this", "her", "his", "its", "b-roll", "broll", "shot", "video", "clip", "footage", "close", "view"]);

function tokens(s: string): string[] {
  return (String(s || "").toLowerCase().match(/[a-z]+/g) ?? []).filter(w => w.length > 2 && !STOP.has(w));
}

/** Overlap score between a beat's query tokens and a clip's searchable text. */
function scoreClip(clip: BrollClip, q: string[]): number {
  const hay = new Set<string>([
    ...clip.tags.flatMap(tokens),
    ...tokens(clip.description),
    ...tokens(clip.category),
    ...tokens(clip.file),
  ]);
  let score = 0;
  for (const t of q) if (hay.has(t)) score++;
  // Landscape clips fill the wide top-half better than portrait — nudge ties toward them.
  if (clip.orientation === "landscape") score += 0.1;
  return score;
}

/**
 * Pick up to `count` DISTINCT clips matched to the beats, in beat order. Each beat gets its
 * best-scoring unused clip; remaining slots are filled by best topic match, then any leftover.
 * Returns clip URLs (the caller hard-cuts each to a slot). Never throws; [] if the library is empty.
 */
export function pickBrollClips(keywords: string[], count: number, fallbackTopic = ""): string[] {
  if (!BROLL_CLIPS.length) return [];
  const used = new Set<string>();
  const out: string[] = [];

  const takeBest = (q: string[]): boolean => {
    let best: BrollClip | null = null;
    let bestScore = 0;
    for (const c of BROLL_CLIPS) {
      if (used.has(c.id)) continue;
      const sc = scoreClip(c, q);
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    if (!best) return false;
    used.add(best.id); out.push(best.url);
    return true;
  };

  // 1) one clip per beat, matched to its keyword.
  for (const kw of keywords) {
    if (out.length >= count) break;
    if (!takeBest(tokens(kw))) takeBest([]); // no keyword hit → any unused clip
  }
  // 2) pad remaining slots with the best topic match, then any leftover.
  const topicQ = tokens(fallbackTopic);
  while (out.length < count && used.size < BROLL_CLIPS.length) {
    if (!takeBest(topicQ)) break;
  }
  return out;
}
