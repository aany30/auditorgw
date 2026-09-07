import { useState, useRef, useCallback, useEffect } from "react";

function indianFormat(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

interface Props {
  value: number;
  onChange: (raw: number) => void;
  /** Unused now; kept for API compatibility with existing call sites. */
  deliveredHint?: number;
  kind?: "money" | "int" | "decimal" | "pct";
  currencySymbol?: string;
  placeholder?: string;
  className?: string;
  wrapperClassName?: string;
  min?: number;
  step?: number;
}

/**
 * Numeric input with no K/M/B auto-scaling — what you type IS what gets
 * stored. Blurred display re-formats large ints with Indian grouping
 * (12,34,567) for readability; % appears for pct kind; currency prefix for
 * money kind.
 */
export default function SmartNumberInput({
  value,
  onChange,
  kind = "int",
  currencySymbol,
  placeholder = "0",
  className = "",
  wrapperClassName,
  min = 0,
}: Props) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [editStr, setEditStr] = useState("");

  useEffect(() => {
    if (!focused) setEditStr(value ? String(value) : "");
  }, [value, focused]);

  const handleFocus = useCallback(() => {
    setFocused(true);
    setEditStr(value ? String(value) : "");
  }, [value]);

  const handleBlur = useCallback(() => {
    setFocused(false);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const str = e.target.value.replace(/[^0-9.\-]/g, "");
      setEditStr(str);
      const num = parseFloat(str) || 0;
      onChange(Math.max(min, num));
    },
    [onChange, min]
  );

  const blurDisplay = (() => {
    if (!value) return "";
    if (kind === "pct" || kind === "decimal") return String(value);
    return indianFormat(value);
  })();

  const showPrefix = kind === "money" && currencySymbol;
  const showSuffix = kind === "pct" ? "%" : "";

  return (
    <div className={wrapperClassName ?? "inline-flex items-center justify-end gap-1"}>
      {showPrefix && (
        <span className="w-3 shrink-0 text-right text-[11px] text-gray-400">{currencySymbol}</span>
      )}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={focused ? editStr : blurDisplay}
        placeholder={placeholder}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        className={className}
      />
      {showSuffix && (
        <span className="w-5 shrink-0 text-left text-[11px] text-gray-400">{showSuffix}</span>
      )}
    </div>
  );
}
