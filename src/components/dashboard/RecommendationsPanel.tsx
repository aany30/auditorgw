import { Recommendation } from "@/types";

interface RecommendationsPanelProps {
  recommendations: Recommendation[];
}

const priorityColors = {
  critical: "border-l-red-500 bg-red-50",
  high: "border-l-orange-500 bg-orange-50",
  medium: "border-l-yellow-500 bg-yellow-50",
  low: "border-l-blue-500 bg-blue-50",
};

const priorityIcons = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
};

const effortColors = {
  quick: "text-green-600 bg-green-100",
  medium: "text-yellow-600 bg-yellow-100",
  complex: "text-red-600 bg-red-100",
};

export default function RecommendationsPanel({ recommendations }: RecommendationsPanelProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="p-6 border-b border-gray-200">
        <h2 className="text-lg font-bold text-gray-900">AI Recommendations</h2>
        <p className="text-sm text-gray-600 mt-1">Prioritized fixes by impact</p>
      </div>

      <div className="divide-y divide-gray-100">
        {recommendations.map((rec) => (
          <div
            key={rec.id}
            className={`p-4 border-l-4 ${priorityColors[rec.priority]}`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-start gap-3 flex-1">
                <span className="text-xl">{priorityIcons[rec.priority]}</span>
                <div>
                  <h3 className="font-semibold text-gray-900">{rec.issue}</h3>
                  <p className="text-xs text-gray-600 mt-1">{rec.action}</p>
                </div>
              </div>
              <span className="text-lg font-bold text-green-600">+{rec.impact}%</span>
            </div>

            <div className="flex items-center justify-between mt-3">
              <span
                className={`text-xs font-semibold px-2 py-1 rounded ${
                  effortColors[rec.effort]
                }`}
              >
                {rec.effort.charAt(0).toUpperCase() + rec.effort.slice(1)} Fix
              </span>
              <button className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                Learn More →
              </button>
            </div>
          </div>
        ))}
      </div>

      {recommendations.length === 0 && (
        <div className="p-8 text-center text-gray-500">
          <p>No recommendations at this time. Great work! 🎉</p>
        </div>
      )}
    </div>
  );
}
