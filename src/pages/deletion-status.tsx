import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

export default function DeletionStatus() {
  const router = useRouter();
  const { code } = router.query;
  const companyName = process.env.NEXT_PUBLIC_COMPANY_NAME || "Auditor";

  return (
    <>
      <Head>
        <title>Data Deletion Status — {companyName}</title>
      </Head>

      <div className="min-h-screen bg-[#0a0a0f] text-gray-200 flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-6" />

          <h1 className="text-2xl font-bold text-white mb-3">
            Data Deletion Complete
          </h1>

          <p className="text-gray-400 mb-6">
            Your data has been successfully deleted. {companyName} does not
            permanently store advertising data on our servers — all campaign
            data is fetched in real time and authentication tokens are stored
            only in your browser.
          </p>

          {code && (
            <div className="bg-[#1a1a2e] border border-gray-700 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-500 mb-1">Confirmation Code</p>
              <p className="text-sm font-mono text-gray-300 break-all">
                {code}
              </p>
            </div>
          )}

          <p className="text-sm text-gray-500 mb-8">
            If you previously had tokens stored in your browser, you can clear
            them by visiting the app and clicking &quot;Logout&quot; or clearing
            your browser&apos;s localStorage.
          </p>

          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </div>
    </>
  );
}
