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
  /** Number of retry attempts AFTER the initial call. Defaults to delays.length. */
  retries?: number;
  /** Explicit delays in ms between attempts. Overrides `longBackoff`. Default [5000, 20000]. */
  delays?: number[];
  /** Called with (attemptNumber, error) between retries. Useful for logging. */
  onRetry?: (attempt: number, error: Error) => void;
  /** Switch to `[15s, 60s, 180s]` delays — aligned with Meta's ~2-3 min throttle
   *  recovery. Use for the three heavy endpoints that repeatedly hit
   *  "Service temporarily unavailable": ad-insights, adsets, non-daily breakdowns. */
  longBackoff?: boolean;
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
  // Standard default: 2 retries, ~25s budget. Handles genuine transient blips.
  // longBackoff: single 20s retry — one shot at Meta's fast-recovery window.
  // If Meta hasn't recovered in 20s, backing off 4+ min blindly wastes quota
  // (burns 3-4x more Meta calls) AND makes the user wait 8+ minutes only to
  // often still fail. Better to surface the throttled empty state fast and
  // let the user click Retry when the quota chip shows recovery — a manual
  // retry only re-fires failed chunks (cached chunks are served instantly),
  // and the user can pick a moment when Meta is actually ready.
  const delays = opts.delays ?? (opts.longBackoff ? [20000] : [5000, 20000]);
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
// 4. Meta throttle tracker — parses X-Business-Use-Case-Usage responses so
//    (a) the UI can display current quota usage, and (b) callers can back
//    off adaptively when we're near the throttle wall.
// ─────────────────────────────────────────────────────────────────────────────

export interface MetaQuotaState {
  /** call_count percentage from Meta (0-100) */
  callPct: number;
  /** total_cputime percentage from Meta (0-100) */
  cpuPct: number;
  /** total_time percentage from Meta (0-100) */
  timePct: number;
  /** Meta's suggested cool-down in seconds if throttled (from estimated_time_to_regain_access), or 0 if none */
  estCooldownSec: number;
  /** Milliseconds since epoch when this record was last updated */
  updatedAt: number;
}

class MetaThrottleTracker {
  private byAccount = new Map<string, MetaQuotaState>();

  /** Called by MetaApiClient after every response with the raw header value. */
  recordFromHeader(accountId: string, headerValue: string | null | undefined): MetaQuotaState | undefined {
    if (!headerValue || !accountId) return undefined;
    try {
      const parsed = JSON.parse(headerValue) as Record<string, unknown>;
      // Header shape is {"<biz-or-account-id>": [{call_count, total_cputime, total_time, ...}]}
      // Only one key typically; grab the first non-empty array.
      let entry: Record<string, unknown> | undefined;
      for (const val of Object.values(parsed)) {
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object" && val[0]) {
          entry = val[0] as Record<string, unknown>;
          break;
        }
      }
      if (!entry) return undefined;
      const num = (k: string): number => {
        const v = entry![k];
        return typeof v === "number" ? v : (typeof v === "string" ? parseInt(v, 10) || 0 : 0);
      };
      const state: MetaQuotaState = {
        callPct: num("call_count"),
        cpuPct: num("total_cputime"),
        timePct: num("total_time"),
        estCooldownSec: num("estimated_time_to_regain_access"),
        updatedAt: Date.now(),
      };
      this.byAccount.set(accountId, state);
      return state;
    } catch {
      return undefined;
    }
  }

  get(accountId: string): MetaQuotaState | undefined {
    return this.byAccount.get(accountId);
  }

  /** Peak percentage across the three counters — the safest single number for the UI chip. */
  peakPct(accountId: string): number {
    const s = this.byAccount.get(accountId);
    if (!s) return 0;
    return Math.max(s.callPct, s.cpuPct, s.timePct);
  }

  /** True if any counter is >= threshold (default 80). */
  isNearWall(accountId: string, threshold = 80): boolean {
    return this.peakPct(accountId) >= threshold;
  }
}

export const metaThrottle = new MetaThrottleTracker();

// ─────────────────────────────────────────────────────────────────────────────
// 5. Convenience helper — the full "safe fetch" wrapper
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

/**
 * Race a task against a hard timeout — aborts the underlying work on timeout
 * so the semaphore slot and network connection are released immediately.
 *
 * The old fire-and-race version leaked semaphore slots: a timed-out fetch
 * kept running to completion, so with 20 chunks × 45s timeouts, effective
 * concurrency dropped from 3 to 0-1 within seconds of hitting throttle.
 *
 * Usage: pass a `taskFactory` that receives the AbortSignal and forwards it
 * to `fetch(url, { signal })`. When the timer fires we `abort()` the signal
 * and Node's fetch rejects synchronously, freeing the slot.
 *
 *   const rows = await withAbortTimeout(
 *     (signal) => metaFetch(token, path, params, signal),
 *     45_000,
 *     [] as Row[],
 *   );
 */
export async function withAbortTimeout<T>(
  taskFactory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      try { controller.abort(); } catch {}
      resolve(fallback);
    }, timeoutMs);
  });
  try {
    const winner = await Promise.race([
      taskFactory(controller.signal).catch(() => fallback),
      timeoutPromise,
    ]);
    return winner;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Backward-compatible wrapper for call sites that already have a Promise in
 * hand and can't easily accept a signal. Same semantics as the old
 * `withTimeout`, kept for compatibility. Prefer `withAbortTimeout` for new
 * code so the underlying work is actually cancelled on timeout.
 *
 * @deprecated Use `withAbortTimeout` with a signal-aware task factory.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(fallback);
    }, timeoutMs);
    promise.then(
      (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
      () => { if (!done) { done = true; clearTimeout(timer); resolve(fallback); } },
    );
  });
}
