import { useState, useMemo } from "react";
import { PlusCircle, AlertCircle } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { isDemoCredential } from "@/lib/demo-data";
import MetaCampaignWizard from "./MetaCampaignWizard";
import DV360CampaignWizard from "./DV360CampaignWizard";

interface Props {
  platform: "meta" | "dv360" | "both";
}

export default function CreateCampaignTab({ platform }: Props) {
  const { metaAccessToken, dv360RefreshToken } = useAuthStore();
  const [localPlatform, setLocalPlatform] = useState<"meta" | "dv360" | null>(null);

  const isDemo = useMemo(
    () =>
      (!metaAccessToken || isDemoCredential(metaAccessToken)) &&
      (!dv360RefreshToken || isDemoCredential(dv360RefreshToken)),
    [metaAccessToken, dv360RefreshToken]
  );

  const activePlatform = platform === "both" ? localPlatform : platform;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
          <PlusCircle className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Create Campaign</h2>
          <p className="text-xs text-gray-500">Build and launch campaigns directly from your dashboard</p>
        </div>
      </div>

      {/* Demo guard */}
      {isDemo && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-amber-800">Live credentials required</div>
            <div className="text-xs text-amber-700 mt-1">
              Campaign creation requires a connected Meta or DV360 account with write access.
              Go to the landing page to connect your account.
            </div>
          </div>
        </div>
      )}

      {/* Platform selector — shown when global filter is "both" */}
      {platform === "both" && !isDemo && (
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-700">Platform:</span>
          <button
            onClick={() => setLocalPlatform("meta")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-semibold transition ${
              localPlatform === "meta"
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.93 3.78-3.93 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02Z"/></svg>
            Meta
          </button>
          <button
            onClick={() => setLocalPlatform("dv360")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-semibold transition ${
              localPlatform === "dv360"
                ? "border-green-600 bg-green-50 text-green-700"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            DV360
          </button>
        </div>
      )}

      {/* Meta wizard */}
      {activePlatform === "meta" && !isDemo && <MetaCampaignWizard />}

      {/* DV360 wizard */}
      {activePlatform === "dv360" && !isDemo && <DV360CampaignWizard />}
    </div>
  );
}
