/**
 * POST /api/dv360/entities
 *
 * Returns the full set of Insertion Orders and Line Items for the connected
 * DV360 advertiser, with their raw entity shapes preserved so the UI can read
 * budget segments, flight dates, frequency cap, and status.
 *
 * This endpoint intentionally does NOT run a Bid Manager report — spend by
 * entity requires the async BM query/poll/download flow, which bloats this
 * endpoint. The caller can derive "no delivery" / "paused" tips from
 * entityStatus + budget presence alone. Add BM enrichment later if needed.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { DV360ApiClient } from "@/lib/api-clients/dv360";
import { resolveDV360Creds } from "@/lib/default-credentials";

export const config = { maxDuration: 300 };

interface SuccessResponse {
  insertionOrders: unknown[];
  lineItems: unknown[];
}
interface ErrorResponse { error: string }

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const creds = resolveDV360Creds(req.body || {});
  if (!creds) {
    return res.status(400).json({ error: "Missing DV360 credentials (clientId, clientSecret, refreshToken, advertiserId)." });
  }

  try {
    const client = new DV360ApiClient(creds);
    const [insertionOrders, lineItems] = await Promise.all([
      client.listInsertionOrders(),
      client.listLineItems(),
    ]);
    return res.status(200).json({ insertionOrders, lineItems });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const lower = message.toLowerCase();
    if (lower.includes("401") || lower.includes("403") || lower.includes("permission") || lower.includes("insufficient")) {
      return res.status(403).json({
        error: "Reconnect DV360 with the full `display-video` scope to see entity data.",
      });
    }
    console.error("DV360 entities fetch failed:", message);
    return res.status(502).json({ error: message });
  }
}
