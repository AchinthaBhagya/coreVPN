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
    primary: "from-sky-500/20 to-transparent text-sky-300",
    success: "from-emerald-500/20 to-transparent text-emerald-300",
    warning: "from-amber-500/20 to-transparent text-amber-300",
    danger: "from-rose-500/20 to-transparent text-rose-300",
    accent: "from-violet-500/20 to-transparent text-violet-300",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn("h-full", className)}
    >
      <Card className="group relative h-full overflow-hidden">
        <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70", toneRing[tone])} />
        <CardContent className="relative flex items-start justify-between gap-3 p-5">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="truncate text-2xl font-semibold tracking-tight text-foreground">{value}</p>
            {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
            {typeof change === "number" ? (
              <div
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-medium",
                  change >= 0 ? "text-emerald-400" : "text-rose-400",
                )}
              >
                {change >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {Math.abs(change).toFixed(1)}%
              </div>
            ) : null}
          </div>
          {icon ? (
            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5", toneRing[tone])}>
              {icon}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </motion.div>
  );
}
