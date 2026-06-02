import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import type { SortState } from "@/hooks/useSort";

interface Props {
  col: string;
  sort: SortState;
  onToggle: (col: string) => void;
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}

export default function SortTh({ col, sort, onToggle, children, className = "", align = "left" }: Props) {
  const active = sort.col === col;
  const alignClass = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <th
      className={`px-4 py-2 font-semibold text-gray-700 cursor-pointer select-none hover:bg-gray-100 transition-colors ${className}`}
      onClick={() => onToggle(col)}
    >
      <span className={`inline-flex items-center gap-1 ${alignClass}`}>
        {children}
        {active
          ? sort.dir === "asc"
            ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" />
            : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
          : <ChevronsUpDown className="w-3.5 h-3.5 text-gray-300" />}
      </span>
    </th>
  );
}
