import { useState } from "react";

export default function MetaGuide() {
  const [expandedStep, setExpandedStep] = useState<number | null>(0);

  const steps = [
    {
      number: 1,
      title: "Go to Meta Business Suite",
      description:
        "Navigate to https://business.facebook.com and sign in with your Meta business account.",
      details: [
        "Click on your Business Account name in the top left",
        "Ensure you have Admin or Editor access",
      ],
    },
    {
      number: 2,
      title: "Access Settings",
      description: "Open the Settings menu to manage your apps and integrations.",
      details: [
        "Click Settings (gear icon) at the bottom of the left sidebar",
        "Select 'Apps and Websites'",
      ],
    },
    {
      number: 3,
      title: "Find Your Business App",
      description: "Locate or create your business application for tracking purposes.",
      details: [
        "Click 'Add Apps' if you don't have one yet",
        "Select 'My Apps' to view existing applications",
        "Choose the app connected to your pixel and CAPI",
      ],
    },
    {
      number: 4,
      title: "Get Event Manager Token",
      description: "Generate an access token with the correct permissions.",
      details: [
        "Go to Events Manager within your app",
        "Click Settings → Pixels or Conversions",
        "Generate a User or System token (User token recommended)",
        "Required permissions: ads_management, read_insights, analyze_performance",
      ],
    },
    {
      number: 5,
      title: "Get Your Business ID & Pixel IDs",
      description: "Collect your Business ID and all Pixel IDs you want to audit.",
      details: [
        "Business ID: Found in Settings → Business Settings → Account ID",
        "Pixel IDs: Go to Events Manager → Select each pixel → Copy the ID",
        "You can audit multiple pixels at once",
      ],
    },
    {
      number: 6,
      title: "(Optional) Get CAPI Token",
      description: "If using Conversion API, generate a separate token for CAPI auditing.",
      details: [
        "In Events Manager → Conversions → Settings",
        "Generate a System User token with conversions_api_management permission",
        "This allows detailed CAPI validation and deduplication checks",
      ],
    },
  ];

  return (
    <div className="space-y-3">
      {steps.map((step) => (
        <div key={step.number} className="border border-slate-600 rounded-lg overflow-hidden">
          <button
            onClick={() =>
              setExpandedStep(expandedStep === step.number ? null : step.number)
            }
            className="w-full bg-slate-700/50 hover:bg-slate-700 p-4 flex items-start justify-between transition"
          >
            <div className="flex items-start gap-4 flex-1 text-left">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center font-bold text-white">
                {step.number}
              </div>
              <div>
                <h4 className="font-semibold text-white">{step.title}</h4>
                <p className="text-sm text-slate-300 mt-1">{step.description}</p>
              </div>
            </div>
            <span className="text-slate-300">
              {expandedStep === step.number ? "▼" : "▶"}
            </span>
          </button>

          {expandedStep === step.number && (
            <div className="bg-slate-800 px-4 py-3 border-t border-slate-600">
              <ul className="space-y-2">
                {step.details.map((detail, idx) => (
                  <li key={idx} className="text-sm text-slate-300 flex gap-2">
                    <span className="text-blue-400">•</span>
                    <span>{detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}

      <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4 mt-4">
        <p className="text-sm text-blue-200">
          💡 <strong>Pro Tip:</strong> Keep your access tokens secure. Never share them publicly.
          We recommend using a dedicated System User token for this tool.
        </p>
      </div>
    </div>
  );
}
