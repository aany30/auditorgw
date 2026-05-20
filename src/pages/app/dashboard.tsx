import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "next/router";
import OverviewTab from "@/components/dashboard/OverviewTab";
import PixelHealthTab from "@/components/dashboard/PixelHealthTab";
import EventQualityTab from "@/components/dashboard/EventQualityTab";
import FunnelAuditTab from "@/components/dashboard/FunnelAuditTab";
import AttributionTab from "@/components/dashboard/AttributionTab";
import RecommendationsTab from "@/components/dashboard/RecommendationsTab";
import AlertCenterTab from "@/components/dashboard/AlertCenterTab";
import ActivityTab from "@/components/dashboard/ActivityTab";

const TABS = [
  { id: "overview", label: "Overview", icon: "📊" },
  { id: "pixel-health", label: "Pixel Health", icon: "🔴" },
  { id: "event-quality", label: "Event Quality", icon: "📈" },
  { id: "funnel", label: "Funnel Audit", icon: "🎯" },
  { id: "attribution", label: "Attribution", icon: "⚙️" },
  { id: "recommendations", label: "AI Recommendations", icon: "🤖" },
  { id: "alerts", label: "Alert Center", icon: "⚠️" },
  { id: "activity", label: "Real-time Activity", icon: "⚡" },
];

export default function Dashboard() {
  const router = useRouter();
  const { isMetaConnected, isGoogleConnected, clearAllCredentials } = useAuthStore();
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [platform, setPlatform] = useState<"meta" | "google" | "both">("both");
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "custom">("30d");

  // Redirect to landing if not authenticated
  useEffect(() => {
    if (!isMetaConnected() && !isGoogleConnected()) {
      router.push("/");
    }
  }, [isMetaConnected, isGoogleConnected, router]);

  const handleLogout = () => {
    clearAllCredentials();
    router.push("/");
  };

  const renderTabContent = () => {
    const props = { platform, dateRange };
    switch (activeTab) {
      case "overview":
        return <OverviewTab {...props} />;
      case "pixel-health":
        return <PixelHealthTab />;
      case "event-quality":
        return <EventQualityTab />;
      case "funnel":
        return <FunnelAuditTab />;
      case "attribution":
        return <AttributionTab />;
      case "recommendations":
        return <RecommendationsTab />;
      case "alerts":
        return <AlertCenterTab />;
      case "activity":
        return <ActivityTab />;
      default:
        return <OverviewTab {...props} />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="text-2xl font-bold">
              📊 <span className="bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
                Auditor
              </span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Platform Toggle */}
            <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setPlatform("meta")}
                className={`px-3 py-1 rounded text-sm font-semibold transition ${
                  platform === "meta"
                    ? "bg-blue-600 text-white"
                    : "text-gray-700 hover:bg-white"
                }`}
              >
                Meta
              </button>
              <button
                onClick={() => setPlatform("google")}
                className={`px-3 py-1 rounded text-sm font-semibold transition ${
                  platform === "google"
                    ? "bg-blue-600 text-white"
                    : "text-gray-700 hover:bg-white"
                }`}
              >
                Google
              </button>
              <button
                onClick={() => setPlatform("both")}
                className={`px-3 py-1 rounded text-sm font-semibold transition ${
                  platform === "both"
                    ? "bg-blue-600 text-white"
                    : "text-gray-700 hover:bg-white"
                }`}
              >
                Both
              </button>
            </div>

            {/* Date Range Selector */}
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 bg-white hover:border-gray-400"
            >
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="custom">Custom Range</option>
            </select>

            {/* User Menu */}
            <div className="flex items-center gap-3 pl-6 border-l border-gray-200">
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex h-[calc(100vh-80px)]">
        {/* Sidebar Tabs */}
        <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
          <nav className="space-y-1 p-4">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full text-left px-4 py-3 rounded-lg font-semibold transition flex items-center gap-3 ${
                  activeTab === tab.id
                    ? "bg-blue-600 text-white"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                <span className="text-lg">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto bg-gray-50">
          <div className="p-8">{renderTabContent()}</div>
        </main>
      </div>
    </div>
  );
}
