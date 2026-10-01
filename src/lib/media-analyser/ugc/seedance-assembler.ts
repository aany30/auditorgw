/**
 * Stage 04 — deterministic Seedance prompt + reference-stack assembly.
 *
 * The Director (Stage 02) already returns an `assembled_seedance_prompt`. We
 * prefer to REBUILD it deterministically from the structured plan so that any
 * review-step edits to dialogue / camera / overlays always flow through to the
 * render (the LLM string is the fallback when the plan is too sparse). The
 * rebuild follows the spec's `<seedance_format_rules>` exactly.
 */

import type { UGCDirectorPlan } from "./types";

/** Normalise "Xs-Ys" / "X-Y" → "Xs–Ys" (the spec's mandated stamp format). */
function fmtRange(range: string): string {
  const m = range.match(/(\d+)\s*s?\s*[–\-—to]+\s*(\d+)\s*s?/i);
  if (m) return `${m[1]}s–${m[2]}s`;
  return range.trim();
}

/**
 * Rebuild the production-ready Seedance prompt from the structured plan,
 * following the spec's 9 format rules. Returns the LLM's own
 * `assembled_seedance_prompt` if the plan lacks enough shot data to rebuild.
 */
export function assembleSeedancePrompt(
  plan: UGCDirectorPlan,
  refGuide?: string,
  opts?: { dialogue?: boolean },
): string {
  // Cinematic mode (dialogue:false) → a spoken-word-free, visually-driven ad.
  const withDialogue = opts?.dialogue !== false;

  if (plan.shots.length < 5 && plan.assembled_seedance_prompt?.trim()) {
    return plan.assembled_seedance_prompt.trim();
  }

  const { meta, shots, constraints } = plan;
  const aspect = meta.aspect_ratio || "9:16";
  const dur = meta.duration_seconds || 15;

  const lines: string[] = [];

  // 1 — framing sentence
  lines.push(
    `Generate a ${dur}-second ${aspect} vertical ${withDialogue ? "UGC-style social media advertisement" : "cinematic product advertisement (no spoken dialogue)"}.` +
      (meta.style_descriptors ? ` ${meta.style_descriptors}` : "") +
      (meta.rhythm ? ` Rhythm: ${meta.rhythm}.` : ""),
  );

  // 1b — reference-image role guide (leads the prompt so Seedance knows which image
  // is the identity-lock creator vs the product — see buildReferenceGuide).
  if (refGuide && refGuide.trim()) lines.push(refGuide.trim());

  // 2 — character block (prefixed to tie the description to the creator reference images)
  if (meta.character_description) {
    lines.push(`Character (the SAME person as the creator reference images, unchanged in every shot): ${meta.character_description}`);
  }

  // 3 — product block (mandatory fidelity phrase appended)
  if (meta.product_description) {
    const pd = meta.product_description.trim();
    const needsPhrase = !/match reference image/i.test(pd);
    lines.push(
      `Product: ${pd}${needsPhrase ? " — must strictly match reference image in appearance, color, and label details." : ""}`,
    );
  }

  // 4 — scene block
  if (meta.scene_setting) lines.push(`Scene: ${meta.scene_setting}`);

  // 5 — voice block (pacing clause appended so delivery is lively, not sluggish).
  // Cinematic mode has no spoken lines, so the voice block is dropped entirely.
  if (withDialogue && meta.voice_characteristics) {
    lines.push(
      `Voice: ${meta.voice_characteristics} Delivered at a brisk, upbeat conversational pace — lively and natural like a real creator talking to camera, clearly articulated, not dragging or over-pausing.`,
    );
  }

  // 6 — shot breakdown (drop the `Says:` dialogue clause in cinematic mode)
  lines.push(
    shots
      .map(s => {
        let line = `Shot ${s.shot_number}: ${s.beat_name} (${fmtRange(s.time_range)}) - ${s.camera}. ${s.subject_action}`;
        if (withDialogue) line += ` Says: "${s.dialogue}"`;
        if (s.text_overlay && s.text_overlay.trim()) line += ` Text overlay: "${s.text_overlay.trim()}"`;
        return line;
      })
      .join("\n"),
  );

  // 9 — constraints block (always include the mandated lines)
  const hasOverlay = shots.some(s => s.text_overlay && s.text_overlay.trim());
  const hasCreator = !!meta.character_description?.trim();
  const constraintSet = new Set<string>(constraints.map(c => c.trim()).filter(Boolean));
  constraintSet.add(
    hasOverlay
      ? "Only the specified text overlays should appear; no other subtitles."
      : "Keep it subtitle-free, avoid generating any unintended text or subtitles.",
  );
  constraintSet.add("Do not generate watermarks or logos other than those on the product.");
  constraintSet.add("Realistic human skin texture, no plastic feel, no character duplication.");
  // The creator-identity lock only matters when a person appears — in cinematic
  // product-only ads there may be no creator at all.
  if (hasCreator) {
    constraintSet.add("The creator is the SAME person in all 5 shots — identical face, hair, skin tone, eye colour and build. No face morphing, no mirrored features, no added or removed accessories, no beautifying or aging.");
  }
  if (withDialogue) {
    constraintSet.add("Spoken delivery is natural and energetic — a brisk, confident creator cadence with clear articulation and minimal dead air between lines; keep it lively and snappy, not sluggish, but never slur or garble words to cram them in.");
  } else {
    constraintSet.add("This is a CINEMATIC ad with NO spoken dialogue and no lip-sync — nobody talks to camera. Carry the story through cinematography: dramatic lighting, dynamic camera movement, satisfying product hero shots and motion. Audio is ambient sound and/or music only — no voiceover, no speech.");
  }
  lines.push([...constraintSet].join(" "));

  return lines.join("\n\n");
}

/** One contiguous run of same-role reference images, in submission order. */
export interface SeedanceRefRole {
  role: "creator" | "product" | "scene";
  count: number;
}

export interface SeedanceReferenceStack {
  /** Ordered URLs submitted to Seedance (creator shots first, then the product). */
  urls: string[];
  /** Role manifest describing the ordered stack, used to build the prompt's reference guide. */
  manifest: SeedanceRefRole[];
}

/**
 * Assemble a SMALL, identity-dominant Seedance reference stack.
 *
 * Seedance 2.0 drifts the character when fed many references — multiple guides
 * (magichour, crepal, wavespeed) converge on "fewer refs = far less drift" (6→2
 * ≈ −60% drift). So we cap hard at ~3: up to 2 creator/talent shots (the identity
 * lock) + 1 product (for fidelity). Nano scene/styling outputs are intentionally
 * DROPPED from the stack — they dilute the face; the scene is carried by the prompt's
 * scene block instead. Creator shots come first so the role guide (Image 1–N = the
 * creator) lines up with submission order.
 */
export function assembleSeedanceReferences(
  modelUrls: string[],
  productUrls: string[],
  sceneUrls: string[] = [],
  opts?: { maxCreator?: number; maxProduct?: number; maxScene?: number; extraSceneUrls?: string[] },
): SeedanceReferenceStack {
  // Seedance 2.0 drifts the face with many refs, so the default is a small identity-dominant
  // stack (2 creator + 1 product + 1 scene). Seedance 2.5 handles up to ~30–50 refs WITHOUT
  // that drift, so callers pass higher caps + extra scene/context refs (e.g. Nano-generated
  // shots) to give a richer 30s render more to work with.
  const creator = modelUrls.filter(Boolean).slice(0, opts?.maxCreator ?? 2);
  const product = productUrls.filter(Boolean).slice(0, opts?.maxProduct ?? 1);
  // World/backdrop + any extra context refs — added LAST so creator shots stay Image 1–N.
  const scene = [...sceneUrls, ...(opts?.extraSceneUrls ?? [])].filter(Boolean).slice(0, opts?.maxScene ?? 1);

  const urls = [...creator, ...product, ...scene];
  const manifest: SeedanceRefRole[] = [];
  if (creator.length) manifest.push({ role: "creator", count: creator.length });
  if (product.length) manifest.push({ role: "product", count: product.length });
  if (scene.length) manifest.push({ role: "scene", count: scene.length });

  return { urls, manifest };
}

/**
 * Build the prompt's "REFERENCE IMAGES" role guide from the ordered stack manifest.
 * Naming each image's role (and that the creator images are the SAME person) stops
 * Seedance blending the product into the face or averaging the identity across refs.
 * Returns "" when there are no references to describe.
 */
export function buildReferenceGuide(manifest: SeedanceRefRole[]): string {
  if (!manifest.length) return "";

  const parts: string[] = [];
  let idx = 1;
  for (const role of manifest) {
    const span = role.count === 1 ? `Image ${idx}` : `Images ${idx}–${idx + role.count - 1}`;
    if (role.role === "creator") {
      parts.push(
        `${span} = the CREATOR, the SAME real person — keep their face, bone structure, hair, ` +
          `skin tone, eye colour and build EXACTLY identical in every shot; do not restyle, ` +
          `beautify, age, or swap the face.`,
      );
    } else if (role.role === "scene") {
      parts.push(
        `${span} = the SCENE/BACKDROP — set the entire ad in this environment; match its location, ` +
          `lighting and mood. It has no people; place the creator naturally within it.`,
      );
    } else {
      parts.push(`${span} = the PRODUCT — reproduce it exactly; never blend it into the person.`);
    }
    idx += role.count;
  }

  return `REFERENCE IMAGES (in order): ${parts.join(" ")}`;
}
