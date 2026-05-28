/**
 * AI-powered "How to fix this" recommendations.
 *
 * Behavior:
 * - If ANTHROPIC_API_KEY is set, calls Claude Haiku 4.5 with a cached system
 *   prompt and the full campaign/account/sibling-metric context. Returns
 *   structured step-by-step fix instructions.
 * - If ANTHROPIC_API_KEY is missing OR the API call fails, falls back to the
 *   static recipe library in src/lib/fix-recipes.ts. Falls through silently;
 *   the UI never sees an error.
 *
 * Model: claude-haiku-4-5 (fast + cheap; the dashboard needs sub-2s responses).
 * Caching: the system prompt is wrapped in cache_control:ephemeral so repeat
 * calls within 5 minutes only pay ~0.1× on the prefix.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { getStaticRecipe, type FixRecipe } from "@/lib/fix-recipes";

interface FixRequest {
  metric: string;
  value: string | number;
  status: "bad" | "warn" | "critical" | "moderate";
  platform?: "meta" | "google" | "both";
  threshold?: string;
  campaignContext?: Record<string, unknown>;
  accountContext?: Record<string, unknown>;
  auditContext: {
    module: string;
    siblingMetrics?: Record<string, string | number>;
  };
  /**
   * True when the client has only demo credentials. Real-data connections
   * must NOT fall back to the static recipe library — if AI is unavailable
   * for a real-data request, return an error rather than a generic recipe.
   */
  isDemo?: boolean;
}

interface FixResponse extends FixRecipe {
  source: "ai" | "fallback";
}

const SYSTEM_PROMPT = `You are an expert paid-media auditor at a top performance-marketing agency. You will be given a JSON payload describing a FAILING dashboard metric, plus the full surrounding context — the specific campaign, account-level totals, and sibling KPIs from the same audit page. Your job: produce 4-8 concrete, click-by-click steps to fix the failing metric in Meta Ads Manager or Google Ads.

CRITICAL — use the supplied context. Do NOT be generic:
- When campaignContext is present, name the campaign explicitly in your title (e.g. "Your campaign 'summer_sale_promo' has...").
- Cite the actual numbers from campaignContext (current spend, ROAS, CTR, CPA, conversions) instead of generic ranges.
- Compare against accountContext when relevant (e.g. "This campaign's ROAS of 1.2x is well below your account average of 3.4x").
- Cross-check siblingMetrics. If MULTIPLE KPIs on the page are bad, identify the root cause and fix that — don't fix the symptom. Example: if EMQ is low AND dedup is low, the root issue is CAPI matching, not advanced matching enrichment.
- If campaignContext is absent (account-level metric), use accountContext aggregates to make recommendations specific to this account's volume and currency.

Output format:
- Each step names a specific UI button, menu, or page in Meta Ads Manager or Google Ads. Use the EXACT UI labels users see (e.g. "Events Manager", "Conversions API", "API Center", "Tools → Setup → Conversions", "Audience → Custom Audiences → Exclude").
- Include a "links" array on a step when a deep URL is helpful — use business.facebook.com/events_manager2, ads.google.com/aw/apicenter, etc.
- Plain English. No jargon explaining jargon. Don't define EMQ as "Event Match Quality" mid-sentence — users will hover the term elsewhere if they need that.
- Be direct. Skip preambles like "I understand your concern".
- Output ONLY valid JSON matching the provided schema. No prose outside the JSON.`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    title: {
      type: "string" as const,
      description:
        "Short headline (under 80 chars) that names the campaign by name if campaignContext was provided, and states what to fix.",
    },
    steps: {
      type: "array" as const,
      description:
        "3 to 8 click-by-click steps, ordered. Keep it within that range.",
      items: {
        type: "object" as const,
        properties: {
          action: {
            type: "string" as const,
            description:
              "One specific click-by-click instruction citing real UI labels and the actual numbers from the campaign data when relevant.",
          },
          links: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                label: { type: "string" as const },
                url: { type: "string" as const },
              },
              required: ["label", "url"],
              additionalProperties: false,
            },
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    platform: {
      type: "string" as const,
      enum: ["meta", "google", "both"],
    },
  },
  required: ["title", "steps", "platform"],
  additionalProperties: false,
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<FixResponse | { error: string }>
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body as FixRequest;
  if (!body || !body.metric || !body.auditContext) {
    res.status(400).json({ error: "Missing required fields: metric, auditContext" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const isDemo = body.isDemo === true;

  // ---- No API key path ----
  // - Demo mode → static fallback (so the dashboard still works in dev without an API key)
  // - Real data → return an error rather than fake recipes. Real campaigns deserve real, data-aware answers.
  if (!apiKey) {
    if (isDemo) {
      const recipe = getStaticRecipe(body.metric);
      res.status(200).json({ ...recipe, source: "fallback" });
      return;
    }
    res.status(503).json({
      error:
        "AI recommendations require ANTHROPIC_API_KEY to be set. Real-data dashboards do not use the static recipe library — connect AI to see context-aware fix steps.",
    });
    return;
  }

  // ---- AI path → Claude Haiku 4.5 ----
  try {
    const client = new Anthropic({ apiKey });

    // User message is the full context payload — every field flows through
    // so the AI can give a specific, non-generic answer.
    const userPayload = {
      metric: body.metric,
      value: body.value,
      status: body.status,
      platform: body.platform,
      threshold: body.threshold,
      campaignContext: body.campaignContext,
      accountContext: body.accountContext,
      auditContext: body.auditContext,
    };

    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // 5-minute ephemeral cache — system prompt is identical across all
          // requests, so the prefix stays cached and warm-cache cost is ~0.1×.
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: OUTPUT_SCHEMA,
        },
      },
      messages: [
        {
          role: "user",
          content: `Failing metric and full context:\n\n${JSON.stringify(userPayload, null, 2)}`,
        },
      ],
    });

    // Extract the JSON content from the response
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text block in response");
    }
    const parsed = JSON.parse(textBlock.text) as FixRecipe;

    // Sanity check the response shape
    if (!parsed.title || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      throw new Error("AI response missing required fields");
    }

    res.status(200).json({ ...parsed, source: "ai" });
  } catch (error) {
    console.error("Fix-recommendation AI call failed:", error);
    // Demo mode → graceful static fallback so the dashboard still demos something.
    // Real data → surface the error. Users connected real campaigns; don't show
    // them generic recipes that ignore their actual data.
    if (isDemo) {
      const recipe = getStaticRecipe(body.metric);
      res.status(200).json({ ...recipe, source: "fallback" });
      return;
    }
    const message = error instanceof Error ? error.message : "AI call failed";
    res.status(502).json({
      error: `Could not generate AI fix steps: ${message}. Please try again in a moment.`,
    });
  }
}
