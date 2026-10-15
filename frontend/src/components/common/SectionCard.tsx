import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/states";
import { cn } from "@/lib/utils";

/**
 * Titled card used across detail screens. Renders an empty state when there is
 * nothing to show so screens never appear broken.
 */
export function SectionCard({
  title,
  description,
  actions,
  children,
  empty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  contentClassName,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  contentClassName?: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      {title || actions ? (
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div className="min-w-0 space-y-1">
            {title ? <CardTitle className="text-base">{title}</CardTitle> : null}
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn(contentClassName)}>
        {empty ? (
          <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} className="py-10" />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/** Simple label/value grid for detail overview panels. */
export function InfoList({
  items,
  columns = 2,
  className,
}: {
  items: Array<{ label: string; value: ReactNode; full?: boolean }>;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const cols = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[columns];
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-4", cols, className)}>
      {items.map((item) => (
        <div key={item.label} className={cn("min-w-0 space-y-1", item.full && "sm:col-span-full")}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</dt>
          <dd className="break-words text-sm text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
