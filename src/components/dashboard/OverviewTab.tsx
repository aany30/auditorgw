import { useEffect } from "react";
import HealthScoreCard from "./HealthScoreCard";
import AuditIssuesTable from "../tables/AuditIssuesTable";
import RecommendationsPanel from "./RecommendationsPanel";
import { useAuthStore } from "@/store/auth";

interface OverviewTabProps {
  platform: "meta" | "google" | "both";
  dateRange: string;
}

export default function OverviewTab({ platform, dateRange }: OverviewTabProps) {
  const { isMetaConnected, isGoogleConnected } = useAuthStore();

  useEffect(() => {
    // Simulate data loading
    const timer = setTimeout(() => {}, 1000);
    return () => clearTimeout(timer);
  }, [platform, dateRange]);

  // Mock data - in production, these would come from API calls
  const metaHealthScore = 78;
  const googleHealthScore = 85;
  const funnelHealthScore = 72;
  const attributionScore = 81;

  const issues = [
    {
      id: "1",
      title: "Duplicate Event Firing",
      description: "Pixel is firing events twice for some users",
      severity: "high" as const,
      status: "needs_fix" as const,
      estimatedImpact: 8,
      recommendation: "Enable deduplication in Event Manager",
      createdAt: new Date(),
    },
    {
      id: "2",
      title: "Low Email Hash Quality",
      description: "Email hash matching below benchmark",
      severity: "medium" as const,
      status: "in_progress" as const,
      estimatedImpact: 5,
      recommendation: "Improve email data collection and validation",
      createdAt: new Date(),
    },
    {
      id: "3",
      title: "Missing Event Parameters",
      description: "Some conversion events missing value parameter",
      severity: "high" as const,
      status: "needs_fix" as const,
      estimatedImpact: 6,
      recommendation: "Update event tracking implementation",
      createdAt: new Date(),
    },
  ];

  const recommendations = [
    {
      id: "1",
      priority: "critical" as const,
      issue: "Fix pixel deduplication",
      impact: 8,
      action: "Update Event Manager settings",
      effort: "quick" as const,
    },
    {
      id: "2",
      priority: "high" as const,
      issue: "Implement phone hash parameter",
      impact: 5,
      action: "Add phone field to pixel base code",
      effort: "medium" as const,
    },
    {
      id: "3",
      priority: "medium" as const,
      issue: "Enable consent mode",
      impact: 3,
      action: "Configure consent mode in GTM",
      effort: "medium" as const,
    },
  ];

  if (!isMetaConnected() && !isGoogleConnected()) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">No accounts connected. Please connect Meta or Google accounts first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Dashboard Overview</h1>
        <p className="text-gray-600">Real-time tracking health and recommendations</p>
      </div>

      {/* Health Score Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {isMetaConnected() && (
          <HealthScoreCard
            title="Meta Health"
            score={metaHealthScore}
            trend={5}
            lastUpdated={new Date()}
          />
        )}
        {isGoogleConnected() && (
          <HealthScoreCard
            title="Google Health"
            score={googleHealthScore}
            trend={3}
            lastUpdated={new Date()}
          />
        )}
        <HealthScoreCard
          title="Funnel Health"
          score={funnelHealthScore}
          trend={-2}
          lastUpdated={new Date()}
        />
        <HealthScoreCard
          title="Attribution Score"
          score={attributionScore}
          trend={2}
          lastUpdated={new Date()}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Issues Table */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Top Issues</h2>
              <p className="text-sm text-gray-600 mt-1">Issues requiring attention, sorted by severity</p>
            </div>
            <AuditIssuesTable issues={issues} />
          </div>
        </div>

        {/* Recommendations */}
        <div>
          <RecommendationsPanel recommendations={recommendations} />
        </div>
      </div>

      {/* Status Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-sm text-gray-600 mb-1">Data Freshness</div>
          <div className="text-2xl font-bold text-green-600">✓ Current</div>
          <p className="text-xs text-gray-500 mt-2">Last synced 2 minutes ago</p>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-sm text-gray-600 mb-1">API Health</div>
          <div className="text-2xl font-bold text-green-600">✓ Operational</div>
          <p className="text-xs text-gray-500 mt-2">All connections stable</p>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="text-sm text-gray-600 mb-1">Events (Today)</div>
          <div className="text-2xl font-bold text-gray-900">2.4M</div>
          <p className="text-xs text-gray-500 mt-2">↑ 12% vs yesterday</p>
        </div>
      </div>
    </div>
  );
}
