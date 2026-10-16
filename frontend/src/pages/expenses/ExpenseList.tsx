import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Banknote, CheckCircle2, MoreHorizontal, Pencil, Plus, RotateCcw, Tags, Trash2, XCircle } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useApiList, useApiQuery } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { formatDate, formatMoney, humanize, toDateInput } from "@/lib/format";
import { OPTIONS } from "@/lib/status";
import { currencyValue } from "@/lib/validation";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/states";
import { SelectField, TextField, TextareaField } from "@/components/common/form";
import { Button } from "@/components/ui/button";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Expense, ExpenseCategory, Project } from "@/types";

/* ------------------------------ Expense dialog ---------------------------- */

const expenseSchema = z.object({
  categoryId: z.string().min(1, "Select a category"),
  projectId: z.string(),
  vendor: z.string(),
  description: z.string().min(1, "Description is required"),
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Amount must be greater than zero"),
  taxAmount: z
    .string()
    .refine(
      (value) => value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "Enter a valid tax amount",
    ),
  currency: currencyValue,
  expenseDate: z.string().min(1, "Date is required"),
  method: z.string().min(1, "Select a payment method"),
  notes: z.string(),
});

type ExpenseValues = z.infer<typeof expenseSchema>;

function expenseDefaults(expense: Expense | null): ExpenseValues {
  return {
    categoryId: expense?.categoryId ?? "",
    projectId: expense?.projectId ?? "",
    vendor: expense?.vendor ?? "",
    description: expense?.description ?? "",
    amount: expense ? String(expense.amount) : "",
    taxAmount: expense ? String(expense.taxAmount) : "0",
    currency: expense?.currency || "LKR",
    expenseDate: toDateInput(expense ? expense.expenseDate : new Date()),
    method: expense?.method ?? "BANK_TRANSFER",
    notes: expense?.notes ?? "",
  };
}

function ExpenseDialog({
  expense,
  categories,
  projects,
  onClose,
}: {
  expense: Expense | null;
  categories: ExpenseCategory[];
  projects: Project[];
  onClose: () => void;
}) {
  const form = useForm<ExpenseValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: expenseDefaults(expense),
  });

  const mutation = useMutation({
    mutationFn: (values: ExpenseValues) => {
      const payload = {
        categoryId: values.categoryId,
        projectId: values.projectId && values.projectId !== "NONE" ? values.projectId : null,
        vendor: values.vendor.trim() || null,
        description: values.description.trim(),
        amount: values.amount,
        taxAmount: values.taxAmount.trim() || "0",
        currency: values.currency,
        expenseDate: values.expenseDate,
        method: values.method,
        notes: values.notes.trim() || null,
      };
      return expense
        ? api.patch<Expense>(`/expenses/${expense.id}`, payload)
        : api.post<Expense>("/expenses", payload);
    },
    onSuccess: () => {
      toastSuccess(expense ? "Expense updated" : "Expense recorded");
      queryClient.invalidateQueries({ queryKey: ["expenses", "list"] });
      onClose();
    },
    onError: (error) => {
      const errors = fieldErrors(error);
      for (const [key, message] of Object.entries(errors)) {
        form.setError(key as keyof ExpenseValues, { message });
      }
      toastError(error);
    },
  });

  const methodOptions = OPTIONS.paymentMethod.map((method) => ({ value: method, label: humanize(method) }));
  const projectOptions = [
    { value: "NONE", label: "No project" },
    ...projects.map((project) => ({ value: project.id, label: `${project.projectNo} · ${project.name}` })),
  ];
  const categoryOptions = categories.map((category) => ({ value: category.id, label: category.name }));

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{expense ? `Edit ${expense.expenseNo}` : "New expense"}</DialogTitle>
          <DialogDescription>
            {expense
              ? "Update the expense record. Status changes happen through the approve, reject and pay actions."
              : "Record a business expense. It lands as pending until an approver clears it."}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              form={form}
              name="categoryId"
              label="Category"
              required
              placeholder={categories.length === 0 ? "No categories available" : "Select a category"}
              disabled={categories.length === 0}
              options={categoryOptions}
            />
            <SelectField form={form} name="projectId" label="Project (optional)" placeholder="No project" options={projectOptions} />
            <TextField form={form} name="description" label="Description" required placeholder="What was bought?" />
            <TextField form={form} name="vendor" label="Vendor (optional)" placeholder="Supplier / payee" />
            <TextField form={form} name="amount" label="Amount" type="number" min={0} step="0.01" required />
            <TextField form={form} name="taxAmount" label="Tax amount" type="number" min={0} step="0.01" />
            <TextField form={form} name="currency" label="Currency" required description="3-letter code, e.g. LKR" />
            <TextField form={form} name="expenseDate" label="Expense date" type="date" required />
            <SelectField form={form} name="method" label="Payment method" options={methodOptions} required />
          </div>

          <TextareaField form={form} name="notes" label="Notes (optional)" rows={3} />

          {categories.length === 0 ? (
            <p className="text-xs font-medium text-destructive">
              No expense categories exist yet — close this dialog, open “Categories” and create one first.
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || categories.length === 0}>
              {mutation.isPending ? "Saving..." : expense ? "Save changes" : "Record expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- Categories dialog -------------------------- */

function CategoriesDialog({ onClose }: { onClose: () => void }) {
  const { can } = useAuth();
  const canUpdate = can("expenses.update");

  const categoriesQuery = useApiQuery<ExpenseCategory[]>(["expense-categories", "list"], "/expense-categories");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseCategory | null>(null);

  const resetForm = () => {
    setName("");
    setDescription("");
    setEditingId(null);
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["expense-categories", "list"] });
    queryClient.invalidateQueries({ queryKey: ["expenses", "list"] });
  };

  const saveMutation = useMutation({
    mutationFn: (vars: { id?: string; name: string; description: string | null }) =>
      vars.id
        ? api.patch<ExpenseCategory>(`/expense-categories/${vars.id}`, {
            name: vars.name,
            description: vars.description,
          })
        : api.post<ExpenseCategory>("/expense-categories", { name: vars.name, description: vars.description }),
    onSuccess: (_category, vars) => {
      toastSuccess(vars.id ? "Category updated" : "Category created");
      resetForm();
      refresh();
    },
    onError: (error) => toastError(error),
  });

  const deleteMutation = useMutation({
    mutationFn: (category: ExpenseCategory) => api.del<void>(`/expense-categories/${category.id}`),
    onSuccess: () => {
      toastSuccess("Category deleted");
      setDeleteTarget(null);
      refresh();
    },
    onError: (error) => toastError(error),
  });

  const categories = categoriesQuery.data ?? [];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Expense categories</DialogTitle>
          <DialogDescription>
            Categories used by expense records and reports. A category with expenses against it cannot be
            deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {categoriesQuery.isLoading ? (
            <LoadingState label="Loading categories..." />
          ) : categoriesQuery.isError ? (
            <ErrorState
              title="Categories could not be loaded"
              description={categoriesQuery.error instanceof Error ? categoriesQuery.error.message : undefined}
              onRetry={() => categoriesQuery.refetch()}
            />
          ) : categories.length === 0 ? (
            <EmptyState
              title="No categories yet"
              description={canUpdate ? "Add your first category below." : "Ask an administrator to create one."}
              className="py-8"
            />
          ) : (
            categories.map((category) => {
              const count = category._count?.expenses ?? 0;
              return (
                <div
                  key={category.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{category.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {category.description || "No description"} · {count} expense{count === 1 ? "" : "s"}
                    </p>
                  </div>
                  {canUpdate ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Edit ${category.name}`}
                        onClick={() => {
                          setName(category.name);
                          setDescription(category.description ?? "");
                          setEditingId(category.id);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        aria-label={`Delete ${category.name}`}
                        disabled={count > 0 || deleteMutation.isPending}
                        title={count > 0 ? "Move or delete its expenses first" : "Delete category"}
                        onClick={() => setDeleteTarget(category)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {canUpdate ? (
          <form
            className="space-y-3 border-t border-border pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = name.trim();
              if (!trimmed) return;
              saveMutation.mutate({ id: editingId ?? undefined, name: trimmed, description: description.trim() || null });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="category-name">Name</Label>
              <Input
                id="category-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Software & subscriptions"
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category-description">Description (optional)</Label>
              <Input
                id="category-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What belongs in this category"
                maxLength={500}
              />
            </div>
            <div className="flex justify-end gap-2">
              {editingId ? (
                <Button type="button" variant="ghost" onClick={resetForm}>
                  Cancel
                </Button>
              ) : null}
              <Button type="submit" disabled={!name.trim() || saveMutation.isPending}>
                <Plus className="h-4 w-4" />
                {editingId ? "Save changes" : "Add category"}
              </Button>
            </div>
          </form>
        ) : null}

        {deleteTarget ? (
          <ConfirmDialog
            open
            onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
            title={`Delete "${deleteTarget.name}"?`}
            description="This removes the category permanently. Categories with expenses cannot be deleted."
            confirmLabel="Delete"
            destructive
            loading={deleteMutation.isPending}
            onConfirm={() => deleteMutation.mutate(deleteTarget)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------- Reject dialog ------------------------------- */

function RejectExpenseDialog({
  expense,
  loading,
  onConfirm,
  onClose,
}: {
  expense: Expense;
  loading: boolean;
  onConfirm: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reject {expense.expenseNo}</DialogTitle>
          <DialogDescription>
            The expense is marked rejected. Optionally record why — the note is stored on the expense.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reject-note">Reason (optional)</Label>
          <Textarea
            id="reject-note"
            rows={3}
            value={note}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why is this expense rejected?"
          />
          <p className="text-xs text-muted-foreground">Stored for auditing.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(note)} disabled={loading}>
            {loading ? "Rejecting..." : "Reject expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- Page ----------------------------------- */

type ExpenseAction =
  | { type: "approve"; expense: Expense }
  | { type: "reject"; expense: Expense }
  | { type: "pay"; expense: Expense }
  | { type: "delete"; expense: Expense };

export default function ExpenseList() {
  const { can } = useAuth();
  const list = useListParams({ status: "", categoryId: "", projectId: "" });
  const expenses = useApiList<Expense>(["expenses", "list", list.query], "/expenses", list.query);
  const categoriesQuery = useApiQuery<ExpenseCategory[]>(["expense-categories", "list"], "/expense-categories");
  const projectsQuery = useApiQuery<Project[]>(["projects", "options"], "/projects", { limit: 200 });

  const [formOpen, setFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [action, setAction] = useState<ExpenseAction | null>(null);

  const hasActiveFilters =
    Boolean(list.search) ||
    Boolean(list.filters.status) ||
    Boolean(list.filters.categoryId) ||
    Boolean(list.filters.projectId);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["expenses", "list"] });

  const approveMutation = useMutation({
    mutationFn: (expense: Expense) => api.post<Expense>(`/expenses/${expense.id}/approve`),
    onSuccess: () => {
      toastSuccess("Expense approved");
      refresh();
      setAction(null);
    },
    onError: (error) => toastError(error),
  });

  const rejectMutation = useMutation({
    mutationFn: (vars: { expense: Expense; note: string }) =>
      api.post<Expense>(`/expenses/${vars.expense.id}/reject`, { note: vars.note.trim() || null }),
    onSuccess: () => {
      toastSuccess("Expense rejected");
      refresh();
      setAction(null);
    },
    onError: (error) => toastError(error),
  });

  const payMutation = useMutation({
    mutationFn: (expense: Expense) => api.post<Expense>(`/expenses/${expense.id}/pay`),
    onSuccess: () => {
      toastSuccess("Expense marked paid", "The paid date was stamped on the expense.");
      refresh();
      setAction(null);
    },
    onError: (error) => toastError(error),
  });

  const deleteMutation = useMutation({
    mutationFn: (expense: Expense) => api.del<void>(`/expenses/${expense.id}`),
    onSuccess: () => {
      toastSuccess("Expense deleted");
      refresh();
      setAction(null);
    },
    onError: (error) => toastError(error),
  });

  const openCreate = () => {
    setEditingExpense(null);
    setFormOpen(true);
  };

  const columns: ColumnDef<Expense, unknown>[] = [
    {
      accessorKey: "expenseNo",
      header: "Expense #",
      enableSorting: false,
      cell: ({ row }) => <span className="font-mono text-xs font-medium">{row.original.expenseNo}</span>,
    },
    {
      id: "category",
      header: "Category",
      enableSorting: false,
      cell: ({ row }) => <span className="text-sm">{row.original.category?.name ?? "-"}</span>,
    },
    {
      id: "details",
      header: "Vendor / description",
      enableSorting: false,
      cell: ({ row }) => {
        const subline = [row.original.vendor, row.original.project?.name].filter(Boolean).join(" · ");
        return (
          <div className="min-w-0 max-w-[260px]">
            <p className="truncate text-sm">{row.original.description}</p>
            {subline ? <p className="truncate text-xs text-muted-foreground">{subline}</p> : null}
          </div>
        );
      },
    },
    {
      id: "amount",
      header: "Amount",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="text-right">
          <p className="text-sm font-medium">{formatMoney(row.original.amount, row.original.currency)}</p>
          <p className="text-[11px] text-muted-foreground">
            + {formatMoney(row.original.taxAmount, row.original.currency)} tax
          </p>
        </div>
      ),
    },
    {
      accessorKey: "expenseDate",
      header: "Date",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.original.expenseDate)}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      enableSorting: false,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const expense = row.original;
        const showEdit = can("expenses.update") && (expense.status !== "PAID" || can("expenses.approve"));
        const showApprove = can("expenses.approve") && !["APPROVED", "PAID"].includes(expense.status);
        const showReject = can("expenses.approve") && !["REJECTED", "PAID"].includes(expense.status);
        const showPay = can("expenses.approve") && expense.status !== "PAID";
        const showDelete = can("expenses.delete") && expense.status !== "PAID";

        if (!showEdit && !showApprove && !showReject && !showPay && !showDelete) {
          return <span className="block text-right text-xs text-muted-foreground">-</span>;
        }

        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${expense.expenseNo}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {showEdit ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditingExpense(expense);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" /> Edit
                  </DropdownMenuItem>
                ) : null}
                {showApprove ? (
                  <DropdownMenuItem onSelect={() => setAction({ type: "approve", expense })}>
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </DropdownMenuItem>
                ) : null}
                {showReject ? (
                  <DropdownMenuItem onSelect={() => setAction({ type: "reject", expense })}>
                    <XCircle className="h-4 w-4" /> Reject
                  </DropdownMenuItem>
                ) : null}
                {showPay ? (
                  <DropdownMenuItem onSelect={() => setAction({ type: "pay", expense })}>
                    <Banknote className="h-4 w-4" /> Mark as paid
                  </DropdownMenuItem>
                ) : null}
                {showDelete ? (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setAction({ type: "delete", expense })}
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Business spend, from vendor bills to internal costs. Approve, reject and mark paid with a full audit trail."
        actions={
          <>
            <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
              <Tags className="h-4 w-4" /> Categories
            </Button>
            {can("expenses.create") ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" /> New expense
              </Button>
            ) : null}
          </>
        }
      />

      <div className="space-y-4">
        <FilterBar>
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            placeholder="Search description, vendor or #..."
          />

          <Select
            value={list.filters.status || "ALL"}
            onValueChange={(value) => list.setFilter("status", value === "ALL" ? "" : value)}
          >
            <SelectTrigger className="w-[150px]" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {OPTIONS.expenseStatus.map((status) => (
                <SelectItem key={status} value={status}>
                  {humanize(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={list.filters.categoryId || "ALL"}
            onValueChange={(value) => list.setFilter("categoryId", value === "ALL" ? "" : value)}
          >
            <SelectTrigger className="w-[180px]" aria-label="Filter by category">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              {(categoriesQuery.data ?? []).map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={list.filters.projectId || "ALL"}
            onValueChange={(value) => list.setFilter("projectId", value === "ALL" ? "" : value)}
          >
            <SelectTrigger className="w-[180px]" aria-label="Filter by project">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All projects</SelectItem>
              {(projectsQuery.data ?? []).map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.projectNo} · {project.name}
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

        {expenses.isError ? (
          <ErrorState
            title="Expenses could not be loaded"
            description={expenses.error instanceof Error ? expenses.error.message : undefined}
            onRetry={() => expenses.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            data={expenses.data?.items ?? []}
            isLoading={expenses.isLoading}
            emptyTitle="No expenses found"
            emptyDescription="Record your first expense to start tracking business spend."
            emptyAction={
              can("expenses.create") ? (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> New expense
                </Button>
              ) : undefined
            }
          />
        )}

        <Pagination pagination={expenses.data?.pagination} onPageChange={list.setPage} />
      </div>

      {formOpen ? (
        <ExpenseDialog
          expense={editingExpense}
          categories={categoriesQuery.data ?? []}
          projects={projectsQuery.data ?? []}
          onClose={() => setFormOpen(false)}
        />
      ) : null}
      {categoriesOpen ? <CategoriesDialog onClose={() => setCategoriesOpen(false)} /> : null}

      {action?.type === "approve" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setAction(null); }}
          title="Approve expense"
          description={`${action.expense.expenseNo} — ${formatMoney(
            action.expense.amount,
            action.expense.currency,
          )} will be marked approved and stamped with your name as approver.`}
          confirmLabel="Approve"
          loading={approveMutation.isPending}
          onConfirm={() => approveMutation.mutate(action.expense)}
        />
      ) : null}

      {action?.type === "pay" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setAction(null); }}
          title="Mark expense as paid"
          description={`${action.expense.expenseNo} will be stamped with today's paid date. This only affects the expense — client invoices are untouched.`}
          confirmLabel="Mark as paid"
          loading={payMutation.isPending}
          onConfirm={() => payMutation.mutate(action.expense)}
        />
      ) : null}

      {action?.type === "delete" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setAction(null); }}
          title={`Delete ${action.expense.expenseNo}?`}
          description="The expense is removed permanently. Paid expenses can never be deleted."
          confirmLabel="Delete"
          destructive
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(action.expense)}
        />
      ) : null}

      {action?.type === "reject" ? (
        <RejectExpenseDialog
          expense={action.expense}
          loading={rejectMutation.isPending}
          onConfirm={(note) => rejectMutation.mutate({ expense: action.expense, note })}
          onClose={() => setAction(null)}
        />
      ) : null}
    </div>
  );
}
