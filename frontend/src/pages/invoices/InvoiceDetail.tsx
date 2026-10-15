import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Ban, CreditCard, Download, Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { api, downloadBlob } from "@/lib/api";
import { queryClient, qk } from "@/lib/queryClient";
import { useApiQuery } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import {
  clientDisplayName,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  humanize,
  toDateInput,
  toNumber,
} from "@/lib/format";
import { OPTIONS } from "@/lib/status";
import { currencyValue } from "@/lib/validation";
import { StatusBadge } from "@/components/common/StatusBadge";
import { DetailHeader } from "@/components/common/DetailHeader";
import { InfoList, SectionCard } from "@/components/common/SectionCard";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorState, LoadingState } from "@/components/common/states";
import { SelectField, TextField, TextareaField } from "@/components/common/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Invoice, Payment, Project } from "@/types";

/* ------------------------------- Shared bits ------------------------------- */

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

function MoneyRow({
  label,
  value,
  tone = "",
  bold,
}: {
  label: string;
  value: string;
  tone?: string;
  bold?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 text-sm", bold && "font-semibold")}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right", tone)}>{value}</span>
    </div>
  );
}

/** Dialog that collects a mandatory reason (used by void actions). */
function ReasonDialog({
  title,
  description,
  confirmLabel,
  loading,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="void-reason">Reason</Label>
          <Textarea
            id="void-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this being voided?"
          />
          <p className="text-xs text-muted-foreground">At least 3 characters. Stored for auditing.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!valid || loading} onClick={() => onConfirm(reason.trim())}>
            {loading ? "Working..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Issue dialog ------------------------------ */

function IssueDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const [sendEmail, setSendEmail] = useState(true);

  const mutation = useMutation({
    mutationFn: () => api.post<Invoice>(`/invoices/${invoice.id}/issue`, { sendEmail }),
    onSuccess: () => {
      toastSuccess(
        "Invoice issued",
        `${invoice.invoiceNo} is now issued. It stays unpaid until payments are recorded against it.`,
      );
      queryClient.invalidateQueries({ queryKey: qk.detail("invoices", invoice.id) });
      queryClient.invalidateQueries({ queryKey: ["invoices", "list"] });
      onClose();
    },
    onError: (error) => toastError(error),
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Issue {invoice.invoiceNo}</DialogTitle>
          <DialogDescription>
            Issuing stamps the issue date and makes the invoice billable. It never marks the invoice
            paid — status only changes to paid when confirmed payments settle the balance.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Email a copy to the client</p>
            <p className="text-xs text-muted-foreground">
              {invoice.client?.email ? `Sent to ${invoice.client.email}` : "Uses the client's email on file"}
            </p>
          </div>
          <Switch checked={sendEmail} onCheckedChange={setSendEmail} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Issuing..." : "Issue invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- Edit dialog ------------------------------ */

const editInvoiceSchema = z.object({
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

type EditInvoiceValues = z.infer<typeof editInvoiceSchema>;

function editInvoiceDefaults(invoice: Invoice): EditInvoiceValues {
  const lines = (invoice.items ?? []).map((item) => ({
    description: item.description,
    quantity: String(item.quantity),
    unitPrice: String(item.unitPrice),
    discount: String(item.discount ?? 0),
  }));
  return {
    projectId: invoice.projectId ?? "",
    currency: invoice.currency || "LKR",
    issueDate: toDateInput(invoice.issueDate),
    dueDate: toDateInput(invoice.dueDate),
    taxRate: String(toNumber(invoice.taxRate)),
    notes: invoice.notes ?? "",
    terms: invoice.terms ?? "",
    items: lines.length > 0 ? lines : [{ description: "", quantity: "1", unitPrice: "", discount: "0" }],
  };
}

function InvoiceEditDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const form = useForm<EditInvoiceValues>({
    resolver: zodResolver(editInvoiceSchema),
    defaultValues: editInvoiceDefaults(invoice),
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const watchedItems = useWatch({ control: form.control, name: "items" });
  const watchedTaxRate = useWatch({ control: form.control, name: "taxRate" });
  const watchedCurrency = useWatch({ control: form.control, name: "currency" });

  const projectsQuery = useQuery({
    queryKey: ["projects", "options", invoice.clientId],
    queryFn: async () => {
      const { data } = await api.getWithMeta<Project[]>("/projects", {
        clientId: invoice.clientId,
        limit: 200,
      });
      return data;
    },
  });

  const totals = useMemo(
    () => computePreviewTotals(watchedItems ?? [], watchedTaxRate ?? "0"),
    [watchedItems, watchedTaxRate],
  );

  const mutation = useMutation({
    mutationFn: (values: EditInvoiceValues) =>
      api.patch<Invoice>(`/invoices/${invoice.id}`, {
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
    onSuccess: () => {
      toastSuccess("Invoice updated", `${invoice.invoiceNo} was re-saved as a draft with fresh totals.`);
      queryClient.invalidateQueries({ queryKey: qk.detail("invoices", invoice.id) });
      queryClient.invalidateQueries({ queryKey: ["invoices", "list"] });
      onClose();
    },
    onError: (error) => {
      const errors = fieldErrors(error);
      for (const [key, message] of Object.entries(errors)) {
        form.setError(key as keyof EditInvoiceValues, { message });
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

  const currency = watchedCurrency || invoice.currency || "LKR";
  const itemError = form.formState.errors.items;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {invoice.invoiceNo}</DialogTitle>
          <DialogDescription>
            Only draft invoices can be edited. Totals below are a preview — the server recomputes them
            when the invoice is saved.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <div className="grid gap-4 sm:grid-cols-2">
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
            <TextField form={form} name="dueDate" label="Due date (optional)" type="date" />
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
                  <div key={field.id} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Label htmlFor={`edit-line-${field.id}-description`} className="text-xs text-muted-foreground">
                          Description
                        </Label>
                        <Input
                          id={`edit-line-${field.id}-description`}
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
                        <Label htmlFor={`edit-line-${field.id}-quantity`} className="text-xs text-muted-foreground">
                          Quantity
                        </Label>
                        <Input
                          id={`edit-line-${field.id}-quantity`}
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
                        <Label htmlFor={`edit-line-${field.id}-unitPrice`} className="text-xs text-muted-foreground">
                          Unit price
                        </Label>
                        <Input
                          id={`edit-line-${field.id}-unitPrice`}
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
                        <Label htmlFor={`edit-line-${field.id}-discount`} className="text-xs text-muted-foreground">
                          Discount
                        </Label>
                        <Input
                          id={`edit-line-${field.id}-discount`}
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

          <div className="grid gap-4 sm:grid-cols-2">
            <TextareaField form={form} name="notes" label="Notes (optional)" rows={3} />
            <TextareaField form={form} name="terms" label="Terms (optional)" rows={3} />
          </div>

          <div className="space-y-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
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
            <div className="flex items-center justify-between border-t border-white/10 pt-2 text-sm font-semibold">
              <span>Total</span>
              <span>{formatMoney(totals.total, currency)}</span>
            </div>
            <p className="pt-1 text-[11px] text-muted-foreground">
              Preview only — the server recalculates every total when the invoice is saved.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Record payment dialog ------------------------ */

const recordPaymentSchema = z.object({
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Amount must be greater than zero"),
  paidAt: z.string(),
  method: z.string().min(1, "Select a payment method"),
  reference: z.string(),
  notes: z.string(),
});

type RecordPaymentValues = z.infer<typeof recordPaymentSchema>;

function RecordPaymentDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const form = useForm<RecordPaymentValues>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: {
      amount: String(invoice.balance ?? "0"),
      paidAt: toDateInput(new Date()),
      method: "BANK_TRANSFER",
      reference: "",
      notes: "",
    },
  });

  const mutation = useMutation({
    mutationFn: (values: RecordPaymentValues) =>
      api.post<Payment>("/payments", {
        invoiceId: invoice.id,
        amount: values.amount,
        method: values.method,
        reference: values.reference.trim() || null,
        paidAt: values.paidAt || undefined,
        notes: values.notes.trim() || null,
      }),
    onSuccess: () => {
      toastSuccess(
        "Payment recorded",
        "The invoice balance and status were recalculated from confirmed payments.",
      );
      queryClient.invalidateQueries({ queryKey: qk.detail("invoices", invoice.id) });
      queryClient.invalidateQueries({ queryKey: ["invoices", "list"] });
      queryClient.invalidateQueries({ queryKey: ["payments", "list"] });
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

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record payment for {invoice.invoiceNo}</DialogTitle>
          <DialogDescription>
            Records money received against this invoice in {invoice.currency}. Balance and status update
            from confirmed payments only.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              form={form}
              name="amount"
              label={`Amount (${invoice.currency})`}
              type="number"
              min={0}
              step="0.01"
              required
              description={`Outstanding balance: ${formatMoney(invoice.balance, invoice.currency)}`}
            />
            <TextField form={form} name="paidAt" label="Paid on" type="date" />
            <SelectField form={form} name="method" label="Method" options={methodOptions} required />
            <TextField form={form} name="reference" label="Reference (optional)" placeholder="Bank ref / txn id" />
          </div>
          <TextareaField form={form} name="notes" label="Notes (optional)" rows={3} />

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

/* --------------------------------- Page ----------------------------------- */

export default function InvoiceDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const { can } = useAuth();

  const invoiceQuery = useApiQuery<Invoice>(qk.detail("invoices", id), `/invoices/${id}`, undefined, {
    enabled: Boolean(id),
  });

  const [editOpen, setEditOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const [voidInvoiceOpen, setVoidInvoiceOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [voidPaymentTarget, setVoidPaymentTarget] = useState<Payment | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const refreshInvoice = () => {
    queryClient.invalidateQueries({ queryKey: qk.detail("invoices", id) });
    queryClient.invalidateQueries({ queryKey: ["invoices", "list"] });
    queryClient.invalidateQueries({ queryKey: ["payments", "list"] });
  };

  const remindMutation = useMutation({
    mutationFn: () => api.post<Invoice>(`/invoices/${id}/remind`),
    onSuccess: () => {
      toastSuccess(
        "Reminder sent",
        "A payment reminder email was sent. The invoice status does not change until a payment is recorded.",
      );
      refreshInvoice();
      setRemindOpen(false);
    },
    onError: (error) => toastError(error),
  });

  const voidInvoiceMutation = useMutation({
    mutationFn: (reason: string) => api.post<Invoice>(`/invoices/${id}/void`, { reason }),
    onSuccess: () => {
      toastSuccess("Invoice voided", "The invoice was marked void. No money was moved.");
      refreshInvoice();
      setVoidInvoiceOpen(false);
    },
    onError: (error) => toastError(error),
  });

  const voidPaymentMutation = useMutation({
    mutationFn: (vars: { paymentId: string; reason: string }) =>
      api.post<Payment>(`/payments/${vars.paymentId}/void`, { reason: vars.reason }),
    onSuccess: () => {
      toastSuccess("Payment voided", "The invoice totals were recalculated from remaining confirmed payments.");
      refreshInvoice();
      setVoidPaymentTarget(null);
    },
    onError: (error) => toastError(error),
  });

  if (invoiceQuery.isLoading) return <LoadingState label="Loading invoice..." />;
  if (invoiceQuery.isError || !invoiceQuery.data) {
    return (
      <div className="space-y-6">
        <DetailHeader backTo="/invoices" backLabel="Invoices" title="Invoice" />
        <ErrorState
          title="Invoice could not be loaded"
          description={invoiceQuery.error instanceof Error ? invoiceQuery.error.message : undefined}
          onRetry={() => invoiceQuery.refetch()}
        />
      </div>
    );
  }

  const invoice = invoiceQuery.data;
  const currency = invoice.currency;
  const items = invoice.items ?? [];
  const payments = invoice.payments ?? [];
  const refunds = invoice.refunds ?? [];
  const balance = toNumber(invoice.balance);
  const outstanding = balance > 0 && !["VOID", "DRAFT"].includes(invoice.status);

  const canEdit = can("invoices.update") && invoice.status === "DRAFT";
  const canIssue = can("invoices.issue") && invoice.status === "DRAFT";
  const canRemind = can("invoices.issue") && !["DRAFT", "PAID", "VOID"].includes(invoice.status);
  const canVoid = can("invoices.void") && (invoice.status === "DRAFT" || invoice.status === "ISSUED");
  const canRecord =
    can("payments.record") && ["ISSUED", "PARTIALLY_PAID", "OVERDUE", "REFUNDED"].includes(invoice.status);

  const downloadPdf = async () => {
    setPdfLoading(true);
    try {
      const blob = await api.blob(`/invoices/${id}/pdf`);
      downloadBlob(blob, `${invoice.invoiceNo}.pdf`);
    } catch (error) {
      toastError(error, "The invoice PDF could not be downloaded.");
    } finally {
      setPdfLoading(false);
    }
  };

  const detailItems = [
    {
      label: "Client",
      value: (
        <div className="space-y-0.5">
          <p className="font-medium">{clientDisplayName(invoice.client)}</p>
          {invoice.client?.email ? <p className="text-xs text-muted-foreground">{invoice.client.email}</p> : null}
        </div>
      ),
    },
    {
      label: "Project",
      value: invoice.project ? `${invoice.project.name} (${invoice.project.projectNo})` : "-",
    },
    { label: "Issue date", value: formatDate(invoice.issueDate) },
    { label: "Due date", value: formatDate(invoice.dueDate) },
    { label: "Currency", value: invoice.currency },
    {
      label: "Reminders sent",
      value: `${invoice.reminderCount}${invoice.lastReminderAt ? ` · last ${formatDate(invoice.lastReminderAt)}` : ""}`,
    },
    ...(invoice.sentAt ? [{ label: "Sent at", value: formatDateTime(invoice.sentAt) }] : []),
    ...(invoice.status === "PAID" && invoice.paidAt
      ? [{ label: "Paid on", value: formatDate(invoice.paidAt) }]
      : []),
    ...(invoice.status === "VOID"
      ? [{ label: "Void reason", value: invoice.voidReason ?? "-", full: true as const }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <DetailHeader
        backTo="/invoices"
        backLabel="Invoices"
        title={invoice.invoiceNo}
        badge={<StatusBadge status={invoice.status} />}
        subtitle={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-foreground">{clientDisplayName(invoice.client)}</span>
            {invoice.project ? <span>· {invoice.project.name}</span> : null}
            <span>· Issued {formatDate(invoice.issueDate)}</span>
            <span>· Due {formatDate(invoice.dueDate)}</span>
          </div>
        }
        actions={
          <>
            {canRecord ? (
              <Button size="sm" onClick={() => setPaymentOpen(true)}>
                <CreditCard className="h-4 w-4" /> Record payment
              </Button>
            ) : null}
            {canIssue ? (
              <Button size="sm" variant="glass" onClick={() => setIssueOpen(true)}>
                <Send className="h-4 w-4" /> Issue invoice
              </Button>
            ) : null}
            {canEdit ? (
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            ) : null}
            {canRemind ? (
              <Button size="sm" variant="outline" onClick={() => setRemindOpen(true)}>
                <Send className="h-4 w-4" /> Send reminder
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={downloadPdf} disabled={pdfLoading}>
              {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download PDF
            </Button>
            {canVoid ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10"
                onClick={() => setVoidInvoiceOpen(true)}
              >
                <Ban className="h-4 w-4" /> Void
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard
            title="Line items"
            description={`${items.length} line${items.length === 1 ? "" : "s"} · ${currency}`}
            empty={items.length === 0}
            emptyTitle="No line items"
            emptyDescription="This invoice has no lines to show."
          >
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id ?? item.description}>
                      <TableCell className="text-sm">{item.description}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatNumber(toNumber(item.quantity), 2)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatMoney(item.unitPrice, currency)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatMoney(item.discount ?? 0, currency)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatMoney(item.lineTotal ?? toNumber(item.quantity) * toNumber(item.unitPrice), currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>

          <SectionCard
            title="Payments"
            description="Confirmed payments recorded against this invoice. Voided payments are excluded."
            empty={payments.length === 0}
            emptyTitle="No payments yet"
            emptyDescription="Record a payment when money is received — the balance only changes from confirmed payments."
          >
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Payment #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="font-mono text-xs">{payment.paymentNo}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(payment.paidAt)}
                      </TableCell>
                      <TableCell className="text-sm">{humanize(payment.method)}</TableCell>
                      <TableCell className="max-w-[160px] truncate text-sm text-muted-foreground">
                        {payment.reference || "-"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatMoney(payment.amount, payment.currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        {can("payments.void") ? (
                          <Button size="sm" variant="ghost" onClick={() => setVoidPaymentTarget(payment)}>
                            Void
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>

          <SectionCard
            title="Refunds & credit notes"
            description="Money returned to the client or applied as credit against this invoice."
            empty={refunds.length === 0}
            emptyTitle="No refunds or credit notes"
            emptyDescription="Nothing has been refunded against this invoice."
          >
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Refund #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {refunds.map((refund) => (
                    <TableRow key={refund.id}>
                      <TableCell className="font-mono text-xs">{refund.refundNo}</TableCell>
                      <TableCell>
                        {/* The API returns `kind` on refunds; the shared type predates the field. */}
                        <StatusBadge status={(refund as unknown as { kind?: string }).kind ?? "REFUND"} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(refund.refundedAt || refund.createdAt)}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                        {refund.reason || "-"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatMoney(refund.amount, refund.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Totals">
            <div className="space-y-2.5">
              <MoneyRow label="Subtotal" value={formatMoney(invoice.subtotal, currency)} />
              <MoneyRow label="Discount" value={`- ${formatMoney(invoice.discountTotal, currency)}`} />
              <MoneyRow label={`Tax (${toNumber(invoice.taxRate)}%)`} value={formatMoney(invoice.taxTotal, currency)} />
              <Separator className="bg-white/10" />
              <MoneyRow label="Total" value={formatMoney(invoice.total, currency)} bold />
              <MoneyRow
                label="Amount paid"
                value={formatMoney(invoice.amountPaid, currency)}
                tone={toNumber(invoice.amountPaid) > 0 ? "text-emerald-300" : ""}
              />
              <MoneyRow
                label="Balance"
                value={formatMoney(invoice.balance, currency)}
                tone={outstanding ? "text-rose-300" : "text-muted-foreground"}
                bold={outstanding}
              />
            </div>
          </SectionCard>

          <SectionCard title="Details">
            <InfoList items={detailItems} columns={1} />
          </SectionCard>

          <SectionCard
            title="Notes & terms"
            empty={!invoice.notes && !invoice.terms}
            emptyTitle="No notes or terms"
            emptyDescription="Add notes and payment terms when creating or editing the invoice."
          >
            <div className="space-y-4">
              {invoice.notes ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{invoice.notes}</p>
                </div>
              ) : null}
              {invoice.terms ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Terms</p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{invoice.terms}</p>
                </div>
              ) : null}
            </div>
          </SectionCard>
        </div>
      </div>

      {editOpen ? <InvoiceEditDialog invoice={invoice} onClose={() => setEditOpen(false)} /> : null}
      {issueOpen ? <IssueDialog invoice={invoice} onClose={() => setIssueOpen(false)} /> : null}
      {paymentOpen ? <RecordPaymentDialog invoice={invoice} onClose={() => setPaymentOpen(false)} /> : null}
      {remindOpen ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setRemindOpen(false); }}
          title="Send payment reminder"
          description={`Emails ${clientDisplayName(invoice.client)} a reminder about the outstanding ${formatMoney(
            invoice.balance,
            currency,
          )} on ${invoice.invoiceNo}. This does not record a payment or change the invoice status.`}
          confirmLabel="Send reminder"
          loading={remindMutation.isPending}
          onConfirm={() => remindMutation.mutate()}
        />
      ) : null}
      {voidInvoiceOpen ? (
        <ReasonDialog
          title={`Void ${invoice.invoiceNo}`}
          description="The invoice is marked VOID and its balance is set to zero. No money moves — record a refund separately if money was already returned."
          confirmLabel="Void invoice"
          loading={voidInvoiceMutation.isPending}
          onConfirm={(reason) => voidInvoiceMutation.mutate(reason)}
          onClose={() => setVoidInvoiceOpen(false)}
        />
      ) : null}
      {voidPaymentTarget ? (
        <ReasonDialog
          title={`Void payment ${voidPaymentTarget.paymentNo}`}
          description="The payment stops counting towards this invoice and the totals are recalculated from the remaining confirmed payments."
          confirmLabel="Void payment"
          loading={voidPaymentMutation.isPending}
          onConfirm={(reason) =>
            voidPaymentMutation.mutate({ paymentId: voidPaymentTarget.id, reason })
          }
          onClose={() => setVoidPaymentTarget(null)}
        />
      ) : null}
    </div>
  );
}
