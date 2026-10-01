/**
 * A+ Content generator — turns product reference images (+ optional verified facts and
 * review pain points) into an ordered Amazon A+ module plan, then a render prompt per module.
 *
 * Two rules carried over from the data-pack spec, non-negotiable:
 *  1. The COMPARISON module stays a native Amazon table — never a rendered picture of a table
 *     (rendering it loses sorting, responsiveness and Seller-Central editability).
 *  2. Copy is NEVER invented. Every headline/proof point must trace to a supplied attribute,
 *     a review theme, or a brand promise. A page that degrades honestly beats a padded one.
 *
 * The plan is produced by a single Gemini vision call (images + facts → JSON); each non-comparison
 * module is then rendered by Nano Banana Pro with the product image kept identical.
 */

import { callVisionLLM, type VisionUserPart } from "./vision-llm";
import type { FalAspect } from "./fal";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AplusModuleKind =
  | "lifestyle_hero"
  | "feature"
  | "infographic"
  | "comparison"
  | "brand_story";

export interface AplusPaletteColor {
  role: string;
  name: string;
  hex: string;
  use: string;
}

export interface AplusIconStyle {
  style: string;
  treatment: string;
}

export interface AplusBrandKit {
  palette: AplusPaletteColor[];
  fonts: { primary: string; secondary: string; detail: string };
  voice: string;
  photographyWorld: string;
  iconStyle: AplusIconStyle;
  calloutStyle: string;
  layoutDoctrine: string;
  backgroundTreatment: string;
  /** Seamless mode: "none" (background runs to all edges) or a specific border applied to every module. */
  frameTreatment: string;
}

export interface AplusComparisonRow {
  attribute: string;
  ours: string;
  alternatives: string;
}

export interface AplusComparison {
  columns: string[];
  rows: AplusComparisonRow[];
}

export interface AplusModule {
  order: number;
  kind: AplusModuleKind;
  /** Module name, e.g. "Lifestyle hero banner". */
  title: string;
  headline: string;
  body: string;
  proofPoints: string[];
  imageBrief: string;
  whyThisModule: string;
  evidence: string[];
  aspect: FalAspect;
  negativePrompt?: string;
  /** Per-module human presence: product-only, a cropped hand, or a full lifestyle figure. */
  humanPresence: "none" | "hands-only" | "lifestyle";
  /** Concrete physical prop interaction (e.g. "serum dripping onto a sliced orange"), or "". */
  propInteraction: string;
  /** True when a numeric proof point should render as a big-figure stat, not a sentence. */
  statCallout: boolean;
  /** True when proof points are compliance/trust claims → render as a badge row. */
  badgeRow: boolean;
  /** Headline overlaps/interacts with the photo rather than sitting in a separate text zone. */
  editorialTypeOverlap: boolean;
  /** Surround the product with glowing spheres + leader lines naming active ingredients. */
  activeIngredientCallout: boolean;
  /** Show matched before/after photographs of the same subject. */
  beforeAfterPairing: boolean;
  /** Render quoted proof points as individual review/speech-bubble cards with star rows. */
  reviewCard: boolean;
  /** Present only when kind === "comparison" — rendered as a native table, not an image. */
  comparison?: AplusComparison;
}

/** A decorative element that crosses a module seam (foam, leaves, droplets) so the page reads continuous. */
export interface AplusConnectorMotif {
  /** Seam sits directly after this (0-based) module index. */
  afterModuleIndex: number;
  tier: "scattered" | "continuous";
  motifType: string;
  brandRationale: string;
  colorway: string;
  density: "sparse" | "medium" | "dense";
  verticalExtent: string;
}

export interface AplusPlan {
  creativeConcept: string;
  pageStrategy: string;
  competitorBenchmark: string;
  brandKit: AplusBrandKit;
  modules: AplusModule[];
  connectorMotifs: AplusConnectorMotif[];
}

export interface AplusAttribute {
  label: string;
  value: string;
}

export interface AplusProductInput {
  title?: string;
  brand?: string;
  price?: string;
  rating?: string;
  attributes?: AplusAttribute[];
  /** Customer wants / review pain points — the evidence headlines derive from. */
  painPoints?: string[];
  keywords?: string[];
  /** How many modules the argument should run to (clamped 4–8; default 6). */
  moduleCount?: number;
  /** Ask the planner to add scattered connector motifs across seams (Seamless + Elements mode). */
  connectorMotifs?: boolean;
}

// ── Plan generation ──────────────────────────────────────────────────────────────

const MODULE_KINDS: AplusModuleKind[] = [
  "lifestyle_hero",
  "feature",
  "infographic",
  "comparison",
  "brand_story",
];

const APLUS_SYSTEM_PROMPT = `You are a senior Amazon A+ Content strategist. You design the enhanced-brand-content
section that sits BELOW a product listing: an ordered sequence of visual modules that build one
argument for the shopper.

Your job: from the product photos and the verified facts/review evidence provided, output an A+ plan
as JSON. Follow these rules with no exceptions:

THE ORDER IS THE ARGUMENT. Modules are read top to bottom. Lead with the biggest emotional driver
(usually a lifestyle/aspiration hero), then convert the biggest purchase anxieties into concrete,
scannable proof, and close with brand/trust. The order is a deliberate argument, not a re-sortable list.

COPY IS NEVER INVENTED. Every headline and every proof point MUST trace to a supplied attribute, a
review theme/pain point, or a brand promise. Do not claim features that are not in the evidence. If a
competitor-style claim (e.g. a warranty, a capacity, a material) is not supported by the provided
facts, do not make it. A page that degrades honestly beats one padded with plausible claims.

ANSWER THE ANXIETIES. When review pain points are provided (e.g. quality, wheels, handle, zippers),
directly reassure those with verified hardware/spec proof — that is what A+ is for.

THE COMPARISON MODULE STAYS A TABLE. Exactly one module should have kind "comparison". Do NOT write an
image brief that renders a picture of a table. Instead fill its "comparison" object with columns and
rows built ONLY from verified facts, comparing this product against "Typical alternatives".

BRAND KIT FROM THE PHOTOS. Read the product's real palette (give hex codes you actually see in the
photos), and infer a restrained art direction. This is what stops two brands' pages looking identical.
Do not default to plain white or pale-gradient backgrounds — the strongest reference pages use the
brand's primary color as the actual page environment (full-bleed color block or gradient), not just an
accent. Choose deliberately.

LAYOUT DOCTRINE IS A NAMED DEVICE, NOT A MOOD. Pick (or closely combine) one or two of the following
structural devices and apply them consistently across the page so modules feel like one system, not
unrelated banners:
  - "circular stage"         — a soft solid-color circle sits behind the product as a recurring backdrop
  - "floating card"          — a light content card (headline/body/icons) floats over a full-bleed
                                colored or gradient background
  - "color-block sections"   — the page alternates between full-bleed background colors module to
                                module (e.g. light / dark / light) for visual rhythm
  - "off-canvas bleed props" — decorative props (leaves, splashes, ingredients) extend past the
                                canvas edge rather than sitting fully inside the frame
  - "macro hand interaction" — a cropped human hand physically holds, opens, or applies the product
                                for tactile scale and realism
Record the chosen device(s) in "layoutDoctrine" using this vocabulary so the renderer can execute it
precisely.

ICON STYLE HAS A STYLE AND A TREATMENT. Specify both: the visual style (e.g. "thin line", "filled
duotone", "hand-drawn") AND the treatment/container (e.g. "circular color-filled badge",
"photographic crop inside a circle mask", "flat icon with no container"). Reference pages rarely use
plain unstyled icons — they use one consistent container shape across the whole page.

BACKGROUND TEXTURE. Decide whether the page background should carry a subtle low-opacity texture
(fine linework, botanical silhouette, topographic pattern) for depth, or stay a flat/gradient color.
Record this in "backgroundTreatment".

HUMAN PRESENCE IS A DELIBERATE PER-MODULE CHOICE. For each module, decide whether it should show:
"none" (product/graphics only), "hands-only" (a cropped human hand interacting with the product, for
scale/tactility), or "lifestyle" (a full human figure using or benefiting from the product, for
emotional/aspirational modules). Do not default every module to product-only — the strongest pages
use lifestyle or hands-only for at least the hero and one trust-building module.

PROP INTERACTION. Where the product is a liquid, cream, powder, or has a texture worth showing,
specify in "propInteraction" a concrete physical interaction (e.g. "serum dripping onto a sliced
orange", "capsules spilling from an open jar onto ingredient piles") rather than a static side-by-side
placement. Leave empty if not applicable.

STAT CALLOUTS GET A HIERARCHY, NOT INLINE TEXT. If a proof point is a number (weight, %, mg, count),
mark "statCallout": true on that module and note it should render as a large bold figure with a small
colored label pill beneath it — not as a sentence.

BADGE ROWS FOR COMPLIANCE/TRUST CLAIMS. If a module's proof points are certification-style claims
(cruelty-free, gluten-free, made-in claims, free-from claims), mark "badgeRow": true so the renderer
lays them out as an evenly spaced row of icon badges with a short label under each, not paragraph text.

IMAGE BRIEFS. For each non-comparison module, write a concrete image brief: layout, what the product
does in the frame, and which callouts to show. The product photo will be kept IDENTICAL by the
renderer — briefs describe the scene/graphics AROUND the product only.

CONNECTOR MOTIFS (only when the user message says "CONNECTOR MOTIFS: on"). Between adjacent modules you
may place a brand-appropriate decorative motif that crosses the seam (foam, leaves, petals, water
droplets, cloud wisps) so the stitched page reads as one continuous scene. Use ONLY tier "scattered"
(loose, textural elements) — these read as continuous without pixel-exact alignment. Choose motifs that
fit the brand's story, tie each colorway to the palette, and place 2–4 across the page at natural
transitions. Populate the top-level "connectorMotifs" array; otherwise omit it entirely.

Return ONLY a JSON object with this exact shape (no markdown, no prose outside the JSON):
{
  "creativeConcept": string,          // one campaign idea derived from the brand voice + photography world
  "pageStrategy": string,             // 2-3 sentences: what this page prioritises and why
  "competitorBenchmark": string,      // 1-2 sentences on what competitors over-index on and the gap you exploit
  "brandKit": {
    "palette": [{ "role": string, "name": string, "hex": "#RRGGBB", "use": string }],
    "fonts": { "primary": string, "secondary": string, "detail": string },
    "voice": string,
    "photographyWorld": string,
    "iconStyle": { "style": string, "treatment": string },
    "calloutStyle": string,
    "layoutDoctrine": string,           // one or two devices from the named vocabulary above
    "backgroundTreatment": string,      // e.g. "full-bleed gradient, subtle topographic linework at 8% opacity"
    "frameTreatment": string            // "none" (background runs to all edges — best for a seamless page) or a specific border applied identically to every module
  },
  "modules": [
    {
      "kind": "lifestyle_hero" | "feature" | "infographic" | "comparison" | "brand_story",
      "title": string,                // e.g. "Lifestyle hero banner"
      "headline": string,             // the EXACT on-image headline (short)
      "body": string,                 // 2-3 supporting sentences
      "proofPoints": [string],        // 3 short verified labels, each traceable to evidence
      "imageBrief": string,           // omit table renders; scene/graphics around the product
      "whyThisModule": string,        // why this module, in this position
      "evidence": [string],           // the attributes/review-themes/brand-promises this traces to
      "aspect": "16:9" | "4:5" | "1:1",
      "negativePrompt": string,       // failure modes to avoid for this module
      "humanPresence": "none" | "hands-only" | "lifestyle",
      "propInteraction": string,      // concrete physical interaction, or "" if not applicable
      "statCallout": boolean,         // true if a proof point is numeric and needs stat-hierarchy rendering
      "badgeRow": boolean,            // true if proof points are compliance/trust claims for a badge row
      "editorialTypeOverlap": boolean,   // lifestyle modules: headline overlaps/interacts with the photo
      "activeIngredientCallout": boolean,// surround the product with glowing spheres + leader lines to ingredient labels
      "beforeAfterPairing": boolean,     // show matched before/after photos of the same subject
      "reviewCard": boolean,             // render quoted proof points as individual review cards with star rows
      "comparison": {                 // ONLY for kind "comparison"; omit otherwise
        "columns": ["Attribute", "This product", "Typical alternatives"],
        "rows": [{ "attribute": string, "ours": string, "alternatives": string }]
      }
    }
  ],
  "connectorMotifs": [                 // OPTIONAL — only when "CONNECTOR MOTIFS: on"; omit otherwise
    {
      "afterModuleIndex": number,      // 0-based; the seam sits directly after this module
      "tier": "scattered",
      "motifType": "leaf-scatter" | "cloud-wisps" | "foam-flecks" | "water-droplets" | "petal-scatter",
      "brandRationale": string,        // why this motif fits the brand story
      "colorway": string,              // ties to brandKit.palette, e.g. "sage green, 70% opacity"
      "density": "sparse" | "medium" | "dense",
      "verticalExtent": string         // e.g. "bottom 15% of module N, top 15% of module N+1"
    }
  ]
}`;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function buildPlanUserText(product: AplusProductInput, moduleCount: number): string {
  const lines: string[] = [];
  lines.push(`Design an A+ Content plan with EXACTLY ${moduleCount} modules, in reading order.`);
  lines.push("Exactly one module must be the comparison table.");
  lines.push("");
  lines.push("VERIFIED PRODUCT FACTS (the only claims you may make):");
  if (product.title) lines.push(`- Title: ${product.title}`);
  if (product.brand) lines.push(`- Brand: ${product.brand}`);
  if (product.price) lines.push(`- Price: ${product.price}`);
  if (product.rating) lines.push(`- Rating: ${product.rating}`);
  if (product.attributes?.length) {
    lines.push("- Attributes:");
    for (const a of product.attributes.slice(0, 40)) {
      if (a.label && a.value) lines.push(`    · ${a.label}: ${a.value}`);
    }
  }
  if (product.keywords?.length) {
    lines.push(`- High-value keywords to naturally cover: ${product.keywords.slice(0, 12).join(", ")}`);
  }
  lines.push("");
  if (product.painPoints?.length) {
    lines.push("CUSTOMER PAIN POINTS / WANTS (answer these with verified proof):");
    for (const p of product.painPoints.slice(0, 12)) lines.push(`- ${p}`);
  } else {
    lines.push("No review pain points were supplied — infer likely shopper anxieties for this category ONLY as framing, but still make claims strictly from the verified facts and what the photos show.");
  }
  lines.push("");
  if (product.connectorMotifs) {
    lines.push("CONNECTOR MOTIFS: on — this page will be stitched into one continuous seamless scroll, so add brand-appropriate SCATTERED connector motifs that cross the seams. Populate the top-level \"connectorMotifs\" array (tier \"scattered\" only), 2–4 across the page.");
    lines.push("");
  }
  lines.push("The attached images are the product's real reference photos — read the palette and form from them. Keep every claim honest.");
  return lines.join("\n");
}

/** Parse a data: URL into a Gemini inline_data part. Returns null for non-data URLs. */
function dataUrlToInlinePart(url: string): VisionUserPart | null {
  const m = url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!m || !m[2]) return null; // require base64 data URLs
  return { inline_data: { mime_type: m[1] || "image/jpeg", data: m[3] } };
}

/** Pull the first balanced JSON object out of a model response (tolerates code fences / prose). */
function parseJsonLoose(raw: string): Record<string, unknown> {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s) as Record<string, unknown>;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).map((x) => x.trim()).filter(Boolean);
}

function normalizeAspect(v: unknown): FalAspect {
  return v === "16:9" || v === "21:9" || v === "4:5" || v === "1:1" || v === "9:16" ? v : "16:9";
}

function normalizeKind(v: unknown): AplusModuleKind {
  return MODULE_KINDS.includes(v as AplusModuleKind) ? (v as AplusModuleKind) : "feature";
}

function normalizeBrandKit(v: unknown): AplusBrandKit {
  const o = (v ?? {}) as Record<string, unknown>;
  const paletteRaw = Array.isArray(o.palette) ? o.palette : [];
  const palette: AplusPaletteColor[] = paletteRaw
    .map((c) => {
      const p = (c ?? {}) as Record<string, unknown>;
      return { role: str(p.role), name: str(p.name), hex: str(p.hex), use: str(p.use) };
    })
    .filter((c) => /^#?[0-9a-fA-F]{3,8}$/.test(c.hex))
    .map((c) => ({ ...c, hex: c.hex.startsWith("#") ? c.hex : `#${c.hex}` }));
  const fonts = (o.fonts ?? {}) as Record<string, unknown>;
  // iconStyle is now { style, treatment }; tolerate a legacy plain string.
  const iconRaw = o.iconStyle;
  const iconObj = (iconRaw && typeof iconRaw === "object" ? iconRaw : {}) as Record<string, unknown>;
  const iconStyle: AplusIconStyle = typeof iconRaw === "string"
    ? { style: iconRaw, treatment: "" }
    : { style: str(iconObj.style), treatment: str(iconObj.treatment) };
  return {
    palette,
    fonts: {
      primary: str(fonts.primary, "Inter"),
      secondary: str(fonts.secondary, "Inter"),
      detail: str(fonts.detail, "Inter"),
    },
    voice: str(o.voice),
    photographyWorld: str(o.photographyWorld),
    iconStyle,
    calloutStyle: str(o.calloutStyle),
    layoutDoctrine: str(o.layoutDoctrine),
    backgroundTreatment: str(o.backgroundTreatment),
    frameTreatment: str(o.frameTreatment) || "none",
  };
}

function normalizeComparison(v: unknown): AplusComparison | undefined {
  const o = (v ?? {}) as Record<string, unknown>;
  const rowsRaw = Array.isArray(o.rows) ? o.rows : [];
  const rows: AplusComparisonRow[] = rowsRaw
    .map((r) => {
      const row = (r ?? {}) as Record<string, unknown>;
      return { attribute: str(row.attribute), ours: str(row.ours), alternatives: str(row.alternatives) };
    })
    .filter((r) => r.attribute);
  if (!rows.length) return undefined;
  const columns = strArr(o.columns);
  return {
    columns: columns.length >= 2 ? columns : ["Attribute", "This product", "Typical alternatives"],
    rows,
  };
}

function normalizePlan(json: Record<string, unknown>, moduleCount: number): AplusPlan {
  const modulesRaw = Array.isArray(json.modules) ? json.modules : [];
  const modules: AplusModule[] = modulesRaw.map((m, i) => {
    const o = (m ?? {}) as Record<string, unknown>;
    const kind = normalizeKind(o.kind);
    return {
      order: i + 1,
      kind,
      title: str(o.title, `Module ${i + 1}`),
      headline: str(o.headline),
      body: str(o.body),
      proofPoints: strArr(o.proofPoints).slice(0, 5),
      imageBrief: str(o.imageBrief),
      whyThisModule: str(o.whyThisModule),
      evidence: strArr(o.evidence),
      aspect: normalizeAspect(o.aspect),
      negativePrompt: str(o.negativePrompt) || undefined,
      humanPresence: o.humanPresence === "hands-only" || o.humanPresence === "lifestyle" ? o.humanPresence : "none",
      propInteraction: str(o.propInteraction),
      statCallout: o.statCallout === true,
      badgeRow: o.badgeRow === true,
      editorialTypeOverlap: o.editorialTypeOverlap === true,
      activeIngredientCallout: o.activeIngredientCallout === true,
      beforeAfterPairing: o.beforeAfterPairing === true,
      reviewCard: o.reviewCard === true,
      comparison: kind === "comparison" ? normalizeComparison(o.comparison) : undefined,
    };
  });

  if (!modules.length) throw new Error("A+ planner returned no modules");

  const keptModules = modules.slice(0, clamp(moduleCount, 4, 8));
  const lastSeam = keptModules.length - 2; // motif can sit after modules 0..n-2

  const motifsRaw = Array.isArray(json.connectorMotifs) ? json.connectorMotifs : [];
  const densities = ["sparse", "medium", "dense"] as const;
  const connectorMotifs: AplusConnectorMotif[] = motifsRaw
    .map((mo) => {
      const o = (mo ?? {}) as Record<string, unknown>;
      const idx = Math.round(Number(o.afterModuleIndex));
      return {
        afterModuleIndex: Number.isFinite(idx) ? idx : -1,
        // Tier 2 (continuous) needs a compositing stage that isn't enabled — treat every motif as scattered.
        tier: "scattered" as const,
        motifType: str(o.motifType),
        brandRationale: str(o.brandRationale),
        colorway: str(o.colorway),
        density: densities.includes(o.density as (typeof densities)[number]) ? (o.density as AplusConnectorMotif["density"]) : "medium",
        verticalExtent: str(o.verticalExtent) || "bottom 15% of the module above, top 15% of the module below",
      };
    })
    .filter((m) => m.motifType && m.afterModuleIndex >= 0 && m.afterModuleIndex <= lastSeam);

  return {
    creativeConcept: str(json.creativeConcept),
    pageStrategy: str(json.pageStrategy),
    competitorBenchmark: str(json.competitorBenchmark),
    brandKit: normalizeBrandKit(json.brandKit),
    modules: keptModules,
    connectorMotifs,
  };
}

/**
 * Build the A+ module plan from product photos + verified facts via one Gemini vision call.
 * `imageDataUrls` must be base64 data: URLs (callers convert CDN URLs first).
 */
export async function buildAplusPlan(
  imageDataUrls: string[],
  product: AplusProductInput,
  geminiKey: string,
): Promise<AplusPlan> {
  const moduleCount = clamp(product.moduleCount ?? 6, 4, 8);

  const parts: VisionUserPart[] = [];
  for (const u of imageDataUrls.slice(0, 6)) {
    const part = dataUrlToInlinePart(u);
    if (part) parts.push(part);
  }
  if (!parts.length) throw new Error("At least one product image (base64 data URL) is required");
  parts.push({ text: buildPlanUserText(product, moduleCount) });

  const raw = await callVisionLLM(APLUS_SYSTEM_PROMPT, parts, geminiKey, { maxTokens: 8192 });

  let json: Record<string, unknown>;
  try {
    json = parseJsonLoose(raw);
  } catch {
    throw new Error("A+ planner returned a response that could not be parsed as JSON");
  }
  return normalizePlan(json, moduleCount);
}

// ── Render prompt ────────────────────────────────────────────────────────────────

/**
 * Build the image-model prompt for one module, in the exact order the model consumes best:
 *   concept → page strategy + competitor benchmark → brand palette/fonts/DNA → per-zone brief
 *   with the EXACT headline + proof points in quotes → negative prompt.
 * Paraphrasing headlines is how image models invent words, so they are passed verbatim.
 */
export function buildAplusRenderPrompt(plan: AplusPlan, module: AplusModule): string {
  const bk = plan.brandKit;
  const palette = bk.palette.length
    ? bk.palette.map((c) => `${c.name} ${c.hex} (${c.role})`).join(", ")
    : "brand-native tones read from the product photo";

  const proof = module.proofPoints.length
    ? module.proofPoints.map((p) => `"${p}"`).join(", ")
    : "(none — omit proof callouts)";

  const iconLine = bk.iconStyle.treatment
    ? `${bk.iconStyle.style} icons, in a ${bk.iconStyle.treatment} — use the SAME icon container across the page`
    : bk.iconStyle.style || "minimal line icons";

  const humanLine =
    module.humanPresence === "lifestyle"
      ? "HUMAN PRESENCE: include a full lifestyle human figure using or benefiting from the product, natural and photorealistic."
      : module.humanPresence === "hands-only"
        ? "HUMAN PRESENCE: include a cropped human hand physically holding/opening/applying the product for tactile scale — hand only, no face."
        : "HUMAN PRESENCE: product and graphics only, no people.";

  const lines: string[] = [
    `Amazon A+ Content module image (${module.kind.replace(/_/g, " ")}). This sits in a branded content section below a product listing.`,
    "",
    `CREATIVE CONCEPT: ${plan.creativeConcept}`,
    `PAGE STRATEGY: ${plan.pageStrategy}`,
    `COMPETITOR GAP: ${plan.competitorBenchmark}`,
    "",
    `BRAND PALETTE: ${palette}. Use the brand's primary colour as the actual page environment (full-bleed colour block or gradient), not just a white background.`,
    `BACKGROUND TREATMENT: ${bk.backgroundTreatment || "flat or subtle gradient in the brand colour"}.`,
    `TYPOGRAPHY: headline in a font like ${bk.fonts.primary}; supporting text like ${bk.fonts.secondary}; fine print like ${bk.fonts.detail}.`,
    `BRAND VOICE: ${bk.voice}. PHOTOGRAPHY WORLD: ${bk.photographyWorld}.`,
    `ICON STYLE: ${iconLine}. CALLOUT STYLE: ${bk.calloutStyle}.`,
    `LAYOUT DOCTRINE (apply this structural device precisely): ${bk.layoutDoctrine || "clean editorial thirds"}.`,
    "",
    `MODULE LAYOUT BRIEF: ${module.imageBrief}`,
    humanLine,
    module.propInteraction ? `PROP INTERACTION: ${module.propInteraction}.` : "",
    module.statCallout ? "STAT HIERARCHY: render the numeric proof point as a large bold figure with a small colour label pill beneath it — not as a sentence." : "",
    module.badgeRow ? "BADGE ROW: lay the proof points out as an evenly spaced row of icon badges with a short label under each, not paragraph text." : "",
    "",
    `Render this EXACT headline text on the image, verbatim, spelled correctly: "${module.headline}".`,
    `Render these EXACT proof-point labels verbatim (do not paraphrase, translate, or invent any text): ${proof}.`,
    "Do not add any other words, claims, prices, logos, or badges that are not listed above.",
    "",
    "PRODUCT FIDELITY: the supplied product image is inviolable — reproduce the product EXACTLY as shown. Only build the scene, lighting, background and graphic callouts around it. Never redesign, recolour, or restyle the product itself.",
    "Output a clean, high-resolution, editorial A+ banner with generous negative space.",
  ].filter(Boolean);

  const negatives = [
    module.negativePrompt,
    "no lorem ipsum, no gibberish text, no misspelled words, no invented specifications, no fake logos, no watermark, no distorted product",
  ]
    .filter(Boolean)
    .join("; ");
  lines.push("", `Do NOT: ${negatives}.`);

  return lines.join("\n");
}

/**
 * Render prompt for the COMPARISON module — a designed comparison-chart graphic (the native
 * editable table is still shown alongside it in the UI). Rows are passed verbatim so the model
 * doesn't invent cells; the product column is highlighted as the winner.
 */
export function buildAplusComparisonRenderPrompt(
  plan: AplusPlan,
  module: AplusModule,
  seamlessEdges?: { top: string; bottom: string },
): string {
  const bk = plan.brandKit;
  const palette = bk.palette.length
    ? bk.palette.map((c) => `${c.name} ${c.hex} (${c.role})`).join(", ")
    : "brand-native tones read from the product photo";

  const cmp = module.comparison;
  const cols = cmp?.columns?.length ? cmp.columns : ["Attribute", "This product", "Typical alternatives"];
  const rows = (cmp?.rows ?? [])
    .map((r) => `${r.attribute} — ${cols[1]}: "${r.ours}"  |  ${cols[2]}: "${r.alternatives}"`)
    .join("\n");

  const lines: string[] = [
    "Amazon A+ Content COMPARISON module — a clean, designed comparison-chart infographic (not a photograph, not a UI screenshot).",
    ...(seamlessEdges
      ? [`SEAMLESS BACKGROUND — HARD CONSTRAINT: the background must be EXACTLY ${seamlessEdges.top} at the very top pixel row and EXACTLY ${seamlessEdges.bottom} at the very bottom pixel row, running fully to all four edges with no border or margin, so this panel stitches seamlessly to its neighbours.`]
      : []),
    "",
    `CREATIVE CONCEPT: ${plan.creativeConcept}`,
    `PAGE STRATEGY: ${plan.pageStrategy}`,
    "",
    `BRAND PALETTE: ${palette}.`,
    `TYPOGRAPHY: headline in a font like ${bk.fonts.primary}; labels like ${bk.fonts.secondary}; fine print like ${bk.fonts.detail}.`,
    `LAYOUT: ${bk.layoutDoctrine}. ICON STYLE: ${bk.iconStyle.style}${bk.iconStyle.treatment ? ` (${bk.iconStyle.treatment})` : ""}.`,
    "",
    `Render a three-column comparison table graphic with a clear header row: "${cols[0]}", "${cols[1]}" (highlight this column in the brand accent colour as the winning option), "${cols[2]}".`,
    "Use EXACTLY these rows, verbatim, spelled correctly — one row per line, do not paraphrase, reorder, or invent any cell:",
    rows,
    "",
    `Title the graphic with this EXACT headline, spelled correctly: "${module.headline}".`,
    "Small minimal line icons per row are welcome. Make the product column visually win. Keep it highly legible, editorial, with generous whitespace.",
    "Do not add any other rows, claims, prices, logos, or text that are not listed above.",
    "",
    "Do NOT: no lorem ipsum, no gibberish text, no misspelled words, no invented specifications, no fake logos, no watermark.",
  ];

  return lines.join("\n");
}

// ── Seamless A+ (v3) — edge-color continuity so modules stitch edge-to-edge ────────

export interface SeamlessZone {
  top: string;     // locked top-edge hex
  bottom: string;  // locked bottom-edge hex
  gradientType: "flat" | "linear" | "radial-soft";
  direction: string;
  textureNote: string;
}

function hex6(h: string): string {
  let s = h.replace("#", "").trim();
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  return /^[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : "";
}

function lerpHex(a: string, b: string, t: number): string {
  const A = hex6(a);
  const B = hex6(b);
  if (!A) return b.startsWith("#") ? b : `#${B}`;
  if (!B) return `#${A}`;
  const chan = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const mix = [0, 2, 4].map((i) => Math.round(chan(A, i) + (chan(B, i) - chan(A, i)) * t));
  return "#" + mix.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}

function luminance(h: string): number {
  const s = hex6(h);
  if (!s) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pick the top→bottom gradient ends for the whole page from the brand palette. */
function gradientEnds(bk: AplusBrandKit): { start: string; end: string } {
  const pal = bk.palette.filter((c) => hex6(c.hex));
  if (!pal.length) return { start: "#f4f1ec", end: "#e8e4dc" };
  const byRole = (r: string) => pal.find((c) => c.role.toLowerCase().includes(r));
  const primary = byRole("primary") ?? pal[0];
  const light = byRole("neutral") ?? byRole("light") ?? [...pal].sort((a, b) => luminance(b.hex) - luminance(a.hex))[0];
  let start = light?.hex ?? primary.hex;
  let end = primary.hex;
  if (hex6(start) === hex6(end)) {
    const deep = byRole("deep") ?? byRole("dark");
    end = deep?.hex ?? end;
    if (hex6(start) === hex6(end)) start = lerpHex(end, "#ffffff", 0.4); // last resort: a lighter tint of the same colour
  }
  return { start, end };
}

/**
 * Compute a per-module background zone so adjacent panels share an EXACT edge colour
 * (module i's bottom === module i+1's top by construction → guaranteed zero seam).
 * Uses one global top→bottom gradient across the whole page (or a flat fill if the
 * palette yields a single colour).
 */
export function computeSeamlessZones(plan: AplusPlan): SeamlessZone[] {
  const n = Math.max(1, plan.modules.length);
  const { start, end } = gradientEnds(plan.brandKit);
  const flat = hex6(start) === hex6(end);
  const textureNote = /linework|topographic|botanical|texture|pattern|silhouette/i.test(plan.brandKit.backgroundTreatment)
    ? plan.brandKit.backgroundTreatment
    : "";
  return plan.modules.map((_, i) => ({
    top: flat ? (start.startsWith("#") ? start : `#${hex6(start)}`) : lerpHex(start, end, i / n),
    bottom: flat ? (start.startsWith("#") ? start : `#${hex6(start)}`) : lerpHex(start, end, (i + 1) / n),
    gradientType: flat ? "flat" : "linear",
    direction: "top to bottom",
    textureNote,
  }));
}

/** A scattered connector motif touching one edge of a module (matched to its neighbour). */
export interface MotifEdge {
  motifType: string;
  colorway: string;
  density: string;
  verticalExtent: string;
}

export interface SeamlessRenderCtx {
  moduleIndex: number;   // 1-based
  totalModules: number;
  zone: SeamlessZone;
  /** Scattered motif exiting this module's bottom edge (continues into the next module). */
  bottomMotif?: MotifEdge;
  /** Scattered motif entering this module's top edge (continued from the previous module). */
  topMotif?: MotifEdge;
}

/**
 * Resolve the top/bottom connector motifs for a module at 0-based `index`. The motif that sits
 * after module i is that module's BOTTOM motif and module i+1's TOP motif — the SAME spec is fed
 * to both neighbours so the scatter reads continuous across the seam (per the v3.1 addendum).
 */
export function motifEdgesForModule(plan: AplusPlan, index: number): { topMotif?: MotifEdge; bottomMotif?: MotifEdge } {
  const toEdge = (m: AplusConnectorMotif): MotifEdge => ({
    motifType: m.motifType, colorway: m.colorway, density: m.density, verticalExtent: m.verticalExtent,
  });
  const bottom = plan.connectorMotifs.find((m) => m.afterModuleIndex === index);
  const top = plan.connectorMotifs.find((m) => m.afterModuleIndex === index - 1);
  return { bottomMotif: bottom ? toEdge(bottom) : undefined, topMotif: top ? toEdge(top) : undefined };
}

/**
 * Seamless render prompt (APLUS_RENDER_PROMPT_v3): one panel in an edge-to-edge stitched
 * page. The top/bottom edge colours are LOCKED to the zone so neighbours join without a seam.
 */
export function buildAplusSeamlessRenderPrompt(plan: AplusPlan, module: AplusModule, ctx: SeamlessRenderCtx): string {
  const bk = plan.brandKit;
  const { zone } = ctx;
  const palette = bk.palette.length
    ? bk.palette.map((c) => `${c.name} ${c.hex} (${c.role})`).join(", ")
    : "brand-native tones read from the product photo";
  const proof = module.proofPoints.length
    ? module.proofPoints.map((p) => `"${p}"`).join(", ")
    : "(none — omit proof callouts)";
  const frame = bk.frameTreatment && bk.frameTreatment.toLowerCase() !== "none" ? bk.frameTreatment : "none";

  const bgLine =
    zone.gradientType === "flat"
      ? `The background is a single flat, uniform fill of ${zone.top} across the entire image — no gradient, no vignette, no darkening at the edges.`
      : zone.gradientType === "radial-soft"
        ? `Use a soft radial treatment where ${zone.top} and ${zone.bottom} still hold EXACTLY at the top and bottom edges respectively — any radial lightening must stay in the interior and never alter the locked edge colours.`
        : `Blend smoothly and linearly from ${zone.top} at the top to ${zone.bottom} at the bottom, direction: ${zone.direction}. Even blend — no banding, no abrupt shift.`;

  const frameLine =
    frame === "none"
      ? "FRAME: no border or frame — the background must run fully to all four edges with zero margin, padding, or white edge of any kind."
      : `FRAME: apply exactly this border identically on all four edges, no more no less: ${frame}. It must be identical on every module of the page.`;

  const human =
    module.humanPresence === "lifestyle"
      ? [
          "SHOW A REAL PERSON: include a full human figure genuinely using, wearing, or benefiting from the product in a natural setting consistent with the photography world. Natural skin texture and lighting, no uncanny or plastic rendering, no stock-photo stiffness.",
          module.editorialTypeOverlap
            ? "EDITORIAL TYPE: set the headline large and bold enough to visually overlap/interact with the photograph (crossing behind the model's head/shoulder or breaking across the frame), while staying fully legible (soft shadow/outline/contrast if needed)."
            : "",
        ]
      : module.humanPresence === "hands-only"
        ? ["SHOW A CROPPED HAND: include a human hand (cropped at the wrist, realistic skin and nails) physically holding, opening, or applying the product to convey scale and tactility."]
        : ["Product and supporting graphics only — no human figures or hands in this frame."];

  // Scattered connector motifs — the SAME colorway/density is stated to both neighbours so the
  // scatter reads continuous across the seam without pixel-exact alignment (v3.1 addendum, Tier 1).
  const bottomMotifLine = ctx.bottomMotif
    ? `BOTTOM-EDGE MOTIF: scatter ${ctx.bottomMotif.motifType} in ${ctx.bottomMotif.colorway} across the ${ctx.bottomMotif.verticalExtent} nearest the bottom edge, ${ctx.bottomMotif.density} density, with pieces trailing off/fading as they approach the very bottom edge as if continuing beyond the frame — do not draw a hard boundary or cluster them away from the edge.`
    : "";
  const topMotifLine = ctx.topMotif
    ? `TOP-EDGE MOTIF: scatter ${ctx.topMotif.motifType} in ${ctx.topMotif.colorway} across the ${ctx.topMotif.verticalExtent} nearest the top edge, ${ctx.topMotif.density} density, entering from the top edge as if continuing from the previous panel — match the density and colour exactly to what a viewer would expect if the previous panel's bottom-edge scatter simply continued into this frame.`
    : "";

  const lines: string[] = [
    `Amazon A+ Content module image (${module.kind.replace(/_/g, " ")}). This is one panel in a sequence of ${ctx.totalModules} images that Amazon stitches edge-to-edge with ZERO gap, in order, to form one continuous scrolling page. This is module ${ctx.moduleIndex} of ${ctx.totalModules}. Matching the exact background colour at the very top and very bottom edge to its neighbours is a hard requirement — any mismatch shows as a visible seam.`,
    "",
    `BACKGROUND — HARD CONSTRAINT: the background must begin at EXACTLY ${zone.top} at the very top pixel row and end at EXACTLY ${zone.bottom} at the very bottom pixel row.`,
    bgLine,
    zone.textureNote ? `TEXTURE: ${zone.textureNote}, at low opacity, consistent scale — do not let texture change the perceived edge colour.` : "",
    frameLine,
    "SAFE PADDING: keep primary text and key graphics within ~4–6% of the frame height from the top and bottom edges (the background itself still runs fully to the edge; only text/icons respect this inner margin).",
    bottomMotifLine,
    topMotifLine,
    "",
    `CREATIVE CONCEPT: ${plan.creativeConcept}`,
    `PAGE STRATEGY: ${plan.pageStrategy}`,
    `COMPETITOR GAP: ${plan.competitorBenchmark}`,
    "",
    `BRAND PALETTE (for accents, text, icons — NOT the background, which is locked above): ${palette}.`,
    `TYPOGRAPHY: headline in a font like ${bk.fonts.primary}; supporting text like ${bk.fonts.secondary}; fine print like ${bk.fonts.detail}.`,
    `BRAND VOICE: ${bk.voice}. PHOTOGRAPHY WORLD: ${bk.photographyWorld}.`,
    `ICON STYLE: ${bk.iconStyle.style || "minimal line"} icons, rendered as ${bk.iconStyle.treatment || "a consistent container"}, used consistently for every icon.`,
    `CALLOUT STYLE: ${bk.calloutStyle}.`,
    `LAYOUT DEVICE: structure this module using "${bk.layoutDoctrine || "clean editorial thirds"}" — execute this device literally.`,
    "",
    `MODULE LAYOUT BRIEF: ${module.imageBrief}`,
    ...human,
    module.propInteraction ? `PROP INTERACTION: render this specific physical interaction: ${module.propInteraction}. The product's real texture should be visibly mid-interaction, not static.` : "",
    module.activeIngredientCallout ? "ACTIVE INGREDIENT CALLOUT: surround the product with soft glowing colour bokeh or translucent glass spheres in the brand palette (kept in the interior, not touching the locked edges); draw a thin leader line from each to a short label naming one active ingredient and its one-line benefit, verbatim from the proof points." : "",
    module.beforeAfterPairing ? "BEFORE/AFTER: show two matched photographs of the same subject side by side (same framing, lighting, angle), clearly labelled before and after. Do not fabricate a numeric result beyond the proof points." : "",
    module.reviewCard ? "REVIEW CARDS: render each quoted proof point as its own speech-bubble/sticky-note card with a 5-star rating row, layered as distinct objects, not paragraph text." : "",
    module.statCallout ? "STAT HIERARCHY: render any numeric proof point as a large bold figure with a small colour label pill directly beneath it — never inline sentence text." : "",
    module.badgeRow ? "BADGE ROW: render the proof points as an evenly spaced row of circular icon badges in the ICON STYLE above, each with a short one-to-two-word label beneath." : "",
    "",
    `Render this EXACT headline text on the image, verbatim, spelled correctly: "${module.headline}".`,
    `Render these EXACT proof-point labels verbatim (do not paraphrase, translate, or invent any text): ${proof}.`,
    "Do not add any other words, claims, prices, logos, or badges that are not listed above.",
    "",
    "PRODUCT FIDELITY: the supplied product image is inviolable — reproduce the product EXACTLY as shown. Only build the scene, lighting, background and graphic callouts around it. Never redesign, recolour, or restyle the product itself.",
    "Output a clean, high-resolution, editorial A+ panel designed to be viewed as one seamless continuous page alongside its neighbouring panels.",
  ].filter(Boolean);

  const negatives = [
    module.negativePrompt,
    "no lorem ipsum, no gibberish text, no misspelled words, no invented specifications, no fake logos, no watermark, no distorted product",
    `no background colour, tint, or vignette anywhere that deviates from the locked top (${zone.top}) and bottom (${zone.bottom}) edge colours`,
    frame === "none" ? "no border or frame of any kind" : "no border other than the one specified in FRAME",
  ]
    .filter(Boolean)
    .join("; ");
  lines.push("", `Do NOT: ${negatives}.`);

  return lines.join("\n");
}
