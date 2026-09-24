import type { PlatformId } from './types';
import { getPlatformDefinition } from './definitions';

const HOST_MAP: Array<{ platform: PlatformId; patterns: RegExp[] }> = [
  { platform: 'amazon', patterns: [/amazon\.(com|in|co\.uk|de|fr|ca|com\.au)/i, /amzn\.(to|eu|asia)/i] },
  { platform: 'flipkart', patterns: [/flipkart\.com/i] },
  { platform: 'myntra', patterns: [/myntra\.com/i] },
  { platform: 'nykaa', patterns: [/nykaa\.com/i] },
  { platform: 'croma', patterns: [/croma\.com/i] },
];

export function detectPlatform(input: string): PlatformId | null {
  const text = input.trim();
  if (!text) return null;
  if (/^[A-Z0-9]{10}$/i.test(text)) return 'amazon';
  let host = text;
  try {
    host = new URL(text.startsWith('http') ? text : `https://${text}`).hostname;
  } catch {
    return null;
  }
  for (const { platform, patterns } of HOST_MAP) {
    if (patterns.some((p) => p.test(host))) return platform;
  }
  return null;
}

export async function resolveProductUrl(input: string, platform: PlatformId): Promise<string> {
  let url = input.trim();
  if (!url.startsWith('http')) url = `https://${url}`;
  if (/amzn\./i.test(url) || platform !== 'amazon') {
    try {
      const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(12_000) });
      return resp.url || url;
    } catch {
      return url;
    }
  }
  return url;
}

export function extractProductId(url: string, platform: PlatformId): string | null {
  const def = getPlatformDefinition(platform);
  return def?.extractProductId(url) ?? null;
}
