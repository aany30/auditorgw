/** UGC Playground · one-shot orchestrator. Feature-reel flow: a scraped product +
 *  ONE chosen feature/use-case → a 15s reel where the creator explains THAT feature
 *  while the product itself is shown (product images fed as extra Seedance references,
 *  so dynamic product close-ups cut in around the talking creator). Streams SSE. */
import type { NextApiRequest, NextApiResponse } from "next";
import { uploadToFalStorage } from "@/lib/media-analyser/fal";
import { runFeatureScript, runPersonas, bestPersona, runVoice, renderSeedanceVideo } from "@/lib/media-analyser/ugc-playground/stages";
import type { GeneratedScript, GeneratedPersona } from "@/lib/media-analyser/ugc-playground/types";

export const config = { maxDuration: 300 };

export interface UGCNewUpdate {
  phase: "script" | "persona" | "voice" | "video" | "done" | "error";
  message?: string;
  feature?: string;
  script?: string; scripts?: GeneratedScript[];
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
  const productDescription = String(body.productDescription ?? "").trim();
  const featureLabel = String(body.featureLabel ?? "").trim();
  const featureAngle = String(body.featureAngle ?? "").trim();
  const timeOfDay = String(body.timeOfDay ?? "18:00").trim();
  const productImageDataUrls = (Array.isArray(body.productImageDataUrls) ? body.productImageDataUrls : []).map(String).filter((u) => u.startsWith("data:image/")).slice(0, 3);

  if (!productDescription) return res.status(400).json({ error: "Scan a product first." });
  if (!featureLabel) return res.status(400).json({ error: "Pick a feature to cover (or type your own)." });
  if (productImageDataUrls.length < 2) return res.status(400).json({ error: "Need at least 2 product images — re-scan or add your own." });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (u: UGCNewUpdate) => res.write(`data: ${JSON.stringify(u)}\n\n`);

  try {
    // 1 — feature-focused script
    send({ phase: "script", message: `Writing a 15s script about "${featureLabel}"…`, feature: featureLabel });
    const script = await runFeatureScript({ productDescription, featureLabel, featureAngle });
    if (!script.content) throw new Error("No usable script was generated.");
    send({ phase: "script", message: "Script ready.", feature: featureLabel, script: script.content, scripts: [script] });

    // 2 — personas (creator that fits the feature pitch), pick best-QC
    send({ phase: "persona", message: "Casting a creator and rendering portraits…" });
    const personas = await runPersonas({ falKey, productImageDataUrls, productDescription, audienceLabel: "", audienceDescription: productDescription, scriptAngle: "feature", scriptContent: script.content });
    const persona = bestPersona(personas);
    if (!persona?.imageDataUrl) throw new Error("No usable persona portrait was generated — try different product images.");
    send({ phase: "persona", message: `Cast ${persona.name}.`, personas, persona });

    // 3 — voiceover
    send({ phase: "voice", message: "Generating the voiceover…" });
    let audioUrl = "";
    try { const v = await runVoice({ falKey, personaName: persona.name, personaDescription: persona.description, scriptContent: script.content }); audioUrl = v.audioUrl; send({ phase: "voice", message: "Voiceover ready.", audioUrl }); }
    catch (e) { send({ phase: "voice", message: `Voiceover skipped (${e instanceof Error ? e.message : e}) — rendering silent.` }); }

    // 4 — video: creator explains the feature while the product is shown around them
    send({ phase: "video", message: "Rendering the reel on Seedance 2.5…" });
    const [portraitUrl, ...productImageUrls] = await Promise.all([
      uploadToFalStorage(falKey, persona.imageDataUrl),
      ...productImageDataUrls.map((d) => uploadToFalStorage(falKey, d).catch(() => "")),
    ]);
    const { videoUrl, usedModel } = await renderSeedanceVideo(
      { falKey, portraitUrl, productImageUrls: productImageUrls.filter(Boolean), feature: featureLabel, voiceoverUrl: audioUrl, characterName: persona.name, characterDescription: persona.description, scriptContent: script.content, timeOfDay },
      () => send({ phase: "video", message: "Seedance 2.5 declined the AI face — falling back to Seedance 2.0…" }),
    );
    if (!videoUrl) throw new Error("Seedance did not return a finished video in time.");
    send({ phase: "video", message: `Rendered on ${usedModel}.`, provider: "seedance", videoUrl });

    send({ phase: "done", message: "Feature reel ready." });
  } catch (e) {
    send({ phase: "error", message: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
}
