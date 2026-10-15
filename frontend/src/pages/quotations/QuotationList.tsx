import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { useApiList } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { errorMessage, fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import {
  clientDisplayName,
  formatDate,
  formatDateTime,
  formatMoney,
  isOverdue,
  toNumber,
} from "@/lib/format";
import { OPTIONS, statusLabel } from "@/lib/status";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { ErrorState } from "@/components/common/states";
import { FieldShell, TextField, TextareaField } from "@/components/common/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Client, Quotation } from "@/types";

const INITIAL_FILTERS = { status: "", clientId: "" };

const COLUMNS: ColumnDef<Quotation, unknown>[] = [
  {
    id: "number",
    accessorKey: "quotationNo",
    header: "Number",
    enableSorting: false,
    cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.quotationNo}</span>,
  },
  {
    id: "title",
    accessorKey: "title",
    header: "Title",
    enableSorting: false,
    cell: ({ row }) => <span className="font-medium text-foreground">{row.original.title}</span>,
  },
  {
    id: "client",
    accessorFn: (row) => clientDisplayName(row.client),
    header: "Client",
    enableSorting: false,
    cell: ({ row }) => <span className="text-muted-foreground">{clientDisplayName(row.original.client)}</span>,
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    enableSorting: false,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: "total",
    accessorKey: "total",
    header: "Total",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="font-medium">{formatMoney(row.original.total, row.original.currency)}</span>
    ),
  },
  {
    id: "validUntil",
    accessorKey: "validUntil",
    header: "Valid until",
    enableSorting: false,
    cell: ({ row }) => {
      const expired =
        row.original.validUntil !== null &&
        isOverdue(row.original.validUntil) &&
        ["DRAFT", "SENT"].includes(row.original.status);
      return (
        <span className={expired ? "text-rose-300" : "text-muted-foreground"}>
          {formatDate(row.original.validUntil)}
        </span>
      );
    },
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Created",
    enableSorting: false,
    cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
  },
];

/* ----------------------------- Form definition ----------------------------- */

const quotationSchema = z.object({
  clientId: z.string().min(1, "Select a client"),
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title must be 200 characters or fewer"),
  currency: z.string().trim().length(3, "Currency must be a 3-letter code"),
  taxRate: z
    .string()
    .refine(
      (value) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100,
      "Enter a rate between 0 and 100",
    ),
  validUntil: z
    .string()
    .refine((value) => value === "" || !Number.isNaN(new Date(value).getTime()), "Enter a valid date"),
  terms: z.string(),
  clientNotes: z.string(),
  internalNotes: z.string(),
});

type QuotationValues = z.infer<typeof quotationSchema>;

interface ItemRow {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
}

interface ItemRowErrors {
  description?: string;
  quantity?: string;
  unitPrice?: string;
  discount?: string;
}

interface QuotationPayload {
  clientId: string;
  title: string;
  currency: string;
  taxRate: number;
  validUntil: string | null;
  terms: string | null;
  clientNotes: string | null;
  internalNotes: string | null;
  items: Array<{ description: string; quantity: number; unitPrice: number; discount: number }>;
}

let rowSequence = 0;
const nextRowKey = () => `item-${(rowSequence += 1)}`;

function blankRow(): ItemRow {
  return { key: nextRowKey(), description: "", quantity: "1", unitPrice: "", discount: "0" };
}

function validateRows(rows: ItemRow[]): Record<number, ItemRowErrors> {
  const errors: Record<number, ItemRowErrors> = {};
  rows.forEach((row, index) => {
    const rowErrors: ItemRowErrors = {};
    if (!row.description.trim()) rowErrors.description = "Description is required";
    if (row.quantity.trim() === "" || !Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0) {
      rowErrors.quantity = "Must be > 0";
    }
    if (row.unitPrice.trim() === "" || !Number.isFinite(Number(row.unitPrice)) || Number(row.unitPrice) < 0) {
      rowErrors.unitPrice = "Enter a price";
    }
    if (
      row.discount.trim() !== "" &&
      (!Number.isFinite(Number(row.discount)) || Number(row.discount) < 0)
    ) {
      rowErrors.discount = "Invalid discount";
    }
    if (Object.keys(rowErrors).length > 0) errors[index] = rowErrors;
  });
  return errors;
}

/** Mirrors the server formula: lineTotal = (qty x price) - discount, never < 0. */
function computeTotals(rows: ItemRow[], taxRate: string) {
  let subtotal = 0;
  let discountTotal = 0;
  for (const row of rows) {
    const gross = toNumber(row.quantity) * toNumber(row.unitPrice);
    const discount = Math.max(0, toNumber(row.discount));
    subtotal += Math.max(0, gross - discount);
    discountTotal += discount;
  }
  const taxTotal = subtotal * (Math.max(0, toNumber(taxRate)) / 100);
  return { subtotal, discountTotal, taxTotal, total: subtotal + taxTotal };
}

function ItemField({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

/* ------------------------------ Create dialog ------------------------------ */

function NewQuotationDialog({
  clients,
  clientsLoading,
  onClose,
}: {
  clients: Client[];
  clientsLoading: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<QuotationValues>({
    resolver: zodResolver(quotationSchema),
    defaultValues: {
      clientId: "",
      title: "",
      currency: "LKR",
      taxRate: "0",
      validUntil: "",
      terms: "",
      clientNotes: "",
      internalNotes: "",
    },
  });

  const [rows, setRows] = useState<ItemRow[]>([blankRow()]);
  const [rowErrors, setRowErrors] = useState<Record<number, ItemRowErrors>>({});

  const clientId = useWatch({ control: form.control, name: "clientId" });
  const taxRate = useWatch({ control: form.control, name: "taxRate" });
  const currency = useWatch({ control: form.control, name: "currency" });
  const totals = useMemo(() => computeTotals(rows, taxRate), [rows, taxRate]);
  const currencyCode = (currency || "LKR").toUpperCase();

  const mutation = useMutation({
    mutationFn: (body: QuotationPayload) => api.post<Quotation>("/quotations", body),
    onSuccess: (quotation) => {
      toastSuccess("Quotation created", `${quotation.quotationNo} was saved as a draft.`);
      queryClient.invalidateQueries({ queryKey: ["quotations"] });
      onClose();
      navigate(`/quotations/${quotation.id}`);
    },
    onError: (error) => {
      for (const [key, message] of Object.entries(fieldErrors(error))) {
        form.setError(key as keyof QuotationValues, { message });
      }
      toastError(error);
    },
  });

  const updateRow = (index: number, patch: Partial<ItemRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setRowErrors((prev) => (prev[index] ? { ...prev, [index]: {} } : prev));
  };

  const onSubmit = form.handleSubmit((values) => {
    const errors = validateRows(rows);
    if (Object.keys(errors).length > 0) {
      setRowErrors(errors);
      return;
    }
    setRowErrors({});
    mutation.mutate({
      clientId: values.clientId,
      title: values.title,
      currency: values.currency.toUpperCase(),
      taxRate: toNumber(values.taxRate),
      validUntil: values.validUntil || null,
      terms: values.terms.trim() || null,
      clientNotes: values.clientNotes.trim() || null,
      internalNotes: values.internalNotes.trim() || null,
      items: rows.map((row) => ({
        description: row.description.trim(),
        quantity: toNumber(row.quantity),
        unitPrice: toNumber(row.unitPrice),
        discount: row.discount.trim() === "" ? 0 : toNumber(row.discount),
      })),
    });
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <DialogHeader>
            <DialogTitle>New quotation</DialogTitle>
            <DialogDescription>
              Draft a quotation with line items. You can send it to the client once it is ready.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FieldShell
                label="Client"
                htmlFor="clientId"
                required
                error={form.formState.errors.clientId?.message as string | undefined}
              >
                <Select
                  value={clientId}
                  onValueChange={(value) => {
                    form.setValue("clientId", value, { shouldValidate: true, shouldDirty: true });
                    const picked = clients.find((client) => client.id === value);
                    if (picked) form.setValue("currency", picked.currency.toUpperCase(), { shouldDirty: true });
                  }}
                >
                  <SelectTrigger id="clientId" disabled={clientsLoading}>
                    <SelectValue
                      placeholder={
                        clientsLoading
                          ? "Loading clients..."
                          : clients.length
                            ? "Select a client"
                            : "No clients available"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {clientDisplayName(client)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldShell>
            </div>

            <TextField
              form={form}
              name="title"
              label="Title"
              required
              placeholder="Website redesign proposal"
              className="sm:col-span-2"
            />
            <TextField form={form} name="currency" label="Currency" placeholder="LKR" required />
            <TextField
              form={form}
              name="taxRate"
              label="Tax rate (%)"
              type="number"
              min={0}
              max={100}
              step="0.01"
              required
            />
            <TextField
              form={form}
              name="validUntil"
              label="Valid until"
              type="date"
              description="The quotation expires after this date."
              className="sm:col-span-2"
            />
            <TextareaField
              form={form}
              name="clientNotes"
              label="Notes for client"
              rows={3}
              placeholder="Anything the client should know..."
              className="sm:col-span-2"
            />
            <TextareaField
              form={form}
              name="terms"
              label="Terms & conditions"
              rows={3}
              placeholder="Payment terms, scope, warranties..."
              className="sm:col-span-2"
            />
            <TextareaField
              form={form}
              name="internalNotes"
              label="Internal notes"
              rows={2}
              description="Never shared with the client."
              className="sm:col-span-2"
            />
          </div>

          <div className="space-y-3 border-t border-white/10 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">Line items</p>
                <p className="text-xs text-muted-foreground">At least one item is required.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRows((prev) => [...prev, blankRow()])}
              >
                <Plus className="h-4 w-4" />
                Add item
              </Button>
            </div>

            {rows.map((row, index) => {
              const errors = rowErrors[index];
              return (
                <div
                  key={row.key}
                  className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-12"
                >
                  <div className="sm:col-span-5">
                    <ItemField label="Description" error={errors?.description}>
                      <Input
                        value={row.description}
                        onChange={(event) => updateRow(index, { description: event.target.value })}
                        placeholder="Design & build"
                      />
                    </ItemField>
                  </div>
                  <div className="sm:col-span-2">
                    <ItemField label="Qty" error={errors?.quantity}>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.quantity}
                        onChange={(event) => updateRow(index, { quantity: event.target.value })}
                      />
                    </ItemField>
                  </div>
                  <div className="sm:col-span-2">
                    <ItemField label="Unit price" error={errors?.unitPrice}>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.unitPrice}
                        onChange={(event) => updateRow(index, { unitPrice: event.target.value })}
                        placeholder="0.00"
                      />
                    </ItemField>
                  </div>
                  <div className="sm:col-span-2">
                    <ItemField label="Discount" error={errors?.discount}>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.discount}
                        onChange={(event) => updateRow(index, { discount: event.target.value })}
                        placeholder="0"
                      />
                    </ItemField>
                  </div>
                  <div className="flex items-end sm:col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={rows.length === 1}
                      onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                      aria-label="Remove line item"
                      title="Remove line item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-4 border-t border-white/10 pt-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                {rows.length} line item{rows.length === 1 ? "" : "s"}
              </p>
              <p className="text-xs">Totals are recalculated live from the rows above.</p>
            </div>
            <div className="w-full space-y-1.5 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm sm:w-72">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatMoney(totals.subtotal, currencyCode)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Discount</span>
                <span>-{formatMoney(totals.discountTotal, currencyCode)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Tax ({toNumber(taxRate)}%)</span>
                <span>{formatMoney(totals.taxTotal, currencyCode)}</span>
              </div>
              <div className="flex justify-between gap-3 border-t border-white/10 pt-1.5 font-medium">
                <span>Total</span>
                <span>{formatMoney(totals.total, currencyCode)}</span>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 border-t border-white/10 pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {mutation.isPending ? "Saving..." : "Create quotation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- Page ----------------------------------- */

export default function QuotationList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const params = useListParams(INITIAL_FILTERS);
  const [createOpen, setCreateOpen] = useState(false);

  const quotations = useApiList<Quotation>(qk.list("quotations", params.query), "/quotations", params.query);
  const clients = useApiList<Client>(qk.list("clients", { limit: 200 }), "/clients", { limit: 200 });

  const clientOptions = clients.data?.items ?? [];
  const canCreate = can("quotations.create");
  const hasFilters = Boolean(params.search || params.filters.status || params.filters.clientId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotations"
        description="Prepare, send and track quotations from draft to acceptance."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New quotation
            </Button>
          ) : null
        }
      />

      <div className="space-y-4">
        <FilterBar>
          <SearchInput
            value={params.search}
            onChange={params.setSearch}
            placeholder="Search number or title..."
          />

          <Select
            value={params.filters.status || "ALL"}
            onValueChange={(value) => params.setFilter("status", value)}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {OPTIONS.quotationStatus.map((status) => (
                <SelectItem key={status} value={status}>
                  {statusLabel(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={params.filters.clientId || "ALL"}
            onValueChange={(value) => params.setFilter("clientId", value)}
          >
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder={clients.isLoading ? "Loading clients..." : "All clients"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All clients</SelectItem>
              {clientOptions.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {clientDisplayName(client)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={params.resetFilters}>
              Clear filters
            </Button>
          ) : null}
        </FilterBar>

        {quotations.isError ? (
          <ErrorState
            title="Quotations could not be loaded"
            description={errorMessage(quotations.error)}
            onRetry={() => quotations.refetch()}
          />
        ) : (
          <DataTable
            columns={COLUMNS}
            data={quotations.data?.items ?? []}
            isLoading={quotations.isLoading}
            onRowClick={(row) => navigate(`/quotations/${row.id}`)}
            emptyTitle="No quotations found"
            emptyDescription={
              hasFilters
                ? "Nothing matches the current search and filters."
                : "Create your first quotation to get started."
            }
            emptyAction={
              canCreate && !hasFilters ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New quotation
                </Button>
              ) : null
            }
          />
        )}

        <Pagination pagination={quotations.data?.pagination} onPageChange={params.setPage} />
      </div>

      {createOpen ? (
        <NewQuotationDialog
          clients={clientOptions}
          clientsLoading={clients.isLoading}
          onClose={() => setCreateOpen(false)}
        />
      ) : null}
    </div>
  );
}
