import { useState } from "react";
import { useAuthStore } from "@/store/auth";
import { CheckCircle2, XCircle, AlertCircle, Loader2, Lightbulb } from "lucide-react";

interface CredentialInputProps {
  platform: "meta" | "google";
  onClose: () => void;
}

interface TestResult {
  ok: boolean;
  platform: string;
  message: string;
  details?: string;
  hint?: string;
}

export default function CredentialInput({ platform, onClose }: CredentialInputProps) {
  const { setMetaCredentials, setGoogleCredentials } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);
  const [testing, setTesting] = useState(false);

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

  const [showAdvanced, setShowAdvanced] = useState(false);

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
      onClose();
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
      if (!googleForm.accessToken.trim()) throw new Error("Access token is required");
      if (!googleForm.customerId.trim()) throw new Error("Google Ads Customer ID is required");
      if (!googleForm.propertyId.trim()) throw new Error("GA4 Property ID is required");
      if (!googleForm.containerId.trim()) throw new Error("GTM Container ID is required");

      setGoogleCredentials(
        googleForm.accessToken.trim(),
        googleForm.customerId.trim(),
        googleForm.propertyId.trim(),
        googleForm.containerId.trim(),
        googleForm.developerToken.trim() || undefined,
        googleForm.loginCustomerId.trim() || undefined
      );
      setGoogleForm({ accessToken: "", customerId: "", propertyId: "", containerId: "", developerToken: "", loginCustomerId: "" });
      onClose();
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
            <label className="block text-gray-700 text-sm font-semibold mb-2">Business ID</label>
            <input
              type="text"
              value={metaForm.businessId}
              onChange={(e) => setMetaForm({ ...metaForm, businessId: e.target.value })}
              placeholder="e.g., 123456789012345"
              className={inputClass}
            />
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
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              OAuth Access Token
            </label>
            <textarea
              value={googleForm.accessToken}
              onChange={(e) => setGoogleForm({ ...googleForm, accessToken: e.target.value })}
              placeholder="ya29..."
              className={inputClass}
              rows={3}
            />
            <p className="text-gray-500 text-xs mt-1">
              Required scopes: analytics.readonly, tagmanager.readonly, adwords
            </p>
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              Google Ads Customer ID
            </label>
            <input
              type="text"
              value={googleForm.customerId}
              onChange={(e) => setGoogleForm({ ...googleForm, customerId: e.target.value })}
              placeholder="e.g., 123-456-7890"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">GA4 Property ID</label>
            <input
              type="text"
              value={googleForm.propertyId}
              onChange={(e) => setGoogleForm({ ...googleForm, propertyId: e.target.value })}
              placeholder="e.g., 123456789"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">GTM Container ID</label>
            <input
              type="text"
              value={googleForm.containerId}
              onChange={(e) => setGoogleForm({ ...googleForm, containerId: e.target.value })}
              placeholder="e.g., GTM-XXXXXX"
              className={inputClass}
            />
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-blue-600 hover:text-blue-700 font-semibold"
          >
            {showAdvanced ? "Hide" : "Show"} Google Ads API fields (required for live Ads data)
          </button>

          {showAdvanced && (
            <div className="space-y-3 pl-4 border-l-2 border-blue-200">
              <div>
                <label className="block text-gray-700 text-sm font-semibold mb-2">
                  Google Ads Developer Token
                </label>
                <input
                  type="text"
                  value={googleForm.developerToken}
                  onChange={(e) => setGoogleForm({ ...googleForm, developerToken: e.target.value })}
                  placeholder="From Google Ads > Tools > API Center"
                  className={inputClass}
                />
                <p className="text-gray-500 text-xs mt-1">
                  Apply at developers.google.com/google-ads/api. Without this, Google Ads data will fall back to demo.
                </p>
              </div>
              <div>
                <label className="block text-gray-700 text-sm font-semibold mb-2">
                  Login Customer ID (manager account, optional)
                </label>
                <input
                  type="text"
                  value={googleForm.loginCustomerId}
                  onChange={(e) => setGoogleForm({ ...googleForm, loginCustomerId: e.target.value })}
                  placeholder="If using MCC, enter the manager ID"
                  className={inputClass}
                />
              </div>
            </div>
          )}

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
