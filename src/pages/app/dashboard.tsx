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
import AccountStructureTab from "@/components/dashboard/AccountStructureTab";
import AudienceAuditTab from "@/components/dashboard/AudienceAuditTab";
import CreativeAuditTab from "@/components/dashboard/CreativeAuditTab";
import PlatformAuditTab from "@/components/dashboard/PlatformAuditTab";
import TrackingOverview from "@/components/dashboard/TrackingOverview";
import CampaignOverview from "@/components/dashboard/CampaignOverview";
import InsightsOverview from "@/components/dashboard/InsightsOverview";
import AccountSelector from "@/components/dashboard/AccountSelector";
import CampaignObjectiveFilter from "@/components/dashboard/CampaignObjectiveFilter";
import PlatformFilter, { PlatformValue, toLegacyPlatform } from "@/components/dashboard/PlatformFilter";
import DateRangePicker, { DateRange } from "@/components/shared/DateRangePicker";
import {
  BarChart3,
  Activity,
  TrendingUp,
  Target,
  Settings2,
  Bot,
  AlertTriangle,
  LogOut,
  LayoutDashboard,
  Layers,
  Users,
  Image as ImageIcon,
  Globe,
  Radio,
  Briefcase,
  Lightbulb,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface SubTab {
  id: string;
  label: string;
  Icon: LucideIcon;
}

interface NavGroup {
  id: string;
  label: string;
  Icon: LucideIcon;
  children?: SubTab[];
}

const NAV: NavGroup[] = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  {
    id: "tracking",
    label: "Tracking",
    Icon: Radio,
    children: [
      { id: "pixel-health", label: "Pixel Health", Icon: Activity },
      { id: "event-quality", label: "Event Quality", Icon: TrendingUp },
      { id: "funnel", label: "Funnel Audit", Icon: Target },
      { id: "attribution", label: "Attribution", Icon: Settings2 },
    ],
  },
  {
    id: "campaign",
    label: "Campaign",
    Icon: Briefcase,
    children: [
      { id: "account-structure", label: "Account Structure", Icon: Layers },
      { id: "audience-audit", label: "Audience Audit", Icon: Users },
      { id: "creative-audit", label: "Creative Audit", Icon: ImageIcon },
      { id: "platform-audit", label: "Platform Audit", Icon: Globe },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    Icon: Lightbulb,
    children: [
      { id: "recommendations", label: "AI Recommendations", Icon: Bot },
      { id: "alerts", label: "Alert Center", Icon: AlertTriangle },
    ],
  },
];

export default function Dashboard() {
  const router = useRouter();
  const {
    isMetaConnected,
    isGoogleConnected,
    clearAllCredentials,
    setMetaCredentials,
    setMetaPixelList,
    setGoogleCredentials,
    setGoogleAccountsList,
  } = useAuthStore();
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [platformFilter, setPlatformFilter] = useState<PlatformValue>("all");
  const platform = toLegacyPlatform(platformFilter);
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [customStart, setCustomStart] = useState<string | undefined>();
  const [customEnd, setCustomEnd] = useState<string | undefined>();
  const [selectedObjectives, setSelectedObjectives] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["tracking", "campaign", "insights"]));
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle OAuth redirects
  useEffect(() => {
    if (!router.isReady) return;

    const {
      meta_token,
      business_id,
      pixel_ids,
      pixel_names,
      google_token,
      customer_id,
      property_id,
      container_id,
    } = router.query;

    // Handle Meta OAuth
    if (meta_token && business_id && pixel_ids) {
      const pixelIdArray = (pixel_ids as string).split(",");
      const nameArray = pixel_names ? (pixel_names as string).split("|") : pixelIdArray;

      setMetaCredentials(
        meta_token as string,
        business_id as string,
        pixelIdArray
      );

      const pixelList = pixelIdArray.map((id, idx) => ({
        id: id.trim(),
        name: nameArray[idx] || `Pixel ${id.trim()}`,
      }));

      setMetaPixelList(pixelList);

      // Clean up URL
      router.replace("/app/dashboard");
    }

    // Handle Google OAuth
    if (google_token && customer_id) {
      setGoogleCredentials(
        google_token as string,
        customer_id as string,
        property_id as string || "",
        container_id as string || ""
      );

      const accounts = [
        {
          customerId: customer_id as string,
          name: "Google Account",
          properties: property_id
            ? [{ id: property_id as string, name: "GA4 Property" }]
            : [],
          containers: container_id
            ? [{ id: container_id as string, name: "GTM Container" }]
            : [],
        },
      ];

      setGoogleAccountsList(accounts);

      // Clean up URL
      router.replace("/app/dashboard");
    }
  }, [router.isReady, router.query, setMetaCredentials, setMetaPixelList, setGoogleCredentials, setGoogleAccountsList, router]);

  useEffect(() => {
    if (mounted && !isMetaConnected() && !isGoogleConnected()) {
      router.push("/");
    }
  }, [mounted, isMetaConnected, isGoogleConnected, router]);

  const handleLogout = () => {
    clearAllCredentials();
    router.push("/");
  };

  const handleDateChange = (range: DateRange, start?: string, end?: string) => {
    setDateRange(range);
    setCustomStart(start);
    setCustomEnd(end);
  };

  const renderTabContent = () => {
    const props = { platform, dateRange, customStart, customEnd };
    const audit = { ...props, selectedObjectives, setActiveTab };
    switch (activeTab) {
      case "overview":
        return <OverviewTab {...props} setActiveTab={setActiveTab} />;
      case "tracking":
        return <TrackingOverview {...props} setActiveTab={setActiveTab} />;
      case "campaign":
        return <CampaignOverview platform={platform} setActiveTab={setActiveTab} />;
      case "insights":
        return <InsightsOverview {...props} setActiveTab={setActiveTab} />;
      case "pixel-health":
        return <PixelHealthTab {...props} />;
      case "event-quality":
        return <EventQualityTab {...props} />;
      case "funnel":
        return <FunnelAuditTab />;
      case "attribution":
        return <AttributionTab />;
      case "recommendations":
        return <RecommendationsTab {...props} />;
      case "alerts":
        return <AlertCenterTab />;
      case "account-structure":
        return <AccountStructureTab {...audit} />;
      case "audience-audit":
        return <AudienceAuditTab {...audit} />;
      case "creative-audit":
        return <CreativeAuditTab {...audit} />;
      case "platform-audit":
        return <PlatformAuditTab {...audit} />;
      default:
        return <OverviewTab {...props} setActiveTab={setActiveTab} />;
    }
  };

  const handleGroupClick = (groupId: string, hasChildren: boolean) => {
    setActiveTab(groupId);
    if (hasChildren) {
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        next.add(groupId);
        return next;
      });
    }
  };

  const toggleGroup = (e: React.MouseEvent, groupId: string) => {
    e.stopPropagation();
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center gap-4">
          {/* Left: Logo + Filters (Platform · Objectives · Calendar) */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3 pr-4 border-r border-gray-200">
              <BarChart3 className="w-7 h-7 text-blue-600" strokeWidth={2.5} />
              <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
                Auditor
              </span>
            </div>

            {/* Platform Filter Dropdown */}
            <PlatformFilter value={platformFilter} onChange={setPlatformFilter} />

            {/* Campaign Objective Filter */}
            <CampaignObjectiveFilter
              selected={selectedObjectives}
              onChange={setSelectedObjectives}
            />

            {/* Date Range Picker */}
            <DateRangePicker
              range={dateRange}
              startDate={customStart}
              endDate={customEnd}
              onChange={handleDateChange}
            />
          </div>

          {/* Right: Account Selector + Logout */}
          <div className="flex items-center gap-3">
            <AccountSelector />

            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </nav>

      <div className="flex h-[calc(100vh-80px)]">
        <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
          <nav className="space-y-1 p-4">
            {NAV.map((group) => {
              const hasChildren = !!group.children?.length;
              const isExpanded = expandedGroups.has(group.id);
              const isActiveGroup = activeTab === group.id;
              const isActiveChild = hasChildren && group.children!.some((c) => c.id === activeTab);

              return (
                <div key={group.id}>
                  <button
                    onClick={() => handleGroupClick(group.id, hasChildren)}
                    className={`w-full text-left px-4 py-3 rounded-lg font-semibold transition flex items-center gap-3 text-sm ${
                      isActiveGroup
                        ? "bg-blue-600 text-white"
                        : isActiveChild
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <group.Icon className="w-5 h-5" />
                    <span className="flex-1">{group.label}</span>
                    {hasChildren && (
                      <span
                        onClick={(e) => toggleGroup(e, group.id)}
                        className="p-0.5 rounded hover:bg-black/10 cursor-pointer"
                        role="button"
                        aria-label={isExpanded ? "Collapse" : "Expand"}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </span>
                    )}
                  </button>

                  {hasChildren && isExpanded && (
                    <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-gray-200 pl-2">
                      {group.children!.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => setActiveTab(child.id)}
                          className={`w-full text-left px-3 py-2 rounded-md font-medium transition flex items-center gap-2 text-sm ${
                            activeTab === child.id
                              ? "bg-blue-100 text-blue-700 font-semibold"
                              : "text-gray-600 hover:bg-gray-100"
                          }`}
                        >
                          <child.Icon className="w-4 h-4" />
                          <span>{child.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto bg-gray-50">
          <div className="p-8">{renderTabContent()}</div>
        </main>
      </div>

    </div>
  );
}
