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
import { clientDisplayName, formatDateTime, formatMoney, humanize, toDateInput, toNumber } from "@/lib/format";
import { OPTIONS } from "@/lib/status";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { ErrorState } from "@/components/common/states";
import { SelectField, TextField, TextareaField } from "@/components/common/form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Client, Invoice, Payment } from "@/types";

/* --------------------------- Record payment dialog ------------------------ */

const recordPaymentSchema = z.object({
  clientId: z.string().min(1, "Select a client"),
  invoiceId: z.string(),
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Amount must be greater than zero"),
  method: z.string().min(1, "Select a payment method"),
  reference: z.string(),
  paidAt: z.string(),
  notes: z.string(),
});

type RecordPaymentValues = z.infer<typeof recordPaymentSchema>;

function RecordPaymentDialog({ clients, onClose }: { clients: Client[]; onClose: () => void }) {
  const form = useForm<RecordPaymentValues>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: {
      clientId: "",
      invoiceId: "",
      amount: "",
      method: "BANK_TRANSFER",
      reference: "",
      paidAt: toDateInput(new Date()),
      notes: "",
    },
  });

  const watchedClientId = form.watch("clientId");
  const watchedInvoiceId = form.watch("invoiceId");

  const invoiceOptionsQuery = useQuery({
    queryKey: ["invoices", "payment-options", watchedClientId],
    enabled: Boolean(watchedClientId),
    queryFn: async () => {
      const { data } = await api.getWithMeta<Invoice[]>("/invoices", {
        clientId: watchedClientId,
        limit: 200,
      });
      return data.filter(
        (invoice) => !["DRAFT", "VOID", "PAID"].includes(invoice.status) && toNumber(invoice.balance) > 0,
      );
    },
  });

  // Changing the client invalidates any invoice that was selected.
  useEffect(() => {
    form.setValue("invoiceId", "");
  }, [watchedClientId, form]);

  // Selecting an invoice pre-fills the amount with its outstanding balance.
  useEffect(() => {
    if (!watchedInvoiceId || watchedInvoiceId === "NONE") return;
    const invoice = (invoiceOptionsQuery.data ?? []).find((entry) => entry.id === watchedInvoiceId);
    if (invoice) form.setValue("amount", String(invoice.balance ?? ""));
  }, [watchedInvoiceId, invoiceOptionsQuery.data, form]);

  const mutation = useMutation({
    mutationFn: (values: RecordPaymentValues) =>
      api.post<Payment>("/payments", {
        clientId: values.clientId,
        invoiceId: values.invoiceId && values.invoiceId !== "NONE" ? values.invoiceId : null,
        amount: values.amount,
        method: values.method,
        reference: values.reference.trim() || null,
        paidAt: values.paidAt || undefined,
        notes: values.notes.trim() || null,
      }),
    onSuccess: () => {
      toastSuccess("Payment recorded", "Confirmed payments update the invoice balance and status.");
      queryClient.invalidateQueries({ queryKey: ["payments", "list"] });
      queryClient.invalidateQueries({ queryKey: ["invoices", "list"] });
      onClose();
    },
    onError: (error) => {
      const errors = fieldErrors(error);
      for (const [key, message] of Object.entries(errors)) {
        form.setError(key as keyof RecordPaymentValues, { message });
      }
      toastError(error);
    },
  });

  const methodOptions = OPTIONS.paymentMethod.map((method) => ({ value: method, label: humanize(method) }));
  const invoiceOptions = [
    { value: "NONE", label: "No invoice (unlinked payment)" },
    ...(invoiceOptionsQuery.data ?? []).map((invoice) => ({
      value: invoice.id,
      label: `${invoice.invoiceNo} · ${formatMoney(invoice.balance, invoice.currency)} due`,
    })),
  ];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Records money received from a client. Linking an invoice recalculates that invoice's balance
            and status from confirmed payments.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <div className="grid gap-4 sm:grid-cols-2">
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
              disabled={!watchedClientId || invoiceOptionsQuery.isLoading}
              options={invoiceOptions}
            />
            <TextField form={form} name="amount" label="Amount" type="number" min={0} step="0.01" required />
            <SelectField form={form} name="method" label="Method" options={methodOptions} required />
            <TextField form={form} name="paidAt" label="Paid on" type="date" />
            <TextField form={form} name="reference" label="Reference (optional)" placeholder="Bank ref / txn id" />
          </div>
          <TextareaField form={form} name="notes" label="Notes (optional)" rows={3} />
          <p className="text-xs text-muted-foreground">
            The currency comes from the selected invoice, or the client's default currency when no invoice
            is linked.
          </p>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Recording..." : "Record payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- Void dialog ------------------------------ */

function VoidPaymentDialog({
  payment,
  loading,
  onConfirm,
  onClose,
}: {
  payment: Payment;
  loading: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 3;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Void payment {payment.paymentNo}</DialogTitle>
          <DialogDescription>
            The payment stops counting towards its invoice and any linked invoice balance is recalculated
            from the remaining confirmed payments.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="payment-void-reason">Reason</Label>
          <Textarea
            id="payment-void-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this payment being voided?"
          />
          <p className="text-xs text-muted-foreground">At least 3 characters. Stored for auditing.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!valid || loading} onClick={() => onConfirm(reason.trim())}>
            {loading ? "Working..." : "Void payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- Page ----------------------------------- */

export default function PaymentList() {
  const { can } = useAuth();
  const list = useListParams({ method: "", clientId: "", dateFrom: "", dateTo: "", includeVoid: "true" });
  const payments = useApiList<Payment>(["payments", "list", list.query], "/payments", list.query);
  const clientsQuery = useApiQuery<Client[]>(["clients", "options"], "/clients", { limit: 200 });

  const [recordOpen, setRecordOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Payment | null>(null);

  const includeVoid = list.filters.includeVoid !== "false";
  const hasActiveFilters =
    Object.entries(list.filters).some(([key, value]) => key !== "includeVoid" && value !== "");

  const voidMutation = useMutation({
    mutationFn: (vars: { paymentId: string; reason: string }) =>
      api.post<Payment>(`/payments/${vars.paymentId}/void`, { reason: vars.reason }),
    onSuccess: () => {
      toastSuccess("Payment voided", "Linked invoice totals were recalculated from confirmed payments.");
      queryClient.invalidateQueries({ queryKey: ["payments", "list"] });
      queryClient.invalidateQueries({ queryKey: ["invoices", "list"] });
      setVoidTarget(null);
    },
    onError: (error) => toastError(error),
  });

  const columns: ColumnDef<Payment, unknown>[] = [
    {
      accessorKey: "paymentNo",
      header: "Payment #",
      enableSorting: false,
      cell: ({ row }) => <span className="font-mono text-xs font-medium">{row.original.paymentNo}</span>,
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
          <span className="text-xs text-muted-foreground">Unlinked</span>
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
      accessorKey: "method",
      header: "Method",
      enableSorting: false,
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{humanize(row.original.method)}</span>,
    },
    {
      accessorKey: "paidAt",
      header: "Paid at",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{formatDateTime(row.original.paidAt)}</span>
      ),
    },
    {
      id: "state",
      header: "Status",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.isVoid ? (
          <div className="space-y-1">
            <Badge variant="destructive">Voided</Badge>
            {row.original.voidReason ? (
              <p className="max-w-[170px] truncate text-[11px] text-muted-foreground">{row.original.voidReason}</p>
            ) : null}
          </div>
        ) : (
          <Badge variant="success">Confirmed</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.isVoid || !can("payments.void") ? null : (
          <div className="text-right">
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10"
              onClick={() => setVoidTarget(row.original)}
            >
              Void
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Every confirmed payment received. Payments drive invoice balances — voiding one recalculates the linked invoice."
        actions={
          can("payments.record") ? (
            <Button onClick={() => setRecordOpen(true)}>
              <Plus className="h-4 w-4" /> Record payment
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-4">
        <FilterBar>
          <Select
            value={list.filters.method || "ALL"}
            onValueChange={(value) => list.setFilter("method", value === "ALL" ? "" : value)}
          >
            <SelectTrigger className="w-[170px]" aria-label="Filter by method">
              <SelectValue placeholder="All methods" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All methods</SelectItem>
              {OPTIONS.paymentMethod.map((method) => (
                <SelectItem key={method} value={method}>
                  {humanize(method)}
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

          <Input
            type="date"
            value={list.filters.dateFrom ?? ""}
            onChange={(event) => list.setFilter("dateFrom", event.target.value)}
            className="h-10 w-[150px]"
            aria-label="Paid from date"
          />
          <Input
            type="date"
            value={list.filters.dateTo ?? ""}
            onChange={(event) => list.setFilter("dateTo", event.target.value)}
            className="h-10 w-[150px]"
            aria-label="Paid to date"
          />

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => list.setFilter("includeVoid", includeVoid ? "false" : "true")}
            className={includeVoid ? "border-border bg-muted/60 text-foreground" : "text-muted-foreground"}
          >
            Include voided
          </Button>

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

        {payments.isError ? (
          <ErrorState
            title="Payments could not be loaded"
            description={payments.error instanceof Error ? payments.error.message : undefined}
            onRetry={() => payments.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            data={payments.data?.items ?? []}
            isLoading={payments.isLoading}
            rowClassName={(payment) => (payment.isVoid ? "opacity-60" : undefined)}
            emptyTitle="No payments found"
            emptyDescription="Record a payment when money is received — the invoice balance updates from confirmed payments."
            emptyAction={
              can("payments.record") ? (
                <Button size="sm" onClick={() => setRecordOpen(true)}>
                  <Plus className="h-4 w-4" /> Record payment
                </Button>
              ) : undefined
            }
          />
        )}

        <Pagination pagination={payments.data?.pagination} onPageChange={list.setPage} />
      </div>

      {recordOpen ? (
        <RecordPaymentDialog clients={clientsQuery.data ?? []} onClose={() => setRecordOpen(false)} />
      ) : null}
      {voidTarget ? (
        <VoidPaymentDialog
          payment={voidTarget}
          loading={voidMutation.isPending}
          onConfirm={(reason) => voidMutation.mutate({ paymentId: voidTarget.id, reason })}
          onClose={() => setVoidTarget(null)}
        />
      ) : null}
    </div>
  );
}
