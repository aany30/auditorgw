import { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  stagger?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  hover?: boolean;
  metric?: boolean;
}

/**
 * Drop-in card wrapper that adds:
 *  - Staggered fade-in-up on mount (stagger=1..9)
 *  - Hover lift + shadow (hover=true, default)
 *  - Stronger metric-card hover effect (metric=true)
 */
export default function AnimatedCard({ children, className = "", stagger, hover = true, metric = false }: Props) {
  const staggerClass = stagger ? `stagger-${stagger}` : "";
  const hoverClass   = metric ? "metric-card" : hover ? "card-hover" : "";

  return (
    <div className={`animate-fade-in-up ${staggerClass} ${hoverClass} ${className}`}>
      {children}
    </div>
  );
}
