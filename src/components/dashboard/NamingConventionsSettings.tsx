import { useState } from "react";
import { useAuthStore } from "@/store/auth";
import { X, RotateCcw, Plus, Trash2 } from "lucide-react";
import type { NamingConvention, NamingRule } from "@/types";

interface Props {
  onClose: () => void;
}

export default function NamingConventionsSettings({ onClose }: Props) {
  const { namingConventions, activeConventionId, updateNamingConvention, setActiveConvention } = useAuthStore();
  const [editingRule, setEditingRule] = useState<string | null>(null);

  const activeConvention = namingConventions.find((c) => c.id === activeConventionId);

  if (!activeConvention) {
    return null;
  }

  const handleRuleChange = (ruleId: string, field: string, value: any) => {
    const updatedRules = activeConvention.rules.map((r) =>
      r.id === ruleId ? { ...r, [field]: value } : r
    );
    updateNamingConvention(activeConvention.id, { rules: updatedRules });
  };

  const handleSeparatorChange = (separator: string) => {
    updateNamingConvention(activeConvention.id, { separator });
  };

  // Generate preview name
  const previewName = activeConvention.rules
    .map((r) => `[${r.label.split(" ")[0]}]`)
    .join(activeConvention.separator);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-900">Naming Conventions Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Convention Selector */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Active Convention</label>
            <select
              value={activeConventionId || ""}
              onChange={(e) => setActiveConvention(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            >
              {namingConventions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Separator Setting */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Separator</label>
            <div className="flex gap-2">
              {[">>", "__", "-", " ", "|"].map((sep) => (
                <button
                  key={sep}
                  onClick={() => handleSeparatorChange(sep)}
                  className={`px-4 py-2 rounded-lg font-semibold transition ${
                    activeConvention.separator === sep
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {sep === " " ? "(space)" : sep}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-xs font-semibold text-blue-900 mb-1">Preview</p>
            <p className="text-sm font-mono text-blue-700">{previewName}</p>
          </div>

          {/* Rules Editor */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Naming Rules</h3>
            <div className="space-y-3">
              {activeConvention.rules.map((rule) => (
                <div key={rule.id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <div className="grid grid-cols-2 gap-3 mb-2">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Label</label>
                      <input
                        type="text"
                        value={rule.label}
                        onChange={(e) => handleRuleChange(rule.id, "label", e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Position</label>
                      <input
                        type="number"
                        value={rule.position}
                        onChange={(e) => handleRuleChange(rule.id, "position", parseInt(e.target.value))}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                    </div>
                  </div>

                  <div className="mb-2">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Placeholder / Examples</label>
                    <input
                      type="text"
                      value={rule.placeholder}
                      onChange={(e) => handleRuleChange(rule.id, "placeholder", e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      placeholder="e.g., Agency Name"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={rule.required}
                        onChange={(e) => handleRuleChange(rule.id, "required", e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm text-gray-700">Required</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-between">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
