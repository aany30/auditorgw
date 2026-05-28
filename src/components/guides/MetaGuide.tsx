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
          You'll collect 3 things: an Access Token, your Business ID, and your Pixel ID(s). CAPI works automatically once these are saved.
        </p>
      </div>

      <GuideSection
        number={1}
        title="Get your Access Token"
        summary="System User token from Business Settings — never expires"
        yieldsLabel="Access Token"
        defaultOpen
        subSteps={[
          {
            heading: "Step 1.1 — Create a basic Meta app (one-time, no review needed)",
            steps: [
              <>
                Open <GuideLink href="https://developers.facebook.com/apps">developers.facebook.com/apps</GuideLink> in a new tab. Sign in with the Facebook account that has admin access to your Business Manager.
              </>,
              <>
                Top right → click the green <GuideButton>Create App</GuideButton> button.
              </>,
              <>
                Under <em>"What do you want your app to do?"</em> select <GuideButton>Other</GuideButton> → click <GuideButton>Next</GuideButton>.
              </>,
              <>
                App type → select <GuideButton>Business</GuideButton> → click <GuideButton>Next</GuideButton>.
              </>,
              <>
                App name: anything (e.g., <GuideCode>Auditor Internal</GuideCode>). Email auto-fills. Click <GuideButton>Create App</GuideButton>.
              </>,
              <>
                You land on the app dashboard. No app review needed for System User tokens — skip everything about "Live mode" / "App Review".
              </>,
            ],
          },
          {
            heading: "Step 1.2 — Generate the System User token",
            steps: [
              <>
                Open <GuideLink href="https://business.facebook.com/settings">business.facebook.com/settings</GuideLink> in a new tab.
              </>,
              <>
                Left sidebar → scroll to the <strong>"Users"</strong> section → click <GuideButton>System Users</GuideButton>.
              </>,
              <>
                Top right → blue <GuideButton>Add</GuideButton> button → name it <GuideCode>Auditor System User</GuideCode> → role: <strong>"Admin"</strong> → click <GuideButton>Create System User</GuideButton>.
              </>,
              <>
                Click the new system user row → on the right side, click <GuideButton>Assign Assets</GuideButton>.
              </>,
              <>
                Pick <GuideButton>Ad Accounts</GuideButton> → select the ad accounts you want to audit → toggle <strong>"Manage Campaigns"</strong> ON + <strong>"View Performance"</strong> ON → <GuideButton>Save Changes</GuideButton>.
              </>,
              <>
                (Optional) Repeat <GuideButton>Assign Assets</GuideButton> for <strong>"Pixels"</strong> if you want pixel-level read access.
              </>,
              <>
                Back on the system user page → click <GuideButton>Generate New Token</GuideButton> at the top.
              </>,
              <>
                <strong>Select App</strong> → pick the app you created in Step 1.1 → click <GuideButton>Next</GuideButton>.
              </>,
              <>
                <strong>Token Expiration</strong> → choose <strong>"Never"</strong> (System Users uniquely allow this).
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
        ]}
      />

      <GuideSection
        number={2}
        title="Find your Business ID"
        summary="The unique ID for your Business Manager"
        yieldsLabel="Business ID"
        subSteps={[
          {
            steps: [
              <>
                Stay on <GuideLink href="https://business.facebook.com/settings">business.facebook.com/settings</GuideLink>.
              </>,
              <>
                Look at the URL — it ends with <GuideCode>?business_id=XXXXXXXXXXX</GuideCode>. That number is your Business ID.
              </>,
              <>
                Or: left sidebar → <GuideButton>Business Info</GuideButton> → Business ID is shown at the top of the page.
              </>,
              <>Copy and paste into the form below.</>,
            ],
          },
        ]}
      />

      <GuideSection
        number={3}
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
        number={4}
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
        <h4 className="text-lg font-bold text-gray-900 mb-1">5 · Paste & Verify</h4>
        <p className="text-sm text-gray-600 mb-4">
          Paste the Access Token, Business ID, and Pixel ID(s) you collected above.
        </p>
        <CredentialInput platform="meta" onClose={onClose || (() => {})} />
      </div>
    </div>
  );
}
