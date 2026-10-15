import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { ApiError } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiList } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OPTIONS, statusLabel } from "@/lib/status";
import { formatDate, formatMoney } from "@/lib/format";
import type { Quotation } from "@/types";

const columns: ColumnDef<Quotation, unknown>[] = [
  {
    accessorKey: "quotationNo",
    enableSorting: false,
    header: "Quotation",
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.original.quotationNo}</p>
        <p className="truncate text-xs text-muted-foreground">{row.original.title}</p>
      </div>
    ),
  },
  {
    accessorKey: "status",
    enableSorting: false,
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "total",
    enableSorting: false,
    header: "Total",
    cell: ({ row }) => (
      <span className="font-medium">{formatMoney(row.original.total, row.original.currency)}</span>
    ),
  },
  {
    accessorKey: "validUntil",
    enableSorting: false,
    header: "Valid until",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{formatDate(row.original.validUntil)}</span>
    ),
  },
  {
    id: "open",
    enableSorting: false,
    header: "",
    cell: ({ row }) => (
      <Button asChild variant="ghost" size="sm" onClick={(event) => event.stopPropagation()}>
        <Link to={`/portal/quotations/${row.original.id}`}>
          Open
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    ),
  },
];

export default function PortalQuotations() {
  const navigate = useNavigate();
  const listParams = useListParams({ status: "ALL" });
  const quotations = useApiList<Quotation>(
    [...qk.portal.quotations, "list", listParams.query],
    "/portal/quotations",
    listParams.query,
  );

  const search = listParams.debouncedSearch.trim().toLowerCase();
  const rows = quotations.data?.items;
  const items = useMemo(() => {
    const all = rows ?? [];
    if (!search) return all;
    return all.filter(
      (quotation) =>
        quotation.quotationNo.toLowerCase().includes(search) ||
        quotation.title.toLowerCase().includes(search),
    );
  }, [rows, search]);

  const errorStatus = quotations.error instanceof ApiError ? quotations.error.status : 0;
  const noAccess = errorStatus === 403 || errorStatus === 404;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotations"
        description="Every quote we've prepared for your work — open one to review the line items and accept or reject it."
      />

      <FilterBar>
        <SearchInput
          value={listParams.search}
          onChange={listParams.setSearch}
          placeholder="Search quotations..."
        />
        <Select
          value={listParams.filters.status ?? "ALL"}
          onValueChange={(value) => listParams.setFilter("status", value)}
        >
          <SelectTrigger className="w-[190px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {OPTIONS.quotationStatus
              .filter((status) => status !== "DRAFT")
              .map((status) => (
                <SelectItem key={status} value={status}>
                  {statusLabel(status)}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <div className="space-y-4">
        {quotations.isError ? (
          <ErrorState
            title={noAccess ? "Your quotations are not available" : "We couldn't load your quotations"}
            description={
              noAccess
                ? "You don't have access to this list, or it is no longer available."
                : quotations.error instanceof Error
                  ? quotations.error.message
                  : "Please try again in a moment."
            }
            onRetry={noAccess ? undefined : () => void quotations.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            data={items}
            isLoading={quotations.isLoading}
            emptyTitle={search ? "No quotations match your search" : "No quotations yet"}
            emptyDescription={
              search
                ? "Try a different quotation number or title."
                : "Quotes prepared for your projects will appear here as soon as they're sent."
            }
            onRowClick={(quotation) => navigate(`/portal/quotations/${quotation.id}`)}
          />
        )}
        <Pagination pagination={quotations.data?.pagination} onPageChange={listParams.setPage} />
      </div>
    </div>
  );
}
