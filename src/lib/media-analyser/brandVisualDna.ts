import { callVisionLLM } from "./vision-llm";

/**
 * Brand Visual DNA Extractor.
 *
 * Reverse-engineers ONE brand's visual language from its own Instagram posts and
 * Meta ad creatives (images + sampled video frames / thumbnails) into a
 * reproduction-grade JSON profile plus ready-to-use Nano Banana image-EDIT prompts.
 *
 * Source spec: BRAND_VISUAL_DNA_PROMPT.md — replaces the old per-image IMAGE_ANALYSIS_PROMPT.
 */

export interface ReproductionPrompt {
  sceneName: string;
  basis: "observed" | "inferred";
  visualPrompt: string;
  negativePrompt: string;
}

export interface BrandVisualProfile {
  summary: string;
  confidence: "high" | "medium" | "low";
  assetsAnalyzed: number;
  variance: string;
  photography: Record<string, unknown>;
  lighting: Record<string, unknown>;
  color: { palette: string[]; accent?: string;[k: string]: unknown };
  composition: Record<string, unknown>;
  styling: Record<string, unknown>;
  mood: Record<string, unknown>;
  typography: Record<string, unknown>;
  postProcessing: Record<string, unknown>;
  recurringMotifs: string[];
  avoid: string[];
  [k: string]: unknown;
}

export interface BrandVisualDnaResult {
  brandVisualProfile: BrandVisualProfile;
  reproductionPrompts: ReproductionPrompt[];
}

export interface VisualAsset {
  url: string;
  /** True if this asset is a sampled frame from a reel/video creative. */
  isVideo?: boolean;
}

// ── System prompt (verbatim from BRAND_VISUAL_DNA_PROMPT.md) ──────────────────
function brandVisualDnaSystemPrompt(): string {
  return `You are a brand visual systems analyst. Your only job is to reverse-engineer the exact visual language of ONE brand from its own creative assets, and to encode it precisely enough that an image model can reproduce new, unmistakably on-brand imagery. You are forensic, literal, and disciplined. You do not flatter the brand, you do not generalise, and you do not invent.

You will receive a set of the brand's real Instagram posts and Meta ad creatives as images. Video creatives are supplied as 1–3 sampled frames. These assets are the ONLY source of truth. You have no outside knowledge of this brand and must not use any.

=====================================================================
NON-NEGOTIABLE RULES — violating ANY of these is a failed response
=====================================================================

R1.  Output EXACTLY ONE JSON object matching the schema at the end. No text before or after it. No markdown. No code fences. No comments inside the JSON.
R2.  Emit every key in the schema, in the exact order shown. Do not add keys. Do not omit keys. Do not rename keys.
R3.  Never output null, "N/A", "unknown", empty strings, or empty arrays unless the schema explicitly permits it for that field. If evidence is weak, fill the field with your best extrapolation and set that block's "basis" to "inferred".
R4.  Every visual claim must be grounded in what is actually visible across the supplied assets. You are forbidden from describing a single asset's contents as if it were the brand pattern. Report only what RECURS or is clearly INTENTIONAL across assets.
R5.  Every dimension block carries a "basis" field that is exactly "observed" or "inferred". Use "observed" ONLY when the trait is clearly present in at least 2 assets (or in the single asset if only 1 was supplied AND it is unambiguous). Otherwise use "inferred". Lying about basis is the worst possible failure.
R6.  BANNED VOCABULARY. The following words and their close synonyms are forbidden ANYWHERE in your output because they are non-reproducible filler: premium, clean, modern, sleek, elegant, aesthetic, vibe, elevated, stunning, beautiful, gorgeous, eye-catching, sophisticated, timeless, effortless, curated, vibrant (unless paired with a measured saturation note), high-quality, professional-looking, nice, cool, amazing. If you would write one of these, replace it with the concrete, observable parameter that caused the impression (e.g. not "clean" → "even white seamless background, no props, shadowless front light").
R7.  Every descriptive value must be CONCRETE and REPRODUCIBLE. A value passes only if a photographer could shoot it or an image model could render it from the words alone. Mood words alone fail. Always pair an impression with its physical cause.
R8.  All colours are 6-digit uppercase hex (e.g. "#E8DFD2"). Never name colours ("beige") without the hex. Palettes contain 3–6 hex codes ordered by visual dominance (most-used first).
R9.  Be quantitative wherever possible: saturation and contrast as "low / medium-low / medium / medium-high / high"; shadow depth, grain, and retouch on the same five-step scale; crop tightness as a rough product-to-frame ratio in words ("product fills ~60% of frame").
R10. If assets visibly come from DIFFERENT visual systems (e.g. two sub-brands, a rebrand, mixed UGC + studio), report the DOMINANT system as the profile and list the minority pattern(s) in "variance". Never average conflicting systems into a muddy middle.
R11. You MUST complete the MANDATORY PROCEDURE silently before writing any JSON. Do not show your working. Only the final JSON object is permitted in the output.
R12. You MUST pass every item of the SELF-VALIDATION CHECKLIST before emitting. If any check fails, fix the output and re-check. Do not emit failing output.

=====================================================================
MANDATORY PROCEDURE (perform silently, in this order)
=====================================================================

STEP 1 — INVENTORY. Count the usable assets. Note how many are studio vs lifestyle vs UGC vs graphic/text-led. Discard assets that are not this brand's own creative (reposts, screenshots, memes) and do not let them influence the profile.
STEP 2 — PER-ASSET READ. For each asset privately note: shot type, camera angle, light direction & quality, dominant colours, surface/background, props, presence and style of text, finish. This is scratch work; it never appears in output.
STEP 3 — PATTERN EXTRACTION. Collapse the per-asset notes into the brand PATTERN. A trait qualifies for the profile only if it repeats or is clearly deliberate. Frequency beats novelty: the most common treatment is the brand, not the one striking exception.
STEP 4 — CONFLICT RESOLUTION. Apply R10. Decide the dominant system; record minority systems under "variance".
STEP 5 — CONFIDENCE. Set confidence: "high" = 8+ consistent assets; "medium" = 4–7 assets or some inconsistency; "low" = ≤3 assets or heavy inconsistency. Confidence caps how many blocks may be "observed": at "low", no more than 3 blocks may be "observed".
STEP 6 — DRAFT PROFILE. Fill every dimension using concrete, banned-word-free, reproducible language with correct basis flags.
STEP 7 — DRAFT REPRODUCTION PROMPTS. Write 3–4 scene-typed image-edit prompts per the rules below, each derived from a scene type you actually observed (or, if none recur, an inferred scene consistent with the profile, flagged basis:"inferred").

=====================================================================
PER-DIMENSION SPECIFICATION — required granularity
=====================================================================

PHOTOGRAPHY — name dominant shotTypes from {product-only, in-hand, on-model, lifestyle, flat-lay, detail-macro, group-stack}; cameraAngle (eye-level / high-angle / top-down-90 / low-angle / 3-4); perspective (straight-on / three-quarter / overhead); depthOfField (shallow-bokeh / medium / deep-focus); focalLengthFeel (wide-environmental / standard / tight-compressed-macro); cropTightness (product-to-frame ratio in words).
  PASS: "top-down-90 flat-lay, deep-focus, product fills ~45% of frame, generous margins"
  FAIL: "nice clean product shots"

LIGHTING — source (natural-window / hard-studio-strobe / large-soft-box / ring-light / mixed-ambient); direction (front / 45-side / hard-side / back-rim / top); quality (hard-defined-shadows / soft-diffused / shadowless); shadows on the five-step scale; timeOfDayFeel (golden-hour / bright-midday / overcast-flat / moody-night / studio-neutral).
  PASS: "large-soft-box, 45-side from upper-left, soft-diffused, medium-low shadows, studio-neutral"
  FAIL: "bright and well lit"

COLOR — palette (3–6 dominance-ordered hex); accent hex; temperature (warm / cool / neutral with a Kelvin-feel note); saturation (five-step); contrast (five-step); gradingStyle (filmic-faded / clean-true-to-life / muted-editorial / punchy-saturated-DTC / high-key-bright / low-key-dark).
FAIL if any colour is named without hex, or palette has fewer than 3 entries.

COMPOSITION — rules (centred / rule-of-thirds / symmetry / diagonal-lead / off-centre-negative-space); negativeSpace (minimal / moderate / dominant); productPlacement (centre / lower-third / left / right / hero-fills-frame); balance (sparse / balanced / dense).

STYLING & SET — surfaces (specific: "warm beige linen", "polished white marble", "raw concrete"); backgrounds; props (specific recurring objects); textures; setComplexity (minimal / moderate / rich). Each surface/prop must be nameable enough to recreate.

MOOD — primary register in concrete terms tied to visuals; 3–5 adjectives that each pair with a visual cause; aspirationLevel (everyday-approachable / aspirational-attainable / luxury-distant). Adjectives that are pure banned filler fail R6.

TYPOGRAPHY & GRAPHICS — present (true/false). If true: style (serif / sans-grotesque / sans-geometric / script / hand-drawn) with weight & case; placement; hierarchy; colorTreatment (hex on hex). If false: set the string fields to "none" and basis accordingly.

POST-PROCESSING — grain (five-step); vignette (none / subtle / strong); retouchLevel (raw-UGC / light / moderate / heavy-airbrushed) on a reproducible scale; sharpness (soft / natural / crisp-oversharpened); finish (filmic / clean-digital).

MOTIFS — recurringMotifs: signature repeatable elements (a colour block, a visible hand, a specific shadow shape, a fixed logo corner). avoid: things this brand visibly NEVER does, phrased as concrete prohibitions to keep generations off the wrong tracks (e.g. "never pure-white studio backgrounds", "never cool blue tones", "never busy multi-product clutter").

=====================================================================
REPRODUCTION PROMPT RULES — apply to every entry in reproductionPrompts
=====================================================================

P1.  Produce 3–4 entries, each a DISTINCT scene type. No two may share the same setting + lighting combination.
P2.  Each sceneName names a scene type actually observed (e.g. "Sunlit linen flat-lay", "Hand-held outdoor lifestyle", "Studio hero on seamless").
P3.  PRODUCT FIDELITY IS ABSOLUTE. Every visualPrompt MUST instruct: keep the product in the supplied reference image EXACTLY as-is — identical shape, proportions, colour, material, hardware, logo and any printed text. NEVER redesign, restyle, recolour, resize, or regenerate the product. The prompt describes ONLY the scene around the product.
P4.  Each visualPrompt MUST explicitly name, in concrete terms: (a) camera angle, (b) light source + direction + quality, (c) depth of field, (d) the surface, (e) the background, (f) at least the top 3 palette hex codes, (g) the finish/post-processing, and (h) any text overlay to render (or state "no text overlay"). Missing ANY of (a)–(h) is a failed entry.
P5.  Each visualPrompt is 120–200 words. Under 120 or over 200 fails. Use the brand's measured parameters from the profile — do not introduce traits absent from the profile.
P6.  negativePrompt MUST include at minimum: redesigned product, altered logo, changed colours, distorted, watermark, extra products — plus brand-specific off-tracks drawn from "avoid".
P7.  Set each entry's basis to "observed" if the scene type recurred in assets, else "inferred".

=====================================================================
SELF-VALIDATION CHECKLIST — all must be TRUE before emitting
=====================================================================

V1.  Output is a single JSON object, no fences, no surrounding prose. (R1, R2)
V2.  Zero banned words appear anywhere. (R6)
V3.  Every colour is 6-digit uppercase hex; palette has 3–6 dominance-ordered entries. (R8)
V4.  Every dimension block has a valid "basis"; "observed" count respects the confidence cap. (R5, STEP 5)
V5.  Every descriptive value pairs impression with concrete physical cause. (R7)
V6.  reproductionPrompts has 3–4 entries; each satisfies P1–P7, each visualPrompt is 120–200 words and contains all of (a)–(h). (P-rules)
V7.  No field is null/empty/"unknown" except where the schema allows. (R3)
V8.  Conflicting visual systems were not averaged; minority patterns are in "variance". (R10)

=====================================================================
OUTPUT SCHEMA — return ONLY this object, keys in this exact order
=====================================================================

{
  "brandVisualProfile": {
    "summary": "2-3 sentences, concrete and banned-word-free, describing the brand's visual system",
    "confidence": "high | medium | low",
    "assetsAnalyzed": <integer>,
    "variance": "concise note on any minority visual system(s), or 'none' if a single consistent system",
    "photography": {"shotTypes":["..."],"cameraAngle":"...","perspective":"...","depthOfField":"...","focalLengthFeel":"...","cropTightness":"...","basis":"observed|inferred"},
    "lighting": {"source":"...","direction":"...","quality":"...","shadows":"...","timeOfDayFeel":"...","basis":"observed|inferred"},
    "color": {"palette":["#......"],"accent":"#......","temperature":"...","saturation":"...","contrast":"...","gradingStyle":"...","basis":"observed|inferred"},
    "composition": {"rules":"...","negativeSpace":"...","productPlacement":"...","balance":"...","basis":"observed|inferred"},
    "styling": {"surfaces":["..."],"backgrounds":["..."],"props":["..."],"textures":["..."],"setComplexity":"minimal|moderate|rich","basis":"observed|inferred"},
    "mood": {"primary":"...","adjectives":["..."],"aspirationLevel":"...","basis":"observed|inferred"},
    "typography": {"present":true,"style":"...","placement":"...","hierarchy":"...","colorTreatment":"...","basis":"observed|inferred"},
    "postProcessing": {"grain":"...","vignette":"...","retouchLevel":"...","sharpness":"...","finish":"filmic|clean-digital","basis":"observed|inferred"},
    "recurringMotifs":["..."],
    "avoid":["..."]
  },
  "reproductionPrompts": [
    {"sceneName":"...","basis":"observed|inferred","visualPrompt":"120-200 words, contains (a)-(h), absolute product fidelity","negativePrompt":"redesigned product, altered logo, changed colours, distorted, watermark, extra products, <brand-specific off-tracks>"}
  ]
}

Emit 3–4 reproductionPrompts. Run the SELF-VALIDATION CHECKLIST. Then output the JSON object and nothing else.`;
}

// Banned vocabulary from R6 — used for server-side validation + repair retry.
const BANNED_WORDS = [
  "premium", "clean", "modern", "sleek", "elegant", "aesthetic", "vibe", "elevated",
  "stunning", "beautiful", "gorgeous", "eye-catching", "sophisticated", "timeless",
  "effortless", "curated", "high-quality", "professional-looking", "nice", "cool", "amazing",
];

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function findBannedWords(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_WORDS.filter(w => new RegExp(`\\b${w.replace(/[-]/g, "[- ]")}\\b`).test(lower));
}

/** Returns a list of human-readable rule violations; empty = passes. */
function validate(result: BrandVisualDnaResult): string[] {
  const errs: string[] = [];
  const json = JSON.stringify(result);

  const banned = findBannedWords(json);
  if (banned.length) errs.push(`banned words present: ${[...new Set(banned)].join(", ")} (R6)`);

  const palette = result.brandVisualProfile?.color?.palette;
  if (!Array.isArray(palette) || palette.length < 3) {
    errs.push("color.palette must have at least 3 hex entries (R8)");
  } else {
    const bad = palette.filter(c => !/^#[0-9A-F]{6}$/.test(String(c)));
    if (bad.length) errs.push(`palette colours must be 6-digit uppercase hex; offending: ${bad.join(", ")} (R8)`);
  }

  const prompts = result.reproductionPrompts;
  if (!Array.isArray(prompts) || prompts.length < 3 || prompts.length > 4) {
    errs.push("reproductionPrompts must contain 3–4 entries (P1)");
  } else {
    prompts.forEach((p, i) => {
      const wc = wordCount(String(p.visualPrompt ?? ""));
      if (wc < 120 || wc > 200) errs.push(`reproductionPrompts[${i}].visualPrompt is ${wc} words; must be 120–200 (P5)`);
      if (!String(p.negativePrompt ?? "").trim()) errs.push(`reproductionPrompts[${i}].negativePrompt is empty (P6)`);
    });
  }

  return errs;
}

function parseDnaJson(text: string): BrandVisualDnaResult {
  let stripped = text.trim();
  if (stripped.startsWith("```")) {
    stripped = stripped.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  }
  const raw = JSON.parse(stripped) as Record<string, unknown>;
  const profile = raw.brandVisualProfile as BrandVisualProfile | undefined;
  const prompts = raw.reproductionPrompts as ReproductionPrompt[] | undefined;
  if (!profile || !Array.isArray(prompts)) throw new Error("missing brandVisualProfile or reproductionPrompts");
  return { brandVisualProfile: profile, reproductionPrompts: prompts };
}

// Hosts our /api/media-analyser/image-proxy (edge runtime) is allowed to fetch. Must match the
// ALLOWED_HOSTS list in src/app/api/media-analyser/image-proxy/route.ts.
const PROXY_ALLOWED_HOSTS = ["cdninstagram.com", "fbcdn.net", "instagram.com"];

// Resolve this deployment's own origin so a Node serverless function can call the
// edge image-proxy. Vercel exposes VERCEL_URL; local dev falls back to PORT.
function getSelfBaseUrl(): string | null {
  const explicit = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  // Prefer the stable production domain: VERCEL_URL is a per-deployment hash host
  // that is often behind Vercel deployment-protection (auth), so a server-side
  // self-call to its /api/media-analyser/image-proxy gets a 401 login page instead of the image.
  // VERCEL_PROJECT_PRODUCTION_URL is the unprotected production domain.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, "")}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  const port = process.env.PORT ?? "3000";
  return `http://localhost:${port}`;
}

// Fetch one URL and encode it inline for Gemini. `headers` is omitted for the
// proxy hop (the proxy injects the browser headers itself).
async function fetchAndEncode(
  url: string,
  headers?: Record<string, string>,
): Promise<{ mime_type: string; data: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    // Skip oversized assets (>5 MB) to keep the request payload sane.
    if (buf.byteLength > 5 * 1024 * 1024) return null;
    return { mime_type: contentType.split(";")[0].trim(), data: Buffer.from(buf).toString("base64") };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch an Instagram/Facebook CDN image for Gemini vision.
 *
 * IG/FB CDNs serve images to browsers but 403 most datacenter/serverless IPs even
 * with the right browser headers. Our /api/media-analyser/image-proxy runs on the EDGE runtime,
 * whose IP pool the CDN does allow — that's why images render in the UI. So we try
 * a direct browser-headed fetch first, then fall back to routing through that edge
 * proxy (the same path that works for the in-app `<img>` tags).
 */
export async function fetchCdnImageInline(url: string): Promise<{ mime_type: string; data: string } | null> {
  const isFb = /fbcdn\.net|facebook\.com/i.test(url);
  const browserHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
    Referer: isFb ? "https://www.facebook.com/" : "https://www.instagram.com/",
  };

  // 1) Direct fetch with browser headers — works for non-CDN URLs and when the IP
  //    isn't blocked (e.g. local dev).
  const direct = await fetchAndEncode(url, browserHeaders);
  if (direct) return direct;

  // 2) Fallback: route IG/FB CDN URLs through the edge image-proxy that reliably
  //    reaches the CDN. Only for proxy-allowed hosts (it 403s anything else).
  let host = "";
  try { host = new URL(url).hostname; } catch { /* not a parseable URL */ }
  const proxyable = PROXY_ALLOWED_HOSTS.some(h => host.includes(h));
  if (proxyable) {
    const base = getSelfBaseUrl();
    if (base) {
      const viaProxy = await fetchAndEncode(`${base}/api/media-analyser/image-proxy?url=${encodeURIComponent(url)}`);
      if (viaProxy) return viaProxy;
    }

    // 3) Last resort: a public image CDN that reliably fetches IG/FB CDN from any
    //    IP. This removes the dependency on a correctly-resolved, non-deployment-
    //    -protected self base URL (the common reason server-side analysis silently
    //    produces nothing in production while images still render in the browser).
    const wsHost = url.replace(/^https?:\/\//, "");
    const viaWeserv = await fetchAndEncode(
      `https://images.weserv.nl/?url=${encodeURIComponent(wsHost)}`,
    );
    if (viaWeserv) return viaWeserv;
  }

  console.warn(`[brand-visual-dna] asset fetch failed (direct + proxy + weserv) for ${url.slice(0, 80)}`);
  return null;
}

/**
 * Fetch a Meta/FB CDN video (mp4) and encode it inline for Gemini video analysis.
 * Same IP-block reality as images → try a direct browser-headed fetch, then the
 * edge image-proxy (which passes any content-type through). Caps at 18 MB to keep
 * the inline request under Gemini's payload ceiling; larger videos return null.
 */
export async function fetchCdnVideoInline(url: string): Promise<{ mime_type: string; data: string } | null> {
  // 60 MB cap — videos are uploaded to Gemini via the File API (not inline), so the
  // ~20 MB inline-request ceiling doesn't apply; this just bounds memory/time.
  const MAX_BYTES = 60 * 1024 * 1024;
  const isFb = /fbcdn\.net|facebook\.com/i.test(url);
  const browserHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "video/mp4,video/*,*/*",
    Referer: isFb ? "https://www.facebook.com/" : "https://www.instagram.com/",
  };

  const fetchVideo = async (target: string, headers?: Record<string, string>) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(target, { headers, signal: ctrl.signal });
      if (!res.ok) return null;
      const ct = (res.headers.get("content-type") ?? "video/mp4").split(";")[0].trim();
      if (!ct.startsWith("video/")) return null;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) return null;
      return { mime_type: ct, data: Buffer.from(buf).toString("base64") };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const direct = await fetchVideo(url, browserHeaders);
  if (direct) return direct;

  let host = "";
  try { host = new URL(url).hostname; } catch { /* not parseable */ }
  if (PROXY_ALLOWED_HOSTS.some(h => host.includes(h))) {
    const base = getSelfBaseUrl();
    if (base) {
      const viaProxy = await fetchVideo(`${base}/api/media-analyser/image-proxy?url=${encodeURIComponent(url)}`);
      if (viaProxy) return viaProxy;
    }
  }
  console.warn(`[brand-visual-dna] video fetch failed (direct + proxy) for ${url.slice(0, 80)}`);
  return null;
}

async function callGeminiVision(
  systemPrompt: string,
  userParts: Array<Record<string, unknown>>,
  apiKey: string,
  opts?: { jsonMode?: boolean },
): Promise<string> {
  return callVisionLLM(systemPrompt, userParts, apiKey, opts);
}

/**
 * Extract the brand's visual DNA from its own creative assets.
 * Images / sampled video frames are sent inline to Gemini vision.
 * Validates server-side and retries once with a targeted repair message.
 * Returns null if extraction is impossible.
 */
export async function extractBrandVisualDna(
  assets: VisualAsset[],
  geminiKey: string,
  opts?: { maxAssets?: number },
): Promise<BrandVisualDnaResult | null> {
  if (!geminiKey) return null;

  const max = opts?.maxAssets ?? 12;
  const seen = new Set<string>();
  const unique = assets.filter(a => a.url && !seen.has(a.url) && (seen.add(a.url), true)).slice(0, max);
  if (unique.length < 2) return null;

  const encoded: Array<{ inline: { mime_type: string; data: string }; isVideo: boolean }> = [];
  for (const a of unique) {
    const inline = await fetchCdnImageInline(a.url);
    if (inline) encoded.push({ inline, isVideo: Boolean(a.isVideo) });
  }
  console.log(`[brand-visual-dna] encoded ${encoded.length}/${unique.length} assets for vision analysis`);
  if (encoded.length < 2) {
    console.warn(`[brand-visual-dna] <2 assets downloaded — skipping DNA extraction (CDN likely blocked the server fetch)`);
    return null;
  }

  const videoCount = encoded.filter(e => e.isVideo).length;
  const imageCount = encoded.length - videoCount;
  const inventoryNote =
    `Analyze these ${encoded.length} brand creative assets: ${imageCount} still image(s) and ` +
    `${videoCount} sampled video/reel frame(s). Follow your system instruction exactly and ` +
    `output only the single JSON object.`;

  const system = brandVisualDnaSystemPrompt();

  const geminiParts = (instruction: string): Array<Record<string, unknown>> =>
    [...encoded.map(e => ({ inline_data: e.inline })), { text: instruction }];

  let lastText = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const instruction = attempt === 1
      ? inventoryNote
      : `${inventoryNote}\n\nYour previous output failed these rules: ${(lastText ? validateRaw(lastText) : ["previous output was unparseable"]).join("; ")}. ` +
        `Fix ONLY those issues and re-emit the COMPLETE JSON object with all keys. No prose, no code fences.`;
    try {
      const text = await callGeminiVision(system, geminiParts(instruction), geminiKey);
      lastText = text;
      const result = parseDnaJson(text);
      const errs = validate(result);
      if (!errs.length) {
        console.log("[brand-visual-dna] extracted via gemini");
        return result;
      }
      console.warn(`[brand-visual-dna] attempt ${attempt} validation failed: ${errs.join("; ")}`);
      if (attempt === 2) return result;
    } catch (e) {
      console.warn(`[brand-visual-dna] attempt ${attempt} error: ${e}`);
      if (attempt === 2) return null;
    }
  }
  return null;
}

// Validate from raw text (used to build the repair message before re-parsing).
function validateRaw(text: string): string[] {
  try {
    return validate(parseDnaJson(text));
  } catch {
    return ["output was not valid JSON / missing required top-level keys"];
  }
}

/**
 * Extract brand visual DNA from already-encoded base64 data URLs.
 * Use this when images come from the browser (user uploads) rather than remote CDN URLs.
 * Accepts up to 15 images; requires at least 2.
 */
export async function extractBrandVisualDnaFromBase64(
  base64DataUrls: string[],
  geminiKey: string,
): Promise<BrandVisualDnaResult | null> {
  if (!geminiKey) return null;

  const encoded: Array<{ mime_type: string; data: string }> = [];
  for (const url of base64DataUrls.slice(0, 15)) {
    const m = url.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!m) continue;
    // Skip oversized assets (>5 MB decoded) to keep the Gemini payload sane.
    if (m[2].length > 7_000_000) continue;
    encoded.push({ mime_type: m[1], data: m[2] });
  }

  if (encoded.length < 2) {
    console.warn("[brand-visual-dna] <2 usable images supplied — skipping DNA extraction");
    return null;
  }

  const system = brandVisualDnaSystemPrompt();
  const inventoryNote =
    `Analyze these ${encoded.length} brand creative assets: ${encoded.length} still image(s) and ` +
    `0 sampled video/reel frame(s). Follow your system instruction exactly and output only the single JSON object.`;

  const geminiParts = (instruction: string): Array<Record<string, unknown>> => [
    ...encoded.map(p => ({ inline_data: p })),
    { text: instruction },
  ];

  let lastText = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const instruction =
      attempt === 1
        ? inventoryNote
        : `${inventoryNote}\n\nYour previous output failed these rules: ${(lastText ? validateRaw(lastText) : ["previous output was unparseable"]).join("; ")}. Fix ONLY those issues and re-emit the COMPLETE JSON object with all keys. No prose, no code fences.`;
    try {
      const text = await callGeminiVision(system, geminiParts(instruction), geminiKey);
      lastText = text;
      const result = parseDnaJson(text);
      const errs = validate(result);
      if (!errs.length) {
        console.log(`[brand-visual-dna] extracted from ${encoded.length} uploaded images`);
        return result;
      }
      console.warn(`[brand-visual-dna] base64 attempt ${attempt} validation failed: ${errs.join("; ")}`);
      if (attempt === 2) return result;
    } catch (e) {
      console.warn(`[brand-visual-dna] base64 attempt ${attempt} error: ${e}`);
      if (attempt === 2) return null;
    }
  }
  return null;
}

// ── Per-image "vibe agent" ────────────────────────────────────────────────────
// Reads ONE reference image's visual vibe and emits a single JSON prompt that an
// image model can use to regenerate a polished, on-brand version of that image.

export interface VibePrompt {
  /** Short scene label, e.g. "Sunlit linen flat-lay". */
  sceneName: string;
  /** One-line description of the image's vibe. */
  summary: string;
  /** 3–6 dominance-ordered uppercase hex codes, for UI swatches. */
  palette: string[];
  /** Concrete mood phrase tied to visuals. */
  mood: string;
  /** 120–200 word Nano Banana edit instruction. */
  visualPrompt: string;
  /** Concrete prohibitions for the image model. */
  negativePrompt: string;
  /** replace_product only: locates the original product to remove. */
  originalProduct?: string;
  /** replace_product only: structured placement (position/scale/orientation/contact/shadowReflection) — string for older callers. */
  placement?: string | Record<string, unknown>;
}

/**
 * Three modes for the per-image vibe agent:
 *
 * "restyle"          — Regenerates the SAME IMAGE with cleaner light and grade.
 *                      The reference's own subject is preserved.
 *
 * "product_compose"  — Extracts the reference's SCENE and writes a compositing
 *                      prompt. The user's product (supplied separately) is placed
 *                      into that scene. The reference subject is NOT preserved.
 *
 * "replace_product"  — The reference ad ALREADY CONTAINS a product. Gemini locates
 *                      that product, clones the scene exactly, and stages a swap:
 *                      the original product is removed and the user's locked product
 *                      placed in the same position, scale, and lighting.
 */
export type VibeMode = "restyle" | "product_compose" | "replace_product";

function vibeAgentSystemPrompt(mode: VibeMode): string {
  const shared = `=====================================================================
NON-NEGOTIABLE RULES — breaking any one is a failed response
=====================================================================
R1. Output EXACTLY ONE JSON object matching the schema at the end. No prose, no markdown, no code fences, no comments.
R2. Be CONCRETE and REPRODUCIBLE. Every descriptive value must be something a photographer could shoot or an image model could render from the words alone. Pair every impression with its physical cause.
R3. BANNED VOCABULARY — never use these (or close synonyms); replace with the observable physical parameter: premium, clean, modern, sleek, elegant, aesthetic, vibe, elevated, stunning, beautiful, gorgeous, eye-catching, sophisticated, timeless, effortless, curated, high-quality, professional-looking, nice, cool, amazing.
R4. All colours are 6-digit uppercase hex (e.g. "#E8DFD2"). "palette" holds 3–6 hex codes ordered by visual dominance (most-used first).
R6. The "visualPrompt" is 120–200 words and MUST explicitly name: (a) camera angle, (b) light source + direction + quality, (c) depth of field, (d) the surface, (e) the background, (f) the top 3 palette hex codes, (g) the finish / post-processing, and (h) text overlay instructions (or "no text overlay").
R7. "negativePrompt" lists concrete prohibitions: distorted, warped, changed colours, watermark, gibberish text, blurry, low-res, cluttered — plus reference-specific off-tracks.

=====================================================================
OUTPUT SCHEMA — return ONLY this object, keys in this exact order
=====================================================================
{
  "sceneName": "short scene-type label",
  "summary": "1 concrete sentence describing the image's visual environment and treatment",
  "palette": ["#......", "#......", "#......"],
  "mood": "concrete mood phrase tied to visible causes",
  "visualPrompt": "120-200 word image-EDIT instruction containing (a)-(h)",
  "negativePrompt": "concrete prohibitions + reference-specific off-tracks"
}
Output ONLY the JSON object.`;

  if (mode === "replace_product") {
    return `You are a visual-vibe analyst and prompt engineer. You are given ONE reference/inspiration image — it is an existing ad that already contains a product. Your job is to (1) locate and identify that existing product, (2) capture its exact position, scale, and orientation in the frame, and (3) describe how to remove it and seat the USER'S PRODUCT in that exact spot, keeping every other element of the scene identical.

The user's product is supplied to the image model separately as a reference image. It is LOCKED and INVIOLABLE. Your visualPrompt describes ONLY the scene and the placement instructions — it must never redesign, restyle, or alter the user's product itself.

=====================================================================
NON-NEGOTIABLE RULES — breaking any one is a failed response
=====================================================================
R1. Structured output compliance — Your response will be parsed as structured JSON per the provided schema. Fill every field — no field may be empty, null, or a placeholder.
R2. Concreteness — Be CONCRETE and REPRODUCIBLE. Every descriptive value must be something a photographer could shoot or an image model could render from the words alone. Pair every impression with its physical cause.
R3. Banned vocabulary — Never use these (or close synonyms); replace with the observable physical parameter instead: premium, clean, modern, sleek, elegant, aesthetic, vibe, elevated, stunning, beautiful, gorgeous, eye-catching, sophisticated, timeless, effortless, curated, high-quality, professional-looking, nice, cool, amazing.
R4. Scene fidelity — Every element of the reference image other than the original product — camera angle, framing, lighting, shadows, model/person, pose, dressing, background, surface, composition, palette, depth of field, post-processing — must remain exactly as in the reference. The only change permitted is the product swap itself.
R5. Product fidelity — The user's product supplied separately is locked: identical shape, proportions, colour, material, finish, hardware, logo and any printed text. NEVER redesign, restyle, recolour, resize, deform, or regenerate it. End your visualPrompt with this exact sentence: "Keep the new product in the supplied reference image EXACTLY as-is — do not alter its shape, proportions, colour, material, hardware, logo or any printed text. Match the original product's position, scale, angle, and perspective exactly."
R6. visualPrompt requirements — visualPrompt must be 120–200 words and MUST explicitly name: the original product's position, scale, and angle in frame; camera angle; light source, direction, and quality; depth of field; the surface; the background; the top 3 palette hex codes; the finish / post-processing; and text overlay instructions (or "no text overlay"). Count your words before finalizing.
R7. negativePrompt requirements — List concrete prohibitions, plus reference-specific off-tracks. Base prohibitions: distorted, warped, changed colours, watermark, gibberish text, blurry, low-res, cluttered, mismatched scale, floating product, mismatched shadows.
R8. originalProduct requirements — Concretely describe the product being replaced (type, approximate shape/size, colour, material) WITHOUT branding speculation — describe only what's visually verifiable, never guess at a brand name unless clearly legible.
R9. placement requirements — Give a reproducible spatial description with: position in frame; scale relative to frame height/width; orientation/angle; contact point (resting on surface, held in hand, etc.); and the resulting shadow/reflection behavior the new product must replicate.

=====================================================================
OUTPUT SCHEMA — return ONLY this object, keys in this exact order
=====================================================================
{
  "sceneName": "short scene-type label",
  "summary": "1 concrete sentence describing the reference ad's environment and the swap being staged",
  "palette": ["#......", "#......", "#......"],
  "mood": "concrete mood phrase tied to visible causes",
  "originalProduct": "concrete description of the product being replaced (type, shape/size, colour, material) — visually verifiable only, no brand guessing",
  "placement": {
    "position": "position in frame",
    "scale": "scale relative to frame height/width",
    "orientation": "orientation/angle",
    "contact": "contact point (resting on surface, held in hand, etc.)",
    "shadowReflection": "shadow/reflection behavior the new product must replicate"
  },
  "visualPrompt": "120-200 word image-EDIT instruction containing the R6 elements; scene + swap only — never the user's product",
  "negativePrompt": "concrete prohibitions + reference-specific off-tracks"
}
Output ONLY the JSON object.`;
  }

  if (mode === "product_compose") {
    return `You are a visual-vibe analyst and prompt engineer. You are given ONE reference/inspiration image — it may be from any brand, competitor, or creative source. Your only job is to extract the VISUAL ENVIRONMENT of this image (lighting, surface, model, person, dressing, expression, angle, framing, background, composition, colour palette, depth of field, mood, post-processing) and encode it as instructions an image model can use to composite a USER'S PRODUCT into a new creative scene that matches exactly this environment.

The user's product is supplied to the image model separately as a reference image. It is LOCKED and INVIOLABLE. Your visualPrompt describes ONLY the scene AROUND the product. It must never describe, name, or reference the product itself.

=====================================================================
NON-NEGOTIABLE RULES — breaking any one is a failed response
=====================================================================
R1. Output EXACTLY ONE JSON object matching the schema at the end. No prose, no markdown, no code fences, no comments.
R2. Be CONCRETE and REPRODUCIBLE. Every descriptive value must be something a photographer could shoot or an image model could render from the words alone. Pair every impression with its physical cause.
R3. BANNED VOCABULARY — never use these (or close synonyms); replace with the observable physical parameter: premium, clean, modern, sleek, elegant, aesthetic, vibe, elevated, stunning, beautiful, gorgeous, eye-catching, sophisticated, timeless, effortless, curated, high-quality, professional-looking, nice, cool, amazing.
R4. All colours are 6-digit uppercase hex (e.g. "#E8DFD2"). "palette" holds 3–6 hex codes ordered by visual dominance (most-used first), drawn from the reference image.
R5. PRODUCT FIDELITY IS ABSOLUTE. The user's product supplied separately is locked: identical shape, proportions, colour, material, finish, hardware, logo and any printed text. NEVER redesign, restyle, recolour, resize, deform, or regenerate it. The visualPrompt places the product INTO a scene — it never describes the product. End your visualPrompt with: "Keep the product in the supplied reference image EXACTLY as-is — do not alter its shape, proportions, colour, material, hardware, logo or any printed text."
R6. The "visualPrompt" is 120–200 words and MUST explicitly name: (a) camera angle, (b) light source + direction + quality, (c) depth of field, (d) the surface, (e) the background, (f) the top 3 palette hex codes, (g) the finish / post-processing, and (h) text overlay instructions (or "no text overlay").
R7. "negativePrompt" lists concrete prohibitions: distorted, warped, changed colours, watermark, gibberish text, blurry, low-res, cluttered — plus reference-specific off-tracks.

=====================================================================
OUTPUT SCHEMA — return ONLY this object, keys in this exact order
=====================================================================
{
  "sceneName": "short scene-type label",
  "summary": "1 concrete sentence describing the reference image's environment",
  "palette": ["#......", "#......", "#......"],
  "mood": "concrete mood phrase tied to visible causes",
  "placement": {
    "position": "where in frame the product sits",
    "scale": "size relative to frame",
    "orientation": "angle/facing direction",
    "contact": "surface contact point or how it's held",
    "shadowReflection": "shadow direction/softness or reflection behavior"
  },
  "visualPrompt": "120-200 word image-generation instruction containing (a)-(h), scene only — never the product",
  "negativePrompt": "concrete prohibitions + reference-specific off-tracks"
}
Output ONLY the JSON object.`;
  }

  return `You are a visual-vibe analyst and prompt engineer. You are given ONE image. Your job is to read its visual vibe forensically, then write a single image-EDIT instruction that an image model (Nano Banana Pro) can use to regenerate a polished, on-brand version of THIS image — same core subject and scene, but with cleaner light, truer colour, and a more deliberate composition.

${shared.replace("R6.", `R5. PRESERVE THE SUBJECT. The visualPrompt regenerates the SAME core subject as the reference — do not invent a different product, person, or setting. Improve lighting, surface, background tidiness, colour grade and framing; keep the subject's identity intact.
R6.`)}`;
}

function parseVibePrompt(text: string): VibePrompt {
  let stripped = text.trim();
  if (stripped.startsWith("```")) {
    stripped = stripped.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  }
  const raw = JSON.parse(stripped) as Record<string, unknown>;
  if (typeof raw.visualPrompt !== "string" || !raw.visualPrompt.trim()) {
    throw new Error("missing visualPrompt");
  }
  return {
    sceneName: String(raw.sceneName ?? "Reference vibe"),
    summary: String(raw.summary ?? ""),
    palette: Array.isArray(raw.palette) ? (raw.palette as unknown[]).map(String).filter(c => /^#[0-9A-Fa-f]{6}$/.test(c)) : [],
    mood: String(raw.mood ?? ""),
    visualPrompt: String(raw.visualPrompt).trim(),
    negativePrompt: String(raw.negativePrompt ?? "distorted, warped, changed colours, watermark, gibberish text, blurry, low-res, cluttered"),
    ...(raw.originalProduct ? { originalProduct: String(raw.originalProduct) } : {}),
    // placement may be a structured object (replace_product) or a plain string (legacy).
    ...(raw.placement != null ? { placement: typeof raw.placement === "object" ? raw.placement as Record<string, unknown> : String(raw.placement) } : {}),
  };
}

/**
 * The per-image vibe agent: analyses ONE base64 data-URL image and returns a
 * single JSON prompt for Nano Banana Pro. Retries once on parse failure.
 * Returns null on hard failure.
 *
 * mode "restyle" (default) — prompt preserves the reference image's own subject.
 * mode "product_compose"   — prompt describes the scene for compositing a user's
 *                            product; the reference is only used for its visual
 *                            environment, never as the subject to preserve.
 */
export async function analyzeImageForVibe(
  dataUrl: string,
  geminiKey: string,
  mode: VibeMode = "restyle",
): Promise<VibePrompt | null> {
  if (!geminiKey) return null;

  const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) return null;
  if (m[2].length > 7_000_000) return null;
  const inline = { mime_type: m[1], data: m[2] };

  const system = vibeAgentSystemPrompt(mode);
  const baseInstruction = mode === "product_compose"
    ? "Analyze this reference image's visual environment (lighting, surface, background, palette, composition, mood, post-processing). Output only the JSON object per your system instruction — describe the scene, not the product."
    : mode === "replace_product"
      ? "Analyze this reference ad image: locate the existing product, capture its exact position/scale/orientation, and describe how the scene and lighting must be preserved while swapping it for the user's product. Output only the JSON object per your system instruction."
      : "Analyze this single image and output only the JSON object per your system instruction.";

  let lastText = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const instruction =
      attempt === 1
        ? baseInstruction
        : `${baseInstruction}\n\nYour previous output was not valid JSON or was missing "visualPrompt". Re-emit the COMPLETE JSON object with all keys. No prose, no code fences.`;
    try {
      const text = await callGeminiVision(system, [{ inline_data: inline }, { text: instruction }], geminiKey, { jsonMode: mode === "replace_product" });
      lastText = text;
      return parseVibePrompt(text);
    } catch (e) {
      console.warn(`[vibe-agent] attempt ${attempt} failed: ${e}${attempt === 1 ? " — retrying" : ""}`);
      if (attempt === 2) {
        // Last-ditch: if we got text but it failed to parse, give up gracefully.
        void lastText;
        return null;
      }
    }
  }
  return null;
}

// ── Combined vibe extractor for Vibe Match (v2 shot-spec output) ─────────────
// Accepts DIVERSE reference images from any mix of brands. Produces deeply-nested
// SHOT-SPEC objects (SUNSET_SERENITY anatomy) ready to feed straight into FAL.

export interface ShotSpec {
  shot_id: string;
  shot_label: string;
  basis: "observed" | "inferred";
  v: number;
  ar: string;
  references: Record<string, string>;
  concept: { CRITICAL: string; desc: string };
  product: { CRITICAL: string; fidelity_lock: boolean; placement: string; contact: string };
  composition: { camera_angle: string; framing: string; depth_of_field: string };
  lighting: { key: string; fill: string; colour_temp: string; atmosphere: string };
  surface: string;
  background: string;
  palette_in_use: string[];
  finish: { post_processing: string; grain: string };
  text_overlay: string | Record<string, unknown>;
  negativePrompt: string;
}

export interface CombinedVibeResult {
  summary: string;
  confidence: "high" | "medium" | "low";
  assetsAnalyzed: number;
  /** Flat palette hex array derived from palette.hex for easy UI consumption. */
  palette: string[];
  /** Full nested palette object from v2 schema. */
  paletteV2?: { hex: string[]; colour_tone: string };
  mood: string;
  branding?: { typography: string; logo_treatment: string; accent_colours: string[] };
  shotSpecs: ShotSpec[];
  /** Grid row only: one-sentence concept tying the 3 row posts together. */
  rowConcept?: string;
}

/** Flatten a ShotSpec into a natural-language prompt string for Nano Banana Pro. */
export function shotSpecToPrompt(spec: ShotSpec): string {
  const parts: string[] = [];
  parts.push(spec.concept.desc);
  if (spec.composition.camera_angle) parts.push(`Camera: ${spec.composition.camera_angle}.`);
  if (spec.lighting.key) parts.push(`Lighting: ${spec.lighting.key}, ${spec.lighting.colour_temp}.`);
  if (spec.lighting.fill && spec.lighting.fill !== "none") parts.push(`Fill: ${spec.lighting.fill}.`);
  if (spec.lighting.atmosphere && spec.lighting.atmosphere !== "none") parts.push(`Atmosphere: ${spec.lighting.atmosphere}.`);
  if (spec.composition.depth_of_field) parts.push(`DOF: ${spec.composition.depth_of_field}.`);
  if (spec.surface) parts.push(`Surface: ${spec.surface}.`);
  if (spec.background) parts.push(`Background: ${spec.background}.`);
  if (spec.palette_in_use?.length) parts.push(`Palette: ${spec.palette_in_use.join(", ")}.`);
  if (spec.finish?.post_processing) parts.push(`Post: ${spec.finish.post_processing}.`);
  if (spec.finish?.grain && spec.finish.grain !== "none") parts.push(`Grain: ${spec.finish.grain}.`);
  if (spec.text_overlay) {
    if (typeof spec.text_overlay === "string") {
      parts.push(`Text: ${spec.text_overlay}.`);
    } else {
      const t = spec.text_overlay as Record<string, unknown>;
      parts.push(`Text overlay: "${t.text}" — ${t.font_character}, ${t.colour_hex}, ${t.placement}.`);
    }
  }
  parts.push(`Product: ${spec.product.placement}. ${spec.product.contact}.`);
  parts.push(spec.product.CRITICAL);
  return parts.join(" ");
}

function combinedVibeSystemPrompt(): string {
  return `You are a visual-aesthetic synthesiser and shot-spec engineer. You receive a SET of reference images that may come from different brands, styles, or sources, PLUS the user's product (supplied to the image model separately as a locked reference image). Your job is two-fold:

1. SYNTHESISE the SHARED visual thread across ALL reference images — the common aesthetic that connects them: lighting mood, colour tone, composition style, surface feel, atmosphere, branding and logo/typography treatment.
2. ENCODE that shared vibe as 2–4 fully-structured SHOT-SPEC objects an image-generation model can render directly, each placing the user's locked product into a scene that matches the references' vibe, aesthetics, colour tone, branding and logo.

The reference images are INSPIRATION, not one brand's assets. Find what they share. The user's product is LOCKED and INVIOLABLE — every shot spec stages the SCENE around it and never redesigns it.

=====================================================================
NON-NEGOTIABLE RULES — breaking any one is a failed response
=====================================================================
R1. Output EXACTLY ONE JSON object matching the schema below. No prose, no markdown, no code fences, no comments.
R2. Be CONCRETE and REPRODUCIBLE. Every value must be something a photographer could shoot or an image model could render from the words alone. Pair every impression with its physical cause (e.g. not "moody" but "deep shadow falloff from a single hard rim light").
R3. BANNED VOCABULARY — never use these or close synonyms; replace with the observable physical parameter: premium, clean, modern, sleek, elegant, aesthetic, vibe, elevated, stunning, beautiful, gorgeous, eye-catching, sophisticated, timeless, effortless, curated, high-quality, professional-looking, nice, cool, amazing.
R4. COLOUR TONE: "palette.hex" holds 3–8 uppercase 6-digit hex codes drawn from the dominant colours across the references, ordered by visual dominance. Each shot spec's lighting and grade must be consistent with this palette.
R5. PRODUCT FIDELITY IS ABSOLUTE. The user's product is locked: identical shape, proportions, colour, material, finish, hardware, logo and printed text. NEVER redesign, restyle, recolour, resize, deform or regenerate it. The "product" block stages placement only — position, scale, orientation, contact shadow, reflection, light-wrap — and never restyles the product. Every shot spec's "product.CRITICAL" repeats the fidelity lock verbatim.
R6. BRANDING & LOGO MATCHING. Read the references' branding cues — typography style, logo placement habits, overlay treatment, brand colour accents — and capture them in "branding". If the references carry text/logo overlays and the user wants matching, encode exact overlay text, font character, colour and placement in "text_overlay". The user's PRODUCT logo is part of the locked product and is NEVER altered; "branding"/"text_overlay" describe only SCENE-level brand styling, never the product's own logo.
R7. Each shot spec MUST fully specify: (a) camera angle, (b) light source + direction + quality + colour temp, (c) depth of field, (d) surface, (e) background, (f) the top 3 palette hex codes in use, (g) finish / post-processing, and (h) text overlay (exact text + treatment, or "no text overlay"). These live in the nested blocks of the schema.
R8. "negativePrompt" in each shot spec lists concrete prohibitions including: redesigned product, altered logo, changed colours, distorted, warped, watermark, gibberish text, extra products, double product, blurry, low-res, cluttered — plus scene-specific off-tracks.
R9. Set top-level "confidence": "high" if 5+ images share a clear thread; "medium" if 3–4; "low" if diversity is high but a thread was found. Note diversity in "summary".
R10. Never output null or empty strings for required fields. If evidence is sparse, make a reasonable creative inference and mark that shot spec's "basis": "inferred".

=====================================================================
OUTPUT SCHEMA — return ONLY this object
=====================================================================
{
  "summary": "2-3 concrete sentences describing the shared visual thread across the references",
  "confidence": "high | medium | low",
  "assetsAnalyzed": <integer>,
  "palette": {
    "hex": ["#XXXXXX", ...],
    "colour_tone": "concrete description of the shared colour temperature and grade"
  },
  "mood": "concrete mood phrase tied to visible physical causes",
  "branding": {
    "typography": "observed font character across references, or 'none'",
    "logo_treatment": "how logos/marks appear in the references (placement, size, colour), or 'none'",
    "accent_colours": ["#XXXXXX", ...]
  },
  "shotSpecs": [
    {
      "shot_id": "UPPERCASE_SNAKE_UNIQUE_ID",
      "shot_label": "human-readable scene label",
      "basis": "observed | inferred",
      "v": 1.0,
      "ar": "9:16 | 1:1 | 4:5 | 16:9",
      "references": {
        "product_identity": "the user's locked product, described only enough to locate it — never restyled",
        "scene_and_environment": "the matched environment drawn from the references",
        "lighting_reference": "the matched lighting drawn from the references",
        "grade_reference": "the matched colour grade / post drawn from the references",
        "branding_reference": "matched branding/logo/overlay treatment, or 'none'"
      },
      "concept": {
        "CRITICAL": "the one thing this shot must get right",
        "desc": "one paragraph describing the finished frame concretely"
      },
      "product": {
        "CRITICAL": "PRODUCT FIDELITY ABSOLUTE — keep the supplied product EXACTLY as-is: shape, proportions, colour, material, hardware, logo, printed text. Stage placement only.",
        "fidelity_lock": true,
        "placement": "position in frame, scale relative to frame, orientation",
        "contact": "contact shadow + reflection + light-wrap so it reads as lit by this scene"
      },
      "composition": {
        "camera_angle": "(a) explicit angle and height",
        "framing": "how the product sits in frame",
        "depth_of_field": "(c) explicit f-stop feel + what is sharp vs blurred"
      },
      "lighting": {
        "key": "(b) main light: source, direction, quality",
        "fill": "fill or none",
        "colour_temp": "(b) Kelvin feel",
        "atmosphere": "haze/fog/none and how it interacts with light"
      },
      "surface": "(d) the surface the product sits on",
      "background": "(e) the background, with blur state",
      "palette_in_use": ["#XXXXXX", "#XXXXXX", "#XXXXXX"],
      "finish": {
        "post_processing": "(g) grade, contrast, highlight/shadow treatment",
        "grain": "grain character or none"
      },
      "text_overlay": "(h) 'no text overlay' OR { text, font_character, colour_hex, placement }",
      "negativePrompt": "concrete prohibitions + scene-specific off-tracks"
    }
  ]
}
Output ONLY the JSON object.`;
}

function parseCombinedVibeJson(text: string): CombinedVibeResult {
  let stripped = text.trim();
  if (stripped.startsWith("```")) {
    stripped = stripped.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  }
  let raw = JSON.parse(stripped) as Record<string, unknown>;
  // Unwrap if Gemini added an outer key
  if (!raw.shotSpecs && !raw.summary) {
    const first = Object.values(raw)[0];
    if (first && typeof first === "object") raw = first as Record<string, unknown>;
  }
  const specs = raw.shotSpecs as ShotSpec[] | undefined;
  if (!Array.isArray(specs) || !specs.length) throw new Error("missing shotSpecs");

  // Palette: v2 is nested { hex: [...], colour_tone: "..." }; flatten to string[] for UI.
  const rawPalette = raw.palette as Record<string, unknown> | string[] | undefined;
  let hexArr: string[] = [];
  let paletteV2: { hex: string[]; colour_tone: string } | undefined;
  if (Array.isArray(rawPalette)) {
    hexArr = rawPalette.map(String).filter(c => /^#[0-9A-Fa-f]{6}$/.test(c));
  } else if (rawPalette && typeof rawPalette === "object" && Array.isArray(rawPalette.hex)) {
    hexArr = (rawPalette.hex as unknown[]).map(String).filter(c => /^#[0-9A-Fa-f]{6}$/.test(c));
    paletteV2 = { hex: hexArr, colour_tone: String(rawPalette.colour_tone ?? "") };
  }

  const rawBranding = raw.branding as Record<string, unknown> | undefined;

  return {
    summary: String(raw.summary ?? "Combined vibe extracted from reference images."),
    confidence: (raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low")
      ? raw.confidence : "medium",
    assetsAnalyzed: typeof raw.assetsAnalyzed === "number" ? raw.assetsAnalyzed : 0,
    palette: hexArr,
    paletteV2,
    mood: String(raw.mood ?? ""),
    branding: rawBranding ? {
      typography: String(rawBranding.typography ?? "none"),
      logo_treatment: String(rawBranding.logo_treatment ?? "none"),
      accent_colours: Array.isArray(rawBranding.accent_colours) ? (rawBranding.accent_colours as unknown[]).map(String) : [],
    } : undefined,
    shotSpecs: specs.filter(s => s && s.concept?.desc),
    rowConcept: raw.rowConcept ? String(raw.rowConcept) : undefined,
  };
}

/**
 * Extract a combined vibe from diverse reference images (can be from any brand).
 * Unlike extractBrandVisualDnaFromBase64, this is tolerant of mixed visual styles
 * and will always attempt to return a usable result rather than null on validation
 * failures. Designed for the Vibe Match "cross-brand synthesis" use case.
 */
export async function extractCombinedVibeFromImages(
  base64DataUrls: string[],
  geminiKey: string,
): Promise<CombinedVibeResult | null> {
  if (!geminiKey) return null;

  // Cap at 8 images to keep payload within Gemini vision token limits.
  // For very large compressed images (>3 MB base64) skip to avoid 413s.
  const encoded: Array<{ mime_type: string; data: string }> = [];
  for (const url of base64DataUrls.slice(0, 8)) {
    const m = url.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!m || m[2].length > 4_000_000) continue;
    encoded.push({ mime_type: m[1], data: m[2] });
  }
  if (encoded.length < 1) {
    console.warn("[combined-vibe] no usable images");
    return null;
  }

  const system = combinedVibeSystemPrompt();
  const baseInstruction = `You have ${encoded.length} reference image${encoded.length !== 1 ? "s" : ""} from various brands/sources plus the user's product. Identify the shared visual thread (vibe, colour tone, branding, logo) and output only the JSON object of structured shot specs per your system instruction — match the references, lock the product.`;

  let lastResult: CombinedVibeResult | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    // Attempt 1: JSON mode (fastest, but 404s when schema is too complex for vision)
    // Attempt 2+: text mode — no responseMimeType, parsers handle markdown fences fine
    const jsonMode = attempt === 1;
    const instruction = attempt === 1
      ? baseInstruction
      : attempt === 2
        ? `${baseInstruction}\n\nOutput ONLY a raw JSON object. Start directly with { and end with }. No markdown, no code fences.`
        : `${baseInstruction}\n\nSimplify: output a minimal JSON object with "summary", "palette" (object with "hex" array of 3 codes), "mood", and "shotSpecs" (1 full entry is enough). No markdown.`;
    try {
      const text = await callGeminiVision(system, [...encoded.map(p => ({ inline_data: p })), { text: instruction }], geminiKey, { jsonMode });
      const result = parseCombinedVibeJson(text);
      result.assetsAnalyzed = encoded.length;
      if (result.shotSpecs.length > 0) {
        console.log(`[combined-vibe] extracted on attempt ${attempt} (${jsonMode ? "json" : "text"} mode): ${result.shotSpecs.length} shot specs, confidence=${result.confidence}`);
        return result;
      }
      lastResult = result;
    } catch (e) {
      console.warn(`[combined-vibe] attempt ${attempt} (${jsonMode ? "json" : "text"} mode) failed: ${e}`);
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500));
  }

  return lastResult;
}

// ── Instagram grid vibe extractor ─────────────────────────────────────────────
// Takes posts from ONE Instagram account. Finds what makes them a cohesive grid
// and produces exactly one shot spec per requested aspect ratio, each designed
// to produce a new post that would fit seamlessly in that feed.

function gridAnalysisSystemPrompt(aspectRatio: string): string {
  return `You are an Instagram grid analyst and shot-spec engineer. You receive a set of posts from ONE Instagram account — the MOST RECENT 3 are marked as the "current top row" (the reference row that must be continued). Your job is two-fold:

1. ANALYSE the grid's visual identity from ALL supplied posts, but anchor primarily on the 3 most recent posts (the current top row) — these set today's aesthetic direction.
2. DESIGN EXACTLY 3 new shot specs, all using ar: "${aspectRatio}", that will form the NEXT row of this grid. The 3 posts must be designed AS A ROW UNIT — when a viewer sees all 3 side-by-side they should read as intentionally cohesive: same colour grade, same light direction, same compositional rhythm, complementary (not identical) subjects or scenes.

PRODUCT COMPOSITING: If a product image is supplied separately as a locked reference, every spec stages the scene around it — never redesigns it. If no product, design standalone scenes.

=====================================================================
NON-NEGOTIABLE RULES
=====================================================================
R1. Output EXACTLY ONE JSON object. No prose, no markdown, no code fences.
R2. ROW COHESION IS THE PRIMARY CONSTRAINT. The 3 specs must work together AS ONE ROW viewed side-by-side on an Instagram grid. They share: the same palette (± minor variation), same light direction and colour temperature, same finish/grade, and the same compositional density. A viewer seeing the 3 posts together must immediately perceive them as a designed set. No spec should feel like it belongs to a different feed.
R3. GRID CONTINUITY. Every spec must also feel like it belongs in the EXISTING feed — the new row continues the visual thread of the posts above it. The transition from current top row to new row must be seamless.
R4. Be CONCRETE and REPRODUCIBLE. Pair every impression with its physical cause. No banned words: premium, clean, modern, sleek, elegant, aesthetic, vibe, elevated, stunning, beautiful, gorgeous, eye-catching, sophisticated, timeless, effortless, curated, high-quality, nice, cool, amazing.
R5. All hex codes are 6-digit uppercase. "palette.hex" contains 3–8 codes ordered by dominance.
R6. PRODUCT FIDELITY IS ABSOLUTE (when a product is supplied). Keep it locked: shape, proportions, colour, material, hardware, logo, printed text. Stage placement only.
R7. Each spec must specify: (a) camera angle, (b) light source + direction + quality + colour temp, (c) depth of field, (d) surface, (e) background, (f) top 3 palette hex in use, (g) finish/post-processing, (h) text overlay or "no text overlay".
R8. "negativePrompt" must include: redesigned product, altered logo, changed colours, off-brand colours, inconsistent lighting across row, jarring colour shift vs adjacent posts, distorted, warped, watermark, gibberish text, blurry, low-res.
R9. "confidence": "high" if 4+ posts share a clear thread; "medium" if 2–3; "low" otherwise.
R10. Output EXACTLY 3 shotSpecs. All must use ar: "${aspectRatio}". Differentiate them by SUBJECT/SCENE VARIATION only (different angle, different surface, different prop arrangement) — not by colour or lighting, which must stay consistent across all 3.

OUTPUT SCHEMA — return ONLY this object:
{
  "summary": "2-3 concrete sentences: what makes this grid cohesive AND what visual logic unites the 3 new row posts",
  "confidence": "high | medium | low",
  "assetsAnalyzed": <integer>,
  "rowConcept": "one sentence naming the unifying idea for the 3 new posts as a row (e.g. 'three product angles in warm side-lit studio, left-to-right rotation')",
  "palette": { "hex": ["#XXXXXX",...], "colour_tone": "concrete colour temperature description" },
  "mood": "concrete mood phrase tied to visible physical causes",
  "branding": { "typography": "font character or 'none'", "logo_treatment": "or 'none'", "accent_colours": [] },
  "shotSpecs": [
    {
      "shot_id": "ROW_POST_1_UPPERCASE_SNAKE",
      "shot_label": "Post 1 of 3 — brief scene label",
      "row_position": 1,
      "basis": "observed | inferred",
      "v": 1.0,
      "ar": "${aspectRatio}",
      "row_note": "how this post relates to posts 2 and 3 in the row (e.g. 'leftmost — widest angle, sets the scene')",
      "references": { "product_identity": "locked product or 'standalone scene'", "scene_and_environment": "...", "lighting_reference": "...", "grade_reference": "...", "branding_reference": "..." },
      "concept": { "CRITICAL": "the one thing this specific post must get right within the row", "desc": "one paragraph describing this frame concretely" },
      "product": { "CRITICAL": "PRODUCT FIDELITY ABSOLUTE — keep the supplied product EXACTLY as-is: shape, proportions, colour, material, hardware, logo, printed text. Stage placement only.", "fidelity_lock": true, "placement": "...", "contact": "..." },
      "composition": { "camera_angle": "...", "framing": "...", "depth_of_field": "..." },
      "lighting": { "key": "...", "fill": "...", "colour_temp": "...", "atmosphere": "..." },
      "surface": "...",
      "background": "...",
      "palette_in_use": ["#XXXXXX","#XXXXXX","#XXXXXX"],
      "finish": { "post_processing": "MUST MATCH across all 3 posts in the row", "grain": "..." },
      "text_overlay": "no text overlay OR { text, font_character, colour_hex, placement }",
      "negativePrompt": "..."
    }
  ]
}
Output ONLY the JSON object.`;
}

/**
 * Extract grid vibe from Instagram posts (all from ONE account).
 * Always outputs EXACTLY 3 shot specs — the next row of 3 posts —
 * all using the same single aspect ratio.
 *
 * Pass the most-recent 3 posts FIRST in base64DataUrls so the system prompt
 * can identify them as the "current top row" reference.
 */
export async function extractGridVibeFromImages(
  base64DataUrls: string[],
  geminiKey: string,
  aspectRatio = "1:1",
): Promise<CombinedVibeResult | null> {
  if (!geminiKey || !base64DataUrls.length) return null;

  // Cap at 6 images — Gemini vision + JSON mode often returns empty with 7–9 inline images.
  const encoded: Array<{ mime_type: string; data: string }> = [];
  for (const url of base64DataUrls.slice(0, 6)) {
    const m = url.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!m || m[2].length > 2_500_000) continue;
    encoded.push({ mime_type: m[1], data: m[2] });
  }
  if (!encoded.length) throw new Error("No usable reference images could be read.");

  const system = gridAnalysisSystemPrompt(aspectRatio);
  const topRowCount = Math.min(3, encoded.length);

  // Progressive retries: full context → top-3 anchor only → simplified schema.
  // Never use Gemini JSON mode for multi-image vision — it intermittently returns empty bodies.
  const attempts: Array<{ imageCount: number; instruction: string }> = [
    {
      imageCount: encoded.length,
      instruction: `You have ${encoded.length} post${encoded.length !== 1 ? "s" : ""} from one Instagram account. The FIRST ${topRowCount} image${topRowCount !== 1 ? "s" : ""} are the most recent posts (current top row). Analyse the grid aesthetic and design exactly 3 new posts (the next row) per your system instruction.\n\nOutput ONLY a raw JSON object. Start with { end with }. No markdown, no code fences.`,
    },
    {
      imageCount: Math.min(3, encoded.length),
      instruction: `You have ${Math.min(3, encoded.length)} posts from one Instagram account (the current top row). Analyse their shared aesthetic and design exactly 3 new posts for the next row (ar: "${aspectRatio}").\n\nOutput ONLY a raw JSON object. Start with { end with }. No markdown.`,
    },
    {
      imageCount: Math.min(3, encoded.length),
      instruction: `Analyse these Instagram grid posts and design the next row of 3 posts (all ar: "${aspectRatio}").\n\nOutput minimal valid JSON only: "summary", "palette" (hex array), "rowConcept", "mood", "shotSpecs" (3 entries). No markdown.`,
    },
  ];

  let lastErr = "";
  for (let attempt = 0; attempt < attempts.length; attempt++) {
    const { imageCount, instruction } = attempts[attempt];
    const batch = encoded.slice(0, imageCount);
    try {
      const text = await callGeminiVision(
        system,
        [...batch.map(p => ({ inline_data: p })), { text: instruction }],
        geminiKey,
        { jsonMode: false },
      );
      const result = parseCombinedVibeJson(text);
      result.assetsAnalyzed = batch.length;
      if (result.shotSpecs.length > 0) {
        console.log(`[grid-vibe] attempt ${attempt + 1} (${batch.length} img, text mode): ${result.shotSpecs.length} row specs, ar=${aspectRatio}`);
        return result;
      }
      lastErr = "model returned no shot specs";
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(`[grid-vibe] attempt ${attempt + 1} (${batch.length} img) failed: ${lastErr}`);
    }
    if (attempt < attempts.length - 1) await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
  }
  // Surface the real reason instead of returning null. Distinguish a genuine
  // daily-quota / billing exhaustion (actionable: top up) from a transient
  // per-minute rate-limit or overload (actionable: just retry in a moment) —
  // Gemini returns 429 RESOURCE_EXHAUSTED for BOTH, so match on the specifics.
  const hasOpenAiFallbackHint = /OPENAI_API_KEY/i.test(lastErr);
  const isDailyOrBilling = /per ?day|perdayper|exceeded your current quota|check your plan and billing|free.?tier|billing|HTTP 402|insufficient/i.test(lastErr);
  const isTransientLimit = /429|RESOURCE_EXHAUSTED|per ?minute|perminute|\brate\b|503|overloaded|high demand|UNAVAILABLE/i.test(lastErr);

  if (isDailyOrBilling) {
    throw new Error("Gemini quota/credits exhausted for now — top up or raise the quota at ai.studio/projects (or wait for the daily reset), then retry. (No images were charged.)");
  }
  if (isTransientLimit) {
    throw new Error(hasOpenAiFallbackHint
      ? lastErr
      : "Gemini is momentarily rate-limited — wait ~30s and try again. (Set OPENAI_API_KEY on Vercel for automatic fallback. No images were charged.)");
  }
  throw new Error(lastErr.startsWith("Grid analysis") ? lastErr : `Grid analysis failed: ${lastErr}`);
}
