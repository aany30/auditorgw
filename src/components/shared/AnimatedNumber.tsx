import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  formatter?: (n: number) => string;
  className?: string;
}

export default function AnimatedNumber({
  value,
  duration = 1100,
  decimals = 0,
  prefix = "",
  suffix = "",
  formatter,
  className,
}: Props) {
  const [display, setDisplay] = useState("0");
  const [pulsing, setPulsing] = useState(false);
  const prevRef = useRef(0);
  const rafRef  = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const startVal  = prevRef.current;
    const startTime = performance.now();

    const fmt = (n: number) => {
      if (formatter) return formatter(n);
      const rounded = decimals > 0 ? n.toFixed(decimals) : Math.round(n).toLocaleString("en-IN");
      return `${prefix}${rounded}${suffix}`;
    };

    const animate = (now: number) => {
      const elapsed  = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased    = 1 - Math.pow(1 - progress, 3);
      const current  = startVal + (value - startVal) * eased;
      setDisplay(fmt(current));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        prevRef.current = value;
        setPulsing(true);
        setTimeout(() => setPulsing(false), 500);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration, decimals, prefix, suffix]);

  return (
    <span className={`inline-block ${pulsing ? "number-pulse" : ""} ${className || ""}`}>
      {display}
    </span>
  );
}
