/**
 * POST /api/reporting/breakdown/meta
 *
 * Returns Meta account-level insights grouped by a Meta breakdown dimension
 * (age / gender / country / device / publisher_platform / etc.). Used by the
 * Targeting Insights audit to surface which demographics + places to invest
 * more in.
 *
 * Body: { accessToken, businessId, breakdown, startDate, endDate }
 *   - breakdown: "age" | "gender" | "country" | "region" | "impression_device"
 *                | "publisher_platform" | "platform_position" | "age,gender"
 *   - dates: optional ISO strings; defaults to last 30 days
 *
 * Demo passthrough: when accessToken is a demo placeholder, returns a small
 * deterministic mock dataset so the dashboard can preview the UI without a
 * real Meta connection.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential } from "@/lib/demo-data";

type Row = {
  label: string;
  breakdownValues: Record<string, string>;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
};

function getDemoBreakdown(breakdown: string): Row[] {
  // Deterministic demo data covering the common breakdowns. Numbers picked to
  // make ranking obvious so the "focus here" recommendation has clear winners.
  const demos: Record<string, Row[]> = {
    age: [
      { label: "25-34", breakdownValues: { age: "25-34" }, spend: 48000, impressions: 1200000, clicks: 18000, conversions: 320, conversionValue: 180000 },
      { label: "35-44", breakdownValues: { age: "35-44" }, spend: 42000, impressions: 980000, clicks: 14000, conversions: 280, conversionValue: 220000 },
      { label: "18-24", breakdownValues: { age: "18-24" }, spend: 28000, impressions: 850000, clicks: 12500, conversions: 110, conversionValue: 55000 },
      { label: "45-54", breakdownValues: { age: "45-54" }, spend: 22000, impressions: 510000, clicks: 7200, conversions: 165, conversionValue: 132000 },
      { label: "55-64", breakdownValues: { age: "55-64" }, spend: 11000, impressions: 240000, clicks: 3100, conversions: 72, conversionValue: 58000 },
      { label: "65+",   breakdownValues: { age: "65+" },   spend: 4500,  impressions: 95000,  clicks: 1100, conversions: 18, conversionValue: 14000 },
    ],
    gender: [
      { label: "female",  breakdownValues: { gender: "female" },  spend: 92000, impressions: 2100000, clicks: 31000, conversions: 620, conversionValue: 420000 },
      { label: "male",    breakdownValues: { gender: "male" },    spend: 58000, impressions: 1450000, clicks: 21500, conversions: 310, conversionValue: 218000 },
      { label: "unknown", breakdownValues: { gender: "unknown" }, spend: 5000,  impressions: 125000,  clicks: 1900,  conversions: 35,  conversionValue: 21000 },
    ],
    country: [
      { label: "IN", breakdownValues: { country: "IN" }, spend: 135000, impressions: 3200000, clicks: 48000, conversions: 850, conversionValue: 580000 },
      { label: "US", breakdownValues: { country: "US" }, spend: 12000,  impressions: 180000,  clicks: 2800,  conversions: 45,  conversionValue: 40000 },
      { label: "AE", breakdownValues: { country: "AE" }, spend: 5500,   impressions: 95000,   clicks: 1500,  conversions: 22,  conversionValue: 22000 },
      { label: "GB", breakdownValues: { country: "GB" }, spend: 2200,   impressions: 38000,   clicks: 580,   conversions: 8,   conversionValue: 7600 },
      { label: "SG", breakdownValues: { country: "SG" }, spend: 1800,   impressions: 32000,   clicks: 450,   conversions: 6,   conversionValue: 5800 },
    ],
    region: [
      { label: "Maharashtra",       breakdownValues: { region: "Maharashtra" },       spend: 38000, impressions: 920000, clicks: 13800, conversions: 245, conversionValue: 168000 },
      { label: "Karnataka",         breakdownValues: { region: "Karnataka" },         spend: 26000, impressions: 630000, clicks: 9400,  conversions: 168, conversionValue: 115000 },
      { label: "Delhi",             breakdownValues: { region: "Delhi" },             spend: 22000, impressions: 540000, clicks: 8100,  conversions: 144, conversionValue: 98000  },
      { label: "Tamil Nadu",        breakdownValues: { region: "Tamil Nadu" },        spend: 18000, impressions: 440000, clicks: 6600,  conversions: 117, conversionValue: 80000  },
      { label: "Telangana",         breakdownValues: { region: "Telangana" },         spend: 12000, impressions: 290000, clicks: 4350,  conversions: 78,  conversionValue: 53000  },
      { label: "West Bengal",       breakdownValues: { region: "West Bengal" },       spend: 7500,  impressions: 182000, clicks: 2730,  conversions: 49,  conversionValue: 33000  },
      { label: "Uttar Pradesh",     breakdownValues: { region: "Uttar Pradesh" },     spend: 5800,  impressions: 141000, clicks: 2120,  conversions: 38,  conversionValue: 26000  },
      { label: "Gujarat",           breakdownValues: { region: "Gujarat" },           spend: 4200,  impressions: 102000, clicks: 1530,  conversions: 27,  conversionValue: 18500  },
      { label: "Rajasthan",         breakdownValues: { region: "Rajasthan" },         spend: 1400,  impressions: 34000,  clicks: 510,   conversions: 9,   conversionValue: 6100   },
      { label: "California",        breakdownValues: { region: "California" },        spend: 4800,  impressions: 72000,  clicks: 1120,  conversions: 18,  conversionValue: 16000  },
      { label: "New York",          breakdownValues: { region: "New York" },          spend: 3600,  impressions: 54000,  clicks: 840,   conversions: 14,  conversionValue: 12000  },
      { label: "Dubai",             breakdownValues: { region: "Dubai" },             spend: 3800,  impressions: 66000,  clicks: 1040,  conversions: 15,  conversionValue: 15000  },
    ],
    impression_device: [
      { label: "iPhone",         breakdownValues: { impression_device: "iPhone" },         spend: 78000, impressions: 1850000, clicks: 27000, conversions: 540, conversionValue: 380000 },
      { label: "Android",        breakdownValues: { impression_device: "Android" },        spend: 62000, impressions: 1750000, clicks: 26500, conversions: 410, conversionValue: 230000 },
      { label: "Desktop",        breakdownValues: { impression_device: "Desktop" },        spend: 14000, impressions: 280000,  clicks: 4200,  conversions: 65,  conversionValue: 52000 },
      { label: "iPad",           breakdownValues: { impression_device: "iPad" },           spend: 1200,  impressions: 24000,   clicks: 380,   conversions: 5,   conversionValue: 4800 },
    ],
    platform_position: [
      { label: "feed",              breakdownValues: { platform_position: "feed" },              spend: 62000, impressions: 1480000, clicks: 22000, conversions: 410, conversionValue: 285000 },
      { label: "instagram_stories", breakdownValues: { platform_position: "instagram_stories" }, spend: 28000, impressions: 920000,  clicks: 9800,  conversions: 185, conversionValue: 148000 },
      { label: "video_feeds",       breakdownValues: { platform_position: "video_feeds" },       spend: 24000, impressions: 580000,  clicks: 7200,  conversions: 120, conversionValue: 95000  },
      { label: "instagram_reels",   breakdownValues: { platform_position: "instagram_reels" },   spend: 18000, impressions: 650000,  clicks: 12000, conversions: 95,  conversionValue: 72000  },
      { label: "facebook_stories",  breakdownValues: { platform_position: "facebook_stories" },  spend: 12000, impressions: 380000,  clicks: 4100,  conversions: 58,  conversionValue: 42000  },
      { label: "marketplace",       breakdownValues: { platform_position: "marketplace" },        spend: 8000,  impressions: 195000,  clicks: 2900,  conversions: 35,  conversionValue: 24000  },
      { label: "right_hand_column", breakdownValues: { platform_position: "right_hand_column" }, spend: 2500,  impressions: 62000,   clicks: 680,   conversions: 10,  conversionValue: 7000   },
      { label: "messenger_inbox",   breakdownValues: { platform_position: "messenger_inbox" },   spend: 1000,  impressions: 22000,   clicks: 290,   conversions: 3,   conversionValue: 2200   },
      { label: "audio",             breakdownValues: { platform_position: "audio" },             spend: 4500,  impressions: 110000,  clicks: 520,   conversions: 8,   conversionValue: 5500   },
      { label: "connected_tv",      breakdownValues: { platform_position: "connected_tv" },      spend: 3200,  impressions: 85000,   clicks: 310,   conversions: 5,   conversionValue: 4000   },
    ],
    publisher_platform: [
      { label: "facebook",         breakdownValues: { publisher_platform: "facebook" },         spend: 88000, impressions: 2050000, clicks: 31500, conversions: 580, conversionValue: 390000 },
      { label: "instagram",        breakdownValues: { publisher_platform: "instagram" },        spend: 62000, impressions: 1620000, clicks: 23800, conversions: 410, conversionValue: 285000 },
      { label: "audience_network", breakdownValues: { publisher_platform: "audience_network" }, spend: 4000,  impressions: 110000,  clicks: 1800,  conversions: 12,  conversionValue: 9000 },
      { label: "messenger",        breakdownValues: { publisher_platform: "messenger" },        spend: 1000,  impressions: 22000,   clicks: 300,   conversions: 3,   conversionValue: 2400 },
    ],
    daily: (() => {
      // Generate 30 days ending yesterday with a realistic spend curve
      const rows: Row[] = [];
      const base = new Date("2026-05-12");
      for (let i = 0; i < 30; i++) {
        const d = new Date(base);
        d.setDate(base.getDate() + i);
        const label = d.toISOString().slice(0, 10);
        const wave = 0.7 + 0.5 * Math.sin((i / 30) * Math.PI * 2);
        const spend = Math.round(5000 + 3000 * wave);
        rows.push({ label, breakdownValues: { date: label }, spend, impressions: Math.round(spend * 22), clicks: Math.round(spend * 0.32), conversions: Math.round(spend * 0.006), conversionValue: Math.round(spend * 4.1) });
      }
      return rows;
    })(),
    "age,gender": [
      { label: "25-34 · female", breakdownValues: { age: "25-34", gender: "female" }, spend: 32000, impressions: 750000, clicks: 11500, conversions: 240, conversionValue: 145000 },
      { label: "35-44 · female", breakdownValues: { age: "35-44", gender: "female" }, spend: 28000, impressions: 640000, clicks: 9200,  conversions: 215, conversionValue: 178000 },
      { label: "25-34 · male",   breakdownValues: { age: "25-34", gender: "male" },   spend: 16000, impressions: 450000, clicks: 6500,  conversions: 80,  conversionValue: 35000 },
      { label: "18-24 · female", breakdownValues: { age: "18-24", gender: "female" }, spend: 18000, impressions: 520000, clicks: 7800,  conversions: 75,  conversionValue: 38000 },
      { label: "35-44 · male",   breakdownValues: { age: "35-44", gender: "male" },   spend: 14000, impressions: 340000, clicks: 4800,  conversions: 65,  conversionValue: 42000 },
      { label: "18-24 · male",   breakdownValues: { age: "18-24", gender: "male" },   spend: 10000, impressions: 330000, clicks: 4700,  conversions: 35,  conversionValue: 17000 },
    ],
  };
  return demos[breakdown] || [];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const { accessToken, businessId, breakdown, startDate, endDate } = req.body || {};
  if (!accessToken || !businessId || !breakdown) {
    res.status(400).json({ error: "Missing accessToken, businessId, or breakdown" });
    return;
  }

  // Whitelist breakdown values — Meta will reject unknown enums anyway, but
  // failing here gives a cleaner error to the UI.
  const ALLOWED = new Set([
    "age", "gender", "country", "region", "impression_device",
    "device_platform", "publisher_platform", "platform_position",
    "age,gender", "daily",
  ]);
  if (!ALLOWED.has(breakdown)) {
    res.status(400).json({ error: `Unsupported breakdown "${breakdown}"` });
    return;
  }

  if (isDemoCredential(accessToken)) {
    res.status(200).json({ source: "demo", rows: getDemoBreakdown(breakdown) });
    return;
  }

  try {
    const client = new MetaApiClient(accessToken);
    const accountPath = businessId.startsWith("act_") ? businessId : `act_${businessId}`;
    // "daily" is a pseudo-breakdown — uses time_increment=1 rather than breakdowns=
    const rows = breakdown === "daily"
      ? await client.getAccountDailyInsights(accountPath, startDate, endDate)
      : await client.getInsightsBreakdown(accountPath, breakdown, startDate, endDate);
    res.status(200).json({ source: "live", rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Meta breakdown fetch failed" });
  }
}
