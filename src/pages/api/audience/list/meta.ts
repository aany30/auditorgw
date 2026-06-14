/**
 * POST /api/audience/list/meta
 *
 * Returns the list of custom audiences for the connected Meta ad account.
 * Used by the Audience Overlap tab to populate the two dropdowns.
 *
 * Body: { accessToken, businessId }
 * Response: { audiences: [{id, name, size}][], source: "demo"|"live" }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";

const DEMO_AUDIENCES = [
  { id: "d001", name: "TOF - Broad India",              size: 15000000 },
  { id: "d002", name: "TOF - Interest - Fashion",       size: 4200000  },
  { id: "d003", name: "TOF - LAL 1% Purchasers",        size: 2100000  },
  { id: "d004", name: "MOF - Website Visitors 30d",     size: 380000   },
  { id: "d005", name: "MOF - Video Viewers 75%",        size: 120000   },
  { id: "d006", name: "BOF - ATC 7d",                   size: 52000    },
  { id: "d007", name: "BOF - Checkout Abandon 3d",      size: 28000    },
  { id: "d008", name: "LOY - Existing Customers 180d",  size: 45000    },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { accessToken, businessId } = req.body || {};
  if (!accessToken || !businessId) return res.status(400).json({ error: "Missing accessToken or businessId" });

  if (isDemoCredential(accessToken)) {
    return res.status(200).json({ audiences: DEMO_AUDIENCES, source: "demo" });
  }

  try {
    const client = new MetaApiClient(accessToken);
    const accountPath = `act_${businessId.replace(/^act_/, "")}`;
    const audiences = await client.getCustomAudiences(accountPath);
    return res.status(200).json({ audiences, source: "live" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
