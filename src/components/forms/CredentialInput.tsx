import { useState } from "react";
import { useAuthStore } from "@/store/auth";

interface CredentialInputProps {
  platform: "meta" | "google";
  onClose: () => void;
}

export default function CredentialInput({ platform, onClose }: CredentialInputProps) {
  const { setMetaCredentials, setGoogleCredentials } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  });

  const handleMetaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (!metaForm.accessToken.trim()) {
        throw new Error("Access token is required");
      }
      if (!metaForm.businessId.trim()) {
        throw new Error("Business ID is required");
      }
      if (!metaForm.pixelIds.trim()) {
        throw new Error("At least one Pixel ID is required");
      }

      const pixelIds = metaForm.pixelIds
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id);

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
      if (!googleForm.accessToken.trim()) {
        throw new Error("Access token or API key is required");
      }
      if (!googleForm.customerId.trim()) {
        throw new Error("Google Ads Customer ID is required");
      }
      if (!googleForm.propertyId.trim()) {
        throw new Error("GA4 Property ID is required");
      }
      if (!googleForm.containerId.trim()) {
        throw new Error("GTM Container ID is required");
      }

      setGoogleCredentials(
        googleForm.accessToken.trim(),
        googleForm.customerId.trim(),
        googleForm.propertyId.trim(),
        googleForm.containerId.trim()
      );
      setGoogleForm({ accessToken: "", customerId: "", propertyId: "", containerId: "" });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-200 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}

      {platform === "meta" ? (
        <form onSubmit={handleMetaSubmit} className="space-y-4">
          <div>
            <label className="block text-white text-sm font-semibold mb-2">
              Access Token (User or System Token)
            </label>
            <textarea
              value={metaForm.accessToken}
              onChange={(e) =>
                setMetaForm({ ...metaForm, accessToken: e.target.value })
              }
              placeholder="Paste your Meta access token here"
              className="w-full bg-slate-700 text-white border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-white text-sm font-semibold mb-2">
              Business ID
            </label>
            <input
              type="text"
              value={metaForm.businessId}
              onChange={(e) =>
                setMetaForm({ ...metaForm, businessId: e.target.value })
              }
              placeholder="e.g., 123456789"
              className="w-full bg-slate-700 text-white border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-white text-sm font-semibold mb-2">
              Pixel IDs (comma-separated)
            </label>
            <input
              type="text"
              value={metaForm.pixelIds}
              onChange={(e) =>
                setMetaForm({ ...metaForm, pixelIds: e.target.value })
              }
              placeholder="e.g., 123456789, 987654321"
              className="w-full bg-slate-700 text-white border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
            <p className="text-slate-400 text-xs mt-1">
              You can add multiple pixels separated by commas
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold py-2 px-4 rounded transition"
            >
              {isLoading ? "Saving..." : "Connect Meta Account"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2 px-4 rounded transition"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleGoogleSubmit} className="space-y-4">
          <div>
            <label className="block text-white text-sm font-semibold mb-2">
              Access Token / API Key
            </label>
            <textarea
              value={googleForm.accessToken}
              onChange={(e) =>
                setGoogleForm({ ...googleForm, accessToken: e.target.value })
              }
              placeholder="Paste your Google service account JSON or OAuth token"
              className="w-full bg-slate-700 text-white border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-white text-sm font-semibold mb-2">
              Google Ads Customer ID
            </label>
            <input
              type="text"
              value={googleForm.customerId}
              onChange={(e) =>
                setGoogleForm({ ...googleForm, customerId: e.target.value })
              }
              placeholder="e.g., 123-456-7890"
              className="w-full bg-slate-700 text-white border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-white text-sm font-semibold mb-2">
              GA4 Property ID
            </label>
            <input
              type="text"
              value={googleForm.propertyId}
              onChange={(e) =>
                setGoogleForm({ ...googleForm, propertyId: e.target.value })
              }
              placeholder="e.g., 123456789"
              className="w-full bg-slate-700 text-white border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-white text-sm font-semibold mb-2">
              GTM Container ID
            </label>
            <input
              type="text"
              value={googleForm.containerId}
              onChange={(e) =>
                setGoogleForm({ ...googleForm, containerId: e.target.value })
              }
              placeholder="e.g., GTM-XXXXXX"
              className="w-full bg-slate-700 text-white border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold py-2 px-4 rounded transition"
            >
              {isLoading ? "Saving..." : "Connect Google Account"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2 px-4 rounded transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
