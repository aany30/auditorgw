/**
 * Central glossary of marketing / ad-tech terms used across the dashboard.
 * Each entry is shown in a hover tooltip via <Term> or <TermText> components.
 *
 * Keep explanations short, plain-English, no jargon-defines-jargon.
 */

export interface TermDef {
  /** Expansion or simple-language category (e.g. "Conversions API"). */
  short: string;
  /** Full explanation in plain English. */
  long: string;
}

export const GLOSSARY: Record<string, TermDef> = {
  // ----- Meta / Facebook tracking -----
  CAPI: {
    short: "Conversions API",
    long: "A server-side way to send conversion events to Meta directly from your backend — bypassing the browser. Catches conversions that the browser pixel misses due to ad blockers, iOS privacy, or slow pages.",
  },
  EMQ: {
    short: "Event Match Quality",
    long: "Meta's score (1–10) for how well each event ties back to a real Facebook/Instagram user. Higher = better attribution. Improved by sending hashed email, phone, and external IDs alongside events.",
  },
  Pixel: {
    short: "Meta Pixel",
    long: "A small snippet of code on your website that reports user actions (page views, add-to-cart, purchase) back to Meta. The browser-side half of conversion tracking.",
  },
  Dedup: {
    short: "Deduplication",
    long: "Matching browser-side pixel events with server-side CAPI events for the same action, so the same purchase isn't counted twice. High dedup rate = healthy hybrid tracking.",
  },
  Deduplication: {
    short: "Event matching",
    long: "Matching browser-side pixel events with server-side CAPI events for the same action, so the same purchase isn't counted twice.",
  },
  "Advantage+": {
    short: "Meta automation",
    long: "Meta's automated targeting and placement system — lets the algorithm pick audiences and ad surfaces (Feed, Reels, Stories) instead of fixed manual rules. Usually wins on broad-funnel campaigns.",
  },

  // ----- Google -----
  GA4: {
    short: "Google Analytics 4",
    long: "Google's analytics platform — the successor to Universal Analytics. Event-based model; tracks user behaviour across web + app.",
  },
  GTM: {
    short: "Google Tag Manager",
    long: "A container that lets you add/edit tracking tags (Pixel, GA4, custom scripts) on your site without touching code each time.",
  },
  PMax: {
    short: "Performance Max",
    long: "Google's all-channel campaign type — runs across Search, Display, YouTube, Gmail, Maps using machine learning. You provide assets; Google decides where they show.",
  },
  RSA: {
    short: "Responsive Search Ad",
    long: "Google's default search ad format. You provide up to 15 headlines + 4 descriptions; Google mixes and matches them to find best performers.",
  },
  MCC: {
    short: "Manager Account",
    long: "Google Ads parent account that manages multiple child ad accounts. Required for the Developer Token. Originally called 'My Client Center'.",
  },
  DV360: {
    short: "Display & Video 360",
    long: "Google's enterprise display + video buying platform — part of Google Marketing Platform. Used for programmatic ad buying across the open web.",
  },
  UTM: {
    short: "Tracking parameters",
    long: "Tags appended to URLs (e.g. ?utm_source=facebook&utm_campaign=summer) that identify where traffic came from. Reports show up in GA4 and other analytics tools.",
  },

  // ----- Performance metrics -----
  ROAS: {
    short: "Return on Ad Spend",
    long: "Revenue generated ÷ ad spend. 4x ROAS means you got $4 of sales for every $1 spent. The gold-standard metric for performance campaigns.",
  },
  CPM: {
    short: "Cost per 1000 impressions",
    long: "What you pay to show your ad 1,000 times. High CPM = expensive audience or fierce auction competition.",
  },
  CTR: {
    short: "Click-Through Rate",
    long: "Clicks ÷ impressions × 100. Measures how compelling your ad creative + targeting are. Industry benchmark: 1–2% for social, 3–5% for search.",
  },
  CPC: {
    short: "Cost Per Click",
    long: "What you pay each time someone clicks your ad. Spend ÷ clicks.",
  },
  CPL: {
    short: "Cost Per Lead",
    long: "What you pay to generate one lead (form fill / signup). Spend ÷ leads.",
  },
  CPA: {
    short: "Cost Per Acquisition",
    long: "What you pay to acquire one paying customer. Spend ÷ purchases.",
  },
  CPV: {
    short: "Cost Per View",
    long: "What you pay per video view (typically 2-second or ThruPlay 15-second views). Used in top-of-funnel video campaigns to build awareness cheaply.",
  },
  CPE: {
    short: "Cost Per Engagement",
    long: "What you pay per interaction with your ad (like, comment, share, post click). Used in mid-funnel engagement campaigns to grow audiences.",
  },
  CPS: {
    short: "Cost Per Sale",
    long: "What you pay per completed purchase. Same as CPA but specifically for e-commerce / DTC. The hardest, most expensive metric to optimise — bottom-of-funnel only.",
  },
  CPCV: {
    short: "Cost Per Completed View",
    long: "What you pay only when a viewer watches your entire video. Stricter than CPV — used to verify message-completion in awareness campaigns.",
  },
  Frequency: {
    short: "Impressions per user",
    long: "Average times each user has seen your ad in the period (impressions ÷ reach). Above 3.0 typically means creative fatigue is starting.",
  },
  "Impression Share": {
    short: "Auction visibility",
    long: "Impressions you actually received ÷ impressions you were eligible for, as a %. Low IS = you're being out-bid or your budget is capping you.",
  },

  // ----- Audience -----
  "Audience Overlap": {
    short: "Shared targeting",
    long: "Percentage of users that appear in more than one of your ad sets. High overlap means your campaigns bid against each other — inflates CPM and degrades ROAS.",
  },

  // ----- Campaign / budget structure -----
  ABO: {
    short: "Ad-set Budget Optimization",
    long: "You set the budget on each individual ad set. Useful when you want to force-spend on a specific audience.",
  },
  CBO: {
    short: "Campaign Budget Optimization",
    long: "You set one budget at the campaign level and Meta/Google distributes it across ad sets based on which is performing. Usually preferred for scaling.",
  },
  TOF: {
    short: "Top of Funnel",
    long: "Awareness / reach campaigns aimed at cold audiences who haven't heard of you yet. Usually CPM- or video-view-optimised.",
  },
  MOF: {
    short: "Mid of Funnel",
    long: "Engagement / consideration campaigns aimed at warm audiences (website visitors, video viewers). Goal: deepen interest before purchase.",
  },
  BOF: {
    short: "Bottom of Funnel",
    long: "Conversion / sales campaigns aimed at hot audiences (cart abandoners, past customers). Goal: drive a purchase or lead.",
  },
  "Learning Phase": {
    short: "Algorithm warm-up",
    long: "Meta's initial optimization period when a new ad set is collecting signals. Needs ~50 conversions in 7 days to exit. Avoid major edits during this phase.",
  },
  "Learning Limited": {
    short: "Stuck in learning",
    long: "Meta's flag that an ad set isn't getting enough conversions to optimize. Usually means budget is too low or audience too narrow.",
  },
  Attribution: {
    short: "Credit assignment",
    long: "Which touchpoint gets credit for a conversion. Last-click gives all credit to the final ad; data-driven shares credit across the journey.",
  },

  // ----- Auth / API -----
  OAuth: {
    short: "Open Authorization",
    long: "The 'Sign in with Google/Meta' flow. The user logs into the platform directly and grants your app permission — no token copy-pasting.",
  },
  "Refresh Token": {
    short: "Long-lived credential",
    long: "A token that lasts forever (or until revoked) and is used to mint short-lived access tokens. Stays on your server; users only see the access token.",
  },
  "Developer Token": {
    short: "Google Ads API key",
    long: "Required to call the Google Ads API. Approved by Google after a 1–3 day review. Lives in your Manager Account → Tools → API Center.",
  },
  "System User": {
    short: "Meta service account",
    long: "A non-person account inside Meta Business Manager. Generates tokens that never expire — ideal for backend integrations and audit tools.",
  },

  // ----- Campaign objectives -----
  Awareness: {
    short: "Top-funnel objective",
    long: "Campaigns optimised to show your ad to as many relevant people as possible. Typically billed CPM. Used for brand-building, not direct sales.",
  },
  Reach: {
    short: "Maximum unique-audience objective",
    long: "Optimised to reach as many unique people as possible within your audience, with a frequency cap. Sits alongside Awareness for top-funnel.",
  },
  Traffic: {
    short: "Click-driving objective",
    long: "Campaigns optimised to send people to your website or app. Billed per click. Useful for filling middle-funnel audiences before retargeting.",
  },
  Engagement: {
    short: "Interaction objective",
    long: "Campaigns optimised for likes, comments, shares, page follows, or post saves. Builds social proof and audience warming for later remarketing.",
  },
  "Lead Generation": {
    short: "Form-fill objective",
    long: "Campaigns optimised to capture leads via an in-platform form (Meta Lead Ads, Google Lead Forms) — no landing page required.",
  },
  Conversions: {
    short: "Purchase / signup objective",
    long: "Campaigns optimised for a specific conversion event you've defined (purchase, signup, add-to-cart). Needs the pixel + CAPI firing the right event.",
  },
  Sales: {
    short: "Revenue objective",
    long: "Meta's renamed Conversions objective focused on driving online or offline sales. Optimises bidding around purchase events.",
  },
  "Video Views": {
    short: "Video watch-time objective",
    long: "Optimises for completed video views (e.g. ThruPlay = 15-second view). Used for warming cold audiences with brand or product content.",
  },
  "App Promotion": {
    short: "App install / engagement objective",
    long: "Drives app installs or in-app actions. Requires the platform's app SDK installed and tracked conversion events configured.",
  },
  "Catalog Sales": {
    short: "Dynamic product ads",
    long: "Auto-generates ads from a product feed and shows the right product to the right user based on browsing or cart behaviour. Requires a product catalog.",
  },
  "Brand Consideration": {
    short: "Mid-funnel objective",
    long: "Google's umbrella for objectives that warm an audience without asking for a purchase — like Video Views or Video Action.",
  },
  "Store Visits": {
    short: "Footfall objective",
    long: "Optimises for offline visits to a physical store, measured via Location History and store IDs. Requires location services + store data feed.",
  },

  // ----- Audiences -----
  Lookalike: {
    short: "Similar-audience targeting",
    long: "Meta finds users who behave like a source audience you provide (e.g. past purchasers). 1% lookalike = the 1% of users most similar; bigger % = wider reach, lower similarity.",
  },
  "Custom Audience": {
    short: "Your own data audience",
    long: "An audience you build from your own data — customer list, website visitors, app users, video engagers — used for retargeting or as a lookalike source.",
  },
  "Saved Audience": {
    short: "Interest-based audience",
    long: "An audience defined by demographics, interests, behaviours, and locations — saved for reuse. Distinct from Custom Audience which uses your data.",
  },
  Retargeting: {
    short: "Re-engage past visitors",
    long: "Showing ads to people who already interacted with your site, app, or content. Higher intent than cold audiences but limited in scale.",
  },
  Remarketing: {
    short: "Google's term for retargeting",
    long: "Same concept as retargeting — Google's term for showing ads to people who previously visited your site or used your app.",
  },

  // ----- Performance metrics -----
  "Match Rate": {
    short: "Identifier matching %",
    long: "% of your events that include enough customer info (hashed email, phone, ID) to be matched to a real platform user. Higher = better attribution.",
  },
  "Conversion Rate": {
    short: "Visit → action %",
    long: "Conversions ÷ visits × 100. Measures how effectively traffic turns into the action you want (purchase, signup, lead).",
  },
  AOV: {
    short: "Average Order Value",
    long: "Total revenue ÷ number of orders. Higher AOV means each customer is more valuable, which lets you bid more aggressively for them.",
  },
  LTV: {
    short: "Lifetime Value",
    long: "Total revenue a customer generates over their entire relationship with you. Used to set a sustainable Customer Acquisition Cost ceiling.",
  },
  CAC: {
    short: "Customer Acquisition Cost",
    long: "Total marketing spend ÷ number of new customers acquired. Should always be well below LTV — the ratio LTV:CAC tells you if growth is sustainable.",
  },
  "Bounce Rate": {
    short: "Single-page-visit %",
    long: "% of sessions where a user landed and left without interacting. High bounce rate on a landing page often means the ad/page mismatch is bad.",
  },
  "Quality Score": {
    short: "Google ad relevance score (1–10)",
    long: "Google's measure of how relevant your keyword, ad copy, and landing page are. Higher Quality Score = lower CPC for the same auction position.",
  },
  "Ad Strength": {
    short: "Google asset quality score",
    long: "Google's rating (Poor → Excellent) of your Responsive Search Ad's headline + description combinations. Higher Ad Strength = better delivery.",
  },

  // ----- Structure / placements -----
  "Ad Set": {
    short: "Meta budget + targeting layer",
    long: "Sits between Campaign and Ad in Meta. Defines budget, audience, placements, and schedule. Each campaign can have multiple ad sets.",
  },
  "Ad Group": {
    short: "Google equivalent of Ad Set",
    long: "Google Ads' layer between Campaign and Ad. Holds keywords, audiences, and ads for a focused theme.",
  },
  Placements: {
    short: "Where ads show",
    long: "The surfaces your ad runs on — Feed, Stories, Reels, Audience Network for Meta; Search, Display, YouTube, Gmail for Google.",
  },

  // ----- Bidding -----
  "Smart Bidding": {
    short: "Google auto-bidding strategies",
    long: "Google's auto-bidding family: Maximize Conversions, Target CPA, Target ROAS, Maximize Conversion Value. Uses ML to bid per auction.",
  },
  "Target CPA": {
    short: "Cost-per-acquisition bid target",
    long: "Tell Google the average cost-per-conversion you're willing to pay; it auto-bids per auction to hit that average.",
  },
  "Target ROAS": {
    short: "Return-on-ad-spend bid target",
    long: "Tell Google the revenue-per-spend ratio you want (e.g. 400%); it auto-bids per auction to hit that target. Requires conversion value tracking.",
  },

  // ----- Tracking / privacy -----
  ATT: {
    short: "App Tracking Transparency",
    long: "Apple's iOS 14.5+ framework requiring apps to explicitly ask users for tracking permission. Caused major drops in trackable iOS conversions for Meta.",
  },
  AEM: {
    short: "Aggregated Event Measurement",
    long: "Meta's privacy-safe framework for measuring iOS web conversions post-ATT. Limits you to 8 conversion events per domain, ranked by priority.",
  },
  "Consent Mode": {
    short: "Google's GDPR-compliant tracking mode",
    long: "Google Tag Manager mode that adjusts tag behaviour based on user consent. v2 is required in the EU; lets you still measure conversion modeling when consent is denied.",
  },
  GDPR: {
    short: "EU privacy law",
    long: "General Data Protection Regulation — EU law requiring explicit consent before tracking users. Triggered when traffic comes from the EU. Without compliance you face fines AND lose tracking signal for non-consented users.",
  },
  CCPA: {
    short: "California privacy law",
    long: "California Consumer Privacy Act — gives California users the right to opt out of data sale. Less restrictive than GDPR but still requires a 'Do Not Sell My Info' link on your site.",
  },
  "Enhanced Conversions": {
    short: "Google's hashed-identifier conversion uplift",
    long: "Google Ads feature that sends hashed user identifiers (email, phone) alongside conversion events to recover attribution lost to cookie restrictions.",
  },
  "First-party data": {
    short: "Data you own directly",
    long: "Customer data collected from your own site, app, CRM — as opposed to third-party data bought from data brokers. Becoming the only viable targeting fuel post-cookie.",
  },

  // ----- Common ad ops -----
  "Negative Keywords": {
    short: "Block terms in search ads",
    long: "Keywords you tell Google NOT to show ads for. Prevents wasted spend on irrelevant queries — essential hygiene for Search and Shopping campaigns.",
  },
  "A/B Test": {
    short: "Split test between variants",
    long: "Running two variants of a creative, audience, or landing page simultaneously to measure which performs better. Meta/Google both have built-in split-test tools.",
  },
  CTA: {
    short: "Call to Action",
    long: "The button or instruction telling users what to do next — Shop Now, Sign Up, Learn More. The CTA you pick on the ad changes downstream behaviour.",
  },
};

/** Sorted list of glossary keys for regex matching — longest first to avoid prefix overlap. */
export const GLOSSARY_KEYS_SORTED = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);

/** Look up a term, case-insensitive for single-word lowercase queries. */
export function getTermDef(name: string): TermDef | undefined {
  if (GLOSSARY[name]) return GLOSSARY[name];
  // try case-insensitive match
  const key = Object.keys(GLOSSARY).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? GLOSSARY[key] : undefined;
}
