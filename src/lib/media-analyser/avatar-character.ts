/**
 * Talking-avatar character generation — image-to-image, identity-locked from a reference photo.
 * Follows the UGC img2img system prompt: given a reference photo of a real person, the vision LLM
 * locks that identity and writes a podcast / talking-to-camera keyframe prompt (subject ~50% of
 * frame, face clear, warm editorial-candid look), which we render via Nano Banana Pro alongside
 * the reference image. Produces a well-framed talking-head still for the reel's bottom half.
 */
import { editWithNanoBananaPro, type FalAspect, type FalImage } from "./fal";
import { callVisionLLM, type VisionUserPart } from "./vision-llm";
import { geminiVisionModels } from "./gemini-models";

const AVATAR_SYSTEM = `You are a casting-continuity and prompt-engineering engine for a UGC (user-generated-content) video-ad pipeline. Given ONE reference photo of a real person and a small set of scene preferences, you describe and lock that person's identity, then design a consistent, photorealistic podcast / talking-to-camera keyframe and output it as a single STRICT JSON object that a downstream image model (Nano Banana Pro) will use alongside the reference image.

INPUTS (any field may be empty / "no preference"):
- reference_image (the identity source — treat as ground truth, never contradict it)
- backdrop_style (warm_curtain_glam, cozy_library_bookshelf, eclectic_neon_shelf, minimalist_dark_office, modern_home_desk, custom, or empty)
- props (e.g. "mic on articulating arm", "handheld mic", "none"; empty = infer from backdrop_style)
- additional_detail (free-text styling/wardrobe/mood notes, optional)
- shot_count (integer, default 1)

HARD OUTPUT RULES:
- Output ONLY the JSON object. No markdown, no code fences, no commentary.
- Shape exactly: { "identity_lock": { source, identity_note, preserve[], do_not_change }, "global_rules": { style, framing, lighting, wardrobe, consistency_priority[], avoid[] }, "scene": { setting, backdrop_style, props, camera }, "shots": [ { id, type, identity_locked, prompt } ] }

IDENTITY (identity_lock): describe ONLY what is visibly stable in the reference photo — face shape, eye color/spacing, nose, lips, hair, skin tone, facial hair if present, approximate age, build. Do not invent, beautify, or shift age/ethnicity/body type. do_not_change = explicit instruction to preserve the exact person.

GLOBAL RULES: style = authentic podcast / talking-to-camera keyframe, editorial-but-candid, ultra realistic; framing = MEDIUM-WIDE SEATED SHOT — the person is SITTING AT A DESK/TABLE, filmed from a natural conversational distance (pulled back a bit, NOT a face close-up); their FULL UPPER BODY is visible (head with clear headroom above the hair, shoulders, chest, arms and hands on or near the desk), the desk in front of them and the room behind. Compose the person and desk within the UPPER TWO-THIRDS of the tall vertical frame (leave a little floor/space in the lower third). The subject fills roughly 35-40% of the frame; lighting = warm soft ambient-practical, low-to-moderate contrast; wardrobe = follow additional_detail if it specifies clothing, else infer from the reference; avoid = identity drift, beautification beyond reference, tight face/close-up crops, cropping the top of the head, text/captions/watermarks/logos, sunglasses or anything covering the face.

SCENE: honor backdrop_style (warm_curtain_glam / cozy_library_bookshelf / eclectic_neon_shelf / minimalist_dark_office / modern_home_desk); else choose the best fit. props: a visible mic for podcast backdrops unless told "none". camera: conversational eye-level, natural lens compression, shallow-to-moderate depth of field so the backdrop reads but stays secondary.

SHOTS: produce shot_count entries (default 1). shots[0] = ANCHOR: id "anchor", the person SEATED AT A DESK looking toward camera mid-conversation, warm natural candid expression, MEDIUM-WIDE shot (pulled back), FULL UPPER BODY visible (head with headroom, shoulders, chest, arms, hands on the desk), the room clearly around them, face clear and well-lit. Each shots[].prompt must be a complete standalone image-to-image prompt that explicitly reproduces the exact person from the reference image (restating identity_note in plain language), then framing, scene, and pose. Always restate: ONE real person only, photorealistic, MEDIUM-WIDE seated-at-a-desk shot showing the FULL UPPER BODY (not a close-up), head with headroom, person + desk composed within a roughly SQUARE 1:1 frame, face clear and well-lit, no text/watermarks/logos.

Return the JSON now.`;

interface CharJson {
  identity_lock?: { identity_note?: string };
  shots?: { id?: string; prompt?: string }[];
}

async function toInline(url: string): Promise<{ mime_type: string; data: string } | null> {
  try {
    if (url.startsWith("data:")) {
      const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
      if (!m) return null;
      const mime = m[1] || "image/jpeg";
      const data = m[2] ? m[3] : Buffer.from(decodeURIComponent(m[3])).toString("base64");
      return { mime_type: mime, data };
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    if (!ct.startsWith("image/")) return null;
    return { mime_type: ct, data: Buffer.from(await res.arrayBuffer()).toString("base64") };
  } catch { return null; }
}

/**
 * Generate an identity-locked talking-head keyframe from reference photo(s).
 * Falls back to a plain img2img edit if the JSON step fails. Returns the rendered still.
 */
/** Rough gender guess from the locked identity description, used to pick a matching TTS voice. */
function inferGender(text: string): string {
  const s = text.toLowerCase();
  if (/\b(woman|female|she|her|actress|feminine|girl|lady)\b/.test(s)) return "female";
  if (/\b(man|male|he|his|masculine|guy|gentleman)\b/.test(s) || /\b(beard|moustache|mustache|goatee|stubble|facial hair)\b/.test(s)) return "male";
  return "";
}

export interface AvatarKeyframe { image: FalImage; gender: string }

export async function generateAvatarKeyframe(
  falKey: string,
  geminiKey: string,
  opts: { referenceImages: string[]; additionalDetail?: string; backdropStyle?: string; props?: string; aspect?: FalAspect },
): Promise<AvatarKeyframe> {
  const refs = opts.referenceImages.filter(u => u.startsWith("data:image/") || u.startsWith("http")).slice(0, 3);
  if (!refs.length) throw new Error("A reference image is required for the avatar keyframe");
  const aspect = opts.aspect ?? "9:16";

  // 1) Identity-lock + shot prompt from the reference photo (vision LLM).
  let shotPrompt = "";
  let identityNote = "";
  try {
    const inline = (await Promise.all(refs.map(toInline))).filter(Boolean) as { mime_type: string; data: string }[];
    const inputs = `backdrop_style: ${opts.backdropStyle || "custom"}\nprops: ${opts.props || "infer"}\nadditional_detail: ${opts.additionalDetail || "no preference"}\nshot_count: 1`;
    const parts: VisionUserPart[] = [...inline.map(p => ({ inline_data: p })), { text: inputs }];
    const raw = await callVisionLLM(AVATAR_SYSTEM, parts, geminiKey, { jsonMode: true, models: geminiVisionModels(), maxTokens: 1200 });
    const m = raw.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(m ? m[0] : raw) as CharJson;
    identityNote = String(obj.identity_lock?.identity_note ?? "");
    const anchor = obj.shots?.find(s => s.id === "anchor") ?? obj.shots?.[0];
    shotPrompt = String(anchor?.prompt ?? "").trim();
    if (!shotPrompt && identityNote) {
      shotPrompt = `Reproduce the exact person from the reference image (${identityNote}). Photorealistic HALF-BODY medium podcast talking-to-camera shot, head/chest/hands visible (not a face close-up), whole head in frame with headroom, face clear and well-lit, warm ambient light, square 1:1 composition, ONE real person only, no text or watermarks.`;
    }
  } catch { /* fall through to generic prompt */ }

  if (!shotPrompt) {
    shotPrompt = `Reproduce the exact person from the reference image — same face, hair, skin tone and age. ${opts.additionalDetail || ""} Photorealistic HALF-BODY medium podcast talking-to-camera shot, head, chest and hands visible (not a tight face crop), whole head in frame with headroom above the hair, face clear, well-lit, warm ambient light, environment/backdrop around the subject, square 1:1 composition, ONE real person only, no text or watermarks.`.trim();
  }

  // 2) Render the keyframe img2img from the reference photo(s).
  const image = await editWithNanoBananaPro(falKey, refs, shotPrompt, { aspect });
  return { image, gender: inferGender(identityNote || opts.additionalDetail || "") };
}

/**
 * Generate 3 camera-angle keyframes of the SAME person in ONE studio (front, ¾-left, ¾-right),
 * identity-locked from the reference photo(s). The front frame renders first; the left/right
 * frames then use [reference + front] as references so the studio, wardrobe and lighting stay
 * consistent across angles. Each drives one Kling lip-sync render → a multi-cam studio reel.
 */
export async function generateStudioAngleKeyframes(
  falKey: string,
  opts: { referenceImages: string[]; wardrobe?: string; studioStyle?: string; aspect?: FalAspect },
): Promise<FalImage[]> {
  const refs = opts.referenceImages.filter(u => u.startsWith("data:image/") || u.startsWith("http")).slice(0, 3);
  if (!refs.length) throw new Error("A reference image is required for the studio avatar");
  const aspect = opts.aspect ?? "9:16";
  const studio = opts.studioStyle?.trim() || "a clean modern podcast studio — soft warm key light, a subtle out-of-focus set behind (shelf, plant, warm practical lights), seated on a stool";
  const wear = opts.wardrobe?.trim() ? ` wearing ${opts.wardrobe.trim()},` : "";
  const identity = "Reproduce the EXACT same person from the reference image(s) — identical face, bone structure, hair, skin tone, age and build. Do NOT beautify, age, or alter the face.";
  const common = `${identity}${wear} seated in ${studio}, medium shot from a natural conversational distance (head with headroom, shoulders and chest visible, NOT a tight face crop), sharp focus, ONE real person only, no text, captions, watermarks or logos, tall vertical 9:16 composition.`;

  const front = await editWithNanoBananaPro(falKey, refs, `${common} FRONT-FACING camera angle — the person looks straight into the camera.`, { aspect, resolution: "2K" });

  // Left/right reuse the front frame as an extra reference so the studio + wardrobe match exactly.
  const withFront = [...refs, front.url].slice(0, 4);
  const [left, right] = await Promise.all([
    editWithNanoBananaPro(falKey, withFront, `${common} Filmed from a THREE-QUARTER LEFT camera angle (camera to the subject's right, ~35°), body angled slightly, still glancing toward camera. SAME studio, wardrobe and lighting as the reference frames.`, { aspect, resolution: "2K" }),
    editWithNanoBananaPro(falKey, withFront, `${common} Filmed from a THREE-QUARTER RIGHT camera angle (camera to the subject's left, ~35°), body angled slightly, still glancing toward camera. SAME studio, wardrobe and lighting as the reference frames.`, { aspect, resolution: "2K" }),
  ]);
  return [front, left, right];
}
