/** UGC New · one-shot orchestrator. Runs the full pipeline server-side and streams
 *  progress + output as SSE. Auto-selects the script angle + best-QC persona. */
import type { NextApiRequest, NextApiResponse } from "next";
import { uploadToFalStorage } from "@/lib/media-analyser/fal";
import { runIntake, runBrief, runScripts, runPersonas, bestPersona, runVoice, renderSeedanceVideo } from "@/lib/media-analyser/ugc-new/stages";
import type { GeneratedScript, GeneratedPersona } from "@/lib/media-analyser/ugc-new/types";

export const config = { maxDuration: 300 };

export interface UGCNewUpdate {
  phase: "intake" | "brief" | "scripts" | "persona" | "voice" | "video" | "done" | "error";
  message?: string;
  audienceLabel?: string; audienceDescription?: string; productDescription?: string; missing?: string[];
  brief?: string;
  scripts?: GeneratedScript[]; chosenAngle?: string; script?: string;
  personas?: GeneratedPersona[]; persona?: GeneratedPersona;
  audioUrl?: string;
  provider?: string; videoUrl?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });
  if (!(process.env.GEMINI_API_KEY ?? "")) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const pastedText = String(body.pastedText ?? "").trim();
  const productUrl = String(body.productUrl ?? "").trim();
  const pdfDataUrl = typeof body.pdfDataUrl === "string" && body.pdfDataUrl.startsWith("data:application/pdf") ? body.pdfDataUrl : "";
  const productImageDataUrls = (Array.isArray(body.productImageDataUrls) ? body.productImageDataUrls : []).map(String).filter((u) => u.startsWith("data:image/")).slice(0, 3);
  const steering = String(body.steering ?? "").trim();
  const timeOfDay = String(body.timeOfDay ?? "18:00").trim();
  const requestedAngle = String(body.angle ?? "").trim();

  if (!pastedText && !pdfDataUrl) return res.status(400).json({ error: "Paste some material or attach a PDF to start." });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (u: UGCNewUpdate) => res.write(`data: ${JSON.stringify(u)}\n\n`);

  try {
    // 0 — intake
    send({ phase: "intake", message: "Reading your material…" });
    const intake = await runIntake({ pastedText, productUrl, pdfDataUrl, imageCount: productImageDataUrls.length });
    send({ phase: "intake", message: "Audience & product extracted.", audienceLabel: intake.audienceLabel, audienceDescription: intake.audienceDescription, productDescription: intake.productDescription, missing: intake.missing });

    // 1 — brief
    send({ phase: "brief", message: "Researching the market and writing the brief…" });
    const { brief } = await runBrief({ productDescription: intake.productDescription, otherInfo: intake.otherInfo, productUrl: intake.productUrl, steering, imageCount: productImageDataUrls.length, pdfDataUrl });
    send({ phase: "brief", message: "Creative brief ready.", brief });

    // 2 — scripts (pick angle)
    send({ phase: "scripts", message: "Writing 3 script angles…" });
    const scripts = await runScripts({ brief, audienceLabel: intake.audienceLabel, audienceDescription: intake.audienceDescription });
    const chosen = scripts.find(s => s.angle === requestedAngle) ?? scripts.find(s => s.content) ?? scripts[0];
    send({ phase: "scripts", message: `Using the ${chosen?.label ?? "first"} angle.`, scripts, chosenAngle: chosen?.angle, script: chosen?.content });
    if (!chosen?.content) throw new Error("No usable script was generated.");

    // 3 — personas (pick best)
    if (productImageDataUrls.length < 2) throw new Error("Add 2-3 product images so the persona can hold the product.");
    send({ phase: "persona", message: "Casting creators and rendering portraits…" });
    const personas = await runPersonas({ falKey, productImageDataUrls, productDescription: intake.productDescription, audienceLabel: intake.audienceLabel, audienceDescription: intake.audienceDescription, scriptAngle: chosen.angle, scriptContent: chosen.content });
    const persona = bestPersona(personas);
    if (!persona?.imageDataUrl) throw new Error("No usable persona portrait was generated — try different product images.");
    send({ phase: "persona", message: `Cast ${persona.name}.`, personas, persona });

    // 4 — voice
    send({ phase: "voice", message: "Generating the voiceover…" });
    let audioUrl = "";
    try { const v = await runVoice({ falKey, personaName: persona.name, personaDescription: persona.description, scriptContent: chosen.content }); audioUrl = v.audioUrl; send({ phase: "voice", message: "Voiceover ready.", audioUrl }); }
    catch (e) { send({ phase: "voice", message: `Voiceover skipped (${e instanceof Error ? e.message : e}) — rendering silent.` }); }

    // 5 — video (ByteDance ARK Seedance 2.5 primary; FAL queue fallback)
    send({ phase: "video", message: "Rendering the video on ByteDance Seedance 2.5…" });
    const portraitUrl = await uploadToFalStorage(falKey, persona.imageDataUrl);
    const { videoUrl, usedModel } = await renderSeedanceVideo(
      { falKey, portraitUrl, voiceoverUrl: audioUrl, characterName: persona.name, characterDescription: persona.description, scriptContent: chosen.content, timeOfDay },
      () => send({ phase: "video", message: "ByteDance ARK unavailable — falling back to the FAL Seedance queue…" }),
    );
    if (!videoUrl) throw new Error("Seedance did not return a finished video in time.");
    send({ phase: "video", message: `Rendered on ${usedModel}.`, provider: "seedance", videoUrl });

    send({ phase: "done", message: "UGC video ready." });
  } catch (e) {
    send({ phase: "error", message: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
}
