import React, { useState, useMemo } from "react";
import { useAuthStore } from "@/store/auth";
import { validateCampaignName, MISSING_FAIL_THRESHOLD } from "@/lib/naming/validator";
import { previewCampaignName } from "@/lib/naming/generator";
import { suggestCorrectedName } from "@/lib/naming/suggester";
import { KpiCard, AuditCard, StatusBadge } from "./AuditCard";
import { CheckCircle2, Copy, Wand2, ChevronUp, ChevronDown } from "lucide-react";
import { buildAccountContext, type AuditProps } from "./types";
import type { CampaignData } from "@/types";

type FilterStatus = "all" | "pass" | "fail";

export default function NamingConventionAudit({ campaigns }: AuditProps) {
  const { namingConventions, activeConventionId } = useAuthStore();
  const { metaAccessToken } = useAuthStore();
  const convention = namingConventions.find((c) => c.id === activeConventionId);

  const [filter, setFilter] = useState<FilterStatus>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editorValues, setEditorValues] = useState<Record<string, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  /** Rename state per row: idle | loading | success | { error } */
  const [renameStatus, setRenameStatus] = useState<
    Record<string, "loading" | "success" | { error: string } | undefined>
  >({});

  // Validate every campaign once
  const results = useMemo(() => {
    if (!convention) return [];
    return campaigns.map((campaign) => {
      const result = validateCampaignName(campaign.name, convention);
      return { campaign, result };
    });
  }, [campaigns, convention]);

  const total = results.length;
  const passCount = results.filter((r) => r.result.status === "compliant").length;
  const failCount = total - passCount;
  const passPct = total > 0 ? Math.round((passCount / total) * 100) : 0;
  const failPct = total > 0 ? Math.round((failCount / total) * 100) : 0;

  const filtered = results.filter(({ result }) => {
    if (filter === "all") return true;
    if (filter === "pass") return result.status === "compliant";
    return result.status === "non-compliant";
  });

  // Build per-row editor key (platform + id)
  const rowKey = (c: CampaignData) => `${c.platform}-${c.id}`;

  const handleFixClick = (c: CampaignData) => {
    if (!convention) return;
    const key = rowKey(c);
    if (expandedId === key) {
      setExpandedId(null);
      return;
    }
    // Prefill the editor with suggestCorrectedName output (extracts existing
    // values + falls back to campaign objective for missing pieces).
    const suggestion = suggestCorrectedName(c, convention);
    const prefill: Record<string, string> = {};
    if (suggestion) {
      // suggestCorrectedName joins components in order; recover per-rule values
      // by splitting on the separator.
      const parts = suggestion.suggestedName.split(convention.separator);
      convention.rules.forEach((rule) => {
        prefill[rule.id] = parts[rule.position - 1]?.trim() || "";
      });
    } else {
      convention.rules.forEach((rule) => (prefill[rule.id] = ""));
    }
    setEditorValues((prev) => ({ ...prev, [key]: JSON.stringify(prefill) }));
    setExpandedId(key);
  };

  const getEditor = (key: string): Record<string, string> => {
    try {
      return editorValues[key] ? JSON.parse(editorValues[key]) : {};
    } catch {
      return {};
    }
  };

  const setEditorField = (key: string, ruleId: string, value: string) => {
    const current = getEditor(key);
    current[ruleId] = value;
    setEditorValues((prev) => ({ ...prev, [key]: JSON.stringify(current) }));
  };

  const handleCopy = (key: string, name: string) => {
    navigator.clipboard.writeText(name);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1800);
  };

  const handleApplyRename = async (
    key: string,
    campaign: CampaignData,
    newName: string
  ) => {
    if (!newName.trim()) {
      setRenameStatus((s) => ({ ...s, [key]: { error: "Fill in the form first" } }));
      return;
    }
    // Only Meta is wired right now — Google rename support TBD.
    if (campaign.platform !== "meta") {
      setRenameStatus((s) => ({
        ...s,
        [key]: { error: "Live rename for Google Ads is not wired yet. Use Copy + paste into Google Ads." },
      }));
      return;
    }
    setRenameStatus((s) => ({ ...s, [key]: "loading" }));
    try {
      const res = await fetch("/api/naming/rename/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: metaAccessToken,
          campaignId: campaign.id,
          newName,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setRenameStatus((s) => ({ ...s, [key]: "success" }));
      // Auto-clear success badge after a few seconds
      setTimeout(() => setRenameStatus((s) => {
        const next = { ...s };
        if (next[key] === "success") delete next[key];
        return next;
      }), 5000);
    } catch (e) {
      setRenameStatus((s) => ({
        ...s,
        [key]: { error: e instanceof Error ? e.message : "Rename failed" },
      }));
    }
  };

  if (!convention) {
    return (
      <div className="text-center text-gray-500 py-12">
        No naming convention selected. Configure one in the Naming Conventions settings first.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="Total Campaigns" value={total} subLabel="Audited against active convention" />
        <KpiCard
          label="Pass"
          value={`${passCount} (${passPct}%)`}
          subLabel={`≥${100 - MISSING_FAIL_THRESHOLD}% of required components present`}
          tone={passPct >= 70 ? "good" : passPct >= 40 ? "warn" : "bad"}
          fixContext={{
            metric: "naming_low_compliance",
            accountContext: buildAccountContext(campaigns),
            auditContext: {
              module: "Naming Convention",
              siblingMetrics: { "Pass count": passCount, "Pass %": `${passPct}%`, "Fail count": failCount, "Fail %": `${failPct}%`, "Active convention": convention.name },
            },
          }}
        />
        <KpiCard
          label="Fail"
          value={`${failCount} (${failPct}%)`}
          subLabel={`Missing >${MISSING_FAIL_THRESHOLD}% of required components`}
          tone={failCount === 0 ? "good" : failCount <= 2 ? "warn" : "bad"}
          fixContext={{
            metric: "naming_low_compliance",
            accountContext: buildAccountContext(campaigns),
            auditContext: {
              module: "Naming Convention",
              siblingMetrics: { "Fail count": failCount, "Fail %": `${failPct}%`, "Pass %": `${passPct}%`, "Active convention": convention.name },
            },
          }}
        />
      </div>

      {/* Convention summary */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-900 flex flex-wrap gap-x-4 gap-y-1">
        <span>
          <span className="font-semibold">Convention:</span> {convention.name}
        </span>
        <span>
          <span className="font-semibold">Separator:</span>{" "}
          <code className="bg-white px-1.5 py-0.5 rounded border border-blue-200">
            {convention.separator === " " ? "(space)" : convention.separator}
          </code>
        </span>
        <span>
          <span className="font-semibold">Threshold:</span> missing &gt; {MISSING_FAIL_THRESHOLD}% → Fail
        </span>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["all", "pass", "fail"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg font-semibold transition text-sm ${
              filter === s ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {s === "all" && `All (${total})`}
            {s === "pass" && `✓ Pass (${passCount})`}
            {s === "fail" && `✗ Fail (${failCount})`}
          </button>
        ))}
      </div>

      <AuditCard title="Naming Convention" description="Standardized naming pass/fail per campaign">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">Campaign Name</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">Platform</th>
                <th className="px-4 py-2 text-center font-semibold text-gray-700">Missing</th>
                <th className="px-4 py-2 text-center font-semibold text-gray-700">Status</th>
                <th className="px-4 py-2 text-right font-semibold text-gray-700">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No campaigns to show.
                  </td>
                </tr>
              ) : (
                filtered.map(({ campaign, result }) => {
                  const key = rowKey(campaign);
                  const isFail = result.status === "non-compliant";
                  const isOpen = expandedId === key;
                  const editor = getEditor(key);
                  const previewedName = isOpen ? previewCampaignName(editor, convention) : "";

                  return (
                    <React.Fragment key={key}>
                      <tr className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-mono text-gray-900 truncate max-w-md">
                          {campaign.name}
                        </td>
                        <td className="px-4 py-2.5 text-gray-700 capitalize">{campaign.platform}</td>
                        <td className="px-4 py-2.5 text-center font-mono text-gray-900">
                          {result.missingPct}%
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <StatusBadge
                            status={isFail ? "fail" : "pass"}
                            label={isFail ? "Fail" : "Pass"}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => handleFixClick(campaign)}
                            className={`px-3 py-1 rounded font-semibold text-sm transition inline-flex items-center gap-1 ${
                              isFail
                                ? "bg-blue-600 text-white hover:bg-blue-700"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                          >
                            <Wand2 className="w-3 h-3" />
                            {isOpen ? "Close" : isFail ? "Fix name" : "Rename"}
                            {isOpen ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </button>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr key={`${key}-editor`} className="bg-gray-50 border-b border-gray-100">
                          <td colSpan={5} className="px-4 py-4">
                            <div className="space-y-3">
                              <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                                Fix name — fill in the missing components
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {convention.rules.map((rule) => {
                                  const isSelect = rule.inputType === "select" && rule.examples && rule.examples.length > 0;
                                  return (
                                    <div key={rule.id}>
                                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                                        {rule.label}
                                        {rule.required && <span className="text-red-500 ml-1">*</span>}
                                      </label>
                                      {isSelect ? (
                                        <select
                                          value={editor[rule.id] || ""}
                                          onChange={(e) =>
                                            setEditorField(key, rule.id, e.target.value)
                                          }
                                          className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        >
                                          <option value="">— {rule.label} —</option>
                                          {rule.examples!.map((opt) => (
                                            <option key={opt} value={opt}>{opt}</option>
                                          ))}
                                        </select>
                                      ) : (
                                        <input
                                          type="text"
                                          placeholder={rule.placeholder}
                                          value={editor[rule.id] || ""}
                                          onChange={(e) =>
                                            setEditorField(key, rule.id, e.target.value)
                                          }
                                          className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="bg-white border border-blue-200 rounded-lg p-3">
                                <div className="text-xs font-semibold text-blue-900 mb-1">
                                  Preview
                                </div>
                                <code className="text-sm font-mono text-blue-900 break-all">
                                  {previewedName || "(fill in fields above)"}
                                </code>
                              </div>

                              <div className="flex items-center gap-2 justify-end">
                                <button
                                  onClick={() => handleCopy(key, previewedName)}
                                  disabled={!previewedName}
                                  className={`px-3 py-1.5 rounded font-semibold text-sm transition inline-flex items-center gap-1 ${
                                    copiedKey === key
                                      ? "bg-green-600 text-white"
                                      : "bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                  }`}
                                >
                                  {copiedKey === key ? (
                                    <>
                                      <CheckCircle2 className="w-3 h-3" />
                                      Copied
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3 h-3" />
                                      Copy
                                    </>
                                  )}
                                </button>
                                <button
                                  onClick={() => handleApplyRename(key, campaign, previewedName)}
                                  disabled={!previewedName || renameStatus[key] === "loading"}
                                  className="px-3 py-1.5 rounded font-semibold text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition inline-flex items-center gap-1"
                                >
                                  {renameStatus[key] === "loading" ? (
                                    <>
                                      <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                      Renaming…
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle2 className="w-3 h-3" />
                                      Apply Rename
                                    </>
                                  )}
                                </button>
                              </div>

                              {renameStatus[key] === "success" && (
                                <div className="bg-green-50 border border-green-200 rounded p-2 text-xs text-green-900 flex items-center gap-1.5">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                                  Renamed in {campaign.platform === "meta" ? "Meta Ads Manager" : "Google Ads"}. Refresh the page to see the updated name.
                                </div>
                              )}
                              {typeof renameStatus[key] === "object" && (
                                <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-900">
                                  ✗ {(renameStatus[key] as { error: string }).error}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </AuditCard>
    </div>
  );
}
