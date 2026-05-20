interface HealthScoreCardProps {
  title: string;
  score: number;
  status?: string;
  lastUpdated?: Date;
  trend?: number;
  size?: "small" | "large";
}

export default function HealthScoreCard({
  title,
  score,
  lastUpdated,
  trend,
  size = "large",
}: HealthScoreCardProps) {
  const getColor = (score: number) => {
    if (score >= 80) return "from-green-600 to-green-700";
    if (score >= 60) return "from-yellow-600 to-yellow-700";
    return "from-red-600 to-red-700";
  };

  const getStatusText = (score: number) => {
    if (score >= 80) return "Healthy";
    if (score >= 60) return "Moderate";
    return "Critical";
  };

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden ${
        size === "large" ? "p-6" : "p-4"
      }`}
    >
      <h3 className="text-gray-700 font-semibold mb-4">{title}</h3>

      <div className={`flex items-end gap-4 ${size === "small" ? "flex-col" : ""}`}>
        <div
          className={`bg-gradient-to-br ${getColor(
            score
          )} rounded-lg flex items-center justify-center text-white font-bold ${
            size === "large"
              ? "w-24 h-24 text-5xl"
              : "w-20 h-20 text-4xl"
          }`}
        >
          {score}
        </div>

        <div className="flex-1">
          <div className={`text-xl font-bold mb-1`}>
            <span
              className={`${
                score >= 80
                  ? "text-green-600"
                  : score >= 60
                  ? "text-yellow-600"
                  : "text-red-600"
              }`}
            >
              {getStatusText(score)}
            </span>
          </div>

          {trend !== undefined && (
            <div className={`text-sm font-semibold ${trend >= 0 ? "text-green-600" : "text-red-600"}`}>
              {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}% vs last period
            </div>
          )}

          {lastUpdated && (
            <div className="text-xs text-gray-500 mt-2">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
