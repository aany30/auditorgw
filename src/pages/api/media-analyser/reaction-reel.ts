/**
 * Reaction Reel v2 — split-screen reel (SSE, one stream).
 *
 *   script/theme → Gemini script + ordered beats (each with a visual keyword)
 *   → avatar image (Seedream, optional reference images) ∥ voice (uploaded audio, else TTS)
 *   → TOP half: one stock clip per beat as 3–5s hard cuts (∥) · BOTTOM half: Kling AI-Avatar
 *     (image + audio → lip-synced talking video in ONE render — no 422, no separate lip-sync)
 *   → self-hosted ffmpeg: stack stock (top) + avatar (bottom) + voice → final reel.
 *
 * Replaces the old Seedance circular-PiP reel (photorealistic presenter kept hitting ByteDance's
 * "real person" 422). AI-Avatar is a single non-Seedance render, so it lip-syncs AND fits the
 * function budget (motion-control + a separate lip-sync was two renders → timeout).
 * Requires FAL_KEY + GEMINI_API_KEY + PEXELS_API_KEY. Composite is in-process ffmpeg (no Creatomate).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import {
  generateImageWithNanoBananaPro, generateElevenLabsSpeech, generateKokoroSpeech, cloneVoiceWithF5TTS,
  generateKlingAiAvatar, transcribeAudioWithFal, generateReferenceVideoWithSeedance,
  uploadToFalStorage, type FalAspect, type FalAudio,
} from "@/lib/media-analyser/fal";
import { resolveElevenVoice, resolveTtsVoice } from "@/lib/media-analyser/generation-models";
import { callVisionLLM, type VisionUserPart } from "@/lib/media-analyser/vision-llm";
import { geminiVisionModels } from "@/lib/media-analyser/gemini-models";
import { pickBrollClips, BROLL_ENABLED } from "@/lib/media-analyser/avatar-broll";
import { stackReelWithFfmpeg, studioMultiCamReel, concatAudioWithFfmpeg, trimAudioWithFfmpeg } from "@/lib/media-analyser/ffmpeg-compose";
import { generateAvatarKeyframe, generateStudioAngleKeyframes } from "@/lib/media-analyser/avatar-character";

/** Synthesize the voiceover: Kokoro (Indian voices) or ElevenLabs (US/UK/AU), picked by voiceId. */
async function synthVoice(
  falKey: string,
  text: string,
  opts: { voiceId?: string; language: string; voiceCharacteristics: string; genderHint: string },
): Promise<FalAudio> {
  const entry = opts.voiceId ? resolveTtsVoice(opts.voiceId) : null;
  if (entry?.provider === "kokoro") return generateKokoroSpeech(falKey, { text, voice: entry.ref });
  const voice = entry?.provider === "eleven"
    ? entry.ref
    : resolveElevenVoice(opts.language, opts.voiceCharacteristics || opts.genderHint);
  return generateElevenLabsSpeech(falKey, { text, voice, speed: 1.05 });
}

/** Map the free-text language field to a Whisper ISO-639-1 hint so Hindi/Hinglish transcribes cleanly. */
function langToWhisper(language: string): string | undefined {
  const l = language.toLowerCase();
  if (!l) return undefined;
  if (/hindi|hinglish|\bhi\b|देवनागरी|हिन/.test(l)) return "hi";
  if (/tamil|\bta\b/.test(l)) return "ta";
  if (/telugu|\bte\b/.test(l)) return "te";
  if (/marathi|\bmr\b/.test(l)) return "mr";
  if (/bengali|bangla|\bbn\b/.test(l)) return "bn";
  if (/punjabi|\bpa\b/.test(l)) return "pa";
  if (/gujarati|\bgu\b/.test(l)) return "gu";
  if (/kannada|\bkn\b/.test(l)) return "kn";
  if (/english|\ben\b/.test(l)) return "en";
  return undefined; // unknown → let Whisper auto-detect
}

export const config = { maxDuration: 300 };

// Cap the reel length. The Kling AI-Avatar render dominates wall-time; on the STANDARD tier a
// ~20s clip renders in ~8 min, which (with the parallel top build + ~90s ffmpeg composite) fits
// the 800s function budget. The PRO tier is ~11+ min even at 20s and times out — use it only via
// a decoupled/polled background job for longer or higher-fidelity reels.
const KLING_AVATAR_MODEL = "fal-ai/kling-video/v1/standard/ai-avatar";

interface Update {
  phase: "script" | "background" | "avatar" | "voiceover" | "reference" | "animating" | "lipsync" | "compositing" | "done" | "error";
  message?: string; script?: string; topVideoUrl?: string; avatarUrl?: string; videoUrl?: string; error?: string;
}

const SCRIPT_SYSTEM = `You are a short-form reel scriptwriter AND b-roll director. From the user's topic/theme:
(1) Write a punchy spoken voiceover script (~18-20s, strong hook first, conversational, no stage directions/emojis/markdown).
(2) Break that SAME script, in order, into 7-9 short beats (~2-3s of speech each). For each beat give:
   - "text": its exact text slice (concatenating all beats must reproduce the script), and
   - "keyword": a CONCRETE, LITERAL, filmable stock-footage query for that beat — a real subject + action + setting.
CRITICAL RULES for the keywords:
   • VARIETY OF SHOT TYPE: consecutive beats must look CLEARLY different — vary across shot types, not just different clips of the same action. Mix: product close-ups, a person using/holding it, wider travel/environment scenes, and problem/pain shots. Do NOT make them all the same action (e.g. NOT all "packing a suitcase").
   • SUBJECT-FOCUSED: show the TOPIC'S actual objects/moments, not the generic setting. For a suitcase topic, span DIFFERENT shot types like: close-up of a hardshell suitcase surface, a traveler wheeling luggage through an airport, a suitcase on a baggage carousel, loading a suitcase into a car trunk, a damaged/cracked cheap bag, a couple walking with suitcases on a street, a suitcase in a hotel room — a DIFFERENT kind of shot each beat.
   • NEVER abstract ideas ("peace of mind", "durability", "confidence", "quality") — they return irrelevant footage. Pick something a stock library literally has.
Return ONLY JSON: {"script":"...","segments":[{"text":"...","keyword":"..."}]}.`;
const SCRIPT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    script: { type: "string" },
    segments: {
      type: "array",
      items: { type: "object", properties: { text: { type: "string" }, keyword: { type: "string" } }, required: ["text", "keyword"], additionalProperties: false },
    },
  },
  required: ["script", "segments"], additionalProperties: false,
};

// For a FIXED script (uploaded-audio transcript, or a script the user typed) — beats only, no rewrite.
const SEGMENTS_SYSTEM = `You are a b-roll director. You are given a FIXED spoken script — do NOT rewrite or change it. Break it, in order, into 7-9 short beats. For each beat return:
- "text": its exact text slice from the script (concatenating all beats must reproduce the script), and
- "keyword": a CONCRETE, LITERAL, filmable stock-footage query for what to SHOW at that moment (real subject + action + setting). VARY the shot type across beats (close-up / person using it / wider scene / problem shot); never all the same action. NEVER abstract ideas ("peace of mind","durability"). Pick something a stock library literally has.
Return ONLY JSON: {"segments":[{"text":"...","keyword":"..."}]}.`;
const SEGMENTS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { segments: SCRIPT_SCHEMA.properties && (SCRIPT_SCHEMA as { properties: { segments: unknown } }).properties.segments },
  required: ["segments"], additionalProperties: false,
};

const wc = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const isUrlLike = (u: string) => u.startsWith("data:") || u.startsWith("http");

/** Split text into chunks of <= maxChars (F5-TTS length limit): by sentence, splitting any long
 *  sentence by words, then merging small pieces back up to maxChars. */
function chunkText(text: string, maxChars: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]*/g) ?? [clean];
  const pieces: string[] = [];
  for (const s of sentences) {
    const sent = s.trim();
    if (!sent) continue;
    if (sent.length <= maxChars) { pieces.push(sent); continue; }
    let cur = "";
    for (const w of sent.split(" ")) {
      if ((cur + " " + w).trim().length > maxChars && cur) { pieces.push(cur.trim()); cur = w; }
      else cur = (cur + " " + w).trim();
    }
    if (cur.trim()) pieces.push(cur.trim());
  }
  const merged: string[] = [];
  for (const p of pieces) {
    if (merged.length && (merged[merged.length - 1] + " " + p).length <= maxChars) merged[merged.length - 1] += " " + p;
    else merged.push(p);
  }
  return merged.length ? merged : [clean];
}

/** Split a script into short caption cues (~4 words) timed evenly by word count over the voice. */
function buildCaptions(script: string, totalSec: number): { text: string; start: number; end: number }[] {
  const words = script.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length || totalSec <= 0) return [];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 4) chunks.push(words.slice(i, i + 4).join(" "));
  const total = words.length;
  let t = 0;
  return chunks.map(text => {
    const d = (text.split(" ").length / total) * totalSec;
    const cue = { text, start: t, end: Math.min(totalSec, t + d) };
    t += d;
    return cue;
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured." });
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured." });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const mode = body.mode === "script" ? "script" : "topic";
  const topic = String(body.topic ?? "").trim().slice(0, 600);
  const providedScript = String(body.script ?? "").trim().slice(0, 1200);
  const avatarDesc = String(body.avatarDesc ?? body.presenter ?? "").trim().slice(0, 400) || "a friendly, professional creator talking to camera";
  const aspect = "9:16" as FalAspect;
  const language = String(body.language ?? "").trim().slice(0, 80);
  const voiceCharacteristics = String(body.voiceCharacteristics ?? "").trim().slice(0, 200);
  const avatarImageDataUrls = (Array.isArray(body.avatarImageDataUrls) ? body.avatarImageDataUrls : [])
    .map(u => String(u)).filter(isUrlLike).slice(0, 10);
  const environment = String(body.environment ?? "").trim().slice(0, 240); // user-defined backdrop/scene
  const wardrobe = String(body.wardrobe ?? "").trim().slice(0, 240);       // user-defined clothing
  const audioInput = String(body.audioDataUrl ?? body.audioUrl ?? "").trim();
  const voiceSample = String(body.voiceSampleDataUrl ?? body.voiceSampleUrl ?? "").trim(); // creator voice to clone
  // Reel length cap: 15s (default) or 30s.
  const reelMax = [15, 20, 30].includes(Number(body.maxSeconds)) ? Number(body.maxSeconds) : 15;
  // Reel style: "broll" (split-screen b-roll on top) or "studio" (full-frame speaker, multi-angle cuts).
  const reelStyle = body.reelStyle === "studio" ? "studio" : "broll";
  const voiceId = String(body.voiceId ?? "").trim() || undefined; // TTS voice (Indian Kokoro or ElevenLabs)
  const pipeline = body.pipeline === "seedance" ? "seedance" : "kling"; // "seedance" = Seedance 2.5 ref-to-video

  // Studio style renders a full-frame speaker (no b-roll); broll style needs the library populated.
  if (reelStyle !== "studio" && !BROLL_ENABLED) return res.status(500).json({ error: "The avatar b-roll library is empty — ingest clips into avatar-broll.json first." });

  if (!audioInput && mode === "topic" && !topic) return res.status(400).json({ error: "Enter a topic/theme, or upload an audio." });
  if (!audioInput && mode === "script" && !providedScript) return res.status(400).json({ error: "Enter a script, or upload an audio." });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (u: Update) => res.write(`data: ${JSON.stringify(u)}\n\n`);

  try {
    // ── Seedance 2.5 pipeline (opt-in) — reference-to-video of the uploaded character with
    //    Seedance-generated audio. One native clip (up to 30s), no Kling / TTS. ──
    if (pipeline === "seedance") {
      if (!avatarImageDataUrls.length) { send({ phase: "error", error: "Upload a character image to use Seedance." }); res.end(); return; }
      send({ phase: "avatar", message: `Preparing ${avatarImageDataUrls.length} character reference${avatarImageDataUrls.length !== 1 ? "s" : ""}…` });
      // Seedance 2.5 uses many reference images for a more consistent character.
      const charUrls = await Promise.all(avatarImageDataUrls.map(u => uploadToFalStorage(falKey, u)));
      const spoken = providedScript.trim();
      const seedancePrompt =
        `The person in the reference image speaks directly to the camera like a presenter${spoken ? `, saying: "${spoken}"` : ""}. ` +
        `Keep the same face, hair and clothing as the reference. Natural mouth movement and expressions while talking, steady shoulders, ` +
        `upper-body talking-head framing, fixed camera, clean background.`;
      send({ phase: "animating", message: `Seedance 2.5 is filming a ${reelMax}s clip…` });
      const video = await generateReferenceVideoWithSeedance(falKey, {
        imageUrls: charUrls,
        prompt: seedancePrompt,
        unclampedDurationSec: reelMax,
        aspect: "9:16",
        resolution: "1080p",
        generateAudio: true,
        model: "seedance-2-5",
        seedanceProvider: "auto",
      });
      send({ phase: "done", videoUrl: video.url, script: spoken, message: "Done." });
      res.end();
      return;
    }

    // ── 1. audio-first (transcribe → the transcript IS the script) OR topic/script → segments ──
    let script = providedScript;
    let segments: { text: string; keyword: string }[] = [];
    let audioUrl = "";   // set here in audio mode; else in the voice step
    let speechSec = 0;
    let captionCues: { text: string; start: number; end: number }[] = [];

    if (audioInput) {
      // AUDIO MODE: the uploaded audio IS the voice. Transcribe it → drives the b-roll + captions.
      send({ phase: "voiceover", message: "Transcribing your audio…" });
      audioUrl = await uploadToFalStorage(falKey, audioInput);
      const tr = await transcribeAudioWithFal(falKey, audioUrl, langToWhisper(language));
      if (tr.text) script = tr.text;
      if (tr.cues.length) { captionCues = tr.cues; speechSec = tr.cues[tr.cues.length - 1].end; }
      // Cap the audio to the reel length BEFORE lip-sync.
      if (speechSec > reelMax + 0.5) {
        send({ phase: "voiceover", message: `Trimming audio to ${reelMax}s for the reel…` });
        audioUrl = await trimAudioWithFfmpeg(falKey, audioUrl, reelMax);
        captionCues = captionCues.filter(c => c.start < reelMax).map(c => ({ ...c, end: Math.min(c.end, reelMax) }));
        speechSec = reelMax;
      }
    }

    send({ phase: "script", message: "Picking background footage…" });
    {
      const langLine = language ? ` Language: ${language} (Roman transliteration for Hindi/Hinglish).` : "";
      if (script) {
        // Fixed script (uploaded-audio transcript / typed script) → beats only, do NOT rewrite it.
        const parts: VisionUserPart[] = [{ text: `Script (do not change it):\n${script}\n${langLine}\nReturn the JSON now.` }];
        const raw = await callVisionLLM(SEGMENTS_SYSTEM, parts, geminiKey, { jsonMode: true, responseSchema: SEGMENTS_SCHEMA, models: geminiVisionModels(), maxTokens: 900 });
        const m = raw.match(/\{[\s\S]*\}/);
        const obj = JSON.parse(m ? m[0] : raw) as { segments?: { text?: string; keyword?: string }[] };
        segments = (obj.segments ?? []).map(s => ({ text: String(s.text ?? "").trim(), keyword: String(s.keyword ?? "").trim() })).filter(s => s.keyword).slice(0, 12);
      } else {
        // Topic mode: write a script + beats.
        const parts: VisionUserPart[] = [{ text: `Topic / theme: ${topic}.${langLine}\nReturn the JSON now.` }];
        const raw = await callVisionLLM(SCRIPT_SYSTEM, parts, geminiKey, { jsonMode: true, responseSchema: SCRIPT_SCHEMA, models: geminiVisionModels(), maxTokens: 1100 });
        const m = raw.match(/\{[\s\S]*\}/);
        const obj = JSON.parse(m ? m[0] : raw) as { script?: string; segments?: { text?: string; keyword?: string }[] };
        script = String(obj.script ?? "").trim() || topic;
        segments = (obj.segments ?? []).map(s => ({ text: String(s.text ?? "").trim(), keyword: String(s.keyword ?? "").trim() })).filter(s => s.keyword).slice(0, 12);
      }
    }
    const maxWords = audioInput ? 400 : Math.round(130 * reelMax / 15);   // scale script length to the reel cap
    if (wc(script) > maxWords) script = script.split(/\s+/).slice(0, maxWords).join(" ");
    if (!segments.length) segments = [{ text: script, keyword: topic || avatarDesc }];
    send({ phase: "script", script, message: "Script ready." });

    // ── 2. avatar image (b-roll style only; studio generates 3 angles later) ──
    let avatarImg: { url: string } | null = null;
    let genderHint = "";
    if (reelStyle === "broll") {
      send({ phase: "avatar", message: "Generating the avatar…" });
      const avatarPrompt = `Photorealistic MEDIUM-WIDE shot of ${avatarDesc} SITTING AT A DESK/TABLE${wardrobe ? `, wearing ${wardrobe}` : ""}${environment ? `, in ${environment}` : ""}, filmed from a natural conversational distance (not a close-up). Full upper body visible — head with headroom, shoulders, chest, arms and hands on the desk; person and desk composed in the upper two-thirds of a tall vertical frame, room behind, soft ambient light, single person, sharp focus.`;
      if (avatarImageDataUrls.length) {
        // Reference photo → identity-locked podcast talking-head keyframe (img2img system prompt).
        const kf = await generateAvatarKeyframe(falKey, geminiKey, {
          referenceImages: avatarImageDataUrls,
          additionalDetail: [avatarDesc, wardrobe && `wearing ${wardrobe}`].filter(Boolean).join(", "),
          backdropStyle: environment || undefined,
          aspect: "1:1", // matches the bottom-half shape → minimal crop, preserves the seated framing
        });
        avatarImg = kf.image; genderHint = kf.gender;
      } else {
        avatarImg = await generateImageWithNanoBananaPro(falKey, avatarPrompt, { aspect: "1:1", resolution: "2K" });
      }
    }

    // ── 3. voice: audio mode already has the uploaded audio + transcript captions. Otherwise
    //        clone the creator's voice (F5-TTS) or use a preset voice matched to the avatar. ──
    if (!audioInput) {
      send({ phase: "voiceover", message: voiceSample ? "Cloning the creator's voice…" : "Recording the voiceover…" });
      if (voiceSample) {
        // F5-TTS zero-shot clone.
        try {
          const refUrl = await uploadToFalStorage(falKey, voiceSample);
          const chunks = chunkText(script, 150);
          const parts = await Promise.all(chunks.map(t => cloneVoiceWithF5TTS(falKey, { refAudioUrl: refUrl, text: t })));
          audioUrl = await concatAudioWithFfmpeg(falKey, parts.map(p => p.url));
          speechSec = Math.max(5, wc(script) / 2.4);
        } catch (e) {
          console.warn(`[reaction-reel] voice clone failed, using preset voice: ${e instanceof Error ? e.message : e}`);
          send({ phase: "voiceover", message: "Voice clone failed (needs a clear speech sample) — using a preset voice…" });
          const tts = await synthVoice(falKey, script, { voiceId, language, voiceCharacteristics, genderHint });
          audioUrl = tts.url;
          speechSec = tts.duration && tts.duration > 0 ? tts.duration : Math.max(5, wc(script) / 2.4);
        }
      } else {
        const tts = await synthVoice(falKey, script, { voiceId, language, voiceCharacteristics, genderHint });
        audioUrl = tts.url;
        speechSec = tts.duration && tts.duration > 0 ? tts.duration : Math.max(5, wc(script) / 2.4);
      }
    }
    if (!speechSec) speechSec = Math.max(5, wc(script) / 2.4);
    speechSec = Math.min(reelMax, speechSec);
    // Captions: transcript cues (audio mode, accurate word timings) else evenly-timed from the script.
    if (!captionCues.length) captionCues = buildCaptions(script, speechSec);
    captionCues = captionCues.filter(c => c.start < speechSec).map(c => ({ ...c, end: Math.min(c.end, speechSec) }));

    const klingTimeout = reelMax >= 30 ? 720_000 : 660_000;
    let finalUrl: string;
    let previewAvatar = "";

    if (reelStyle === "studio") {
      // ── STUDIO: 3 identity-locked camera angles → 3 Kling lip-syncs (same audio, time-aligned)
      //    → multi-cam cut full-frame with captions. No b-roll. ──
      send({ phase: "avatar", message: "Generating 3 studio camera angles…" });
      const angles = await generateStudioAngleKeyframes(falKey, {
        referenceImages: avatarImageDataUrls,
        wardrobe: wardrobe || undefined,
        studioStyle: environment || undefined,
        aspect: "9:16",
      });
      send({ phase: "animating", message: "Filming the speaker from 3 angles (lip-sync)…" });
      const angleVideos = await Promise.all(angles.map(a =>
        generateKlingAiAvatar(falKey, { imageUrl: a.url, audioUrl, model: KLING_AVATAR_MODEL, timeoutMs: klingTimeout })));
      previewAvatar = angleVideos[0]?.url ?? "";
      send({ phase: "compositing", message: "Cutting the multi-camera studio reel…" });
      finalUrl = await studioMultiCamReel(falKey, {
        angleVideoUrls: angleVideos.map(v => v.url),
        audioUrl, durationSec: speechSec, captions: captionCues, cutEverySec: 6.5,
      });
    } else {
      // ── B-ROLL: top b-roll (≤3s beat-matched cuts) ∥ talking avatar (Kling), then vstack. ──
      send({ phase: "background", message: "Cutting stock footage + animating the avatar…" });
      const totalWords = segments.reduce((n, s) => n + Math.max(1, wc(s.text || s.keyword)), 0);
      let acc = 0;
      const beats = segments.map(s => {
        const d = (Math.max(1, wc(s.text || s.keyword)) / totalWords) * speechSec;
        const b = { keyword: s.keyword, start: acc, end: acc + d }; acc += d; return b;
      });
      const cuts = Math.max(2, Math.ceil(speechSec / 3));
      const slotDur = speechSec / cuts;
      const buildTopHalf = async (): Promise<{ url: string; durationSec: number }[]> => {
        const pool = pickBrollClips(beats.map(b => b.keyword), cuts, topic || avatarDesc);
        if (!pool.length) throw new Error("No b-roll clips available in the library.");
        return Array.from({ length: cuts }, (_, i) => ({ url: pool[i % pool.length], durationSec: slotDur }));
      };
      const [topClips, avatarClip] = await Promise.all([
        buildTopHalf(),
        generateKlingAiAvatar(falKey, { imageUrl: avatarImg!.url, audioUrl, model: KLING_AVATAR_MODEL, timeoutMs: klingTimeout }),
      ]);
      previewAvatar = avatarClip.url;
      send({ phase: "animating", avatarUrl: avatarClip.url, message: `Top ready (${cuts} × ${slotDur.toFixed(1)}s cuts) + avatar lip-synced.` });
      send({ phase: "compositing", message: "Compositing the reel…" });
      finalUrl = await stackReelWithFfmpeg(falKey, {
        topClips, bottomVideoUrl: avatarClip.url, audioUrl, durationSec: speechSec, captions: captionCues,
      });
    }

    send({ phase: "done", videoUrl: finalUrl, avatarUrl: previewAvatar, script, message: "Done." });
  } catch (e) {
    send({ phase: "error", error: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
}
