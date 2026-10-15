import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, RotateCcw } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useApiList, useApiQuery } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { clientDisplayName, formatDate, formatMoney } from "@/lib/format";
import { OPTIONS } from "@/lib/status";
import { currencyValue } from "@/lib/validation";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { ErrorState } from "@/components/common/states";
import { SelectField, TextField, TextareaField } from "@/components/common/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Client, Invoice, Payment, Refund } from "@/types";

/** The API returns `kind` on refunds; the shared type predates the field. */
interface RefundRow extends Refund {
  kind?: string;
}

const refundColumns: ColumnDef<RefundRow, unknown>[] = [
  {
    accessorKey: "refundNo",
    header: "Refund #",
    enableSorting: false,
    cell: ({ row }) => <span className="font-mono text-xs font-medium">{row.original.refundNo}</span>,
  },
  {
    id: "kind",
    header: "Type",
    enableSorting: false,
    cell: ({ row }) => <StatusBadge status={row.original.kind ?? "REFUND"} />,
  },
  {
    id: "client",
    accessorFn: (row) => clientDisplayName(row.client),
    header: "Client",
    enableSorting: false,
    cell: ({ row }) => <span className="text-sm">{clientDisplayName(row.original.client)}</span>,
  },
  {
    id: "invoice",
    header: "Invoice",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.invoice ? (
        <Link
          to={`/invoices/${row.original.invoice.id}`}
          className="font-mono text-xs text-primary hover:underline"
        >
          {row.original.invoice.invoiceNo}
        </Link>
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
      ),
  },
  {
    accessorKey: "amount",
    header: "Amount",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-sm font-medium">{formatMoney(row.original.amount, row.original.currency)}</span>
    ),
  },
  {
    id: "refundedAt",
    header: "Refunded at",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{formatDate(row.original.refundedAt || row.original.createdAt)}</span>
    ),
  },
];

/* ------------------------------ Refund dialog ----------------------------- */

const refundSchema = z.object({
  kind: z.string().min(1),
  clientId: z.string().min(1, "Select a client"),
  invoiceId: z.string(),
  paymentId: z.string(),
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Amount must be greater than zero"),
  currency: currencyValue,
  reason: z.string(),
});

type RefundValues = z.infer<typeof refundSchema>;

function NewRefundDialog({ clients, onClose }: { clients: Client[]; onClose: () => void }) {
  const form = useForm<RefundValues>({
    resolver: zodResolver(refundSchema),
    defaultValues: {
      kind: "REFUND",
      clientId: "",
      invoiceId: "",
      paymentId: "",
      amount: "",
      currency: "LKR",
      reason: "",
    },
  });

  const watchedClientId = form.watch("clientId");
  const watchedInvoiceId = form.watch("invoiceId");
  const watchedPaymentId = form.watch("paymentId");

  const invoicesQuery = useQuery({
    queryKey: ["invoices", "refund-options", watchedClientId],
    enabled: Boolean(watchedClientId),
    queryFn: async () => {
      const { data } = await api.getWithMeta<Invoice[]>("/invoices", {
        clientId: watchedClientId,
        limit: 200,
      });
      return data.filter((invoice) => !["DRAFT", "VOID"].includes(invoice.status));
    },
  });

  const paymentsQuery = useQuery({
    queryKey: ["payments", "refund-options", watchedClientId],
    enabled: Boolean(watchedClientId),
    queryFn: async () => {
      const { data } = await api.getWithMeta<Payment[]>("/payments", {
        clientId: watchedClientId,
        limit: 200,
      });
      return data;
    },
  });

  const selectedInvoice = (invoicesQuery.data ?? []).find((invoice) => invoice.id === watchedInvoiceId);
  const selectedPayment = (paymentsQuery.data ?? []).find((payment) => payment.id === watchedPaymentId);
  const currencyLocked = Boolean(selectedInvoice || selectedPayment);

  // Changing the client clears any invoice/payment that belonged to the old one.
  useEffect(() => {
    form.setValue("invoiceId", "");
    form.setValue("paymentId", "");
  }, [watchedClientId, form]);

  // Currency follows payment > invoice > client.
  useEffect(() => {
    const client = clients.find((entry) => entry.id === watchedClientId);
    if (selectedPayment) form.setValue("currency", selectedPayment.currency);
    else if (selectedInvoice) form.setValue("currency", selectedInvoice.currency);
    else if (client) form.setValue("currency", client.currency || "LKR");
  }, [selectedPayment, selectedInvoice, clients, watchedClientId, form]);

  const mutation = useMutation({
    mutationFn: (values: RefundValues) =>
      api.post<Refund>("/refunds", {
        kind: values.kind,
        clientId: values.clientId,
        invoiceId: values.invoiceId && values.invoiceId !== "NONE" ? values.invoiceId : null,
        paymentId: values.paymentId && values.paymentId !== "NONE" ? values.paymentId : null,
        amount: values.amount,
        currency: values.currency,
        reason: values.reason.trim() || null,
      }),
    onSuccess: (_refund, values) => {
      toastSuccess(
        values.kind === "CREDIT_NOTE" ? "Credit note recorded" : "Refund recorded",
        "Linked invoices are recalculated from confirmed payments minus refunds and credit notes.",
      );
      queryClient.invalidateQueries({ queryKey: ["refunds", "list"] });
      queryClient.invalidateQueries({ queryKey: ["invoices", "list"] });
      queryClient.invalidateQueries({ queryKey: ["payments", "list"] });
      onClose();
    },
    onError: (error) => {
      const errors = fieldErrors(error);
      for (const [key, message] of Object.entries(errors)) {
        form.setError(key as keyof RefundValues, { message });
      }
      toastError(error);
    },
  });

  const invoiceOptions = [
    { value: "NONE", label: "No invoice" },
    ...(invoicesQuery.data ?? []).map((invoice) => ({
      value: invoice.id,
      label: `${invoice.invoiceNo} · ${formatMoney(invoice.balance, invoice.currency)} due`,
    })),
  ];
  const paymentOptions = [
    { value: "NONE", label: "No payment" },
    ...(paymentsQuery.data ?? []).map((payment) => ({
      value: payment.id,
      label: `${payment.paymentNo} · ${formatMoney(payment.amount, payment.currency)}`,
    })),
  ];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New refund or credit note</DialogTitle>
          <DialogDescription>
            A refund returns money to the client; a credit note records credit against their account.
            Either way the linked invoice is recalculated from confirmed payments minus refunds.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField form={form} name="kind" label="Type" options={OPTIONS.refundKind} required />
            <SelectField
              form={form}
              name="clientId"
              label="Client"
              required
              placeholder={clients.length === 0 ? "Loading clients..." : "Select a client"}
              disabled={clients.length === 0}
              options={clients.map((client) => ({ value: client.id, label: clientDisplayName(client) }))}
            />
            <SelectField
              form={form}
              name="invoiceId"
              label="Invoice (optional)"
              placeholder="No invoice"
              disabled={!watchedClientId || invoicesQuery.isLoading}
              options={invoiceOptions}
            />
            <SelectField
              form={form}
              name="paymentId"
              label="Payment (optional)"
              placeholder="No payment"
              disabled={!watchedClientId || paymentsQuery.isLoading}
              options={paymentOptions}
            />
            <TextField form={form} name="amount" label="Amount" type="number" min={0} step="0.01" required />
            <TextField
              form={form}
              name="currency"
              label="Currency"
              required
              disabled={currencyLocked}
              description={currencyLocked ? "Taken from the selected invoice or payment." : "3-letter code, e.g. LKR"}
            />
          </div>
          <TextareaField
            form={form}
            name="reason"
            label="Reason (optional)"
            rows={3}
            placeholder="Why is this being refunded or credited?"
          />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Recording..." : "Record refund"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- Page ----------------------------------- */

export default function RefundList() {
  const { can } = useAuth();
  const list = useListParams({ kind: "", clientId: "" });
  const refunds = useApiList<RefundRow>(["refunds", "list", list.query], "/refunds", list.query);
  const clientsQuery = useApiQuery<Client[]>(["clients", "options"], "/clients", { limit: 200 });
  const [createOpen, setCreateOpen] = useState(false);

  const hasActiveFilters = Boolean(list.filters.kind) || Boolean(list.filters.clientId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Refunds & credit notes"
        description="Money returned to clients and credit issued against their account. Linked invoices are recalculated automatically."
        actions={
          can("refunds.manage") ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New refund
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-4">
        <FilterBar>
          <Select
            value={list.filters.kind || "ALL"}
            onValueChange={(value) => list.setFilter("kind", value === "ALL" ? "" : value)}
          >
            <SelectTrigger className="w-[170px]" aria-label="Filter by type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All types</SelectItem>
              {OPTIONS.refundKind.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {kind === "CREDIT_NOTE" ? "Credit note" : "Refund"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={list.filters.clientId || "ALL"}
            onValueChange={(value) => list.setFilter("clientId", value === "ALL" ? "" : value)}
          >
            <SelectTrigger className="w-[190px]" aria-label="Filter by client">
              <SelectValue placeholder="All clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All clients</SelectItem>
              {(clientsQuery.data ?? []).map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {clientDisplayName(client)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={list.resetFilters}
            >
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
          ) : null}
        </FilterBar>

        {refunds.isError ? (
          <ErrorState
            title="Refunds could not be loaded"
            description={refunds.error instanceof Error ? refunds.error.message : undefined}
            onRetry={() => refunds.refetch()}
          />
        ) : (
          <DataTable
            columns={refundColumns}
            data={refunds.data?.items ?? []}
            isLoading={refunds.isLoading}
            emptyTitle="No refunds or credit notes"
            emptyDescription="Nothing has been refunded or credited yet."
            emptyAction={
              can("refunds.manage") ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" /> New refund
                </Button>
              ) : undefined
            }
          />
        )}

        <Pagination pagination={refunds.data?.pagination} onPageChange={list.setPage} />
      </div>

      {createOpen ? (
        <NewRefundDialog clients={clientsQuery.data ?? []} onClose={() => setCreateOpen(false)} />
      ) : null}
    </div>
  );
}
