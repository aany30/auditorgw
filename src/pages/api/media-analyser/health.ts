import type { NextApiRequest, NextApiResponse } from "next";
import { healthCheck } from "@/lib/media-analyser/ecom-client";
import { getApifyToken } from "@/lib/media-analyser/meta-social";

async function apifyDiagnostic() {
  const sources: Array<[string, string]> = [
    ["SR_APIFY_TOKEN", (process.env.SR_APIFY_TOKEN ?? "").trim()],
    ["APIFY_API_TOKEN", (process.env.APIFY_API_TOKEN ?? "").trim()],
    ["APIFY_TOKEN", (process.env.APIFY_TOKEN ?? "").trim()],
  ];
  const won = sources.find(([, v]) => v);
  const token = won?.[1] ?? "";

  let apiValidity = "no_token";
  if (token) {
    try {
      const r = await fetch("https://api.apify.com/v2/users/me", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      apiValidity = r.ok ? "valid" : `rejected_${r.status}`;
    } catch {
      apiValidity = "unreachable";
    }
  }

  return {
    sourceUsed: won?.[0] ?? null,
    tokenSuffix: token ? `…${token.slice(-4)}` : null,
    tokenLength: token.length,
    apiValidity,
    varsPresent: {
      SR_APIFY_TOKEN: Boolean(sources[0][1]),
      APIFY_API_TOKEN: Boolean(sources[1][1]),
      APIFY_TOKEN: Boolean(sources[2][1]),
    },
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const scraperOnline = await healthCheck();
  return res.status(200).json({
    status: scraperOnline ? "ok" : "degraded",
    services: {
      ecomScraper: scraperOnline ? "online" : "offline",
      gemini: Boolean(process.env.GEMINI_API_KEY) ? "configured" : "not configured",
      metaGraph: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_PAGE_ID) ? "configured" : "not configured",
      apify: Boolean(getApifyToken()) ? "configured" : "not configured",
      reddit: (process.env.REDDIT_REVIEWS_ENABLED ?? "true").toLowerCase() !== "false" ? "enabled" : "disabled",
      supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) ? "configured" : "not configured",
    },
    apifyDiagnostic: await apifyDiagnostic(),
  });
}
