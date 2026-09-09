/**
 * Shared utilities for Meta API endpoints — retry, cache, concurrency.
 *
 * Three concerns, one file so callers only import from one place:
 *   1. metaRetry()    — exponential backoff on transient 5xx errors and
 *                       Meta's "Service temporarily unavailable" / "Please
 *                       reduce the amount of data" responses.
 *   2. metaCache      — process-memory Map with per-key TTL (15 min default).
 *                       Prevents reload storms and cuts identical calls to
 *                       Meta on quick refreshes.
 *   3. metaSemaphore  — global concurrency cap so we never fire more than N
 *                       Meta requests in parallel (self-throttle protection).
 *                       Applies across ALL endpoints via a single shared
 *                       instance.
 *
 * Usage inside an API route:
 *
 *   const cached = metaCache.get<Rows>(cacheKey);
 *   if (cached) return res.status(200).json({ source: "cache", rows: cached });
 *
 *   const rows = await metaRetry(() =>
 *     metaSemaphore.run(() => fetchAdSets(...))
 *   );
 *
 *   metaCache.set(cacheKey, rows);
 *   return res.status(200).json({ source: "live", rows });
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Exponential-backoff retry
// ─────────────────────────────────────────────────────────────────────────────

interface RetryOptions {
  /** Number of retry attempts AFTER the initial call. Default 3 (so 4 total tries). */
  retries?: number;
  /** Delays in ms between attempts. Default [5000, 15000, 45000]. */
  delays?: number[];
  /** Called with (attemptNumber, error) between retries. Useful for logging. */
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Predicate for whether an error is worth retrying. We retry on:
 *   - Explicit Meta 5xx "Service temporarily unavailable" throttle
 *   - Meta 502 Bad Gateway
 *   - Payload cap "Please reduce the amount of data" (this one WON'T succeed
 *     via retry alone, but we retry once in case Meta's aggregation is
 *     transient before falling through to caller's chunking logic)
 *   - Network errors (fetch failed / connection reset)
 *
 * We do NOT retry on:
 *   - 401 / 403 (auth or permission issue — retrying won't help)
 *   - 400 with a specific parameter error (bad input)
 *   - 4xx quota exhaustion (permanent for the window)
 */
function shouldRetry(error: Error): boolean {
  const msg = error.message.toLowerCase();
  if (msg.includes("service temporarily unavailable")) return true;
  if (msg.includes("bad gateway")) return true;
  if (msg.includes("please reduce the amount")) return true;
  if (msg.includes("please try again")) return true;
  if (msg.includes("network") || msg.includes("econnreset") || msg.includes("etimedout")) return true;
  // Everything else — including auth errors and 4xx quota — is terminal.
  return false;
}

export async function metaRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const delays = opts.delays ?? [5000, 15000, 45000];
  const retries = opts.retries ?? delays.length;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt === retries || !shouldRetry(lastErr)) throw lastErr;
      opts.onRetry?.(attempt + 1, lastErr);
      const delay = delays[Math.min(attempt, delays.length - 1)];
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  // Unreachable, but TypeScript wants a return here.
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Process-memory cache with TTL
// ─────────────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class MetaCache {
  private store = new Map<string, CacheEntry<unknown>>();
  /** Default TTL in ms — 15 minutes. */
  private defaultTtlMs = 15 * 60 * 1000;
  /** Cap size to prevent runaway memory use if many accounts hit the process. */
  private maxEntries = 500;

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    if (this.store.size >= this.maxEntries) {
      // Evict the oldest entry (Map preserves insertion order).
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs) });
  }

  /** Clear all entries for a given account (useful when the user disconnects). */
  invalidateAccount(accountId: string): void {
    const prefix = `${accountId}::`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  /** Diagnostics helper — how many keys are cached right now. */
  size(): number {
    return this.store.size;
  }
}

/**
 * Shared cache instance. Lives in the Node process; survives HMR reloads in
 * dev, resets on server restart or production deploy. For persistent cache
 * across restarts, add a filesystem or Redis backing later.
 */
export const metaCache = new MetaCache();

/** Build a cache key that uniquely identifies this request shape. */
export function cacheKey(accountId: string, endpoint: string, extra: Record<string, string | undefined> = {}): string {
  const parts = [accountId, endpoint];
  for (const k of Object.keys(extra).sort()) {
    const v = extra[k];
    if (v) parts.push(`${k}=${v}`);
  }
  return parts.join("::");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Concurrency semaphore
// ─────────────────────────────────────────────────────────────────────────────

class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(private maxConcurrent: number) {
    this.available = maxConcurrent;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    // When our turn comes, resolve() runs and we already have a slot.
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the slot directly to the waiter, don't increment available.
      next();
    } else {
      this.available++;
    }
  }
}

/**
 * Global Meta API concurrency limiter. Cap at 3 in-flight requests across
 * ALL endpoints — this is per-Node-process. Prevents us from firing 10
 * parallel breakdown calls that all get throttled together.
 */
export const metaSemaphore = new Semaphore(3);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Convenience helper — the full "safe fetch" wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The typical call pattern: acquire the semaphore, retry on transient errors,
 * throw otherwise. Callers still handle the terminal error themselves.
 *
 *   const data = await metaSafeCall(() => fetchAdSets(accessToken, ...));
 */
export async function metaSafeCall<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  return metaRetry(() => metaSemaphore.run(fn), opts);
}

/**
 * Split an array into chunks of a given size. Used to split campaign lists
 * for Meta endpoints that hit "Please reduce the amount of data" errors.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
