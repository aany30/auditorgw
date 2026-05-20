import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DateRange, CustomDateRange } from "@/types";

interface AuthState {
  // Meta Credentials
  metaAccessToken: string | null;
  metaBusinessId: string | null;
  metaPixelIds: string[];

  // Google Credentials
  googleAccessToken: string | null;
  googleCustomerId: string | null;
  gaPropertyId: string | null;
  gtmContainerId: string | null;

  // Date Range
  dateRange: DateRange;
  customDateRange: CustomDateRange | null;

  // Authentication Methods
  setMetaCredentials: (
    token: string,
    businessId: string,
    pixelIds: string[]
  ) => void;
  setGoogleCredentials: (
    token: string,
    customerId: string,
    propertyId: string,
    containerId: string
  ) => void;
  setDateRange: (range: DateRange) => void;
  setCustomDateRange: (range: CustomDateRange) => void;
  clearMetaCredentials: () => void;
  clearGoogleCredentials: () => void;
  clearAllCredentials: () => void;
  addMetaPixelId: (pixelId: string) => void;
  removeMetaPixelId: (pixelId: string) => void;

  // Utility Methods
  isMetaConnected: () => boolean;
  isGoogleConnected: () => boolean;
  getDateRangeLabel: () => string;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      metaAccessToken: null,
      metaBusinessId: null,
      metaPixelIds: [],
      googleAccessToken: null,
      googleCustomerId: null,
      gaPropertyId: null,
      gtmContainerId: null,
      dateRange: "30d",
      customDateRange: null,

      setMetaCredentials: (token, businessId, pixelIds) =>
        set({ metaAccessToken: token, metaBusinessId: businessId, metaPixelIds: pixelIds }),

      setGoogleCredentials: (token, customerId, propertyId, containerId) =>
        set({
          googleAccessToken: token,
          googleCustomerId: customerId,
          gaPropertyId: propertyId,
          gtmContainerId: containerId,
        }),

      setDateRange: (range) => set({ dateRange: range }),

      setCustomDateRange: (range) => set({ customDateRange: range }),

      clearMetaCredentials: () =>
        set({
          metaAccessToken: null,
          metaBusinessId: null,
          metaPixelIds: [],
        }),

      clearGoogleCredentials: () =>
        set({
          googleAccessToken: null,
          googleCustomerId: null,
          gaPropertyId: null,
          gtmContainerId: null,
        }),

      clearAllCredentials: () =>
        set({
          metaAccessToken: null,
          metaBusinessId: null,
          metaPixelIds: [],
          googleAccessToken: null,
          googleCustomerId: null,
          gaPropertyId: null,
          gtmContainerId: null,
        }),

      addMetaPixelId: (pixelId) =>
        set((state) => ({
          metaPixelIds: [...new Set([...state.metaPixelIds, pixelId])],
        })),

      removeMetaPixelId: (pixelId) =>
        set((state) => ({
          metaPixelIds: state.metaPixelIds.filter((id) => id !== pixelId),
        })),

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
    }),
    {
      name: "auth-store",
    }
  )
);
