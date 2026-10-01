/**
 * Micro Drama — script → cast analysis → character generation → (scenarios → scenes →
 * animated short) pipeline. This module holds the shared Zod types, JSON schema and prompts
 * for the SCRIPT-ANALYSIS + CHARACTER steps (slice 1). Scenario/scene/animation prompts are
 * added in later slices.
 *
 * Reasoning currently runs through the temporary OpenAI shim (see brand-llm.ts / openrouter.ts).
 */
import { z } from "zod";

// ── Zod (validate the LLM output) ────────────────────────────────────────────
export const DramaCharacter = z.object({
  id: z.string().catch(""),
  name: z.string(),                 // real name or a descriptive label ("The Landlord")
  role: z.string().catch(""),       // protagonist / antagonist / supporting / narrator …
  age: z.string().catch(""),
  gender: z.string().catch(""),
  description: z.string().catch(""), // one-line personality / who they are in the story
  appearance: z.string().catch(""), // vivid one-sentence castable look (face, hair, build, wardrobe)
});
export type DramaCharacter = z.infer<typeof DramaCharacter>;

export const DramaAnalysis = z.object({
  title: z.string().catch(""),
  logline: z.string().catch(""),
  genre: z.string().catch(""),
  tone: z.string().catch(""),        // emotional tone / mood (e.g. "tense, melancholic")
  pacing: z.string().catch(""),      // overall rhythm (e.g. "slow-burn build to a sharp climax")
  summary: z.string().catch(""),
  setting: z.string().catch(""),
  sceneCountEstimate: z.number().catch(0),
});
export type DramaAnalysis = z.infer<typeof DramaAnalysis>;

// A scene = one story beat/location. "beats per scene" from the flow.
export const DramaScene = z.object({
  id: z.string().catch(""),
  heading: z.string().catch(""),      // e.g. "INT. CHAI STALL - DAWN"
  location: z.string().catch(""),
  timeOfDay: z.string().catch(""),
  beat: z.string().catch(""),         // the dramatic beat / what happens + its emotional turn
  characters: z.array(z.string()).catch([]), // names present in the scene
});
export type DramaScene = z.infer<typeof DramaScene>;

export const AnalyzeResult = z.object({
  analysis: DramaAnalysis,
  scenes: z.array(DramaScene).catch([]),
  characters: z.array(DramaCharacter).catch([]),
});
export type AnalyzeResult = z.infer<typeof AnalyzeResult>;

// ── Shot list (per scene → clips) ────────────────────────────────────────────
export const DramaShot = z.object({
  id: z.string().catch(""),
  angle: z.string().catch(""),        // e.g. "medium close-up", "wide establishing"
  movement: z.string().catch(""),     // e.g. "slow push-in", "static", "handheld follow"
  cut: z.string().catch(""),          // e.g. "hard cut", "match cut", "cross-dissolve"
  action: z.string().catch(""),       // what happens on screen in this clip
  dialogue: z.string().catch(""),     // the spoken line(s) in this clip, if any
  characters: z.array(z.string()).catch([]), // names on screen (drives which char refs to reuse)
  durationSec: z.number().catch(0),
});
export type DramaShot = z.infer<typeof DramaShot>;

export const SceneShotList = z.object({
  sceneId: z.string().catch(""),
  sceneHeading: z.string().catch(""),
  shots: z.array(DramaShot).catch([]),
});
export type SceneShotList = z.infer<typeof SceneShotList>;

export const ShotListResult = z.object({
  scenes: z.array(SceneShotList).catch([]),
});
export type ShotListResult = z.infer<typeof ShotListResult>;

// ── JSON schema (the shape the model is told to return) ───────────────────────
export const ANALYZE_SCHEMA = {
  type: "object",
  properties: {
    analysis: {
      type: "object",
      properties: {
        title: { type: "string" }, logline: { type: "string" }, genre: { type: "string" },
        tone: { type: "string" }, pacing: { type: "string" },
        summary: { type: "string" }, setting: { type: "string" }, sceneCountEstimate: { type: "number" },
      },
    },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" }, heading: { type: "string" }, location: { type: "string" },
          timeOfDay: { type: "string" }, beat: { type: "string" },
          characters: { type: "array", items: { type: "string" } },
        },
      },
    },
    characters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" }, name: { type: "string" }, role: { type: "string" },
          age: { type: "string" }, gender: { type: "string" }, description: { type: "string" }, appearance: { type: "string" },
        },
      },
    },
  },
} as const;

// ── Prompts ───────────────────────────────────────────────────────────────────
export const SHOTLIST_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sceneId: { type: "string" }, sceneHeading: { type: "string" },
          shots: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" }, angle: { type: "string" }, movement: { type: "string" },
                cut: { type: "string" }, action: { type: "string" }, dialogue: { type: "string" },
                characters: { type: "array", items: { type: "string" } }, durationSec: { type: "number" },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const ANALYZE_SYSTEM = `You are a script analyst and casting director for short-form "micro drama" videos. Read the ENTIRE script carefully.

Return an "analysis" object: title, a one-line logline, genre, TONE (emotional mood, e.g. "tense, melancholic"), PACING (overall rhythm, e.g. "slow-burn build to a sharp climax"), a 2-3 sentence summary, the setting, and sceneCountEstimate (rough number of scenes).

Return a "scenes" array — break the script into its scenes IN ORDER. For each scene: id, heading (e.g. "INT. CHAI STALL - DAWN"), location, timeOfDay, beat (the dramatic beat — what happens and its emotional turn), and characters (the names present in that scene).

Return a "characters" array — EVERY distinct on-screen / speaking character. For each: name (a clear descriptive label like "The Landlord" if unnamed), role (protagonist / antagonist / supporting / narrator, etc.), approximate age, gender, a one-line personality description, and a vivid ONE-SENTENCE appearance that is castable for image generation (face, hair, build, wardrobe, distinguishing features).

Rules: base everything STRICTLY on the script — do not invent scenes or characters that never appear, and do not merge two distinct characters. Be concise and concrete.`;

export function analyzeUser(script: string): string {
  return `SCRIPT:\n${script.slice(0, 16000)}\n\nAnalyse this script: fill analysis (incl. tone + pacing), break it into ordered scenes with beats, and list every character with a castable appearance.`;
}

// ── Shot list generator ───────────────────────────────────────────────────────
export const SHOTLIST_SYSTEM = `You are a director + cinematographer breaking a micro-drama script into a SHOT LIST for AI video generation. Given the analysis (tone, pacing) and the ordered scenes, break EACH scene into a sequence of SHOTS (clips) — the actual video clips that will be generated and stitched.

For each shot return: id, angle (framing, e.g. "medium close-up", "wide establishing", "over-the-shoulder"), movement (camera move, e.g. "slow push-in", "static", "handheld follow"), cut (how it transitions to the next, e.g. "hard cut", "match cut", "cross-dissolve"), action (what happens on screen — concrete and filmable), dialogue (the exact spoken line(s) in this shot, or empty if none), characters (names visible on screen), and durationSec (a realistic clip length, usually 3-8 seconds).

Rules: honour the scene's beat and the overall tone/pacing. Keep shots short and generatable (one clear action each). Cover all the dialogue across the shots in order. Aim for 2-5 shots per scene. Return shots grouped by scene, in scene order.`;

export function shotlistUser(p: { analysis: DramaAnalysis; scenes: DramaScene[] }): string {
  const a = p.analysis;
  const sceneBlock = p.scenes.map((s, i) => `SCENE ${i + 1} [id:${s.id}] ${s.heading}\n  location: ${s.location} | time: ${s.timeOfDay} | characters: ${(s.characters || []).join(", ")}\n  beat: ${s.beat}`).join("\n\n");
  return `TITLE: ${a.title}\nGENRE: ${a.genre}\nTONE: ${a.tone}\nPACING: ${a.pacing}\n\nSCENES:\n${sceneBlock}\n\nGenerate the shot list — break every scene into shots (angle, movement, cut, action, dialogue, characters, durationSec), grouped by scene, in order.`;
}

/** Text-to-image prompt for a single character portrait (Seedream). */
export function characterImagePrompt(c: DramaCharacter, steer?: string): string {
  const who = [c.name, [c.gender, c.age].filter(Boolean).join(", ")].filter(Boolean).join(" — ");
  return [
    `Photoreal cinematic character portrait of ${who}.`,
    c.appearance ? `Appearance: ${c.appearance}.` : "",
    c.description ? `Character: ${c.description}.` : "",
    "Single subject, head-and-shoulders, cinematic lighting, shallow depth of field, film-still look, neutral backdrop.",
    "Vertical 4:5 framing. No text, no captions, no logos, no watermark.",
    steer ? `Adjustments requested: ${steer}.` : "",
  ].filter(Boolean).join(" ");
}
