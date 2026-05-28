import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient, MetaPixelStats } from "@/lib/api-clients/meta";
import { isDemoCredential, getDemoMetaAudit } from "@/lib/demo-data";
import { analyzeMetaPixel, analyzeFunnel, rankRecommendations, Recommendation } from "@/lib/recommendations/engine";

export interface MetaAuditResponse {
  source: "live" | "demo" | "mixed";
  pixels: MetaPixelStats[];
  recommendations: Recommendation[];
  perPixelSource: Record<string, "live" | "demo">;
  errors: string[];
  generatedAt: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MetaAuditResponse | { error: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { accessToken, pixelIds: rawPixelIds, businessId } = req.body || {};

  if (!accessToken) {
    return res.status(400).json({ error: "accessToken is required" });
  }

  const useDemo = isDemoCredential(accessToken);
  const pixels: MetaPixelStats[] = [];
  const perPixelSource: Record<string, "live" | "demo"> = {};
  const errors: string[] = [];

  // Resolve which pixel IDs to audit:
  // 1. If the caller passed any, use those exactly.
  // 2. Otherwise auto-discover from the connected business (live mode) or
  //    fall back to two demo pixel IDs (demo mode).
  let pixelIds: string[] = Array.isArray(rawPixelIds)
    ? rawPixelIds.filter((id) => typeof id === "string" && id.trim().length > 0)
    : [];

  if (pixelIds.length === 0) {
    if (useDemo) {
      pixelIds = ["demo-pixel-001", "demo-pixel-002"];
    } else if (businessId) {
      // Try ad-account-level pixels first (most common case — user pastes
      // their ad account ID as "Business ID"). Fall back to true business-owned
      // pixels if the input looks like a real Business Manager ID.
      const accountPath = businessId.startsWith("act_")
        ? businessId
        : /^\d+$/.test(businessId)
        ? `act_${businessId}`
        : businessId;
      const pathsToTry = [
        `${accountPath}/adspixels`,            // ad-account-scoped pixels
        `${businessId}/owned_pixels`,           // business-scoped pixels (fallback)
      ];
      for (const path of pathsToTry) {
        try {
          const r = await fetch(
            `https://graph.facebook.com/v18.0/${encodeURIComponent(path)}?fields=id,name&limit=20&access_token=${encodeURIComponent(accessToken)}`
          );
          const data = await r.json();
          if (Array.isArray(data?.data) && data.data.length > 0) {
            pixelIds = data.data.map((p: { id: string }) => p.id);
            break;
          }
        } catch {
          // try next path
        }
      }
      if (pixelIds.length === 0) {
        errors.push(
          "No pixels found under this account. Add a pixel in Events Manager, or specify a Pixel ID."
        );
      }
    } else {
      errors.push("No Pixel IDs and no businessId provided. Cannot run pixel audit.");
    }
  }

  if (useDemo) {
    for (const id of pixelIds) {
      pixels.push(getDemoMetaAudit(id));
      perPixelSource[id] = "demo";
    }
  } else {
    const client = new MetaApiClient(accessToken);
    for (const id of pixelIds) {
      try {
        const live = await client.getFullPixelAudit(id);
        if (live) {
          pixels.push(live);
          perPixelSource[id] = "live";
        } else {
          pixels.push(getDemoMetaAudit(id));
          perPixelSource[id] = "demo";
          errors.push(`Pixel ${id}: live audit failed, using demo data`);
        }
      } catch (e: any) {
        pixels.push(getDemoMetaAudit(id));
        perPixelSource[id] = "demo";
        errors.push(`Pixel ${id}: ${e.message}`);
      }
    }
  }

  const allRecs: Recommendation[] = [];
  for (const pixel of pixels) {
    allRecs.push(...analyzeMetaPixel(pixel));
    allRecs.push(...analyzeFunnel(pixel.eventBreakdown));
  }

  const sources = Object.values(perPixelSource);
  const source: MetaAuditResponse["source"] =
    sources.every((s) => s === "live") ? "live" : sources.every((s) => s === "demo") ? "demo" : "mixed";

  res.status(200).json({
    source,
    pixels,
    recommendations: rankRecommendations(allRecs),
    perPixelSource,
    errors,
    generatedAt: new Date().toISOString(),
  });
}
