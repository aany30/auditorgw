import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useAuthStore } from "@/store/auth";
import MetaGuide from "@/components/guides/MetaGuide";
import DV360Guide from "@/components/guides/DV360Guide";
import SnapchatGuide from "@/components/guides/SnapchatGuide";
import SpotifyGuide from "@/components/guides/SpotifyGuide";
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
  const { isMetaConnected, isDV360Connected, isGoogleAdsConnected, isSnapchatConnected, isSpotifyConnected, enterDemoMode } = useAuthStore();
  const [activeTab, setActiveTab] = useState<"meta" | "dv360" | "snapchat" | "spotify" | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (process.env.NEXT_PUBLIC_HAS_DEFAULT_CREDS) {
      router.replace("/app/dashboard");
    }
  }, [router]);

  const connected = mounted && (isMetaConnected() || isDV360Connected() || isGoogleAdsConnected() || isSnapchatConnected() || isSpotifyConnected());
  const oauthError = typeof router.query.error === "string" ? router.query.error : null;

  const loadDemoData = () => {
    // Session-only demo flag — does NOT persist to localStorage, so other
    // visitors / new tabs / next-session won't accidentally see demo state.
    // The `?demo=1` query param survives refresh + back-button within the tab.
    enterDemoMode();
    router.push("/app/dashboard?demo=1");
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
            Monitor, validate, and optimize your Meta, DV360, Google Ads, Snapchat &amp; Spotify tracking implementation in real-time.
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

      {oauthError && (
        <div className="max-w-6xl mx-auto px-6 mb-4">
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-start gap-2">
            <span className="font-bold">⚠ OAuth failed:</span>
            <span>{oauthError.replace(/_/g, " ")}. Try again or use manual token entry below.</span>
          </div>
        </div>
      )}

      <section id="connect" className="max-w-6xl mx-auto px-6 pb-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">Connect Your Accounts</h2>
          <p className="text-gray-600">
            Click-by-click guide. Click Meta or DV360 below to expand the full walkthrough — every link, button name, and exactly what to paste where.
          </p>
        </div>

        {/* META — equal-weight OAuth + Manual paste cards */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900">Meta Connection</h3>
            </div>
            {mounted && isMetaConnected() && (
              <span className="text-green-700 text-sm font-semibold bg-green-50 px-3 py-1 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> Connected
              </span>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {/* Card A — OAuth */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col">
              <h4 className="font-bold text-gray-900 text-base mb-1">One-click sign-in</h4>
              <p className="text-sm text-gray-600 mb-4 flex-1">
                Quickest. Sign in with your Facebook account and grant access to your ad accounts. No token copying.
              </p>
              <a
                href="/api/auth/meta/start"
                className="w-full py-3 px-4 rounded-lg font-bold text-sm flex items-center justify-center gap-2 bg-[#1877F2] text-white hover:bg-[#166fe0] transition shadow-sm"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                Connect with Meta
              </a>
            </div>
            {/* Card B — Manual paste */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col">
              <h4 className="font-bold text-gray-900 text-base mb-1">Paste tokens manually</h4>
              <p className="text-sm text-gray-600 mb-4 flex-1">
                For agencies with an existing System User token, Business ID, and Pixel IDs ready.
              </p>
              <button
                onClick={() => setActiveTab(activeTab === "meta" ? null : "meta")}
                className={`w-full py-3 px-4 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition shadow-sm ${
                  activeTab === "meta"
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "bg-gray-900 text-white hover:bg-gray-800"
                }`}
              >
                <BookOpen className="w-4 h-4" />
                {activeTab === "meta" ? "Hide manual guide" : "Show manual guide"}
              </button>
            </div>
          </div>
          {activeTab === "meta" && (
            <div className="mt-4">
              <MetaGuide onClose={() => setActiveTab(null)} />
            </div>
          )}
        </div>

        {/* DV360 Connection */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                <Search className="w-5 h-5 text-emerald-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900">DV360 Connection</h3>
            </div>
            {mounted && isDV360Connected() && (
              <span className="text-green-700 text-xs font-semibold bg-green-50 px-2 py-1 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Connected
              </span>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col">
              <h4 className="font-bold text-gray-900 text-base mb-1">One-click sign-in</h4>
              <p className="text-sm text-gray-600 mb-4 flex-1">
                Sign in with your Google account. We&apos;ll fetch your DV360 advertisers automatically — no tokens to copy.
              </p>
              <a
                href="/api/auth/google/start"
                className="w-full py-3 px-4 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition shadow-sm bg-white border-2 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.97 10.97 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Connect with Google
              </a>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col">
              <h4 className="font-bold text-gray-900 text-base mb-1">Paste credentials manually</h4>
              <p className="text-sm text-gray-600 mb-4 flex-1">
                For advanced users — paste OAuth Client ID, Secret, Refresh Token, and Advertiser ID directly.
              </p>
              <button
                onClick={() => setActiveTab(activeTab === "dv360" ? null : "dv360")}
                className={`w-full py-3 px-4 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition shadow-sm ${
                  activeTab === "dv360"
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "bg-gray-900 text-white hover:bg-gray-800"
                }`}
              >
                <BookOpen className="w-4 h-4" />
                {activeTab === "dv360" ? "Hide manual guide" : "Show manual guide"}
              </button>
            </div>
          </div>
          {activeTab === "dv360" && (
            <div className="mt-4">
              <DV360Guide onClose={() => setActiveTab(null)} />
            </div>
          )}
        </div>

        {/* Google Ads Connection */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.97 10.97 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900">Google Ads Connection</h3>
            </div>
            {mounted && isGoogleAdsConnected() && (
              <span className="text-green-700 text-xs font-semibold bg-green-50 px-2 py-1 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Connected
              </span>
            )}
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h4 className="font-bold text-gray-900 text-base mb-1">One-click sign-in</h4>
            <p className="text-sm text-gray-600 mb-4">
              Sign in with your Google account and select your Google Ads Customer ID. Uses the same Google OAuth — if you already connected DV360, we&apos;ll detect your Google Ads accounts too.
            </p>
            <a
              href="/api/auth/google/start"
              className="w-full py-3 px-4 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition shadow-sm bg-white border-2 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.97 10.97 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Connect with Google
            </a>
          </div>
        </div>

        {/* Snapchat Connection */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-yellow-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301a.477.477 0 0 1 .494.034.483.483 0 0 1 .224.413c-.003.2-.154.462-.469.667-.293.191-.678.369-1.08.503-.112.037-.208.087-.295.161-.065.054-.111.123-.145.198.033.197.116.42.255.633.396.611 1.028 1.136 1.726 1.402a.466.466 0 0 1 .314.448c-.003.093-.03.181-.072.259-.143.309-.677.585-1.547.803-.2.049-.361.131-.468.256-.105.122-.177.284-.218.453-.077.317-.159.662-.476.834a.578.578 0 0 1-.298.088c-.128 0-.265-.04-.413-.086-.219-.068-.472-.144-.788-.144a2.38 2.38 0 0 0-.372.028c-.345.052-.736.247-1.189.49-.776.416-1.735.933-3.049.933-1.33 0-2.294-.523-3.078-.943-.443-.238-.825-.443-1.162-.494a2.42 2.42 0 0 0-.371-.027c-.332 0-.591.083-.808.149-.14.044-.264.082-.382.082a.617.617 0 0 1-.339-.102c-.29-.168-.372-.498-.448-.808-.042-.174-.116-.34-.224-.465-.108-.126-.272-.21-.474-.26-.859-.216-1.386-.49-1.53-.8a.49.49 0 0 1-.073-.262.466.466 0 0 1 .316-.45c.699-.265 1.33-.79 1.726-1.401.14-.213.222-.436.255-.633a.564.564 0 0 0-.145-.198 1.063 1.063 0 0 0-.295-.161c-.4-.134-.787-.312-1.08-.503-.315-.205-.466-.468-.47-.668a.482.482 0 0 1 .226-.413.477.477 0 0 1 .494-.034c.374.181.733.285 1.033.301.199 0 .326-.045.401-.09a31.03 31.03 0 0 1-.033-.57c-.104-1.628-.23-3.654.299-4.847C7.86 1.069 11.216.793 12.206.793z"/>
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900">Snapchat Connection</h3>
            </div>
            {mounted && isSnapchatConnected() && (
              <span className="text-green-700 text-xs font-semibold bg-green-50 px-2 py-1 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Connected
              </span>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col">
              <h4 className="font-bold text-gray-900 text-base mb-1">One-click sign-in</h4>
              <p className="text-sm text-gray-600 mb-4 flex-1">
                Sign in with your Snapchat account. We&apos;ll fetch your ad accounts and org automatically.
              </p>
              <a
                href="/api/auth/snapchat/start"
                className="w-full py-3 px-4 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition shadow-sm bg-[#FFFC00] text-black hover:bg-[#f5f200] border-2 border-yellow-400"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301a.477.477 0 0 1 .494.034.483.483 0 0 1 .224.413c-.003.2-.154.462-.469.667-.293.191-.678.369-1.08.503-.112.037-.208.087-.295.161-.065.054-.111.123-.145.198.033.197.116.42.255.633.396.611 1.028 1.136 1.726 1.402a.466.466 0 0 1 .314.448c-.003.093-.03.181-.072.259-.143.309-.677.585-1.547.803-.2.049-.361.131-.468.256-.105.122-.177.284-.218.453-.077.317-.159.662-.476.834a.578.578 0 0 1-.298.088c-.128 0-.265-.04-.413-.086-.219-.068-.472-.144-.788-.144a2.38 2.38 0 0 0-.372.028c-.345.052-.736.247-1.189.49-.776.416-1.735.933-3.049.933-1.33 0-2.294-.523-3.078-.943-.443-.238-.825-.443-1.162-.494a2.42 2.42 0 0 0-.371-.027c-.332 0-.591.083-.808.149-.14.044-.264.082-.382.082a.617.617 0 0 1-.339-.102c-.29-.168-.372-.498-.448-.808-.042-.174-.116-.34-.224-.465-.108-.126-.272-.21-.474-.26-.859-.216-1.386-.49-1.53-.8a.49.49 0 0 1-.073-.262.466.466 0 0 1 .316-.45c.699-.265 1.33-.79 1.726-1.401.14-.213.222-.436.255-.633a.564.564 0 0 0-.145-.198 1.063 1.063 0 0 0-.295-.161c-.4-.134-.787-.312-1.08-.503-.315-.205-.466-.468-.47-.668a.482.482 0 0 1 .226-.413.477.477 0 0 1 .494-.034c.374.181.733.285 1.033.301.199 0 .326-.045.401-.09a31.03 31.03 0 0 1-.033-.57c-.104-1.628-.23-3.654.299-4.847C7.86 1.069 11.216.793 12.206.793z"/>
                </svg>
                Connect with Snapchat
              </a>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col">
              <h4 className="font-bold text-gray-900 text-base mb-1">Enter Ad Account ID</h4>
              <p className="text-sm text-gray-600 mb-4 flex-1">
                Paste your Refresh Token and Ad Account ID to connect directly.
              </p>
              <button
                onClick={() => setActiveTab(activeTab === "snapchat" ? null : "snapchat")}
                className={`w-full py-3 px-4 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition shadow-sm ${
                  activeTab === "snapchat"
                    ? "bg-yellow-500 text-black hover:bg-yellow-600"
                    : "bg-gray-900 text-white hover:bg-gray-800"
                }`}
              >
                <BookOpen className="w-4 h-4" />
                {activeTab === "snapchat" ? "Hide" : "Enter credentials"}
              </button>
            </div>
          </div>
          {activeTab === "snapchat" && (
            <div className="mt-4">
              <SnapchatGuide onClose={() => setActiveTab(null)} />
            </div>
          )}
        </div>

        {/* Spotify Connection */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900">Spotify Connection</h3>
            </div>
            {mounted && isSpotifyConnected() && (
              <span className="text-green-700 text-xs font-semibold bg-green-50 px-2 py-1 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Connected
              </span>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col">
              <h4 className="font-bold text-gray-900 text-base mb-1">One-click sign-in</h4>
              <p className="text-sm text-gray-600 mb-4 flex-1">
                Sign in with your Spotify account. We&apos;ll fetch your ad accounts automatically.
              </p>
              <a
                href="/api/auth/spotify/start"
                className="w-full py-3 px-4 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition shadow-sm bg-[#1DB954] text-white hover:bg-[#1aa34a] border-2 border-green-500"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
                Connect with Spotify
              </a>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col">
              <h4 className="font-bold text-gray-900 text-base mb-1">Enter Ad Account ID</h4>
              <p className="text-sm text-gray-600 mb-4 flex-1">
                Paste your Refresh Token and Ad Account ID to connect directly.
              </p>
              <button
                onClick={() => setActiveTab(activeTab === "spotify" ? null : "spotify")}
                className={`w-full py-3 px-4 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition shadow-sm ${
                  activeTab === "spotify"
                    ? "bg-green-500 text-white hover:bg-green-600"
                    : "bg-gray-900 text-white hover:bg-gray-800"
                }`}
              >
                <BookOpen className="w-4 h-4" />
                {activeTab === "spotify" ? "Hide" : "Enter credentials"}
              </button>
            </div>
          </div>
          {activeTab === "spotify" && (
            <div className="mt-4">
              <SpotifyGuide onClose={() => setActiveTab(null)} />
            </div>
          )}
        </div>

        {/* Privacy reassurance — addresses "will other companies see my data?" */}
        <div className="mt-8 bg-gray-50 border border-gray-200 rounded-lg px-5 py-4 text-sm text-gray-600 flex items-start gap-3">
          <span className="text-lg">🔒</span>
          <div>
            <span className="font-semibold text-gray-800">Your data stays private.</span>{" "}
            Credentials are stored only in your browser&apos;s local storage — never sent to our servers, never shared. Other companies using this platform cannot see your ad data, and you cannot see theirs.
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
