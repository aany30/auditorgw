import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapApifyAdItem, parseAdLibraryUrlParams, adLibraryUrlHasTargeting } from "./paid-ad-mapper";
import {
  buildPaidAdBuckets,
  classifyDurationBucket,
  classifyPlatformBucket,
  enrichPaidAd,
  computeRunningDays,
} from "./paid-ad-buckets";

describe("mapApifyAdItem", () => {
  it("maps full Apify item with platforms and dates", () => {
    const ad = mapApifyAdItem({
      ad_archive_id: "1234567890",
      page_name: "Pepsi",
      ad_creative_bodies: ["Refresh your summer"],
      ad_creative_link_titles: ["Pepsi Max"],
      images: ["https://example.com/img.jpg"],
      publisher_platforms: ["facebook", "instagram"],
      ad_delivery_start_time: "2025-01-15",
      ad_delivery_stop_time: null,
      is_active: true,
      cta_text: "Shop now",
      page_id: "999",
      categories: ["UNKNOWN"],
      estimated_audience_size: { lower_bound: 10000, upper_bound: 50000 },
    });
    assert.ok(ad);
    assert.equal(ad.pageName, "Pepsi");
    assert.deepEqual(ad.publisherPlatforms, ["facebook", "instagram"]);
    assert.equal(ad.startTime, "2025-01-15");
    assert.equal(ad.isActive, true);
    assert.equal(ad.audienceSizeMin, 10000);
    assert.equal(ad.audienceSizeMax, 50000);
  });

  it("keeps dynamic/DCO ads but strips the {{...}} placeholders", () => {
    // These are real, running ads (common for ecom catalog campaigns) — dropping
    // them silently undercounted a competitor's ad volume. Keep them, cleaned.
    const ad = mapApifyAdItem({
      ad_archive_id: "123",
      ad_creative_bodies: ["Buy {{product.name}}"],
      ad_creative_link_titles: ["Sale"],
      ad_delivery_start_time: "2026-06-01",
    });
    assert.ok(ad, "dynamic ad should be kept, not dropped");
    assert.equal(ad?.body, "Buy");
    assert.equal(ad?.title, "Sale");
    assert.equal(ad?.adId, "123");
  });

  it("drops only truly empty items (no id, no creative)", () => {
    assert.equal(mapApifyAdItem({ ad_creative_bodies: [], ad_creative_link_titles: [] }), null);
  });
});

describe("parseAdLibraryUrlParams", () => {
  it("extracts q and country from keyword search URL", () => {
    const p = parseAdLibraryUrlParams(
      "https://www.facebook.com/ads/library/?active_status=active&country=ALL&q=nike&search_type=keyword_unordered",
    );
    assert.equal(p.q, "nike");
    assert.equal(p.country, "ALL");
    assert.equal(p.activeStatus, "active");
    assert.equal(adLibraryUrlHasTargeting("https://facebook.com/ads/library/?q=nike"), true);
  });

  it("extracts view_all_page_id from page URL", () => {
    const p = parseAdLibraryUrlParams(
      "https://www.facebook.com/ads/library/?view_all_page_id=15087023444&active_status=active",
    );
    assert.equal(p.viewAllPageId, "15087023444");
    assert.equal(adLibraryUrlHasTargeting("https://facebook.com/ads/library/?active_status=active"), false);
  });
});

describe("paid-ad-buckets", () => {
  it("classifies platform buckets", () => {
    assert.equal(classifyPlatformBucket(["facebook"]), "facebook_only");
    assert.equal(classifyPlatformBucket(["instagram"]), "instagram_only");
    assert.equal(classifyPlatformBucket(["facebook", "instagram"]), "multi_platform");
    assert.equal(classifyPlatformBucket([]), "other");
  });

  it("classifies duration buckets", () => {
    assert.equal(classifyDurationBucket(3), "new");
    assert.equal(classifyDurationBucket(14), "recent");
    assert.equal(classifyDurationBucket(45), "established");
    assert.equal(classifyDurationBucket(120), "long_running");
    assert.equal(classifyDurationBucket(null), "unknown");
  });

  it("builds status + platform + duration groups", () => {
    const now = new Date();
    const recentStart = new Date(now.getTime() - 5 * 86_400_000).toISOString().slice(0, 10);
    const longStart = new Date(now.getTime() - 100 * 86_400_000).toISOString().slice(0, 10);

    const ads = [
      enrichPaidAd(mapApifyAdItem({
        ad_archive_id: "a1",
        page_name: "Brand",
        ad_creative_bodies: ["A"],
        images: ["https://x.com/1.jpg"],
        publisher_platforms: ["instagram"],
        ad_delivery_start_time: recentStart,
        is_active: true,
      })!),
      enrichPaidAd(mapApifyAdItem({
        ad_archive_id: "a2",
        page_name: "Brand",
        ad_creative_bodies: ["B"],
        images: ["https://x.com/2.jpg"],
        publisher_platforms: ["facebook", "instagram"],
        ad_delivery_start_time: longStart,
        is_active: true,
      })!),
      enrichPaidAd(mapApifyAdItem({
        ad_archive_id: "a3",
        page_name: "Brand",
        ad_creative_bodies: ["C"],
        images: ["https://x.com/3.jpg"],
        publisher_platforms: ["facebook"],
        ad_delivery_start_time: longStart,
        is_active: false,
        ad_delivery_stop_time: recentStart,
      })!),
    ];

    const { groups, summary } = buildPaidAdBuckets(ads);
    assert.equal(summary.active, 2);
    assert.equal(summary.inactive, 1);
    assert.ok(groups.length >= 2);
    assert.equal(groups.reduce((n, g) => n + g.count, 0), 3);
  });

  it("computes running days for inactive ad using stop time", () => {
    const days = computeRunningDays({
      startTime: "2025-01-01",
      stopTime: "2025-01-31",
      isActive: false,
      status: "INACTIVE",
    });
    assert.equal(days, 30);
  });
});
