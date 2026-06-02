import { useState, useMemo } from "react";

export type SortDir = "asc" | "desc";

export interface SortState {
  col: string;
  dir: SortDir;
}

/** Returns sorted array + sort controls. `key` must be a field of T. */
export function useSort<T>(rows: T[], defaultCol: string, defaultDir: SortDir = "desc") {
  const [sort, setSort] = useState<SortState>({ col: defaultCol, dir: defaultDir });

  const toggle = (col: string) => {
    setSort((s) => s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" });
  };

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sort.col];
      const bv = (b as Record<string, unknown>)[sort.col];
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort.col, sort.dir]);

  return { sorted, sort, toggle };
}
