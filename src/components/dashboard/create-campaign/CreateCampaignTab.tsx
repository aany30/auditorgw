import { useState, useMemo } from "react";
import { PlusCircle, AlertCircle } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { isDemoCredential } from "@/lib/demo-data";
import MetaCampaignWizard from "./MetaCampaignWizard";
import DV360CampaignWizard from "./DV360CampaignWizard";
import GoogleAdsCampaignWizard from "./GoogleAdsCampaignWizard";
import SnapchatCampaignWizard from "./SnapchatCampaignWizard";
import SpotifyCampaignWizard from "./SpotifyCampaignWizard";

interface Props {
  platform: "meta" | "dv360" | "google_ads" | "snapchat" | "spotify" | "both";
}

export default function CreateCampaignTab({ platform }: Props) {
  const { metaAccessToken, dv360RefreshToken, googleAdsCustomerId, snapchatAdAccountId, spotifyAdAccountId } = useAuthStore();
  const [localPlatform, setLocalPlatform] = useState<"meta" | "dv360" | "google_ads" | "snapchat" | "spotify" | null>(null);

  const isDemo = useMemo(
    () =>
      (!metaAccessToken || isDemoCredential(metaAccessToken)) &&
      (!dv360RefreshToken || isDemoCredential(dv360RefreshToken)) &&
      !googleAdsCustomerId &&
      !snapchatAdAccountId &&
      !spotifyAdAccountId,
    [metaAccessToken, dv360RefreshToken, googleAdsCustomerId, snapchatAdAccountId, spotifyAdAccountId]
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
              Campaign creation requires a connected Meta, DV360, Google Ads, Snapchat, or Spotify account with write access.
              Go to the landing page to connect your account.
            </div>
          </div>
        </div>
      )}

      {/* Platform selector — shown when global filter is "both" */}
      {platform === "both" && !isDemo && (
        <div className="flex items-center gap-3 flex-wrap">
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
          <button
            onClick={() => setLocalPlatform("google_ads")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-semibold transition ${
              localPlatform === "google_ads"
                ? "border-orange-600 bg-orange-50 text-orange-700"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>
            </svg>
            Google Ads
          </button>
          <button
            onClick={() => setLocalPlatform("snapchat")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-semibold transition ${
              localPlatform === "snapchat"
                ? "border-yellow-500 bg-yellow-50 text-yellow-700"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301a.477.477 0 0 1 .494.034.483.483 0 0 1 .224.413c-.003.2-.154.462-.469.667-.293.191-.678.369-1.08.503-.112.037-.208.087-.295.161-.065.054-.111.123-.145.198.033.197.116.42.255.633.396.611 1.028 1.136 1.726 1.402a.466.466 0 0 1 .314.448c-.003.093-.03.181-.072.259-.143.309-.677.585-1.547.803-.2.049-.361.131-.468.256-.105.122-.177.284-.218.453-.077.317-.159.662-.476.834a.578.578 0 0 1-.298.088c-.128 0-.265-.04-.413-.086-.219-.068-.472-.144-.788-.144a2.38 2.38 0 0 0-.372.028c-.345.052-.736.247-1.189.49-.776.416-1.735.933-3.049.933-1.33 0-2.294-.523-3.078-.943-.443-.238-.825-.443-1.162-.494a2.42 2.42 0 0 0-.371-.027c-.332 0-.591.083-.808.149-.14.044-.264.082-.382.082a.617.617 0 0 1-.339-.102c-.29-.168-.372-.498-.448-.808-.042-.174-.116-.34-.224-.465-.108-.126-.272-.21-.474-.26-.859-.216-1.386-.49-1.53-.8a.49.49 0 0 1-.073-.262.466.466 0 0 1 .316-.45c.699-.265 1.33-.79 1.726-1.401.14-.213.222-.436.255-.633a.564.564 0 0 0-.145-.198 1.063 1.063 0 0 0-.295-.161c-.4-.134-.787-.312-1.08-.503-.315-.205-.466-.468-.47-.668a.482.482 0 0 1 .226-.413.477.477 0 0 1 .494-.034c.374.181.733.285 1.033.301.199 0 .326-.045.401-.09a31.03 31.03 0 0 1-.033-.57c-.104-1.628-.23-3.654.299-4.847C7.86 1.069 11.216.793 12.206.793z"/>
            </svg>
            Snapchat
          </button>
          <button
            onClick={() => setLocalPlatform("spotify")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-semibold transition ${
              localPlatform === "spotify"
                ? "border-green-600 bg-green-50 text-green-700"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            Spotify
          </button>
        </div>
      )}

      {/* Meta wizard */}
      {activePlatform === "meta" && !isDemo && <MetaCampaignWizard />}

      {/* DV360 wizard */}
      {activePlatform === "dv360" && !isDemo && <DV360CampaignWizard />}

      {/* Google Ads wizard */}
      {activePlatform === "google_ads" && !isDemo && <GoogleAdsCampaignWizard />}

      {/* Snapchat wizard */}
      {activePlatform === "snapchat" && !isDemo && <SnapchatCampaignWizard />}

      {/* Spotify wizard */}
      {activePlatform === "spotify" && !isDemo && <SpotifyCampaignWizard />}
    </div>
  );
}
