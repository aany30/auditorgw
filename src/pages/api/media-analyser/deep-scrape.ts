import type { NextApiRequest, NextApiResponse } from "next";
import { startAdLibraryScrapeRun, getApifyRunStatus, mapAdLibraryDataset, fetchApifyDatasetRaw, startApifyRun, getApifyToken } from "@/lib/media-analyser/meta-social";
import { enrichPaidAd } from "@/lib/media-analyser/paid-ad-buckets";
import { fetchScanById, updateScanBrief } from "@/lib/media-analyser/supabase";
import type { SocialPaidAd } from "@/lib/media-analyser/types";

export const config = { maxDuration: 800 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const action = String(body.action ?? "");
  try {
    if (action === "start") {
      const url = String(body.adLibraryUrl ?? "").trim();
      if (!url) return res.status(400).json({ error: "adLibraryUrl required" });
      const { runId, datasetId } = await startAdLibraryScrapeRun(url);
      return res.status(200).json({ runId, datasetId });
    }

    if (action === "status") {
      const s = await getApifyRunStatus(getApifyToken(), String(body.runId ?? ""));
      return res.status(200).json(s);
    }

    if (action === "gstart") {
      const url = String(body.url ?? "").trim();
      const brand = String(body.brand ?? "").trim();
      const m = url.match(/advertiser\/(AR[0-9]+)/i);
      let region = String(body.region ?? "").trim().toUpperCase() || undefined;
      if (url) { try { region = region || (new URL(url).searchParams.get("region") || "").toUpperCase() || undefined; } catch { /* ignore */ } }
      const input: Record<string, unknown> = { maxAds: Math.min(Number(body.maxAds) || 1000, 1000) };
      if (region) input.region = region;
      if (m) input.advertiserIds = [m[1]];
      else if (brand) input.searchTerms = [brand];
      else return res.status(400).json({ error: "need an /advertiser/AR… URL or a brand" });
      const { runId, datasetId } = await startApifyRun(getApifyToken(), "automation-lab/google-ads-scraper", input, 1024);
      return res.status(200).json({ runId, datasetId, advertiserId: m?.[1] ?? null, brand: brand || null, region: region ?? null });
    }

    if (action === "astore") {
      const q = encodeURIComponent(String(body.q ?? "").trim());
      const r = await fetch(`https://api.apify.com/v2/store?search=${q}&limit=30&token=${getApifyToken()}`);
      const j = await r.json().catch(() => ({}));
      const items = (((j as Record<string, unknown>).data as Record<string, unknown>)?.items ?? []) as Record<string, unknown>[];
      return res.status(200).json({ count: items.length, actors: items.map(a => ({ id: `${a.username}/${a.name}`, title: a.title, runs: (a.stats as Record<string, unknown> | undefined)?.totalRuns })) });
    }

    if (action === "ainfo") {
      const actor = String(body.actor ?? "").trim().replace("/", "~");
      if (!actor) return res.status(400).json({ error: "actor required" });
      const r = await fetch(`https://api.apify.com/v2/acts/${actor}?token=${getApifyToken()}`);
      const j = await r.json().catch(() => ({}));
      const d = (j as Record<string, unknown>).data as Record<string, unknown> | undefined;
      if (!d) return res.status(404).json({ error: "actor not found or not accessible", raw: j });
      let schema: unknown = null;
      try {
        const br = await fetch(`https://api.apify.com/v2/acts/${actor}/builds/default?token=${getApifyToken()}`);
        const bj = await br.json().catch(() => ({}));
        const raw = ((bj as Record<string, unknown>).data as Record<string, unknown> | undefined)?.inputSchema;
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === "object") {
          const p = parsed as Record<string, unknown>;
          const props = (p.properties ?? {}) as Record<string, Record<string, unknown>>;
          schema = {
            required: p.required ?? [],
            fields: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, { type: v.type, editor: v.editor, prefill: v.prefill, default: v.default, example: v.example }])),
          };
        }
      } catch { /* ignore */ }
      return res.status(200).json({ name: d.name, title: d.title, username: d.username, schema, exampleRunInput: d.exampleRunInput ?? null });
    }

    if (action === "astart") {
      const actor = String(body.actor ?? "").trim();
      if (!actor) return res.status(400).json({ error: "actor required" });
      const input = (body.input && typeof body.input === "object") ? body.input as Record<string, unknown> : {};
      const memory = Number(body.memory) || 1024;
      const { runId, datasetId } = await startApifyRun(getApifyToken(), actor, input, memory);
      return res.status(200).json({ runId, datasetId, actor });
    }

    if (action === "graw") {
      const items = await fetchApifyDatasetRaw(String(body.datasetId ?? ""), Number(body.limit) || 10000);
      return res.status(200).json({ count: items.length, items });
    }

    if (action === "sample") {
      const raw = await fetchApifyDatasetRaw(String(body.datasetId ?? ""), 300);
      const RE = /@[a-z0-9._]{3,30}|\bwith\s+@?[a-z0-9._]{3,30}\b|(?:ft|feat|featuring|by)\.?\s+[A-Z][a-z]+/gi;
      const hits: string[] = [];
      for (const it of raw) {
        const copy = Array.isArray(it.ad_creative_bodies) ? (it.ad_creative_bodies as string[]).join(" ") : "";
        const m = copy.match(RE);
        if (m) hits.push(`${it.ad_archive_id}: ${m.slice(0, 3).join(" | ")}`);
      }
      return res.status(200).json({ scanned: raw.length, adsWithCreatorMention: hits.length, examples: hits.slice(0, 20) });
    }

    if (action === "finalize") {
      const datasetId = String(body.datasetId ?? "");
      const scanId = String(body.scanId ?? "");
      const brand = String(body.brand ?? "").trim();
      if (!datasetId || !scanId || !brand) return res.status(400).json({ error: "datasetId, scanId, brand required" });

      const scraped = (await mapAdLibraryDataset(datasetId)).map(enrichPaidAd) as SocialPaidAd[];
      if (!scraped.length) return res.status(409).json({ error: "dataset empty — is the run finished?" });

      const scan = await fetchScanById(scanId);
      const brief = scan?.brief as Record<string, unknown> | undefined;
      if (!brief) return res.status(404).json({ error: "scan not found or has no brief" });

      const KEEP = new Set([
        "adId", "body", "title", "cta", "format", "mediaType", "status", "isActive",
        "startTime", "stopTime", "runningDays", "categories", "collationCount", "pageId", "pageName",
        "brandedContent", "partnershipLabel", "igActor", "pageCategories", "advertiserEntityType",
        "publisherPlatforms", "platformBucket", "durationBucket", "destinationUrl",
      ]);
      const slim = (ad: SocialPaidAd): SocialPaidAd => {
        const o = ad as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const k of KEEP) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
        if (typeof out.body === "string") {
          const cp = [...out.body];
          if (cp.length > 200) out.body = cp.slice(0, 200).join("");
        }
        return out as unknown as SocialPaidAd;
      };
      const merge = (existing: SocialPaidAd[]): SocialPaidAd[] => {
        const byId = new Map<string, SocialPaidAd>();
        for (const a of existing) byId.set(String(a.adId), slim(a));
        for (const a of scraped) byId.set(String(a.adId), slim(a));
        return [...byId.values()];
      };

      const cs = (brief.competitorSocial ?? []) as Array<Record<string, unknown>>;
      const comp = cs.find(c => String(c.brand ?? "").toLowerCase() === brand.toLowerCase());
      let where: string, before: number, after: number;
      if (comp) {
        const existing = (comp.ads ?? []) as SocialPaidAd[];
        before = existing.length;
        const merged = merge(existing);
        comp.ads = merged; comp.adCount = merged.length;
        after = merged.length; where = "competitorSocial";
      } else {
        const ss = (brief.socialSnapshot ?? {}) as Record<string, unknown>;
        const existing = (ss.paidAds ?? []) as SocialPaidAd[];
        before = existing.length;
        const merged = merge(existing);
        ss.paidAds = merged;
        after = merged.length; where = "socialSnapshot";
      }

      const saved = await updateScanBrief(scanId, brief);
      return res.status(200).json({ ok: saved.ok, error: saved.error, where, brand, before, after, added: after - before, scrapedThisRun: scraped.length });
    }

    return res.status(400).json({ error: `unknown action "${action}"` });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
