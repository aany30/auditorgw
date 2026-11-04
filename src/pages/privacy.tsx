import Head from "next/head";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPolicy() {
  const companyName = process.env.NEXT_PUBLIC_COMPANY_NAME || "Auditor";
  const contactEmail =
    process.env.NEXT_PUBLIC_CONTACT_EMAIL || "privacy@auditor.com";
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://auditor.com";
  const lastUpdated = "November 4, 2026";

  return (
    <>
      <Head>
        <title>Privacy Policy — {companyName}</title>
      </Head>

      <div className="min-h-screen bg-[#0a0a0f] text-gray-200">
        <div className="max-w-3xl mx-auto px-6 py-16">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-10 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>

          <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
          <p className="text-sm text-gray-500 mb-12">
            Last updated: {lastUpdated}
          </p>

          <Section title="1. Introduction">
            <p>
              {companyName} (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;)
              operates a tracking audit and conversion intelligence platform
              (the &quot;Service&quot;) that helps advertisers monitor and
              improve their advertising performance across Meta, Google Ads,
              Display &amp; Video 360, and Snapchat.
            </p>
            <p>
              This Privacy Policy explains what data we collect, how we use it,
              and your rights regarding that data. By using the Service, you
              agree to the collection and use of information in accordance with
              this policy.
            </p>
          </Section>

          <Section title="2. Data We Collect">
            <p>
              When you connect your advertising platform accounts, we access the
              following data through their official APIs:
            </p>
            <ul>
              <li>
                <strong>Campaign &amp; ad performance data</strong> — impressions,
                clicks, spend, conversions, ROAS, and other standard advertising
                metrics
              </li>
              <li>
                <strong>Tracking health data</strong> — pixel status, event match
                quality scores, conversion API (CAPI) signal quality, and Floodlight
                activity status
              </li>
              <li>
                <strong>Account structure</strong> — campaign, ad set/ad group,
                and ad names, statuses, budgets, and targeting configurations
              </li>
              <li>
                <strong>Authentication credentials</strong> — OAuth access tokens
                and refresh tokens required to access platform APIs on your behalf
              </li>
            </ul>
            <p>
              We do <strong>not</strong> collect personal data about the end users
              who see or interact with your ads. We do not collect names, email
              addresses, phone numbers, or other personally identifiable
              information of ad viewers.
            </p>
          </Section>

          <Section title="3. How We Use Your Data">
            <p>We use the data we collect exclusively to:</p>
            <ul>
              <li>Display campaign performance metrics and health scores in your dashboard</li>
              <li>Audit tracking implementation quality (pixel health, EMQ, CAPI)</li>
              <li>Analyze conversion funnels and identify performance issues</li>
              <li>Generate AI-powered recommendations to improve ad performance</li>
              <li>Execute campaign management actions you explicitly authorize (budget changes, pausing campaigns)</li>
              <li>Generate performance reports for your review</li>
            </ul>
          </Section>

          <Section title="4. Data Storage &amp; Security">
            <ul>
              <li>
                <strong>Client-side storage:</strong> Authentication tokens and
                account identifiers are stored in your browser&apos;s localStorage.
                They never leave your browser except when making authenticated API
                calls to the advertising platforms.
              </li>
              <li>
                <strong>Server-side processing:</strong> Campaign data is fetched
                in real time from platform APIs and processed on our servers to
                generate analytics and recommendations. We do not permanently store
                your campaign data on our servers — it is fetched fresh on each
                dashboard load.
              </li>
              <li>
                <strong>AI processing:</strong> Anonymized, aggregated campaign
                metrics may be sent to AI services to generate recommendations.
                No personally identifiable information or raw authentication
                credentials are included in AI requests.
              </li>
              <li>
                <strong>Encryption:</strong> All data in transit is encrypted via
                HTTPS/TLS. Authentication tokens stored client-side are protected
                by browser security policies.
              </li>
            </ul>
          </Section>

          <Section title="5. Data Sharing">
            <p>
              We do <strong>not</strong> sell, rent, or share your data with third
              parties. Your advertising data is accessible only to you through your
              authenticated session.
            </p>
            <p>
              We may share data only in the following limited circumstances:
            </p>
            <ul>
              <li>With your explicit consent</li>
              <li>To comply with legal obligations, court orders, or law enforcement requests</li>
              <li>To protect our rights, safety, or property</li>
            </ul>
          </Section>

          <Section title="6. Third-Party Platform APIs">
            <p>
              Our Service integrates with the following platforms through their
              official APIs:
            </p>
            <ul>
              <li>
                <strong>Meta (Facebook/Instagram)</strong> — Meta Marketing API,
                governed by{" "}
                <a
                  href="https://www.facebook.com/policy.php"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  Meta&apos;s Data Policy
                </a>
              </li>
              <li>
                <strong>Google Ads &amp; Display &amp; Video 360</strong> — Google
                Ads API and DV360 API, governed by{" "}
                <a
                  href="https://policies.google.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  Google&apos;s Privacy Policy
                </a>
              </li>
              <li>
                <strong>Snapchat</strong> — Snapchat Marketing API, governed by{" "}
                <a
                  href="https://values.snap.com/privacy/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  Snap&apos;s Privacy Policy
                </a>
              </li>
            </ul>
            <p>
              Your use of these platforms is also subject to their respective terms
              of service and data policies.
            </p>
          </Section>

          <Section title="7. Data Retention &amp; Deletion">
            <p>
              Since we do not permanently store your campaign data on our servers,
              there is no server-side data to retain. Authentication tokens stored
              in your browser can be cleared at any time by:
            </p>
            <ul>
              <li>Clicking the &quot;Disconnect&quot; button for any platform in the dashboard</li>
              <li>Clicking &quot;Logout&quot; to clear all stored credentials</li>
              <li>Clearing your browser&apos;s localStorage</li>
            </ul>
            <p>
              You may also request complete deletion of any data associated with
              your account by contacting us at{" "}
              <a
                href={`mailto:${contactEmail}`}
                className="text-blue-400 hover:text-blue-300 underline"
              >
                {contactEmail}
              </a>
              . We will process deletion requests within 30 days.
            </p>
          </Section>

          <Section title="8. Your Rights">
            <p>
              Depending on your location, you may have the following rights:
            </p>
            <ul>
              <li><strong>Access:</strong> Request a copy of the data we process about you</li>
              <li><strong>Correction:</strong> Request correction of inaccurate data</li>
              <li><strong>Deletion:</strong> Request deletion of your data</li>
              <li><strong>Portability:</strong> Request your data in a portable format</li>
              <li><strong>Objection:</strong> Object to certain types of processing</li>
              <li><strong>Withdrawal of consent:</strong> Withdraw consent at any time by disconnecting your accounts</li>
            </ul>
            <p>
              To exercise any of these rights, contact us at{" "}
              <a
                href={`mailto:${contactEmail}`}
                className="text-blue-400 hover:text-blue-300 underline"
              >
                {contactEmail}
              </a>
              .
            </p>
          </Section>

          <Section title="9. Cookies &amp; Tracking">
            <p>
              Our Service does not use cookies for tracking or advertising purposes.
              We use browser localStorage solely to persist your authentication
              session and platform credentials. No third-party tracking scripts or
              analytics cookies are embedded in the Service.
            </p>
          </Section>

          <Section title="10. Children&apos;s Privacy">
            <p>
              Our Service is not intended for use by anyone under the age of 18.
              We do not knowingly collect data from children. If you believe a
              child has provided us with data, please contact us and we will
              delete it promptly.
            </p>
          </Section>

          <Section title="11. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. Changes will
              be posted on this page with an updated &quot;Last updated&quot; date.
              Continued use of the Service after changes constitutes acceptance
              of the updated policy.
            </p>
          </Section>

          <Section title="12. Contact Us">
            <p>
              If you have questions about this Privacy Policy or our data
              practices, contact us at:
            </p>
            <ul>
              <li>
                Email:{" "}
                <a
                  href={`mailto:${contactEmail}`}
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  {contactEmail}
                </a>
              </li>
              <li>
                Website:{" "}
                <a
                  href={siteUrl}
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  {siteUrl}
                </a>
              </li>
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-semibold text-white mb-4">{title}</h2>
      <div className="space-y-3 text-gray-300 leading-relaxed [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:space-y-2 [&_li]:text-gray-300">
        {children}
      </div>
    </section>
  );
}
