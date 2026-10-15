import { Badge } from "@/components/ui/badge";
import { statusLabel, toneForStatus, type Tone } from "@/lib/status";

const VARIANT_BY_TONE: Record<Tone, "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "muted"> = {
  default: "secondary",
  primary: "default",
  success: "success",
  warning: "warning",
  danger: "destructive",
  info: "info",
  muted: "muted",
};

export function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  if (!status) return <span className="text-muted-foreground">-</span>;
  return <Badge variant={VARIANT_BY_TONE[toneForStatus(status)]}>{label ?? statusLabel(status)}</Badge>;
}

export function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <Badge variant={VARIANT_BY_TONE[tone]}>{children}</Badge>;
}
