import type { NextApiRequest, NextApiResponse } from "next";

// Hosts that need Instagram/FB-specific request headers to return image bytes.
const META_HOSTS = ["cdninstagram.com", "fbcdn.net", "instagram.com"];

const MAX_BYTES = 10 * 1024 * 1024;        // 10 MB
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;  // 64 MB

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(10|127)\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "0.0.0.0" || h === "::1" || h.startsWith("[")) return true;
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const target = typeof req.query.url === "string" ? req.query.url : Array.isArray(req.query.url) ? req.query.url[0] : "";
  if (!target) return res.status(400).send("missing url");

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return res.status(400).send("invalid url");
  }

  if (parsed.protocol !== "https:") return res.status(400).send("https only");
  if (isBlockedHost(parsed.hostname)) return res.status(403).send("host not allowed");

  const isMeta = META_HOSTS.some(h => parsed.hostname.includes(h));

  try {
    const upstream = await fetch(target, {
      headers: isMeta
        ? {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/png,image/jpeg,video/mp4,video/*,*/*",
            "Referer": "https://www.instagram.com/",
          }
        : {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/png,image/jpeg,video/mp4,video/*,*/*",
          },
    });
    if (!upstream.ok) return res.status(upstream.status).send(`upstream ${upstream.status}`);

    const contentType = upstream.headers.get("content-type") ?? "";
    const isVideo = contentType.startsWith("video/");
    if (!contentType.startsWith("image/") && !isVideo) {
      return res.status(415).send("unsupported content type");
    }
    const cap = isVideo ? MAX_VIDEO_BYTES : MAX_BYTES;
    const declaredLen = Number(upstream.headers.get("content-length") ?? "0");
    if (declaredLen && declaredLen > cap) {
      return res.status(413).send("asset too large");
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");

    if (isVideo && upstream.body) {
      // Stream video through without buffering
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
        res.end();
      }
      return;
    }

    const body = await upstream.arrayBuffer();
    if (body.byteLength > cap) return res.status(413).send("asset too large");

    res.status(200).send(Buffer.from(body));
  } catch (err) {
    return res.status(502).send(`proxy error: ${String(err)}`);
  }
}
