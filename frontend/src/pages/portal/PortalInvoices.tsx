import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, ReceiptText, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiList } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorState } from "@/components/common/states";
import { formatDate, formatMoney, isOverdue, toNumber } from "@/lib/format";
import type { Invoice } from "@/types";

/** Draft and void invoices are internal-only; mirror the client-visible set. */
const CLIENT_INVOICE_STATUSES = ["ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "REFUNDED"];

export default function PortalInvoices() {
  const navigate = useNavigate();
  const list = useListParams();

  const statusFilter = list.filters.status || undefined;

  const invoicesQuery = useApiList<Invoice>(
    [...qk.portal.invoices, "list", { page: list.page, limit: list.limit, status: statusFilter ?? "" }],
    "/portal/invoices",
    { page: list.page, limit: list.limit, status: statusFilter },
  );

  // Account-wide (unpaginated) snapshot so the summary cards do not change per page.
  const summaryQuery = useQuery({
    queryKey: [...qk.portal.invoices, "summary"],
    queryFn: async () => (await api.getWithMeta<Invoice[]>("/portal/invoices", { limit: 200 })).data ?? [],
  });

  // The portal invoice route has no server-side search; filter the loaded page locally.
  const term = list.debouncedSearch.trim().toLowerCase();
  const rows = useMemo(() => {
    const items = invoicesQuery.data?.items ?? [];
    if (!term) return items;
    return items.filter(
      (invoice) =>
        invoice.invoiceNo.toLowerCase().includes(term) ||
        (invoice.project?.name ?? "").toLowerCase().includes(term) ||
        (invoice.project?.projectNo ?? "").toLowerCase().includes(term),
    );
  }, [invoicesQuery.data, term]);

  const summary = useMemo(() => {
    const invoices = summaryQuery.data ?? [];
    let outstanding = 0;
    let overdue = 0;
    let invoiced = 0;
    for (const invoice of invoices) {
      invoiced += toNumber(invoice.total);
      if (invoice.status !== "PAID" && invoice.status !== "REFUNDED") outstanding += toNumber(invoice.balance);
      if (invoice.status === "OVERDUE") overdue += toNumber(invoice.balance);
    }
    const currency = invoices[0]?.currency ?? "LKR";
    return { outstanding, overdue, invoiced, currency, count: invoices.length };
  }, [summaryQuery.data]);

  const columns: ColumnDef<Invoice, unknown>[] = [
    {
      accessorKey: "invoiceNo",
      header: "Invoice",
      cell: ({ row }) => <span className="font-medium">{row.original.invoiceNo}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      enableSorting: false,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "issueDate",
      header: "Issued",
      cell: ({ row }) => formatDate(row.original.issueDate),
    },
    {
      id: "dueDate",
      accessorFn: (invoice) => invoice.dueDate ?? "",
      header: "Due",
      cell: ({ row }) => {
        const invoice = row.original;
        const late = invoice.status !== "PAID" && isOverdue(invoice.dueDate);
        return (
          <span className={late ? "text-danger" : undefined}>
            {formatDate(invoice.dueDate)}
            {late ? " · overdue" : ""}
          </span>
        );
      },
    },
    {
      id: "project",
      accessorFn: (invoice) => invoice.project?.name ?? "",
      header: "Project",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.project ? (
          <span className="text-muted-foreground">{row.original.project.name}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      id: "total",
      accessorFn: (invoice) => toNumber(invoice.total),
      header: "Total",
      cell: ({ row }) => <span className="block text-right">{formatMoney(row.original.total, row.original.currency)}</span>,
    },
    {
      id: "amountPaid",
      accessorFn: (invoice) => toNumber(invoice.amountPaid),
      header: "Paid",
      cell: ({ row }) => (
        <span className="block text-right text-success">{formatMoney(row.original.amountPaid, row.original.currency)}</span>
      ),
    },
    {
      id: "balance",
      accessorFn: (invoice) => toNumber(invoice.balance),
      header: "Balance",
      cell: ({ row }) => {
        const invoice = row.original;
        const open = toNumber(invoice.balance) > 0;
        return (
          <span className={`block text-right font-medium ${open ? "text-warning" : "text-muted-foreground"}`}>
            {formatMoney(invoice.balance, invoice.currency)}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Every invoice issued to your account by 3xCodz. Select a row to view line items, payments and download a PDF."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Outstanding balance"
          value={formatMoney(summary.outstanding, summary.currency)}
          hint={`Across ${summary.count} invoice${summary.count === 1 ? "" : "s"}`}
          icon={<Wallet className="h-5 w-5" />}
          tone="warning"
        />
        <StatCard
          label="Overdue amount"
          value={formatMoney(summary.overdue, summary.currency)}
          hint="Past the due date"
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="danger"
        />
        <StatCard
          label="Total invoiced"
          value={formatMoney(summary.invoiced, summary.currency)}
          hint="Lifetime, all statuses"
          icon={<ReceiptText className="h-5 w-5" />}
          tone="primary"
        />
      </div>

      <FilterBar>
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search number or project..." />
        <Select value={list.filters.status || "ALL"} onValueChange={(value) => list.setFilter("status", value)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {CLIENT_INVOICE_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {status.replace(/_/g, " ").toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {invoicesQuery.isError ? (
        <ErrorState description="Your invoices could not be loaded." onRetry={() => void invoicesQuery.refetch()} />
      ) : (
        <div className="space-y-4">
          <DataTable
            columns={columns}
            data={rows}
            isLoading={invoicesQuery.isLoading}
            onRowClick={(invoice) => navigate(`/portal/invoices/${invoice.id}`)}
            emptyTitle={term || statusFilter ? "No matching invoices" : "No invoices yet"}
            emptyDescription={
              term || statusFilter
                ? "Try a different invoice number, project or status."
                : "Invoices issued to your account will appear here."
            }
          />
          <Pagination pagination={invoicesQuery.data?.pagination} onPageChange={list.setPage} />
        </div>
      )}
    </div>
  );
}
