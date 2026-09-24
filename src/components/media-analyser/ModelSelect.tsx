
import { ChevronDown } from "lucide-react";

export interface ModelSelectOption {
  id: string;
  label: string;
}

interface ModelSelectProps {
  label: string;
  options: ModelSelectOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

/**
 * Controlled dropdown for picking a generation model. A styled native <select>
 * (keyboard + screen-reader support for free, no popover/focus-trap bugs) with a
 * custom chevron. It auto-sizes to its content with a sensible min width, so it
 * stays a drop-in for the surfaces' existing inline / wrapped / grid layouts.
 * The component knows nothing about models — surfaces pass IMAGE_MODELS /
 * VIDEO_MODELS mapped to {id,label}.
 */
export default function ModelSelect({ label, options, value, onChange, disabled }: ModelSelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-fg-dim">{label}</span>
      <div className="relative w-fit">
        <select
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          className="min-w-[9rem] appearance-none rounded-lg border border-line bg-surface py-1.5 pl-3 pr-9 text-xs font-medium text-fg cursor-pointer transition-colors hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {options.map(opt => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-mute"
        />
      </div>
    </div>
  );
}
