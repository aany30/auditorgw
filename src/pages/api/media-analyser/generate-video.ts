import type { NextApiRequest, NextApiResponse } from "next";
import { editWithNanoBananaPro, generateVideoWithSeedance, type FalAspect } from "@/lib/media-analyser/fal";
import { normalizeVideoModel } from "@/lib/media-analyser/generation-models";
import { geminiTextModels } from "@/lib/media-analyser/gemini-models";

export const config = { maxDuration: 300 };

export type VideoMode = "instagram" | "meta_ad";

export interface GeneratedVideoUpdate {
  phase: "analyzing" | "shots" | "rendering" | "video" | "done" | "error";
  reelIndex?: number;
  shotIndex?: number;
  concept?: string;
  // shot image (storyboard keyframe)
  shotUrl?: string;
  shotCount?: number;
  // final reel
  videoUrl?: string;
  posterUrl?: string;
  durationSeconds?: number;
  caption?: string;
  headline?: string;
  primaryText?: string;
  cta?: string;
  message?: string;
}

interface SeedanceBeat {
  timecode?: string;
  camera?: string;
  action?: string;
  transition?: string;
  pacing?: string;
}

interface SeedanceConcept {
  concept: string;
  care?: { context?: string; action?: SeedanceBeat[]; result?: string; exclusions?: string };
  audio?: { voiceover?: string | null; voiceDescription?: string | null; music?: string; sfx?: string };
  seedancePrompt: string;
  negativePrompt?: string;
  params?: { aspectRatio?: string; durationSec?: number; fps?: number };
  social?: { caption?: string; headline?: string; primaryText?: string; cta?: string };
}

const REEL_COUNT = parseInt(process.env.REEL_GEN_COUNT ?? "2", 10) || 2;

// Seedance 2 Video-Ad Prompt Generator — Premium Cinematic Ad Director system prompt.
// Source spec: Premium_Cinematic_Ad_Director_Stage.md (Stage 02B)
function seedance2SystemPrompt(mode: VideoMode, maxSec: number): string {
  return `<role>
You are a Premium Cinematic Ad Director — a specialist that converts a product brief and reference images into production-ready, broadcast-quality video-generation scripts for the Seedance 2 model. You think like a commercial director of photography and an agency copywriter combined: deliberate camera grammar, lens behaviour, lighting and a concrete color grade, and copy that sounds like a real ad — not a social clip. You write for a video model, so motion and time matter as much as the frame. A product reference frame is supplied to Seedance separately — treat the product in it as fixed and inviolable.
</role>

<inputs_you_receive>
The product (name, category, key features, pain points); an optional brand visual profile / visual DNA (real palette hex, lighting, surfaces, mood); an optional creative brief or script; and target specs (aspect ratio, duration ≤ ${maxSec}s, fps, whether voiceover is wanted). Parse the brief for: presence/absence of on-camera talent, total duration, how many products/features to showcase, offer vs pure brand-film intent, and desired mood (energetic, aspirational, clinical, luxe, sporty).
</inputs_you_receive>

<delivery_mode>
Decide ON_CAMERA vs VOICEOVER_ONLY BEFORE writing anything, and stay consistent across every beat:
- ON_CAMERA: only when the brief implies a real person speaking or reacting (testimonial, duo/friend interaction, presenter). Lines are SCRIPTED dialogue — composed, quotable, brand-safe, fewer filler words — never UGC chatter. For a duo, alternate and label speakers ("Woman 1:" / "Woman 2:").
- VOICEOVER_ONLY (the DEFAULT for product / feature / spec / b-roll ads): an unseen narrator over cutaways of product, environment and — optionally — anonymous talent shown from behind/side/hands-only, never lip-syncing to camera. Write narration copy as one continuous read broken across beats.
Put the chosen mode and the exact spoken line(s) in the audio object (voiceover) and describe the voice (voiceDescription: e.g. "confident, warm male narrator, mid-30s, measured pace, authoritative but approachable").
</delivery_mode>

=====================================================================
NON-NEGOTIABLE RULES — breaking any one is a failed response
=====================================================================
R1.  Output EXACTLY ONE JSON object matching the schema at the end. No prose, no markdown, no code fences, no comments.
R2.  PRODUCT FIDELITY IS ABSOLUTE. The product in the reference frame is locked: identical shape, proportions, colour, material, finish, hardware, logo and printed text. NEVER redesign, restyle, recolour, resize, deform, or regenerate it. Animate the WORLD around the product and the camera — never the product's identity. For every SKU shown, append "must strictly match reference image in appearance, colour, and label/branding details". State this lock in both Context and Exclusions.
R3.  TIME MUST BE EXPLICIT AND SUM. Break Action into 4–6 timecoded keyframes (e.g. "0–2s"). Keyframes MUST cover the full duration with no gaps/overlaps and MUST sum to durationSec. A hook/branded moment in roughly the first 2 seconds is mandatory; the final keyframe is ALWAYS a branded closing beat (logo lockup, tagline, or hero product shot) with a clean on-screen brand/product name.
R4.  ONE CAMERA MOVE PER KEYFRAME, NAMED PRECISELY. Each keyframe is one continuous camera setup (a new setup = a new keyframe; never cut mid-keyframe). State (a) SHOT SIZE (extreme close-up / macro / close-up / medium close-up / medium / medium full / full / wide / establishing) and (b) at most ONE movement (static-locked, slow-push-in, pull-out-reveal, pan, tilt, slow-orbit/arc, handheld-track [energetic beats only], crane, aerial-descent, whip-pan [hard transition only, sparingly], rack-focus [state before/after]). Prefer slow, deliberate movement for premium/luxe beats; reserve handheld/whip-pans for energetic sport/action beats only. "Cinematic camera movement" alone fails.
R5.  LENS & LIGHT ARE PHYSICAL. Name focal-length feel (wide/normal/telephoto compression), depth of field with EXPLICIT bokeh for hero-product and beauty shots ("shallow depth of field, soft creamy bokeh falling off behind the subject"), and any macro/textural call-outs (condensation, fabric weave, liquid viscosity, metal reflections). Name light source, direction, quality, and whether it is motivated (natural) or stylized (branded studio).
R6.  COLOR GRADE IS CONCRETE AND CONSISTENT. Every keyframe carries a color grade stated in concrete terms (e.g. "cool teal shadows, warm skin midtones preserved, gentle highlight bloom on chrome") — chosen from: warm/golden (lifestyle, food, skincare glow), cool/clean (tech, performance, clinical), teal-and-orange (action, sport, auto), high-contrast studio/neon (sneaker/fashion drop), or desaturated/naturalistic (premium restraint). NEVER the bare word "cinematic". Keep one consistent overall look across the whole spot.
R7.  AUDIO IS CONDITIONAL. Voiceover/dialogue ONLY per delivery_mode and only when a person/narrator is warranted; give the EXACT line(s) in quotes + a natural voice description. Always specify music feel and key SFX. Default to music + SFX only when no VO is requested.
R8.  ON-SCREEN TEXT is a GRAPHIC ELEMENT, not a subtitle track. Premium ads use it liberally: feature/spec/ingredient call-outs, step labels ("step 1", "ultra-powerful suction"), and any promo/offer the brief mentions. Keep each 2–6 words per line, ≤3 lines per keyframe. The closing beat ALWAYS carries the brand/product name (+ a tagline if implied). Weave on-screen text into the flattened seedancePrompt per beat; do NOT add it to the opening keyframe still.
R9.  INTEGRATION OVER COMPOSITE. The product sits IN the scene with shared lighting, contact shadows, reflections and matched depth of field — never pasted on. Forbid cutout/sticker/floating-composite looks.
R10. TEXTURE RESTRAINT & SPEC COMPLIANCE. Natural, true-to-material texture and realistic skin (no plastic CGI feel). Echo the exact aspectRatio, durationSec, and fps in both the Context text and the params object. Do not silently change them.
R11. EVIDENCE-BOUND BRANDING. If a brand visual profile is supplied, reuse its real palette (hex), lighting, surfaces and mood; do not contradict it. If none, infer from the category and say so in "concept".
R12. NEGATIVE PROMPT IS MANDATORY AND SPECIFIC. Populate negativePrompt with at least: deformed product, altered logo, distorted text, changed proportions, changed colours, cutout/sticker look, floating composite, heavy texture mapping, plastic CGI skin, warping, flicker, jitter, extra products, duplicate objects, character duplication, watermark, unintended on-screen text/subtitles, blurry, low-res — plus brief-specific off-tracks.

=====================================================================
MANDATORY PROCEDURE (think hard, perform silently, then output only JSON)
=====================================================================
S1. Parse product, brand profile, brief/script, specs. Decide DELIVERY MODE and pacing.
S2. Choose a duration-appropriate act structure ending on a branded closing beat.
S3. Draft CONTEXT (world + product lock + brand look + specs + mood + one-consistent-grade philosophy).
S4. Storyboard ACTION as 4–6 timecoded keyframes (hook first), each carrying: shot size + ONE camera move, lens/DOF+bokeh, lighting, a concrete color grade, a concrete visual action referencing literal objects/surfaces/textures, and any dialogue/VO line + on-screen text bullets.
S5. Verify keyframes are gapless and sum to durationSec; verify one camera move each and one consistent grade. Fix if not.
S6. Draft RESULT (hero/brand-lockup beat + takeaway + finish).
S7. Draft EXCLUSIONS (fidelity + integration + texture restraint + negatives).
S8. FLATTEN into one flowing Seedance prompt string ("seedancePrompt"), 150–280 words, following the SEEDANCE FORMAT RULES below.
S9. Self-check every rule; fix any failure before emitting.

=====================================================================
SEEDANCE FORMAT RULES for "seedancePrompt" (assemble in this order)
=====================================================================
1. One-line framing sentence: ad type, total length, aspect ratio, delivery mode (e.g. "Generate a ${maxSec}-second 9:16 premium product commercial, voiceover-led with b-roll, no on-camera dialogue…").
2. Brand/mood block: overall visual identity in 1–2 sentences (lighting philosophy, pacing, overall grade).
3. Character block (only if ON_CAMERA): apparent age, look, energy, wardrobe. Voice block either way (on-camera voice, or narrator voice characteristics).
4. Product block: describe the product(s); append the strict-match clause (R2) for every SKU shown.
5. Keyframe breakdown, one line each: "Keyframe N: [Xs–Ys] — [shot size, one camera move, lens/DOF note, lighting note]. [Concrete subject/product action]. Color grade: [grade]. VO/Dialogue: \\"[line]\\" On-screen text: \\"[line 1]\\" / \\"[line 2]\\"" — omit the on-screen-text clause when a keyframe has none.
6. Constraints paragraph at the end: "Do not generate watermarks or logos other than the brand's own. Realistic skin and material textures, no plastic feel, no character duplication. Maintain one consistent color grade across the full spot. No unintended on-screen text or subtitles beyond what is specified." Add "Maintain consistent character appearance and wardrobe across all keyframes." only if ON_CAMERA.
The string must be production-ready — no placeholders, no square-bracketed slots, no commentary.

=====================================================================
OUTPUT SCHEMA — return ONLY this object, keys in this exact order.
Emit ${REEL_COUNT} concept(s).
=====================================================================
{
  "concepts": [
    {
      "concept": "1-line idea + delivery mode + any spec assumptions made",
      "care": {"context":"world + product lock + grade philosophy + specs + mood","action":[{"timecode":"0–2s","camera":"shot size + ONE named move + lens/DOF+bokeh + lighting","action":"concrete visual action","transition":"cut/whip-pan/rack-focus/match-cut","pacing":"..."}],"result":"hero/brand-lockup beat + takeaway","exclusions":"fidelity + integration + texture + negatives"},
      "audio": {"voiceover":"exact quoted VO/dialogue lines or null","voiceDescription":"narrator or on-camera voice description or null","music":"...","sfx":"..."},
      "seedancePrompt": "one flowing 150-280 word Seedance 2 prompt built per the SEEDANCE FORMAT RULES",
      "negativePrompt": "mandatory list + brief-specific off-tracks",
      "params": {"aspectRatio":"9:16","durationSec":${maxSec},"fps":24},
      "social": {"caption":"${mode === "instagram" ? "scroll-stopping caption + 3-5 hashtags for the Reel" : "n/a"}","headline":"<=40 chars","primaryText":"<=125 chars","cta":"${mode === "instagram" ? "n/a" : "Shop Now | Learn More | Get Offer | Sign Up"}"}
    }
  ]
}
The "social" object is extra platform metadata — keep it short. durationSec MUST be <= ${maxSec}. Think very hard: choose the act structure, plan every keyframe's camera/light/grade, verify the arc, then output ONLY the JSON object.`;
}

function parseSeedanceConcepts(text: string): SeedanceConcept[] {
  const stripped = text.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  const raw = JSON.parse(stripped) as unknown;
  let arr: SeedanceConcept[] = [];
  if (Array.isArray(raw)) arr = raw as SeedanceConcept[];
  else if (raw && typeof raw === "object") {
    const firstArray = Object.values(raw as Record<string, unknown>).find(v => Array.isArray(v));
    if (firstArray) arr = firstArray as SeedanceConcept[];
  }
  return arr
    .filter(c => c && typeof c.seedancePrompt === "string" && c.seedancePrompt.trim().length > 0)
    .slice(0, REEL_COUNT);
}

interface ReproPrompt { sceneName?: string; visualPrompt?: string; negativePrompt?: string }

// Build a still keyframe prompt for the Seedance START FRAME. Prefers a forensic
// Brand Visual DNA reproduction prompt when available; falls back to the CARE hook beat.
function buildKeyframePrompt(c: SeedanceConcept, repro?: ReproPrompt | null): { prompt: string; negative?: string } {
  const ctx = c.care?.context?.trim();
  const hook = c.care?.action?.[0];
  const hookText = hook ? `Opening frame: ${[hook.camera, hook.action].filter(Boolean).join(" — ")}.` : "";
  if (repro?.visualPrompt?.trim()) {
    return {
      prompt: `${repro.visualPrompt.trim()}\n\nThis is the OPENING HERO FRAME for a vertical 9:16 reel. ${hookText} ${ctx ?? ""}`.trim(),
      negative: repro.negativePrompt?.trim(),
    };
  }
  const base = `Reproduce the OPENING HERO FRAME of this product video as a single vertical 9:16 still image. ${ctx ?? ""} ${hookText}`.trim();
  return {
    prompt: `${base}

CRITICAL: keep the product in the supplied reference image(s) EXACTLY as-is — identical shape, proportions, colour, material, hardware, logo and printed text. NEVER redesign, restyle, recolour, resize or regenerate the product. Build only the scene, light, surface and background around it. No on-image text overlay.`,
  };
}

function aspectFromParams(a?: string): FalAspect {
  if (a === "1:1") return "1:1";
  if (a === "16:9") return "16:9";
  return "9:16";
}

const GEMINI_TEXT_MODELS = geminiTextModels();

async function callGeminiBriefs(system: string, user: string, key: string): Promise<string> {
  let lastErr = "";
  for (const model of GEMINI_TEXT_MODELS) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 16000, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
    });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (res.ok) {
        const decoded = (await res.json()) as Record<string, unknown>;
        const candidates = (decoded.candidates as Array<Record<string, unknown>>) ?? [];
        const text = String(((candidates[0]?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>)?.[0]?.text ?? "");
        if (text) return text;
        lastErr = `${model}: empty response`;
        break;
      }
      lastErr = `Gemini HTTP ${res.status}`;
      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 3000));
        continue;
      }
      break;
    }
  }
  throw new Error(lastErr || "Gemini request failed after retries");
}

function summarizeVisualDna(profile: Record<string, unknown> | undefined): string {
  if (!profile) return "";
  const color = profile.color as Record<string, unknown> | undefined;
  const palette = Array.isArray(color?.palette) ? (color!.palette as string[]).join(", ") : "";
  const lighting = profile.lighting as Record<string, unknown> | undefined;
  const photography = profile.photography as Record<string, unknown> | undefined;
  const mood = profile.mood as Record<string, unknown> | undefined;
  const avoid = Array.isArray(profile.avoid) ? (profile.avoid as string[]).slice(0, 6).join("; ") : "";
  const parts: string[] = [];
  if (profile.summary) parts.push(`Look: ${String(profile.summary)}`);
  if (palette) parts.push(`Palette (hex): ${palette}`);
  if (lighting?.source) parts.push(`Lighting: ${[lighting.source, lighting.direction, lighting.quality, lighting.timeOfDayFeel].filter(Boolean).join(", ")}`);
  if (photography?.shotTypes) parts.push(`Photography: ${[Array.isArray(photography.shotTypes) ? (photography.shotTypes as string[]).join("/") : "", photography.cameraAngle, photography.depthOfField].filter(Boolean).join(", ")}`);
  if (mood?.primary) parts.push(`Mood: ${String(mood.primary)}`);
  if (avoid) parts.push(`Avoid: ${avoid}`);
  return parts.join("\n");
}

async function generateSeedanceConcepts(opts: {
  geminiKey: string;
  mode: VideoMode;
  productName: string;
  brand: string;
  category: string;
  painPoints: string[];
  posts: unknown[];
  analysisText: string;
  visualDnaSummary: string;
  brandVisualProfile?: Record<string, unknown>;
  maxSec: number;
}): Promise<SeedanceConcept[]> {
  const { geminiKey, mode, productName, brand, category, painPoints, posts, analysisText, visualDnaSummary, brandVisualProfile, maxSec } = opts;
  const system = seedance2SystemPrompt(mode, maxSec);
  const dnaJson = brandVisualProfile ? JSON.stringify(brandVisualProfile) : (visualDnaSummary || "none — infer from category");
  const label = mode === "instagram" ? "Instagram posts" : "Meta ads";

  const userMessage = `Product to film: "${productName}" by ${brand}${category ? ` (${category})` : ""}
Key features: ${painPoints.slice(0, 3).join("; ") || "infer from the brand context"}
Customer pain points: ${painPoints.slice(0, 5).join("; ") || "n/a"}

Brand visual profile (reuse its palette/lighting/mood; or "none — infer from category"):
${dnaJson}

Creative brief / brand profile:
${analysisText ? analysisText.slice(0, 1200) : "none — design an appropriate spine"}

The brand's recent ${label} (diagnose winning hooks, formats, engagement patterns — be evidence-bound):
${JSON.stringify(posts.slice(0, 15), null, 2)}

Specs: aspectRatio=9:16; durationSec=${maxSec}; fps=24; voiceover=${mode === "instagram" ? "no" : "no"}
Pacing: balanced
Number of concepts: ${REEL_COUNT}

Now return the JSON object of concept(s).`;

  const raw = await callGeminiBriefs(system, userMessage, geminiKey);
  const concepts = parseSeedanceConcepts(raw);
  if (concepts.length) return concepts;
  throw new Error(`Gemini returned no reel concepts (raw: ${raw.slice(0, 160)})`);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  const geminiKey = process.env.GEMINI_API_KEY ?? "";

  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const mode = (body.mode === "meta_ad" ? "meta_ad" : "instagram") as VideoMode;
  // Keyframe (character + scene) generation is forced to Seedream 5 Pro in the backend.
  const imageModel = "seedream-5-pro" as const;
  const videoModel = normalizeVideoModel(body.videoModel).id;
  // Ad length: 15s (default) or 30s — Seedance 2.5 renders up to 30s natively.
  const durationSeconds = Number(body.durationSeconds) === 30 ? 30 : 15;

  const rawUrls = body.imageDataUrls ?? body.imageDataUrl;
  const imageDataUrls = (Array.isArray(rawUrls) ? rawUrls : rawUrls ? [rawUrls] : [])
    .map(u => String(u))
    .filter(u => u.startsWith("data:image/"));

  const productName = String(body.productName ?? "Product");
  const brand = String(body.brand ?? "Brand");
  const category = String(body.category ?? "");
  const painPoints = (body.painPoints as string[] | undefined) ?? [];
  const posts = (body.posts as unknown[] | undefined) ?? [];
  const analysisText = String(body.analysisText ?? "");
  const brandVisualProfile = (body.brandVisualProfile as Record<string, unknown> | undefined) ?? undefined;
  const reproductionPrompts = (body.reproductionPrompts as ReproPrompt[] | undefined)
    ?.filter(p => p && typeof p.visualPrompt === "string" && p.visualPrompt.trim().length > 0) ?? [];

  if (!imageDataUrls.length) {
    return res.status(400).json({ error: "imageDataUrls must include at least one valid product image data URL" });
  }
  if (imageDataUrls.length > 6) {
    return res.status(400).json({ error: "Maximum 6 product reference images allowed" });
  }

  // Reels are vertical 9:16; Meta video ads also render vertical for feed/Reels placement.
  const aspect: FalAspect = "9:16";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (u: GeneratedVideoUpdate) => { res.write(`data: ${JSON.stringify(u)}\n\n`); };

  try {
    send({ phase: "analyzing", message: "Reading brand DNA and storyboarding reels…" });

    const visualDnaSummary = summarizeVisualDna(brandVisualProfile);

    let concepts: SeedanceConcept[];
    try {
      concepts = await generateSeedanceConcepts({ geminiKey, mode, productName, brand, category, painPoints, posts, analysisText, visualDnaSummary, brandVisualProfile, maxSec: durationSeconds });
    } catch (e) {
      console.error("[generate-video] Seedance concept generation failed:", e);
      send({ phase: "error", message: `Could not storyboard reels: ${String(e)}` });
      res.end();
      return;
    }

    if (!concepts.length) {
      send({ phase: "error", message: "No reel concepts were generated." });
      res.end();
      return;
    }

    for (let r = 0; r < concepts.length; r++) {
      const reel = concepts[r];
      const reelAspect = aspectFromParams(reel.params?.aspectRatio) || aspect;
      send({ phase: "shots", reelIndex: r, concept: reel.concept, shotCount: 1, message: `Reel ${r + 1}: reproducing the opening keyframe…` });

      // STEP: reproduce a single on-brand opening keyframe (Seedance start frame)
      // from the product photo(s), grounded in the CARE storyboard's hook beat.
      let startFrame: string | null = null;
      try {
        const repro = reproductionPrompts.length ? reproductionPrompts[r % reproductionPrompts.length] : null;
        const { prompt: keyPrompt, negative: keyNeg } = buildKeyframePrompt(reel, repro);
        const fullKeyframePrompt = keyNeg ? `${keyPrompt}\n\nDo not: ${keyNeg}.` : keyPrompt;
        const img = await editWithNanoBananaPro(falKey, imageDataUrls, fullKeyframePrompt, { aspect: reelAspect, model: imageModel });
        startFrame = img.url;
        send({ phase: "shots", reelIndex: r, shotIndex: 0, concept: "Opening hero", shotUrl: img.url, message: `Reel ${r + 1}: keyframe ready` });
      } catch (e) {
        send({ phase: "error", reelIndex: r, shotIndex: 0, message: `Reel ${r + 1} keyframe failed: ${String(e)}` });
      }

      if (!startFrame) {
        send({ phase: "error", reelIndex: r, message: `Reel ${r + 1}: no usable keyframe, skipping render.` });
        continue;
      }

      // STEP: feed the keyframe + CARE seedancePrompt into Seedance (<=30s on 2.5).
      send({ phase: "rendering", reelIndex: r, concept: reel.concept, message: `Reel ${r + 1}: rendering ${durationSeconds}s video with Seedance…` });
      try {
        const duration = Math.max(4, Math.min(durationSeconds, Math.round(reel.params?.durationSec ?? durationSeconds)));
        const prompt = reel.negativePrompt
          ? `${reel.seedancePrompt}\n\nAvoid: ${reel.negativePrompt}.`
          : reel.seedancePrompt;
        const video = await generateVideoWithSeedance(falKey, {
          imageUrl: startFrame,
          endImageUrl: null,
          prompt,
          durationSec: duration,
          aspect: reelAspect,
          resolution: "720p",
          model: videoModel,
        });
        send({
          phase: "video",
          reelIndex: r,
          concept: reel.concept,
          videoUrl: video.url,
          posterUrl: startFrame,
          durationSeconds: duration,
          caption: reel.social?.caption,
          headline: reel.social?.headline,
          primaryText: reel.social?.primaryText,
          cta: reel.social?.cta,
        });
      } catch (e) {
        send({ phase: "error", reelIndex: r, message: `Reel ${r + 1} render failed: ${String(e)}` });
      }
    }

    send({ phase: "done", message: "All reels generated." });
  } catch (err) {
    send({ phase: "error", message: String(err) });
  } finally {
    res.end();
  }
  return;
}
