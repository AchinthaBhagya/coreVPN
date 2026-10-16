import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronUp, FileDown, Loader2 } from "lucide-react";

import { api, downloadBlob } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiList } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { useAuth } from "@/context/AuthContext";
import { toastError, toastSuccess } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { ErrorState } from "@/components/common/states";
import { Forbidden } from "@/components/layout/guards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AuditLogEntry } from "@/types";

/**
 * Audit trail browser.
 *
 * Contract (backend/src/routes/settings.routes.ts):
 * - `GET /settings/audit` accepts `page`, `limit`, `search`, `module`, `dateFrom`
 *   and `dateTo`. `search` matches the action or module name server-side.
 * - `GET /settings/audit/export` accepts `module`, `dateFrom` and `dateTo` only
 *   (no free-text search) and streams a CSV of up to 5,000 rows.
 * Both endpoints require the `audit.view` permission.
 */

const INITIAL_FILTERS = { module: "ALL", dateFrom: "", dateTo: "" };

/** Modules written by `writeAudit` across the backend. */
const MODULE_OPTIONS = [
  "auth",
  "users",
  "roles",
  "clients",
  "leads",
  "services",
  "quotations",
  "orders",
  "projects",
  "tasks",
  "time",
  "invoices",
  "payments",
  "refunds",
  "expenses",
  "allocations",
  "payouts",
  "tickets",
  "settings",
  "notifications",
  "integrations",
];

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-44" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Collapsible JSON payload for an audit event. */
function DetailsCell({ details }: { details: unknown }) {
  const [open, setOpen] = useState(false);

  if (details === null || details === undefined) {
    return <span className="text-muted-foreground">-</span>;
  }

  let text: string;
  if (typeof details === "string") {
    if (details.trim() === "") return <span className="text-muted-foreground">-</span>;
    text = details;
  } else {
    try {
      text = JSON.stringify(details, null, 2);
    } catch {
      text = String(details);
    }
  }

  if (text === "{}" || text === "[]" || text.trim() === "") {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="max-w-xs">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {open ? "Hide" : "Details"}
      </Button>
      {open ? (
        <pre className="mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-muted/40 p-2 text-xs leading-relaxed text-muted-foreground">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

function actorLabel(entry: AuditLogEntry): ReactNode {
  if (!entry.user) return <span className="text-muted-foreground">System</span>;
  const name = `${entry.user.firstName} ${entry.user.lastName}`.trim() || entry.user.email;
  return (
    <div className="min-w-0">
      <p className="truncate font-medium text-foreground">{name}</p>
      <p className="truncate text-xs text-muted-foreground">{entry.user.email}</p>
    </div>
  );
}

export default function AuditLog() {
  const { can } = useAuth();
  const allowed = can("audit.view");
  const params = useListParams(INITIAL_FILTERS);
  const list = useApiList<AuditLogEntry>(qk.list("audit", params.query), "/settings/audit", params.query, {
    enabled: allowed,
  });

  const hasFilters =
    params.search.trim() !== "" ||
    params.filters.module !== "ALL" ||
    params.filters.dateFrom !== "" ||
    params.filters.dateTo !== "";

  const exportMutation = useMutation({
    mutationFn: () => {
      const query: Record<string, string> = {};
      if (params.filters.module !== "ALL") query.module = params.filters.module;
      if (params.filters.dateFrom) query.dateFrom = params.filters.dateFrom;
      if (params.filters.dateTo) query.dateTo = params.filters.dateTo;
      return api.blob("/settings/audit/export", query);
    },
    onSuccess: (blob) => {
      downloadBlob(blob, `audit-${new Date().toISOString().slice(0, 10)}.csv`);
      toastSuccess("Export ready", "Your audit log CSV download has started.");
    },
    onError: (error) => {
      toastError(error, "The audit log could not be exported.");
    },
  });

  if (!allowed) return <Forbidden />;

  const columns: ColumnDef<AuditLogEntry, unknown>[] = [
    {
      accessorKey: "createdAt",
      header: "Time",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>
      ),
    },
    {
      id: "actor",
      header: "Actor",
      enableSorting: false,
      accessorFn: (row) => (row.user ? `${row.user.firstName} ${row.user.lastName}` : "System"),
      cell: ({ row }) => actorLabel(row.original),
    },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }) => <span className="font-mono text-xs text-foreground">{row.original.action}</span>,
    },
    {
      accessorKey: "module",
      header: "Module",
      cell: ({ row }) => <Badge variant="muted">{row.original.module}</Badge>,
    },
    {
      accessorKey: "entityId",
      header: "Entity",
      cell: ({ row }) =>
        row.original.entityId ? (
          <span className="font-mono text-xs text-muted-foreground">{row.original.entityId}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      accessorKey: "ipAddress",
      header: "IP address",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.ipAddress || "-"}</span>
      ),
    },
    {
      id: "details",
      header: "Details",
      enableSorting: false,
      cell: ({ row }) => <DetailsCell details={row.original.details} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Immutable record of who did what, when - filtered by module and date."
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            Export CSV
          </Button>
        }
      />

      <FilterBar>
        <SearchInput
          value={params.search}
          onChange={params.setSearch}
          placeholder="Search action or module..."
        />
        <FilterSelect
          label="Module"
          value={params.filters.module}
          onChange={(value) => params.setFilter("module", value)}
          options={[
            { value: "ALL", label: "All modules" },
            ...MODULE_OPTIONS.map((module) => ({ value: module, label: module })),
          ]}
        />
        <div className="flex items-center gap-2">
          <Label htmlFor="audit-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="audit-from"
            type="date"
            value={params.filters.dateFrom}
            onChange={(event) => params.setFilter("dateFrom", event.target.value)}
            className="h-9 w-40"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="audit-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="audit-to"
            type="date"
            value={params.filters.dateTo}
            onChange={(event) => params.setFilter("dateTo", event.target.value)}
            className="h-9 w-40"
          />
        </div>
        {hasFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={params.resetFilters}>
            Reset filters
          </Button>
        ) : null}
      </FilterBar>

      {list.isError ? (
        <ErrorState
          description={list.error instanceof Error ? list.error.message : "The audit log could not be loaded."}
          onRetry={() => list.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          data={list.data?.items ?? []}
          isLoading={list.isLoading}
          emptyTitle="No audit events found"
          emptyDescription={
            hasFilters
              ? "No events match your search or filters. Try widening the date range."
              : "Activity across the workspace will appear here as it happens."
          }
          footer={<Pagination pagination={list.data?.pagination} onPageChange={params.setPage} />}
        />
      )}
    </div>
  );
}
