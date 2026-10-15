import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertTriangle,
  CheckCircle2,
  FolderKanban,
  Loader2,
  Pencil,
  Plus,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { useApiQuery } from "@/hooks/useApi";
import { errorMessage, fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import {
  clientDisplayName,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  isOverdue,
  toDateInput,
  toNumber,
} from "@/lib/format";
import { DetailHeader } from "@/components/common/DetailHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { InfoList, SectionCard } from "@/components/common/SectionCard";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorState, LoadingState } from "@/components/common/states";
import { FieldShell, TextField, TextareaField } from "@/components/common/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { Client, Project, Quotation } from "@/types";

/** `GET /quotations/:id` includes the full client, service and converted project. */
interface QuotationDetailRecord extends Omit<Quotation, "client"> {
  internalNotes: string | null;
  convertedProjectId: string | null;
  client?: Client;
  service?: { id: string; name: string } | null;
  orders?: Array<{ id: string; orderNo: string; status: string }>;
}

type ConfirmAction = "send" | "delete" | "accept" | "convert";

const CONFIRM_COPY: Record<ConfirmAction, { title: string; description: string; confirmLabel: string }> = {
  send: {
    title: "Send this quotation?",
    description: "The quotation is emailed to the client and its status changes to Sent.",
    confirmLabel: "Send quotation",
  },
  delete: {
    title: "Delete this draft?",
    description: "The draft quotation and all of its line items are permanently removed.",
    confirmLabel: "Delete",
  },
  accept: {
    title: "Accept this quotation?",
    description: "Mark the quotation as accepted by the client.",
    confirmLabel: "Accept",
  },
  convert: {
    title: "Convert to a project?",
    description: "A project is created from this quotation, a kick-off milestone is seeded and the quotation becomes accepted.",
    confirmLabel: "Convert",
  },
};

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

function rowsFromItems(items: QuotationDetailRecord["items"]): ItemRow[] {
  const source = items ?? [];
  if (source.length === 0) return [blankRow()];
  return source.map((item) => ({
    key: item.id ?? nextRowKey(),
    description: item.description,
    quantity: String(toNumber(item.quantity)),
    unitPrice: String(toNumber(item.unitPrice)),
    discount: String(toNumber(item.discount)),
  }));
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

function ItemField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

/* ------------------------------- Edit dialog ------------------------------- */

function EditQuotationDialog({
  quotation,
  onClose,
}: {
  quotation: QuotationDetailRecord;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<QuotationValues>({
    resolver: zodResolver(quotationSchema),
    defaultValues: {
      clientId: quotation.clientId,
      title: quotation.title,
      currency: quotation.currency,
      taxRate: String(toNumber(quotation.taxRate)),
      validUntil: toDateInput(quotation.validUntil),
      terms: quotation.terms ?? "",
      clientNotes: quotation.clientNotes ?? "",
      internalNotes: quotation.internalNotes ?? "",
    },
  });

  const [rows, setRows] = useState<ItemRow[]>(() => rowsFromItems(quotation.items));
  const [rowErrors, setRowErrors] = useState<Record<number, ItemRowErrors>>({});

  const taxRate = useWatch({ control: form.control, name: "taxRate" });
  const currency = useWatch({ control: form.control, name: "currency" });
  const totals = useMemo(() => computeTotals(rows, taxRate), [rows, taxRate]);
  const currencyCode = (currency || "LKR").toUpperCase();

  const mutation = useMutation({
    mutationFn: (body: QuotationPayload) =>
      api.patch<QuotationDetailRecord>(`/quotations/${quotation.id}`, body),
    onSuccess: () => {
      toastSuccess("Quotation updated", "The draft quotation was saved.");
      queryClient.invalidateQueries({ queryKey: ["quotations"] });
      onClose();
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
            <DialogTitle>Edit quotation {quotation.quotationNo}</DialogTitle>
            <DialogDescription>
              Only draft quotations can be edited. Saving replaces every line item with the rows below.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FieldShell
                label="Client"
                htmlFor="edit-client-id"
                description="The client cannot be changed once a quotation exists."
              >
                <Input
                  id="edit-client-id"
                  value={clientDisplayName(quotation.client)}
                  readOnly
                  disabled
                />
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
              className="sm:col-span-2"
            />
            <TextareaField
              form={form}
              name="terms"
              label="Terms & conditions"
              rows={3}
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
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- Page ----------------------------------- */

export default function QuotationDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const query = useApiQuery<QuotationDetailRecord>(
    qk.detail("quotations", id),
    `/quotations/${id}`,
    undefined,
    { enabled: id !== "" },
  );

  const quotation = query.data;

  const sendMutation = useMutation({
    mutationFn: () => api.post<QuotationDetailRecord>(`/quotations/${id}/send`),
    onSuccess: (sent) => {
      toastSuccess("Quotation sent", `${sent.quotationNo} was emailed to ${clientDisplayName(sent.client)}.`);
      setConfirm(null);
      queryClient.invalidateQueries({ queryKey: ["quotations"] });
    },
    onError: (error) => toastError(error),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.del<void>(`/quotations/${id}`),
    onSuccess: () => {
      toastSuccess("Quotation deleted", "The draft was removed.");
      queryClient.invalidateQueries({ queryKey: ["quotations"] });
      navigate("/quotations");
    },
    onError: (error) => toastError(error),
  });

  const respondMutation = useMutation({
    mutationFn: (vars: { decision: "ACCEPTED" | "REJECTED"; reason?: string }) =>
      api.post<QuotationDetailRecord>(`/quotations/${id}/respond`, {
        decision: vars.decision,
        ...(vars.reason ? { reason: vars.reason } : {}),
      }),
    onSuccess: (_result, vars) => {
      toastSuccess(vars.decision === "ACCEPTED" ? "Quotation accepted" : "Quotation rejected");
      setConfirm(null);
      setRejectOpen(false);
      setRejectReason("");
      queryClient.invalidateQueries({ queryKey: ["quotations"] });
    },
    onError: (error) => toastError(error),
  });

  const convertMutation = useMutation({
    mutationFn: () => api.post<Project>(`/quotations/${id}/convert`),
    onSuccess: (project) => {
      toastSuccess("Converted to project", `${project.projectNo} was created from this quotation.`);
      queryClient.invalidateQueries({ queryKey: ["quotations"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${project.id}`);
    },
    onError: (error) => toastError(error),
  });

  if (!id) {
    return <ErrorState title="Quotation not found" description="This link does not contain a quotation id." />;
  }

  if (query.isLoading) return <LoadingState label="Loading quotation..." />;

  if (query.isError || !quotation) {
    return (
      <ErrorState
        title="Quotation could not be loaded"
        description={errorMessage(query.error)}
        onRetry={() => query.refetch()}
      />
    );
  }

  const items = quotation.items ?? [];
  const isDraft = quotation.status === "DRAFT";
  const canRespond = can("quotations.update") && ["DRAFT", "SENT"].includes(quotation.status);
  const canConvert =
    can("quotations.convert") &&
    !quotation.convertedProjectId &&
    ["SENT", "ACCEPTED"].includes(quotation.status);
  const expiringSoon =
    Boolean(quotation.validUntil) && isOverdue(quotation.validUntil) && ["DRAFT", "SENT"].includes(quotation.status);

  const confirmCopy = CONFIRM_COPY[confirm ?? "send"];
  const busy =
    sendMutation.isPending ||
    deleteMutation.isPending ||
    respondMutation.isPending ||
    convertMutation.isPending;

  return (
    <div className="space-y-6">
      <DetailHeader
        backTo="/quotations"
        backLabel="Quotations"
        title={quotation.quotationNo}
        subtitle={
          <span>
            {quotation.title} · {clientDisplayName(quotation.client)}
          </span>
        }
        badge={<StatusBadge status={quotation.status} />}
        actions={
          <>
            {isDraft && can("quotations.update") ? (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            ) : null}
            {isDraft && can("quotations.send") ? (
              <Button variant="outline" size="sm" onClick={() => setConfirm("send")}>
                <Send className="h-4 w-4" />
                Send
              </Button>
            ) : null}
            {canRespond ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setConfirm("accept")}>
                  <CheckCircle2 className="h-4 w-4" />
                  Accept
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRejectOpen(true)}>
                  <XCircle className="h-4 w-4" />
                  Reject
                </Button>
              </>
            ) : null}
            {canConvert ? (
              <Button size="sm" onClick={() => setConfirm("convert")}>
                <FolderKanban className="h-4 w-4" />
                Convert to project
              </Button>
            ) : null}
            {isDraft && can("quotations.delete") ? (
              <Button variant="destructive" size="sm" onClick={() => setConfirm("delete")}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            ) : null}
          </>
        }
      />

      {quotation.rejectionReason ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Rejected by the client</AlertTitle>
          <AlertDescription>{quotation.rejectionReason}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <SectionCard
            title="Line items"
            description={`${items.length} item${items.length === 1 ? "" : "s"} · totals in ${quotation.currency}`}
            empty={items.length === 0}
            emptyTitle="No line items"
            emptyDescription="This quotation has no lines yet."
          >
            <div className="overflow-hidden rounded-xl border border-white/10">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => {
                    const computed = Math.max(
                      0,
                      toNumber(item.quantity) * toNumber(item.unitPrice) - toNumber(item.discount),
                    );
                    return (
                      <TableRow key={item.id ?? `line-${index}`} className="hover:bg-transparent">
                        <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="whitespace-pre-wrap">{item.description}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatNumber(toNumber(item.quantity), 2)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(item.unitPrice, quotation.currency)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatMoney(item.discount, quotation.currency)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoney(item.lineTotal ?? computed, quotation.currency)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <dl className="mt-4 w-full space-y-1.5 text-sm sm:ml-auto sm:w-80">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd>{formatMoney(quotation.subtotal, quotation.currency)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Discount</dt>
                <dd>- {formatMoney(quotation.discountTotal, quotation.currency)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Tax ({toNumber(quotation.taxRate)}%)</dt>
                <dd>{formatMoney(quotation.taxTotal, quotation.currency)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-1.5 font-semibold">
                <dt>Total</dt>
                <dd>{formatMoney(quotation.total, quotation.currency)}</dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard
            title="Terms & conditions"
            empty={!quotation.terms}
            emptyTitle="No terms"
            emptyDescription="No terms were added to this quotation."
          >
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{quotation.terms}</p>
          </SectionCard>

          <SectionCard
            title="Notes"
            empty={!quotation.clientNotes && !quotation.internalNotes}
            emptyTitle="No notes"
            emptyDescription="Nothing was recorded for this quotation."
          >
            <div className="space-y-4">
              {quotation.clientNotes ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Client notes
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{quotation.clientNotes}</p>
                </div>
              ) : null}
              {quotation.internalNotes ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Internal notes
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{quotation.internalNotes}</p>
                </div>
              ) : null}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Overview">
            <InfoList
              columns={1}
              items={[
                {
                  label: "Client",
                  value: (
                    <div className="space-y-0.5">
                      <p>{clientDisplayName(quotation.client)}</p>
                      {quotation.client?.email ? (
                        <p className="text-xs text-muted-foreground">{quotation.client.email}</p>
                      ) : null}
                    </div>
                  ),
                },
                { label: "Status", value: <StatusBadge status={quotation.status} /> },
                { label: "Currency", value: quotation.currency },
                { label: "Service", value: quotation.service?.name ?? "-" },
                {
                  label: "Valid until",
                  value: (
                    <span className={expiringSoon ? "font-medium text-rose-300" : undefined}>
                      {formatDate(quotation.validUntil)}
                      {expiringSoon ? <span className="ml-1.5 text-[10px] uppercase tracking-wide">expired</span> : null}
                    </span>
                  ),
                },
                {
                  label: "Converted project",
                  value: quotation.convertedProjectId ? (
                    <Link to={`/projects/${quotation.convertedProjectId}`} className="text-primary hover:underline">
                      Open project
                    </Link>
                  ) : (
                    "-"
                  ),
                },
              ]}
            />
          </SectionCard>

          <SectionCard title="Timeline">
            <InfoList
              columns={1}
              items={[
                { label: "Created", value: formatDateTime(quotation.createdAt) },
                { label: "Last updated", value: formatDateTime(quotation.updatedAt) },
                { label: "Sent", value: quotation.sentAt ? formatDateTime(quotation.sentAt) : "Not sent yet" },
                {
                  label: "Decided",
                  value: quotation.decidedAt ? formatDateTime(quotation.decidedAt) : "No decision yet",
                },
              ]}
            />
          </SectionCard>

          <SectionCard
            title="Orders"
            description="Purchase orders raised from this quotation."
            empty={!quotation.orders || quotation.orders.length === 0}
            emptyTitle="No orders"
            emptyDescription="No delivery orders are linked to this quotation."
          >
            <ul className="space-y-2">
              {(quotation.orders ?? []).map((order) => (
                <li
                  key={order.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
                >
                  <span className="font-mono text-xs">{order.orderNo}</span>
                  <StatusBadge status={order.status} />
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>

      {editOpen ? (
        <EditQuotationDialog
          quotation={quotation}
          onClose={() => setEditOpen(false)}
        />
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
        destructive={confirm === "delete"}
        loading={busy}
        onConfirm={() => {
          if (confirm === "send") sendMutation.mutate();
          else if (confirm === "delete") deleteMutation.mutate();
          else if (confirm === "accept") respondMutation.mutate({ decision: "ACCEPTED" });
          else if (confirm === "convert") convertMutation.mutate();
        }}
      />

      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          if (!open) {
            setRejectOpen(false);
            setRejectReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject quotation {quotation.quotationNo}</DialogTitle>
            <DialogDescription>
              Record why the quotation was rejected. The reason stays visible to staff.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <Textarea
              id="reject-reason"
              rows={4}
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Budget, timeline, scope..."
              maxLength={1000}
            />
            <p className="text-xs text-muted-foreground">Up to 1000 characters.</p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={respondMutation.isPending}
              onClick={() => {
                setRejectOpen(false);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={respondMutation.isPending}
              onClick={() =>
                respondMutation.mutate({ decision: "REJECTED", reason: rejectReason.trim() || undefined })
              }
            >
              {respondMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Reject quotation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
