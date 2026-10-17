import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon,
  change,
  tone = "primary",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  change?: number | null;
  tone?: "primary" | "success" | "warning" | "danger" | "accent";
  className?: string;
}) {
  const toneRing: Record<string, string> = {
    primary: "from-aurora-violet/25 via-primary/10 to-transparent text-primary",
    success: "from-success/25 to-transparent text-success",
    warning: "from-warning/25 to-transparent text-warning",
    danger: "from-destructive/25 to-transparent text-destructive",
    accent: "from-aurora-cyan/25 to-transparent text-info",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn("h-full", className)}
    >
      <Card className="group relative h-full overflow-hidden transition-colors hover:border-primary/40">
        <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-80", toneRing[tone])} />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <CardContent className="relative flex items-start justify-between gap-3 p-5">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
            <p className="truncate font-display text-2xl font-semibold tracking-tight text-foreground">{value}</p>
            {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
            {typeof change === "number" ? (
              <div
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-medium",
                  change >= 0 ? "text-success" : "text-danger",
                )}
              >
                {change >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {Math.abs(change).toFixed(1)}%
              </div>
            ) : null}
          </div>
          {icon ? (
            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/40", toneRing[tone])}>
              {icon}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </motion.div>
  );
}
