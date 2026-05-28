/**
 * Test live connection to Meta / Google APIs before saving credentials.
 * Returns granular per-platform status so the UI can show exactly
 * which scope or token is missing.
 */
import type { NextApiRequest, NextApiResponse } from "next";

interface TestResult {
  ok: boolean;
  platform: string;
  message: string;
  details?: string;
  hint?: string;
}

async function testMeta(accessToken: string, businessId: string, pixelIds: string[]): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Test 1: Token validity via /me
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/me?access_token=${encodeURIComponent(accessToken)}`);
    if (!r.ok) {
      const body = await r.text();
      results.push({
        ok: false,
        platform: "Meta Token",
        message: "Access token rejected",
        details: body.slice(0, 200),
        hint: "Generate a new User or System token from Events Manager > Settings > Access Tokens.",
      });
      return results;
    }
    const me = await r.json();
    results.push({ ok: true, platform: "Meta Token", message: `Authenticated as ${me.name || me.id}` });
  } catch (e: any) {
    results.push({ ok: false, platform: "Meta Token", message: "Network error", details: e.message });
    return results;
  }

  // Test 2: Business access
  try {
    const r = await fetch(
      `https://graph.facebook.com/v18.0/${businessId}?fields=id,name&access_token=${encodeURIComponent(accessToken)}`
    );
    if (!r.ok) {
      const body = await r.text();
      results.push({
        ok: false,
        platform: "Meta Business",
        message: "Cannot access Business ID",
        details: body.slice(0, 200),
        hint: "Ensure your token has business_management permission and you're an admin/employee of this business.",
      });
    } else {
      const b = await r.json();
      results.push({ ok: true, platform: "Meta Business", message: `Connected to "${b.name}"` });
    }
  } catch (e: any) {
    results.push({ ok: false, platform: "Meta Business", message: "Network error", details: e.message });
  }

  // Test 3: Pixel access
  for (const pixelId of pixelIds) {
    try {
      const r = await fetch(
        `https://graph.facebook.com/v18.0/${pixelId}?fields=id,name,is_unavailable&access_token=${encodeURIComponent(accessToken)}`
      );
      if (!r.ok) {
        const body = await r.text();
        results.push({
          ok: false,
          platform: `Pixel ${pixelId}`,
          message: "Cannot access pixel",
          details: body.slice(0, 200),
          hint: "Verify the Pixel ID is correct and the token has ads_management + read_insights permissions on this ad account.",
        });
      } else {
        const p = await r.json();
        results.push({
          ok: true,
          platform: `Pixel ${pixelId}`,
          message: `"${p.name}" — ${p.is_unavailable ? "Unavailable" : "Active"}`,
        });
      }
    } catch (e: any) {
      results.push({ ok: false, platform: `Pixel ${pixelId}`, message: "Network error", details: e.message });
    }
  }

  return results;
}

async function testGoogle(
  accessToken: string,
  customerId: string,
  propertyId: string,
  containerId: string,
  developerToken?: string,
  loginCustomerId?: string
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Test GA4
  try {
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
        metrics: [{ name: "eventCount" }],
        limit: 1,
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      results.push({
        ok: false,
        platform: "GA4",
        message: `Property ${propertyId} not accessible`,
        details: body.slice(0, 200),
        hint: "Token needs scope 'https://www.googleapis.com/auth/analytics.readonly' and viewer access to this GA4 property.",
      });
    } else {
      results.push({ ok: true, platform: "GA4", message: `Property ${propertyId} accessible` });
    }
  } catch (e: any) {
    results.push({ ok: false, platform: "GA4", message: "Network error", details: e.message });
  }

  // Test GTM
  try {
    const r = await fetch(`https://www.googleapis.com/tagmanager/v2/accounts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      const body = await r.text();
      results.push({
        ok: false,
        platform: "GTM",
        message: "Cannot list GTM accounts",
        details: body.slice(0, 200),
        hint: "Token needs scope 'https://www.googleapis.com/auth/tagmanager.readonly'.",
      });
    } else {
      const data = await r.json();
      const accounts = data.account || [];
      let containerFound = false;
      for (const acc of accounts) {
        try {
          const cr = await fetch(`https://www.googleapis.com/tagmanager/v2/accounts/${acc.accountId}/containers`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (cr.ok) {
            const cd = await cr.json();
            if ((cd.container || []).some((c: any) => c.publicId === containerId)) {
              containerFound = true;
              break;
            }
          }
        } catch {}
      }
      if (containerFound) {
        results.push({ ok: true, platform: "GTM", message: `Container ${containerId} found` });
      } else {
        results.push({
          ok: false,
          platform: "GTM",
          message: `Container ${containerId} not found`,
          hint: "Ensure the GTM Container ID is correct (format: GTM-XXXXXX) and you have access to the account that owns it.",
        });
      }
    }
  } catch (e: any) {
    results.push({ ok: false, platform: "GTM", message: "Network error", details: e.message });
  }

  // Test Google Ads
  if (!developerToken) {
    results.push({
      ok: false,
      platform: "Google Ads",
      message: "Developer token missing",
      hint: "Google Ads API requires a developer token in addition to OAuth. Apply at https://developers.google.com/google-ads/api/docs/first-call/dev-token",
    });
  } else {
    try {
      const cid = customerId.replace(/-/g, "");
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "Content-Type": "application/json",
      };
      if (loginCustomerId) headers["login-customer-id"] = loginCustomerId.replace(/-/g, "");

      const r = await fetch(`https://googleads.googleapis.com/v15/customers/${cid}/googleAds:searchStream`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: "SELECT customer.descriptive_name FROM customer LIMIT 1" }),
      });
      if (!r.ok) {
        const body = await r.text();
        results.push({
          ok: false,
          platform: "Google Ads",
          message: "Cannot access Google Ads account",
          details: body.slice(0, 250),
          hint:
            "Verify Customer ID, developer token approval status, OAuth scope 'https://www.googleapis.com/auth/adwords', and that login-customer-id is set if accessing via a manager account.",
        });
      } else {
        results.push({ ok: true, platform: "Google Ads", message: `Customer ${customerId} accessible` });
      }
    } catch (e: any) {
      results.push({ ok: false, platform: "Google Ads", message: "Network error", details: e.message });
    }
  }

  return results;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { platform } = req.body || {};

  if (platform === "meta") {
    const { accessToken, businessId, pixelIds } = req.body;
    if (!accessToken || !businessId) {
      return res.status(400).json({ error: "accessToken and businessId required" });
    }
    const results = await testMeta(accessToken, businessId, (pixelIds || []) as string[]);
    return res.status(200).json({ results });
  }

  if (platform === "google") {
    const { accessToken, customerId, propertyId, containerId, developerToken, loginCustomerId } = req.body;
    if (!accessToken || !customerId || !propertyId || !containerId) {
      return res.status(400).json({ error: "accessToken, customerId, propertyId, containerId required" });
    }
    const results = await testGoogle(accessToken, customerId, propertyId, containerId, developerToken, loginCustomerId);
    return res.status(200).json({ results });
  }

  res.status(400).json({ error: "platform must be 'meta' or 'google'" });
}
