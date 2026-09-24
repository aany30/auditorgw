
import { useEffect, useState } from "react";

interface ServiceStatus {
  ecomScraper: string;
  gemini: string;
  metaGraph: string;
  apify: string;
  reddit: string;
  supabase: string;
}

interface HealthResponse {
  status: string;
  services: ServiceStatus;
}

function Dot({ value }: { value: string }) {
  const ok = value === "online" || value === "configured" || value === "enabled";
  const warn = value === "degraded";
  const color = ok ? "bg-accent-2" : warn ? "bg-accent" : "bg-fg-mute/40";
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />;
}

export function StatusCards() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetch("/api/media-analyser/health")
      .then(r => r.json())
      .then(setHealth)
      .catch(() => {});
  }, []);

  if (!health) return null;

  const services = [
    { label: "Scraper", value: health.services.ecomScraper },
    { label: "Gemini", value: health.services.gemini },
    { label: "Apify", value: health.services.apify },
    { label: "Reddit", value: health.services.reddit },
    { label: "Meta Graph", value: health.services.metaGraph },
    { label: "Supabase", value: health.services.supabase },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {services.map(s => (
        <div
          key={s.label}
          className="flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-1"
        >
          <Dot value={s.value} />
          <span className="font-mono text-[10px] tracking-wide uppercase text-fg-mute">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
