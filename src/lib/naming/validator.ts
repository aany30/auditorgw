/**
 * Campaign name validation against naming conventions
 */

import type { NamingConvention, NamingComplianceResult, NamingComponent } from "@/types";

// Pass/fail threshold: if more than this share of components are missing
// from the campaign name, it fails the nomenclature check.
export const MISSING_FAIL_THRESHOLD = 65; // percent

export function validateCampaignName(
  campaignName: string,
  convention: NamingConvention
): NamingComplianceResult {
  const components: NamingComponent[] = [];

  // Split campaign name by the convention separator
  const parts = campaignName.split(convention.separator);

  let totalCount = 0;
  let presentCount = 0;

  for (const rule of convention.rules) {
    const actualValue = parts[rule.position - 1] || null;
    const isPresent = actualValue !== null && actualValue.trim().length > 0;

    // Required field is "valid" only if present; optional fields are always valid.
    const isValid = !rule.required || isPresent;

    // Count EVERY rule (not just required) for the missing-% calculation.
    // Rationale: the form's `required` flag controls whether the user MUST
    // fill it in the Maker form. The audit should still measure naming
    // completeness against the full rule set — otherwise a convention with
    // all-optional fields would never flag anything as failing.
    totalCount++;
    if (isPresent) presentCount++;

    components.push({
      position: rule.position,
      label: rule.label,
      expectedPattern: rule.placeholder,
      actualValue: actualValue?.trim() || null,
      isPresent,
      isValid,
    });
  }

  const missingPct = totalCount === 0
    ? 0
    : Math.round(((totalCount - presentCount) / totalCount) * 100);

  const status: "compliant" | "non-compliant" =
    missingPct > MISSING_FAIL_THRESHOLD ? "non-compliant" : "compliant";

  return {
    campaignId: "", // Set by caller
    campaignName,
    platform: "meta", // Set by caller
    status,
    missingPct,
    components,
  };
}

/**
 * Check if a campaign name matches a convention with fuzzy tolerance
 */
export function isCompliant(result: NamingComplianceResult, allowMissing: number = 0): boolean {
  const missingCount = result.components.filter((c) => !c.isValid).length;
  return missingCount <= allowMissing;
}

/**
 * Get human-readable description of what's wrong
 */
export function getComplianceDetails(result: NamingComplianceResult): string[] {
  const issues: string[] = [];

  for (const component of result.components) {
    if (!component.isValid) {
      if (!component.isPresent) {
        issues.push(`Missing: ${component.label}`);
      } else {
        issues.push(`Invalid: ${component.label} should match "${component.expectedPattern}"`);
      }
    }
  }

  return issues;
}
