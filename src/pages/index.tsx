import { useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/store/auth";
import MetaGuide from "@/components/guides/MetaGuide";
import GoogleGuide from "@/components/guides/GoogleGuide";
import CredentialInput from "@/components/forms/CredentialInput";

export default function Landing() {
  const { isMetaConnected, isGoogleConnected } = useAuthStore();
  const [activeTab, setActiveTab] = useState<"meta" | "google" | null>(null);
  const [inputMode, setInputMode] = useState<"guide" | "manual" | "oauth">("guide");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold text-white">
            📊 <span className="bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent">Auditor</span>
          </div>
          {(isMetaConnected() || isGoogleConnected()) && (
            <Link href="/app/dashboard" className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Go to Dashboard
            </Link>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">
            AI-Powered Tracking Audit Tool
          </h1>
          <p className="text-xl text-slate-300 mb-8 max-w-3xl mx-auto">
            Monitor, validate, and optimize your Meta and Google tracking implementation in real-time.
            Detect issues faster and improve conversion signal quality with AI-driven insights.
          </p>

          {/* Feature Highlights */}
          <div className="grid md:grid-cols-3 gap-4 mt-12">
            <div className="bg-slate-700/40 p-6 rounded-lg border border-slate-600">
              <div className="text-3xl mb-2">🔴</div>
              <h3 className="text-white font-semibold mb-2">Pixel Health Monitoring</h3>
              <p className="text-slate-300 text-sm">Real-time tracking of event firing, duplicates, and latency</p>
            </div>
            <div className="bg-slate-700/40 p-6 rounded-lg border border-slate-600">
              <div className="text-3xl mb-2">📈</div>
              <h3 className="text-white font-semibold mb-2">Event Quality Scoring</h3>
              <p className="text-slate-300 text-sm">EMQ analysis, hash quality, and match rate optimization</p>
            </div>
            <div className="bg-slate-700/40 p-6 rounded-lg border border-slate-600">
              <div className="text-3xl mb-2">🤖</div>
              <h3 className="text-white font-semibold mb-2">AI Recommendations</h3>
              <p className="text-slate-300 text-sm">Intelligent insights with prioritized fixes and impact scores</p>
            </div>
          </div>
        </div>
      </section>

      {/* Connection Section */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <h2 className="text-3xl font-bold text-white mb-12 text-center">Connect Your Accounts</h2>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Meta Connection */}
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-8">
            <div className="flex items-center mb-4">
              <div className="text-4xl mr-3">👥</div>
              <h3 className="text-2xl font-bold text-white">Meta Connection</h3>
              {isMetaConnected() && <span className="ml-auto text-green-400 text-sm font-semibold">✓ Connected</span>}
            </div>

            <div className="space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setActiveTab("meta");
                    setInputMode("guide");
                  }}
                  className={`flex-1 py-2 px-4 rounded font-semibold transition ${
                    activeTab === "meta" && inputMode === "guide"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  📖 View Guide
                </button>
                <button
                  onClick={() => {
                    setActiveTab("meta");
                    setInputMode("manual");
                  }}
                  className={`flex-1 py-2 px-4 rounded font-semibold transition ${
                    activeTab === "meta" && inputMode === "manual"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  🔑 Manual Input
                </button>
              </div>

              {activeTab === "meta" && inputMode === "guide" && <MetaGuide />}
              {activeTab === "meta" && inputMode === "manual" && (
                <CredentialInput
                  platform="meta"
                  onClose={() => setActiveTab(null)}
                />
              )}

              {activeTab !== "meta" && (
                <div className="text-slate-400 text-sm space-y-2">
                  <p>✓ Monitor pixel health and event firing</p>
                  <p>✓ Track Event Match Quality (EMQ)</p>
                  <p>✓ Validate CAPI implementation</p>
                  <p>✓ Analyze funnel performance</p>
                </div>
              )}
            </div>
          </div>

          {/* Google Connection */}
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-8">
            <div className="flex items-center mb-4">
              <div className="text-4xl mr-3">🔍</div>
              <h3 className="text-2xl font-bold text-white">Google Connection</h3>
              {isGoogleConnected() && <span className="ml-auto text-green-400 text-sm font-semibold">✓ Connected</span>}
            </div>

            <div className="space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setActiveTab("google");
                    setInputMode("guide");
                  }}
                  className={`flex-1 py-2 px-4 rounded font-semibold transition ${
                    activeTab === "google" && inputMode === "guide"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  📖 View Guide
                </button>
                <button
                  onClick={() => {
                    setActiveTab("google");
                    setInputMode("manual");
                  }}
                  className={`flex-1 py-2 px-4 rounded font-semibold transition ${
                    activeTab === "google" && inputMode === "manual"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  🔑 Manual Input
                </button>
              </div>

              {activeTab === "google" && inputMode === "guide" && <GoogleGuide />}
              {activeTab === "google" && inputMode === "manual" && (
                <CredentialInput
                  platform="google"
                  onClose={() => setActiveTab(null)}
                />
              )}

              {activeTab !== "google" && (
                <div className="text-slate-400 text-sm space-y-2">
                  <p>✓ Track Google Ads conversions</p>
                  <p>✓ Validate GA4 event setup</p>
                  <p>✓ Audit GTM container health</p>
                  <p>✓ Monitor enhanced conversions</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      {(isMetaConnected() || isGoogleConnected()) && (
        <section className="bg-slate-800 border-t border-slate-700">
          <div className="max-w-6xl mx-auto px-6 py-12 text-center">
            <h2 className="text-2xl font-bold text-white mb-4">Ready to audit your tracking?</h2>
            <Link
              href="/app/dashboard"
              className="inline-block px-8 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-semibold hover:from-blue-600 hover:to-blue-700 transition"
            >
              Launch Dashboard →
            </Link>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-700 py-8 text-center text-slate-400">
        <p>AI Tracking Audit Tool • Enterprise-grade tracking intelligence</p>
      </footer>
    </div>
  );
}
