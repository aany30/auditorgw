/**
 * Creatomate compositor — assembles a "reaction reel": a full-frame background video with a
 * circular talking-avatar picture-in-picture (bottom-left) and auto-generated captions synced
 * to the avatar's speech. FAL's ffmpeg-compose can't do spatial overlay / circle-crop / captions,
 * so this managed video API (JSON template → rendered MP4) does the compositing.
 *
 * Needs CREATOMATE_API_KEY (set in the deployment env; never handled in the browser).
 * Docs: https://creatomate.com/docs/api/rest-api
 */

const CREATOMATE_BASE = "https://api.creatomate.com/v1";

export function creatomateKey(): string {
  return (process.env.CREATOMATE_API_KEY ?? "").trim();
}
export function creatomateEnabled(): boolean {
  return !!creatomateKey();
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface ReactionReelOpts {
  backgroundUrl: string;      // full-frame background (stitched Pexels stock) — http
  avatarUrl: string;          // talking-avatar clip with audio (lip-synced) — http
  aspect?: "9:16" | "16:9";
  captions?: boolean;         // burn auto-captions from the avatar's speech (default true)
  bubble?: { size?: number; xPct?: number; yPct?: number }; // circle PiP size(px) + center position(%)
}

/** Build the Creatomate `source` template for a reaction reel. */
export function buildReactionReelSource(opts: ReactionReelOpts): Record<string, unknown> {
  const portrait = (opts.aspect ?? "9:16") === "9:16";
  const width = portrait ? 1080 : 1920;
  const height = portrait ? 1920 : 1080;
  const size = opts.bubble?.size ?? Math.round(width * 0.34);   // circle diameter in px
  const radius = Math.round(size / 2);                          // Creatomate needs px, not "50%"
  const xPct = opts.bubble?.xPct ?? 26;                          // center x (% of frame)
  const yPct = opts.bubble?.yPct ?? 74;                          // center y (% of frame)

  const AVATAR_ID = "avatar";
  const elements: Record<string, unknown>[] = [
    // Background — full frame, cover, muted (avatar carries the audio).
    { type: "video", source: opts.backgroundUrl, track: 1, fit: "cover", volume: 0, loop: true },
    // Avatar — circular picture-in-picture. Equal width/height + 50% radius = circle.
    {
      id: AVATAR_ID, type: "video", source: opts.avatarUrl, track: 2,
      x: `${xPct}%`, y: `${yPct}%`, width: `${size} px`, height: `${size} px`,
      x_anchor: "50%", y_anchor: "50%", fit: "cover", border_radius: `${radius} px`,
      shadow_color: "rgba(0,0,0,0.45)", shadow_blur: "24 px",
    },
  ];

  // Auto-captions synced to the avatar's speech (Creatomate transcribes the avatar element).
  if (opts.captions !== false) {
    elements.push({
      type: "text", track: 3, transcript_source: AVATAR_ID, transcript_effect: "highlight",
      transcript_maximum_length: 24,
      y: "90%", width: "88%", x_anchor: "50%", y_anchor: "50%",
      font_family: "Montserrat", font_weight: "700", font_size: "6.5 vmin",
      fill_color: "#ffffff", background_color: "rgba(0,0,0,0.72)", background_x_padding: "26%",
      background_y_padding: "18%", text_transform: "none", text_align: "center",
    });
  }

  return { output_format: "mp4", width, height, elements };
}

// ── Split-screen reel: top-half stock footage + bottom-half talking avatar ─────────────────

export interface SplitReelOpts {
  topVideoUrl: string;        // stitched stock footage — fills the top half
  bottomVideoUrl: string;     // talking avatar (Kling) — fills the bottom half
  audioUrl?: string;          // voice track; if given, both videos are muted and this carries audio
  durationSec?: number;       // total reel length (both halves loop to fill)
  captions?: boolean;         // burn auto-captions from the voice (default true)
  aspect?: "9:16";
}

/** Build the Creatomate `source` for a split-screen reel (stock top, avatar bottom). */
export function buildSplitReelSource(opts: SplitReelOpts): Record<string, unknown> {
  const width = 1080, height = 1920, half = height / 2; // 960 each
  const AUDIO_ID = "vo", BOTTOM_ID = "avatar";
  const elements: Record<string, unknown>[] = [
    // Top half — stock footage, muted, looped to fill.
    { type: "video", source: opts.topVideoUrl, track: 1, x: "50%", y: "25%", width: `${width} px`, height: `${half} px`, x_anchor: "50%", y_anchor: "50%", fit: "cover", volume: 0, loop: true },
    // Bottom half — talking avatar. Muted if a separate voice track is supplied.
    { id: BOTTOM_ID, type: "video", source: opts.bottomVideoUrl, track: 2, x: "50%", y: "75%", width: `${width} px`, height: `${half} px`, x_anchor: "50%", y_anchor: "50%", fit: "cover", volume: opts.audioUrl ? 0 : 1, loop: true },
  ];
  if (opts.audioUrl) elements.push({ id: AUDIO_ID, type: "audio", source: opts.audioUrl, track: 3 });
  if (opts.captions !== false) {
    elements.push({
      type: "text", track: 4,
      transcript_source: opts.audioUrl ? AUDIO_ID : BOTTOM_ID, transcript_effect: "highlight",
      transcript_maximum_length: 22,
      x: "50%", y: "50%", width: "86%", x_anchor: "50%", y_anchor: "50%", // over the seam
      font_family: "Montserrat", font_weight: "700", font_size: "5.6 vmin",
      fill_color: "#ffffff", stroke_color: "#000000", stroke_width: "0.5 vmin",
      background_color: "rgba(0,0,0,0.7)", background_x_padding: "24%", background_y_padding: "16%",
      text_align: "center",
    });
  }
  const source: Record<string, unknown> = { output_format: "mp4", width, height, elements };
  if (opts.durationSec && opts.durationSec > 0) source.duration = Math.round(opts.durationSec * 100) / 100;
  return source;
}

export interface CreatomateRender { id: string; status: string; url?: string; error?: string }

/** Submit any Creatomate `source` + poll to completion. Returns the finished MP4 URL. */
export async function renderCreatomateSource(source: Record<string, unknown>, waitMs = 600_000): Promise<string> {
  const key = creatomateKey();
  if (!key) throw new Error("CREATOMATE_API_KEY is not configured on the server.");

  const submit = await fetch(`${CREATOMATE_BASE}/renders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  if (!submit.ok) throw new Error(`Creatomate submit ${submit.status}: ${(await submit.text().catch(() => "")).slice(0, 300)}`);
  const arr = (await submit.json()) as CreatomateRender[];
  const render = Array.isArray(arr) ? arr[0] : (arr as CreatomateRender);
  if (!render?.id) throw new Error("Creatomate returned no render id");
  if (render.status === "succeeded" && render.url) return render.url;

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(5000);
    const res = await fetch(`${CREATOMATE_BASE}/renders/${render.id}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) continue;
    const r = (await res.json()) as CreatomateRender;
    if (r.status === "succeeded" && r.url) return r.url;
    if (r.status === "failed") throw new Error(`Creatomate render failed: ${r.error ?? "unknown"}`);
  }
  throw new Error("Creatomate render timed out");
}

/** Render a split-screen reel (stock top + avatar bottom). */
export async function renderSplitReel(opts: SplitReelOpts, waitMs = 600_000): Promise<string> {
  return renderCreatomateSource(buildSplitReelSource(opts), waitMs);
}

/** Render the (legacy) circular-PiP reaction reel. */
export async function renderReactionReel(opts: ReactionReelOpts, waitMs = 600_000): Promise<string> {
  return renderCreatomateSource(buildReactionReelSource(opts), waitMs);
}
