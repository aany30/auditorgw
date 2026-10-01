/**
 * Stage 05 -- QC Gate. Given a rendered video URL, upload it to the Gemini Files
 * API and run the QC inspector against the brief + Stage-02 plan.
 *
 * Decoupled from the render so each call is short-lived.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeGeminiModel } from "@/lib/media-analyser/gemini-models";
import { deleteGeminiFile, uploadVideoToGeminiFiles } from "@/lib/media-analyser/gemini-files";
import { runQc } from "@/lib/media-analyser/ugc/qc";
import { DirectorPlanSchema, type QcResult, type UGCDirectorPlan } from "@/lib/media-analyser/ugc/types";

export const config = { maxDuration: 300 };

export interface UGCQcResponse {
  qcDone: boolean;
  qcPass: boolean;
  qcSummary: string;
  qcResult?: QcResult;
}

/** Resolve the QC model list -- strong reasoning preferred, env-overridable. */
function qcModels(): string[] {
  const override = process.env.GEMINI_QC_MODEL ?? process.env.GEMINI_DIRECTOR_MODEL;
  if (override) return [normalizeGeminiModel(override)];
  return [normalizeGeminiModel(process.env.GEMINI_VISION_MODEL ?? "gemini-2.5-flash")];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  const body = (req.body ?? {}) as Record<string, unknown>;
  const videoUrl = String(body.videoUrl ?? "");
  const description = String(body.description ?? "").trim();

  let plan: UGCDirectorPlan | null = null;
  try {
    plan = DirectorPlanSchema.parse(body.plan);
  } catch {
    plan = null;
  }

  // QC is best-effort. Any missing prerequisite => ship the video unjudged.
  if (!geminiKey || !videoUrl || !plan) {
    const out: UGCQcResponse = {
      qcDone: false,
      qcPass: true,
      qcSummary: !geminiKey
        ? "QC skipped -- Gemini not configured."
        : "QC skipped -- missing video or plan.",
    };
    return res.status(200).json(out);
  }

  let fileName: string | null = null;
  try {
    const file = await uploadVideoToGeminiFiles(geminiKey, videoUrl, { displayName: "ugc_qc_video" });
    fileName = file.name;
    const qcResult = await runQc({
      geminiKey,
      videoFileUri: file.fileUri,
      videoMimeType: file.mimeType,
      brief: description || "(no brief provided)",
      plan,
      models: qcModels(),
    });
    const out: UGCQcResponse = {
      qcDone: true,
      qcPass: qcResult.overall_pass,
      qcSummary: qcResult.summary,
      qcResult,
    };
    return res.status(200).json(out);
  } catch (err) {
    console.warn(`[ugc-qc] QC failed, shipping with warning: ${err instanceof Error ? err.message : err}`);
    const out: UGCQcResponse = {
      qcDone: false,
      qcPass: true,
      qcSummary: "QC could not run -- shipping unverified. Review the video manually.",
    };
    return res.status(200).json(out);
  } finally {
    if (fileName) await deleteGeminiFile(geminiKey, fileName);
  }
}
