/**
 * Fetches Snapchat audience segments (SAM segments).
 */
import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";

export interface SnapchatSegment {
  id: string;
  name: string;
  status: string;
  type: string;
  description: string;
  targetableStatus: string;
  approximateNumberUsers: number;
  uploadStatus: string;
  retentionInDays: number;
  sourceType: string;
}

export function useSnapchatAudiences(enabled: boolean) {
  const { snapchatClientId, snapchatClientSecret, snapchatRefreshToken, snapchatAdAccountId, snapchatOrgId, demoMode } = useAuthStore();
  const [segments, setSegments] = useState<SnapchatSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) { setSegments([]); setLoading(false); return; }
    const hasServerDefaults = !!process.env.NEXT_PUBLIC_HAS_DEFAULT_CREDS;
    if (!hasServerDefaults && !snapchatRefreshToken) { setSegments([]); setLoading(false); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/audience/list/snapchat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: snapchatClientId,
        clientSecret: snapchatClientSecret,
        refreshToken: snapchatRefreshToken,
        adAccountId: snapchatAdAccountId,
        orgId: snapchatOrgId,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) { setError(data.error); return; }
        setSegments(data.segments || []);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [enabled, snapchatClientId, snapchatClientSecret, snapchatRefreshToken, snapchatAdAccountId, snapchatOrgId, demoMode]);

  return { segments, loading, error };
}
