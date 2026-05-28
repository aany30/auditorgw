import CredentialInput from "@/components/forms/CredentialInput";
import GuideSection, { GuideLink, GuideButton, GuideCode } from "./GuideSection";

interface Props {
  onClose?: () => void;
}

/**
 * Google connection guide — fully click-by-click manual flow.
 * Six sections (Developer Token → Refresh Token → Customer ID → Login Customer ID →
 * GA4 Property ID → GTM Container ID) plus the inline credential form at the bottom.
 */
export default function GoogleGuide({ onClose }: Props) {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
        <p className="font-semibold mb-0.5">~10 minutes (after Developer Token is approved) · Manual paste, no GCP project setup</p>
        <p className="text-blue-800">
          You'll collect: Developer Token, Refresh Token, Customer ID, GA4 Property ID, GTM Container ID. One Refresh Token unlocks all three (Ads + GA4 + GTM).
        </p>
      </div>

      <GuideSection
        number={1}
        title="Get your Developer Token"
        summary="Google Ads API access — 1 to 3 day approval"
        yieldsLabel="Developer Token"
        defaultOpen
        subSteps={[
          {
            heading: "Skip this section if you already have a Developer Token",
            steps: [],
          },
          {
            steps: [
              <>
                Open <GuideLink href="https://ads.google.com">ads.google.com</GuideLink> → sign in with the Google account that owns your Google Ads.
              </>,
              <>
                Top right → wrench icon <GuideButton>Tools</GuideButton> → under <strong>"Setup"</strong> column → click <GuideButton>API Center</GuideButton>. (Direct link: <GuideLink href="https://ads.google.com/aw/apicenter">ads.google.com/aw/apicenter</GuideLink>)
              </>,
              <>
                If API Center is missing: you're on a non-manager account. Create a Manager (MCC) first at{" "}
                <GuideLink href="https://ads.google.com/intl/en_us/home/tools/manager-accounts/">ads.google.com/home/tools/manager-accounts</GuideLink>{" "}
                → <GuideButton>Create a manager account</GuideButton> → fill details → link your existing ad account to the new manager.
              </>,
              <>
                In API Center: read the terms → accept → click <GuideButton>Apply</GuideButton>.
              </>,
              <>
                Fill the application form: company name = your name/agency, intended use = <em>"internal reporting and audit"</em>, contact email. Submit.
              </>,
              <>Wait for Google's approval email (typically 1–3 business days).</>,
              <>
                Once approved, return to API Center → your <strong>Developer Token</strong> is shown at the top. Copy it.
              </>,
            ],
          },
        ]}
      />

      <GuideSection
        number={2}
        title="Get your Refresh Token"
        summary="5-minute one-time mint via OAuth Playground (no GCP project needed)"
        yieldsLabel="Refresh Token"
        defaultOpen
        subSteps={[
          {
            heading: "This is the magic step — no GCP setup required",
            steps: [
              <>
                Open <GuideLink href="https://developers.google.com/oauthplayground">developers.google.com/oauthplayground</GuideLink> in a new tab.
              </>,
              <>
                Top right → click the <GuideButton>⚙ gear icon</GuideButton>.
              </>,
              <>
                In the panel that opens: <strong>leave "Use your own OAuth credentials" UNCHECKED</strong> (we want Google's default playground client). Close the gear panel.
              </>,
              <>
                Left side <strong>"Step 1 Select & authorize APIs"</strong> → in the scope input box at the bottom, paste these three (one at a time, hitting Enter after each), or scroll the list and check the boxes:
                <ul className="list-disc list-outside ml-5 mt-1 space-y-0.5 text-gray-700">
                  <li><GuideCode>https://www.googleapis.com/auth/adwords</GuideCode> <em>(Google Ads)</em></li>
                  <li><GuideCode>https://www.googleapis.com/auth/analytics.readonly</GuideCode> <em>(GA4)</em></li>
                  <li><GuideCode>https://www.googleapis.com/auth/tagmanager.readonly</GuideCode> <em>(GTM)</em></li>
                </ul>
              </>,
              <>
                Click the blue <GuideButton>Authorize APIs</GuideButton> button.
              </>,
              <>
                Sign in with the Google account that has access to Google Ads + GA4 + GTM (usually the same email).
              </>,
              <>
                Grant permissions for all three APIs (click <GuideButton>Continue</GuideButton> through the consent screens).
              </>,
              <>
                You return to the playground — <strong>Step 2 "Exchange authorization code for tokens"</strong> is now highlighted, with an authorization code pre-filled.
              </>,
              <>
                Click the blue <GuideButton>Exchange authorization code for tokens</GuideButton> button.
              </>,
              <>
                A panel appears showing <strong>"Refresh token"</strong> (a long string starting with <GuideCode>1//</GuideCode>) and <strong>"Access token"</strong>.
              </>,
              <>
                <strong>Copy the Refresh token</strong> — the access token expires in 1 hour, but the refresh token lasts forever. We only need the refresh token.
              </>,
            ],
          },
        ]}
      />

      <GuideSection
        number={3}
        title="Find your Customer ID"
        summary="The Google Ads account you want to audit"
        yieldsLabel="Customer ID"
        subSteps={[
          {
            steps: [
              <>
                Open <GuideLink href="https://ads.google.com">ads.google.com</GuideLink> → top right corner, next to your account name → a number formatted like <GuideCode>123-456-7890</GuideCode>.
              </>,
              <>That's your Customer ID. Copy it (with or without dashes — both work).</>,
            ],
          },
        ]}
      />

      <GuideSection
        number={4}
        title="(Optional) Login Customer ID"
        summary="Only if you have a Manager (MCC) account"
        yieldsLabel="Login Customer ID"
        subSteps={[
          {
            steps: [
              <>Skip if you have a single Google Ads account.</>,
              <>
                If you have a Manager (MCC) account managing multiple sub-accounts → the <strong>MCC's</strong> Customer ID is your Login Customer ID.
              </>,
              <>
                To find it: switch to MCC view in Google Ads → the ID shown top-right while in MCC view is the Login Customer ID.
              </>,
            ],
          },
        ]}
      />

      <GuideSection
        number={5}
        title="Find your GA4 Property ID"
        summary="Required for GA4 event auditing"
        yieldsLabel="GA4 Property ID"
        subSteps={[
          {
            steps: [
              <>
                Open <GuideLink href="https://analytics.google.com">analytics.google.com</GuideLink> → sign in with the same Google account as Section 2.
              </>,
              <>
                Bottom-left → <GuideButton>⚙ Admin</GuideButton>.
              </>,
              <>
                Under the <strong>"Property"</strong> column (right side) → click <GuideButton>Property details</GuideButton> (or <GuideButton>Property Settings</GuideButton> depending on UI version).
              </>,
              <>
                <strong>Property ID</strong> shown at the top — a 9-digit number like <GuideCode>123456789</GuideCode>. Copy.
              </>,
            ],
          },
        ]}
      />

      <GuideSection
        number={6}
        title="Find your GTM Container ID"
        summary="Required for GTM container health audit"
        yieldsLabel="GTM Container ID"
        subSteps={[
          {
            steps: [
              <>
                Open <GuideLink href="https://tagmanager.google.com">tagmanager.google.com</GuideLink> → sign in with the same Google account.
              </>,
              <>
                You see a list of containers — each shows its ID directly: format <GuideCode>GTM-XXXXXXX</GuideCode>.
              </>,
              <>Copy the ID of the container you want to audit.</>,
            ],
          },
        ]}
      />

      {/* Inline credential form */}
      <div className="border-t-2 border-gray-200 pt-5 mt-6">
        <h4 className="text-lg font-bold text-gray-900 mb-1">7 · Paste & Verify</h4>
        <p className="text-sm text-gray-600 mb-4">
          Paste the Refresh Token (as Access Token), Developer Token, Customer ID, GA4 Property ID, and GTM Container ID you collected above.
        </p>
        <CredentialInput platform="google" onClose={onClose || (() => {})} />
      </div>
    </div>
  );
}
