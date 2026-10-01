/**
 * Cohort extraction — turn a target-audience document (deck / brief) into a set of
 * structured consumer cohorts, each carrying (a) the script grounding (problem,
 * insight, angle) used to tailor a UGC ad and (b) casting traits used to generate a
 * distinct talent character for that cohort.
 *
 * The casting trait values are constrained to the SAME option ids the manual
 * "Create character" flow uses (see character-prompt.ts) so they flow straight into
 * `buildCharacterPrompt` without remapping.
 */

import { z } from "zod";
import { AGE_OPTIONS, ETHNICITY_OPTIONS, GENDER_OPTIONS } from "./character-prompt";

export interface CohortCharacter {
  gender: string;
  ageRange: string;
  ethnicity: string;
  details: string;
}

export interface Cohort {
  id: string;
  name: string;
  personaName: string;
  problemStatement: string;
  keyInsight: string;
  angle: string;
  scriptBrief: string;
  character: CohortCharacter;
}

// Allowed option ids (the "" no-preference id is dropped — the LLM must pick a real value).
const GENDER_IDS = GENDER_OPTIONS.map(o => o.id).filter(Boolean);
const AGE_IDS = AGE_OPTIONS.map(o => o.id).filter(Boolean);
const ETHNICITY_IDS = ETHNICITY_OPTIONS.map(o => o.id).filter(Boolean);

/** Zod schema to validate the LLM's JSON before we trust it. */
export const CohortListSchema = z.object({
  cohorts: z
    .array(
      z.object({
        name: z.string(),
        personaName: z.string().default(""),
        problemStatement: z.string().default(""),
        keyInsight: z.string().default(""),
        angle: z.string().default(""),
        scriptBrief: z.string().default(""),
        character: z.object({
          gender: z.string().default(""),
          ageRange: z.string().default(""),
          ethnicity: z.string().default(""),
          details: z.string().default(""),
        }),
      }),
    )
    .default([]),
});

export type CohortList = z.infer<typeof CohortListSchema>;

/** Gemini responseSchema — constrains casting trait fields to the canonical option ids. */
export const COHORT_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    cohorts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short cohort label, e.g. 'New Moms', 'Pet Parents'." },
          personaName: { type: "string", description: "Representative persona, e.g. 'Shweta, 32, first-time mom'." },
          problemStatement: { type: "string", description: "The cohort's core problem / underlying tension, in one or two sentences." },
          keyInsight: { type: "string", description: "The cohort's key insight quote or one-line truth." },
          angle: { type: "string", description: "The strategic angle / 'unlock' for selling to this cohort." },
          scriptBrief: { type: "string", description: "1-2 sentences on how to pitch THE SAME product to this cohort in a 15s UGC ad." },
          character: {
            type: "object",
            properties: {
              gender: { type: "string", enum: GENDER_IDS, description: "Casting gender for the cohort's representative person." },
              ageRange: { type: "string", enum: AGE_IDS, description: "Casting age band." },
              ethnicity: { type: "string", enum: ETHNICITY_IDS, description: "Casting ethnicity (infer from the deck's market; default 'South Asian' for Indian decks)." },
              details: { type: "string", description: "Free-text look/mood for the person, e.g. 'first-time mom, warm, slightly tired, casual homewear'." },
            },
            required: ["gender", "ageRange", "ethnicity", "details"],
          },
        },
        required: ["name", "problemStatement", "keyInsight", "scriptBrief", "character"],
      },
    },
  },
  required: ["cohorts"],
};

export const COHORT_EXTRACTION_SYSTEM_PROMPT = `You are a strategy analyst. You are given a target-audience document (a marketing deck or brief) for a single product. Extract the distinct CONSUMER COHORTS / audience segments it describes.

For EACH cohort, return:
- name: the short segment label used in the doc (e.g. "New Moms", "Bachelors", "Pet Parents").
- personaName: the representative persona if named (e.g. "Shweta, 32, first-time mom"); else a fitting one.
- problemStatement: the cohort's core problem / underlying tension, in your own words (1-2 sentences).
- keyInsight: the cohort's key insight — prefer the verbatim quote in the deck if present.
- angle: the strategic "unlock" / positioning for this cohort.
- scriptBrief: 1-2 sentences on how to pitch THE SAME product to THIS cohort in a 15-second vertical UGC ad — what hook and emotional driver to lead with.
- character: casting traits for ONE representative real person to star in this cohort's ad:
  - gender, ageRange, ethnicity: choose ONLY from the allowed enum values.
  - details: a short free-text description of their look/mood/context (this carries the nuance the enums can't — exact age cues, situation, wardrobe).

Rules:
- One entry per distinct cohort. Do NOT invent cohorts not supported by the document.
- If a cohort is a couple or group (e.g. "DINK couples"), pick ONE representative person for the character.
- Infer ethnicity from the document's market (Indian brand/personas → "South Asian") unless stated otherwise.
- Output STRICT JSON matching the provided schema. No commentary.`;
