import { Radio, CircleDashed, AlertTriangle } from "lucide-react";

interface Props {
  source: "live" | "demo" | "mixed" | null | undefined;
  label?: string;
  size?: "sm" | "md";
}

export default function SourceBadge({ source, label, size = "sm" }: Props) {
  if (!source) return null;

  const cls =
    source === "live" ? "bg-green-100 text-green-700 border-green-200" :
    source === "demo" ? "bg-purple-100 text-purple-700 border-purple-200" :
    "bg-yellow-100 text-yellow-700 border-yellow-200";

  const Icon = source === "live" ? Radio : source === "demo" ? CircleDashed : AlertTriangle;
  const text = source === "live" ? "Live" : source === "demo" ? "Demo" : "Partial";
  const padding = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-semibold ${cls} ${padding}`}>
      <Icon className="w-3 h-3" />
      {label ? `${label}: ${text}` : text}
    </span>
  );
}
