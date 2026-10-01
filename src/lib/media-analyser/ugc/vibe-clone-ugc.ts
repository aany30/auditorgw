/**
 * Vibe Clone — UGC. Watches a reference reel and storyboards it into ≤6 shots,
 * each with (a) a Nano Banana keyframe prompt that recreates that shot's frame in
 * the reel's vibe featuring the user's model + product, and (b) a Seedance i2v
 * motion prompt. The client then renders a keyframe per shot, animates each, and
 * stitches the clips into the final reel.
 */

import { z } from "zod";

export const MAX_VIBE_SHOTS = 6;

export const VibeShotSchema = z.object({
  shot_number: z.number().int(),
  duration_sec: z.number().min(2).max(6).default(4),
  keyframe_prompt: z.string().min(1),
  motion_prompt: z.string().min(1),
  on_screen_text: z.string().nullable().optional(),
});

export const VibeCloneStoryboardSchema = z.object({
  shots: z.array(VibeShotSchema).min(1),
});

export type VibeShot = z.infer<typeof VibeShotSchema>;
export type VibeCloneStoryboard = z.infer<typeof VibeCloneStoryboardSchema>;

/** Gemini responseSchema for the storyboard. */
export const VIBE_CLONE_UGC_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    shots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          shot_number: { type: "integer" },
          duration_sec: { type: "number", description: "Shot length in seconds, 2-6." },
          keyframe_prompt: { type: "string", description: "Full Nano Banana image prompt to recreate this shot's frame (framing/camera/lighting/composition/action) in the reference's vibe, featuring the user's model + product." },
          motion_prompt: { type: "string", description: "The camera + subject motion in this shot, for image-to-video animation." },
          on_screen_text: { type: "string", description: "On-screen text for this shot, or empty." },
        },
        required: ["shot_number", "duration_sec", "keyframe_prompt", "motion_prompt"],
      },
    },
  },
  required: ["shots"],
};

export const VIBE_CLONE_UGC_SYSTEM_PROMPT = `You are a UGC reel director and shot designer. You are given a REFERENCE REEL (video), a MODEL image (the creator who will star in the new reel), and PRODUCT image(s). Your job is to WATCH the reference reel and storyboard a NEW reel that recreates its ENTIRE VIBE — pacing, camera language, framing, lighting, mood, energy, transitions and on-screen-text style — but starring the user's model and featuring the user's product.

Break the reference reel into its natural shots — at most ${MAX_VIBE_SHOTS} shots. For EACH shot output:
- shot_number (1-based, in order).
- duration_sec: the shot's length, 2-6 seconds, matching the reference's pacing.
- keyframe_prompt: a COMPLETE image-generation prompt (for Nano Banana Pro) that recreates THIS shot's opening frame in the reference's vibe — name the camera angle, framing, lighting (source + direction + quality), setting/background, composition and the model's pose/action. The frame MUST feature the user's model (the SAME person as the model image — identical face, hair, build; keep them consistent across ALL shots) and the user's product. PRODUCT FIDELITY IS ABSOLUTE: reproduce the product exactly as in the product image — never restyle, recolour or relabel it. End every keyframe_prompt with: "Keep the model the SAME person across all shots and the product EXACTLY as in the reference image."
- motion_prompt: describe the camera movement + subject motion for THIS shot (one clear movement), so an image-to-video model can animate the keyframe naturally in the reference's energy.
- on_screen_text: any on-screen caption for this shot (restyled for the new product), or empty.

RULES:
- Output STRICT JSON matching the schema. No prose, no code fences.
- Recreate the VIBE, not a pixel copy. Do not depict the reference's original people or product — use the user's model + product.
- Keep the model recognisably the SAME person in every shot.
- Be concrete and reproducible: every value must be something an image/video model can render from the words alone.

Return the JSON now.`;

/** The user-message text sent alongside the video + model + product images. */
export function buildVibeCloneUserMessage(aspect: string): string {
  return [
    "REFERENCE REEL: the attached video — recreate its vibe.",
    "MODEL: the attached model image is the creator who must star in every shot (same person throughout).",
    "PRODUCT: the attached product image(s) — feature this exact product.",
    `Storyboard the new ${aspect || "9:16"} reel now (max ${MAX_VIBE_SHOTS} shots). Output only the JSON.`,
  ].join("\n");
}
