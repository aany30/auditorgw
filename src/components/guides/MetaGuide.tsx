import { AlertTriangle, ShieldCheck } from "lucide-react";
import CredentialInput from "@/components/forms/CredentialInput";
import GuideSection, { GuideLink, GuideButton, GuideCode } from "./GuideSection";

interface Props {
  /** Optional close handler when used inside a parent that toggles modes. */
  onClose?: () => void;
}

/**
 * Meta connection guide — fully click-by-click manual flow.
 * Four sections (Access Token → Business ID → Pixel ID → CAPI) plus the
 * inline credential form at the bottom.
 */
export default function MetaGuide({ onClose }: Props) {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
        <p className="font-semibold mb-0.5">~5 minutes total · Manual paste, no OAuth setup needed</p>
        <p className="text-blue-800">
          You'll collect 3 things: an Access Token, your Ad Account ID, and your Pixel ID(s). CAPI works automatically once these are saved.
        </p>
      </div>

      <GuideSection
        number={1}
        title="Get your Access Token"
        summary="Two options: permanent System User token (recommended) or quick Graph API Explorer token"
        yieldsLabel="Access Token"
        defaultOpen
        subSteps={[
          {
            heading: ((
              <span className="inline-flex items-center gap-2 text-green-900 bg-green-50 border border-green-200 rounded-md px-2.5 py-1.5 w-full">
                <ShieldCheck className="w-4 h-4 text-green-600 flex-shrink-0" />
                <span><strong>Option A — System User Token (Recommended)</strong> · Never expires · Best for production use</span>
              </span>
            ) as unknown) as string,
            steps: [],
          },
          {
            heading: "Step 1A.1 — Create a basic Meta app (one-time, no review needed)",
            steps: [
              <>
                Open <GuideLink href="https://developers.facebook.com/apps">developers.facebook.com/apps</GuideLink> in a new tab. Sign in with the Facebook account that has admin access to your Business Manager.
              </>,
              <>
                Top right → click the green <GuideButton>Create App</GuideButton> button.
              </>,
              <>
                Under <em>&quot;What do you want your app to do?&quot;</em> select <GuideButton>Other</GuideButton> → click <GuideButton>Next</GuideButton>.
              </>,
              <>
                App type → select <GuideButton>Business</GuideButton> → click <GuideButton>Next</GuideButton>.
              </>,
              <>
                App name: anything (e.g., <GuideCode>Auditor Internal</GuideCode>). Email auto-fills. Click <GuideButton>Create App</GuideButton>.
              </>,
              <>
                You land on the app dashboard. No app review needed for System User tokens — skip everything about &quot;Live mode&quot; / &quot;App Review&quot;.
              </>,
            ],
          },
          {
            heading: "Step 1A.2 — Generate the System User token",
            steps: [
              <>
                Open <GuideLink href="https://business.facebook.com/settings">business.facebook.com/settings</GuideLink> in a new tab.
              </>,
              <>
                Left sidebar → scroll to the <strong>&quot;Users&quot;</strong> section → click <GuideButton>System Users</GuideButton>.
              </>,
              <>
                Top right → blue <GuideButton>Add</GuideButton> button → name it <GuideCode>Auditor System User</GuideCode> → role: <strong>&quot;Admin&quot;</strong> → click <GuideButton>Create System User</GuideButton>.
              </>,
              <>
                Click the new system user row → on the right side, click <GuideButton>Assign Assets</GuideButton>.
              </>,
              <>
                Pick <GuideButton>Ad Accounts</GuideButton> → select the ad accounts you want to audit → toggle <strong>&quot;Manage Campaigns&quot;</strong> ON + <strong>&quot;View Performance&quot;</strong> ON → <GuideButton>Save Changes</GuideButton>.
              </>,
              <>
                (Optional) Repeat <GuideButton>Assign Assets</GuideButton> for <strong>&quot;Pixels&quot;</strong> if you want pixel-level read access.
              </>,
              <>
                Back on the system user page → click <GuideButton>Generate New Token</GuideButton> at the top.
              </>,
              <>
                <strong>Select App</strong> → pick the app you created in Step 1A.1 → click <GuideButton>Next</GuideButton>.
              </>,
              <>
                <strong>Token Expiration</strong> → choose <strong>&quot;Never&quot;</strong> (System Users uniquely allow this).
              </>,
              <>
                <strong>Permissions</strong> — check all four:{" "}
                <GuideCode>ads_read</GuideCode>, <GuideCode>ads_management</GuideCode>,{" "}
                <GuideCode>business_management</GuideCode>, <GuideCode>read_insights</GuideCode>.
              </>,
              <>
                Click <GuideButton>Generate Token</GuideButton>. A long string appears starting with <GuideCode>EAAB...</GuideCode>.
              </>,
              <>
                <strong>Copy it immediately</strong> — you can only see it once. Save it somewhere safe, then paste into the form at the bottom of this page.
              </>,
            ],
          },
          {
            heading: ((
              <div className="flex items-center gap-3 w-full my-1">
                <div className="flex-1 border-t border-gray-300" />
                <span className="text-xs font-bold uppercase tracking-widest text-gray-400 px-2">OR</span>
                <div className="flex-1 border-t border-gray-300" />
              </div>
            ) as unknown) as string,
            steps: [],
          },
          {
            heading: ((
              <span className="inline-flex items-center gap-2 text-blue-900 bg-blue-50 border border-blue-200 rounded-md px-2.5 py-1.5 w-full">
                <span className="text-base">⚡</span>
                <span><strong>Option B — Graph API Explorer Token (Quick Start)</strong> · Short-lived · Good for quick testing</span>
              </span>
            ) as unknown) as string,
            steps: [],
          },
          {
            heading: "Step 1B.1 — Get a token from Graph API Explorer",
            steps: [
              <>
                Open <GuideLink href="https://developers.facebook.com/tools/explorer/">developers.facebook.com/tools/explorer</GuideLink> in a new tab.
              </>,
              <>
                Top right → <strong>Meta App</strong> dropdown → select your app (or the default <GuideCode>Graph API Explorer</GuideCode> app).
              </>,
              <>
                Click <GuideButton>Generate Access Token</GuideButton>. A login dialog appears — log in and grant access.
              </>,
              <>
                Under <strong>Permissions</strong> on the right sidebar, click <GuideButton>Add a Permission</GuideButton> and add:{" "}
                <GuideCode>ads_read</GuideCode>, <GuideCode>ads_management</GuideCode>,{" "}
                <GuideCode>business_management</GuideCode>, <GuideCode>read_insights</GuideCode>.
              </>,
              <>
                Click <GuideButton>Generate Access Token</GuideButton> again to refresh with the new permissions. Approve the permission dialog.
              </>,
              <>
                Copy the token from the <strong>Access Token</strong> field at the top. This is a <strong>short-lived token</strong> — it expires in about 1 hour.
              </>,
            ],
          },
          {
            heading: "Step 1B.2 — Extend to a 60-day long-lived token",
            steps: [
              <>
                A Graph API Explorer token expires in ~1 hour. To extend it to <strong>60 days</strong>, you need your app&apos;s <strong>App ID</strong> and <strong>App Secret</strong>.
              </>,
              <>
                Go to <GuideLink href="https://developers.facebook.com/apps">developers.facebook.com/apps</GuideLink> → click your app → left sidebar → <GuideButton>Settings</GuideButton> → <GuideButton>Basic</GuideButton>.
              </>,
              <>
                Copy the <strong>App ID</strong> and click <GuideButton>Show</GuideButton> next to <strong>App Secret</strong> to reveal and copy it.
              </>,
              <>
                Open a new browser tab and paste this URL (replace the three values):<br />
                <GuideCode>
                  {`https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=YOUR_SHORT_LIVED_TOKEN`}
                </GuideCode>
              </>,
              <>
                Press Enter. The response is JSON with an <GuideCode>access_token</GuideCode> field — that&apos;s your <strong>60-day long-lived token</strong>.
              </>,
              <>
                Copy that long-lived token and paste it into the form at the bottom of this page. Set a calendar reminder to renew it before it expires.
              </>,
            ],
          },
          {
            heading: ((
              <span className="inline-flex items-start gap-2 text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 w-full text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <span>
                  <strong>Token lifespan comparison:</strong> System User tokens (Option A) never expire — no renewal needed. Graph API Explorer tokens (Option B) expire in ~1 hour and must be extended to 60 days via the exchange step above. For ongoing use, Option A is strongly recommended.
                </span>
              </span>
            ) as unknown) as string,
            steps: [],
          },
        ]}
      />

      <GuideSection
        number={2}
        title="Enable write access (required for Apply)"
        summary="Grants ads_management scope so the dashboard can apply AI recommendations"
        yieldsLabel="Write scope"
        subSteps={[
          {
            heading: ((
              <span className="inline-flex items-start gap-2 text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 w-full">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <span>
                  <strong>This step changes permission scope.</strong> The dashboard&apos;s new &quot;Apply AI Recommendation&quot; feature writes changes back to Meta Ads Manager (change budgets, pause campaigns, update frequency caps). Read-only tokens can&apos;t do this — grant <GuideCode>ads_management</GuideCode> scope below.
                </span>
              </span>
            ) as unknown) as string,
            steps: [],
          },
          {
            heading: "Option A — If you're using a System User token (from Section 1)",
            steps: [
              <>
                Open <GuideLink href="https://business.facebook.com/settings">Meta Business Suite → Business Settings</GuideLink> → <GuideButton>System Users</GuideButton> → select your system user.
              </>,
              <>
                Click <GuideButton>Add Assets</GuideButton> → <GuideButton>Pixels</GuideButton> (and <GuideButton>Ad Accounts</GuideButton> if not already added) → select each → set permission level to <strong>&quot;Manage&quot;</strong> (NOT &quot;View Only&quot;). <strong>&quot;Manage&quot; grants write access.</strong>
              </>,
              <>
                Click <GuideButton>Generate New Token</GuideButton> for that system user. Under <strong>Available Permissions</strong> check <strong>both</strong>: <GuideCode>ads_read</GuideCode> (lets us read data) and <GuideCode>ads_management</GuideCode> (lets us apply recommended changes — this is the write scope).
              </>,
              <>
                Copy the new token and replace the one you pasted earlier in the Manual Token tab (Section 5 below).
              </>,
              <>
                The dashboard will auto-detect the new scope. If <GuideButton>Apply</GuideButton> buttons are still greyed out after reconnecting, log out and log back in.
              </>,
            ],
          },
          {
            heading: "Option B — If you're using the OAuth \"Connect with Meta\" button",
            steps: [
              <>
                When you click <GuideButton>Connect with Meta</GuideButton>, the consent screen will ask for <strong>&quot;Manage ads&quot;</strong> — approve it.
              </>,
              <>
                If you previously granted read-only access, go to <GuideLink href="https://www.facebook.com/settings?tab=business_tools">Meta → Settings → Business Integrations</GuideLink> → <strong>auditor</strong> → <GuideButton>Edit Settings</GuideButton> → turn on <strong>&quot;Manage ads and ad campaigns&quot;</strong> → <GuideButton>Save</GuideButton>.
              </>,
            ],
          },
          {
            heading: ((
              <span className="inline-flex items-center gap-2 text-emerald-900">
                <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>Safety &amp; reversibility</span>
              </span>
            ) as unknown) as string,
            steps: [
              <>
                You can revoke write access at any time from <strong>Meta Business Suite → Business Integrations</strong> without disconnecting the read access. All applied changes are logged in the dashboard&apos;s <strong>Change Log</strong> tab and can be undone within 5 minutes.
              </>,
            ],
          },
        ]}
      />

      <GuideSection
        number={3}
        title="Find your Ad Account ID"
        summary="The unique ID for your Meta Ads account (not your Business Manager ID)"
        yieldsLabel="Ad Account ID"
        subSteps={[
          {
            steps: [
              <>
                Open <GuideLink href="https://adsmanager.facebook.com">Ads Manager</GuideLink> in a new tab.
              </>,
              <>
                Look at the URL or click <GuideButton>Account Overview</GuideButton> — you'll see a number like <GuideCode>act_123456789012345</GuideCode>. The digits after <GuideCode>act_</GuideCode> are your Ad Account ID.
              </>,
              <>
                Or: Ads Manager → top-left account selector → the number under your account name.
              </>,
              <>
                <strong>Note:</strong> This is different from your Business Manager ID. Campaigns and reporting data require the Ad Account ID.
              </>,
              <>Copy and paste into the form below (with or without the <GuideCode>act_</GuideCode> prefix).</>,
            ],
          },
        ]}
      />

      <GuideSection
        number={4}
        title="Find your Pixel ID(s)"
        summary="One or more pixels you want to audit"
        yieldsLabel="Pixel ID"
        subSteps={[
          {
            steps: [
              <>
                Open <GuideLink href="https://business.facebook.com/events_manager2/list/pixel">business.facebook.com/events_manager2/list/pixel</GuideLink> in a new tab.
              </>,
              <>
                You see a list of pixels — each row shows a name and a long 15-digit number. That number <strong>is</strong> the Pixel ID.
              </>,
              <>
                To confirm: click a pixel → at the top of the page, <em>"Pixel ID: 123456789012345"</em> is shown.
              </>,
              <>
                Multiple pixels? Paste each ID separated by commas in the form below (e.g., <GuideCode>123...,456...,789...</GuideCode>).
              </>,
            ],
          },
        ]}
      />

      <GuideSection
        number={5}
        title="CAPI (Conversion API) — what you need to know"
        summary="Auditing CAPI needs nothing extra. Implementation is separate."
        yieldsLabel="No extra setup"
        subSteps={[
          {
            heading: "Good news: nothing extra to set up for auditing",
            steps: [
              <>
                The token from Section 1 (with <GuideCode>ads_management</GuideCode> scope) already grants read access to CAPI events on your pixels.
              </>,
              <>
                The dashboard's <strong>Pixel Health</strong> and <strong>Event Quality</strong> tabs automatically pull CAPI metrics — browser vs server share, dedup rate, EMQ — from the same Pixel ID.
              </>,
            ],
          },
          {
            heading: "Only if you're building CAPI on your site (not just auditing)",
            steps: [
              <>
                Open <GuideLink href="https://business.facebook.com/events_manager2">business.facebook.com/events_manager2</GuideLink> → click your pixel → top tabs → <GuideButton>Settings</GuideButton>.
              </>,
              <>
                Scroll to <strong>"Conversions API"</strong> → click <GuideButton>Set Up Manually</GuideButton> OR <GuideButton>Set Up with a Partner Integration</GuideButton> (Shopify, WordPress, Zapier all available).
              </>,
              <>
                Manual setup: click <GuideButton>Generate Access Token</GuideButton> — this is the <strong>CAPI token</strong> your backend uses to POST events to <GuideCode>graph.facebook.com/v18.0/{"{pixel_id}"}/events</GuideCode>. <em>You don't need to paste this into our tool</em> — auditing uses the System User token from Section 1.
              </>,
              <>
                Implementation docs: <GuideLink href="https://developers.facebook.com/docs/marketing-api/conversions-api/get-started">developers.facebook.com/docs/marketing-api/conversions-api/get-started</GuideLink>
              </>,
            ],
          },
        ]}
      />

      {/* Inline credential form */}
      <div className="border-t-2 border-gray-200 pt-5 mt-6">
        <h4 className="text-lg font-bold text-gray-900 mb-1">6 · Paste & Verify</h4>
        <p className="text-sm text-gray-600 mb-4">
          Paste the Access Token, Business ID, and Pixel ID(s) you collected above.
        </p>
        <CredentialInput platform="meta" onComplete={onClose} />
      </div>
    </div>
  );
}
