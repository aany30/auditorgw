import { useState } from "react";
import { useRouter } from "next/router";
import { useAuthStore } from "@/store/auth";
import { CheckCircle2, XCircle, AlertCircle, Loader2, Lightbulb, ArrowRight } from "lucide-react";

interface CredentialInputProps {
  platform: "meta" | "google";
  // Renamed in callers to `onComplete` — both names accepted for compatibility.
  onClose?: () => void;
  onComplete?: () => void;
}

interface TestResult {
  ok: boolean;
  platform: string;
  message: string;
  details?: string;
  hint?: string;
}

export default function CredentialInput({ platform, onClose, onComplete }: CredentialInputProps) {
  const router = useRouter();
  const { setMetaCredentials, setGoogleCredentials } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const done = () => { onComplete?.(); onClose?.(); };

  const [metaForm, setMetaForm] = useState({
    accessToken: "",
    businessId: "",
    pixelIds: "",
  });

  const [googleForm, setGoogleForm] = useState({
    accessToken: "",
    customerId: "",
    propertyId: "",
    containerId: "",
    developerToken: "",
    loginCustomerId: "",
  });


  const inputClass =
    "w-full bg-white text-gray-900 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

  const testMetaConnection = async () => {
    setTesting(true);
    setTestResults(null);
    setError(null);
    try {
      const pixelIds = metaForm.pixelIds.split(",").map((id) => id.trim()).filter(Boolean);
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "meta",
          accessToken: metaForm.accessToken,
          businessId: metaForm.businessId,
          pixelIds,
        }),
      });
      const data = await res.json();
      setTestResults(data.results || []);
    } catch (e: any) {
      setError("Connection test failed: " + e.message);
    } finally {
      setTesting(false);
    }
  };

  const testGoogleConnection = async () => {
    setTesting(true);
    setTestResults(null);
    setError(null);
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "google",
          accessToken: googleForm.accessToken,
          customerId: googleForm.customerId,
          propertyId: googleForm.propertyId,
          containerId: googleForm.containerId,
          developerToken: googleForm.developerToken,
          loginCustomerId: googleForm.loginCustomerId,
        }),
      });
      const data = await res.json();
      setTestResults(data.results || []);
    } catch (e: any) {
      setError("Connection test failed: " + e.message);
    } finally {
      setTesting(false);
    }
  };

  const handleMetaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      if (!metaForm.accessToken.trim()) throw new Error("Access token is required");
      if (!metaForm.businessId.trim()) throw new Error("Business ID is required");
      // Pixel IDs are optional — they're auto-derived from the ad account
      // when missing, so users don't need to look them up upfront.
      const pixelIds = metaForm.pixelIds.split(",").map((id) => id.trim()).filter(Boolean);
      setMetaCredentials(metaForm.accessToken.trim(), metaForm.businessId.trim(), pixelIds);
      setMetaForm({ accessToken: "", businessId: "", pixelIds: "" });
      setSavedSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      // MINIMUM requirements (only 3 fields). GA4 + GTM optional.
      if (!googleForm.accessToken.trim()) throw new Error("Refresh Token is required");
      if (!googleForm.developerToken.trim()) throw new Error("Developer Token is required");
      if (!googleForm.customerId.trim()) throw new Error("Customer ID is required");

      setGoogleCredentials(
        googleForm.accessToken.trim(),
        googleForm.customerId.trim(),
        googleForm.propertyId.trim() || "",     // optional — empty means skip GA4 audit
        googleForm.containerId.trim() || "",    // optional — empty means skip GTM audit
        googleForm.developerToken.trim(),
        googleForm.loginCustomerId.trim() || undefined
      );
      setGoogleForm({ accessToken: "", customerId: "", propertyId: "", containerId: "", developerToken: "", loginCustomerId: "" });
      setSavedSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const renderTestResults = () => {
    if (!testResults) return null;
    const allOk = testResults.every((r) => r.ok);
    return (
      <div className={`border rounded-lg p-3 space-y-2 ${allOk ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}`}>
        <div className="font-semibold text-sm text-gray-900 mb-2">
          {allOk ? "All checks passed" : `${testResults.filter((r) => !r.ok).length} of ${testResults.length} checks failed`}
        </div>
        {testResults.map((r, idx) => (
          <div key={idx} className="flex items-start gap-2 text-sm">
            {r.ok ? (
              <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            )}
            <div className="flex-1">
              <div className="font-medium text-gray-900">
                {r.platform}: <span className="font-normal text-gray-700">{r.message}</span>
              </div>
              {r.details && <div className="text-xs text-gray-600 mt-1 font-mono bg-white p-1.5 rounded border border-gray-200">{r.details}</div>}
              {r.hint && (
                <div className="text-xs text-blue-700 mt-1 flex items-start gap-1">
                  <Lightbulb className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>{r.hint}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Success screen — shows "Go to Dashboard" CTA after successful save.
  if (savedSuccess) {
    return (
      <div className="bg-green-50 border-2 border-green-300 rounded-xl p-6 text-center space-y-4">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-green-500 rounded-full">
          <CheckCircle2 className="w-8 h-8 text-white" strokeWidth={2.5} />
        </div>
        <div>
          <h3 className="text-xl font-bold text-green-900">
            {platform === "meta" ? "Meta" : "Google"} connected!
          </h3>
          <p className="text-green-700 text-sm mt-1">
            Your credentials are saved. Open the dashboard to see your live data.
          </p>
        </div>
        <button
          onClick={() => router.push("/app/dashboard")}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition shadow-sm"
        >
          Go to Dashboard
          <ArrowRight className="w-4 h-4" />
        </button>
        <div>
          <button
            onClick={() => { setSavedSuccess(false); done(); }}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Connect another account first
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {platform === "meta" ? (
        <form onSubmit={handleMetaSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              Access Token (User or System Token)
            </label>
            <textarea
              value={metaForm.accessToken}
              onChange={(e) => setMetaForm({ ...metaForm, accessToken: e.target.value })}
              placeholder="EAAB..."
              className={inputClass}
              rows={3}
            />
            <p className="text-gray-500 text-xs mt-1">
              Required scopes: ads_management, business_management, read_insights
            </p>
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              Ad Account ID
              <span className="ml-1 text-xs font-normal text-gray-500">— from Ads Manager URL (act_XXXXXXX)</span>
            </label>
            <input
              type="text"
              value={metaForm.businessId}
              onChange={(e) => setMetaForm({ ...metaForm, businessId: e.target.value })}
              placeholder="e.g., 123456789012345 or act_123456789012345"
              className={inputClass}
            />
            <p className="text-gray-500 text-xs mt-1">
              Find this in Ads Manager → Settings → Ad Account ID (the number after "act_").
            </p>
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              Pixel IDs (comma-separated)
              <span className="ml-1 text-xs font-normal text-gray-500">— optional</span>
            </label>
            <input
              type="text"
              value={metaForm.pixelIds}
              onChange={(e) => setMetaForm({ ...metaForm, pixelIds: e.target.value })}
              placeholder="Leave blank to auto-detect from your ad accounts"
              className={inputClass}
            />
            <p className="text-gray-500 text-xs mt-1">
              Skip this to audit all pixels in your account. Specify IDs to scope the audit to specific pixels.
            </p>
          </div>

          {renderTestResults()}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={testMetaConnection}
              disabled={testing || !metaForm.accessToken || !metaForm.businessId}
              className="flex-1 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 text-gray-700 font-semibold py-2.5 px-4 rounded-lg transition flex items-center justify-center gap-2"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Test Connection
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-2.5 px-4 rounded-lg transition"
            >
              {isLoading ? "Saving..." : "Connect Meta"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 px-4 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleGoogleSubmit} className="space-y-4">
          {/* REQUIRED #1 — Refresh Token (formerly mislabeled as "OAuth Access Token") */}
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              Refresh Token <span className="text-red-600">*</span>
            </label>
            <textarea
              value={googleForm.accessToken}
              onChange={(e) => setGoogleForm({ ...googleForm, accessToken: e.target.value })}
              placeholder="1//0gExA-MEnW5lkCgYIARAAGBASNwF..."
              className={inputClass}
              rows={3}
            />
            <p className="text-gray-500 text-xs mt-1">
              From OAuth Playground. Starts with <code className="bg-gray-100 px-1 rounded">1//</code>. Required scope: <code className="bg-gray-100 px-1 rounded">https://www.googleapis.com/auth/adwords</code>
            </p>
          </div>

          {/* REQUIRED #2 — Developer Token (was hidden in "Advanced" section) */}
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              Developer Token <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={googleForm.developerToken}
              onChange={(e) => setGoogleForm({ ...googleForm, developerToken: e.target.value })}
              placeholder="e.g., abc123XYZ_aBcDeFgH9iJkL"
              className={inputClass}
            />
            <p className="text-gray-500 text-xs mt-1">
              From <code className="bg-gray-100 px-1 rounded">ads.google.com → Tools → API Center</code>. Approval takes 1-3 business days.
            </p>
          </div>

          {/* REQUIRED #3 — Customer ID */}
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              Google Ads Customer ID <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={googleForm.customerId}
              onChange={(e) => setGoogleForm({ ...googleForm, customerId: e.target.value })}
              placeholder="e.g., 123-456-7890"
              className={inputClass}
            />
            <p className="text-gray-500 text-xs mt-1">
              Top-right of <code className="bg-gray-100 px-1 rounded">ads.google.com</code>. 10-digit number with dashes (dashes optional).
            </p>
          </div>

          <details className="border border-gray-200 rounded-lg">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 select-none">
              Optional — GA4 + GTM fields (skip if you only want Google Ads data)
            </summary>
            <div className="p-4 space-y-4 border-t border-gray-200">
              <div>
                <label className="block text-gray-700 text-sm font-semibold mb-2">
                  GA4 Property ID <span className="text-xs text-gray-400 font-normal">(optional — for GA4 audit only)</span>
                </label>
                <input
                  type="text"
                  value={googleForm.propertyId}
                  onChange={(e) => setGoogleForm({ ...googleForm, propertyId: e.target.value })}
                  placeholder="e.g., 123456789"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-gray-700 text-sm font-semibold mb-2">
                  GTM Container ID <span className="text-xs text-gray-400 font-normal">(optional — for GTM audit only)</span>
                </label>
                <input
                  type="text"
                  value={googleForm.containerId}
                  onChange={(e) => setGoogleForm({ ...googleForm, containerId: e.target.value })}
                  placeholder="e.g., GTM-XXXXXX"
                  className={inputClass}
                />
              </div>
            </div>
          </details>

          {/* Optional — Login Customer ID (only needed for MCC accounts) */}
          <details className="border border-gray-200 rounded-lg">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 select-none">
              Optional — Login Customer ID (only if using a Manager / MCC account)
            </summary>
            <div className="p-4 border-t border-gray-200">
              <label className="block text-gray-700 text-sm font-semibold mb-2">
                Login Customer ID <span className="text-xs text-gray-400 font-normal">(optional — MCC accounts only)</span>
              </label>
              <input
                type="text"
                value={googleForm.loginCustomerId}
                onChange={(e) => setGoogleForm({ ...googleForm, loginCustomerId: e.target.value })}
                placeholder="If using MCC, enter the manager Customer ID"
                className={inputClass}
              />
              <p className="text-gray-500 text-xs mt-1">
                Skip if you have a single Google Ads account (no Manager). The Manager&apos;s Customer ID is shown top-right when you switch to MCC view.
              </p>
            </div>
          </details>

          {renderTestResults()}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={testGoogleConnection}
              disabled={testing || !googleForm.accessToken || !googleForm.customerId}
              className="flex-1 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 text-gray-700 font-semibold py-2.5 px-4 rounded-lg transition flex items-center justify-center gap-2"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Test Connection
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-2.5 px-4 rounded-lg transition"
            >
              {isLoading ? "Saving..." : "Connect Google"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 px-4 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
