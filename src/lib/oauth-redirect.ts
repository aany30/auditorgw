import type { NextApiRequest } from "next";

/**
 * Builds the scheme + host (origin) for OAuth redirect URIs.
 *
 * A top-level browser navigation to an OAuth "start" route sends no `Origin`
 * header, so the old `req.headers.origin || http://${req.headers.host}` fallback
 * produced an `http://` redirect_uri on live domains — which Google (and other
 * providers) reject as a malformed request. This derives the scheme from the
 * proxy's `x-forwarded-proto` and defaults to https for any non-localhost host.
 */
export function requestOrigin(req: NextApiRequest): string {
  // A real Origin header (XHR/CORS flows) is authoritative when present.
  if (req.headers.origin) return req.headers.origin;

  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  const fwdProto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim();
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = fwdProto || (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}
