import { useState, useEffect, useMemo } from "react";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "next/router";
import PixelHealthTab from "@/components/dashboard/PixelHealthTab";
import EventQualityTab from "@/components/dashboard/EventQualityTab";
import FunnelAuditTab from "@/components/dashboard/FunnelAuditTab";
import AttributionTab from "@/components/dashboard/AttributionTab";
import FloodlightHealthTab from "@/components/dashboard/FloodlightHealthTab";
import RecommendationsTab from "@/components/dashboard/RecommendationsTab";
import AccountStructureTab from "@/components/dashboard/AccountStructureTab";
import AudienceOverlapTab from "@/components/dashboard/tabs/AudienceOverlapTab";
import AudiencePerformanceTab from "@/components/dashboard/tabs/AudiencePerformanceTab";
import AudienceQualityTab from "@/components/dashboard/tabs/AudienceQualityTab";
import AudienceSaturationTab from "@/components/dashboard/tabs/AudienceSaturationTab";
import ConversionMonitoringTab from "@/components/dashboard/tabs/ConversionMonitoringTab";
import CampaignOverview from "@/components/dashboard/CampaignOverview";
import ReportingOverview from "@/components/dashboard/reports/ReportingOverview";
import KeyMetricAnalysisReport from "@/components/dashboard/reports/KeyMetricAnalysisReport";
import AudienceAnalysisReport from "@/components/dashboard/reports/AudienceAnalysisReport";
import CreativeReport from "@/components/dashboard/reports/CreativeReport";
import PlacementReport from "@/components/dashboard/reports/PlacementReport";
import AttributionReport from "@/components/dashboard/reports/AttributionReport";
import PlanningReport from "@/components/dashboard/reports/PlanningReport";
import ExportReport from "@/components/dashboard/reports/ExportReport";
import GenerateReport from "@/components/dashboard/reports/GenerateReport";
import DashboardReport from "@/components/dashboard/reports/DashboardReport";
import AskAITab from "@/components/dashboard/tabs/AskAITab";
import MediaAdsLibraryTab from "@/components/dashboard/MediaAdsLibraryTab";
import ScanHistoryTab from "@/components/dashboard/ScanHistoryTab";
import ChangeLogPanel from "@/components/apply/ChangeLogPanel";
import CreateCampaignTab from "@/components/dashboard/create-campaign/CreateCampaignTab";
import {
  ResearchChatTab,
  AgentReadyTab,
  AplusContentTab,
  InstaGridTab,
  VibeCloneTab,
  VibeMatchTab,
  PersonasTab,
  UGCAdsTab,
  UGCNewTab,
  UGCPlaygroundTab,
  MicroDramaTab,
  VideoAdsTab,
  LuxeAdsTab,
  VibeCloneUGCTab,
  TalkingAvatarTab,
  CharacterReelTab,
  VoiceCloneTab,
  CreativesHistoryTab,
} from "@/components/dashboard/AdLibraryTabs";
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
  LogOut,
  Layers,
  Users,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  Mail,
  Check,
  FileText,
  BarChart2,
  Star,
  Zap,
  Search,
  Megaphone,
  Sparkles,
  Image as ImageIcon,
  Map as MapIcon,
  GitBranch,
  Download,
  ShieldCheck,
  Monitor,
  LineChart,
  Briefcase,
  Flame,
  BookOpen,
  History,
  Grid3x3,
  Copy,
  Palette,
  Clapperboard,
  Film,
  Wand2,
  Speech,
  Gem,
  Mic,
  Drama,
  LayoutPanelTop,
  UserSquare,
  FlaskConical,
  MessagesSquare,
  Images,
  PlusCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface SubTab {
  id: string;
  label: string;
  Icon: LucideIcon;
  /** Platforms this tab has meaningful data for. Absent = all. */
  platforms?: Array<"meta" | "dv360" | "google_ads" | "snapchat">;
}

interface NavGroup {
  id: string;
  label: string;
  Icon: LucideIcon;
  children?: SubTab[];
}

// `platforms` tags which platforms a tab actually shows data for. When the
// selected platform is DV360, tabs marked ["meta"] are hidden so the user
// doesn't hit empty "N/A for DV360" states — and vice versa.
const NAV: NavGroup[] = [
  {
    id: "audit",
    label: "Audit",
    Icon: ShieldCheck,
    children: [
      { id: "pixel-health",  label: "Pixel Health",       Icon: Activity,   platforms: ["meta"] },
      { id: "event-quality", label: "Event Quality",      Icon: TrendingUp, platforms: ["meta"] },
      { id: "funnel",        label: "Funnel Audit",       Icon: Target,     platforms: ["meta"] },
      { id: "attribution",   label: "Attribution Audit",  Icon: Settings2   },
      { id: "aud-overlap",   label: "Audience Overlap",   Icon: Users,      platforms: ["meta"] },
      { id: "floodlight",    label: "Floodlight",         Icon: Flame,      platforms: ["dv360"] },
    ],
  },
  {
    id: "tracking",
    label: "Tracking",
    Icon: Monitor,
    children: [
      { id: "account-structure",      label: "Account Structure",      Icon: Layers,   platforms: ["meta", "dv360", "google_ads", "snapchat"] },
      { id: "aud-performance",        label: "Audience Performance",   Icon: BarChart2, platforms: ["meta"] },
      { id: "aud-saturation",         label: "Saturation",             Icon: Zap,      platforms: ["meta", "dv360"] },
      { id: "conversion-monitoring",  label: "Conversion Monitoring",  Icon: LineChart, platforms: ["meta", "dv360", "google_ads", "snapchat"] },
      { id: "create-campaign",        label: "Create Campaign",        Icon: PlusCircle },
    ],
  },
  {
    id: "reporting",
    label: "Reporting",
    Icon: FileText,
    children: [
      { id: "rep-dashboard",   label: "Dashboard",           Icon: BarChart2 },
      { id: "rep-overview",    label: "Overview",            Icon: BarChart3 },
      { id: "rep-key-metric",  label: "Key Metrics",         Icon: Megaphone },
      { id: "rep-audience",    label: "Audience Analysis",   Icon: Sparkles  },
      { id: "rep-creative",    label: "Creative Analysis",   Icon: ImageIcon },
      { id: "rep-placement",   label: "Placement Analysis",  Icon: MapIcon,    platforms: ["meta"] },
      { id: "rep-attribution", label: "Attribution Report",  Icon: GitBranch,  platforms: ["meta"] },
      // Planning merged into Dashboard
      { id: "rep-generate",    label: "Generate Report",     Icon: Download  },
    ],
  },
  {
    id: "ad-library",
    label: "Ad Library",
    Icon: BookOpen,
    children: [
      { id: "media-ads-lib",    label: "Product Intelligence", Icon: Search },
      { id: "research-chat",    label: "Research Chat",        Icon: MessagesSquare },
      { id: "agent-ready",      label: "Agent Ready",          Icon: Bot },
      { id: "aplus-content",    label: "A+ Content",           Icon: LayoutPanelTop },
      { id: "insta-grid",       label: "Insta Grid",           Icon: Grid3x3 },
      { id: "vibe-clone",       label: "Vibe Clone",           Icon: Copy },
      { id: "vibe-match",       label: "Vibe Match",           Icon: Palette },
      { id: "personas",         label: "Personas",             Icon: Users },
      { id: "ugc-ads",          label: "UGC Ads",              Icon: Clapperboard },
      { id: "ugc-new",          label: "UGC New",              Icon: Sparkles },
      { id: "ugc-playground",   label: "UGC Playground",       Icon: FlaskConical },
      { id: "micro-drama",      label: "Micro Drama",          Icon: Drama },
      { id: "video-ads",        label: "Video Ads",            Icon: Film },
      { id: "luxe-ads",         label: "Luxe Ads",             Icon: Gem },
      { id: "vibe-clone-ugc",   label: "Vibe Clone UGC",       Icon: Wand2 },
      { id: "talking-avatar",   label: "Talking Avatar",       Icon: Speech },
      { id: "character-reel",   label: "Character Reel",       Icon: UserSquare },
      { id: "voice-clone",      label: "Voice Clone",          Icon: Mic },
      { id: "scan-history",     label: "Scan History",         Icon: History },
      { id: "creatives-history", label: "Creatives",           Icon: Images },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    Icon: Lightbulb,
    children: [
      { id: "recommendations", label: "AI Recommendations", Icon: Bot },
      { id: "ask-ai",          label: "Ask AI",             Icon: Sparkles  },
      { id: "change-log",      label: "Change Log",         Icon: History   },
    ],
  },
];

/** True when the tab has meaningful data for the selected platform. */
function isTabVisible(tab: SubTab, platform: "meta" | "dv360" | "google_ads" | "snapchat" | "both"): boolean {
  if (!tab.platforms) return true;         // no restriction = all
  if (platform === "both") return true;    // "All" shows everything
  return tab.platforms.includes(platform);
}

export default function Dashboard() {
  const router = useRouter();
  const {
    isMetaConnected,
    isDV360Connected,
    dv360RefreshToken,
    dv360AdvertiserId,
    metaBusinessId,
    clearAllCredentials,
    clearMetaCredentials,
    clearDV360Credentials,
    clearGoogleAdsCredentials,
    clearSnapchatCredentials,
    googleAdsCustomerId,
    snapchatAdAccountId,
    snapchatRefreshToken,
    setMetaCredentials,
    setMetaPixelList,
    setDV360Credentials,
    setGoogleAdsCredentials,
    setSnapchatCredentials,
    isGoogleAdsConnected,
    isSnapchatConnected,
    setDv360AdvertiserOptions: persistDv360Options,
    totalAiCreditsUsd,
    alertEmail,
    loginEmail,
    setAlertEmail,
    setLoginEmail,
    demoMode,
    enterDemoMode,
    exitDemoMode,
  } = useAuthStore();
  const [emailPopoverOpen, setEmailPopoverOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState(alertEmail || "");
  const [emailSavedFlash, setEmailSavedFlash] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("pixel-health");
  const [platformFilter, setPlatformFilter] = useState<PlatformValue>("all");
  const platform = toLegacyPlatform(platformFilter);
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [customStart, setCustomStart] = useState<string | undefined>();
  const [customEnd, setCustomEnd] = useState<string | undefined>();
  const [selectedObjectives, setSelectedObjectives] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["audit", "tracking", "reporting", "ad-library", "insights"]));
  const [mounted, setMounted] = useState(false);
  const [gadsResolving, setGadsResolving] = useState(false);
  const [gadsResolveError, setGadsResolveError] = useState<string | null>(null);

  // Resolve a pasted Google Ads ID into a usable leaf (client) account.
  // The ID may be a manager (MCC) that holds no metrics — query customer_client
  // to list the real ad accounts underneath, then pick one (or auto-pick if
  // there's exactly one).
  const resolveGoogleAdsAccount = async (enteredId: string) => {
    const s = useAuthStore.getState();
    setGadsResolving(true);
    setGadsResolveError(null);
    try {
      const r = await fetch("/api/google-ads/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: s.dv360ClientId || undefined,
          clientSecret: s.dv360ClientSecret || undefined,
          refreshToken: s.dv360RefreshToken || undefined,
          customerId: enteredId,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      const { accounts } = (await r.json()) as {
        accounts: { id: string; name: string; isManager: boolean; level: number }[];
      };
      const leaves = accounts.filter((a) => !a.isManager);
      const enteredIsLeaf = leaves.some((a) => a.id === enteredId);

      if (enteredIsLeaf) {
        // The entered ID is itself a leaf account — use it directly.
        setGoogleAdsCredentials({ customerId: enteredId });
      } else if (leaves.length === 1) {
        // Manager with a single client account — auto-select it.
        setGoogleAdsCredentials({ customerId: leaves[0].id, loginCustomerId: enteredId });
      } else if (leaves.length > 1) {
        // Manager with several client accounts — let the user choose. Each pick
        // carries the manager as its login-customer-id.
        const resolved = leaves.map((a) => ({ id: a.id, name: a.name, loginCustomerId: enteredId }));
        // Merge resolved leaves into existing options, replacing the MCC entry.
        const existing = useAuthStore.getState().gadsCustomerOptions.filter((o) => o.id !== enteredId);
        useAuthStore.getState().setGadsCustomerOptions([...existing, ...resolved]);
      } else {
        throw new Error("No ad accounts found under this ID.");
      }
    } catch (e) {
      setGadsResolveError(e instanceof Error ? e.message : "Could not resolve account.");
    } finally {
      setGadsResolving(false);
    }
  };

  // Zustand-persist hydration gate.
  //
  // On the production build, `persist` finishes reading localStorage AFTER the
  // OAuth effect below fires — timing depends on bundle size (auditorgw's
  // smaller build won the race, fkdashboard's larger build loses it). Writing
  // credentials before hydration means the write lands on the store's empty
  // init state, and persist then flushes that back to localStorage — erasing
  // whichever platform was already connected. Symptom: connect DV360 second,
  // Meta's token disappears.
  //
  // Defaults to `true` if the persist API is somehow missing, so we can never
  // permanently block the OAuth handler.
  const [hydrated, setHydrated] = useState<boolean>(
    () => useAuthStore.persist?.hasHydrated?.() ?? true
  );
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[auth-fix v2] hydration gate armed");
    const unsub = useAuthStore.persist?.onFinishHydration?.(() => {
      // eslint-disable-next-line no-console
      console.log("[auth-fix v2] persist finished hydrating");
      setHydrated(true);
    });
    if (useAuthStore.persist?.hasHydrated?.()) {
      // eslint-disable-next-line no-console
      console.log("[auth-fix v2] persist already hydrated on mount");
      setHydrated(true);
    }
    return () => unsub?.();
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  // NAV filtered to tabs that have real data for the currently-selected
  // platform — groups whose children all get hidden are dropped too.
  const visibleNav = useMemo(() => {
    return NAV
      .map((g) => ({ ...g, children: g.children?.filter((c) => isTabVisible(c, platform)) }))
      .filter((g) => !g.children || g.children.length > 0);
  }, [platform]);

  // If the currently-active tab isn't visible for the selected platform,
  // jump to the first visible tab so the user isn't stuck on a hidden view.
  useEffect(() => {
    const allVisibleIds = visibleNav.flatMap((g) => g.children?.map((c) => c.id) ?? [g.id]);
    if (!allVisibleIds.includes(activeTab)) {
      const first = allVisibleIds[0];
      if (first) setActiveTab(first);
    }
  }, [platform, visibleNav, activeTab]);

  // Handle OAuth redirects. Waits for hydration (see gate above) so the
  // incoming platform's credentials merge onto the stored ones instead of
  // stomping empty init state through persist.
  useEffect(() => {
    if (!router.isReady || !hydrated) return;

    const {
      meta_token,
      business_id,
      pixel_ids,
      pixel_names,
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
      router.replace("/app/dashboard");
    }

    // Handle DV360 OAuth
    const {
      dv360_refresh,
      dv360_client_id,
      dv360_client_secret,
      dv360_adv_ids,
      dv360_adv_names,
      login_email,
    } = router.query;

    // Capture the Google sign-in email so alerts default to it (no manual entry).
    if (login_email) setLoginEmail(login_email as string);

    const { dv360_partner_id } = router.query;
    if (dv360_refresh && dv360_client_id && dv360_client_secret) {
      const advIds = dv360_adv_ids ? (dv360_adv_ids as string).split(",") : [];
      const advNames = dv360_adv_names ? (dv360_adv_names as string).split("|") : [];

      if (advIds.length > 0) {
        // Store first advertiser; if multiple, user picks via DV360AdvertiserPicker
        setDV360Credentials({
          clientId: dv360_client_id as string,
          clientSecret: dv360_client_secret as string,
          refreshToken: dv360_refresh as string,
          advertiserId: advIds[0],
          partnerId: (dv360_partner_id as string) || undefined,
        });

        const opts = advIds.map((id, i) => ({ id, name: advNames[i] || id }));
        persistDv360Options(opts);
      } else {
        // No advertisers found — save creds without advertiser ID, user pastes manually
        setDV360Credentials({
          clientId: dv360_client_id as string,
          clientSecret: dv360_client_secret as string,
          refreshToken: dv360_refresh as string,
          advertiserId: "",
          partnerId: (dv360_partner_id as string) || undefined,
        });
      }

      router.replace("/app/dashboard");
    }

    // Handle Google Ads customer IDs from OAuth callback
    const { gads_customer_ids, gads_customer_names } = router.query;
    if (gads_customer_ids && dv360_refresh) {
      const gadsIds = (gads_customer_ids as string).split(",");
      const gadsNames = gads_customer_names ? (gads_customer_names as string).split("|") : gadsIds;
      const gadsOpts = gadsIds.map((id, i) => ({ id, name: gadsNames[i] || id }));
      useAuthStore.getState().setGadsCustomerOptions(gadsOpts);
      if (gadsIds.length === 1) {
        resolveGoogleAdsAccount(gadsIds[0]);
      }
    }

    // Handle Snapchat OAuth callback
    const { snap_refresh, snap_client_id, snap_client_secret, snap_org_id, snap_ad_account_ids, snap_ad_account_names } = router.query;
    if (snap_refresh && snap_client_id && snap_client_secret) {
      const adAccountIds = snap_ad_account_ids ? (snap_ad_account_ids as string).split(",") : [];
      const adAccountNames = snap_ad_account_names ? (snap_ad_account_names as string).split("|") : adAccountIds;
      if (adAccountIds.length > 0) {
        setSnapchatCredentials({
          clientId: snap_client_id as string,
          clientSecret: snap_client_secret as string,
          refreshToken: snap_refresh as string,
          adAccountId: adAccountIds[0],
          orgId: (snap_org_id as string) || undefined,
        });
        const snapOpts = adAccountIds.map((id, i) => ({ id, name: adAccountNames[i] || id }));
        useAuthStore.getState().setSnapAdAccountOptions(snapOpts);
      } else {
        setSnapchatCredentials({
          clientId: snap_client_id as string,
          clientSecret: snap_client_secret as string,
          refreshToken: snap_refresh as string,
          adAccountId: "",
          orgId: (snap_org_id as string) || undefined,
        });
      }
      router.replace("/app/dashboard");
    }

  }, [router.isReady, hydrated, router.query, setMetaCredentials, setMetaPixelList, setDV360Credentials, setGoogleAdsCredentials, setSnapchatCredentials, setLoginEmail, router]);

  // One-time cleanup: validate stored Google Ads options, removing any MCC
  // (manager) accounts that snuck in before the callback filter was added.
  useEffect(() => {
    if (!hydrated || demoMode) return;
    const s = useAuthStore.getState();
    const opts = s.gadsCustomerOptions;
    if (opts.length === 0 || !s.dv360RefreshToken || !s.dv360ClientId || !s.dv360ClientSecret) return;
    let cancelled = false;
    (async () => {
      const verified: typeof opts = [];
      for (const opt of opts) {
        try {
          const r = await fetch("/api/google-ads/accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId: s.dv360ClientId,
              clientSecret: s.dv360ClientSecret,
              refreshToken: s.dv360RefreshToken,
              customerId: opt.id,
            }),
          });
          if (!r.ok) { verified.push(opt); continue; }
          const { accounts } = await r.json();
          const self = (accounts || []).find((a: { id: string }) => a.id === opt.id);
          if (!self || !self.isManager) verified.push(opt);
        } catch {
          verified.push(opt);
        }
      }
      if (cancelled) return;
      if (verified.length !== opts.length) {
        useAuthStore.getState().setGadsCustomerOptions(verified);
        // If the currently active customer was a manager, clear it.
        const active = useAuthStore.getState().googleAdsCustomerId;
        if (active && !verified.some((o) => o.id === active)) {
          if (verified.length === 1) {
            setGoogleAdsCredentials({ customerId: verified[0].id, loginCustomerId: verified[0].loginCustomerId });
          } else {
            useAuthStore.getState().switchGoogleAdsCustomer(verified.length > 0 ? verified[0].id : "");
          }
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, demoMode]);

  // Hydrate demo mode from ?demo=1 — survives refresh / back-button within the
  // tab without leaking into localStorage.
  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.demo === "1" && !demoMode) enterDemoMode();
  }, [router.isReady, router.query.demo, demoMode, enterDemoMode]);

  // Route guard — block /app/dashboard for unconnected, non-demo visitors.
  const hasServerDefaults = !!process.env.NEXT_PUBLIC_HAS_DEFAULT_CREDS;
  useEffect(() => {
    if (!mounted || !router.isReady || !hydrated) return;
    if (router.query.demo === "1") return; // grace period while demoMode hydrates
    if (hasServerDefaults) return; // server-side env vars handle auth
    // A DV360 refresh token present but no advertiser yet = mid-connection
    // (OAuth found no advertisers, user must paste the ID). Don't bounce them
    // back to landing — let the "Paste your Advertiser ID" prompt show.
    const dv360Pending = !!dv360RefreshToken;
    const snapPending = !!snapchatRefreshToken || !!snapchatAdAccountId || !!(router.query.snap_refresh);
    if (!isMetaConnected() && !isDV360Connected() && !isGoogleAdsConnected() && !isSnapchatConnected() && !dv360Pending && !snapPending && !demoMode) {
      router.replace("/");
    }
  }, [mounted, hydrated, router.isReady, router.query.demo, isMetaConnected, isDV360Connected, isGoogleAdsConnected, isSnapchatConnected, dv360RefreshToken, snapchatRefreshToken, snapchatAdAccountId, demoMode, router, hasServerDefaults]);

  const handleLogout = () => {
    clearAllCredentials();
    router.push("/");
  };

  // Disconnect one platform, keep the session alive if the other remains.
  const handleDisconnect = (which: "meta" | "dv360" | "google_ads" | "snapchat") => {
    if (which === "meta") clearMetaCredentials();
    else if (which === "dv360") clearDV360Credentials();
    else if (which === "google_ads") clearGoogleAdsCredentials();
    else clearSnapchatCredentials();
    const stillConnected = isMetaConnected() || isDV360Connected() || isGoogleAdsConnected() || isSnapchatConnected();
    if (!stillConnected && !demoMode) router.push("/");
  };

  const handleDateChange = (range: DateRange, start?: string, end?: string) => {
    setDateRange(range);
    setCustomStart(start);
    setCustomEnd(end);
  };

  const renderTabContent = () => {
    const props = { platform, dateRange, customStart, customEnd };
    const ctx = { ...props, selectedObjectives, setActiveTab };
    switch (activeTab) {
      // Audit
      case "pixel-health":
        return <PixelHealthTab {...props} />;
      case "event-quality":
        return <EventQualityTab {...props} />;
      case "funnel":
        return <FunnelAuditTab {...props} />;
      case "attribution":
        return <AttributionTab {...props} />;
      case "floodlight":
        return <FloodlightHealthTab {...props} />;
      case "aud-overlap":
        return <AudienceOverlapTab {...ctx} />;
      case "aud-quality":
        return <AudienceQualityTab {...ctx} />;
      // Tracking
      case "account-structure":
        return <AccountStructureTab {...ctx} />;
      case "camp-performance":
        return <CampaignOverview platform={platform} setActiveTab={setActiveTab} />;
      case "aud-performance":
        return <AudiencePerformanceTab {...ctx} />;
      case "aud-saturation":
        return <AudienceSaturationTab {...ctx} />;
      case "conversion-monitoring":
        return <ConversionMonitoringTab {...props} />;
      case "create-campaign":
        return <CreateCampaignTab platform={platform} />;
      // Reporting
      case "rep-dashboard":
        return <DashboardReport {...props} />;
      case "reporting":
      case "rep-overview":
        return <ReportingOverview {...props} setActiveTab={setActiveTab} />;
      case "rep-key-metric":
        return <KeyMetricAnalysisReport {...props} />;
      case "rep-audience":
        return <AudienceAnalysisReport {...props} />;
      case "rep-creative":
        return <CreativeReport {...props} />;
      case "rep-placement":
        return <PlacementReport {...props} />;
      case "rep-attribution":
        return <AttributionReport {...props} />;
      case "rep-planning":
        return <DashboardReport {...props} />;
      case "rep-export":
        return <ExportReport {...props} />;
      case "rep-generate":
        return <GenerateReport {...props} />;
      case "media-ads-lib":
        return <MediaAdsLibraryTab />;
      case "research-chat":
        return <ResearchChatTab />;
      case "agent-ready":
        return <AgentReadyTab />;
      case "aplus-content":
        return <AplusContentTab />;
      case "insta-grid":
        return <InstaGridTab />;
      case "vibe-clone":
        return <VibeCloneTab />;
      case "vibe-match":
        return <VibeMatchTab />;
      case "personas":
        return <PersonasTab />;
      case "ugc-ads":
        return <UGCAdsTab />;
      case "ugc-new":
        return <UGCNewTab />;
      case "ugc-playground":
        return <UGCPlaygroundTab />;
      case "micro-drama":
        return <MicroDramaTab />;
      case "video-ads":
        return <VideoAdsTab />;
      case "luxe-ads":
        return <LuxeAdsTab />;
      case "vibe-clone-ugc":
        return <VibeCloneUGCTab />;
      case "talking-avatar":
        return <TalkingAvatarTab />;
      case "character-reel":
        return <CharacterReelTab />;
      case "voice-clone":
        return <VoiceCloneTab />;
      case "scan-history":
        return <ScanHistoryTab />;
      case "creatives-history":
        return <CreativesHistoryTab />;
      // Insights
      case "recommendations":
        return <RecommendationsTab {...props} />;
      case "ask-ai":
        return <AskAITab {...props} />;
      case "change-log":
        return <ChangeLogPanel />;
      default:
        return <PixelHealthTab {...props} />;
    }
  };

  const handleGroupClick = (groupId: string, hasChildren: boolean, firstChildId?: string) => {
    if (hasChildren && firstChildId) {
      setActiveTab(firstChildId);
    } else {
      setActiveTab(groupId);
    }
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
      {demoMode && (
        <div className="sticky top-0 z-50 bg-yellow-50 border-b border-yellow-300 text-yellow-900 text-sm">
          <div className="max-w-7xl mx-auto px-6 py-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-base">⚠</span>
              <span><span className="font-bold">Demo Mode</span> — you&apos;re viewing sample data, not a real ad account.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { exitDemoMode(); router.push("/"); }}
                className="px-3 py-1 rounded bg-yellow-200 hover:bg-yellow-300 text-yellow-900 text-xs font-bold transition"
              >
                Connect your account
              </button>
              <button
                onClick={() => { exitDemoMode(); router.push("/"); }}
                className="px-3 py-1 rounded text-yellow-800 hover:bg-yellow-100 text-xs font-semibold transition"
              >
                Exit demo
              </button>
            </div>
          </div>
        </div>
      )}
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

          {/* Right: Account Selector + AI Credits counter + Logout */}
          <div className="flex items-center gap-3">
            <AccountSelector onResolveGoogleAds={resolveGoogleAdsAccount} />

            {/* Running AI credit counter — accumulates the product-priced cost of every AI call, saved per account */}
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-xs font-semibold text-indigo-800"
              title="Total AI credits used by this account. Saved per login email — restored when you log back in."
            >
              <span>✦ AI Credits</span>
              <span className="font-mono">{totalAiCreditsUsd.toFixed(2)}</span>
            </div>

            {/* Alert-email icon — when set, critical Budget Allocation issues
                auto-email this address. Click to add/edit. */}
            <div className="relative">
              <button
                onClick={() => { setEmailDraft(alertEmail || ""); setEmailPopoverOpen((v) => !v); }}
                className={`relative p-2 rounded-lg transition flex items-center gap-1.5 text-sm font-semibold ${
                  alertEmail
                    ? "bg-green-50 border border-green-200 text-green-700 hover:bg-green-100"
                    : "bg-gray-100 border border-gray-200 text-gray-600 hover:bg-gray-200"
                }`}
                title={alertEmail ? `Critical-issue alerts → ${alertEmail}` : "Add alert email"}
              >
                <Mail className="w-4 h-4" />
                {alertEmail && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full ring-2 ring-white" />}
              </button>
              {emailPopoverOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-50">
                  <h3 className="text-sm font-bold text-gray-900 mb-1">Critical-issue alerts</h3>
                  <p className="text-[11px] text-gray-500 mb-3">
                    We&apos;ll email this address when Budget Allocation detects a budget spike (&gt;25% week-over-week) or a campaign stops delivering.
                    {alertEmail && alertEmail === loginEmail && <span className="block mt-1 text-gray-400">Defaulted to your signed-in Google account — edit if you&apos;d like alerts elsewhere.</span>}
                  </p>
                  <input
                    type="email"
                    placeholder="you@email.com"
                    value={emailDraft}
                    onChange={(e) => setEmailDraft(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  <div className="flex items-center justify-between mt-3 gap-2">
                    <button
                      onClick={() => { setAlertEmail(null); setEmailDraft(""); setEmailPopoverOpen(false); }}
                      className="text-[11px] text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEmailPopoverOpen(false)}
                        className="px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          const v = emailDraft.trim();
                          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return;
                          setAlertEmail(v);
                          setEmailSavedFlash(true);
                          setTimeout(() => setEmailSavedFlash(false), 1500);
                          setTimeout(() => setEmailPopoverOpen(false), 600);
                        }}
                        className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 inline-flex items-center gap-1"
                      >
                        {emailSavedFlash ? <><Check className="w-3 h-3" /> Saved</> : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handleLogout}
              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
              title="Logout (disconnect all)"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      <div className="flex h-[calc(100vh-80px)]">
        <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
          <nav className="space-y-1 p-4">
            {visibleNav.map((group) => {
              const hasChildren = !!group.children?.length;
              const isExpanded = expandedGroups.has(group.id);
              const isActiveGroup = activeTab === group.id;
              const isActiveChild = hasChildren && group.children!.some((c) => c.id === activeTab);

              return (
                <div key={group.id}>
                  <button
                    onClick={() => handleGroupClick(group.id, hasChildren, group.children?.[0]?.id)}
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

          {/* Keying by the active account IDs forces the whole tab subtree to
              remount when the user switches accounts, so every hook re-runs and
              refetches data for the newly selected account. */}
          <div
            key={`acct:${metaBusinessId || "-"}:${dv360AdvertiserId || "-"}:${googleAdsCustomerId || "-"}:${snapchatAdAccountId || "-"}`}
            className="p-8"
          >
            {renderTabContent()}
          </div>
        </main>
      </div>

    </div>
  );
}
