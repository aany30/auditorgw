import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { useAuthStore } from "@/store/auth";

/**
 * Proactively checks the shared Google OAuth token (DV360 + Google Ads) on load
 * and prompts a one-click reconnect if it has expired/been revoked — so the user
 * isn't left staring at stale data wondering why nothing refreshes.
 */
export default function GoogleReconnectBanner() {
  const { dv360ClientId, dv360ClientSecret, dv360RefreshToken, demoMode } = useAuthStore();
  const [expired, setExpired] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (demoMode) return;
    const hasServerDefaults = !!process.env.NEXT_PUBLIC_HAS_DEFAULT_CREDS;
    const hasClientToken = !!(dv360ClientId && dv360ClientSecret && dv360RefreshToken);
    if (!hasClientToken && !hasServerDefaults) return; // Google not connected

    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/google/token-health", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            hasClientToken
              ? { clientId: dv360ClientId, clientSecret: dv360ClientSecret, refreshToken: dv360RefreshToken }
              : {},
          ),
        });
        const j = await r.json();
        if (!cancelled && j?.connected && j?.ok === false && j?.expired) setExpired(true);
      } catch {
        // Network blip — the reactive per-fetch error handling still covers this.
      }
    })();
    return () => { cancelled = true; };
  }, [dv360ClientId, dv360ClientSecret, dv360RefreshToken, demoMode]);

  if (!expired || dismissed) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3 text-sm text-amber-900">
      <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
      <span className="flex-1">
        <strong>Google session expired.</strong> DV360 &amp; Google Ads data can&apos;t refresh until you reconnect.
      </span>
      <a
        href="/api/auth/google/start"
        className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 whitespace-nowrap"
      >
        Reconnect Google
      </a>
      <button onClick={() => setDismissed(true)} className="text-amber-500 hover:text-amber-700 text-xs">
        Dismiss
      </button>
    </div>
  );
}
