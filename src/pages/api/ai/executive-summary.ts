/**
 * POST /api/ai/executive-summary
 *
 * Generates an AI executive summary for a dashboard tab.
 * Used by the AIExecutiveSummary component on tabs that don't have
 * per-row status badges (Pixel Health, Audience tabs, Reporting, etc.).
 *
 * Body: { tabName, context, platform, dateRange, isDemo }
 * Response: { headline, overview, keyFindings, recommendations, creditsUsedUsd, source }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import Anthropic from "@anthropic-ai/sdk";
import { calcCost } from "@/lib/ai-cost";

interface SummaryRequest {
  tabName: string;
  context: Record<string, unknown>;
  platform?: string;
  dateRange?: string;
  isDemo?: boolean;
}

interface SummaryResponse {
  headline: string;
  overview: string;
  keyFindings: string[];
  recommendations: string[];
  source: "ai" | "fallback";
  creditsUsedUsd?: number;
}

const SYSTEM_PROMPT = `You are a senior paid-media analyst writing an executive summary for a marketing dashboard tab. You will receive the tab name, platform, date range, and a JSON snapshot of the current tab data. Your job is to produce a concise but insightful executive summary that highlights what's working, what needs attention, and concrete next steps.

Rules:
- Use the actual numbers from the data — never be generic.
- Headline: one punchy sentence (under 90 chars) that names the biggest takeaway.
- Overview: 2-3 sentences giving the big picture.
- Key Findings: 3-5 bullet points, each naming a specific metric and its value.
- Recommendations: 3-5 actionable bullet points with specific UI steps (Meta Ads Manager, Google Ads, etc.).
- Output ONLY valid JSON matching the schema. No prose outside JSON.`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    headline: { type: "string" as const },
    overview: { type: "string" as const },
    keyFindings: { type: "array" as const, items: { type: "string" as const } },
    recommendations: { type: "array" as const, items: { type: "string" as const } },
  },
  required: ["headline", "overview", "keyFindings", "recommendations"],
  additionalProperties: false,
};

// Static fallback when no API key is set (demo mode)
function staticFallback(tabName: string): SummaryResponse {
  return {
    headline: `${tabName} — sample executive summary (connect AI for real insights)`,
    overview: `This is a sample summary for the ${tabName} tab. Connect an Anthropic API key to generate a real analysis based on your actual account data.`,
    keyFindings: [
      "Sample finding: review your top-spending campaigns against ROAS targets.",
      "Sample finding: check audience overlap between similar ad sets.",
      "Sample finding: verify conversion events are firing correctly across all pages.",
    ],
    recommendations: [
      "Connect your Meta or Google account for data-driven insights.",
      "Set an Anthropic API key (ANTHROPIC_API_KEY) to enable AI analysis.",
      "Widen the date range for more statistical significance.",
    ],
    source: "fallback",
    creditsUsedUsd: 0,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SummaryResponse | { error: string }>
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { tabName, context, platform, dateRange, isDemo } = (req.body || {}) as SummaryRequest;
  if (!tabName) return res.status(400).json({ error: "Missing tabName" });

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(200).json(staticFallback(tabName));
  }

  try {
    const client = new Anthropic({ apiKey });

    const userPayload = {
      tabName,
      platform: platform ?? "meta",
      dateRange: dateRange ?? "last 30 days",
      data: context,
    };

    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
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
          content: `Generate an executive summary for this tab data:\n\n${JSON.stringify(userPayload, null, 2)}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("No text block");

    const parsed = JSON.parse(textBlock.text) as Omit<SummaryResponse, "source" | "creditsUsedUsd">;
    const creditsUsedUsd = calcCost(response.usage);

    return res.status(200).json({ ...parsed, source: "ai", creditsUsedUsd });
  } catch (err) {
    if (isDemo) return res.status(200).json(staticFallback(tabName));
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `AI summary failed: ${msg}` });
  }
}
