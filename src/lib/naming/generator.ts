/**
 * Campaign name generation from components
 */

import type { NamingConvention } from "@/types";

export function generateCampaignName(
  components: Record<string, string>,
  convention: NamingConvention
): string {
  const sortedRules = [...convention.rules].sort((a, b) => a.position - b.position);

  const values: string[] = [];

  for (const rule of sortedRules) {
    const value = components[rule.id] || "";

    if (rule.required && !value.trim()) {
      throw new Error(`Missing required component: ${rule.label}`);
    }

    values.push(value);
  }

  return values.filter((v) => v.trim().length > 0).join(convention.separator);
}

/**
 * Validate that all required components are provided
 */
export function validateComponents(
  components: Record<string, string>,
  convention: NamingConvention
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const rule of convention.rules) {
    if (rule.required && (!components[rule.id] || components[rule.id].trim().length === 0)) {
      missing.push(rule.label);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Get preview of generated name as components are filled in
 */
export function previewCampaignName(
  components: Record<string, string>,
  convention: NamingConvention
): string {
  const sortedRules = [...convention.rules].sort((a, b) => a.position - b.position);
  const values = sortedRules
    .map((rule) => components[rule.id] || "")
    .filter((v) => v.length > 0);

  if (values.length === 0) {
    return `(${convention.name} preview)`;
  }

  return values.join(convention.separator);
}
