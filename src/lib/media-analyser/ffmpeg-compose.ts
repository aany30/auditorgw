/**
 * Self-hosted split-screen compositor — disabled in this deployment.
 *
 * The real implementation shells out to a bundled `ffmpeg-static` binary and uses
 * `@napi-rs/canvas` for caption rendering. Both are native/binary packages that were
 * deliberately removed from this project (see commit bb9b442, "Remove native deps
 * (@napi-rs/canvas, ffmpeg-static) that break Vercel build") because they fail to
 * compile in Vercel's serverless build environment.
 *
 * The exported functions below keep the same signatures as the real compositor so
 * callers (reaction-reel.ts, voice-clone.ts) don't need changes, but they throw a
 * clear error instead of silently failing. Re-enable by reinstalling both packages
 * with `outputFileTracingIncludes` configured for the ffmpeg binary, and restoring
 * the real implementation from the source project.
 */

const UNAVAILABLE =
  "Video/audio compositing is not available in this deployment (ffmpeg-static and @napi-rs/canvas were removed to keep the Vercel build working).";

export interface Caption { text: string; start: number; end: number }

export interface StackReelOpts {
  topClips: { url: string; durationSec: number }[]; // stock clips for the top half, each HARD-CUT to durationSec
  bottomVideoUrl: string;   // avatar → bottom half
  audioUrl: string;         // voice track (drives the reel length)
  durationSec: number;      // reel length in seconds
  captions?: Caption[];
}

export async function stackReelWithFfmpeg(_falKey: string, _opts: StackReelOpts): Promise<string> {
  throw new Error(UNAVAILABLE);
}

export interface StudioReelOpts {
  angleVideoUrls: string[];
  audioUrl: string;
  durationSec: number;
  captions?: Caption[];
  cutEverySec?: number;
}

export async function studioMultiCamReel(_falKey: string, _opts: StudioReelOpts): Promise<string> {
  throw new Error(UNAVAILABLE);
}

export async function concatAudioWithFfmpeg(_falKey: string, _urls: string[]): Promise<string> {
  throw new Error(UNAVAILABLE);
}

export async function trimAudioWithFfmpeg(_falKey: string, _url: string, _maxSec: number): Promise<string> {
  throw new Error(UNAVAILABLE);
}
