/**
 * POST /api/audience/overlap/meta
 *
 * Estimates the overlap between two Meta custom audiences using the
 * reachestimate endpoint (inclusion / union approach):
 *
 *   overlap ≈ sizeA + sizeB − reach(A ∪ B)
 *
 * This is an approximation — Meta does not expose exact overlap counts.
 *
 * Body: { accessToken, businessId, audienceAId, audienceBId }
 * Response: { sizeA, sizeB, unionReach, overlap, overlapPct, source }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";

const DEMO_SIZES: Record<string, number> = {
  d001: 15000000,
  d002: 4200000,
  d003: 2100000,
  d004: 380000,
  d005: 120000,
  d006: 52000,
  d007: 28000,
  d008: 45000,
};

function demoOverlap(aId: string, bId: string) {
  const sizeA = DEMO_SIZES[aId] ?? 500000;
  const sizeB = DEMO_SIZES[bId] ?? 500000;
  // Simulate realistic overlap: 5–30% of smaller audience
  const pct = 0.05 + (((aId.charCodeAt(3) || 1) + (bId.charCodeAt(3) || 2)) % 26) / 100;
  const overlap = Math.round(Math.min(sizeA, sizeB) * pct);
  const unionReach = sizeA + sizeB - overlap;
  return { sizeA, sizeB, unionReach, overlap, overlapPct: (overlap / Math.min(sizeA, sizeB)) * 100 };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { accessToken, businessId, audienceAId, audienceBId } = req.body || {};
  if (!accessToken || !businessId || !audienceAId || !audienceBId) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (audienceAId === audienceBId) {
    return res.status(400).json({ error: "Select two different audiences" });
  }

  if (isDemoCredential(accessToken)) {
    return res.status(200).json({ ...demoOverlap(audienceAId, audienceBId), source: "demo" });
  }

  try {
    const client = new MetaApiClient(accessToken);
    const accountPath = `act_${businessId.replace(/^act_/, "")}`;

    // Three parallel reach estimates
    const [reachA, reachB, reachUnion] = await Promise.all([
      client.getReachEstimate(accountPath, [audienceAId]).catch(() => 0),
      client.getReachEstimate(accountPath, [audienceBId]).catch(() => 0),
      client.getReachEstimate(accountPath, [audienceAId, audienceBId]).catch(() => 0),
    ]);

    const overlap = Math.max(0, reachA + reachB - reachUnion);
    const smaller = Math.min(reachA, reachB);
    const overlapPct = smaller > 0 ? (overlap / smaller) * 100 : 0;

    return res.status(200).json({
      sizeA: reachA,
      sizeB: reachB,
      unionReach: reachUnion,
      overlap,
      overlapPct,
      source: "live",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
