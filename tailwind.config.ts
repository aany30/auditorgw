import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx}",
    "./src/hooks/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#1F2937",
        healthy: "#10B981",
        warning: "#F59E0B",
        critical: "#EF4444",
      },
      keyframes: {
        fadeInUp:    { "0%": { opacity: "0", transform: "translateY(18px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        fadeIn:      { "0%": { opacity: "0" },                                "100%": { opacity: "1" } },
        scaleIn:     { "0%": { opacity: "0", transform: "scale(0.93)" },      "100%": { opacity: "1", transform: "scale(1)" } },
        slideInLeft: { "0%": { opacity: "0", transform: "translateX(-16px)" },"100%": { opacity: "1", transform: "translateX(0)" } },
        shimmer:     { "0%": { backgroundPosition: "-400px 0" }, "100%": { backgroundPosition: "400px 0" } },
        float:       { "0%,100%": { transform: "translateY(0px)" }, "50%": { transform: "translateY(-5px)" } },
        pulseGlow:   { "0%,100%": { boxShadow: "0 0 0 0 rgba(59,130,246,0)" }, "50%": { boxShadow: "0 0 0 8px rgba(59,130,246,0.12)" } },
        barFill:     { "0%": { transform: "scaleX(0)", transformOrigin: "left" }, "100%": { transform: "scaleX(1)", transformOrigin: "left" } },
        countPulse:  { "0%": { transform: "scale(1)" }, "40%": { transform: "scale(1.08)" }, "100%": { transform: "scale(1)" } },
        spinSlow:    { "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(360deg)" } },
      },
      animation: {
        "fade-in-up":    "fadeInUp 0.45s cubic-bezier(0.16,1,0.3,1) forwards",
        "fade-in":       "fadeIn 0.3s ease-out forwards",
        "scale-in":      "scaleIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards",
        "slide-in-left": "slideInLeft 0.3s ease-out forwards",
        shimmer:         "shimmer 1.6s linear infinite",
        float:           "float 3.5s ease-in-out infinite",
        "pulse-glow":    "pulseGlow 2s ease-in-out infinite",
        "bar-fill":      "barFill 0.7s cubic-bezier(0.16,1,0.3,1) forwards",
        "count-pulse":   "countPulse 0.5s ease-out forwards",
        "spin-slow":     "spinSlow 3s linear infinite",
      },
    },
  },
  plugins: [],
}
export default config
