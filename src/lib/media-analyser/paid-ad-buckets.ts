import type { PaidAdBucketGroup, PaidAdsSummary, SocialPaidAd } from "./types";
import type { SocialPaidAdLike } from "./paid-ad-mapper";

export type DurationBucket = "new" | "recent" | "established" | "long_running" | "unknown";
export type PlatformBucket = "facebook_only" | "instagram_only" | "multi_platform" | "other";
export type StatusBucket = "active" | "inactive";

export type { PaidAdBucketGroup, PaidAdsSummary };

export interface PaidAdBucketThresholds {
  newDays: number;
  recentDays: number;
  establishedDays: number;
}

export const PLATFORM_LABELS: Record<PlatformBucket, string> = {
  facebook_only: "Facebook only",
  instagram_only: "Instagram only",
  multi_platform: "Multi-platform",
  other: "Other platforms",
};

export const DURATION_LABELS: Record<DurationBucket, string> = {
  new: "New",
  recent: "Recent",
  established: "Established",
  long_running: "Long-running",
  unknown: "Unknown duration",
};

export function paidAdBucketThresholds(): PaidAdBucketThresholds {
  return {
    newDays: parseInt(process.env.PAID_AD_NEW_DAYS ?? "7", 10) || 7,
    recentDays: parseInt(process.env.PAID_AD_RECENT_DAYS ?? "30", 10) || 30,
    establishedDays: parseInt(process.env.PAID_AD_ESTABLISHED_DAYS ?? "90", 10) || 90,
  };
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

export function computeRunningDays(ad: SocialPaidAdLike, now = new Date()): number | null {
  const start = parseDate(ad.startTime);
  if (!start) return null;
  const end = ad.isActive === false || String(ad.status ?? "").toUpperCase() === "INACTIVE"
    ? (parseDate(ad.stopTime) ?? now)
    : now;
  return daysBetween(start, end);
}

export function classifyPlatformBucket(platforms: string[] | undefined): PlatformBucket {
  const normalized = (platforms ?? []).map(p => p.toLowerCase());
  if (!normalized.length) return "other";

  const hasFb = normalized.some(p => p.includes("facebook"));
  const hasIg = normalized.some(p => p.includes("instagram"));
  const count = normalized.length;

  if (count >= 2 || (hasFb && hasIg)) return "multi_platform";
  if (hasIg && !hasFb) return "instagram_only";
  if (hasFb && !hasIg) return "facebook_only";
  return "other";
}

export function classifyDurationBucket(runningDays: number | null, thresholds = paidAdBucketThresholds()): DurationBucket {
  if (runningDays == null) return "unknown";
  if (runningDays < thresholds.newDays) return "new";
  if (runningDays < thresholds.recentDays) return "recent";
  if (runningDays < thresholds.establishedDays) return "established";
  return "long_running";
}

export function enrichPaidAd(ad: SocialPaidAdLike): SocialPaidAd {
  const runningDays = computeRunningDays(ad);
  const platformBucket = classifyPlatformBucket(ad.publisherPlatforms);
  const durationBucket = classifyDurationBucket(runningDays);
  const isActive = ad.isActive ?? String(ad.status ?? "").toUpperCase() !== "INACTIVE";

  return {
    // Spread first so already-attached fields (e.g. adCreativeAnalysis from the
    // Gemini per-ad pass) survive re-enrichment; explicit fields below override.
    ...ad,
    adId: ad.adId ?? "",
    adName: ad.adName ?? "",
    platform: ad.platform ?? "meta",
    pageName: ad.pageName ?? "",
    title: ad.title ?? "",
    body: ad.body ?? "",
    imageUrl: ad.imageUrl ?? null,
    thumbnailUrl: ad.thumbnailUrl ?? null,
    videoUrl: ad.videoUrl ?? null,
    mediaType: ad.mediaType ?? null,
    startTime: ad.startTime ?? null,
    stopTime: ad.stopTime ?? null,
    linkUrl: ad.linkUrl ?? null,
    cta: ad.cta ?? null,
    status: isActive ? "ACTIVE" : "INACTIVE",
    isActive,
    instagramUrl: ad.instagramUrl ?? null,
    matchReason: ad.matchReason ?? null,
    publisherPlatforms: ad.publisherPlatforms ?? [],
    runningDays,
    durationBucket,
    platformBucket,
    adSnapshotUrl: ad.adSnapshotUrl ?? null,
    pageId: ad.pageId ?? null,
    categories: ad.categories ?? [],
    pageCategories: ad.pageCategories ?? [],
    audienceSizeMin: ad.audienceSizeMin ?? null,
    audienceSizeMax: ad.audienceSizeMax ?? null,
  };
}

export interface PlatformIcon {
  key: string;
  short: string;
  label: string;
}

export function formatPlatformIcons(platforms: string[] | undefined): PlatformIcon[] {
  const normalized = (platforms ?? []).map(p => p.toLowerCase().trim()).filter(Boolean);
  if (!normalized.length) {
    return [{ key: "all", short: "All", label: "All platforms" }];
  }

  const icons: PlatformIcon[] = [];
  const seen = new Set<string>();

  for (const p of normalized) {
    if (p.includes("facebook") && !seen.has("facebook")) {
      seen.add("facebook");
      icons.push({ key: "facebook", short: "FB", label: "Facebook" });
    } else if (p.includes("instagram") && !seen.has("instagram")) {
      seen.add("instagram");
      icons.push({ key: "instagram", short: "IG", label: "Instagram" });
    } else if (p.includes("messenger") && !seen.has("messenger")) {
      seen.add("messenger");
      icons.push({ key: "messenger", short: "Msg", label: "Messenger" });
    } else if (p.includes("audience") && !seen.has("audience")) {
      seen.add("audience");
      icons.push({ key: "audience", short: "AN", label: "Audience Network" });
    } else if (!seen.has(p)) {
      seen.add(p);
      icons.push({ key: p, short: p.slice(0, 3), label: p });
    }
  }
  return icons;
}

export function formatPaidAdMetaLine(ad: SocialPaidAd): string {
  const status = ad.isActive ? "Active" : "Inactive";
  const platforms = (ad.publisherPlatforms ?? []).length
    ? formatPlatformIcons(ad.publisherPlatforms).map(i => i.short).join("+")
    : "All platforms";

  const parts = [
    ad.pageName || "Meta ad",
    ad.cta,
    status,
    platforms,
  ].filter(Boolean);

  if (ad.runningDays != null) {
    const since = ad.startTime ? `since ${ad.startTime.slice(0, 10)}` : "";
    parts.push(`Running ${ad.runningDays}d${since ? ` (${since})` : ""}`);
  } else if (ad.startTime) {
    parts.push(`Since ${ad.startTime.slice(0, 10)}`);
  }

  if (ad.audienceSizeMin != null || ad.audienceSizeMax != null) {
    const min = ad.audienceSizeMin?.toLocaleString() ?? "?";
    const max = ad.audienceSizeMax?.toLocaleString() ?? "?";
    parts.push(`Audience ${min}–${max}`);
  }

  return parts.join(" · ");
}

export function buildPaidAdBuckets(ads: SocialPaidAd[]): {
  groups: PaidAdBucketGroup[];
  summary: PaidAdsSummary;
} {
  const summary: PaidAdsSummary = {
    active: 0,
    inactive: 0,
    byPlatform: { facebook_only: 0, instagram_only: 0, multi_platform: 0, other: 0 },
    byDuration: { new: 0, recent: 0, established: 0, long_running: 0, unknown: 0 },
  };

  const map = new Map<string, PaidAdBucketGroup>();

  for (const ad of ads) {
    const status: StatusBucket = ad.isActive ? "active" : "inactive";
    if (status === "active") summary.active++;
    else summary.inactive++;

    const platformBucket = (ad.platformBucket ?? "other") as PlatformBucket;
    const durationBucket = (ad.durationBucket ?? "unknown") as DurationBucket;
    summary.byPlatform[platformBucket] = (summary.byPlatform[platformBucket] ?? 0) + 1;
    summary.byDuration[durationBucket] = (summary.byDuration[durationBucket] ?? 0) + 1;

    const key = `${status}_${platformBucket}_${durationBucket}`;
    const label = `${status === "active" ? "Active" : "Inactive"} · ${PLATFORM_LABELS[platformBucket]} · ${DURATION_LABELS[durationBucket]}`;

    const existing = map.get(key);
    if (existing) {
      existing.ads.push(ad);
      existing.count++;
    } else {
      map.set(key, {
        key,
        label,
        status,
        platformBucket,
        durationBucket,
        count: 1,
        ads: [ad],
      });
    }
  }

  const statusOrder: StatusBucket[] = ["active", "inactive"];
  const platformOrder: PlatformBucket[] = ["multi_platform", "facebook_only", "instagram_only", "other"];
  const durationOrder: DurationBucket[] = ["new", "recent", "established", "long_running", "unknown"];

  const groups = [...map.values()].sort((a, b) => {
    const si = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
    if (si !== 0) return si;
    const pi = platformOrder.indexOf(a.platformBucket) - platformOrder.indexOf(b.platformBucket);
    if (pi !== 0) return pi;
    return durationOrder.indexOf(a.durationBucket) - durationOrder.indexOf(b.durationBucket);
  });

  return { groups, summary };
}
