import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Clock, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useApiList, useApiQuery } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { clientDisplayName, formatDate, formatMoney, isOverdue, toDateInput, toNumber } from "@/lib/format";
import { currencyValue } from "@/lib/validation";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { ErrorState } from "@/components/common/states";
import { SelectField, TextField, TextareaField } from "@/components/common/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Client, Invoice, Project } from "@/types";

/* ------------------------------- List chrome -------------------------------

   The status chips and the "Overdue only" toggle are mutually exclusive: the
   server applies `overdue=true` as its own `status` clause, so sending both
   would silently drop the selected status.                                    */

const STATUS_CHIPS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "ISSUED", label: "Issued" },
  { value: "PARTIALLY_PAID", label: "Partly paid" },
  { value: "PAID", label: "Paid" },
  { value: "VOID", label: "Void" },
  { value: "REFUNDED", label: "Refunded" },
];

/** Past due and still expecting money. Drafts/voids are never overdue. */
function isInvoiceOverdue(invoice: Invoice): boolean {
  if (invoice.status === "PAID" || invoice.status === "VOID" || invoice.status === "DRAFT") return false;
  return isOverdue(invoice.dueDate);
}

const invoiceColumns: ColumnDef<Invoice, unknown>[] = [
  {
    accessorKey: "invoiceNo",
    header: "Invoice #",
    enableSorting: false,
    cell: ({ row }) => <span className="font-mono text-xs font-medium">{row.original.invoiceNo}</span>,
  },
  {
    id: "client",
    accessorFn: (row) => clientDisplayName(row.client),
    header: "Client",
    enableSorting: false,
    cell: ({ row }) => (
      <div className="min-w-0 max-w-[220px]">
        <p className="truncate text-sm font-medium">{clientDisplayName(row.original.client)}</p>
        {row.original.project ? (
          <p className="truncate text-xs text-muted-foreground">{row.original.project.name}</p>
        ) : null}
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    enableSorting: false,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "issueDate",
    header: "Issue date",
    enableSorting: false,
    cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDate(row.original.issueDate)}</span>,
  },
  {
    accessorKey: "dueDate",
    header: "Due date",
    enableSorting: false,
    cell: ({ row }) => {
      const overdue = isInvoiceOverdue(row.original);
      return (
        <span className={overdue ? "text-sm font-medium text-danger" : "text-sm text-muted-foreground"}>
          {formatDate(row.original.dueDate)}
          {overdue ? <span className="ml-1.5 text-[10px] uppercase tracking-wide">overdue</span> : null}
        </span>
      );
    },
  },
  {
    accessorKey: "total",
    header: "Total",
    enableSorting: false,
    cell: ({ row }) => <span className="text-sm">{formatMoney(row.original.total, row.original.currency)}</span>,
  },
  {
    accessorKey: "amountPaid",
    header: "Paid",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {formatMoney(row.original.amountPaid, row.original.currency)}
      </span>
    ),
  },
  {
    accessorKey: "balance",
    header: "Balance",
    enableSorting: false,
    cell: ({ row }) => {
      const overdue = isInvoiceOverdue(row.original);
      const settled = toNumber(row.original.balance) <= 0;
      return (
        <span
          className={
            overdue
              ? "text-sm font-semibold text-danger"
              : settled
                ? "text-sm text-muted-foreground"
                : "text-sm font-medium"
          }
        >
          {formatMoney(row.original.balance, row.original.currency)}
        </span>
      );
    },
  },
];

/* ------------------------------ Create dialog ------------------------------ */

const lineItemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  quantity: z
    .string()
    .min(1, "Quantity is required")
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Must be greater than 0"),
  unitPrice: z
    .string()
    .min(1, "Unit price is required")
    .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, "Enter a valid amount"),
  discount: z
    .string()
    .refine(
      (value) => value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "Enter a valid discount",
    ),
});

const createInvoiceSchema = z.object({
  clientId: z.string().min(1, "Select a client"),
  projectId: z.string(),
  currency: currencyValue,
  issueDate: z.string(),
  dueDate: z.string(),
  taxRate: z
    .string()
    .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, "Enter a valid tax rate"),
  notes: z.string(),
  terms: z.string(),
  items: z.array(lineItemSchema).min(1, "Add at least one line item"),
});

type CreateInvoiceValues = z.infer<typeof createInvoiceSchema>;

function createInvoiceDefaults(): CreateInvoiceValues {
  return {
    clientId: "",
    projectId: "",
    currency: "LKR",
    issueDate: toDateInput(new Date()),
    dueDate: "",
    taxRate: "0",
    notes: "",
    terms: "",
    items: [{ description: "", quantity: "1", unitPrice: "", discount: "0" }],
  };
}

/** Display-only preview. The server recomputes every total on save. */
function computePreviewTotals(
  items: Array<{ quantity?: string; unitPrice?: string; discount?: string }>,
  taxRate: string,
) {
  const num = (value: string | undefined) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  let subtotal = 0;
  let discountTotal = 0;
  for (const item of items) {
    const gross = num(item.quantity) * num(item.unitPrice);
    const discount = Math.max(0, num(item.discount));
    subtotal += Math.max(0, gross - discount);
    discountTotal += discount;
  }
  const rate = Math.max(0, num(taxRate));
  const taxTotal = subtotal * (rate / 100);
  return { subtotal, discountTotal, taxTotal, total: subtotal + taxTotal };
}

function CreateInvoiceDialog({ clients, onClose }: { clients: Client[]; onClose: () => void }) {
  const navigate = useNavigate();
  const form = useForm<CreateInvoiceValues>({
    resolver: zodResolver(createInvoiceSchema),
    defaultValues: createInvoiceDefaults(),
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const watchedItems = useWatch({ control: form.control, name: "items" });
  const watchedTaxRate = useWatch({ control: form.control, name: "taxRate" });
  const watchedCurrency = useWatch({ control: form.control, name: "currency" });
  const watchedClientId = form.watch("clientId");

  const projectsQuery = useQuery({
    queryKey: ["projects", "options", watchedClientId],
    enabled: Boolean(watchedClientId),
    queryFn: async () => {
      const { data } = await api.getWithMeta<Project[]>("/projects", {
        clientId: watchedClientId,
        limit: 200,
      });
      return data;
    },
  });

  // Currency and project follow the selected client.
  useEffect(() => {
    const client = clients.find((entry) => entry.id === watchedClientId);
    if (!client) return;
    form.setValue("currency", client.currency || "LKR");
    form.setValue("projectId", "");
  }, [clients, watchedClientId, form]);

  const totals = useMemo(
    () => computePreviewTotals(watchedItems ?? [], watchedTaxRate ?? "0"),
    [watchedItems, watchedTaxRate],
  );

  const createMutation = useMutation({
    mutationFn: (values: CreateInvoiceValues) =>
      api.post<Invoice>("/invoices", {
        clientId: values.clientId,
        projectId: values.projectId && values.projectId !== "NONE" ? values.projectId : null,
        currency: values.currency,
        issueDate: values.issueDate || undefined,
        dueDate: values.dueDate || null,
        taxRate: values.taxRate,
        notes: values.notes.trim() || null,
        terms: values.terms.trim() || null,
        items: values.items.map((item, index) => ({
          description: item.description.trim(),
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount.trim() || "0",
          sortOrder: index,
        })),
      }),
    onSuccess: (invoice) => {
      toastSuccess("Invoice created", `${invoice.invoiceNo} was saved as a draft.`);
      queryClient.invalidateQueries({ queryKey: ["invoices", "list"] });
      onClose();
      navigate(`/invoices/${invoice.id}`);
    },
    onError: (error) => {
      const errors = fieldErrors(error);
      for (const [key, message] of Object.entries(errors)) {
        form.setError(key as keyof CreateInvoiceValues, { message });
      }
      toastError(error);
    },
  });

  const projectOptions = [
    { value: "NONE", label: "No project" },
    ...(projectsQuery.data ?? []).map((project) => ({
      value: project.id,
      label: `${project.projectNo} · ${project.name}`,
    })),
  ];

  const currency = watchedCurrency || "LKR";
  const itemError = form.formState.errors.items;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>
            Draft invoices carry no financial weight until issued. Totals below are a preview — the
            server recomputes them when the invoice is saved.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
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
              name="projectId"
              label="Project (optional)"
              placeholder="No project"
              disabled={projectsQuery.isLoading}
              options={projectOptions}
            />
            <TextField form={form} name="currency" label="Currency" required description="3-letter code, e.g. LKR" />
            <TextField form={form} name="taxRate" label="Tax rate (%)" type="number" min={0} step="0.01" />
            <TextField form={form} name="issueDate" label="Issue date" type="date" />
            <TextField
              form={form}
              name="dueDate"
              label="Due date (optional)"
              type="date"
              description="Defaults to the company payment terms when the invoice is issued."
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Line items
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ description: "", quantity: "1", unitPrice: "", discount: "0" })}
              >
                <Plus className="h-4 w-4" /> Add line
              </Button>
            </div>

            {itemError?.message ? <p className="text-xs font-medium text-destructive">{itemError.message}</p> : null}

            <div className="space-y-3">
              {fields.map((field, index) => {
                const lineErrors = itemError?.[index];
                return (
                  <div key={field.id} className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Label htmlFor={`line-${field.id}-description`} className="text-xs text-muted-foreground">
                          Description
                        </Label>
                        <Input
                          id={`line-${field.id}-description`}
                          placeholder="e.g. Discovery workshop"
                          {...form.register(`items.${index}.description`)}
                        />
                        {lineErrors?.description?.message ? (
                          <p className="text-xs text-destructive">{lineErrors.description.message}</p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-6 h-8 w-8"
                        disabled={fields.length === 1}
                        onClick={() => remove(index)}
                        aria-label="Remove line item"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`line-${field.id}-quantity`} className="text-xs text-muted-foreground">
                          Quantity
                        </Label>
                        <Input
                          id={`line-${field.id}-quantity`}
                          type="number"
                          min={0}
                          step="0.01"
                          {...form.register(`items.${index}.quantity`)}
                        />
                        {lineErrors?.quantity?.message ? (
                          <p className="text-xs text-destructive">{lineErrors.quantity.message}</p>
                        ) : null}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`line-${field.id}-unitPrice`} className="text-xs text-muted-foreground">
                          Unit price
                        </Label>
                        <Input
                          id={`line-${field.id}-unitPrice`}
                          type="number"
                          min={0}
                          step="0.01"
                          {...form.register(`items.${index}.unitPrice`)}
                        />
                        {lineErrors?.unitPrice?.message ? (
                          <p className="text-xs text-destructive">{lineErrors.unitPrice.message}</p>
                        ) : null}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`line-${field.id}-discount`} className="text-xs text-muted-foreground">
                          Discount
                        </Label>
                        <Input
                          id={`line-${field.id}-discount`}
                          type="number"
                          min={0}
                          step="0.01"
                          {...form.register(`items.${index}.discount`)}
                        />
                        {lineErrors?.discount?.message ? (
                          <p className="text-xs text-destructive">{lineErrors.discount.message}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextareaField form={form} name="notes" label="Notes (optional)" rows={3} placeholder="Shown on the invoice" />
              <TextareaField form={form} name="terms" label="Terms (optional)" rows={3} placeholder="Payment terms and conditions" />
            </div>

            <div className="space-y-1.5 rounded-xl border border-border bg-muted/25 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatMoney(totals.subtotal, currency)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Discount</span>
                <span>- {formatMoney(totals.discountTotal, currency)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Tax ({toNumber(watchedTaxRate)}%)</span>
                <span>{formatMoney(totals.taxTotal, currency)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
                <span>Total</span>
                <span>{formatMoney(totals.total, currency)}</span>
              </div>
              <p className="pt-1 text-[11px] text-muted-foreground">
                Preview only — the server recalculates every total when the invoice is saved.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create draft invoice"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- Page ----------------------------------- */

export default function InvoiceList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const list = useListParams({ status: "", overdue: "", clientId: "" });
  const invoices = useApiList<Invoice>(["invoices", "list", list.query], "/invoices", list.query);
  const clientsQuery = useApiQuery<Client[]>(["clients", "options"], "/clients", { limit: 200 });
  const [createOpen, setCreateOpen] = useState(false);

  const overdueActive = list.filters.overdue === "true";
  const activeChip = overdueActive ? "__overdue__" : (list.filters.status ?? "");
  const hasActiveFilters = Boolean(list.search) || Object.values(list.filters).some((value) => value !== "");

  const selectStatus = (value: string) => {
    list.setFilter("status", value);
    if (value) list.setFilter("overdue", "");
  };

  const toggleOverdue = () => {
    const next = overdueActive ? "" : "true";
    list.setFilter("overdue", next);
    if (next) list.setFilter("status", "");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Draft, issue and track client invoices. Issuing records revenue — money only counts once a payment is recorded against the invoice."
        actions={
          can("invoices.create") ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New invoice
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-4">
        <FilterBar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search invoice #..." />

          <div className="flex flex-wrap items-center gap-1">
            {STATUS_CHIPS.map((chip) => {
              const active = activeChip === chip.value;
              return (
                <Button
                  key={chip.value || "all"}
                  type="button"
                  size="sm"
                  variant={active ? "secondary" : "ghost"}
                  className={active ? "border border-border bg-muted/60 text-foreground" : "text-muted-foreground"}
                  onClick={() => selectStatus(chip.value)}
                >
                  {chip.label}
                </Button>
              );
            })}
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={toggleOverdue}
            className={
              overdueActive
                ? "border-danger/40 bg-danger/10 text-danger hover:bg-danger/15"
                : "text-muted-foreground"
            }
          >
            <Clock className="h-4 w-4" />
            Overdue only
          </Button>

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

        {invoices.isError ? (
          <ErrorState
            title="Invoices could not be loaded"
            description={invoices.error instanceof Error ? invoices.error.message : undefined}
            onRetry={() => invoices.refetch()}
          />
        ) : (
          <DataTable
            columns={invoiceColumns}
            data={invoices.data?.items ?? []}
            isLoading={invoices.isLoading}
            onRowClick={(invoice) => navigate(`/invoices/${invoice.id}`)}
            rowClassName={(invoice) =>
              isInvoiceOverdue(invoice) ? "bg-danger/10 hover:bg-danger/15" : undefined
            }
            emptyTitle="No invoices found"
            emptyDescription="Create your first invoice to start tracking billing, payments and balances."
            emptyAction={
              can("invoices.create") ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" /> New invoice
                </Button>
              ) : undefined
            }
          />
        )}

        <Pagination pagination={invoices.data?.pagination} onPageChange={list.setPage} />
      </div>

      {createOpen ? (
        <CreateInvoiceDialog clients={clientsQuery.data ?? []} onClose={() => setCreateOpen(false)} />
      ) : null}
    </div>
  );
}
