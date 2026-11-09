/**
 * Shared Google OAuth access-token cache — used by both the DV360 and Google
 * Ads API clients (they share the same refresh token / OAuth credentials).
 *
 * Module-level Map survives across requests within a warm serverless instance.
 * Tokens are reused with 60 s headroom before expiry.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const tokenInflight = new Map<string, Promise<string>>();

export async function getGoogleAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const inflight = tokenInflight.get(refreshToken);
  if (inflight) return inflight;

  const promise = (async () => {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google token refresh failed (${res.status}): ${err}`);
    }

    const data = await res.json();
    const token = data.access_token as string;
    const expiresIn = (data.expires_in as number) || 3600;
    tokenCache.set(refreshToken, {
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    });
    return token;
  })();

  tokenInflight.set(refreshToken, promise);
  try {
    return await promise;
  } finally {
    tokenInflight.delete(refreshToken);
  }
}
