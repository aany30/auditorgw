import { useState } from "react";
import { useRouter } from "next/router";
import { useAuthStore } from "@/store/auth";
import { CheckCircle2 } from "lucide-react";

interface Props {
  onClose?: () => void;
}

export default function SpotifyGuide({ onClose }: Props) {
  const router = useRouter();
  const { setSpotifyCredentials } = useAuthStore();

  const [form, setForm] = useState({
    refreshToken: "",
    adAccountId: "",
  });
  const [saved, setSaved] = useState(false);

  const canSave = form.refreshToken.trim() && form.adAccountId.trim();

  const handleSave = () => {
    setSpotifyCredentials({
      clientId: "",
      clientSecret: "",
      refreshToken: form.refreshToken.trim(),
      adAccountId: form.adAccountId.trim(),
    });
    setSaved(true);
    setTimeout(() => router.push("/app/dashboard"), 1200);
  };

  const inputClass =
    "w-full bg-white text-gray-900 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100";

  return (
    <div className="space-y-4">
      <div className="border border-gray-200 rounded-lg p-5 bg-white space-y-4">
        <h4 className="font-bold text-gray-900 text-base">Connect your Spotify Ad Account</h4>
        <p className="text-sm text-gray-600">
          Enter your Refresh Token and Ad Account ID. Client ID and Secret are configured server-side — you don&apos;t need them.
        </p>

        {saved ? (
          <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm font-semibold">Credentials saved! Redirecting to dashboard&hellip;</span>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Refresh Token *</label>
              <input
                type="password"
                className={inputClass}
                placeholder="Paste your Spotify refresh token"
                value={form.refreshToken}
                onChange={(e) => setForm((f) => ({ ...f, refreshToken: e.target.value }))}
              />
              <p className="text-xs text-gray-400 mt-1">
                Generate via the Spotify Ads API OAuth flow or ask your admin.
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Ad Account ID *</label>
              <input
                type="text"
                className={inputClass}
                placeholder="e.g. abc123def456"
                value={form.adAccountId}
                onChange={(e) => setForm((f) => ({ ...f, adAccountId: e.target.value }))}
              />
              <p className="text-xs text-gray-400 mt-1">
                Found in Spotify Ad Studio under your account settings.
              </p>
            </div>

            <button
              onClick={handleSave}
              disabled={!canSave}
              className={`w-full py-3 rounded-lg font-bold text-sm transition shadow-sm ${
                canSave
                  ? "bg-[#1DB954] text-white hover:bg-[#1aa34a]"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
              }`}
            >
              Save & Connect
            </button>
          </>
        )}
      </div>

      {onClose && (
        <button
          onClick={onClose}
          className="text-sm text-gray-500 hover:text-gray-700 underline w-full text-center"
        >
          Close
        </button>
      )}
    </div>
  );
}
