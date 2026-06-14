import CredentialInput from "@/components/forms/CredentialInput";
import GuideSection, { GuideLink, GuideButton, GuideCode } from "./GuideSection";

interface Props {
  onClose?: () => void;
}

/**
 * Google Ads connection — full step-by-step guide for clients.
 *
 * Four parts:
 *   Part 1: Apply for Developer Token (1-3 day Google approval) — DO FIRST
 *   Part 2: Get Refresh Token via OAuth Playground (5 min, no GCP setup)
 *   Part 3: Find Customer ID (10 sec)
 *   Part 4: Paste everything in form
 *
 * Designed to be shareable with non-technical agency clients — every
 * button name, every URL, every gotcha called out.
 */
export default function GoogleGuide({ onClose }: Props) {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
        <p className="font-semibold mb-0.5">Google Ads Setup — Complete Step-by-Step Guide</p>
        <p className="text-blue-800 mt-1">
          3 things total: <strong>Developer Token + Refresh Token + Customer ID</strong>.
          Time: <strong>5 minutes hands-on + 1-3 day wait</strong> for Developer Token approval.
        </p>
        <p className="text-blue-700 text-xs mt-2">
          GA4 + GTM are OPTIONAL — skip if you only want Google Ads data.
        </p>
      </div>

      {/* ─────────────────── PART 1 ─────────────────── */}
      <GuideSection
        number={1}
        title="Apply for Developer Token (DO THIS FIRST — 1-3 day wait)"
        summary="Mandatory for any Google Ads API access. Start the timer now, then do Parts 2 + 3 while you wait."
        yieldsLabel="Developer Token"
        defaultOpen
        subSteps={[
          {
            heading: "Skip if you already have one approved",
            steps: [],
          },
          {
            heading: "1.1 — Open Google Ads",
            steps: [
              <>
                Open <GuideLink href="https://ads.google.com">ads.google.com</GuideLink> in a new tab.
              </>,
              <>
                Sign in with the Google account that owns your Google Ads.
              </>,
            ],
          },
          {
            heading: "1.2 — Navigate to API Center",
            steps: [
              <>
                Top right corner → click <GuideButton>🔧 wrench icon &quot;Tools&quot;</GuideButton>.
              </>,
              <>
                Under <strong>&quot;Setup&quot;</strong> column → click <GuideButton>API Center</GuideButton>.
              </>,
              <>
                Direct link: <GuideLink href="https://ads.google.com/aw/apicenter">ads.google.com/aw/apicenter</GuideLink>
              </>,
            ],
          },
          {
            heading: "1.3 — If &quot;API Center&quot; is missing",
            steps: [
              <>
                You&apos;re on a non-Manager account. Google Ads API requires a <strong>Manager (MCC)</strong> account.
              </>,
              <>
                Create one at <GuideLink href="https://ads.google.com/intl/en_us/home/tools/manager-accounts/">ads.google.com/home/tools/manager-accounts</GuideLink> → <GuideButton>Create a manager account</GuideButton> → fill details → link your existing Google Ads account to the MCC.
              </>,
              <>Now API Center will appear.</>,
            ],
          },
          {
            heading: "1.4 — Apply",
            steps: [
              <>Read terms → check <strong>&quot;I agree to the terms and conditions&quot;</strong> → click <GuideButton>Apply</GuideButton>.</>,
              <>
                Fill the form:
                <ul className="list-disc list-inside mt-1 space-y-0.5 text-gray-700">
                  <li><strong>Company:</strong> Your business name</li>
                  <li>
                    <strong>Intended use:</strong> Copy-paste:{" "}
                    <em>&quot;Marketing analytics and audit tool for our agency clients to monitor their Google Ads performance and receive AI-generated optimization recommendations.&quot;</em>
                  </li>
                  <li><strong>Contact email:</strong> Your email</li>
                  <li><strong>Tool type:</strong> &quot;Internal&quot; or &quot;Third-party&quot;</li>
                </ul>
              </>,
              <>Submit → wait <strong>1-3 business days</strong> for Google&apos;s approval email.</>,
            ],
          },
          {
            heading: "1.5 — After approval",
            steps: [
              <>Return to API Center → <strong>Developer Token</strong> shown at top.</>,
              <>Looks like: <GuideCode>abc123XYZ_aBcDeFgH9iJkL</GuideCode>. Copy it.</>,
              <>
                <strong>While you wait for approval, continue to Part 2 + 3 below — they don&apos;t need the Developer Token.</strong>
              </>,
            ],
          },
        ]}
      />

      {/* ─────────────────── PART 2 ─────────────────── */}
      <GuideSection
        number={2}
        title="Get your Refresh Token via OAuth Playground (5 min — no GCP setup)"
        summary="Uses Google's own OAuth Playground. No GCP project, no OAuth client to create, no env vars to manage."
        yieldsLabel="Refresh Token"
        defaultOpen
        subSteps={[
          {
            heading: "2.1 — Open the Playground",
            steps: [
              <>
                Open <GuideLink href="https://developers.google.com/oauthplayground">developers.google.com/oauthplayground</GuideLink> in a new tab.
              </>,
              <>
                Sign in (top right) with the <strong>same Google account</strong> that has Google Ads access (same as Part 1).
              </>,
            ],
          },
          {
            heading: "2.2 — Configure settings (CRITICAL — get this right or no refresh_token)",
            steps: [
              <>Top right corner → click <GuideButton>⚙️ gear icon</GuideButton>.</>,
              <>Side panel opens — <strong>&quot;OAuth 2.0 configuration&quot;</strong>.</>,
              <>
                Verify these <strong className="text-orange-700">3 settings</strong>:
                <ul className="list-disc list-inside mt-1 space-y-1 text-gray-700">
                  <li>
                    <strong>&quot;Use your own OAuth credentials&quot;</strong> → <strong className="text-red-700">UNCHECKED</strong> ❌
                    <span className="text-xs text-gray-500 block ml-5">(Uses Google&apos;s default playground client — that&apos;s the whole point, no GCP needed)</span>
                  </li>
                  <li>
                    <strong>Access type:</strong> <GuideCode>Offline</GuideCode>
                    <span className="text-xs text-gray-500 block ml-5">(Critical — this is what gives us the refresh_token)</span>
                  </li>
                  <li>
                    <strong>Force prompt:</strong> <GuideCode>Consent Screen</GuideCode>
                    <span className="text-xs text-gray-500 block ml-5">(Ensures refresh_token is reliably issued)</span>
                  </li>
                </ul>
              </>,
              <>Click anywhere outside the panel to close it.</>,
            ],
          },
          {
            heading: "2.3 — Add the scope",
            steps: [
              <>
                Left side panel → <strong>&quot;Step 1 Select &amp; authorize APIs&quot;</strong>.
              </>,
              <>
                Bottom of the panel → text input box (says &quot;Input your own scopes&quot;).
              </>,
              <>
                Paste exactly this:
                <GuideCode>https://www.googleapis.com/auth/adwords</GuideCode>
              </>,
              <>Click the blue <GuideButton>Authorize APIs</GuideButton> button.</>,
            ],
          },
          {
            heading: "2.4 — Google login + grant permission",
            steps: [
              <>Google sign-in page opens → pick your Gmail (same account as Part 1).</>,
              <>
                <strong className="text-orange-700">Warning appears:</strong> &quot;Google hasn&apos;t verified this app&quot;
                <ul className="list-disc list-inside mt-1 space-y-0.5 text-gray-700">
                  <li>Click <GuideButton>Advanced</GuideButton></li>
                  <li>Click <GuideButton>Go to oauthplayground.dev (unsafe)</GuideButton></li>
                </ul>
                <p className="text-xs text-gray-500 mt-1">Safe — it&apos;s Google&apos;s own playground, just not formally verified.</p>
              </>,
              <>Permission consent → click <GuideButton>Continue</GuideButton> (or <GuideButton>Allow</GuideButton>).</>,
            ],
          },
          {
            heading: "2.5 — Exchange code for tokens",
            steps: [
              <>You return to the Playground → <strong>&quot;Step 2 Exchange authorization code for tokens&quot;</strong> is highlighted.</>,
              <>The <strong>&quot;Authorization code&quot;</strong> field is pre-filled automatically.</>,
              <>Click the blue <GuideButton>Exchange authorization code for tokens</GuideButton> button.</>,
            ],
          },
          {
            heading: "2.6 — Copy the Refresh Token",
            steps: [
              <>
                A response panel appears with JSON like:
                <pre className="mt-2 p-3 bg-gray-900 text-gray-100 rounded text-xs overflow-x-auto">
{`{
  "access_token": "ya29.a0Af...",      ← ❌ IGNORE (expires in 1 hour)
  "expires_in": 3599,
  "refresh_token": "1//0gExA-MEnW5lk...",  ← ✅ THIS ONE
  "scope": "https://www.googleapis.com/auth/adwords",
  "token_type": "Bearer"
}`}
                </pre>
              </>,
              <>
                <strong>Copy the <GuideCode>refresh_token</GuideCode> value</strong> — starts with <GuideCode>1//</GuideCode>, ~100 characters long.
              </>,
              <>
                <strong className="text-orange-700">If refresh_token is missing from the response:</strong>{" "}
                Go back to Step 2.2 → confirm Access type = Offline AND Force prompt = Consent Screen → redo from Step 2.3.
              </>,
            ],
          },
        ]}
      />

      {/* ─────────────────── PART 3 ─────────────────── */}
      <GuideSection
        number={3}
        title="Find your Customer ID (10 seconds)"
        summary="The 10-digit number identifying your Google Ads account."
        yieldsLabel="Customer ID"
        defaultOpen
        subSteps={[
          {
            steps: [
              <>Open <GuideLink href="https://ads.google.com">ads.google.com</GuideLink> (still signed in).</>,
              <>
                Top right corner — next to your account name → a number like <GuideCode>123-456-7890</GuideCode>.
              </>,
              <>That&apos;s your Customer ID. Copy it (with or without dashes, both work).</>,
              <>
                <strong>Optional — Login Customer ID (only for MCC accounts):</strong> If you have a Manager (MCC) account managing multiple sub-accounts, the <strong>MCC&apos;s</strong> Customer ID is your Login Customer ID. Switch to MCC view → the ID shown top-right while in MCC view is the Login Customer ID. Paste in the optional field.
              </>,
            ],
          },
        ]}
      />

      {/* ─────────────────── PART 4 ─────────────────── */}
      <GuideSection
        number={4}
        title="Optional — for GA4 and GTM audits only"
        summary="Skip this section if you only want Google Ads data."
        yieldsLabel="(optional)"
        subSteps={[
          {
            heading: "GA4 Property ID (only for the GA4 audit)",
            steps: [
              <>Open <GuideLink href="https://analytics.google.com">analytics.google.com</GuideLink> → sign in with the same Google account.</>,
              <>Bottom-left → <GuideButton>⚙ Admin</GuideButton>.</>,
              <>Under the <strong>&quot;Property&quot;</strong> column → click <GuideButton>Property details</GuideButton>.</>,
              <>
                <strong>Property ID</strong> shown at the top — a 9-digit number like <GuideCode>123456789</GuideCode>. Copy.
              </>,
            ],
          },
          {
            heading: "GTM Container ID (only for the GTM audit)",
            steps: [
              <>Open <GuideLink href="https://tagmanager.google.com">tagmanager.google.com</GuideLink>.</>,
              <>
                List of containers shows each ID directly: format <GuideCode>GTM-XXXXXXX</GuideCode>.
                Copy the ID of the container you want to audit.
              </>,
            ],
          },
        ]}
      />

      {/* ─────────────────── Common gotchas ─────────────────── */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm">
        <h4 className="font-bold text-yellow-900 mb-2">⚠️ Common issues</h4>
        <ul className="space-y-1 text-yellow-900 text-xs">
          <li><strong>API Center missing</strong> → Need a Manager (MCC) account first (see Part 1.3)</li>
          <li><strong>refresh_token missing from response</strong> → Settings → Access type = Offline + Force prompt = Consent Screen, then redo from 2.3</li>
          <li><strong>Token works once then stops</strong> → You revoked it at <code>myaccount.google.com/permissions</code> — redo Part 2</li>
          <li><strong>Wrong Google account signed in</strong> → Sign out of Playground → sign in with the correct account → retry</li>
          <li><strong>Developer Token application denied</strong> → Reply to Google&apos;s email explaining your use case — usually approved on appeal</li>
          <li><strong>&quot;App not verified&quot; warning</strong> → Click Advanced → &quot;Go to oauthplayground.dev (unsafe)&quot; — safe to bypass</li>
        </ul>
      </div>

      {/* ─────────────────── Final paste form ─────────────────── */}
      <div className="bg-white border-2 border-blue-200 rounded-xl p-5 shadow-sm">
        <h3 className="text-lg font-bold text-gray-900 mb-1">📋 Paste your credentials</h3>
        <p className="text-sm text-gray-600 mb-4">
          Fill the 3 required fields (red asterisk). GA4 + GTM + Login Customer ID are optional.
        </p>
        <CredentialInput platform="google" onComplete={onClose} />
      </div>
    </div>
  );
}
