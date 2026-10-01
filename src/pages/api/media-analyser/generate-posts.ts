import type { NextApiRequest, NextApiResponse } from "next";
import { editWithNanoBananaPro, type FalAspect } from "@/lib/media-analyser/fal";
import { normalizeImageModel } from "@/lib/media-analyser/generation-models";
import { geminiTextModels } from "@/lib/media-analyser/gemini-models";

export const config = { maxDuration: 300 };

export type PostMode = "instagram" | "meta_ad";

export interface GeneratedPostUpdate {
  phase: "analyzing" | "generating" | "done" | "error";
  index?: number;
  concept?: string;
  imageUrl?: string;
  prompt?: string;
  // IG
  caption?: string;
  // Meta ad
  headline?: string;
  primaryText?: string;
  cta?: string;
  message?: string;
}

interface PostBrief {
  concept: string;
  visualPrompt: string;
  negativePrompt: string;
  caption?: string;
  headline?: string;
  primaryText?: string;
  cta?: string;
}

const COUNT = parseInt(process.env.POST_GEN_COUNT ?? "10", 10) || 10;

function igSystemPrompt(): string {
  return `You are a senior social creative strategist for a D2C brand.
You will be given (a) the brand's recent Instagram posts (captions, marketing angles, engagement) and (b) a brand profile summary, plus the product to promote.

First, silently diagnose what is WORKING in the brand's posts — the winning hooks, recurring content pillars, tone, and visual style (signal → diagnosis). Be evidence-bound: only use patterns actually present in the supplied posts.

Then produce EXACTLY ${COUNT} brand-new Instagram post concepts for THIS product that apply those winning patterns. Output ONLY a JSON object of the form { "concepts": [ ... ${COUNT} objects ... ] }, where each object is:
{
  "concept": "1-line idea, named after the winning pattern it applies",
  "visualPrompt": "A Nano Banana image-EDIT instruction for a vertical 4:5 Instagram creative. CRITICAL: keep the product in ALL provided reference images EXACTLY as-is — identical shape, proportions, colour, material, hardware, logo and any printed text. Use every reference angle to preserve product fidelity. Do NOT redesign, restyle, or regenerate the product itself. Instead, place that exact product into a premium, on-brand editorial scene and describe: the setting/surface/background, lighting and mood matching the brand's visual style, supporting props, and any minimal tasteful text overlay (headline/sub-line) to render. 120-200 words.",
  "negativePrompt": "redesigned product, altered logo, changed colours, distorted, watermark, extra products",
  "caption": "a scroll-stopping hook line, then a 2-3 line body, then 3-5 relevant hashtags"
}
Return the object with all ${COUNT} concepts even if the supplied posts are sparse — infer sensible patterns from the product and brand. No prose, no markdown, no code fences.`;
}

function metaAdSystemPrompt(): string {
  return `You are a senior paid-social creative strategist for a D2C brand.
You will be given (a) the brand's currently-running Meta ads (headlines, primary text, CTAs) and (b) an ads brand book, plus the product to promote.

First, silently diagnose the WINNING angles, offers, hooks and CTA patterns in the brand's live ads (signal → diagnosis). Be evidence-bound: only use patterns actually present in the supplied ads.

Then produce EXACTLY ${COUNT} brand-new Meta ad concepts for THIS product that apply those winning patterns. Output ONLY a JSON object of the form { "concepts": [ ... ${COUNT} objects ... ] }, where each object is:
{
  "concept": "1-line idea, named after the winning angle it applies",
  "visualPrompt": "A Nano Banana image-EDIT instruction for a 1:1 square Meta ad creative. CRITICAL: keep the product in ALL provided reference images EXACTLY as-is — identical shape, proportions, colour, material, hardware, logo and any printed text. Use every reference angle to preserve product fidelity. Do NOT redesign, restyle, or regenerate the product itself. Instead, place that exact product into a high-contrast, thumb-stopping ad scene and describe: the background/surface, lighting and mood, the clear focal placement of the product with breathing room, and the on-image text overlay to render (a short bold headline + optional benefit line + a CTA button). 120-200 words.",
  "negativePrompt": "redesigned product, altered logo, changed colours, distorted, watermark, extra products",
  "headline": "<= 40 chars",
  "primaryText": "<= 125 chars, lead with the pain/benefit",
  "cta": "one of: Shop Now, Learn More, Get Offer, Sign Up"
}
Return the object with all ${COUNT} concepts even if the supplied ads are sparse — infer sensible patterns from the product and brand. No prose, no markdown, no code fences.`;
}

// ── Meta Static & Carousel Ad Generator — CARE system prompt ─────────────────
// Source spec: META_STATIC_CAROUSEL_CARE_SYSTEM.md
function metaStaticCarouselSystemPrompt(): string {
  return `You are a senior performance-creative director for Meta (Facebook/Instagram) paid social. You turn a product brief into thumb-stopping STATIC and CAROUSEL ad creatives that obey Meta's format rules and convert. You design for a feed: one clear idea per frame, legible at thumbnail size, with copy that earns the tap. You build every creative with CARE — Context, Arrangement, Result, Exclusions & Exactness.

You will be given: the product (name, category, features, pain points), an optional brand visual profile / visual DNA, an optional brief, the FORMAT (single | carousel), the CTA MODE (with | without), aspect ratio, and for carousels the card count. A product reference frame is supplied to the image model separately — the product in it is fixed and inviolable.

=====================================================================
NON-NEGOTIABLE RULES — breaking any one is a failed response
=====================================================================

R1.  Output EXACTLY ONE JSON object matching the schema at the end. No prose, no markdown, no code fences, no comments.
R2.  PRODUCT FIDELITY IS ABSOLUTE. The product in the reference frame is locked: identical shape, proportions, colour, material, finish, hardware, logo and printed text. NEVER redesign, restyle, recolour, resize, deform, or regenerate it. State the lock in both Context and Exclusions. Every visualPrompt is an image-EDIT instruction that places the EXACT product into a new scene/layout — never a new product.
R3.  ONE MESSAGE PER FRAME. A single static carries exactly ONE idea and ONE focal product with a clear visual hierarchy (focal → support → text). A carousel carries ONE idea PER CARD. Never crowd two competing messages into one frame.
R4.  THUMBNAIL-LEGIBLE. The creative must read at small size: high focal contrast, generous negative space, and on-image text limited to a short headline (<=6 words) plus an optional sub-line (<=8 words). If on-image text is present, specify a legibility strategy (contrast scrim, solid colour block, or placement over clean negative space). Keep on-image text MINIMAL.
R5.  RESPECT META SAFE-ZONES. Keep the product and all text within the central safe area. Avoid the bottom ~20% and the top corners. State the safe-zone intent in Arrangement.
R6.  FORMAT COMPLIANCE. Single feed: 1:1 or 4:5. Stories: 9:16. Carousel: 2–10 cards (recommend 3–5); EVERY card uses the SAME aspect ratio. Echo the chosen aspectRatio and cardCount in params.
R7.  CAROUSEL ARC IS DELIBERATE. Pick ONE archetype and state it: story-arc, benefit-per-card, range/variants, before→after, step-by-step, or seamless-panorama (contiguous edge-aligned slices). Card 1 MUST stop the scroll alone. All cards MUST share one visual system: same palette (hex), lighting, grade, grid and margins.
R8.  CTA MODE BRANCHING. WITH CTA: set metaCopy.cta to one of {Shop Now, Learn More, Sign Up, Get Offer, Book Now, Order Now, Download, Subscribe, Contact Us, Get Quote}; copy ends on a clear action; a static MAY carry a small on-image CTA chip; a carousel's final card SHOULD reinforce the CTA. WITHOUT CTA: set metaCopy.cta to null; NO on-image CTA chip anywhere; awareness/brand-led tone.
R9.  META COPY LIMITS — hard caps. primaryText <=125 characters (front-load the hook). headline <=40 characters. description <=30 characters (optional). Each carousel card MAY have cardHeadline <=40 characters. Lead primaryText with the pain or benefit.
R10. STYLE FORK — photoreal vs graphic. If photoreal, integrate the product with shared lighting, contact shadows, reflections and matched depth of field — never a cutout/sticker/floating composite; natural texture, realistic skin. If graphic/typographic, clean flat layout, consistent brand type and colour blocks. State the fork in Arrangement and forbid the other's artifacts in Exclusions.
R11. EVIDENCE-BOUND BRANDING. If a brand visual profile is supplied, reuse its real palette (hex), lighting, surfaces, type and mood. Do not introduce a contradicting look. If none, infer a sensible look and say so in "concept".
R12. NEGATIVE PROMPT MANDATORY. Every visualPrompt has a negativePrompt with at least: deformed product, altered logo, distorted text, changed proportions, changed colours, cutout/sticker look, floating composite, heavy texture mapping, plastic CGI skin, warping, extra products, duplicate objects, watermark, gibberish text, misspelled text, blurry, low-res, cluttered — plus brief-specific off-tracks.

=====================================================================
MANDATORY PROCEDURE (perform silently, then output only JSON)
=====================================================================
S1. Parse product, brand profile, brief, format, ctaMode, ratio, cardCount.
S2. Pick the single core idea (static) or the archetype + per-card roles (carousel).
S3. Choose the style fork (photoreal vs graphic).
S4-S7. Draft CONTEXT, ARRANGEMENT, RESULT, EXCLUSIONS per CARE.
S8. Write each visualPrompt as a 90–170 word image-EDIT instruction naming: layout/focal placement, surface/background, light source+direction+quality (or graphic palette), the exact on-image text to render (or "no text overlay"), and the legibility strategy. Apply CTA-mode branching.
S9. Write metaCopy honouring R8/R9.
S10. Self-check the CHECKLIST; fix any failure before emitting.

=====================================================================
OUTPUT SCHEMA — return ONLY this object, keys in this exact order.
For format="single", fill "static" and set "cards" to []. For format="carousel", fill "cards" and set "static" to null.
=====================================================================
{
  "concepts": [
    {
      "concept": "1-line idea + style fork + any assumptions",
      "format": "single | carousel",
      "ctaMode": "with | without",
      "styleFork": "photoreal | graphic",
      "care": {"context":"...","arrangement":"...","result":"...","exclusions":"..."},
      "static": {"visualPrompt":"90-170 words, product locked","negativePrompt":"mandatory list + brief-specific","textOverlay":{"headline":"<=6 words or null","subline":"<=8 words or null","ctaChip":"short CTA or null","placement":"...","legibility":"..."}},
      "cards": [{"cardIndex":1,"role":"hook | benefit | proof | range | step | close-cta | close-brand","visualPrompt":"90-170 words, product locked, consistent with siblings","negativePrompt":"mandatory list + brief-specific","textOverlay":{"headline":"<=6 words or null","subline":"<=8 words or null","ctaChip":"null unless WITH-CTA close card","placement":"...","legibility":"..."},"cardHeadline":"<=40 chars or null"}],
      "carouselArc": "archetype + how cards connect + seamless(true/false), or null for single",
      "metaCopy": {"primaryText":"<=125 chars","headline":"<=40 chars","description":"<=30 chars or null","cta":"enum value or null"},
      "params": {"aspectRatio":"1:1 | 4:5 | 9:16","cardCount": 1}
    }
  ]
}
Emit the requested number of concepts. Run the CHECKLIST. Then output the JSON object and nothing else.`;
}

interface MetaCard {
  cardIndex?: number;
  role?: string;
  visualPrompt?: string;
  negativePrompt?: string;
  cardHeadline?: string | null;
}
interface MetaConcept {
  concept?: string;
  format?: string;
  static?: { visualPrompt?: string; negativePrompt?: string } | null;
  cards?: MetaCard[];
  metaCopy?: { primaryText?: string | null; headline?: string | null; description?: string | null; cta?: string | null };
}

function clampChars(s: string | null | undefined, max: number): string | undefined {
  if (!s) return undefined;
  const t = String(s).trim();
  return t.length > max ? t.slice(0, max) : t;
}

// Flatten CARE meta concepts (single statics + carousel cards) into renderable image briefs.
function flattenMetaConcepts(text: string): PostBrief[] {
  const stripped = text.trim().replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
  const raw = JSON.parse(stripped) as Record<string, unknown>;
  const concepts = (Array.isArray(raw) ? raw : (raw.concepts as unknown[] | undefined) ?? []) as MetaConcept[];
  const briefs: PostBrief[] = [];

  for (const c of concepts) {
    const copy = c.metaCopy ?? {};
    const headline = clampChars(copy.headline, 40);
    const primaryText = clampChars(copy.primaryText, 125);
    const cta = copy.cta ? String(copy.cta) : undefined;

    if (c.format === "carousel" && Array.isArray(c.cards) && c.cards.length) {
      c.cards.forEach((card, i) => {
        if (!card?.visualPrompt) return;
        briefs.push({
          concept: `${c.concept ?? "Carousel"} · card ${card.cardIndex ?? i + 1}${card.role ? ` (${card.role})` : ""}`,
          visualPrompt: card.visualPrompt,
          negativePrompt: card.negativePrompt ?? "deformed product, altered logo, distorted text, changed proportions, changed colours, cutout/sticker look, watermark, misspelled text, blurry, low-res, cluttered",
          headline: clampChars(card.cardHeadline, 40) ?? headline,
          primaryText,
          cta,
        });
      });
    } else if (c.static?.visualPrompt) {
      briefs.push({
        concept: c.concept ?? "Meta static",
        visualPrompt: c.static.visualPrompt,
        negativePrompt: c.static.negativePrompt ?? "deformed product, altered logo, distorted text, changed proportions, changed colours, cutout/sticker look, watermark, misspelled text, blurry, low-res, cluttered",
        headline,
        primaryText,
        cta,
      });
    }
  }
  return briefs;
}

function parseBriefs(text: string): PostBrief[] {
  const stripped = text.trim().replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
  const raw = JSON.parse(stripped) as unknown;
  // The model sometimes wraps the array in an object ({ concepts: [...] } / { posts: [...] }).
  let arr: PostBrief[] = [];
  if (Array.isArray(raw)) {
    arr = raw as PostBrief[];
  } else if (raw && typeof raw === "object") {
    const firstArray = Object.values(raw as Record<string, unknown>).find(v => Array.isArray(v));
    if (firstArray) arr = firstArray as PostBrief[];
  }
  return arr.filter(b => b && b.visualPrompt).slice(0, COUNT);
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

async function generateBriefs(opts: {
  geminiKey: string;
  mode: PostMode;
  productName: string;
  brand: string;
  category: string;
  painPoints: string[];
  posts: unknown[];
  analysisText: string;
  visualDnaSummary?: string;
}): Promise<PostBrief[]> {
  const { geminiKey, mode, productName, brand, category, painPoints, posts, analysisText, visualDnaSummary } = opts;

  const system = mode === "instagram" ? igSystemPrompt() : metaAdSystemPrompt();
  const label = mode === "instagram" ? "Instagram posts" : "Meta ads";

  const userMessage = `Product to promote: "${productName}" by ${brand}${category ? ` (${category})` : ""}

Customer pain points: ${painPoints.slice(0, 5).join("; ") || "n/a"}

Brand ${mode === "instagram" ? "profile" : "ads brand book"}:
${analysisText || "Not available — infer from the posts below and the product."}
${visualDnaSummary ? `\nBrand visual DNA (use this to keep copy consistent with the brand's look):\n${visualDnaSummary}\n` : ""}
The brand's recent ${label} (analyze what's working here):
${JSON.stringify(posts.slice(0, 20), null, 2)}

Now return the JSON array of ${COUNT} concepts.`;

  const raw = await callGeminiBriefs(system, userMessage, geminiKey);
  const briefs = parseBriefs(raw);
  if (briefs.length) return briefs;
  throw new Error(`Gemini returned no briefs (raw: ${raw.slice(0, 200)})`);
}

// Meta static gen via the CARE system prompt. Runs a singles pass and a carousel
// pass, then flattens every static + card into a renderable image brief.
async function generateMetaCareBriefs(opts: {
  geminiKey: string;
  productName: string;
  brand: string;
  category: string;
  painPoints: string[];
  analysisText: string;
  brandVisualProfile?: Record<string, unknown>;
}): Promise<PostBrief[]> {
  const { geminiKey, productName, brand, category, painPoints, analysisText, brandVisualProfile } = opts;
  const system = metaStaticCarouselSystemPrompt();
  const dnaJson = brandVisualProfile ? JSON.stringify(brandVisualProfile) : "none — infer from category";

  const buildUser = (format: "single" | "carousel", concepts: number, cardCount: number) => `Product: "${productName}" by ${brand}${category ? ` (${category})` : ""}
Key features: ${painPoints.slice(0, 3).join("; ") || "infer from the brand context"}
Customer pain points: ${painPoints.slice(0, 5).join("; ") || "n/a"}

Brand visual profile (reuse palette/light/type/mood; or "none — infer from category"):
${dnaJson}

Creative brief / offer (optional): ${analysisText ? analysisText.slice(0, 800) : "none — infer winning angles from the brand context"}

Format: ${format}
CTA mode: with
Aspect ratio: 1:1
Card count (carousel only): ${cardCount}
Number of concepts: ${concepts}

Now return the JSON object of concept(s).`;

  const runPass = async (format: "single" | "carousel", concepts: number, cardCount: number): Promise<PostBrief[]> => {
    const user = buildUser(format, concepts, cardCount);
    try {
      const raw = await callGeminiBriefs(system, user, geminiKey);
      const briefs = flattenMetaConcepts(raw);
      if (briefs.length) return briefs;
    } catch (e) {
      console.error(`[generate-posts] meta CARE ${format} pass failed:`, e);
    }
    return [];
  };

  const singleConcepts = parseInt(process.env.META_SINGLE_CONCEPTS ?? "3", 10) || 3;
  const carouselCards = parseInt(process.env.META_CAROUSEL_CARDS ?? "5", 10) || 5;

  const [singles, carousel] = await Promise.all([
    runPass("single", Math.min(3, singleConcepts), 1),
    runPass("carousel", 1, Math.min(10, Math.max(2, carouselCards))),
  ]);

  const all = [...singles, ...carousel];
  if (!all.length) throw new Error("Meta CARE generation produced no concepts");
  return all;
}

// Compact, copy-relevant slice of the Brand Visual DNA profile.
function summarizeVisualDna(profile: Record<string, unknown> | undefined): string {
  if (!profile) return "";
  const color = profile.color as Record<string, unknown> | undefined;
  const palette = Array.isArray(color?.palette) ? (color!.palette as string[]).join(", ") : "";
  const lighting = profile.lighting as Record<string, unknown> | undefined;
  const photography = profile.photography as Record<string, unknown> | undefined;
  const mood = profile.mood as Record<string, unknown> | undefined;
  const avoid = Array.isArray(profile.avoid) ? (profile.avoid as string[]).slice(0, 5).join("; ") : "";
  const parts: string[] = [];
  if (profile.summary) parts.push(`Look: ${String(profile.summary)}`);
  if (palette) parts.push(`Palette: ${palette}`);
  if (lighting?.source) parts.push(`Lighting: ${[lighting.source, lighting.direction, lighting.quality].filter(Boolean).join(", ")}`);
  if (photography?.shotTypes) parts.push(`Photography: ${[Array.isArray(photography.shotTypes) ? (photography.shotTypes as string[]).join("/") : "", photography.cameraAngle].filter(Boolean).join(", ")}`);
  if (mood?.primary) parts.push(`Mood: ${String(mood.primary)}`);
  if (avoid) parts.push(`Avoid: ${avoid}`);
  return parts.join("\n");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const falKey = process.env.FAL_KEY ?? "";
  const geminiKey = process.env.GEMINI_API_KEY ?? "";

  if (!falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const mode = (body.mode === "meta_ad" ? "meta_ad" : "instagram") as PostMode;
  const imageModel = normalizeImageModel(body.imageModel).id;
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

  // Brand Visual DNA — forensic reproduction prompts extracted from the brand's
  // own creatives. When present, these drive the IMAGE scene (copy still comes
  // from the brand-voice brief below).
  const reproductionPrompts = (body.reproductionPrompts as Array<{ sceneName?: string; visualPrompt?: string; negativePrompt?: string }> | undefined)
    ?.filter(p => p && typeof p.visualPrompt === "string" && p.visualPrompt.trim().length > 0) ?? [];
  const brandVisualProfile = (body.brandVisualProfile as Record<string, unknown> | undefined) ?? undefined;

  if (!imageDataUrls.length) {
    return res.status(400).json({ error: "imageDataUrls must include at least one valid image data URL" });
  }
  if (imageDataUrls.length > 6) {
    return res.status(400).json({ error: "Maximum 6 product reference images allowed" });
  }

  const aspect: FalAspect = mode === "instagram" ? "4:5" : "1:1";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (u: GeneratedPostUpdate) => { res.write(`data: ${JSON.stringify(u)}\n\n`); };

  try {
    send({ phase: "analyzing", message: mode === "instagram" ? "Analyzing your Instagram posts and drafting concepts…" : "Analyzing your Meta ads and drafting concepts…" });

    const visualDnaSummary = summarizeVisualDna(brandVisualProfile);

    let briefs: PostBrief[];
    try {
      briefs = mode === "meta_ad"
        ? await generateMetaCareBriefs({ geminiKey, productName, brand, category, painPoints, analysisText, brandVisualProfile })
        : await generateBriefs({ geminiKey, mode, productName, brand, category, painPoints, posts, analysisText, visualDnaSummary });
    } catch (e) {
      console.error("[generate-posts] brief generation failed:", e);
      briefs = Array.from({ length: COUNT }, (_, i) => ({
        concept: `${mode === "instagram" ? "Instagram post" : "Meta ad"} concept ${i + 1}`,
        visualPrompt: `Professional ${mode === "instagram" ? "editorial Instagram" : "high-contrast ad"} creative of ${productName} by ${brand}. Photoreal, premium, preserve the product exactly from the reference image.`,
        negativePrompt: "low quality, blurry, distorted, watermark, extra logos",
        ...(mode === "instagram"
          ? { caption: `${productName} — designed for you. ✨\n\nShop now.\n\n#${brand.replace(/\s+/g, "").toLowerCase()}` }
          : { headline: productName.slice(0, 40), primaryText: `Discover ${productName} by ${brand}.`.slice(0, 125), cta: "Shop Now" }),
      }));
    }

    if (!briefs.length) {
      send({ phase: "error", message: "No concepts were generated." });
      res.end();
      return;
    }

    for (let i = 0; i < briefs.length; i++) {
      const b = briefs[i];
      send({ phase: "generating", index: i, concept: b.concept, message: `Generating ${i + 1} of ${briefs.length}…` });
      try {
        // Instagram: prefer the forensic Brand Visual DNA reproduction prompt
        // for the SCENE. Meta ads already bake the brand profile into the CARE
        // visualPrompt, so use the brief's own prompt there.
        const repro = mode === "instagram" && reproductionPrompts.length ? reproductionPrompts[i % reproductionPrompts.length] : null;
        const visualPrompt = repro?.visualPrompt?.trim() || b.visualPrompt;
        const negativePrompt = repro?.negativePrompt?.trim() || b.negativePrompt;
        const fullPrompt = negativePrompt ? `${visualPrompt}\n\nDo not: ${negativePrompt}.` : visualPrompt;
        const img = await editWithNanoBananaPro(falKey, imageDataUrls, fullPrompt, { aspect, model: imageModel });
        send({
          phase: "generating",
          index: i,
          concept: b.concept,
          imageUrl: img.url,
          prompt: b.visualPrompt,
          caption: b.caption,
          headline: b.headline,
          primaryText: b.primaryText,
          cta: b.cta,
        });
      } catch (e) {
        send({ phase: "error", index: i, concept: b.concept, message: String(e) });
      }
    }

    send({ phase: "done", message: "All posts generated." });
  } catch (err) {
    send({ phase: "error", message: String(err) });
  } finally {
    res.end();
  }
  return;
}
