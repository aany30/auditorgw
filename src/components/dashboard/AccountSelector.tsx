import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useAuthStore } from "@/store/auth";

export default function AccountSelector() {
  const {
    metaPixelList,
    selectedMetaPixelId,
    setSelectedMetaPixelId,
    googleAccountsList,
    selectedGoogleCustomerId,
    setSelectedGoogleCustomerId,
    selectedGAPropertyId,
    setSelectedGAPropertyId,
    selectedGTMContainerId,
    setSelectedGTMContainerId,
  } = useAuthStore();

  const [metaOpen, setMetaOpen] = useState(false);
  const [googleOpen, setGoogleOpen] = useState(false);

  const selectedMetaPixel = metaPixelList.find((p) => p.id === selectedMetaPixelId);
  const selectedAccount = googleAccountsList.find((a) => a.customerId === selectedGoogleCustomerId);

  return (
    <div className="flex gap-4 items-center">
      {/* Meta Pixel Selector */}
      {metaPixelList.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setMetaOpen(!metaOpen)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            <span className="truncate max-w-xs">
              {selectedMetaPixel?.name || "Select Pixel"}
            </span>
            <ChevronDown className="w-4 h-4 flex-shrink-0" />
          </button>

          {metaOpen && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 min-w-xs">
              {metaPixelList.map((pixel) => (
                <button
                  key={pixel.id}
                  onClick={() => {
                    setSelectedMetaPixelId(pixel.id);
                    setMetaOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition ${
                    selectedMetaPixelId === pixel.id
                      ? "bg-blue-50 text-blue-600 font-semibold"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <div className="font-medium">{pixel.name}</div>
                  <div className="text-xs text-gray-500">{pixel.id}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Google Account Selector */}
      {googleAccountsList.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setGoogleOpen(!googleOpen)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            <span className="truncate max-w-xs">
              {selectedAccount?.name || "Select Account"}
            </span>
            <ChevronDown className="w-4 h-4 flex-shrink-0" />
          </button>

          {googleOpen && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 min-w-xs">
              {googleAccountsList.map((account) => (
                <div key={account.customerId}>
                  <button
                    onClick={() => {
                      setSelectedGoogleCustomerId(account.customerId);
                      setGoogleOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm transition ${
                      selectedGoogleCustomerId === account.customerId
                        ? "bg-red-50 text-red-600 font-semibold"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <div className="font-medium">{account.name}</div>
                    <div className="text-xs text-gray-500">{account.customerId}</div>
                  </button>

                  {selectedGoogleCustomerId === account.customerId && (
                    <>
                      {/* Properties Sub-menu */}
                      {account.properties && account.properties.length > 0 && (
                        <div className="border-t border-gray-200 px-3 py-2 bg-gray-50">
                          <p className="text-xs font-semibold text-gray-600 mb-2">GA4 Properties</p>
                          {account.properties.map((prop) => (
                            <button
                              key={prop.id}
                              onClick={() => setSelectedGAPropertyId(prop.id)}
                              className={`w-full text-left text-xs px-2 py-1 rounded transition ${
                                selectedGAPropertyId === prop.id
                                  ? "bg-blue-100 text-blue-600"
                                  : "text-gray-600 hover:bg-white"
                              }`}
                            >
                              {prop.name}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Containers Sub-menu */}
                      {account.containers && account.containers.length > 0 && (
                        <div className="border-t border-gray-200 px-3 py-2 bg-gray-50">
                          <p className="text-xs font-semibold text-gray-600 mb-2">GTM Containers</p>
                          {account.containers.map((container) => (
                            <button
                              key={container.id}
                              onClick={() => setSelectedGTMContainerId(container.id)}
                              className={`w-full text-left text-xs px-2 py-1 rounded transition ${
                                selectedGTMContainerId === container.id
                                  ? "bg-blue-100 text-blue-600"
                                  : "text-gray-600 hover:bg-white"
                              }`}
                            >
                              {container.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
