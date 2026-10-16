import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PaginationMeta } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

export function Pagination({
  pagination,
  onPageChange,
}: {
  pagination?: PaginationMeta | null;
  onPageChange: (page: number) => void;
}) {
  if (!pagination || pagination.total <= pagination.limit) return null;
  const { page, totalPages, total, hasNext, hasPrev } = pagination;

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm sm:flex-row">
      <p className="text-muted-foreground">
        Page <span className="text-foreground">{page}</span> of{" "}
        <span className="text-foreground">{Math.max(totalPages, 1)}</span> · {formatNumber(total)} records
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={!hasPrev} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => onPageChange(page + 1)}>
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
