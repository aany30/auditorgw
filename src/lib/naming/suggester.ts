/**
 * Suggest corrected campaign names based on conventions
 */

import type { NamingConvention, CampaignData } from "@/types";
import { generateCampaignName } from "./generator";

export interface NameSuggestion {
  currentName: string;
  suggestedName: string;
  confidence: number;
  reasons: string[];
}

/**
 * Suggest a corrected name for a non-compliant campaign
 */
export function suggestCorrectedName(
  campaign: CampaignData,
  convention: NamingConvention
): NameSuggestion | null {
  try {
    const parts = campaign.name.split(convention.separator);
    const components: Record<string, string> = {};
    const reasons: string[] = [];

    // Try to extract values from current name
    for (const rule of convention.rules) {
      const index = rule.position - 1;
      if (index < parts.length && parts[index]?.trim()) {
        components[rule.id] = parts[index].trim();
      } else if (rule.id === "objective" && campaign.objective) {
        // Try to use campaign objective if available
        components[rule.id] = campaign.objective;
        reasons.push(`Filled "${rule.label}" from campaign objective`);
      } else if (rule.required) {
        // Skip if we can't auto-fill
        return null;
      }
    }

    // Generate suggested name
    const suggestedName = generateCampaignName(components, convention);

    return {
      currentName: campaign.name,
      suggestedName,
      confidence: calculateConfidence(components, convention),
      reasons,
    };
  } catch {
    return null;
  }
}

/**
 * Calculate confidence score (0-100) based on how many components were auto-filled
 */
function calculateConfidence(components: Record<string, string>, convention: NamingConvention): number {
  const totalRequired = convention.rules.filter((r) => r.required).length;
  const filled = convention.rules.filter((r) => r.required && components[r.id]).length;

  // 100% if all required components are provided
  // Lower if we had to guess or skip
  return Math.round((filled / totalRequired) * 100);
}

/**
 * Bulk suggest names for multiple campaigns
 */
export function suggestCorrectedNames(
  campaigns: CampaignData[],
  convention: NamingConvention
): NameSuggestion[] {
  const suggestions: NameSuggestion[] = [];

  for (const campaign of campaigns) {
    const suggestion = suggestCorrectedName(campaign, convention);
    if (suggestion) {
      suggestions.push(suggestion);
    }
  }

  // Sort by confidence descending
  return suggestions.sort((a, b) => b.confidence - a.confidence);
}
