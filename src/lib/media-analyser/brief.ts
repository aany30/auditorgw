import type {
  AnalysisResponse,
  CampaignConcept,
  EcomSnapshot,
  InstagramBrandProfile,
  RedditSnapshot,
  SocialMarketingPost,
  SocialPaidAd,
  SocialSnapshot,
} from "./types";
import { formatPaidAdMetaLine } from "./paid-ad-buckets";

const EFFORT_TAGS = ["Quick Win", "Strategic", "Medium"];
const ANALYSIS_COMPETITORS = parseInt(process.env.ECOM_ANALYSIS_COMPETITORS ?? "4", 10) || 4;

function escHtml(text: string): string {
  return (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number" && v === Math.floor(v)) return String(Math.floor(v));
  return String(v);
}

function splitEffort(text: string): [string | null, string] {
  for (const tag of EFFORT_TAGS) {
    const bracketed = new RegExp(`[\\(\\[]\\s*${tag.replace(/\s/g, "\\s+")}\\s*[\\)\\]]`, "i").exec(text);
    if (bracketed) {
      const cleaned = (text.slice(0, bracketed.index) + text.slice(bracketed.index + bracketed[0].length)).trim().replace(/^[-—:·\s]+/, "");
      return [tag, cleaned];
    }
    const leading = new RegExp(`^\\s*${tag.replace(/\s/g, "\\s+")}\\s*[:\\-—]\\s*`, "i").exec(text);
    if (leading) return [tag, text.slice(leading[0].length).trim()];
  }
  return [null, text.trim()];
}

function opportunityLine(text: string): string {
  const [tag, body] = splitEffort(text);
  return tag ? `- **${tag}** — ${body}` : `- ${body}`;
}

function topCompetitorsForTable(ecom: EcomSnapshot, limit = ANALYSIS_COMPETITORS) {
  if (!ecom.products?.length) return [];
  const allC = [...(ecom.products[0].competitors ?? [])];
  const deep = allC.filter(c => c.deepAnalyzed);
  const rest = allC.filter(c => !c.deepAnalyzed);
  return [...deep, ...rest].slice(0, limit);
}

function mediaCard(opts: {
  imageUrl?: string | null;
  videoUrl?: string | null;
  title: string;
  metaLine: string;
  body: string;
  analysis?: string | null;
  linkUrl?: string | null;
}): string {
  const img = opts.videoUrl
    ? `<video src="${escHtml(opts.videoUrl)}" controls preload="metadata"${opts.imageUrl ? ` poster="${escHtml(opts.imageUrl)}"` : ""} style="width:100%;max-height:220px;object-fit:cover;border-radius:8px;margin-bottom:8px;background:#000;"></video>`
    : opts.imageUrl
    ? `<img src="${escHtml(opts.imageUrl)}" alt="" style="width:100%;max-height:220px;object-fit:cover;border-radius:8px;margin-bottom:8px;" />`
    : `<div style="height:120px;background:#f1f5f9;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#64748b;margin-bottom:8px;">No preview</div>`;
  const link = opts.linkUrl
    ? `<p style="margin:6px 0 0;"><a href="${escHtml(opts.linkUrl)}" target="_blank">View original</a></p>`
    : "";
  const analysisHtml = opts.analysis
    ? `<p style="margin:8px 0 0;font-size:13px;color:#334155;">${escHtml(opts.analysis)}</p>`
    : "";
  return `<div style="flex:0 1 300px;max-width:300px;border:1px solid #e2e8f0;border-radius:10px;padding:12px;background:#fff;">${img}<p style="margin:0 0 4px;font-weight:600;font-size:14px;">${escHtml(opts.title)}</p><p style="margin:0 0 6px;font-size:12px;color:#64748b;">${escHtml(opts.metaLine)}</p><p style="margin:0;font-size:13px;line-height:1.45;color:#1e293b;">${escHtml((opts.body ?? "").slice(0, 320))}</p>${analysisHtml}${link}</div>`;
}

export function formatOverview(result: AnalysisResponse): string {
  const recs = result.recommendations;
  const rationale = recs.llmRationale ?? [];
  const lines: string[] = [
    `**${result.summary.headline}**`,
    "",
    "## Key Findings",
    ...(result.summary.keyFindings ?? []).map(item => `- ${item}`),
    "",
    "## Opportunities",
    ...(recs.opportunities ?? []).map(item => opportunityLine(item)),
    "",
    "## Risks",
    ...(recs.risks ?? []).map(item => `- ${item}`),
    "",
    "## Recommended Actions",
    ...(recs.recommendedActions ?? []).map(item => `- ${item}`),
  ];
  if (recs.llmRecommendations?.length) {
    lines.push("", "## Strategic Plays");
    recs.llmRecommendations.forEach((play, i) => {
      lines.push(`- ${play}`);
      if (i < rationale.length && rationale[i]?.trim()) {
        lines.push(`  - *Rationale:* ${rationale[i]}`);
      }
    });
  }
  if (recs.llmError && !recs.llmUsed) {
    lines.push("", `_LLM enrichment unavailable (${recs.llmError}); showing deterministic analysis._`);
  }
  lines.push("", "_Use the tabs above for **Instagram**, **Paid ads**, **Social**, **Reddit**, and **Competitors**._");
  return lines.join("\n");
}

export function formatInstagramBrandDna(social: SocialSnapshot | null | undefined): string {
  const p = social?.instagramBrandProfile as InstagramBrandProfile | null | undefined;
  if (!p?.analyzedPostCount) return "";

  const lines: string[] = [
    "# Instagram Brand Book",
    "",
    `_Synthesized from **${p.analyzedPostCount}** Instagram posts — visual image analysis + caption voice extraction._`,
    "",
    "---",
    "",
  ];

  // ── SECTION 1: BRAND IDENTITY ──────────────────────────────────────────────
  lines.push("## Brand Identity", "");
  if (p.brandName) lines.push(`**Brand:** ${p.brandName}`);
  if (p.industry) lines.push(`**Industry:** ${p.industry}`);
  if (p.tagline) lines.push(`**Tagline:** _${p.tagline}_`);
  if (p.valueProposition) lines.push(`**Value proposition:** ${p.valueProposition}`);
  if (p.targetAudience) lines.push(`**Target audience:** ${p.targetAudience}`);
  lines.push("");

  // ── SECTION 2: BRAND VOICE ─────────────────────────────────────────────────
  if (p.toneOfVoice?.length || p.brandPersonality?.length || p.keyMessages?.length) {
    lines.push("## Brand Voice & Messaging", "");
    if (p.toneOfVoice?.length) {
      lines.push(`**Tone of voice:** ${p.toneOfVoice.map(t => `\`${t}\``).join("  ")}`);
    }
    if (p.brandPersonality?.length) {
      lines.push(`**Brand personality:** ${p.brandPersonality.map(t => `\`${t}\``).join("  ")}`);
    }
    if (p.keyMessages?.length) {
      lines.push("", "**Key messages:**");
      for (const m of p.keyMessages) lines.push(`- ${m}`);
    }
    lines.push("");
  }

  // ── SECTION 3: VISUAL IDENTITY ─────────────────────────────────────────────
  lines.push("## Visual Identity", "");
  if (p.primaryColors?.length) {
    lines.push(`**Primary palette:** ${p.primaryColors.map(c => `\`${c}\``).join("  ")}`);
  }
  if (p.secondaryColors?.length) {
    lines.push(`**Secondary palette:** ${p.secondaryColors.map(c => `\`${c}\``).join("  ")}`);
  }
  if (p.dominantMood) lines.push(`**Dominant mood:** \`${p.dominantMood}\``);
  if (p.imageryStyle) lines.push(`**Imagery style:** ${p.imageryStyle}`);
  if (p.layoutStyle) lines.push(`**Layout style:** ${p.layoutStyle}`);
  if (p.brandConsistencyScore != null) lines.push(`**Visual consistency score:** ${p.brandConsistencyScore}/100`);
  if (p.textOverlayRate != null) lines.push(`**Text overlay rate:** ${p.textOverlayRate}% of posts`);
  lines.push("");

  // ── SECTION 4: CONTENT STRATEGY ────────────────────────────────────────────
  if (p.contentPillars?.length) {
    lines.push("## Content Strategy", "");
    lines.push("**Content pillars:**", "", "| Pillar | Share | Avg interactions/post |", "|--------|-------|----------------|");
    for (const pillar of p.contentPillars.slice(0, 6)) {
      const er = pillar.avgEngagementRate != null ? `${Math.round(pillar.avgEngagementRate).toLocaleString()}` : "—";
      lines.push(`| ${pillar.name} | ${pillar.percentage}% | ${er} |`);
    }
    lines.push("");
  }

  if (p.topPerformingFormats?.length) {
    lines.push("**Top-performing format combinations (by engagement):**");
    for (const fmt of p.topPerformingFormats.slice(0, 5)) lines.push(`- ${fmt}`);
    lines.push("");
  }

  if (p.topFormats?.length) {
    lines.push(`**Top content types:** ${p.topFormats.join(" · ")}`);
    lines.push("");
  }

  // ── SECTION 5: CAMPAIGN CONCEPTS ───────────────────────────────────────────
  if (p.campaignConcepts?.length) {
    lines.push("## Campaign Concepts", "", "_4 ready-to-execute Instagram campaign ideas tailored to this brand's DNA._", "");
    for (let i = 0; i < p.campaignConcepts.length; i++) {
      const c = p.campaignConcepts[i];
      lines.push(`### ${i + 1}. ${c.title}`, "");
      lines.push(`**Theme:** ${c.theme}`);
      lines.push(`**Key message:** ${c.keyMessage}`);
      lines.push(`**Hook:** _"${c.hook}"_`);
      lines.push(`**CTA:** ${c.cta}`);
      if (c.recommendedFormats?.length) lines.push(`**Formats:** ${c.recommendedFormats.join(", ")}`);
      lines.push(`**Tone:** ${c.toneNotes}`);
      lines.push(`**Visual direction:** ${c.visualDirection}`);
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
}

export function formatInstagramProductPosts(social: SocialSnapshot | null | undefined): string {
  if (!social) return "";
  let posts: SocialMarketingPost[] = [...(social.instagramProductPosts ?? [])];
  if (!posts.length) {
    posts = (social.marketingPosts ?? []).filter(p => p.platform?.toLowerCase() === "instagram");
  }
  const lines = [
    "## Instagram posts about this product",
    "",
    "_Posts from Instagram matching this product's brand, title, or key terms (via Apify hashtag search or brand profile)._",
    "",
  ];
  if (!posts.length) {
    const fetched = social.instagramFetchedCount ?? 0;
    const total = social.totalFetchedCount ?? fetched;
    lines.push(
      total > 0
        ? `No posts mention this exact product URL/title, but **${total}** brand posts were fetched — see **How you market this product** below for recent IG/FB content.`
        : "No Instagram posts returned. Turn on **Apify public scrape** and set `APIFY_API_TOKEN` plus optional `BRAND_INSTAGRAM_URL` in `.env`."
    );
    return lines.join("\n");
  }
  lines.push(`**${posts.length}** post(s) matched this product.\n`);
  lines.push('<div style="display:flex;flex-wrap:wrap;gap:14px;margin:12px 0;">');
  const sorted = [...posts].sort((a, b) => ((b.engagementRate ?? 0) - (a.engagementRate ?? 0)) || ((b.likes + b.comments) - (a.likes + a.comments)));
  for (const p of sorted.slice(0, 8)) {
    let meta = `${p.format} · ${p.likes.toLocaleString()} likes · ${p.comments.toLocaleString()} comments`;
    if (p.engagementRate !== null && p.engagementRate !== undefined) meta += ` · ${p.engagementRate}% ER`;
    if (p.publishedAt) meta += ` · ${p.publishedAt.slice(0, 10)}`;
    lines.push(mediaCard({ imageUrl: p.imageUrl ?? p.thumbnailUrl, title: p.marketingAngle ?? "Product post", metaLine: meta, body: p.captionSnippet ?? p.hook ?? "—", analysis: p.postAnalysis ?? p.hook, linkUrl: p.postUrl || null }));
  }
  lines.push("</div>");
  return lines.join("\n");
}

export function formatPaidAdsSection(social: SocialSnapshot | null | undefined): string {
  if (!social) return "";
  const ads: SocialPaidAd[] = [...(social.paidAds ?? [])];
  const analysis = social.paidAdsAnalysis ?? "";
  const summary = social.paidAdsSummary as { active?: number; inactive?: number; byPlatform?: Record<string, number>; byDuration?: Record<string, number> } | null | undefined;
  const buckets = (social.paidAdBuckets ?? []) as Array<{ label: string; count: number; ads: SocialPaidAd[] }>;
  const lines = [
    "## Paid ads (Meta)",
    "",
    "_Paid creatives from your ad account or Meta Ad Library (product/brand filtered)._",
    "",
  ];
  if (!ads.length) {
    lines.push("No paid ads found for this brand in the Meta Ads Library. This can mean the brand has no active campaigns, or the brand name could not be resolved to a Facebook Page. Re-run the analysis to retry.");
    return lines.join("\n");
  }
  lines.push(`**${ads.length}** ad(s) matched this product.\n`);

  if (summary) {
    lines.push("### Bucket summary", "");
    lines.push(`- **Active:** ${summary.active ?? 0} · **Inactive:** ${summary.inactive ?? 0}`);
    const plat = Object.entries(summary.byPlatform ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${k.replace(/_/g, " ")} (${n})`).join(", ");
    const dur = Object.entries(summary.byDuration ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${k.replace(/_/g, " ")} (${n})`).join(", ");
    if (plat) lines.push(`- **Platforms:** ${plat}`);
    if (dur) lines.push(`- **Duration:** ${dur}`);
    lines.push("");
  }

  const groups = buckets.length ? buckets : [{ label: "All ads", count: ads.length, ads }];
  for (const group of groups) {
    if (!group.ads?.length) continue;
    lines.push(`### ${group.label} (${group.count})`, '<div style="display:flex;flex-wrap:wrap;gap:14px;margin:12px 0;">');
    for (const ad of group.ads.slice(0, 30)) {
      const meta = formatPaidAdMetaLine(ad);
      lines.push(mediaCard({
        imageUrl: ad.imageUrl ?? ad.thumbnailUrl,
        videoUrl: ad.videoUrl,
        title: ad.title || ad.adName || "Paid ad",
        metaLine: meta,
        body: ad.body || ad.title || "—",
        analysis: ad.matchReason ? `Match: ${ad.matchReason}` : null,
        linkUrl: ad.linkUrl ?? ad.instagramUrl,
      }));
    }
    lines.push("</div>", "");
  }

  if (analysis) lines.push(analysis);
  return lines.join("\n");
}

export function formatMetaMarketing(social: SocialSnapshot | null | undefined): string {
  if (!social) return "";
  const matched = social.marketingPosts ?? [];
  const n = social.productMatchedCount || social.postCount || matched.length;
  const total = social.totalFetchedCount ?? 0;
  if (n === 0 && total === 0) return "";

  const sourceMap: Record<string, string> = { meta_graph: "Meta Graph API (your connected Page/IG)", apify_public: "Instagram (Apify hashtag search)" };
  const sourceLabel = sourceMap[social.socialDataSource ?? ""] ?? "Instagram & Facebook";
  const lines = [
    `## How you market this product (${sourceLabel})`,
    "",
    `**${n}** posts matched your product URL/title (from **${total}** fetched on IG/FB in the lookback window).`,
  ];
  if (social.instagramFetchedCount || social.facebookFetchedCount) {
    lines.push(`_Sources: ${social.instagramFetchedCount ?? 0} Instagram · ${social.facebookFetchedCount ?? 0} Facebook posts scanned._`);
  }
  lines.push("");
  if (social.avgEngagementRate !== null && social.avgEngagementRate !== undefined) {
    // This figure is total interactions ÷ posts (avg interactions per post), not a
    // rate — labelling it "%" produced impossible values like 3393.8%. Show it as
    // an average interaction count instead.
    lines.push(`- Average interactions per matched post: **${Math.round(social.avgEngagementRate).toLocaleString()}**`);
  }
  if (social.byContentBucket?.length) {
    lines.push("- **Marketing angles:**");
    for (const bucket of social.byContentBucket.slice(0, 5)) {
      const er = bucket.avgEngagementRate != null ? ` (${Math.round(bucket.avgEngagementRate).toLocaleString()} avg interactions/post)` : "";
      lines.push(`  - ${bucket.key}: ${bucket.posts} posts${er}`);
    }
  }
  if (social.byFormat?.length) {
    lines.push("- **Formats:**");
    for (const fmt of social.byFormat.slice(0, 4)) lines.push(`  - ${fmt.key}: ${fmt.posts} posts`);
  }
  if (matched.length) {
    lines.push("", "| Platform | Format | Angle | ★ ER | Likes | Hook |", "|----------|--------|-------|------|-------|------|");
    for (const p of matched.slice(0, 5)) {
      const plat = (p.platform ?? "—").replace(/\|/g, "/");
      const hook = ((p.hook ?? p.captionSnippet ?? "—").replace(/\|/g, "/")).slice(0, 48);
      const angle = (p.marketingAngle ?? "—").replace(/\|/g, "/");
      lines.push(`| ${plat} | ${p.format} | ${angle} | ${fmtNum(p.engagementRate)} | ${p.likes} | ${hook} |`);
    }
  }
  if (n > 0 && social.byContentBucket?.length) {
    const topAngle = social.byContentBucket[0].key;
    lines.push("", "### Marketing playbook (quick takeaways)", `- Lead with **${topAngle}** — your strongest recurring angle for this SKU.`);
    if (social.topPosts?.length) {
      const top = social.topPosts[0];
      lines.push(`- Best-performing format: **${top.format}** on ${top.platform} (${top.engagementRate ?? "—"}% engagement).`);
    }
    lines.push("- Reuse winning hooks in Amazon bullets and A+ modules to align listing copy with social proof.");
  } else if (n === 0) {
    lines.push("\n_No posts in the lookback window mentioned this product URL or title. Try a longer `META_SOCIAL_LOOKBACK_DAYS` or verify the product appears in recent captions._");
  }
  return lines.join("\n").trimEnd();
}

export function formatRedditReviews(reddit: RedditSnapshot | null | undefined): string {
  if (!reddit) return "";
  const reviews = [...(reddit.reviews ?? [])];
  const lines = [
    "## Reddit reviews & discussions",
    "",
    "_Organic posts and comments from Reddit about this product (not brand-owned)._",
    "",
  ];
  if (reddit.searchQueries?.length) {
    lines.push(`_Search queries: ${reddit.searchQueries.slice(0, 3).map(q => `\`${q}\``).join(", ")}_\n`);
  }
  if (!reviews.length) {
    lines.push(reddit.analysisBrief ?? "No product-matched Reddit discussions found.");
    return lines.join("\n");
  }
  lines.push(
    `**${reddit.matchedCount || reviews.length}** matched items ` +
    `(${reddit.postCount ?? 0} posts, ${reddit.commentCount ?? 0} comments)` +
    (reddit.avgScore !== null && reddit.avgScore !== undefined ? ` · avg upvotes **${reddit.avgScore}**` : "") +
    "."
  );
  if (reddit.bySentiment?.length) {
    lines.push(`- Sentiment mix: ${reddit.bySentiment.slice(0, 4).map(b => `${b.key}: ${b.posts}`).join(", ")}`);
  }
  if (reddit.analysisBrief) lines.push("", "### Analysis", "", reddit.analysisBrief, "");
  lines.push("", "### Top discussions", "");
  for (const r of [...reviews].sort((a, b) => b.score - a.score).slice(0, 8)) {
    const sub = r.subreddit || "reddit";
    const kind = r.kind === "comment" ? "comment" : "post";
    const sent = r.sentiment ? ` · ${r.sentiment}` : "";
    let title = (r.title || r.body.slice(0, 60) || "—").replace(/\|/g, "/");
    if (title.length > 70) title = title.slice(0, 67) + "…";
    let body = (r.body || "—").replace(/\|/g, "/").replace(/\n/g, " ");
    if (body.length > 160) body = body.slice(0, 157) + "…";
    const link = r.url ? `[r/${sub}](${r.url})` : `r/${sub}`;
    lines.push(`- **${link}** (${kind}${sent}, ▲${r.score}) — ${title}`);
    lines.push(`  - ${body}`);
  }
  return lines.join("\n");
}

export function formatCompetitiveLandscape(ecom: EcomSnapshot | null | undefined, limit = ANALYSIS_COMPETITORS): string {
  if (!ecom?.products?.length) return "";
  const product = ecom.products[0];
  const competitors = topCompetitorsForTable(ecom, limit);
  if (!competitors.length) return "";

  const scraped = ecom.competitorsScraped || ecom.competitorCount || (product.competitors ?? []).length;
  const lines = [
    "## Competitive Landscape",
    "",
    `Top **${competitors.length}** competitors (of ${scraped} scraped) — side-by-side listing benchmarks.`,
    "",
    "| # | Platform | Product ID | Product | Brand | ★ | Reviews | Price | Bullets | A+ | Images |",
    "|---|----------|------------|---------|-------|---|---------|-------|---------|----|--------|",
  ];

  for (let i = 0; i < competitors.length; i++) {
    const c = competitors[i];
    let title = (c.title ?? "—").replace(/\|/g, "/");
    if (title.length > 36) title = title.slice(0, 33) + "…";
    let brand = (c.brand ?? "—").replace(/\|/g, "/");
    if (brand.length > 18) brand = brand.slice(0, 15) + "…";
    const price = (c.price ?? "—").replace(/\|/g, "/");
    const plat = (c.platform ?? "—").replace(/\|/g, "/");
    lines.push(`| ${i + 1} | ${plat} | \`${c.asin}\` | ${title} | ${brand} | ${fmtNum(c.rating)} | ${fmtNum(c.reviewCount)} | ${price} | ${c.bulletCount} | ${c.aplusModuleCount} | ${c.imageCount} |`);
  }

  const baselinePlat = product.platform ?? "—";
  const productTitle = (product.title ?? product.name ?? "—").slice(0, 40);
  const productBrand = (product.brand ?? "—").slice(0, 18);
  lines.push(
    "",
    "### Your product (baseline)",
    "",
    `| — | ${baselinePlat} | \`${product.asin}\` | ${productTitle} | ${productBrand} | ${fmtNum(product.rating)} | ${fmtNum(product.reviewCount)} | ${product.price ?? "—"} | ${product.bulletCount} | ${product.aplusModuleCount} | ${product.imageCount} |`
  );

  const battleCards = Object.fromEntries((product.battleCards ?? []).map(bc => [bc.competitorAsin, bc]));
  const shownBc = competitors.map(c => battleCards[c.asin]).filter(Boolean);
  if (shownBc.length) {
    lines.push("", "### Battle cards (vs top 4)", "");
    for (const bc of shownBc) {
      const asin = bc.competitorAsin ?? "?";
      const compTitle = competitors.find(c => c.asin === asin)?.title ?? asin;
      lines.push(`**${compTitle}** (\`${asin}\`)`);
      if (bc.verdict) lines.push(`- Verdict: ${bc.verdict}`);
      if (bc.attackVector) lines.push(`- Their edge: ${bc.attackVector}`);
      if (bc.counterStrategy) lines.push(`- Counter: ${bc.counterStrategy}`);
      const metrics = bc.metrics as Record<string, string> | undefined;
      if (metrics) {
        const rv = metrics.Review_Volume ?? metrics["Review Volume"];
        const rp = metrics["Rating_&_Price"] ?? metrics["Rating & Price"];
        if (rv) lines.push(`- Reviews: ${rv}`);
        if (rp) lines.push(`- Rating & price: ${rp}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd();
}

function instagramPaidAds(social: SocialSnapshot | null | undefined): SocialPaidAd[] {
  if (!social) return [];
  return (social.paidAds ?? []).filter(ad => ad.instagramUrl || (ad.linkUrl ?? "").toLowerCase().includes("instagram.com"));
}

export function formatInstagramTab(social: SocialSnapshot | null | undefined): string {
  if (!social) return "_No social data in this run. Enable **Apify public scrape** or Meta Graph, then re-run._";
  const sections: string[] = [];
  const brandDna = formatInstagramBrandDna(social);
  if (brandDna) sections.push(brandDna);
  const organic = formatInstagramProductPosts(social);
  if (organic) sections.push(organic);

  const igAds = instagramPaidAds(social);
  const adLines = [
    "## Instagram paid ads (Meta Ad Library)",
    "",
    "_Paid placements that link to Instagram or run as Meta ads with IG delivery._",
    "",
  ];
  if (igAds.length) {
    adLines.push(`**${igAds.length}** Instagram-linked paid creative(s).\n`);
    adLines.push('<div style="display:flex;flex-wrap:wrap;gap:14px;margin:12px 0;">');
    for (const ad of igAds.slice(0, 8)) {
      const meta2 = [ad.pageName, ad.cta, ad.status].filter(Boolean).join(" · ");
      adLines.push(mediaCard({ imageUrl: ad.imageUrl ?? ad.thumbnailUrl, videoUrl: ad.videoUrl, title: ad.title || ad.adName || "Instagram ad", metaLine: meta2 || "Paid ad", body: (ad.body || "—").slice(0, 320), analysis: ad.matchReason ? `Match: ${ad.matchReason}` : null, linkUrl: ad.instagramUrl ?? ad.linkUrl }));
    }
    adLines.push("</div>");
    sections.push(adLines.join("\n"));
  } else if ((social.totalFetchedCount ?? 0) > 0 || (social.paidAds ?? []).length) {
    sections.push([...adLines, "No creatives with an Instagram link in this run. Check the **Paid ads** tab for Facebook/Meta Library results."].join("\n"));
  } else if (!sections.length) {
    return organic || "_No Instagram content returned._";
  }
  return sections.join("\n\n---\n\n");
}

export function splitBriefPages(result: AnalysisResponse): Record<string, string> {
  const social = result.socialSnapshot;
  return {
    overview: formatOverview(result),
    instagram: formatInstagramTab(social),
    paid_ads: formatPaidAdsSection(social) || "## Paid ads (Meta)\n\n_Paid ads are fetched from **Meta Ad Library** (Apify or Graph API). Set `APIFY_API_TOKEN` for Apify Ad Library scrape, or `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` for your ad account._",
    social: formatMetaMarketing(social) || "_No brand social posts in this run._",
    reddit: formatRedditReviews(result.redditSnapshot) || "_Reddit reviews were not included in this run._",
    competitors: formatCompetitiveLandscape(result.ecomSnapshot) || "_Competitive landscape will appear after a successful e-commerce audit._",
  };
}

export function formatBrief(result: AnalysisResponse): string {
  const pages = splitBriefPages(result);
  const parts = [pages.overview, pages.instagram, pages.paid_ads, pages.social];
  if (result.redditSnapshot) parts.push(pages.reddit);
  if (result.ecomSnapshot) parts.push(pages.competitors);
  return parts.filter(p => p && !p.startsWith("_")).join("\n\n---\n\n");
}
