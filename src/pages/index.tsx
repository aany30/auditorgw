import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useAuthStore } from "@/store/auth";
import MetaGuide from "@/components/guides/MetaGuide";
import GoogleGuide from "@/components/guides/GoogleGuide";
import {
  BarChart3,
  Sparkles,
  ArrowRight,
  Activity,
  TrendingUp,
  Bot,
  BookOpen,
  CheckCircle2,
  Rocket,
  Users,
  Search,
} from "lucide-react";

export default function Landing() {
  const router = useRouter();
  const { isMetaConnected, isGoogleConnected, setMetaCredentials, setGoogleCredentials } = useAuthStore();
  const [activeTab, setActiveTab] = useState<"meta" | "google" | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const connected = mounted && (isMetaConnected() || isGoogleConnected());

  const loadDemoData = () => {
    setMetaCredentials("demo-meta-token", "demo-business-123", ["demo-pixel-001", "demo-pixel-002"]);
    setGoogleCredentials("demo-google-token", "123-456-7890", "GA4-DEMO-001", "GTM-DEMO");
    router.push("/app/dashboard");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50">
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-blue-600" strokeWidth={2.5} />
            <span className="bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">Auditor</span>
          </div>
          <div className="flex gap-3 items-center">
            <button
              onClick={loadDemoData}
              className="px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg hover:from-purple-600 hover:to-purple-700 font-semibold text-sm shadow-sm transition flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              View Demo
            </button>
            {connected && (
              <Link href="/app/dashboard" className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm shadow-sm flex items-center gap-2">
                Go to Dashboard
                <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        </div>
      </nav>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-100 text-blue-700 rounded-full text-sm font-semibold mb-6">
            <Rocket className="w-4 h-4" />
            Enterprise-Grade Tracking Intelligence
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6 tracking-tight">
            AI-Powered Tracking <br />
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Audit Tool</span>
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed">
            Monitor, validate, and optimize your Meta and Google tracking implementation in real-time.
            Detect issues faster and improve conversion signal quality with AI-driven insights.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 mb-12">
            <button
              onClick={loadDemoData}
              className="px-8 py-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg hover:from-purple-600 hover:to-purple-700 font-semibold text-base shadow-md transition flex items-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              Try Demo Dashboard
            </button>
            <a
              href="#connect"
              className="px-8 py-3 bg-white border-2 border-gray-200 text-gray-700 rounded-lg hover:border-gray-300 font-semibold text-base shadow-sm transition"
            >
              Connect Your Account
            </a>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mt-12">
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition">
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mb-4 mx-auto">
                <Activity className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-gray-900 font-bold mb-2">Pixel Health Monitoring</h3>
              <p className="text-gray-600 text-sm">Real-time tracking of event firing, duplicates, and latency</p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4 mx-auto">
                <TrendingUp className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-gray-900 font-bold mb-2">Event Quality Scoring</h3>
              <p className="text-gray-600 text-sm">EMQ analysis, hash quality, and match rate optimization</p>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4 mx-auto">
                <Bot className="w-6 h-6 text-purple-600" />
              </div>
              <h3 className="text-gray-900 font-bold mb-2">AI Recommendations</h3>
              <p className="text-gray-600 text-sm">Intelligent insights with prioritized fixes and impact scores</p>
            </div>
          </div>
        </div>
      </section>

      <section id="connect" className="max-w-6xl mx-auto px-6 pb-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">Connect Your Accounts</h2>
          <p className="text-gray-600">
            Click-by-click guide. Click Meta or Google below to expand the full walkthrough — every link, button name, and exactly what to paste where.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
            <div className="flex items-center mb-6">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900">Meta Connection</h3>
              {mounted && isMetaConnected() && (
                <span className="ml-auto text-green-700 text-sm font-semibold bg-green-50 px-3 py-1 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> Connected
                </span>
              )}
            </div>

            <div className="space-y-4">
              <button
                onClick={() => setActiveTab(activeTab === "meta" ? null : "meta")}
                className={`w-full py-2.5 px-4 rounded-lg font-semibold transition text-sm flex items-center justify-center gap-2 ${
                  activeTab === "meta"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <BookOpen className="w-4 h-4" />
                {activeTab === "meta" ? "Hide guide" : "Show the click-by-click guide"}
              </button>

              {activeTab === "meta" && <MetaGuide onClose={() => setActiveTab(null)} />}

              {activeTab !== "meta" && (
                <div className="text-gray-600 text-sm space-y-2 pt-2">
                  <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Monitor pixel health and event firing</p>
                  <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Track Event Match Quality (EMQ)</p>
                  <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Validate CAPI implementation</p>
                  <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Analyze funnel performance</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
            <div className="flex items-center mb-6">
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mr-3">
                <Search className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900">Google Connection</h3>
              {mounted && isGoogleConnected() && (
                <span className="ml-auto text-green-700 text-sm font-semibold bg-green-50 px-3 py-1 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> Connected
                </span>
              )}
            </div>

            <div className="space-y-4">
              <button
                onClick={() => setActiveTab(activeTab === "google" ? null : "google")}
                className={`w-full py-2.5 px-4 rounded-lg font-semibold transition text-sm flex items-center justify-center gap-2 ${
                  activeTab === "google"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <BookOpen className="w-4 h-4" />
                {activeTab === "google" ? "Hide guide" : "Show the click-by-click guide"}
              </button>

              {activeTab === "google" && <GoogleGuide onClose={() => setActiveTab(null)} />}

              {activeTab !== "google" && (
                <div className="text-gray-600 text-sm space-y-2 pt-2">
                  <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Track Google Ads conversions</p>
                  <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Validate GA4 event setup</p>
                  <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Audit GTM container health</p>
                  <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Monitor enhanced conversions</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {connected && (
        <section className="bg-gradient-to-r from-blue-50 to-purple-50 border-t border-gray-200">
          <div className="max-w-6xl mx-auto px-6 py-12 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Ready to audit your tracking?</h2>
            <Link
              href="/app/dashboard"
              className="inline-flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-semibold hover:from-blue-600 hover:to-blue-700 transition shadow-md"
            >
              Launch Dashboard
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </section>
      )}

      <footer className="bg-white border-t border-gray-200 py-8 text-center text-gray-500">
        <p>AI Tracking Audit Tool — Enterprise-grade tracking intelligence</p>
      </footer>
    </div>
  );
}
