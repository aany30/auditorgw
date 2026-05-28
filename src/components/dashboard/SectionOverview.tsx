import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TermText } from "@/components/shared/Term";

export interface SectionTile {
  id: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  metric?: { label: string; value: string | number };
  tone?: "good" | "warn" | "bad" | "neutral";
}

const toneStyle: Record<NonNullable<SectionTile["tone"]>, string> = {
  good: "text-green-600 bg-green-50",
  warn: "text-yellow-600 bg-yellow-50",
  bad: "text-red-600 bg-red-50",
  neutral: "text-blue-600 bg-blue-50",
};

interface Props {
  title: string;
  description: string;
  Icon: LucideIcon;
  tiles: SectionTile[];
  onTileClick: (id: string) => void;
}

export default function SectionOverview({ title, description, Icon, tiles, onTileClick }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Icon className="w-8 h-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          <p className="text-gray-600 mt-1">{description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            onClick={() => onTileClick(tile.id)}
            className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm hover:shadow-md hover:border-blue-300 transition text-left group"
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${toneStyle[tile.tone || "neutral"]}`}>
                <tile.Icon className="w-5 h-5" />
              </div>
              <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-blue-600 transition" />
            </div>
            <h3 className="text-base font-bold text-gray-900"><TermText>{tile.label}</TermText></h3>
            <p className="text-sm text-gray-600 mt-1"><TermText>{tile.description}</TermText></p>
            {tile.metric && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="text-xs text-gray-500 uppercase tracking-wide"><TermText>{tile.metric.label}</TermText></div>
                <div className="text-2xl font-bold text-gray-900 mt-0.5">{tile.metric.value}</div>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
