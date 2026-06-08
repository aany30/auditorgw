import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DateRange, CustomDateRange, NamingConvention, NamingRule } from "@/types";
import { META_BENCHMARKS, type BenchmarkSnapshot } from "@/lib/funnel-benchmarks";
import { toDisplayCredits } from "@/lib/ai-cost";

interface PixelInfo {
  id: string;
  name: string;
}

interface GoogleAccount {
  customerId: string;
  name: string;
  properties?: Array<{ id: string; name: string }>;
  containers?: Array<{ id: string; name: string }>;
}

interface CustomBenchmarks {
  // Meta Benchmarks
  metaEMQScore: number;
  metaDedupRate: number;
  metaCAPIHealthScore: number;
  metaPayloadCompleteness: number;
  metaEventLatencyMs: number;

  // Google Benchmarks
  googleEnhancedConversionsMatchRate: number;
  googleEventCompleteness: number;
  googleEventLatencyMs: number;
  googleGAEventQuality: number;

  // Funnel Benchmarks
  funnelConversionRate: number;
  funnelDropOffThreshold: number;

  // General
  eventFiringHealthThreshold: number;
}

/**
 * Per-match-key benchmark overrides for the EMQ Match-Key Coverage table.
 * Keyed by the canonical row label ("Email Hash", "Phone Number Hash", etc.)
 * or the friendly extra-key label ("First Name (fn)", etc.). Persisted via
 * the existing Zustand `persist` middleware so user edits survive reload.
 */
export interface EmqKeyBenchmark { min: number; max: number }

const DEFAULT_BENCHMARKS: CustomBenchmarks = {
  metaEMQScore: 0.88,
  metaDedupRate: 0.95,
  metaCAPIHealthScore: 0.85,
  metaPayloadCompleteness: 0.9,
  metaEventLatencyMs: 500,
  googleEnhancedConversionsMatchRate: 0.8,
  googleEventCompleteness: 0.92,
  googleEventLatencyMs: 1000,
  googleGAEventQuality: 0.85,
  funnelConversionRate: 0.03,
  funnelDropOffThreshold: 0.3,
  eventFiringHealthThreshold: 0.9,
};

const DEFAULT_NAMING_CONVENTIONS: NamingConvention[] = [
  {
    id: "standard-marketing",
    name: "Standard Marketing Naming",
    description: "Recommended naming convention for marketing campaigns",
    enabled: true,
    separator: " >> ",
    rules: [
      {
        id: "agency",
        label: "Agency Name",
        placeholder: "e.g., Three Zinc, Ecom Agency",
        description: "Your agency or brand name",
        required: false,
        position: 1,
        examples: ["Three Zinc", "Ecom Agency", "In House Team"],
        inputType: "text",
      },
      {
        id: "product",
        label: "Product",
        placeholder: "e.g., Mova, DV360",
        description: "Product or service being promoted",
        required: false,
        position: 2,
        examples: ["Mova", "DV360", "Social Agency"],
        inputType: "text",
      },
      {
        id: "objective",
        label: "Objective/Buy Type",
        placeholder: "Select an objective",
        description: "Campaign objective or buying type",
        required: false,
        position: 3,
        examples: [
          "Awareness . Reach",
          "Awareness . Views",
          "Consideration . Engagement",
          "Consideration . Clicks",
          "Preference . Leads",
          "Preference . Store Visits",
          "Purchase . Sales",
          "Preference . App Installs",
        ],
        inputType: "select",
      },
      {
        id: "platform",
        label: "Platform",
        placeholder: "Select a platform",
        description: "Advertising platform",
        required: false,
        position: 4,
        examples: [
          "Meta",
          "Facebook",
          "Instagram",
          "Google SEM",
          "Google Display",
          "YouTube",
          "DV360",
          "Snapchat",
          "TikTok",
          "X",
          "LinkedIn",
          "Pinterest",
          "Reddit",
        ],
        inputType: "select",
      },
      {
        id: "creative-type",
        label: "Creative Type",
        placeholder: "Select a creative type",
        description: "Type of creative asset",
        required: false,
        position: 5,
        examples: [
          "Static",
          "Carousels",
          "Gif",
          "Video",
        ],
        inputType: "select",
      },
      {
        id: "campaign-name",
        label: "Campaign Name",
        placeholder: "e.g., W1-Promo, Q2-Campaign",
        description: "Specific campaign identifier",
        required: false,
        position: 6,
        examples: ["W1-Promo", "Q2-Campaign", "Summer-Sale", "Launch-2026"],
        inputType: "text",
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

interface AuthState {
  // Alerts — email of the auditor viewing the dashboard (recipient for
  // critical-campaign alerts from Budget Allocation, etc.). Persists across
  // sessions so the user only sets it once.
  alertEmail: string | null;

  // Optional user-set monthly budget cap (in their account's currency units).
  // Drives the Monthly Budget Tracking card on the Budget Allocation audit —
  // MTD spend vs MTD expected pace, daily cap maths, headroom for new campaigns.
  monthlyBudget: number | null;

  // User-entered current EMQ scores per event (1–10 scale).
  // Persisted in localStorage so they survive page refreshes.
  // Key = event id (e.g. "pageView", "atc"), value = 0–10 or null (not entered).
  emqInputs: Record<string, number | null>;

  // Meta Credentials
  metaAccessToken: string | null;
  metaBusinessId: string | null;
  metaPixelIds: string[];
  metaPixelList: PixelInfo[];
  selectedMetaPixelId: string | null;

  // Google Credentials
  googleAccessToken: string | null;
  googleCustomerId: string | null;
  gaPropertyId: string | null;
  gtmContainerId: string | null;
  googleAdsDeveloperToken: string | null;
  googleAdsLoginCustomerId: string | null;
  googleAccountsList: GoogleAccount[];
  selectedGoogleCustomerId: string | null;
  selectedGAPropertyId: string | null;
  selectedGTMContainerId: string | null;

  // Custom Benchmarks
  customBenchmarks: CustomBenchmarks;

  // Per-row overrides for the EMQ Match-Key Coverage table.
  // Keyed by display label (e.g. "Email Hash", "First Name (fn)").
  emqKeyBenchmarks: Record<string, EmqKeyBenchmark>;
  setEmqKeyBenchmark: (label: string, value: EmqKeyBenchmark) => void;
  resetEmqKeyBenchmark: (label: string) => void;

  // Date Range
  dateRange: DateRange;
  customDateRange: CustomDateRange | null;

  // Naming Conventions
  namingConventions: NamingConvention[];
  activeConventionId: string | null;

  // Funnel Benchmarks
  benchmarkSnapshots: BenchmarkSnapshot[];
  activeBenchmarkId: string;
  addBenchmarkSnapshot: (snapshot: BenchmarkSnapshot) => void;
  setActiveBenchmark: (id: string) => void;
  removeBenchmarkSnapshot: (id: string) => void;

  // Alerts
  setAlertEmail: (email: string | null) => void;
  setMonthlyBudget: (amount: number | null) => void;
  setEmqInput: (eventId: string, value: number | null) => void;
  /** Running total of AI API costs (USD) for the current session. */
  totalAiCreditsUsd: number;
  addAiCredits: (usd: number) => void;

  // Auth Methods
  setMetaCredentials: (token: string, businessId: string, pixelIds: string[]) => void;
  setMetaPixelList: (pixels: PixelInfo[]) => void;
  setSelectedMetaPixelId: (pixelId: string) => void;

  setGoogleCredentials: (
    token: string,
    customerId: string,
    propertyId: string,
    containerId: string,
    developerToken?: string,
    loginCustomerId?: string
  ) => void;
  setGoogleAccountsList: (accounts: GoogleAccount[]) => void;
  setSelectedGoogleCustomerId: (customerId: string) => void;
  setSelectedGAPropertyId: (propertyId: string) => void;
  setSelectedGTMContainerId: (containerId: string) => void;

  setDateRange: (range: DateRange) => void;
  setCustomDateRange: (range: CustomDateRange) => void;
  clearMetaCredentials: () => void;
  clearGoogleCredentials: () => void;
  clearAllCredentials: () => void;
  addMetaPixelId: (pixelId: string) => void;
  removeMetaPixelId: (pixelId: string) => void;

  // Benchmark Methods
  updateBenchmark: <K extends keyof CustomBenchmarks>(key: K, value: CustomBenchmarks[K]) => void;
  updateAllBenchmarks: (benchmarks: Partial<CustomBenchmarks>) => void;
  resetBenchmarksToDefault: () => void;
  getBenchmark: <K extends keyof CustomBenchmarks>(key: K) => CustomBenchmarks[K];

  // Naming Convention Methods
  addNamingConvention: (convention: NamingConvention) => void;
  updateNamingConvention: (id: string, updates: Partial<NamingConvention>) => void;
  deleteNamingConvention: (id: string) => void;
  setActiveConvention: (id: string) => void;
  getActiveConvention: () => NamingConvention | null;

  // Utility Methods
  isMetaConnected: () => boolean;
  isGoogleConnected: () => boolean;
  getDateRangeLabel: () => string;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      alertEmail: null,
      monthlyBudget: null,
      emqInputs: {},
      totalAiCreditsUsd: 0,
      metaAccessToken: null,
      metaBusinessId: null,
      metaPixelIds: [],
      metaPixelList: [],
      selectedMetaPixelId: null,
      googleAccessToken: null,
      googleCustomerId: null,
      gaPropertyId: null,
      gtmContainerId: null,
      googleAdsDeveloperToken: null,
      googleAdsLoginCustomerId: null,
      googleAccountsList: [],
      selectedGoogleCustomerId: null,
      selectedGAPropertyId: null,
      selectedGTMContainerId: null,
      customBenchmarks: DEFAULT_BENCHMARKS,
      emqKeyBenchmarks: {},
      dateRange: "30d",
      customDateRange: null,
      namingConventions: DEFAULT_NAMING_CONVENTIONS,
      activeConventionId: DEFAULT_NAMING_CONVENTIONS[0].id,

      benchmarkSnapshots: [META_BENCHMARKS],
      activeBenchmarkId: META_BENCHMARKS.id,

      setAlertEmail: (email) => set({ alertEmail: email }),
      setMonthlyBudget: (amount) => set({ monthlyBudget: amount }),
      setEmqInput: (eventId, value) =>
        set((state) => ({ emqInputs: { ...state.emqInputs, [eventId]: value } })),
      // Callers pass the RAW Anthropic cost; we store the PRODUCT-priced value
      // (raw × 3 ÷ 0.05) so the counter reflects what the customer is charged.
      addAiCredits: (usd) =>
        set((state) => ({ totalAiCreditsUsd: +(state.totalAiCreditsUsd + toDisplayCredits(usd)).toFixed(4) })),

      setMetaCredentials: (token, businessId, pixelIds) =>
        set({ metaAccessToken: token, metaBusinessId: businessId, metaPixelIds: pixelIds }),

      setMetaPixelList: (pixels) =>
        set({ metaPixelList: pixels, selectedMetaPixelId: pixels[0]?.id || null }),

      setSelectedMetaPixelId: (pixelId) =>
        set({ selectedMetaPixelId: pixelId }),

      setGoogleCredentials: (token, customerId, propertyId, containerId, developerToken, loginCustomerId) =>
        set({
          googleAccessToken: token,
          googleCustomerId: customerId,
          gaPropertyId: propertyId,
          gtmContainerId: containerId,
          googleAdsDeveloperToken: developerToken || null,
          googleAdsLoginCustomerId: loginCustomerId || null,
        }),

      setGoogleAccountsList: (accounts) =>
        set({ googleAccountsList: accounts, selectedGoogleCustomerId: accounts[0]?.customerId || null }),

      setSelectedGoogleCustomerId: (customerId) =>
        set({ selectedGoogleCustomerId: customerId }),

      setSelectedGAPropertyId: (propertyId) =>
        set({ selectedGAPropertyId: propertyId }),

      setSelectedGTMContainerId: (containerId) =>
        set({ selectedGTMContainerId: containerId }),

      setDateRange: (range) => set({ dateRange: range }),
      setCustomDateRange: (range) => set({ customDateRange: range }),

      updateBenchmark: (key, value) =>
        set((state) => ({
          customBenchmarks: { ...state.customBenchmarks, [key]: value },
        })),

      updateAllBenchmarks: (benchmarks) =>
        set((state) => ({
          customBenchmarks: { ...state.customBenchmarks, ...benchmarks },
        })),

      resetBenchmarksToDefault: () =>
        set({ customBenchmarks: DEFAULT_BENCHMARKS }),

      setEmqKeyBenchmark: (label, value) =>
        set((state) => ({ emqKeyBenchmarks: { ...state.emqKeyBenchmarks, [label]: value } })),

      resetEmqKeyBenchmark: (label) =>
        set((state) => {
          const next = { ...state.emqKeyBenchmarks };
          delete next[label];
          return { emqKeyBenchmarks: next };
        }),

      getBenchmark: (key) => {
        const state = get();
        return state.customBenchmarks[key];
      },

      clearMetaCredentials: () =>
        set({
          metaAccessToken: null,
          metaBusinessId: null,
          metaPixelIds: [],
          metaPixelList: [],
          selectedMetaPixelId: null,
        }),

      clearGoogleCredentials: () =>
        set({
          googleAccessToken: null,
          googleCustomerId: null,
          gaPropertyId: null,
          gtmContainerId: null,
          googleAdsDeveloperToken: null,
          googleAdsLoginCustomerId: null,
          googleAccountsList: [],
          selectedGoogleCustomerId: null,
          selectedGAPropertyId: null,
          selectedGTMContainerId: null,
        }),

      clearAllCredentials: () =>
        set({
          metaAccessToken: null,
          metaBusinessId: null,
          metaPixelIds: [],
          metaPixelList: [],
          selectedMetaPixelId: null,
          googleAccessToken: null,
          googleCustomerId: null,
          gaPropertyId: null,
          gtmContainerId: null,
          googleAdsDeveloperToken: null,
          googleAdsLoginCustomerId: null,
          googleAccountsList: [],
          selectedGoogleCustomerId: null,
          selectedGAPropertyId: null,
          selectedGTMContainerId: null,
          totalAiCreditsUsd: 0, // reset credit counter on logout
        }),

      addMetaPixelId: (pixelId) =>
        set((state) => ({ metaPixelIds: [...new Set([...state.metaPixelIds, pixelId])] })),

      removeMetaPixelId: (pixelId) =>
        set((state) => ({ metaPixelIds: state.metaPixelIds.filter((id) => id !== pixelId) })),

      isMetaConnected: () => {
        const state = get();
        return !!(state.metaAccessToken && state.metaBusinessId);
      },
      isGoogleConnected: () => {
        const state = get();
        return !!(state.googleAccessToken && state.googleCustomerId);
      },

      getDateRangeLabel: () => {
        const state = get();
        if (state.dateRange === "custom" && state.customDateRange) {
          const { startDate, endDate } = state.customDateRange;
          return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
        }
        return { "7d": "Last 7 Days", "30d": "Last 30 Days", "90d": "Last 90 Days", custom: "Custom" }[
          state.dateRange
        ] || "All Time";
      },

      addNamingConvention: (convention) =>
        set((state) => ({
          namingConventions: [...state.namingConventions, convention],
          activeConventionId: convention.id,
        })),

      updateNamingConvention: (id, updates) =>
        set((state) => ({
          namingConventions: state.namingConventions.map((c) =>
            c.id === id ? { ...c, ...updates, updatedAt: new Date() } : c
          ),
        })),

      deleteNamingConvention: (id) =>
        set((state) => {
          const filtered = state.namingConventions.filter((c) => c.id !== id);
          return {
            namingConventions: filtered,
            activeConventionId: state.activeConventionId === id ? filtered[0]?.id || null : state.activeConventionId,
          };
        }),

      setActiveConvention: (id) =>
        set({ activeConventionId: id }),

      getActiveConvention: () => {
        const state = get();
        return state.namingConventions.find((c) => c.id === state.activeConventionId) || null;
      },

      addBenchmarkSnapshot: (snapshot) =>
        set((state) => {
          // Avoid duplicates on same id (replace), cap history at 10 snapshots
          const filtered = state.benchmarkSnapshots.filter((s) => s.id !== snapshot.id);
          const next = [snapshot, ...filtered].slice(0, 10);
          return { benchmarkSnapshots: next, activeBenchmarkId: snapshot.id };
        }),

      setActiveBenchmark: (id) => set({ activeBenchmarkId: id }),

      removeBenchmarkSnapshot: (id) =>
        set((state) => {
          const filtered = state.benchmarkSnapshots.filter((s) => s.id !== id);
          return {
            benchmarkSnapshots: filtered.length > 0 ? filtered : [META_BENCHMARKS],
            activeBenchmarkId:
              state.activeBenchmarkId === id
                ? filtered[0]?.id || META_BENCHMARKS.id
                : state.activeBenchmarkId,
          };
        }),
    }),
    {
      name: "auth-store",
      // Bump this version any time DEFAULT_NAMING_CONVENTIONS / META_BENCHMARKS
      // change in a way that should override persisted user state.
      version: 3,
      // On version mismatch, replace the persisted naming convention with the
      // fresh default (v3: updated Objective/Buy Type + Creative Type options).
      migrate: (persistedState: unknown, fromVersion: number) => {
        const state = (persistedState as Partial<AuthState>) || {};
        if (fromVersion < 3) {
          return {
            ...state,
            namingConventions: DEFAULT_NAMING_CONVENTIONS,
            activeConventionId: DEFAULT_NAMING_CONVENTIONS[0].id,
          } as AuthState;
        }
        return state as AuthState;
      },
    }
  )
);
