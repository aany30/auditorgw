import type { NextApiRequest, NextApiResponse } from "next";
import { editWithNanoBananaPro, type FalAspect } from "@/lib/media-analyser/fal";
import { normalizeImageModel } from "@/lib/media-analyser/generation-models";
import { fetchCdnImageInline } from "@/lib/media-analyser/brandVisualDna";
import {
  buildAplusPlan,
  buildAplusRenderPrompt,
  buildAplusComparisonRenderPrompt,
  buildAplusSeamlessRenderPrompt,
  computeSeamlessZones,
  motifEdgesForModule,
  type AplusModule,
  type AplusProductInput,
  type AplusAttribute,
  type SeamlessZone,
} from "@/lib/media-analyser/aplus";

export const config = { maxDuration: 300 };

// ── Stream contract ─────────────────────────────────────────────────────────────

export interface AplusModuleMeta {
  order: number;
  kind: AplusModule["kind"];
  title: string;
  headline: string;
  aspect: FalAspect;
}

export interface AplusUpdate {
  phase: "analyzing" | "plan_ready" | "generating" | "result" | "done" | "error";
  message?: string;
  // plan_ready
  creativeConcept?: string;
  pageStrategy?: string;
  competitorBenchmark?: string;
  palette?: { name: string; hex: string }[];
  moduleCount?: number;
  modules?: AplusModule[];
  // generating / result
  index?: number;
  total?: number;
  module?: AplusModule;
  imageUrl?: string;
}

// ── Input parsing ────────────────────────────────────────────────────────────────

function toStringArray(v: unknown): string[] {
  return (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x));
}

function parseAttributes(v: unknown): AplusAttribute[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((a) => {
      const o = (a ?? {}) as Record<string, unknown>;
      return { label: String(o.label ?? o.key ?? "").trim(), value: String(o.value ?? "").trim() };
    })
    .filter((a) => a.label && a.value)
    .slice(0, 40);
}

function normalizeAspect(a: FalAspect): FalAspect {
  return a === "16:9" || a === "21:9" || a === "4:5" || a === "1:1" || a === "9:16" ? a : "16:9";
}

/**
 * Load an image URL into a base64 data URL Gemini can read inline. Tries the shared
 * CDN helper first (browser-headed direct fetch + fb/ig proxy), then falls back to the
 * weserv proxy — which reliably fetches ANY public image (Amazon, Flipkart, Myntra, …)
 * from any server IP. Without this fallback, non-fb/ig hosts had only a single direct
 * fetch and any hiccup produced "Could not load any product images".
 */
async function loadImageInline(url: string): Promise<string | null> {
  const inline = await fetchCdnImageInline(url).catch(() => null);
  if (inline) return `data:${inline.mime_type};base64,${inline.data}`;
  try {
    // Pass the FULL url (with scheme) encoded — weserv defaults to http and Amazon 403s
    // that, so a scheme-stripped url fails; the full https url resolves correctly.
    const res = await fetch(`https://images.weserv.nl/?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const ct = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
      if (ct.startsWith("image/")) {
        const buf = await res.arrayBuffer();
        return `data:${ct};base64,${Buffer.from(buf).toString("base64")}`;
      }
    }
  } catch {
    /* fall through to null */
  }
  console.warn(`[aplus] could not load image after direct + weserv: ${url.slice(0, 100)}`);
  return null;
}

// ── Route ────────────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const isDryRun = req.query.dry === "1";

  const body = (req.body ?? {}) as Record<string, unknown>;
  const imageModel = normalizeImageModel(body.imageModel).id;

  // Aspect ratio: "auto" keeps the planner's per-module aspect; a concrete value forces
  // every rendered module to that ratio.
  const rawAspect = String(body.aspectRatio ?? "auto");
  const forcedAspect: FalAspect | null =
    rawAspect === "16:9" || rawAspect === "21:9" || rawAspect === "4:5" || rawAspect === "1:1" || rawAspect === "9:16" ? rawAspect : null;

  // Seamless mode: render modules as edge-to-edge panels with locked, continuous edge colours.
  // connectorMotifs adds brand-appropriate scattered elements crossing the seams (implies seamless).
  const connectorMotifs = body.connectorMotifs === true;
  const seamless = body.seamless === true || connectorMotifs;

  // Product reference images: uploaded data: URLs and/or CDN image URLs.
  const dataInputs = toStringArray(body.productImageDataUrls).filter((u) => u.startsWith("data:image/"));
  const urlInputs = toStringArray(body.productImageUrls).filter((u) => u.startsWith("http"));
  const rawInputs = [...dataInputs, ...urlInputs].slice(0, 6);

  const product: AplusProductInput = {
    title: body.title ? String(body.title) : undefined,
    brand: body.brand ? String(body.brand) : undefined,
    price: body.price ? String(body.price) : undefined,
    rating: body.rating ? String(body.rating) : undefined,
    attributes: parseAttributes(body.attributes),
    painPoints: toStringArray(body.painPoints).map((s) => s.trim()).filter(Boolean).slice(0, 12),
    keywords: toStringArray(body.keywords).map((s) => s.trim()).filter(Boolean).slice(0, 12),
    moduleCount: typeof body.moduleCount === "number" ? body.moduleCount : undefined,
    connectorMotifs,
  };

  if (!rawInputs.length) {
    return res.status(400).json({ error: "productImageDataUrls or productImageUrls are required" });
  }

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  const falKey = process.env.FAL_KEY ?? "";
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
  if (!isDryRun && !falKey) return res.status(500).json({ error: "FAL_KEY is not configured" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (u: AplusUpdate) => { res.write(`data: ${JSON.stringify(u)}\n\n`); };

  try {
    send({
      phase: "analyzing",
      message: `Reading ${rawInputs.length} product photo${rawInputs.length !== 1 ? "s" : ""} and planning the A+ argument…`,
    });

    // Convert every input to a base64 data URL Gemini can read inline.
    const dataUrls: string[] = [];
    for (const input of rawInputs) {
      if (input.startsWith("data:image/")) {
        dataUrls.push(input);
      } else {
        const d = await loadImageInline(input);
        if (d) dataUrls.push(d);
      }
    }
    if (!dataUrls.length) {
      send({ phase: "error", message: "Could not load any product images. Check the URLs or upload directly." });
      res.end();
      return;
    }

    // STAGE 1 — build the ordered module plan.
    let plan;
    try {
      plan = await buildAplusPlan(dataUrls, product, geminiKey);
    } catch (e) {
      send({ phase: "error", message: String(e instanceof Error ? e.message : e) });
      res.end();
      return;
    }

    // Force every module to the chosen aspect when the user picked one (else keep per-module).
    if (forcedAspect) {
      plan.modules = plan.modules.map((m) => ({ ...m, aspect: forcedAspect }));
    }

    send({
      phase: "plan_ready",
      creativeConcept: plan.creativeConcept,
      pageStrategy: plan.pageStrategy,
      competitorBenchmark: plan.competitorBenchmark,
      palette: plan.brandKit.palette.map((c) => ({ name: c.name, hex: c.hex })),
      moduleCount: plan.modules.length,
      modules: plan.modules,
      message: `A+ plan ready — ${plan.modules.length} modules. Rendering module images…`,
    });

    // STAGE 2 — render each module. FAL accepts data: and http URLs directly.
    const falRefs = rawInputs;
    const total = plan.modules.length;

    // Seamless mode: precompute per-module edge-colour zones so panels stitch with no seam.
    const zones: SeamlessZone[] = seamless ? computeSeamlessZones(plan) : [];

    for (let i = 0; i < plan.modules.length; i++) {
      const mod = plan.modules[i];

      send({
        phase: "generating",
        index: i,
        total,
        module: mod,
        message: `Module ${i + 1}/${total} — ${mod.title}${mod.kind === "comparison" ? " (native table)" : ""}${seamless ? " · seamless" : ""}…`,
      });

      if (isDryRun) {
        send({ phase: "result", index: i, total, module: mod });
        continue;
      }

      // The comparison module ships the native editable table (always) AND a rendered
      // comparison graphic. In seamless mode its graphic gets the locked edge colours too.
      if (mod.kind === "comparison") {
        try {
          const prompt = buildAplusComparisonRenderPrompt(plan, mod, seamless ? { top: zones[i].top, bottom: zones[i].bottom } : undefined);
          const img = await editWithNanoBananaPro(falKey, falRefs, prompt, {
            aspect: normalizeAspect(mod.aspect),
            model: imageModel,
          });
          send({ phase: "result", index: i, total, module: mod, imageUrl: img.url });
        } catch (e) {
          console.warn(`[aplus] comparison graphic render failed, keeping native table: ${String(e)}`);
          send({ phase: "result", index: i, total, module: mod });
        }
        continue;
      }

      try {
        const prompt = seamless
          ? buildAplusSeamlessRenderPrompt(plan, mod, {
              moduleIndex: i + 1,
              totalModules: total,
              zone: zones[i],
              ...(connectorMotifs ? motifEdgesForModule(plan, i) : {}),
            })
          : buildAplusRenderPrompt(plan, mod);
        const img = await editWithNanoBananaPro(falKey, falRefs, prompt, {
          aspect: normalizeAspect(mod.aspect),
          model: imageModel,
        });
        send({ phase: "result", index: i, total, module: mod, imageUrl: img.url });
      } catch (e) {
        send({ phase: "error", index: i, total, module: mod, message: `${mod.title} render failed: ${String(e)}` });
      }
    }

    send({ phase: "done", message: `A+ content generated — ${total} modules.` });
  } catch (err) {
    send({ phase: "error", message: String(err) });
  } finally {
    res.end();
  }
  return;
}
