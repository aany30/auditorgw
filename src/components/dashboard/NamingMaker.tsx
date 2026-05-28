import { useState } from "react";
import { useAuthStore } from "@/store/auth";
import { Copy, CheckCircle2 } from "lucide-react";
import { generateCampaignName, previewCampaignName } from "@/lib/naming/generator";

export default function NamingMaker() {
  const { namingConventions, activeConventionId } = useAuthStore();
  const [components, setComponents] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const activeConvention = namingConventions.find((c) => c.id === activeConventionId);

  if (!activeConvention) {
    return <div className="text-center text-gray-500">No naming convention selected</div>;
  }

  const handleInputChange = (ruleId: string, value: string) => {
    setComponents((prev) => ({ ...prev, [ruleId]: value }));
  };

  const generatedName = previewCampaignName(components, activeConvention);

  const handleCopy = () => {
    try {
      const finalName = generateCampaignName(components, activeConvention);
      navigator.clipboard.writeText(finalName);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      alert("Please fill all required fields");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Naming Maker</h2>
        <p className="text-gray-600">Generate standardized campaign names</p>
      </div>

      {/* Input Form */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="space-y-4">
          {activeConvention.rules.map((rule) => {
            const isSelect = rule.inputType === "select" && rule.examples && rule.examples.length > 0;
            return (
              <div key={rule.id}>
                <label className="block text-sm font-semibold text-gray-900 mb-1">
                  {rule.label}
                  {rule.required ? (
                    <span className="text-red-500 ml-1">*</span>
                  ) : (
                    <span className="ml-2 text-xs font-normal text-gray-400">(optional)</span>
                  )}
                </label>
                {isSelect ? (
                  <select
                    value={components[rule.id] || ""}
                    onChange={(e) => handleInputChange(rule.id, e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{rule.placeholder || `Select ${rule.label.toLowerCase()}`}</option>
                    {rule.examples!.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder={rule.placeholder}
                    value={components[rule.id] || ""}
                    onChange={(e) => handleInputChange(rule.id, e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
                {!isSelect && rule.examples && (
                  <p className="text-xs text-gray-500 mt-1">Examples: {rule.examples.join(", ")}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Preview & Copy */}
      <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg border border-blue-200 shadow-sm p-6">
        <p className="text-sm font-semibold text-blue-900 mb-2">Generated Name Preview</p>
        <div className="flex items-center gap-3">
          <code className="flex-1 text-lg font-mono font-bold text-blue-900 bg-white px-4 py-3 rounded border border-blue-200">
            {generatedName}
          </code>
          <button
            onClick={handleCopy}
            className={`px-4 py-3 rounded-lg font-semibold transition flex items-center gap-2 ${
              copied
                ? "bg-green-600 text-white"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {copied ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy
              </>
            )}
          </button>
        </div>
        <p className="text-xs text-blue-800 mt-2">
          Separator: <code className="bg-white px-2 py-1 rounded">{activeConvention.separator}</code>
        </p>
      </div>
    </div>
  );
}
