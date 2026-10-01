/**
 * UGC Ads -- cohort extraction from an uploaded target-audience document.
 *
 * POST a .pptx or .pdf (as a base64 data URL); we extract its text/content and ask
 * Gemini to return structured consumer cohorts.
 *
 *   .pptx -> jszip -> slide XML text -> Gemini (text part)
 *   .pdf  -> Gemini reads the PDF natively (inline_data application/pdf)
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { callVisionLLM, type VisionUserPart } from "@/lib/media-analyser/vision-llm";
import { geminiVisionModels, normalizeGeminiModel } from "@/lib/media-analyser/gemini-models";
import {
  COHORT_EXTRACTION_SYSTEM_PROMPT,
  COHORT_RESPONSE_SCHEMA,
  CohortListSchema,
  type Cohort,
} from "@/lib/media-analyser/ugc/cohort-prompt";
import { extractPptxText } from "@/lib/media-analyser/ugc/pptx";

export const config = { maxDuration: 120 };

export interface UGCCohortsResponse {
  cohorts: Cohort[];
}

/** Parse a `data:<mime>;base64,<data>` URL -> { mime, buffer, base64 }. */
function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer; base64: string } | null {
  const m = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const base64 = m[2] ?? "";
  return { mime: (m[1] || "").toLowerCase(), buffer: Buffer.from(base64, "base64"), base64 };
}

function detectKind(fileName: string, mime: string): "pptx" | "pdf" | "image" | null {
  const n = fileName.toLowerCase();
  if (n.endsWith(".pptx") || mime.includes("presentationml")) return "pptx";
  if (n.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(n)) return "image";
  return null;
}

function modelList(): string[] {
  const override = process.env.GEMINI_DIRECTOR_MODEL;
  if (override) return [normalizeGeminiModel(override)];
  return geminiVisionModels();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const documentDataUrl = String(body.documentDataUrl ?? "");
  const fileName = String(body.fileName ?? "");

  const parsed = parseDataUrl(documentDataUrl);
  if (!parsed) {
    return res.status(400).json({ error: "Upload a .pptx or .pdf file." });
  }
  const kind = detectKind(fileName, parsed.mime);
  if (!kind) {
    return res.status(400).json({ error: "Unsupported file -- upload a .pdf, .pptx, or an image (png/jpg)." });
  }

  try {
    const parts: VisionUserPart[] = [];
    if (kind === "pptx") {
      const text = await extractPptxText(parsed.buffer);
      if (!text.trim()) {
        return res.status(422).json({ error: "Couldn't read any text from that .pptx -- try exporting it as a PDF." });
      }
      parts.push({ text: `TARGET-AUDIENCE DOCUMENT (extracted slide text):\n\n${text}` });
    } else if (kind === "image") {
      parts.push({ text: "TARGET-AUDIENCE DOCUMENT (image attached -- a slide/infographic). Read it and extract the cohorts." });
      parts.push({ inline_data: { mime_type: parsed.mime || "image/jpeg", data: parsed.base64 } });
    } else {
      parts.push({ text: "TARGET-AUDIENCE DOCUMENT (PDF attached). Read it and extract the cohorts." });
      parts.push({ inline_data: { mime_type: "application/pdf", data: parsed.base64 } });
    }
    parts.push({ text: "Return the cohorts as strict JSON per the schema." });

    const raw = await callVisionLLM(COHORT_EXTRACTION_SYSTEM_PROMPT, parts, geminiKey, {
      jsonMode: true,
      responseSchema: COHORT_RESPONSE_SCHEMA,
      geminiOnly: true,
      enableThinking: true,
      maxTokens: 8192,
      models: modelList(),
    });

    const json = JSON.parse(raw) as unknown;
    const validated = CohortListSchema.parse(json);
    const cohorts: Cohort[] = validated.cohorts.map((c, i) => ({
      id: `cohort-${i + 1}`,
      name: c.name.trim(),
      personaName: c.personaName.trim(),
      problemStatement: c.problemStatement.trim(),
      keyInsight: c.keyInsight.trim(),
      angle: c.angle.trim(),
      scriptBrief: c.scriptBrief.trim(),
      character: {
        gender: c.character.gender.trim(),
        ageRange: c.character.ageRange.trim(),
        ethnicity: c.character.ethnicity.trim(),
        details: c.character.details.trim(),
      },
    }));

    if (!cohorts.length) {
      return res.status(422).json({ error: "No cohorts found in that document." });
    }

    const out: UGCCohortsResponse = { cohorts };
    return res.status(200).json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ugc-cohorts] failed for ${fileName.slice(0, 80)}: ${msg}`);
    return res.status(502).json({ error: `Could not read cohorts from that document: ${msg}` });
  }
}
