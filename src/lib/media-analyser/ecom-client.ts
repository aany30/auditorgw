/**
 * In-process e-commerce scraper client.
 * Runs runEcomAudit() directly instead of calling a separate HTTP service.
 */
import { runEcomAudit } from "./scraper/standaloneAudit";
import { loadEcomEnv } from "./scraper/config";

export class EcomScraperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EcomScraperError";
  }
}

export class EcomScraperUnavailable extends EcomScraperError {
  constructor(message: string) {
    super(message);
    this.name = "EcomScraperUnavailable";
  }
}

export interface PollResult {
  progress?: number;
  message?: string;
  result?: Record<string, unknown>;
  error?: string;
}

// In-memory job store — survives the lifetime of this Node.js process
interface JobState {
  progress: number;
  message: string;
  result?: Record<string, unknown>;
  error?: string;
}

const jobs = new Map<string, JobState>();

export async function healthCheck(): Promise<boolean> {
  const env = loadEcomEnv();
  return !!(env.RAINFOREST_API_KEY || env.CUSTOM_SCRAPER_URL);
}

export async function startAsyncAudit(productUrl: string): Promise<string> {
  const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  jobs.set(id, { progress: 0, message: "Queued…" });

  const env = loadEcomEnv();

  // Run in background — don't await
  runEcomAudit(productUrl.trim(), env, (progress, message) => {
    jobs.set(id, { ...(jobs.get(id) ?? {}), progress, message });
  })
    .then((auditResult) => {
      jobs.set(id, {
        progress: 100,
        message: "Complete",
        result: auditResult as unknown as Record<string, unknown>,
      });
    })
    .catch((err: unknown) => {
      jobs.set(id, {
        progress: 0,
        message: "Failed",
        error: err instanceof Error ? err.message : String(err),
      });
    });

  return id;
}

export async function pollAsyncAudit(auditId: string): Promise<PollResult> {
  const job = jobs.get(auditId);
  if (!job) return { error: `Unknown audit job: ${auditId}` };
  return {
    progress: job.progress,
    message: job.message,
    result: job.result,
    error: job.error,
  };
}

export async function startAsyncCrossAudit(productUrl: string): Promise<string> {
  return startAsyncAudit(productUrl);
}

export async function pollAsyncCrossAudit(auditId: string): Promise<PollResult> {
  return pollAsyncAudit(auditId);
}

export async function fetchEcomAudit(productUrl: string): Promise<Record<string, unknown>> {
  const env = loadEcomEnv();
  try {
    const result = await runEcomAudit(productUrl.trim(), env);
    return result as unknown as Record<string, unknown>;
  } catch (err) {
    throw new EcomScraperError(err instanceof Error ? err.message : String(err));
  }
}
