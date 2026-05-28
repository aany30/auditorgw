import { Bot, AlertTriangle, Lightbulb } from "lucide-react";
import SectionOverview from "./SectionOverview";
import { useAudit } from "@/hooks/useAudit";
import type { DateRange } from "@/components/shared/DateRangePicker";

interface Props {
  platform: "meta" | "google" | "both";
  dateRange: DateRange;
  customStart?: string;
  customEnd?: string;
  setActiveTab: (id: string) => void;
}

export default function InsightsOverview({ platform, dateRange, customStart, customEnd, setActiveTab }: Props) {
  const { meta, google } = useAudit(platform, dateRange, customStart, customEnd);

  const recommendations = (meta?.recommendations?.length || 0) + (google?.recommendations?.length || 0);
  const critical =
    (meta?.recommendations?.filter((r) => r.priority === "Critical").length || 0) +
    (google?.recommendations?.filter((r) => r.priority === "Critical").length || 0);

  return (
    <SectionOverview
      title="Insights"
      description="AI-prioritised recommendations and active alerts across your accounts"
      Icon={Lightbulb}
      onTileClick={setActiveTab}
      tiles={[
        {
          id: "recommendations",
          label: "AI Recommendations",
          description: "Priority engine: Critical, High, Medium, Low ranked fixes",
          Icon: Bot,
          metric: { label: "Open recommendations", value: recommendations },
          tone: recommendations === 0 ? "good" : "warn",
        },
        {
          id: "alerts",
          label: "Alert Center",
          description: "Active alerts requiring immediate attention",
          Icon: AlertTriangle,
          metric: { label: "Critical alerts", value: critical },
          tone: critical === 0 ? "good" : "bad",
        },
      ]}
    />
  );
}
