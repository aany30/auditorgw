/**
 * Claude Cohort Studio — prompts, JSON schemas, and Zod types for the URL → brand
 * analysis → cohorts → personas → script flow. The reasoning runs through brandReason()
 * (Claude first, Gemini fallback); the schemas double as Gemini responseSchemas and as
 * the shape Claude is told to return.
 */
import { z } from "zod";

// ── Zod (validation of the LLM output) ───────────────────────────────────────
export const BrandAnalysis = z.object({
  brandName: z.string().catch(""),
  brandImage: z.string().catch(""),        // visual identity: palette, mood, style
  products: z.string().catch(""),          // what they sell
  assets: z.string().catch(""),            // imagery/assets they have to work with
  website: z.string().catch(""),           // positioning / tone from the site
  charactersUsed: z.string().catch(""),    // the kind of people/creators in their marketing
  features: z.array(z.string()).catch([]), // product features / benefits
  targetAudience: z.string().catch(""),    // who they target today
});
export type BrandAnalysis = z.infer<typeof BrandAnalysis>;

export const Cohort = z.object({
  id: z.string().catch(""),
  name: z.string(),                        // e.g. "Moms", "Teens", "Aged men"
  description: z.string().catch(""),
  rationale: z.string().catch(""),         // why this cohort fits the brand
});
export type Cohort = z.infer<typeof Cohort>;

export const AnalyzeResult = z.object({
  analysis: BrandAnalysis,
  cohorts: z.array(Cohort).catch([]),
});
export type AnalyzeResult = z.infer<typeof AnalyzeResult>;

export const CohortPersona = z.object({
  id: z.string().catch(""),
  name: z.string(),                        // e.g. "New mom", "Seasoned mom"
  description: z.string().catch(""),
  gender: z.string().catch(""),
  ageRange: z.string().catch(""),
  ethnicity: z.string().catch(""),
  traits: z.string().catch(""),            // free-text casting details
  concern: z.string().catch(""),           // this persona's specific pain point / concern
  angle: z.string().catch(""),             // the messaging angle for this persona
});
export type CohortPersona = z.infer<typeof CohortPersona>;

export const CohortScript = z.object({
  script: z.string(),                      // spoken words, ~15s
  videoAngle: z.string().catch(""),        // scene/action direction
  characterDescription: z.string().catch(""), // casting brief for the creator portrait
  voiceCharacteristics: z.string().catch(""),
});
export type CohortScript = z.infer<typeof CohortScript>;

// Character "world" — a rich profile for the chosen persona that grounds the in-world
// scene image (GPT Image) and, via that image, the UGC reel.
export const CharacterWorld = z.object({
  summary: z.string().catch(""),                 // one-line who-they-are
  likes: z.array(z.string()).catch([]),          // 3-5 things they like
  dislikes: z.array(z.string()).catch([]),       // 3-5 things they dislike
  appearance: z.string().catch(""),              // one vivid sentence: face, hair, skin, build, wardrobe
  world: z.string().catch(""),                   // 2-3 sentences on their everyday environment/setting/lifestyle
});
export type CharacterWorld = z.infer<typeof CharacterWorld>;

// ── JSON schemas (Gemini responseSchema + Claude shape hint) ─────────────────
export const ANALYZE_SCHEMA = {
  type: "object",
  properties: {
    analysis: {
      type: "object",
      properties: {
        brandName: { type: "string" }, brandImage: { type: "string" }, products: { type: "string" },
        assets: { type: "string" }, website: { type: "string" }, charactersUsed: { type: "string" },
        features: { type: "array", items: { type: "string" } }, targetAudience: { type: "string" },
      },
    },
    cohorts: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, rationale: { type: "string" } } } },
  },
} as const;

export const PERSONAS_SCHEMA = {
  type: "object",
  properties: {
    personas: { type: "array", items: { type: "object", properties: {
      id: { type: "string" }, name: { type: "string" }, description: { type: "string" },
      gender: { type: "string" }, ageRange: { type: "string" }, ethnicity: { type: "string" },
      traits: { type: "string" }, concern: { type: "string" }, angle: { type: "string" },
    } } },
  },
} as const;

export const SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    script: { type: "string" }, videoAngle: { type: "string" },
    characterDescription: { type: "string" }, voiceCharacteristics: { type: "string" },
  },
} as const;

export const CHARACTER_WORLD_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    likes: { type: "array", items: { type: "string" } },
    dislikes: { type: "array", items: { type: "string" } },
    appearance: { type: "string" },
    world: { type: "string" },
  },
} as const;

// ── System prompts ───────────────────────────────────────────────────────────
export const ANALYZE_SYSTEM = `You are a brand & audience strategist for short-form UGC video ads. You are given a product/brand — its scraped details and imagery. Deeply analyse it: the brand's visual identity (palette, mood, style), what products/assets it has, its website positioning and tone, WHAT KIND OF PEOPLE/CREATORS appear in its marketing, its key product features/benefits, and who it targets today. THEN propose 4-6 distinct AUDIENCE COHORTS this brand should make UGC ads for — broad, recognisable buyer groups (e.g. "Moms", "Teens", "Aged men", "Busy professionals", "Fitness beginners"). Each cohort: a short name, a one-line description, and a rationale tying it to the brand. Base everything on the evidence provided; don't invent facts about the brand.`;

export function analyzeUser(p: { title?: string; brand?: string; description?: string; bullets?: string[]; url?: string; website?: string; imageCount: number; country?: string; deep?: boolean }): string {
  return [
    p.url ? `Product URL: ${p.url}` : "",
    p.brand ? `Brand: ${p.brand}` : "",
    p.title ? `Product: ${p.title}` : "",
    p.description ? `Description: ${p.description}` : "",
    p.bullets?.length ? `Bullets:\n- ${p.bullets.join("\n- ")}` : "",
    p.website ? `Brand website content:\n${p.website.slice(0, 4000)}` : "",
    `(${p.imageCount} product/brand images attached — analyse the visual identity from them.)`,
    p.country ? `Target market/country: ${p.country}. If set, skew the cohorts toward this market; also report it as the brand's primary market.` : `Also infer the brand's primary market/country from the evidence and reflect it in the audience.`,
    p.deep
      ? `\nDEEP ANALYSIS MODE: reason exhaustively. Study the visual identity, positioning and creator archetypes in fine detail, surface the full breadth of distinct buyer cohorts (aim for 6), and make each cohort's rationale concrete and evidence-backed. Analyse the brand and propose cohorts.`
      : `\nAnalyse the brand and propose cohorts.`,
  ].filter(Boolean).join("\n");
}

export const PERSONAS_SYSTEM = `You break an audience COHORT into 5-6 concrete, COUNTRY/DEMOGRAPHY-ORIENTED PERSONAS for UGC casting. Given the brand analysis, a chosen cohort, and a target COUNTRY/MARKET, produce 5-6 distinct personas realistic FOR THAT MARKET — culturally authentic names, ethnicity, ages, settings and buying context for that country (e.g. India, USA, UAE). Each persona has: name, gender, ageRange, ethnicity (fit the market), and FOUR short one-sentence fields (max ~20 words each): description (who they are), concern (their specific pain point with this product category), traits (castable look/wardrobe/setting details for their market), angle (the messaging hook that lands the product for them). Be concise, no paragraphs, realistic and castable. Return 5-6 personas.`;

export function personasUser(p: { analysis: BrandAnalysis; cohort: Cohort; country?: string }): string {
  const market = (p.country && p.country.trim()) || p.analysis.targetAudience || "the brand's primary market";
  return `BRAND: ${p.analysis.brandName} — ${p.analysis.products}\nFeatures: ${p.analysis.features.join(", ")}\nTarget today: ${p.analysis.targetAudience}\n\nTARGET COUNTRY / MARKET: ${market}\nCHOSEN COHORT: ${p.cohort.name} — ${p.cohort.description}\n\nProduce 5-6 personas within this cohort, authentic to ${market}.`;
}

export const SCRIPT_SYSTEM = `You write a single UGC (user-generated-content style) ad for a 30-second vertical video, spoken by ONE creator persona. Output JSON with: "script" — the spoken words only, 65-80 words (this is roughly 30 seconds at a natural talking pace; fewer than 60 words leaves dead air and is a failed script). Casual first-person, short punchy sentences of 4-9 words each. Give it ONE clear arc: hook → the problem → the benefit → a quick proof/detail → a soft sign-off. Every sentence must add something new — NEVER repeat a line, phrase or idea to fill time. No stage directions, no brackets, no markdown, no word count. Also output: "videoAngle" — one line of scene/action direction; "characterDescription" — a concise casting brief for the creator's portrait (look, wardrobe, setting) grounded in the persona + brand; "voiceCharacteristics" — gender/age/tone for voiceover. Make it specific to this persona's angle and the brand.`;

// ── Strategy document (Cohort → Persona → Pen Portrait, house format) ─────────
export const DOC_SYSTEM = `You are a brand strategist writing a polished TARGET-GROUP STRATEGY DOCUMENT in a specific house format. Given a brand analysis, a target country/market, the suggested audience cohorts, and detailed personas, write a COMPLETE document in clean MARKDOWN with EXACTLY these sections and nothing else:

# {Brand} — {Product}
## Consumer Cohorts and {Country} Target-Group Strategy
_Prepared for the brand team · Market: {Country} · Basis: brand-site & imagery analysis and category audience reasoning._

## 1. Executive summary
3-5 sentences: what the doc covers (cohorts and how they translate into a Cohort → Persona → Pen Portrait TG strategy for {Country}) and the single biggest opportunity.

## 2. Product snapshot
A short paragraph on the product + a bullet list of key features/benefits and the brand's visual identity, drawn ONLY from the analysis.

## 3. Cohort & target-audience identification
For EACH cohort provided, a subsection "### {n}. {Cohort name}" with a one-paragraph **Definition**, then bold-labelled one-liners: **Where they are**, **Job to be done**, **Why this cohort**, **Barriers**, **Core message**, **Primary channels**. Ground everything in {Country} and the brand; realistic, no invented brand facts.

## 4. Cohort → Persona → Pen Portrait
For EACH persona provided, a subsection "### {Name} · {age}, {ethnicity} · {cohort}", then:
- a vivid 4-6 sentence PEN PORTRAIT paragraph making this person real (life, routine, why they'd care), authentic to {Country};
- bold-labelled facts: **Context**, **Trigger**, **Barrier**, **Hook** (each one line, grounded in the persona's concern + the product);
- **Nano Banana prompt:** a flowing natural-language paragraph describing subject, wardrobe, setting, action, light, lens and mood for a photoreal portrait, ending with an aspect ratio in words;
- **Seedream prompt:** the same scene as a dense comma-separated descriptor ending with style/quality tags, 4K, and an --ar flag.
Make the two prompts consistent with each other and authentic to contemporary {Country}.

## 5. From strategy to activation
A short 4-6 bullet playbook: which cohort to lead with, message, channels, and the first UGC creatives to make.

Rules: use ONLY the provided evidence; don't invent competitors, statistics or sources. Output MARKDOWN only — no preamble, no code fences.`;

export function docUser(p: { analysis: BrandAnalysis; country: string; cohorts: Cohort[]; personaGroups: { cohort: Cohort; personas: CohortPersona[] }[] }): string {
  const a = p.analysis;
  const cohortBlock = p.cohorts.map((c, i) => `${i + 1}. ${c.name} — ${c.description}${c.rationale ? ` (why: ${c.rationale})` : ""}`).join("\n");
  const personaBlock = p.personaGroups.map(g => `COHORT: ${g.cohort.name}\n` + g.personas.map(x => `  - ${x.name} | ${[x.gender, x.ageRange, x.ethnicity].filter(Boolean).join(", ")} | desc: ${x.description} | concern: ${x.concern} | angle: ${x.angle} | traits: ${x.traits}`).join("\n")).join("\n\n");
  return `BRAND: ${a.brandName}\nPRODUCT: ${a.products}\nVISUAL IDENTITY: ${a.brandImage}\nCREATORS USED: ${a.charactersUsed}\nFEATURES: ${(a.features || []).join(", ")}\nCURRENT AUDIENCE: ${a.targetAudience}\nTARGET COUNTRY / MARKET: ${p.country || a.targetAudience || "the brand's primary market"}\n\nCOHORTS:\n${cohortBlock}\n\nPERSONAS (write a pen portrait + image prompts for each):\n${personaBlock}\n\nWrite the full strategy document now.`;
}

export function scriptUser(p: { analysis: BrandAnalysis; cohort: Cohort; persona: CohortPersona }): string {
  return `BRAND: ${p.analysis.brandName} — ${p.analysis.products}\nBrand visual identity: ${p.analysis.brandImage}\nFeatures: ${p.analysis.features.join(", ")}\n\nCOHORT: ${p.cohort.name}\nPERSONA: ${p.persona.name} — ${p.persona.description} (${[p.persona.gender, p.persona.ageRange, p.persona.ethnicity].filter(Boolean).join(", ")})\nCasting traits: ${p.persona.traits}\nAngle: ${p.persona.angle}\n\nWrite the 15s UGC ad for this persona.`;
}

// ── Character world (persona → rich profile that grounds the in-world scene) ───
export const CHARACTER_WORLD_SYSTEM = `You build a rich, believable CHARACTER PROFILE (a "world") for a single UGC creator persona, so we can render a photoreal image of them in their real everyday environment. Given the brand, the chosen cohort, the persona and the target market, return JSON with:
- "summary": one line capturing who this person is.
- "likes": 3-5 concrete things this person genuinely likes (short phrases), authentic to their life and market — not just the product.
- "dislikes": 3-5 concrete things this person dislikes or is frustrated by (short phrases), including their pain point in this product's category.
- "appearance": ONE vivid sentence describing their face, hair, skin tone, build, age and typical wardrobe — castable and consistent with the persona's demography.
- "world": 2-3 sentences describing their real everyday setting/lifestyle where they'd naturally film a UGC video — the room/place, props around them, city/market cues, and the light/mood.
Ground everything in the persona and market; keep it real and specific, no clichés, no invented brand facts.`;

export function characterWorldUser(p: { analysis: BrandAnalysis; cohort: Cohort; persona: CohortPersona; country?: string }): string {
  const market = (p.country && p.country.trim()) || p.analysis.targetAudience || "the brand's primary market";
  return `BRAND: ${p.analysis.brandName} — ${p.analysis.products}\nBrand visual identity: ${p.analysis.brandImage}\nFeatures: ${(p.analysis.features || []).join(", ")}\n\nTARGET MARKET: ${market}\nCOHORT: ${p.cohort.name} — ${p.cohort.description}\nPERSONA: ${p.persona.name} — ${p.persona.description} (${[p.persona.gender, p.persona.ageRange, p.persona.ethnicity].filter(Boolean).join(", ")})\nConcern: ${p.persona.concern}\nCasting traits: ${p.persona.traits}\nAngle: ${p.persona.angle}\n\nBuild this persona's character world now.`;
}

/** Build the GPT-Image prompt for the in-world scene, using the persona portrait as the
 *  identity reference (kept intact) and the bio's appearance/world for the environment. */
export function characterWorldImagePrompt(bio: CharacterWorld, persona: CohortPersona): string {
  const who = [persona.name, [persona.gender, persona.ageRange, persona.ethnicity].filter(Boolean).join(", ")].filter(Boolean).join(" — ");
  const ethnicityLock = persona.ethnicity ? ` The person is ${persona.ethnicity}${persona.gender ? ` (${persona.gender})` : ""}; preserve their ethnicity and gender exactly.` : "";
  return [
    // Identity lock FIRST — the reference photo IS this person; keep them, don't invent a new one.
    `Take the person in the reference photo and place THAT SAME PERSON, unchanged, into a new scene. Keep their exact face, facial features, skin tone, hair and identity — same individual, not a lookalike.${ethnicityLock}`,
    `Photoreal, candid editorial lifestyle photograph of ${who}.`,
    bio.appearance ? `Appearance (must stay consistent with the reference): ${bio.appearance}` : "",
    bio.world ? `Setting / world: ${bio.world}` : "",
    "A natural, unposed everyday moment in their own environment (this is their world, not a studio).",
    "Soft natural light, shot on a 35mm lens, shallow depth of field, authentic UGC/social-documentary feel.",
    "Vertical 9:16 composition. No text, no captions, no logos, no watermark.",
  ].filter(Boolean).join(" ");
}
