/**
 * Spotify OAuth access-token cache.
 *
 * Spotify tokens expire after 1 hour. Uses Basic auth (base64 client_id:client_secret)
 * for the refresh grant.
 */

const TOKEN_URL = "https://accounts.spotify.com/api/token";

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getSpotifyAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Spotify token refresh failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const token = data.access_token as string;
  const expiresIn = (data.expires_in as number) || 3600;
  tokenCache.set(refreshToken, {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return token;
}
