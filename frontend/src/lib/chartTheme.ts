import { useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";

/**
 * Recharts renders raw SVG, so CSS custom properties passed as SVG presentation
 * attributes are not reliable across browsers. Instead we resolve the design
 * tokens to concrete `hsl(...)` strings in JS and recompute them whenever the
 * resolved theme changes.
 */
function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `hsl(${raw})` : fallback;
}

export interface ChartTheme {
  /** Semantic series colors for the revenue / cash / expenses chart. */
  series: {
    revenue: string;
    cash: string;
    expenses: string;
  };
  /** Categorical palette for pies and bars. */
  categorical: string[];
  axis: string;
  grid: string;
  tooltip: {
    background: string;
    border: string;
    borderRadius: number;
    fontSize: number;
    color: string;
  };
}

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();

  return useMemo<ChartTheme>(() => {
    const primary = readVar("--primary", "hsl(43 76% 53%)");
    const info = readVar("--info", "hsl(200 82% 62%)");
    const success = readVar("--success", "hsl(152 45% 54%)");
    const warning = readVar("--warning", "hsl(28 90% 60%)");
    const destructive = readVar("--destructive", "hsl(0 62% 52%)");
    const foreground = readVar("--foreground", "hsl(40 33% 96%)");
    const mutedForeground = readVar("--muted-foreground", "hsl(40 14% 64%)");
    const border = readVar("--border", "hsl(40 12% 17%)");
    const popover = readVar("--popover", "hsl(36 10% 10%)");

    return {
      series: { revenue: primary, cash: success, expenses: destructive },
      categorical: [
        readVar("--chart-1", primary),
        readVar("--chart-2", info),
        readVar("--chart-3", success),
        readVar("--chart-4", warning),
        readVar("--chart-5", destructive),
      ],
      axis: mutedForeground,
      grid: border,
      tooltip: {
        background: popover,
        border: `1px solid ${border}`,
        borderRadius: 12,
        fontSize: 12,
        color: foreground,
      },
    };
  }, [resolvedTheme]);
}
