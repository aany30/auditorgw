import { useState } from "react";

export default function GoogleGuide() {
  const [expandedStep, setExpandedStep] = useState<number | null>(0);

  const steps = [
    {
      number: 1,
      title: "Access Google Cloud Console",
      description: "Set up a project to manage your API credentials.",
      details: [
        "Go to https://console.cloud.google.com",
        "Sign in with your Google account",
        "Create a new project or select an existing one",
      ],
    },
    {
      number: 2,
      title: "Enable Required APIs",
      description: "Enable the APIs needed for Google Ads, GA4, and GTM auditing.",
      details: [
        "Go to APIs & Services → Library",
        "Search for and enable: Google Ads API, Analytics Data API, Tag Manager API",
        "Wait for APIs to be enabled (may take a few minutes)",
      ],
    },
    {
      number: 3,
      title: "Get Google Ads Customer ID",
      description: "Locate your Google Ads account ID for conversion tracking audits.",
      details: [
        "Go to https://ads.google.com and sign in",
        "Click the Tools & Settings icon (⚙) in the top right",
        "Select 'Access and security' → 'Access levels'",
        "Your Customer ID is displayed at the top (format: 123-456-7890)",
      ],
    },
    {
      number: 4,
      title: "Get GA4 Property ID",
      description: "Find your GA4 property ID for event tracking audits.",
      details: [
        "Go to https://analytics.google.com",
        "Select your property from the list",
        "Go to Admin (bottom left) → Property Settings",
        "Your Property ID is displayed (format: 123456789)",
      ],
    },
    {
      number: 5,
      title: "Get GTM Container ID",
      description: "Retrieve your Google Tag Manager container ID.",
      details: [
        "Go to https://tagmanager.google.com",
        "Select your account and container",
        "The Container ID is shown at the top right (format: GTM-XXXXXX)",
        "You can also find it in your GTM installation code",
      ],
    },
    {
      number: 6,
      title: "Create Service Account (OAuth)",
      description: "Generate API credentials for secure API access.",
      details: [
        "In Google Cloud Console → APIs & Services → Credentials",
        "Click 'Create Credentials' → 'Service Account'",
        "Fill in the service account name and description",
        "Click 'Create and Continue'",
        "Grant roles: Editor (or custom: Ads API Editor, Analytics Editor, Tag Manager Editor)",
        "Click 'Continue' and then 'Done'",
        "Click on your service account → Keys → Add Key → Create new key → JSON",
        "Download and securely store the JSON file",
      ],
    },
    {
      number: 7,
      title: "(Alternative) Use OAuth 2.0",
      description: "Use OAuth flow for direct authentication without storing credentials.",
      details: [
        "Click 'Create Credentials' → 'OAuth client ID'",
        "Select 'Web application'",
        "Add authorized redirect URI: Your app's callback URL",
        "Copy the Client ID and Client Secret",
        "Your users can then authenticate directly via Google",
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
          💡 <strong>Pro Tip:</strong> For security, use a service account with minimal required
          permissions. We recommend OAuth for user-facing integrations.
        </p>
      </div>
    </div>
  );
}
