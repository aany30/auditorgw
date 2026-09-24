/**
 * Creative prompt definitions for Ecom Agent.
 * Full Amazon-style BLS + 12-slot prompt system.
 * Uses GPT-4o Vision to generate brand-aware prompts from product images.
 * CF Worker compatible — no Node.js APIs.
 */

import { callLLM, stripJsonFences, LLM_MODEL, LLM_VISION_MODEL, LLM_PROMPT_MODEL } from './llm';

// ─── Prompt Sanitization ───────────────────────────────────────────────────────

const _HALLUCINATION_PHRASES = [
  'competitor images', 'competitors', 'their weakness', 'the opportunity',
  'we aim to', 'this prompt', 'at this position', 'beat them', 'visually superior',
  'for this row', 'amazon listing', 'amazon tos', 'pixel dimension',
];

/** Strip any sentences containing strategy/meta language leaked by the model. */
function sanitizePrompt(prompt: string): string {
  let result = prompt;
  for (const phrase of _HALLUCINATION_PHRASES) {
    if (result.toLowerCase().includes(phrase.toLowerCase())) {
      const sentences = result.split('. ');
      const filtered = sentences.filter(s => !s.toLowerCase().includes(phrase.toLowerCase()));
      result = filtered.join('. ');
    }
  }
  return result.trim();
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SlotDefinition {
  slot:                    number;
  name:                    string;
  type:                    'listing' | 'aplus';
  dimensions:              string;
  aspect_ratio:            '1:1' | '16:9';
  text_enabled:            boolean;
  goal:                    string;
  paragraph_3_instruction: string;
}

export interface BrandLanguageSystem {
  // Rich format (new sessions)
  primary_color?:     { name: string; hex: string; role: string };
  accent_color?:      { name: string; hex: string; role: string };
  neutral_color?:     { name: string; hex: string; role: string };
  deep_color?:        { name: string; hex: string; role: string };
  secondary_color?:   { name: string; hex: string; role: string };
  primary_font?:      { name: string; weight: string };
  secondary_font?:    { name: string; weight: string };
  detail_font?:       { name: string; weight: string };
  text_on_dark?:      string;
  text_on_light?:     string;
  shared_background?: string;
  callout_box_style?: string;
  icon_style?:        string;
  brand_voice?:       string[];
  // Legacy (old sessions — backward compat)
  primary_colors?:    string[];
  accent_colors?:     string[];
  typography_notes?:  string;
  tone_of_voice?:     string;
  visual_motifs?:     string[];
  lifestyle_cues?:    string[];
  raw_summary?:       string;
}

export interface GeneratedSlotResult {
  slot_number:     number;
  slot_name:       string;
  image_type:      'listing' | 'aplus';
  variation?:      number;
  prompt:          string;
  negative_prompt: string;
}

export interface GeneratePromptsResult {
  bls:   BrandLanguageSystem;
  slots: GeneratedSlotResult[];
}

// ─── 12 Slot Definitions ───────────────────────────────────────────────────────

export const SLOT_DEFINITIONS: SlotDefinition[] = [
  {
    slot: 1,
    name: 'Hero — Clean Product',
    type: 'listing', dimensions: '2000x2000', aspect_ratio: '1:1', text_enabled: false,
    goal: 'Pure product-only shot. No text, no props, no background elements. Product confidence through photographic excellence alone. Product at 85% frame fill. Pure white background RGB(255,255,255) only.',
    paragraph_3_instruction: 'Describe additional photographic atmosphere: the quality of light on the product surface, subtle material texture, and the compositional elegance that communicates premium quality without any visual additions.',
  },
  {
    slot: 2,
    name: 'Angles + Feature Labels',
    type: 'listing', dimensions: '2000x2000', aspect_ratio: '1:1', text_enabled: true,
    goal: 'Secondary product angle showing overall form. 1–2 key feature callouts with minimal, precise labels. Builds on the hero without repeating it.',
    paragraph_3_instruction: 'Specify: feature label callout boxes positioned on the right side of the frame, each label showing a key product attribute. Font, color HEX, size tier, and exact positioning for each label.',
  },
  {
    slot: 3,
    name: 'Primary Lifestyle',
    type: 'listing', dimensions: '2000x2000', aspect_ratio: '1:1', text_enabled: true,
    goal: 'Product in use within its ideal real-world environment. Sell the outcome and feeling, not the object. Slight realistic imperfections. No human faces.',
    paragraph_3_instruction: 'Specify: bold benefit-focused headline (Headline size tier) in upper region, one supporting sub-headline benefit callout. Include no-faces instruction. Font names, weights, colors, positions.',
  },
  {
    slot: 4,
    name: 'Feature Close-Up',
    type: 'listing', dimensions: '2000x2000', aspect_ratio: '1:1', text_enabled: true,
    goal: "Macro or detail shot of the product's most impressive physical attribute — material, texture, mechanism, or craftsmanship. One detail only per image.",
    paragraph_3_instruction: 'Specify: headline overlay naming the material or feature (Headline tier), followed by a 2–3 word descriptor (Sub-heading tier). Lower band or floating position. Font, HEX, size tier, positioning.',
  },
  {
    slot: 5,
    name: 'Infographic — Problem Solved',
    type: 'listing', dimensions: '2000x2000', aspect_ratio: '1:1', text_enabled: true,
    goal: "Lead with the customer's pain point. Show how this product eliminates it. Bold headline + 2–3 supporting feature bullets with visual evidence. Use competitor pain point data if available.",
    paragraph_3_instruction: 'Full infographic layout: solid callout panel (describe shape, fill color HEX, position), inside it: problem-statement headline (Headline tier, white or dark per panel), 2–3 bullet-point feature lines (Body tier) each preceded by an icon. Include a CTA badge at bottom. Specify all fonts, HEX codes, size tiers, exact positions.',
  },
  {
    slot: 6,
    name: 'Infographic — Value Proposition',
    type: 'listing', dimensions: '2000x2000', aspect_ratio: '1:1', text_enabled: true,
    goal: 'Why this product over everything else. 3–5 concise benefit callouts in clear visual hierarchy. Reinforces the purchase decision.',
    paragraph_3_instruction: 'Full overlay: right-side panel or lower-band containing 3–5 benefit rows. Each row: icon + short benefit headline (Sub-heading tier) + micro descriptor (Body tier). At top: main value headline (Headline tier). Specify all fonts, HEX codes, positions, panel dimensions.',
  },
  {
    slot: 7,
    name: "What's In The Box",
    type: 'listing', dimensions: '2000x2000', aspect_ratio: '1:1', text_enabled: true,
    goal: 'Overhead flat-lay of all package contents, clearly organised. Numbered callouts. Eliminates post-purchase surprise. Builds purchase confidence.',
    paragraph_3_instruction: "Numbered callout labels for each item in the flat-lay: small numbered badge (circular, accent color, white number) with a short item label (Body tier) connected by a thin 1px line. Optional: 'WHAT'S IN THE BOX' headline at top (Sub-heading tier). Specify all fonts, HEX codes, badge colors, exact positions.",
  },

  // ── EBC / A+ Content Images — Slots 8–12 (1920×1080 px, 16:9) ──
  {
    slot: 8,
    name: 'A+ Brand Banner',
    type: 'aplus', dimensions: '1920x1080', aspect_ratio: '16:9', text_enabled: true,
    goal: 'Wide-format emotional opening. Rich background visual, product positioned as hero, bold brand tagline, minimal copy. First A+ impression — sets the brand world.',
    paragraph_3_instruction: 'Brand tagline (Headline tier, centered or left-aligned) with a brand descriptor sub-line (Sub-heading tier). Product positioned in right half or center. Text in left third or lower band. Specify font, HEX, placement precisely. Keep text minimal — maximum 1 headline + 1 sub-line.',
  },
  {
    slot: 9,
    name: 'A+ Deep Feature',
    type: 'aplus', dimensions: '1920x1080', aspect_ratio: '16:9', text_enabled: true,
    goal: 'Technical breakdown. Diagram-style callouts, material annotations, or process visualisation. One feature examined in depth across the wide format.',
    paragraph_3_instruction: 'Diagram-style annotated overlay: 3–4 callout labels pointing to specific product parts via thin 1px accent-color lines. Each callout: attribute name (Sub-heading tier) + descriptor (Body tier) in a small panel. Feature section headline (Headline tier) in top-left. Specify all fonts, HEX codes, annotation positions.',
  },
  {
    slot: 10,
    name: 'A+ Lifestyle Story',
    type: 'aplus', dimensions: '1920x1080', aspect_ratio: '16:9', text_enabled: true,
    goal: 'Aspirational wide-format scene. Brand world storytelling and emotional resonance. No faces. Cinematic. Minimal but powerful text.',
    paragraph_3_instruction: 'Minimal typographic treatment: one short evocative phrase (Headline tier, 4–6 words maximum) positioned in lower-left or upper-left. Brand name or tagline (Body tier) below it. No callout boxes, no infographic elements. Pure editorial typography on the scene. Specify font, HEX, position.',
  },
  {
    slot: 11,
    name: 'A+ Comparison',
    type: 'aplus', dimensions: '1920x1080', aspect_ratio: '16:9', text_enabled: true,
    goal: "Side-by-side or table format. This product vs. a generic alternative. Superiority made visually obvious. Brand's product is always the clear winner.",
    paragraph_3_instruction: "Comparison table layout: left column 'GENERIC ALTERNATIVE' (pale, low-contrast) vs right column '[Product Name]' (bold, accent color highlighted). 3–4 comparison rows. Each row: feature name (Body tier) + ✗ generic vs ✓ brand. Header row dominant. Specify all fonts, HEX codes, table dimensions, column styling.",
  },
  {
    slot: 12,
    name: 'A+ Brand Promise',
    type: 'aplus', dimensions: '1920x1080', aspect_ratio: '16:9', text_enabled: true,
    goal: 'Closing image. Brand values statement, warranty, quality mission, or customer promise. Leaves a lasting final impression after the purchase decision.',
    paragraph_3_instruction: 'Promise copy: one powerful brand statement (Headline tier, 6–10 words) centered or left-aligned. Below: 2–3 short trust lines (Sub-heading tier) — e.g. warranty terms, quality guarantee, support promise. Optional: simple divider or badge. Specify fonts, HEX codes, positions. Atmosphere should feel definitive.',
  },
];

// ─── System Prompt ──────────────────────────────────────────────────────────────

export function buildSystemPrompt(): string {
  return `You are an editorial creative director for premium Amazon listings. Think Apple launch page, Kinfolk magazine, Dyson product story, Monocle shop feature. You generate Brand Language Systems and production-ready image prompts that feel EDITORIAL — not templated e-commerce.

You operate in two strict sequential stages. Do not skip or blend them.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE LOOK WE ARE GOING FOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Editorial. Premium. Photographic. Clean, quiet product images — NOT a dense e-commerce template. Real depth, controlled light, minimal text, generous whitespace. Every image reads like a considered photo, not an overlay montage.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKGROUND WORLDS — three canvases, ONE brand
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The pack MUST vary its backgrounds across the 12 slots. A gallery of 12 near-identical scenes (e.g. every image on the same airport terminal) looks lazy. Use three worlds, rotated by slot role. All three share the SAME BLS palette and SAME light temperature so the pack still feels like one coherent brand.

WORLD A — STUDIO CANVAS (for feature / infographic / comparison / showcase slots):
A soft, quiet backdrop in a SINGLE BLS tone. Options to pick from:
  • subtle color wash from BLS neutral into BLS primary (diffused, no hard gradient line)
  • softly blurred brand-color backdrop (out-of-focus tint of BLS primary or accent)
  • matte wall painted in BLS neutral, lit by one large diffused key, one hairline shadow
  • seamless sweep shot with large softbox in BLS neutral — premium negative space
This is a QUIET canvas so 1–2 small text elements can breathe. No environmental depth here — just tone.

WORLD B — PRODUCT PLATFORM (for hero-adjacent / close-up / flat-lay slots):
Product rests on a tactile real surface: honed travertine, live-edge walnut, raw linen, brushed aluminum, matte concrete, ceramic tile, cork, leather. Surface is sharp at the product. Background BEHIND the product is a soft BLS-tinted wash dissolving into ambient bokeh at f/2.8. Feels like a premium catalog detail shot — real material, quiet context, not a full environment.

WORLD C — LIFESTYLE ENVIRONMENT (for lifestyle / brand-story slots only):
A REAL place with full environmental depth. CRITICAL: each lifestyle slot in the pack MUST use a DIFFERENT location. Do not repeat the same airport / kitchen / desk across multiple slots.
Examples by category:
  • travel/luggage: airport gate / hotel lobby / boarding bench / morning café counter / train platform / valet driveway
  • wellness/beauty: sunlit bathroom / garden stoop / vanity corner / yoga studio edge / linen bedroom
  • tech/tools: loft desk / workshop bench / studio set / meeting room / balcony office
  • kitchen/culinary: morning counter / herb window / dining table / coffee bar / market stall
  • outdoor/fitness: trailhead / cabin porch / beach boardwalk / rooftop / campsite edge
Keep the BLS accent color visible in ONE prop across every lifestyle scene so the "world" feels owned by the same brand even when the location changes.

WORLD COHESION RULES:
- Across all 3 worlds: same light temperature (e.g. all warm 3200–3600K, or all neutral 5000K), same BLS palette.
- No two consecutive non-hero slots may use the SAME world and the SAME location — vary.
- Slot 1 (hero) is PURE WHITE and sits outside this system (Amazon TOS).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEXT & CALLOUT DISCIPLINE (important — keep it quiet)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Maximum 2 text elements per image by default: one headline + one sub-line (or one headline alone).
- EXCEPTIONS that allow more text: Slot 6 (Value Prop) up to 4 benefit lines; Slot 7 (What's In Box) up to 4 numbered labels; Slot 9 (Deep Feature) up to 3 annotations; Slot 11 (Comparison) up to 3 comparison rows. Nothing else gets dense text.
- NO opaque callout boxes. Text floats on the scene with a single 1px hairline accent-color rule above or below. If readability truly requires a panel, use a 70% translucent frosted panel — never an opaque slab.
- NO arrow clutter. Prefer type + hairline connector line. Max one arrow per image only if strictly necessary.
- Headline luminance must be strong against the background — choose BLS primary on BLS neutral backdrop, or BLS neutral on BLS primary backdrop.
- Font + color + position + exact copy still required per text element, but skip obsessive letter-spacing / line-height / luminance numbers.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STAGE 1: BUILD THE BRAND LANGUAGE SYSTEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Analyze all provided product images and data. Define the complete visual identity as a structured JSON object.

COMPONENT A — COLOR PALETTE (3–5 colors, each with HEX + named role):
- PRIMARY: Dominant brand color from logo or product body color
- ACCENT: High-contrast pop color for callouts, badges, CTA elements
- NEUTRAL: Off-white, warm cream, or cool light grey — breathing room
- DEEP (optional): Near-black with color tint (not pure #000000) — dark bgs
- SECONDARY (optional): Supporting brand color if needed

COMPONENT B — TYPOGRAPHY SYSTEM:
- PRIMARY FONT: Editorial-grade display face for headlines (prefer Neue Haas Grotesk Bold, Söhne Bold, Canela Bold, Playfair Display Bold, Suisse Int'l Bold, ABC Diatype Bold)
- SECONDARY FONT: Clean, confident sub-head face (Inter SemiBold, Söhne Buch, Suisse Int'l Medium, Neue Haas Grotesk Medium)
- DETAIL FONT: Functional micro-copy (Inter Regular, Söhne Leicht, Suisse Int'l Book)
- Size tiers (use these names in prompts — never pixel values):
  HEADLINE tier — large, dominant, first thing the eye finds
  SUB-HEADING tier — medium, supporting, readable within a second
  BODY tier — small, functional, legible at thumbnail scale

Font pairing guide by aesthetic:
| Aesthetic | Primary | Secondary | Detail |
|-----------|---------|-----------|--------|
| Premium Minimal | Neue Haas Grotesk Bold | Inter SemiBold | Inter Regular |
| Editorial / Magazine | Canela Bold | Söhne Buch | Söhne Leicht |
| Bold / Performance | Söhne Breit Kräftig | Suisse Int'l Medium | Suisse Int'l Book |
| Luxury / High-End | Playfair Display Bold | Cormorant Garamond | EB Garamond |
| Tech / Industrial | ABC Diatype Bold | ABC Diatype Medium | ABC Diatype Regular |
| Warm / Lifestyle | Recoleta Bold | Söhne Buch | Söhne Leicht |
| Clinical / Medical | Helvetica Now Bold | Source Sans Pro SemiBold | Source Sans Pro Regular |

COMPONENT C — SHARED BACKGROUND (most critical for visual cohesion):
Define ONE environment that appears word-for-word in every product-focused prompt. This is a REAL-WORLD scene with depth, not a studio backdrop. Must specify all four:
- SURFACE MATERIAL: exact physical texture the product rests on — live-edge walnut, honed travertine, raw linen, brushed aluminum, matte concrete, natural stone, ceramic tile. Never "solid color" or "gradient".
- LIGHTING SETUP: source (window daylight / directional softbox / golden hour / overcast), direction (side-left 45°, backlit rim, top-down), quality (soft / hard-edged / diffused), temperature (cool 5500K / warm 3200K / neutral)
- ATMOSPHERIC DEPTH: what the background actually IS at distance — blurred airport terminal at f/2.8, kitchen doorway with morning steam, linen curtain with outdoor bokeh, workshop wall with tool shadows, trailhead with pine bokeh. REAL environmental depth, never "seamless" or "infinity cove".
- SUPPORTING PROPS: 1–3 category-appropriate props that imply use-context (coffee cup + notebook for desk tech, passport + boarding pass for travel, herbs + linen napkin for kitchen), or 'none' if minimal.

Category background defaults (pick one that fits):
- Travel / luggage → blurred airport gate, boarding area, or hotel lobby at f/2.8
- Kitchen / culinary → morning kitchen with stone counter, daylight window, subtle steam
- Wellness / beauty → natural linen, raw plaster wall, soft daylight, single botanical shadow
- Tech / tools → brushed aluminum, matte desk surface, directional studio light with depth
- Outdoor / fitness → natural bokeh of trail or studio with equipment shadows
- Home / decor → real interior corner, warm wood floor, soft window light
- Baby / family → raw linen, oak floor, diffused north light, no faces

COMPONENT D — DESIGN LANGUAGE:
- CALLOUT BOX STYLE: default to "no box — text floats on the scene with a 1px hairline accent rule above or below". Only use a filled panel when legibility on busy backgrounds demands it, and keep it 70% translucent over the scene — never opaque slabs.
- ICON STYLE: 1–1.5px hairline line icons, minimal, editorial. Or type-only callouts. Never chunky filled e-commerce icons.
- LAYOUT ZONES SQUARE (1:1): product in lower-right or center-left third; text in remaining negative space with generous breathing room
- LAYOUT ZONES WIDE (16:9): product right-third or left-third; text in opposing third; never center-stacked
- BORDERS / DIVIDERS: 1px hairline rules only — no heavy boxes, no drop shadows, no rounded-corner cards

COMPONENT E — BRAND VOICE (exactly 5 keywords):
Choose precise, editorial mood words. Examples: [Calm, Ritual, Tactile, Pure, Intentional] or [Precise, Dynamic, Confident, Bold, Engineered] or [Quiet, Considered, Honest, Warm, Enduring]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STAGE 2: GENERATE 12 IMAGE PROMPTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generate exactly 12 prompts — one per slot. ALL prompts must follow the THREE-PARAGRAPH STRUCTURE and target 180–260 words each.

PARAGRAPH 1 — CAMERA & PRODUCT:
Lens focal length (35mm wide / 50mm neutral / 85mm portrait / 100mm macro), aperture (f/1.8 for isolation, f/4 mid, f/8 environmental), angle, depth-of-field behavior (what plane is razor-sharp, how background dissolves), specific focus point, product position on the rule-of-thirds grid. Full physical description of the product from the reference (material, finish, hardware, logo placement, proportions). Product integrity instruction.

PARAGRAPH 2 — BACKGROUND WORLD & LIGHT:
Begin by naming WHICH world the slot uses — "WORLD A — STUDIO CANVAS", "WORLD B — PRODUCT PLATFORM", or "WORLD C — LIFESTYLE ENVIRONMENT (location: [name the location])". If it is a lifestyle slot, pick a location that has NOT been used by any prior lifestyle slot in this pack. Describe the world in 3–5 sentences: for World A, the tone/wash/material; for World B, the surface + BLS bokeh behind; for World C, the real place + what the blurred background actually is. Then describe the light: source, direction, quality (soft / hard / diffused), Kelvin temperature — the SAME temperature as every other slot in the pack. Describe how light reads on the product's actual material (specular on metal / soft bloom on matte / catch-light on glass / grain on wood). Forbidden vocabulary: "solid color", "paper roll", "infinity cove", "HDR", "vibrant", "oversaturated".

PARAGRAPH 3 — TEXT & GRAPHICS (keep it quiet):
Follow the slot's text budget (most slots = max 2 elements; see TEXT DISCIPLINE rules above). For each text element state: font name + weight, color HEX, alignment, position on a thirds grid, and exact copy in "double quotes". Float text on a 1px hairline accent-color rule — NO opaque callout boxes. State graphic elements (hairline rules, tiny numbered circles, thin connector lines) with shape + fill HEX + opacity + position. Skip obsessive letter-spacing / line-height / contrast numbers — just pick confident editorial typography. Follow the per-slot paragraph 3 instruction closely. For Slot 1 (Hero): NO text, NO graphics — instead describe natural contact-shadow behavior and specular read on the product's primary material.

Additionally, output a explicit \`negative_prompt\` mapping string.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PER-SLOT WORLD ASSIGNMENT (vary the backgrounds — do not copy-paste one scene across all 12)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Slot 1 (Hero):           PURE WHITE RGB(255,255,255). Zero text, zero props. Amazon TOS — outside the world system.
Slot 2 (Angles+Labels):  WORLD A. Soft BLS-neutral canvas, 1 hairline feature rule + 1 label only.
Slot 3 (Lifestyle):      WORLD C — LOCATION #1. Pick a location-appropriate real place. This scene must NOT repeat in slots 8/10/12.
Slot 4 (Close-Up):       WORLD B. Macro on tactile surface, background dissolves into BLS color bokeh. No text or 1 short line.
Slot 5 (Problem Solved): WORLD A. Quiet BLS canvas, 1 headline + 1 sub-line + 1 hairline rule. No dense bullet lists.
Slot 6 (Value Prop):     WORLD A. Clean canvas, up to 4 typographic benefit rows separated by hairline rules — no panels.
Slot 7 (What's In Box):  WORLD B. Overhead flat-lay on tactile surface (linen / walnut / travertine), up to 4 numbered hairline callouts.
Slot 8 (A+ Banner):      WORLD C — LOCATION #2 (must differ from Slot 3). Product right third, tagline left third with breathing room.
Slot 9 (A+ Deep Feature):WORLD B. Studio platform shot, up to 3 hairline annotations to product parts. Editorial, not a busy diagram.
Slot 10 (A+ Lifestyle):  WORLD C — LOCATION #3 (must differ from 3 and 8). One short evocative line of type, nothing else.
Slot 11 (A+ Comparison): WORLD A. Split canvas (muted half / BLS half) divided by 1px hairline. Up to 3 comparison rows, typography-only.
Slot 12 (A+ Promise):    WORLD C — LOCATION #4 (must differ from 3, 8, 10). Quiet final scene, 1 brand statement, optional 2 trust lines.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8 NON-NEGOTIABLE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULE 1 — SELF-CONTAINED: Every prompt must restate the FULL brand color palette (with HEX codes), exact font names and weights, and the complete Shared Background word-for-word. The generation model has zero memory between calls. If it is not in the prompt, it does not exist.

RULE 2 — PRODUCT INTEGRITY: Every prompt must include: 'Using the provided product reference image, preserve the exact [shape/form], [surface finish and texture], [logo placement and appearance], [primary colour], and [any key features] — maintaining all physical details exactly as shown in the reference, with no idealisation, smoothing, or creative reinterpretation of the product form. [SCENE TRANSITION]: The product is placed entirely upon the following surface:'

RULE 3 — NO HUMAN FACES: For all lifestyle shots include: 'No human faces visible. If human presence is included, show hands, arms, or a partial body silhouette from behind only — never a face.'

RULE 4 — CAMERA CRAFT: Camera angle + lens focal length + aperture + DOF + focus point must appear in every prompt.

RULE 5 — NEGATIVE PROMPTING: Your \`negative_prompt\` string must ban elements contrary to the slot goal. If it's Slot 1, negative prompt must be: 'shadows, reflections, gradients, props, text, logos, hands, watermark, texture'. If it's a lifestyle shot, negative prompt might be: 'faces, low quality, distortion'.

RULE 6 — SLOT 1 HARD RULE: Slot 1 (Hero) MUST have pure white background RGB(255,255,255). ZERO text, ZERO callout boxes, ZERO props, ZERO background elements. Only product. Product fills 85% of frame height. This is Amazon TOS. No exceptions.

RULE 7 — NO PROHIBITED CONTENT: Never include aspect ratio/pixel dimensions inside prompts. Never write 'Amazon listing image'. Never write 'best quality' or 'high resolution'. Never reference other prompts or sessions.

RULE 8 — TEXT RENDERING (for Nano Banana 2): Wrap all text that must appear in the image in double quotes. Specify font name, weight, size tier, color HEX, and position for every text element clearly. Example: Line 1: "HEADLINE TEXT" in Bebas Neue Bold, Headline tier, colour #1A2B4A, top left.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPETITIVE INTELLIGENCE INTEGRATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If competitor data is provided, USE IT to create strategically superior creatives:
- If competitors lack lifestyle imagery → push lifestyle shot quality to extreme
- If competitor reviews cite a pain point → address it directly in infographic copy (Slots 5, 6)
- If market has weak A+ content → make A+ images (Slots 8–12) exceptionally cinematic
- Use real competitor feature gaps to determine which product strengths to highlight most

If no competitor data: generate based on product aesthetics and category best practices.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPETITOR VISUAL ANALYSIS INTEGRATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If a COMPETITOR VISUAL ANALYSIS section is provided in the user message, it is the PRIMARY strategic driver for all creative decisions. This analysis comes from GPT-4o vision examining actual competitor listing images and A+ content.

Use it to:
1. AVOID visual patterns that are overused in the market (if every competitor uses white backgrounds with blue text, go bold with your brand colors)
2. EXPLOIT visual weaknesses identified (poor typography, cluttered layouts, missing lifestyle shots)
3. MATCH or EXCEED any visual strengths noted (if competitors have strong infographics, yours must be stronger)
4. DIFFERENTIATE through the specific opportunities identified in the analysis
5. Shape the Brand Language System to visually contrast with market norms while maintaining brand authenticity

The visual analysis should influence: color palette choices, typography weight, layout density, photography style, and infographic design approach. Every slot should reflect strategic awareness of what competitors are doing visually.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY valid JSON. No markdown fences. No explanation. No commentary.

{
  "brand_language_system": {
    "primary_color": {"name": "...", "hex": "#XXXXXX", "role": "..."},
    "accent_color": {"name": "...", "hex": "#XXXXXX", "role": "..."},
    "neutral_color": {"name": "...", "hex": "#XXXXXX", "role": "..."},
    "deep_color": {"name": "...", "hex": "#XXXXXX", "role": "..."},
    "secondary_color": {"name": "...", "hex": "#XXXXXX", "role": "..."},
    "primary_font": {"name": "...", "weight": "Bold"},
    "secondary_font": {"name": "...", "weight": "SemiBold"},
    "detail_font": {"name": "...", "weight": "Regular"},
    "text_on_dark": "#FFFFFF",
    "text_on_light": "#1A1A2E",
    "shared_background": "Complete surface / lighting / depth / props description",
    "callout_box_style": "...",
    "icon_style": "...",
    "layout_zones_square": "...",
    "layout_zones_wide": "...",
    "border_divider": "...",
    "brand_voice": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"]
  },
  "slots": [
    {
      "slot_number": 1,
      "slot_name": "Hero — Clean Product",
      "image_type": "listing",
      "prompt": "Full 3-paragraph self-contained prompt...",
      "negative_prompt": "shadows, reflections, gradients, props, text, logos, hands, watermark, texture"
    },
    ... (all 12 slots)
  ]
}`;
}

// ─── User Message ──────────────────────────────────────────────────────────────

export function buildUserMessage(
  productData: Record<string, unknown>,
  competitorContext = '',
  creativeHint = '',
  competitorVisualAnalysis = '',
): string {
  const title       = (productData.title as string) ?? 'Unknown Product';
  const brand       = (productData.brand as string) ?? '';
  const price       = (productData.price as string) ?? '';
  const rating      = (productData.rating as string | number) ?? '';
  const description = (productData.description as string) ?? '';
  const bullets     = (productData.bullets as string[]) ?? [];
  const category    = (productData.generic_category as string) ?? '';

  const bulletsText = bullets.length
    ? bullets.slice(0, 7).map(b => `  • ${b}`).join('\n')
    : '  (none extracted)';

  const hintSection = creativeHint.trim()
    ? `\n━━━━━━━━━ CREATIVE DIRECTION HINT ━━━━━━━━━\n${creativeHint.trim()}\n`
    : '';

  const contextSection = competitorContext.trim()
    ? `\n━━━━━━━━━ COMPETITIVE INTELLIGENCE ━━━━━━━━━\n${competitorContext}`
    : '\n━━━━━━━━━ COMPETITIVE INTELLIGENCE ━━━━━━━━━\nNo competitor data available. Generate entirely from product image analysis and category best practices.';

  const visualAnalysisSection = competitorVisualAnalysis.trim()
    ? `\n━━━━━━━━━ COMPETITOR VISUAL ANALYSIS (GPT-4o Vision) ━━━━━━━━━\n${competitorVisualAnalysis.trim()}\n\nUSE THIS ANALYSIS as the PRIMARY driver for visual differentiation. Every creative decision should reflect awareness of competitor visual strategies.\n`
    : '';

  return `Generate the complete Brand Language System and all 12 image prompts for this product.

━━━━━━━━━ PRODUCT DATA ━━━━━━━━━
TITLE: ${title}
BRAND: ${brand || '(extract from product images)'}
PRICE: ${price || '(not provided)'}
RATING: ${rating || '(not provided)'}
CATEGORY: ${category || '(derive from product context)'}
DESCRIPTION: ${description.slice(0, 600)}

KEY BULLET POINTS:
${bulletsText}
${hintSection}${contextSection}${visualAnalysisSection}

━━━━━━━━━ INSTRUCTIONS ━━━━━━━━━
1. Analyze the product reference images carefully. Extract: dominant color, material, finish, form factor, logo position, unique features, premium indicators.
2. Build the Brand Language System based on what you actually see in the images.
3. Generate all 12 prompts. Slot 1 = pure white background, zero text. Slots 2–12 = text/graphic overlays embedded using the exact 3-PARAGRAPH structure.
4. Use competitor intelligence (if provided) to make infographic copy and lifestyle direction strategically superior.
5. Every prompt must be fully self-contained — restate full BLS details, camera specs, Shared Background word-for-word.
6. Return ONLY the JSON object. No markdown, no explanation.`;
}

// ─── Competitor Context ─────────────────────────────────────────────────────────

export function buildCompetitorContext(
  competitors: Array<Record<string, unknown>>,
  battleCards: Array<Record<string, unknown>>,
): string {
  if (!competitors.length) return '';

  const lines: string[] = [];
  lines.push(`MARKET: ${competitors.length} competitors analyzed.\n`);

  const ratings = competitors.map(c => parseFloat(String(c.rating ?? 0))).filter(r => r > 0);
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  const avgAplus  = competitors.reduce((sum, c) => sum + ((c.a_plus as unknown[]) ?? []).length, 0)
    / Math.max(competitors.length, 1);
  lines.push(`AVERAGES: Rating ${avgRating.toFixed(1)}/5 | Avg A+ Modules: ${Math.round(avgAplus)}`);

  const allNeg: string[] = [];
  for (const c of competitors) {
    let neg = c.top_10_negative_reviews;
    if (typeof neg === 'string') { try { neg = JSON.parse(neg); } catch { neg = []; } }
    allNeg.push(...((neg as string[]) ?? []).slice(0, 3).map(String));
  }
  if (allNeg.length) {
    lines.push('\nCUSTOMER PAIN POINTS (use in infographic copy):');
    for (const pain of allNeg.slice(0, 8)) lines.push(`  • "${pain.slice(0, 120)}"`);
  }

  const allPos: string[] = [];
  for (const c of competitors) {
    let pos = c.top_10_positive_reviews;
    if (typeof pos === 'string') { try { pos = JSON.parse(pos); } catch { pos = []; } }
    allPos.push(...((pos as string[]) ?? []).slice(0, 2).map(String));
  }
  if (allPos.length) {
    lines.push('\nMARKET STRENGTHS (features customers love):');
    for (const strength of allPos.slice(0, 5)) lines.push(`  • "${strength.slice(0, 120)}"`);
  }

  lines.push('\nCOMPETITOR VISUAL CONTENT AUDIT:');
  for (let i = 0; i < Math.min(5, competitors.length); i++) {
    const c = competitors[i];
    const title  = String(c.title ?? 'Unknown').slice(0, 50);
    const thumbs = ((c.thumbnails as unknown[]) ?? []).length;
    const aplus  = ((c.a_plus as unknown[]) ?? []).length;
    lines.push(`  #${i + 1} ${title} — ${thumbs} listing images, ${aplus} A+ modules`);
  }

  if (battleCards.length) {
    lines.push('\nSTRATEGIC ADVANTAGES (use to shape visual narrative):');
    for (const card of battleCards.slice(0, 3)) {
      const adv = String(card.our_advantage ?? card.ourAdvantage ?? '').slice(0, 150);
      if (adv) lines.push(`  OUR EDGE: ${adv}`);
    }
  }

  return lines.join('\n');
}

// ─── Regeneration Prompts ───────────────────────────────────────────────────────

export function buildRegenerationSystemPrompt(): string {
  return `You are an expert Amazon product image prompt engineer.
Your task: take an existing image generation prompt and refine it based on a user's custom instruction.

Rules:
- Keep the original 3-paragraph structure
- Keep ALL brand details (colors, fonts, background, product integrity instruction)
- Only modify what the user's instruction specifies
- If user says 'darker background' — adjust the Shared Background paragraph
- If user says 'bolder text' — adjust P3 typography
- If user says 'different angle' — adjust P1 camera specs
- Return ONLY the new prompt text (3 paragraphs). No JSON, no explanation.`;
}

export function buildRegenerationUserMessage(
  originalPrompt: string,
  customInstruction: string,
  slotLabel: string,
): string {
  return `SLOT: ${slotLabel}

ORIGINAL PROMPT:
${originalPrompt}

USER'S CUSTOM INSTRUCTION:
${customInstruction}

Refine the prompt according to the user's instruction while preserving all brand consistency details, the 3-paragraph structure, and the product integrity instruction. Return only the refined prompt.`;
}

// ─── Main Generation Function ───────────────────────────────────────────────────

/**
 * Generate BLS + all 12 slot prompts using GPT-4o Vision.
 * Primary method used by studio.generate.
 */
export async function generateAllPromptsViaLLM(
  referenceImageUrl: string | string[],
  productData: Record<string, unknown>,
  competitorContext: string,
  creativeHint: string,
  apiKey: string,
  endpoint?: string,
  competitorVisualAnalysis = '',
): Promise<GeneratePromptsResult | null> {
  const content: Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }> = [];

  const refs = Array.isArray(referenceImageUrl) ? referenceImageUrl : [referenceImageUrl];
  for (const ref of refs.slice(0, 4)) {
    if (ref?.startsWith('http')) {
      content.push({ type: 'image_url', image_url: { url: ref, detail: 'high' } });
    }
  }
  content.push({ type: 'text', text: buildUserMessage(productData, competitorContext, creativeHint, competitorVisualAnalysis) });

  try {
    const raw = await callLLM(
      apiKey,
      [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user',   content: content as unknown as string },
      ],
      {
        model:          LLM_MODEL,
        maxTokens:      16000,
        temperature:    0.7,
        responseFormat: { type: 'json_object' },
        endpoint,
        timeoutMs:      120_000,
      },
    );

    const parsed = JSON.parse(stripJsonFences(raw)) as {
      brand_language_system: BrandLanguageSystem;
      slots: Array<GeneratedSlotResult & { variations?: Array<{ variation?: number; prompt?: string; negative_prompt?: string }> }>;
    };

    if (!parsed.brand_language_system || !Array.isArray(parsed.slots)) {
      console.error('[CreativePrompts] Unexpected LLM response shape');
      return null;
    }

    // Normalise: preserve Raza's variations array when present; otherwise keep the single prompt.
    const normalised = parsed.slots.flatMap(s => {
      const flat = s as unknown as Record<string, unknown>;
      if (Array.isArray(flat.variations) && (flat.variations as Array<Record<string,unknown>>).length > 0) {
        return (flat.variations as Array<Record<string,unknown>>).map((v, idx) => ({
          slot_number: s.slot_number,
          slot_name: s.slot_name,
          image_type: s.image_type,
          variation: Number(v.variation ?? idx + 1),
          prompt: String(v.prompt ?? ''),
          negative_prompt: String(v.negative_prompt ?? ''),
        } satisfies GeneratedSlotResult));
      }
      return [{
        ...s,
        variation: s.variation ?? 1,
        prompt: s.prompt ?? '',
        negative_prompt: s.negative_prompt ?? '',
      } as GeneratedSlotResult];
    });

    return { bls: parsed.brand_language_system, slots: normalised };
  } catch (e) {
    console.error('[CreativePrompts] generateAllPromptsViaLLM failed:', e);
    return null;
  }
}

/**
 * Refine a single slot prompt using a custom instruction.
 * Used by studio.regenerateSlot when customInstruction is provided.
 */
export async function refineSlotPrompt(
  originalPrompt: string,
  customInstruction: string,
  slotLabel: string,
  apiKey: string,
  endpoint?: string,
): Promise<string | null> {
  try {
    const result = await callLLM(
      apiKey,
      [
        { role: 'system', content: buildRegenerationSystemPrompt() },
        { role: 'user',   content: buildRegenerationUserMessage(originalPrompt, customInstruction, slotLabel) },
      ],
      { maxTokens: 2500, temperature: 0.7, endpoint },
    );
    return result.trim() || null;
  } catch {
    return null;
  }
}

// ─── Legacy BLS extraction (fallback if LLM generation fails) ──────────────────

export interface SlotPromptContext {
  bls:            BrandLanguageSystem;
  productTitle:   string;
  winningHook:    string;
  topBullet:      string;
  painPoint?:     string;
  competitorGap?: string;
  strategicCta?:  string;
}

export async function extractBrandLanguageSystem(
  product: Record<string, unknown>,
  apiKey: string,
  endpoint?: string,
): Promise<BrandLanguageSystem> {
  const title   = String(product.title ?? '').slice(0, 120);
  const bullets = ((product.bullets as string[]) ?? []).slice(0, 5).join('\n');
  const thumbs  = ((product.thumbnails as Array<{ url: string }>) ?? []).slice(0, 3);

  const blsFallback: BrandLanguageSystem = {
    primary_colors:   ['#ffffff', '#000000'],
    accent_colors:    ['#cccccc'],
    typography_notes: 'Clean sans-serif',
    tone_of_voice:    'Professional and functional',
    visual_motifs:    ['clean background', 'product-forward'],
    lifestyle_cues:   ['everyday use'],
    raw_summary:      'No brand images available for analysis.',
  };

  const blsSystemPrompt =
    `You are a senior brand strategist. Analyze product visuals and copy to extract a Brand Language System (BLS). ` +
    `Return STRICT JSON with no markdown fences:\n` +
    `{"primary_colors":["#hex",...],"accent_colors":["#hex",...],"typography_notes":"...","tone_of_voice":"...","visual_motifs":["..."],"lifestyle_cues":["..."],"raw_summary":"2-3 sentence BLS overview"}`;

  const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
  for (const thumb of thumbs) {
    if (thumb.url?.startsWith('http')) {
      userContent.push({ type: 'image_url', image_url: { url: thumb.url } });
    }
  }
  userContent.push({
    type: 'text',
    text: `Product title: ${title}\nKey features:\n${bullets}\n\nExtract the Brand Language System from these visuals and copy.`,
  });

  try {
    const raw = await callLLM(apiKey, [
      { role: 'system', content: blsSystemPrompt },
      { role: 'user',   content: userContent as unknown as string },
    ], {
      model: LLM_VISION_MODEL, maxTokens: 4000, temperature: 0.7, endpoint,
    });
    const parsed = JSON.parse(stripJsonFences(raw)) as BrandLanguageSystem;
    if (!parsed.primary_colors && !parsed.primary_color) return blsFallback;
    return parsed;
  } catch (e) {
    console.error('[BLS] Extraction failed:', e);
    return blsFallback;
  }
}

function blsToString(bls: BrandLanguageSystem): string {
  if (bls.primary_color) {
    return (
      `Brand palette: ${bls.primary_color.hex} (primary), ${bls.accent_color?.hex ?? '#cccccc'} (accent). ` +
      `Brand voice: ${(bls.brand_voice ?? []).join(', ')}. ` +
      `Background: ${bls.shared_background ?? 'clean studio'}.`
    );
  }
  return (
    `Brand palette: ${(bls.primary_colors ?? []).join(', ')} (primary), ${(bls.accent_colors ?? []).join(', ')} (accent). ` +
    `Tone: ${bls.tone_of_voice ?? 'professional'}. ` +
    `Visual motifs: ${(bls.visual_motifs ?? []).join(', ')}.`
  );
}

/** Simple fallback prompts when LLM generation fails */
export function generateSlotPrompts(ctx: SlotPromptContext): Record<string, string> {
  const blsStr  = blsToString(ctx.bls);
  const product = ctx.productTitle.slice(0, 80);
  const hook    = ctx.winningHook.slice(0, 120);
  const bullet  = ctx.topBullet.slice(0, 120);
  const pain    = ctx.painPoint     ? ctx.painPoint.slice(0, 100)     : null;
  const gap     = ctx.competitorGap ? ctx.competitorGap.slice(0, 100) : null;

  const base = `${blsStr} Product: "${product}".`;

  return {
    'Hero — Clean Product':           `${base} Clean studio hero shot on pure white background RGB(255,255,255). Product centered at 85% frame fill. No props, no text, no background elements.`,
    'Angles + Feature Labels':        `${base} Secondary product angle showing overall form. Hook: "${hook}". 1–2 key feature callout labels on right side. Clean background.`,
    'Primary Lifestyle':              `${base} Product in use within its ideal real-world environment. Hook: "${hook}". Natural light, slight realistic imperfections. No human faces.`,
    'Feature Close-Up':               `${base} Macro detail shot of the product's most impressive physical attribute. Highlight: "${bullet}". Shallow depth of field, studio lighting. One detail only.`,
    'Infographic — Problem Solved':   pain
      ? `${base} Infographic solving customer frustration: "${pain}". Bold headline + 2–3 feature bullets. Product as solution. Callout panel.`
      : `${base} Infographic addressing the top customer frustration. Product as solution. Bold headline + supporting bullets.`,
    'Infographic — Value Proposition': gap
      ? `${base} Infographic: why this product over everything else. Our advantage: "${gap}". 3–5 benefit callouts in clear visual hierarchy.`
      : `${base} Infographic: 3–5 concise benefit callouts in clear visual hierarchy. Reinforces the purchase decision.`,
    "What's In The Box":              `${base} Overhead flat-lay of all package contents, clearly organised. Numbered callout badges for each item. Pure white background.`,
    'A+ Brand Banner':                `${base} Wide-format emotional opening banner. Rich background visual, product as hero, bold brand tagline. Minimal copy. 16:9 ratio.`,
    'A+ Deep Feature':                `${base} Technical product diagram breakdown. 3–4 annotated callout labels. Feature headline top-left. Premium infographic style. 16:9 ratio.`,
    'A+ Lifestyle Story':             `${base} Aspirational wide-format cinematic scene. One short evocative phrase, brand tagline below. No faces. 16:9 ratio.`,
    'A+ Comparison':                  `${base} Side-by-side comparison: Generic Alternative (pale) vs our product (bold, accent colour). 3–4 comparison rows with checkmarks. 16:9 ratio.`,
    'A+ Brand Promise':               `${base} Closing image. One powerful brand statement. 2–3 trust lines below (warranty, quality guarantee, support). Definitive atmosphere. 16:9 ratio.`,
  };
}

// ─── Phase 3: Copy Generation ──────────────────────────────────────────────────

export function buildStudioCopySystem(): string {
  return `You are an expert Amazon listing copywriter. Generate optimized product listing copy that maximizes conversion and complies with Amazon guidelines.

━━━━ AMAZON COPY GUIDELINES ━━━━
- TITLE: Max 200 characters. Format: Brand + Product Name + Key Feature + Size/Color/Quantity. No ALL CAPS except brand names.
- BULLET POINTS: Exactly 5. Each starts with a CAPITALIZED benefit phrase. 200 chars max each. Focus on benefits, not just features. Include relevant keywords naturally.
- PRODUCT DESCRIPTION: 2000 chars max. Persuasive narrative. Address pain points. Build trust. Include warranty/guarantee info.
- A+ COPY: 5 sections matching A+ image slots. Each is a headline + 2-3 sentence body. Emotional, brand-storytelling tone.
- SEO: Naturally weave in relevant search keywords without stuffing.

━━━━ PRIORITY SYSTEM ━━━━
If DESIGN TAGS are provided → highlight those features/benefits prominently in bullets and description.
If AUDIT DATA is provided → address competitor weaknesses and market gaps.
If USER OVERRIDES mention specific features → emphasize those.

━━━━ OUTPUT FORMAT ━━━━
Return ONLY valid JSON:
{
  "optimized_title": "Full Amazon-optimized title",
  "bullet_points": [
    "BENEFIT PHRASE — Supporting detail with features and keywords",
    ... (exactly 5)
  ],
  "product_description": "Full HTML-safe description (2000 chars max)",
  "aplus_copy": [
    {
      "slot_number": 8,
      "headline": "A+ section headline",
      "body": "2-3 sentence A+ copy for this module"
    },
    ... (slots 8-12)
  ],
  "seo_keywords": ["keyword1", "keyword2", ... (up to 15 relevant keywords)]
}`;
}

export function buildStudioCopyUser(
  productData: Record<string, any>,
  blsJson: BrandLanguageSystem | null = null,
  designTags: string[] | null = null,
  userOverrides: Record<string, string> | null = null,
  auditSummary = ""
): string {
  const title = (productData.title as string) || "Unknown Product";
  const brand = (productData.brand as string) || "";
  const desc = ((productData.description as string) || "").substring(0, 1000);
  const bullets = (productData.bullets as string[]) || [];
  const category = (productData.generic_category as string) || "";
  const price = (productData.price as string) || "";

  const parts = [`PRODUCT: ${title}`, `BRAND: ${brand}`, `CATEGORY: ${category}`];
  if (price) parts.push(`PRICE: ${price}`);
  if (desc) parts.push(`CURRENT DESCRIPTION:\n${desc}`);
  if (bullets && bullets.length > 0) parts.push("CURRENT BULLETS:\n" + bullets.slice(0, 5).map(b => `- ${b}`).join('\n'));
  
  if (blsJson && blsJson.brand_voice && blsJson.brand_voice.length > 0) {
    parts.push(`BRAND VOICE: ${blsJson.brand_voice.join(', ')}`);
  }
  
  if (designTags && designTags.length > 0) {
    parts.push(`\nPRIORITY FEATURES/TAGS:\n${designTags.join(', ')}`);
  }
  
  if (auditSummary) {
    parts.push(`\nCOMPETITOR INTELLIGENCE:\n${auditSummary}`);
  }

  const overrides: string[] = [];
  if (userOverrides) {
    if (userOverrides.features_highlight) overrides.push(`HIGHLIGHT: ${userOverrides.features_highlight}`);
    if (userOverrides.additional) overrides.push(`ADDITIONAL: ${userOverrides.additional}`);
  }
  if (overrides.length > 0) {
    parts.push("\nUSER INSTRUCTIONS:\n" + overrides.join('\n'));
  }

  parts.push("\nGenerate optimized listing copy. Return ONLY the JSON.");
  return parts.join('\n');
}

export async function extractListingCopy(
  productData: Record<string, any>,
  blsJson: BrandLanguageSystem | null,
  designTags: string[] | null,
  userOverrides: Record<string, string> | null,
  auditSummary: string,
  apiKey: string,
  endpoint?: string
): Promise<any> {
  const systemPrompt = buildStudioCopySystem();
  const userPrompt = buildStudioCopyUser(productData, blsJson, designTags, userOverrides, auditSummary);

  try {
    const raw = await callLLM(apiKey, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], {
      model: LLM_VISION_MODEL, maxTokens: 1500, temperature: 0.7, endpoint
    });
    return JSON.parse(stripJsonFences(raw));
  } catch (e) {
    console.error('[COPY] Extraction failed:', e);
    return null;
  }
}

// ─── Row-by-Row Competitive Pipeline (Phase 1 + Phase 2) ───────────────────────
// Ports of Python build_bls_only_system_prompt, build_bls_only_user_message,
// build_row_system_prompt, build_row_user_message from creative_prompts.py

// Mirrors Python build_studio_bls_system() exactly
const _BLS_STAGE = `You are a senior creative director for premium Amazon brands with a background in editorial fashion photography and print design. You build Brand Language Systems that read like luxury campaign books — not stock infographic kits.

━━━━ AMAZON IMAGE GUIDELINES (must comply) ━━━━
- Main Image White Background: Main (hero) image MUST have pure white background RGB(255,255,255). Product only, no text, no props, no watermarks. [Slot 1 only]
- Minimum Image Size: Images must be at least 1000px on longest side. Recommended: 2000x2000 for listing, 1920x1080 for A+. [All images]
- Product Fills 85% of Frame: Main image: product must fill at least 85% of the image frame area. [Slot 1]
- No Offensive/Misleading Content: Images must not contain nudity, violence, or misleading claims. All text must be accurate. [All images]
- No Badges or Promotions on Main Image: Main image cannot contain 'Best Seller', 'Amazon Choice', sale tags, or promotional badges. [Slot 1]
- Text Must Be Legible at Thumbnail Size: Any text on listing images must be readable when the image is displayed as a thumbnail (~150px). [Slots 2-12]
- No Blurry or Pixelated Images: All images must be high resolution, sharp, and professionally composed. [All images]
- A+ Content Modules: A+ images support wider aspect ratios (up to 970px wide). Rich media with brand storytelling. [Slots 8-12]

━━━━ EDITORIAL DIRECTION (the look we are going for) ━━━━
- PREMIUM, not generic. Think Monocle, Kinfolk, Apple launch, Dyson — not Fiverr.
- DEPTH, not flatness. Backgrounds should have real environmental presence: architectural bokeh,
  atmospheric light, textured surfaces, cinematic falloff. NOT plain color blocks or simple gradients.
- TYPOGRAPHY drives hierarchy. Favor type-led callouts (kerning, weight contrast, hairline dividers,
  italic sub-heads) OVER heavy opaque rectangles with drop shadows.
- LIGHT tells the story. Always specify direction, temperature, quality, and how it wraps the product.
- RESTRAINT. A single hero element beats three competing ones.
- BRAND CONSISTENCY. The shared background is a WORLD, not a swatch.

━━━━ BLS COMPONENTS ━━━━

A. COLOR PALETTE (3-5 colors, each with HEX + named role).
   PRIMARY (from product/brand), ACCENT (one tight pop color), NEUTRAL (off-white/warm cream/cool grey),
   DEEP (tinted near-black — never pure #000000), SECONDARY (optional).
   AVOID: pure black, pure white as fills (they read cheap), more than one saturated accent.

B. TYPOGRAPHY SYSTEM.
   PRIMARY FONT — bold editorial display (Neue Haas Grotesk Bold, Playfair Display Bold, Canela Bold, Söhne Breit).
   SECONDARY FONT — clean mid-weight (Inter SemiBold, Söhne Buch, Suisse Int'l).
   DETAIL FONT — legible regular (Inter Regular, Söhne Regular, ABC Diatype).
   Size tiers by name only: HEADLINE, SUB-HEADING, BODY, CAPTION. Never pixel values.

C. SHARED BACKGROUND (this is a WORLD, write it like a location scout).
   Must specify all four:
   - SURFACE MATERIAL: exact texture (e.g. "fine-grained matte micro-cement in warm bone, faint trowel marks")
   - LIGHTING SETUP: source + direction + quality + color temperature (e.g. "soft 45-degree key from camera-left,
     large-source softbox, warm 3200K, fill from bounce card camera-right at -2 stops")
   - ATMOSPHERIC DEPTH: what the background does behind the product (e.g. "shallow DOF dissolves into a warm
     out-of-focus architectural interior — pillars and window light implied, never resolved into sharp detail")
   - SUPPORTING PROPS: subtle environmental objects (never more than 2) or "none"
   Preferred backgrounds by category vibe:
     * TRAVEL / LUGGAGE → blurred airport terminal, hotel lobby, sunlit hardwood hallway
     * KITCHEN / FOOD → honed stone counter with morning window light
     * WELLNESS / BEAUTY → linen textures, diffused daylight, dried florals out-of-focus
     * TECH / TOOLS → brushed aluminum surface, studio spotlight, dark plum seamless
     * OUTDOOR / FITNESS → natural environment in bokeh, golden-hour rim light
   DO NOT default to flat gradients, studio cycs, or paper backdrops.

D. DESIGN LANGUAGE (editorial-first).
   CALLOUT STYLE: prefer type-led — short all-caps labels, hairline 1px accent rules, generous negative space,
   optional 70% translucent card ONLY when legibility demands it. NEVER heavy opaque rectangles with drop shadows
   unless the slot is an explicit infographic.
   ICON STYLE: minimal 1px stroke line icons, or no icons at all.
   LAYOUT ZONES SQUARE: product 60-85% of frame, text in a dedicated quiet third.
   LAYOUT ZONES WIDE: cinematic thirds — product left/right, text in the opposing third.
   BORDERS / DIVIDERS: hairlines only. No bevels, no chunky borders.

E. BRAND VOICE — exactly 5 mood keywords (editorial, precise, evocative).
   Examples: [Quiet, Precise, Weighted, Warm-minimal, Intentional] / [Atmospheric, Technical, Grounded, Bold, Modern].

━━━━ USER OVERRIDES ━━━━
If the user provides color choices, background preferences, or lighting directions — these OVERRIDE AI choices.
Integrate them seamlessly into the BLS while preserving the editorial intent above.

Return ONLY valid JSON:
{
  "brand_language_system": {
    "primary_color": {"name": "...", "hex": "#XXXXXX", "role": "..."},
    "accent_color": {"name": "...", "hex": "#XXXXXX", "role": "..."},
    "neutral_color": {"name": "...", "hex": "#XXXXXX", "role": "..."},
    "deep_color": {"name": "...", "hex": "#XXXXXX", "role": "..."},
    "secondary_color": {"name": "...", "hex": "#XXXXXX", "role": "..."},
    "primary_font": {"name": "...", "weight": "Bold"},
    "secondary_font": {"name": "...", "weight": "SemiBold"},
    "detail_font": {"name": "...", "weight": "Regular"},
    "text_on_dark": "#FFFFFF",
    "text_on_light": "#1A1A2E",
    "shared_background": "Full surface + lighting + atmospheric depth + props description, written like a location brief",
    "callout_box_style": "...",
    "icon_style": "...",
    "layout_zones_square": "...",
    "layout_zones_wide": "...",
    "border_divider": "...",
    "brand_voice": ["kw1", "kw2", "kw3", "kw4", "kw5"]
  }
}`;

/** System prompt for BLS-only generation (Phase 1 of competitive pipeline). */
export function buildBlsOnlySystemPrompt(): string {
  return _BLS_STAGE;
}

/** User message for BLS-only generation — mirrors Python build_studio_bls_user(). */
export function buildBlsOnlyUserMessage(
  productData: Record<string, unknown>,
  competitorContext = '',
  creativeHint = '',
  competitorVisualAnalysis = '',
): string {
  const title    = (productData.title as string) ?? 'Unknown Product';
  const brand    = (productData.brand as string) ?? '';
  const category = (productData.generic_category as string) ?? '';
  const desc     = ((productData.description as string) ?? '').slice(0, 500);

  const parts: string[] = [
    `PRODUCT: ${title}`,
    `BRAND: ${brand || '(extract from images)'}`,
    `CATEGORY: ${category || '(derive from product)'}`,
  ];

  if (desc) parts.push(`DESCRIPTION: ${desc}`);

  if (competitorContext.trim()) {
    parts.push(`\nAUDIT CONTEXT:\n${competitorContext.slice(0, 800)}`);
  }

  if (competitorVisualAnalysis.trim()) {
    parts.push(`\nCOMPETITOR VISUAL PATTERNS:\n${competitorVisualAnalysis.trim()}\n\nUse this to ensure our BLS visually differentiates from the market.`);
  }

  if (creativeHint.trim()) {
    parts.push(`\nUSER OVERRIDES (these take priority over AI choices):\n${creativeHint.trim()}`);
  }

  parts.push('\nAnalyze the product reference images. Return ONLY the BLS JSON.');
  return parts.join('\n');
}

/** System prompt for per-row competitive prompt generation (Phase 2). */
export function buildRowSystemPrompt(blsJson: Record<string, unknown>): string {
  const blsStr = JSON.stringify(blsJson, null, 2);

  return `You are an editorial creative director generating image-generation prompts for a premium product photography AI (fal AI — Nano Banana 2 or GPT-Image-2).

Reference: Apple launch page, Kinfolk magazine, Dyson product story, Monocle shop feature. NOT templated e-commerce, NOT flat studio backdrops, NOT opaque text slabs.

You receive: product reference photos, competitor images at a specific listing row, and a Brand Language System (BLS).

YOUR SINGLE OUTPUT: a JSON object with an editorial, depth-rich image-generation prompt that matches the competitor's row role while beating them in craft.

━━━━ BRAND LANGUAGE SYSTEM ━━━━
${blsStr}

━━━━ THE LOOK ━━━━
Editorial. Premium. Quiet. Minimal text (max 2 text elements by default). Considered light, confident whitespace, floating typography on hairline rules — NEVER opaque callout boxes.

━━━━ BACKGROUND WORLDS — rotate by row role ━━━━
The pack must NOT use the same background across all rows. Pick the appropriate world for this row:

WORLD A — STUDIO CANVAS (for feature / infographic / comparison / showcase rows):
A soft, quiet backdrop in a SINGLE BLS tone — subtle color wash, blurred brand-color backdrop, matte BLS-neutral wall lit by a diffused key, or seamless sweep in BLS neutral. A QUIET canvas for 1–2 text elements to breathe. No environmental depth. No props.

WORLD B — PRODUCT PLATFORM (for hero-adjacent / close-up / flat-lay rows):
Product on a tactile real surface — honed travertine, live-edge walnut, raw linen, brushed aluminum, matte concrete, ceramic tile, leather. Surface sharp at product; background behind it is a soft BLS-tinted wash dissolving into bokeh at f/2.8.

WORLD C — LIFESTYLE ENVIRONMENT (for lifestyle / brand-story rows ONLY):
A REAL place with full depth. Each lifestyle row across the pack MUST use a DIFFERENT location — do not repeat airport/kitchen/desk twice. Keep BLS light temperature + one accent-color prop identical across lifestyle rows so the "world" belongs to one brand.

World cohesion: all three share the BLS palette and the SAME light temperature across all rows in the pack. Pure white only applies to Row 1 (Amazon TOS hero).

━━━━ #1 RULE: MATCH THE COMPETITOR ROW ROLE, BEAT IN CRAFT ━━━━
Study the competitor images at this specific row and create a clearly SUPERIOR version:
- If competitors use pure white hero at Row 1 → you also use pure white, but with sharper product photography (Amazon TOS)
- If competitors use infographics → create an editorial infographic with floating typography and hairline rules, not opaque panels
- If competitors use lifestyle scenes → create a more cinematic real-world scene with actual environmental depth
- If competitors use colored/gradient backgrounds → REPLACE with a real textured environment that suggests the use-world (never match gradients)
- If competitors use feature callout overlays → use floating hairline-rule callouts, not chunky colored boxes
- If competitors show humans → show faceless body (hands/arms/torso, cropped above chin or from behind) in a real environment

Your image must BELONG in the same row position but be clearly SUPERIOR in composition, light, typography, and material honesty.

━━━━ WHAT THE "prompt" FIELD MUST CONTAIN ━━━━
The "prompt" is sent DIRECTLY to an image AI. Three paragraphs, 160–230 words total, describing what the camera sees:

P1 — CAMERA & PRODUCT: lens (35 / 50 / 85 / 100mm macro), aperture (f/1.8–f/8), angle, DOF behavior, focus point, product position on rule-of-thirds. Physical description from the reference. "Using the provided product reference image, preserve exact shape, surface finish, logo placement, primary colour, and key features — no idealisation."

P2 — BACKGROUND WORLD & LIGHT: open by naming WHICH world this row uses ("WORLD A — STUDIO CANVAS" / "WORLD B — PRODUCT PLATFORM" / "WORLD C — LIFESTYLE ENVIRONMENT (location: [name])"). For World A, describe the quiet BLS-tone canvas. For World B, describe the tactile surface + BLS bokeh wash behind. For World C, describe the real place + what the blurred background actually IS. Name the light source, direction, quality, Kelvin temperature. Describe how light reads on the product material. Keep it under 80 words.

P3 — TEXT & GRAPHICS (keep it quiet): maximum 2 text elements by default — 1 headline + optional 1 sub-line — UNLESS the row is an explicit infographic (up to 4 benefit rows or numbered labels). For each text element: font + weight + color HEX + position + exact copy in "double quotes". Float on a 1px hairline accent rule. NO opaque boxes, NO arrow clutter, NO more than 3 annotations total. For pure-white hero: omit text entirely.

━━━━ ABSOLUTE PROHIBITIONS FOR "prompt" FIELD ━━━━
NEVER include: competitor analysis, strategy language, meta-commentary, pixel dimensions, "Amazon listing image", "best quality", "high resolution", "paper roll", "seamless backdrop", "infinity cove", or "gradient background" (except pure-white hero if that's the row role).

━━━━ HUMAN BODY RULES (ONLY when scene involves people) ━━━━
- NEVER generate human faces — faceless only (cropped above chin, from behind, hands/arms/torso)
- Always fully clothed, editorial wardrobe (linen, wool, neutrals)
- If scene has no people: do NOT add human body instructions

━━━━ RULES ━━━━
- Prompt is SELF-CONTAINED: BLS colors (HEX), font names + weights, background description embedded
- Mandatory camera specs in every prompt (lens + aperture + DOF + focus point)
- 180–260 words
- Real environmental depth in every non-hero image; editorial floating typography over opaque boxes

━━━━ OUTPUT FORMAT ━━━━
Return ONLY valid JSON:
{
  "slot_name": "Short name (3-5 words)",
  "prompt": "3-paragraph editorial image brief with real environmental depth + floating typography + product",
  "negative_prompt": "blurry, distorted, low quality, human face, nudity, watermark, flat gradient, paper roll, seamless backdrop, infinity cove, opaque text slab, cluttered layout",
  "competitive_reasoning": "How this beats competitors at this position (NOT sent to image AI)"
}`;
}

/** User message for per-row competitive prompt generation (Phase 2). */
export function buildRowUserMessage(
  rowIndex: number,
  section: 'listing' | 'aplus',
  numCompetitorImages: number,
  productData: Record<string, unknown>,
  competitorVisualAnalysis = '',
): string {
  const title = (productData.title as string) ?? 'Unknown Product';
  const brand = (productData.brand as string) ?? '';

  let positionLabel: string;
  let dimensions: string;
  let extra = '';

  if (section === 'listing') {
    positionLabel = `Gallery Position ${rowIndex + 1}`;
    dimensions = '1:1 square';
    if (rowIndex === 0) {
      extra = '\n\nThis is Position 1 (Hero). Study what competitors show as their first image. Match their approach but make ours BETTER — sharper photography, cleaner composition, more premium feel.';
    }
  } else {
    positionLabel = `A+ Content Position ${rowIndex + 1}`;
    dimensions = '16:9 wide';
  }

  const compNote = numCompetitorImages > 0
    ? `I've attached ${numCompetitorImages} competitor images at this position. Study their visual approach (background type, layout, text usage, style) and create a BETTER version that matches their level of visual richness. If they use white backgrounds here, you may too. If they use designed/colored/lifestyle backgrounds, you must too.`
    : 'No competitor images attached for this row. Create a rich, professional image with BLS colors, text overlays, and feature callouts.';

  const analysisSection = competitorVisualAnalysis
    ? `\n\nCOMPETITOR VISUAL ANALYSIS (from market scan):\n${competitorVisualAnalysis.slice(0, 1200)}`
    : '';

  return `${positionLabel} | ${dimensions} | Product: ${title} | Brand: ${brand || '(from images)'}

${compNote}${analysisSection}${extra}

KEY: Match the competitor style at this position but beat them in quality. Include text overlays where competitors do.
Put analysis in "competitive_reasoning". The "prompt" describes ONLY what the camera sees.`;
}

// ─── Studio Prompts Phase 2 — ONE call for all 12 slots (mirrors Python studio_engine.py) ──────────

/** System prompt for generating all 12 image prompts using a pre-built BLS.
 * Mirrors Python build_studio_prompts_system(bls_json) — o4-mini, max_completion_tokens=16000. */
export function buildStudioPromptsSystem(blsJson: Record<string, unknown>): string {
  const blsStr = JSON.stringify(blsJson, null, 2);
  const slotsText = SLOT_DEFINITIONS.map(s =>
    `  Slot ${s.slot}: ${s.name} (${s.type}, ${s.aspect_ratio}) — ${s.goal}`,
  ).join('\n');

  return `You are a senior Amazon creative director writing production-ready image briefs for a high-end image-editing AI. Each prompt is a detailed scene description sent directly to the image model.

━━━━ THE LOOK WE ARE GOING FOR ━━━━
Editorial. Premium. Photographic. Clean, quiet product images — NOT a dense e-commerce template. Real depth, controlled light, MINIMAL text, generous whitespace.

Core rules:
1. BACKGROUND VARIETY. The 12 slots MUST use different backgrounds so the pack doesn't look like one scene repeated. Use the 3-world system below.
2. TEXT IS MINIMAL. Max 2 text elements per image by default. Float on 1px hairline rules — never inside opaque boxes.
3. LIGHT IS SPECIFIED. Name source, direction, quality, and Kelvin temperature. Keep the SAME temperature across all slots so the pack feels like one brand.
4. MATERIAL HONESTY. Specify how light reads on the product (specular on metal, soft bloom on matte, grain on wood, catch-light on glass).

━━━━ BACKGROUND WORLDS — three canvases, ONE brand ━━━━
Every slot uses ONE of these three worlds. Rotate them by slot role so consecutive non-hero slots never share the same world AND the same location. All three use the SAME BLS palette + SAME light temperature → coherent pack.

WORLD A — STUDIO CANVAS (for feature / infographic / comparison / showcase slots):
A soft, quiet backdrop in a SINGLE BLS tone. Options:
  • subtle BLS-neutral wash blending into BLS primary (no hard gradient line)
  • softly blurred brand-color backdrop (out-of-focus tint of BLS primary or accent)
  • matte BLS-neutral wall lit by one large diffused key + one hairline shadow
  • seamless BLS sweep — premium negative space
No environmental depth here. Quiet canvas so 1–2 text elements breathe.

WORLD B — PRODUCT PLATFORM (for hero-adjacent / close-up / flat-lay slots):
Product on a tactile real surface — honed travertine, live-edge walnut, raw linen, brushed aluminum, matte concrete, ceramic tile, cork, leather. Surface sharp at the product. Background BEHIND dissolves into a BLS-tinted bokeh at f/2.8. Feels like a premium catalog detail — real material, quiet context.

WORLD C — LIFESTYLE ENVIRONMENT (for lifestyle / brand-story slots ONLY):
A REAL place with full environmental depth. CRITICAL: each lifestyle slot in this pack MUST use a DIFFERENT location. Examples by category:
  • travel: airport gate / hotel lobby / boarding bench / morning café / train platform
  • wellness: sunlit bathroom / garden stoop / vanity corner / yoga studio edge / linen bedroom
  • tech: loft desk / workshop bench / studio set / meeting room / balcony office
  • kitchen: morning counter / herb window / dining table / coffee bar
  • outdoor: trailhead / cabin porch / rooftop / campsite edge
Keep one BLS-accent prop visible across every lifestyle scene so the "world" belongs to one brand.

━━━━ TEXT & CALLOUT DISCIPLINE (keep it quiet) ━━━━
- Maximum 2 text elements per image BY DEFAULT: 1 headline + 1 sub-line (or 1 headline alone).
- Exceptions: Slot 6 up to 4 benefit rows · Slot 7 up to 4 numbered labels · Slot 9 up to 3 annotations · Slot 11 up to 3 comparison rows.
- NO opaque callout boxes. Float text on a 1px hairline accent rule; if readability truly requires a panel, use 70% translucent frosted — never an opaque slab.
- NO arrow clutter. Prefer type + hairline connector. Max 1 arrow per image only if strictly needed.
- Each text element: font + weight + color HEX + position + exact copy in "double quotes".

━━━━ BRAND LANGUAGE SYSTEM (embed word-for-word in every prompt) ━━━━
${blsStr}

━━━━ AMAZON COMPLIANCE ━━━━
- Main Image White Background: Main (hero) image MUST have pure white background RGB(255,255,255). Product only, no text, no props, no watermarks. [Slot 1 only]
- Minimum Image Size: Images must be at least 1000px on longest side. Recommended: 2000x2000 for listing, 1920x1080 for A+. [All images]
- Product Fills 85% of Frame: Main image: product must fill at least 85% of the image frame area. [Slot 1]
- No Offensive/Misleading Content: Images must not contain nudity, violence, or misleading claims. All text must be accurate. [All images]
- No Badges or Promotions on Main Image: Main image cannot contain 'Best Seller', 'Amazon Choice', sale tags, or promotional badges. [Slot 1]
- Text Must Be Legible at Thumbnail Size: Any text on listing images must be readable when the image is displayed as a thumbnail (~150px). [Slots 2-12]
- No Blurry or Pixelated Images: All images must be high resolution, sharp, and professionally composed. [All images]
- A+ Content Modules: A+ images support wider aspect ratios (up to 970px wide). Rich media with brand storytelling. [Slots 8-12]

━━━━ 12 SLOTS ━━━━
${slotsText}

━━━━ PER-SLOT WORLD ASSIGNMENT (vary the backgrounds — do not copy-paste one scene across all 12) ━━━━
Slot 1 (Hero):           PURE WHITE RGB(255,255,255). Zero text, zero props. Amazon TOS — outside the world system.
Slot 2 (Angles+Labels):  WORLD A. Soft BLS-neutral canvas, 1 hairline feature rule + 1 label only.
Slot 3 (Lifestyle):      WORLD C — LOCATION #1. Product in a location-appropriate real place. This location must NOT repeat in slots 8/10/12.
Slot 4 (Close-Up):       WORLD B. Macro on tactile surface (walnut / travertine / linen / brushed aluminum); background dissolves into BLS bokeh. No text or 1 short line only.
Slot 5 (Problem Solved): WORLD A. Quiet BLS canvas. 1 headline + 1 sub-line + 1 hairline rule. No dense bullet lists.
Slot 6 (Value Prop):     WORLD A. Clean canvas; up to 4 typographic benefit rows separated by hairline rules — NO panels, NO icons inside boxes.
Slot 7 (What's In Box):  WORLD B. Overhead flat-lay on tactile surface (linen / walnut / travertine), up to 4 numbered hairline callouts.
Slot 8 (A+ Banner):      WORLD C — LOCATION #2 (must differ from Slot 3). Product right-third, tagline left-third with breathing room.
Slot 9 (A+ Deep Feature):WORLD B. Studio platform shot, up to 3 hairline annotations to product parts. Editorial, not a busy diagram.
Slot 10 (A+ Lifestyle):  WORLD C — LOCATION #3 (must differ from 3 and 8). One short evocative line, nothing else.
Slot 11 (A+ Comparison): WORLD A. Split canvas (muted half / BLS half) divided by a 1px hairline. Up to 3 comparison rows, typography-only.
Slot 12 (A+ Promise):    WORLD C — LOCATION #4 (must differ from 3, 8, 10). Quiet final scene, 1 brand statement, optional 2 trust lines.

━━━━ PROMPT STRUCTURE (3 paragraphs per slot) ━━━━

P1 — CAMERA & PRODUCT: Lens (35mm / 50mm / 85mm / 100mm macro), aperture (f/1.8–f/8), angle, DOF behavior (what plane is razor-sharp, how background dissolves), focus point, product position on rule-of-thirds. Full physical description of the product from the reference. Include verbatim: "Using the provided product reference image, preserve exact shape, surface finish, logo placement, primary colour, and key features — no idealisation or reinterpretation."

P2 — BACKGROUND WORLD & LIGHT: OPEN by naming which world this slot uses — "WORLD A — STUDIO CANVAS", "WORLD B — PRODUCT PLATFORM", or "WORLD C — LIFESTYLE ENVIRONMENT (location: [name the location])". For a lifestyle slot, pick a location that has NOT been used by a prior lifestyle slot in this pack. Describe the world in 3–5 sentences. Name the light source, direction, quality, Kelvin temperature — keep the SAME temperature across every slot in the pack. Describe how light reads on the product's material. Forbidden vocabulary: "solid color", "paper roll", "infinity cove", "HDR", "vibrant", "oversaturated", "4K", "ultra-detailed". Target 60–110 words.

P3 — TEXT & GRAPHICS (keep it quiet):
- Slot 1: NO text, NO graphics. Pure white RGB(255,255,255). Product fills 85% of frame.
- Slots 2–12: Follow the slot text budget above. For each text element: font name + weight, color HEX, alignment, position (quadrant or third), exact copy in "double quotes". Float on 1px hairline accent rules. NO opaque boxes. NO arrow clutter.

━━━━ RULES ━━━━
- Each prompt is SELF-CONTAINED: restate BLS colors (HEX), font names + weights, and background description inside the prompt — the image model has no memory between calls
- Camera specs in every prompt (lens + aperture + angle + DOF + focus point)
- Target 160–230 words per prompt
- No human faces (faceless silhouette only if scene requires human presence, fully clothed)
- No pixel dimensions, no "Amazon listing image", no "high quality" / "4K" meta-words
- Slot 1 HARD RULE: pure white RGB(255,255,255), zero text — Amazon TOS. Never violated.
- Do NOT use the same lifestyle location twice in the same pack

━━━━ OUTPUT FORMAT ━━━━
Return ONLY valid JSON:
{
  "slots": [
    {
      "slot_number": 1,
      "slot_name": "Hero — Clean Product",
      "image_type": "listing",
      "prompt": "Full 3-paragraph prompt...",
      "negative_prompt": "shadows, reflections, gradients, props, text, logos, hands, watermark"
    },
    ... (all 12 slots)
  ]
}`;
}

/** User message for all-12-slot prompt generation — mirrors Python build_studio_prompts_user(). */
export function buildStudioPromptsUser(
  productData: Record<string, unknown>,
  competitorContext = '',
  creativeHint = '',
  competitorVisualAnalysis = '',
): string {
  const title    = (productData.title as string) ?? 'Unknown Product';
  const brand    = (productData.brand as string) ?? '';
  const bullets  = (productData.bullets as string[]) ?? [];
  const category = (productData.generic_category as string) ?? '';

  const parts: string[] = [
    `PRODUCT: ${title}`,
    `BRAND: ${brand || '(from images)'}`,
    `CATEGORY: ${category}`,
  ];

  if (bullets.length) {
    parts.push('KEY FEATURES:\n' + bullets.slice(0, 10).map(b => `- ${b}`).join('\n'));
  }

  if (competitorContext.trim()) {
    parts.push(`\nCOMPETITOR INTELLIGENCE:\n${competitorContext.slice(0, 1500)}`);
  }

  if (competitorVisualAnalysis.trim()) {
    parts.push(`\nCOMPETITOR VISUAL ANALYSIS:\n${competitorVisualAnalysis.slice(0, 1200)}`);
  }

  if (creativeHint.trim()) {
    parts.push(`\nCREATIVE DIRECTION:\n${creativeHint.trim()}`);
  }

  parts.push('\nGenerate all 12 slot prompts. Return ONLY the JSON.');
  return parts.join('\n');
}

// ─── Competitor Visual Analysis ────────────────────────────────────────────────

async function downloadImageAsBase64(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const ct = resp.headers.get('content-type') ?? 'image/jpeg';
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

/**
 * Analyze competitor listing images with GPT-4o Vision.
 * Port of Python _analyze_competitor_images() — downloads images first (Amazon CDN blocks direct GPT-4o fetches).
 */
export async function analyzeCompetitorImages(
  competitors: Array<Record<string, unknown>>,
  apiKey: string,
  endpoint?: string,
): Promise<string> {
  if (!competitors.length) return '';

  const imageEntries: Array<{ url: string; source: string }> = [];
  for (const comp of competitors.slice(0, 5)) {
    const title = String(comp.title ?? 'Unknown').slice(0, 50);
    for (const thumb of ((comp.thumbnails as Array<Record<string, string>>) ?? []).slice(0, 3)) {
      const url = thumb.url ?? thumb.src ?? '';
      if (url?.startsWith('http')) imageEntries.push({ url, source: `${title} (listing)` });
    }
    for (const ap of ((comp.a_plus as Array<Record<string, string>>) ?? []).slice(0, 2)) {
      const url = ap.image_url ?? ap.url ?? '';
      if (url?.startsWith('http')) imageEntries.push({ url, source: `${title} (A+)` });
    }
  }
  if (!imageEntries.length) return '';

  const content: Array<{ type: string; image_url?: { url: string; detail: string }; text?: string }> = [];
  let downloaded = 0;
  for (const entry of imageEntries.slice(0, 20)) {
    if (downloaded >= 15) break;
    const b64 = await downloadImageAsBase64(entry.url);
    if (b64) {
      content.push({ type: 'image_url', image_url: { url: b64, detail: 'low' } });
      downloaded++;
    }
  }
  if (!downloaded) return '';

  content.push({
    type: 'text',
    text:
      `You are analyzing ${imageEntries.length} competitor product images from Amazon listings.\n\n` +
      `For each image, identify:\n` +
      `1. COMPOSITION: How is the product staged? (hero shot, lifestyle, infographic, flat-lay, etc.)\n` +
      `2. COLOR STRATEGY: Dominant colors, background treatment, text overlay colors\n` +
      `3. TEXT & GRAPHICS: Headlines, callout boxes, feature labels, icons present\n` +
      `4. VISUAL STRENGTHS: What works well that we should match or beat\n` +
      `5. VISUAL WEAKNESSES: What's missing, poorly executed, or generic\n\n` +
      `Then provide:\n` +
      `- MARKET VISUAL PATTERNS: Common approaches across competitors\n` +
      `- DIFFERENTIATION OPPORTUNITIES: Gaps we can exploit with superior visuals\n` +
      `- RECOMMENDED STRATEGY: How our images should differ to stand out\n\n` +
      `Keep response under 2000 characters. Be specific and actionable.`,
  });

  try {
    const raw = await callLLM(apiKey, [{ role: 'user', content: content as unknown as string }], {
      model: 'gpt-4o',
      maxTokens: 2000,
      temperature: 0.3,
      endpoint,
      timeoutMs: 60_000,
    });
    return raw.trim();
  } catch (e) {
    console.error('[CompetitorVision] Analysis failed:', e);
    return '';
  }
}

// ─── Competitive Pipeline: Phase 1 + Phase 2 ──────────────────────────────────

function buildDefaultBls(): BrandLanguageSystem {
  return {
    primary_color:   { name: 'Black',      hex: '#1A1A1A', role: 'primary brand color' },
    accent_color:    { name: 'White',      hex: '#FFFFFF', role: 'contrast accent' },
    neutral_color:   { name: 'Light Grey', hex: '#F5F5F5', role: 'breathing room' },
    primary_font:    { name: 'Neue Haas Grotesk', weight: 'Bold' },
    secondary_font:  { name: 'Inter',              weight: 'SemiBold' },
    detail_font:     { name: 'Inter',              weight: 'Regular' },
    text_on_dark:    '#FFFFFF',
    text_on_light:   '#1A1A1A',
    shared_background: 'Product on honed white marble counter, directional softbox light from left at 45°, blurred kitchen doorway with morning light at f/2.8, linen cloth nearby',
    callout_box_style: 'no box, text floats on 1px hairline accent rule',
    icon_style:        '1px hairline line icons',
    brand_voice:       ['Clean', 'Confident', 'Premium', 'Minimal', 'Considered'],
  };
}

/**
 * Two-phase competitive pipeline — mirrors Python studio_engine.py.
 *
 * Phase A: One LLM call (gpt-4.1-mini + vision) to build the BLS only.
 * Phase B: ONE o4-mini call with max_completion_tokens=16000 for ALL 12 slots at once.
 *
 * Returns the same GeneratePromptsResult shape as generateAllPromptsViaLLM.
 */
export async function generateAllPromptsPerSlot(
  referenceImageUrls: string[],
  productData: Record<string, unknown>,
  competitorContext: string,
  creativeHint: string,
  apiKey: string,
  endpoint?: string,
  competitorVisualAnalysis = '',
  blsModel?: string,
  rowModel?: string,
): Promise<GeneratePromptsResult | null> {
  // ── Phase A: BLS only ──────────────────────────────────────────────────────
  const visionContent: Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }> = [];
  for (const url of referenceImageUrls.slice(0, 4)) {
    if (url?.startsWith('http')) {
      visionContent.push({ type: 'image_url', image_url: { url, detail: 'high' } });
    }
  }
  visionContent.push({
    type: 'text',
    text: buildBlsOnlyUserMessage(productData, competitorContext, creativeHint, competitorVisualAnalysis),
  });

  let bls: BrandLanguageSystem | null = null;

  // Attempt 1: with product images (vision)
  try {
    const blsRaw = await callLLM(
      apiKey,
      [
        { role: 'system', content: buildBlsOnlySystemPrompt() },
        { role: 'user', content: visionContent as unknown as string },
      ],
      {
        model: blsModel ?? LLM_MODEL,
        maxTokens: 4000,
        temperature: 0.7,
        responseFormat: { type: 'json_object' },
        endpoint,
        timeoutMs: 60_000,
      },
    );
    const parsed = JSON.parse(stripJsonFences(blsRaw)) as { brand_language_system?: BrandLanguageSystem } | BrandLanguageSystem;
    bls = ('brand_language_system' in parsed ? parsed.brand_language_system : parsed) as BrandLanguageSystem ?? null;
  } catch (e) {
    console.warn('[CreativePrompts] Phase A (BLS) vision attempt failed, retrying text-only:', e);
  }

  // Attempt 2: text-only fallback (no images)
  if (!bls) {
    try {
      const textOnlyMsg = buildBlsOnlyUserMessage(productData, competitorContext, creativeHint);
      const blsRaw = await callLLM(
        apiKey,
        [
          { role: 'system', content: buildBlsOnlySystemPrompt() },
          { role: 'user', content: textOnlyMsg },
        ],
        {
          model: LLM_MODEL,
          maxTokens: 4000,
          temperature: 0.7,
          responseFormat: { type: 'json_object' },
          endpoint,
          timeoutMs: 60_000,
        },
      );
      const parsed = JSON.parse(stripJsonFences(blsRaw)) as { brand_language_system?: BrandLanguageSystem } | BrandLanguageSystem;
      bls = ('brand_language_system' in parsed ? parsed.brand_language_system : parsed) as BrandLanguageSystem ?? null;
    } catch (e) {
      console.warn('[CreativePrompts] Phase A (BLS) text-only fallback failed, using default BLS:', e);
    }
  }

  // Final fallback: hardcoded default BLS
  if (!bls) {
    console.warn('[CreativePrompts] Phase A using hardcoded default BLS');
    bls = buildDefaultBls();
  }

  console.log('[CreativePrompts] Phase A done — BLS generated');

  // ── Phase B: ONE call for all 12 slots ────────────────────────────────────
  const blsJson = bls as unknown as Record<string, unknown>;

  // Pre-download product reference images once — passed in Phase B user content
  const refImageParts: Array<{ type: 'image_url'; image_url: { url: string; detail: 'high' } }> = [];
  for (const url of referenceImageUrls.slice(0, 4)) {
    if (url?.startsWith('http')) {
      const b64 = await downloadImageAsBase64(url);
      refImageParts.push({ type: 'image_url', image_url: { url: b64 ?? url, detail: 'high' } });
    }
  }

  // ── Phase B: ONE o4-mini call for ALL 12 slots — mirrors Python studio_engine.py ──
  // Python: model=o4-mini, max_completion_tokens=16000, ONE call returns all 12 prompts
  const phaseBUserContent = [
    ...refImageParts,
    { type: 'text' as const, text: buildStudioPromptsUser(productData, competitorContext, creativeHint, competitorVisualAnalysis) },
  ];

  let slots: GeneratedSlotResult[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callLLM(
        apiKey,
        [
          { role: 'system', content: buildStudioPromptsSystem(blsJson) },
          { role: 'user',   content: phaseBUserContent as unknown as string },
        ],
        {
          model: rowModel ?? LLM_PROMPT_MODEL,
          maxTokens: 16000,
          responseFormat: { type: 'json_object' },
          endpoint,
          timeoutMs: 180_000,
        },
      );
      const parsed = JSON.parse(stripJsonFences(raw)) as { slots?: Array<GeneratedSlotResult> };
      if (Array.isArray(parsed.slots) && parsed.slots.length > 0) {
        slots = parsed.slots.map(s => ({
          slot_number:     s.slot_number,
          slot_name:       s.slot_name,
          image_type:      s.image_type,
          variation:       1,
          prompt:          sanitizePrompt((s.prompt ?? '').trim()),
          negative_prompt: s.negative_prompt ?? 'blurry, distorted, low quality, human face, nudity, watermark, flat gradient',
        }));
        break;
      }
      console.warn(`[CreativePrompts] Phase B attempt ${attempt + 1} returned empty slots — retrying`);
    } catch (e) {
      console.error(`[CreativePrompts] Phase B attempt ${attempt + 1} failed:`, e);
    }
  }

  console.log(`[CreativePrompts] Phase B done — ${slots.length}/12 slot prompts generated`);
  return { bls, slots };
}
