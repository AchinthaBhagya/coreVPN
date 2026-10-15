import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Info,
  Loader2,
  Plus,
  ReceiptText,
  RefreshCw,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiQuery } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { formatMoney, formatNumber, humanize, toNumber } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable } from "@/components/common/DataTable";
import { ToneBadge } from "@/components/common/StatusBadge";
import { EmptyState, ErrorState, LoadingState, TableSkeleton } from "@/components/common/states";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SelectField, TextField, TextareaField } from "@/components/common/form";
import { StatCard } from "@/components/common/StatCard";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AllocationRule, Project } from "@/types";

/* ------------------------------- Local types ------------------------------ */

const MODELS = ["FIXED", "PERCENT_OF_REVENUE", "PERCENT_OF_PROFIT"] as const;

const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "PERCENT_OF_PROFIT", label: "% of profit (revenue - expenses)" },
  { value: "PERCENT_OF_REVENUE", label: "% of revenue (invoiced total)" },
  { value: "FIXED", label: "Fixed amount per member" },
];

function basisHint(model: string): string {
  if (model === "PERCENT_OF_PROFIT") return "Revenue minus recorded expenses (profit), floored at zero.";
  if (model === "PERCENT_OF_REVENUE") return "Total invoiced revenue, before expenses.";
  return "Sum of the rule's fixed amounts (informational).";
}

interface MemberOption {
  id: string;
  firstName: string;
  lastName: string;
}

/** One proposed distribution line exactly as previewAllocation() returns it. */
interface PreviewLine {
  userId: string;
  userName: string;
  percent: string | null;
  fixedAmount: string | null;
  amount: string;
  isRoundingAdjustment: boolean;
  role?: string | null;
}

/** Exact payload returned by GET /allocations/projects/:id/preview. */
interface PreviewResponse {
  projectId: string;
  projectName: string;
  ruleId: string;
  ruleName: string;
  ruleVersion: number;
  model: string;
  currency: string;
  invoicedRevenue: string;
  expenses: string;
  distributableAmount: string;
  lines: PreviewLine[];
  allocatedTotal: string;
  unallocated: string;
  reconciled?: boolean;
  reconciles?: boolean;
  warnings: string[];
}

/* --------------------------------- Schema --------------------------------- */

function parsePositive(value?: string): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const ruleSchema = z
  .object({
    projectId: z.string().min(1, "Select a project"),
    name: z
      .string()
      .trim()
      .min(2, "Give the rule a name of at least 2 characters")
      .max(120, "Keep the name under 120 characters"),
    model: z.enum(MODELS),
    notes: z.string().max(2000, "Notes are limited to 2000 characters").optional(),
    items: z
      .array(
        z.object({
          userId: z.string().min(1, "Pick a member"),
          percent: z.string().optional(),
          fixedAmount: z.string().optional(),
        }),
      )
      .min(1, "Add at least one allocation line"),
  })
  .superRefine((values, ctx) => {
    const seen = new Set<string>();
    values.items.forEach((item, index) => {
      if (item.userId) {
        if (seen.has(item.userId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["items", index, "userId"],
            message: "This member already has a line",
          });
        }
        seen.add(item.userId);
      }
      if (values.model === "FIXED") {
        if (parsePositive(item.fixedAmount) === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["items", index, "fixedAmount"],
            message: "Enter an amount greater than 0",
          });
        }
      } else if (parsePositive(item.percent) === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "percent"],
          message: "Enter a share greater than 0",
        });
      }
    });
  });

type RuleValues = z.infer<typeof ruleSchema>;

/* ---------------------------- New rule dialog ----------------------------- */

function NewRuleDialog({
  open,
  onOpenChange,
  projects,
  defaultProjectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  defaultProjectId: string;
  onCreated: (projectId: string) => void;
}) {
  const queryClient = useQueryClient();

  const form = useForm<RuleValues>({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      projectId: defaultProjectId,
      name: "",
      model: "PERCENT_OF_PROFIT",
      notes: "",
      items: [{ userId: "", percent: "", fixedAmount: "" }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });

  const selectedProjectId = form.watch("projectId");
  const model = form.watch("model");
  const watchedItems = form.watch("items");
  const isPercentModel = model !== "FIXED";

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const currency = selectedProject?.currency ?? "LKR";

  const directoryQuery = useApiQuery<MemberOption[]>(["users", "assignable"], "/users/assignable", undefined, {
    enabled: open,
  });
  const projectQuery = useApiQuery<Project>(
    qk.detail("projects", selectedProjectId),
    `/projects/${selectedProjectId}`,
    undefined,
    { enabled: open && Boolean(selectedProjectId) },
  );

  const projectMembers = projectQuery.data?.members;
  const memberIds = useMemo(
    () => new Set((projectMembers ?? []).map((member) => member.userId)),
    [projectMembers],
  );
  const memberUsers = useMemo(
    () => (projectMembers ?? []).flatMap((member) => (member.user ? [member.user] : [])),
    [projectMembers],
  );

  // Prefer the assignable-user directory, but fall back to the project's members
  // (some finance roles can read projects without holding users.view).
  const options = useMemo(() => {
    const source = directoryQuery.data ?? memberUsers;
    const unique = new Map<string, string>();
    for (const user of source) {
      if (memberIds.size > 0 && !memberIds.has(user.id)) continue;
      unique.set(user.id, `${user.firstName} ${user.lastName}`);
    }
    return Array.from(unique.entries()).map(([value, label]) => ({ value, label }));
  }, [directoryQuery.data, memberUsers, memberIds]);

  const percentTotal = watchedItems.reduce((sum, item) => sum + toNumber(item?.percent), 0);
  const fixedTotal = watchedItems.reduce((sum, item) => sum + toNumber(item?.fixedAmount), 0);
  const percentBalanced = Math.abs(percentTotal - 100) < 0.005;

  const createMutation = useMutation({
    mutationFn: (values: RuleValues) =>
      api.post<AllocationRule>("/allocations/rules", {
        projectId: values.projectId,
        name: values.name.trim(),
        model: values.model,
        notes: values.notes?.trim() ? values.notes.trim() : null,
        items: values.items.map((item) =>
          values.model === "FIXED"
            ? { userId: item.userId, fixedAmount: toNumber(item.fixedAmount) }
            : { userId: item.userId, percent: toNumber(item.percent) },
        ),
      }),
    onSuccess: (rule) => {
      toastSuccess(
        "Allocation rule created",
        `${rule.name} v${rule.version} is now the active version. Preview it, then commit to accrue entitlements.`,
      );
      queryClient.invalidateQueries({ queryKey: ["allocation-rules"] });
      onCreated(rule.projectId);
      onOpenChange(false);
    },
    onError: (error) => {
      const fieldMessages = fieldErrors(error);
      for (const [key, message] of Object.entries(fieldMessages)) {
        form.setError(key as keyof RuleValues, { message });
      }
      toastError(error);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New allocation rule</DialogTitle>
          <DialogDescription>
            Saving creates a new immutable version for the project. Previous versions stay intact so historical earnings
            keep pointing at the split that produced them.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((values) => createMutation.mutate(values))} className="space-y-5" noValidate>
          <SelectField
            form={form}
            name="projectId"
            label="Project"
            required
            options={projects.map((project) => ({ value: project.id, label: `${project.projectNo} - ${project.name}` }))}
            placeholder="Select a project..."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="name" label="Rule name" placeholder="e.g. Dev team profit split" required />
            <SelectField form={form} name="model" label="Distribution model" required options={MODEL_OPTIONS} />
          </div>

          <TextareaField
            form={form}
            name="notes"
            label="Notes (optional)"
            placeholder="Why this split exists, who agreed it..."
            rows={2}
          />

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Allocation lines</p>
                <p className="text-xs text-muted-foreground">
                  {selectedProjectId
                    ? "Recipients must be members of the selected project."
                    : "Pick a project first - recipients must be its members."}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ userId: "", percent: "", fixedAmount: "" })}
              >
                <Plus className="h-4 w-4" />
                Add line
              </Button>
            </div>

            {fields.map((field, index) => (
              <div key={field.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Line {index + 1}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
                    disabled={fields.length <= 1}
                    aria-label="Remove allocation line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField
                    form={form}
                    name={`items.${index}.userId` as Path<RuleValues>}
                    label="Member"
                    required
                    options={options}
                    placeholder={options.length ? "Select member..." : "No members available"}
                    disabled={!selectedProjectId || projectQuery.isLoading}
                  />
                  {isPercentModel ? (
                    <TextField
                      form={form}
                      name={`items.${index}.percent` as Path<RuleValues>}
                      label="Share %"
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="e.g. 50"
                    />
                  ) : (
                    <TextField
                      form={form}
                      name={`items.${index}.fixedAmount` as Path<RuleValues>}
                      label={`Fixed amount (${currency})`}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="e.g. 25000"
                    />
                  )}
                </div>
              </div>
            ))}

            {isPercentModel ? (
              <p
                className={
                  percentBalanced
                    ? "text-xs font-medium text-emerald-400"
                    : "text-xs font-medium text-amber-300"
                }
              >
                {percentBalanced
                  ? `Shares total ${percentTotal.toFixed(2)}% - balanced.`
                  : `Shares currently total ${percentTotal.toFixed(2)}%; percentage rules must add up to exactly 100% — the server rejects anything else.`}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Each fixed amount is accrued as-is. Total of all lines: {formatMoney(fixedTotal, currency)}. The FIXED
                model distributes exactly this sum.
              </p>
            )}

            {options.length === 0 && directoryQuery.isError && memberIds.size === 0 ? (
              <p className="text-xs font-medium text-destructive">
                Couldn't load the member directory:{" "}
                {directoryQuery.error instanceof Error ? directoryQuery.error.message : "unknown error"}
              </p>
            ) : null}
          </div>

          <Alert variant="info">
            <Info />
            <AlertDescription>
              Committing a rule later turns these shares into accrued entitlements (pending member earnings) - bookkeeping
              claims only. No cash moves until a payout is approved and marked paid.
            </AlertDescription>
          </Alert>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {createMutation.isPending ? "Creating..." : "Create rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Preview & commit ----------------------------- */

function PreviewPanel({
  projects,
  projectsLoading,
  canApprove,
}: {
  projects: Project[];
  projectsLoading: boolean;
  canApprove: boolean;
}) {
  const [projectId, setProjectId] = useState("");

  const previewQuery = useApiQuery<PreviewResponse>(
    qk.list("allocation-preview", { projectId }),
    `/allocations/projects/${projectId}/preview`,
    undefined,
    { enabled: Boolean(projectId) },
  );

  return (
    <SectionCard
      title="Preview & commit"
      description="Simulate the split against live project financials. A preview never writes anything."
      actions={
        <div className="flex items-center gap-2">
          <Select value={projectId || undefined} onValueChange={setProjectId}>
            <SelectTrigger className="w-[220px]" disabled={projectsLoading}>
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.projectNo} - {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            disabled={!projectId || previewQuery.isFetching}
            onClick={() => previewQuery.refetch()}
            aria-label="Refresh preview"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      {!projectId ? (
        <EmptyState
          title="Pick a project"
          description="Choose a project to preview how its distributable amount would be split between members."
        />
      ) : previewQuery.isLoading ? (
        <LoadingState label="Calculating preview (read-only)..." />
      ) : previewQuery.isError ? (
        <ErrorState
          title="Preview unavailable"
          description={previewQuery.error instanceof Error ? previewQuery.error.message : "The preview could not be calculated."}
          onRetry={() => previewQuery.refetch()}
        />
      ) : previewQuery.data ? (
        <PreviewDetails preview={previewQuery.data} canApprove={canApprove} />
      ) : null}
    </SectionCard>
  );
}

function PreviewDetails({ preview, canApprove }: { preview: PreviewResponse; canApprove: boolean }) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const reconciles = Boolean(preview.reconciled ?? preview.reconciles);

  const commitMutation = useMutation({
    mutationFn: () =>
      api.post<{ earnings: unknown[] }>(`/allocations/projects/${preview.projectId}/commit`, {
        ruleId: preview.ruleId,
      }),
    onSuccess: (result) => {
      toastSuccess(
        "Allocation committed",
        `${result.earnings.length} pending entitlement(s) created. No cash moved - members are paid later through payouts.`,
      );
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["allocation-rules"] });
      queryClient.invalidateQueries({ queryKey: ["earnings-mine"] });
      queryClient.invalidateQueries({ queryKey: ["earnings-all"] });
    },
    onError: (error) => toastError(error),
  });

  const lineColumns: ColumnDef<PreviewLine, unknown>[] = [
    {
      id: "member",
      header: "Member",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.original.userName}</p>
          {row.original.role ? <p className="truncate text-xs text-muted-foreground">{row.original.role}</p> : null}
        </div>
      ),
    },
    {
      id: "share",
      header: "Share",
      enableSorting: false,
      cell: ({ row }) => {
        const line = row.original;
        if (line.percent !== null && line.percent !== undefined) {
          return <span className="tabular-nums">{formatNumber(line.percent, 2)}%</span>;
        }
        if (line.fixedAmount) {
          return <span className="tabular-nums">{formatMoney(line.fixedAmount, preview.currency)} fixed</span>;
        }
        return <span className="text-muted-foreground">-</span>;
      },
    },
    {
      id: "amount",
      header: "Accrued entitlement",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="text-right">
          <span className="tabular-nums">{formatMoney(row.original.amount, preview.currency)}</span>
          {row.original.isRoundingAdjustment ? (
            <p className="text-[11px] text-muted-foreground">rounded to the nearest cent</p>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{preview.projectName}</p>
          <p className="text-xs text-muted-foreground">
            Rule "{preview.ruleName}" - v{preview.ruleVersion} - {humanize(preview.model)}
          </p>
        </div>
        <ToneBadge tone={reconciles ? "success" : "warning"}>
          {reconciles ? "Reconciles" : "Does not reconcile"}
        </ToneBadge>
      </div>

      <Alert variant="info">
        <Info />
        <AlertTitle>Preview only - nothing has been written</AlertTitle>
        <AlertDescription>
          Basis: {basisHint(preview.model)} Committing records accrued entitlements (pending member earnings). That is
          bookkeeping, not payment - cash only leaves the business when a payout is approved and marked paid.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Invoiced revenue"
          value={formatMoney(preview.invoicedRevenue, preview.currency)}
          hint="Billed to clients - not necessarily cash received."
          icon={<ReceiptText className="h-5 w-5" />}
        />
        <StatCard
          label="Expenses"
          value={formatMoney(preview.expenses, preview.currency)}
          hint="Recorded project expenses."
          icon={<Wallet className="h-5 w-5" />}
          tone="danger"
        />
        <StatCard
          label="Distributable"
          value={formatMoney(preview.distributableAmount, preview.currency)}
          hint={basisHint(preview.model)}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="accent"
        />
        <StatCard
          label="Allocated total"
          value={formatMoney(preview.allocatedTotal, preview.currency)}
          hint={`Across ${preview.lines.length} member line(s).`}
          icon={<Banknote className="h-5 w-5" />}
          tone="success"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Unallocated remainder</p>
          <p className="text-lg font-semibold tabular-nums">{formatMoney(preview.unallocated, preview.currency)}</p>
        </div>
        <p className="max-w-md text-xs text-muted-foreground">
          {reconciles
            ? "The split consumes the distributable amount exactly - safe to commit."
            : "The split does not add up to the distributable amount yet - do not commit."}
        </p>
      </div>

      {preview.warnings.length > 0 ? (
        <div className="space-y-2">
          {preview.warnings.map((warning, index) => (
            <Alert variant="warning" key={`${index}-${warning}`}>
              <AlertTriangle />
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ))}
        </div>
      ) : null}

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Proposed entitlement lines</p>
        <DataTable
          columns={lineColumns}
          data={preview.lines}
          emptyTitle="No allocation lines"
          emptyDescription="This rule has no recipients."
        />
      </div>

      <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              Commit rule "{preview.ruleName}" (v{preview.ruleVersion})
            </p>
            <p className="text-xs text-muted-foreground">
              Creates {preview.lines.length} PENDING accrued entitlement(s) on {preview.projectName}. Entitlements are
              claims against future payouts - no cash moves in this step.
            </p>
          </div>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!reconciles || !canApprove || commitMutation.isPending}
          >
            <CheckCircle2 className="h-4 w-4" />
            {commitMutation.isPending ? "Committing..." : "Commit allocation"}
          </Button>
        </div>
        {!canApprove ? (
          <p className="text-xs text-amber-300">You need the allocations.approve permission to commit an allocation.</p>
        ) : !reconciles ? (
          <p className="text-xs text-amber-300">The preview must reconcile (remainder 0.00) before it can be committed.</p>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Commit this allocation?"
        description={`This writes ${preview.lines.length} pending accrued entitlement(s) for ${preview.projectName} under rule v${preview.ruleVersion}. Entitlements are bookkeeping claims only: no cash moves, and members are paid later through the payouts screen.`}
        confirmLabel="Commit allocation"
        loading={commitMutation.isPending}
        onConfirm={() => commitMutation.mutate()}
      />
    </div>
  );
}

/* ------------------------------ Page component ----------------------------- */

export default function AllocationList() {
  const { can } = useAuth();
  const canManage = can("allocations.manage");
  const canApprove = can("allocations.approve");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [projectId, setProjectId] = useState("");

  const projectsQuery = useApiQuery<Project[]>(qk.list("projects-picklist"), "/projects", { limit: 200 });
  const projects = projectsQuery.data ?? [];

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projectId, projects]);

  const selectedProject = projects.find((project) => project.id === projectId);

  const rulesQuery = useApiQuery<AllocationRule[]>(
    qk.list("allocation-rules", { projectId }),
    "/allocations/rules",
    { projectId },
    { enabled: Boolean(projectId) },
  );

  const ruleColumns: ColumnDef<AllocationRule, unknown>[] = [
    {
      accessorKey: "name",
      header: "Rule",
      cell: ({ row }) => (
        <div className="min-w-0 space-y-0.5">
          <p className="truncate font-medium">{row.original.name}</p>
          {row.original.createdBy ? (
            <p className="truncate text-xs text-muted-foreground">
              by {row.original.createdBy.firstName} {row.original.createdBy.lastName}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: "project",
      header: "Project",
      enableSorting: false,
      cell: () =>
        selectedProject ? (
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm">{selectedProject.name}</p>
            <p className="text-xs text-muted-foreground">{selectedProject.projectNo}</p>
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      accessorKey: "model",
      header: "Model",
      cell: ({ getValue }) => <ToneBadge tone="info">{humanize(String(getValue() ?? ""))}</ToneBadge>,
    },
    {
      accessorKey: "version",
      header: "Version",
      cell: ({ getValue }) => <span className="tabular-nums">v{String(getValue())}</span>,
    },
    {
      accessorKey: "isActive",
      header: "Active",
      cell: ({ row }) =>
        row.original.isActive ? (
          <ToneBadge tone="success">Active</ToneBadge>
        ) : (
          <ToneBadge tone="muted">Superseded</ToneBadge>
        ),
    },
    {
      id: "earnings",
      header: "# Earnings",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="tabular-nums">{formatNumber(row.original._count?.earnings ?? 0)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Allocation rules"
        description="Versioned split rules that turn a project's distributable amount into member entitlements."
        actions={
          <Button
            onClick={() => setDialogOpen(true)}
            disabled={!canManage}
            title={canManage ? undefined : "Requires the allocations.manage permission"}
          >
            <Plus className="h-4 w-4" />
            New rule
          </Button>
        }
      />

      <Alert variant="info">
        <Info />
        <AlertTitle>Revenue - profit - entitlement - cash</AlertTitle>
        <AlertDescription>
          Invoiced <strong>revenue</strong> minus recorded <strong>expenses</strong> gives the distributable
          <strong> profit</strong> that an allocation rule splits. The split creates <strong>accrued entitlements</strong>{" "}
          (member earnings) - still not cash. Real money only leaves the business when a payout is approved and marked
          paid.
        </AlertDescription>
      </Alert>

      <SectionCard
        title="Rules by project"
        description="Rules are immutable: a change creates a new version while past versions keep powering historical earnings."
        actions={
          <Select value={projectId || undefined} onValueChange={setProjectId}>
            <SelectTrigger className="w-[240px]" disabled={projectsQuery.isLoading}>
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.projectNo} - {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        {projectsQuery.isLoading ? (
          <LoadingState label="Loading projects..." />
        ) : projectsQuery.isError ? (
          <ErrorState
            title="Couldn't load projects"
            description={
              projectsQuery.error instanceof Error ? projectsQuery.error.message : "The project list failed to load."
            }
            onRetry={() => projectsQuery.refetch()}
          />
        ) : projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Allocation rules always belong to a project - create one first."
          />
        ) : !projectId ? (
          <EmptyState title="Pick a project" description="Select a project to list its allocation rule versions." />
        ) : rulesQuery.isLoading ? (
          <TableSkeleton columns={6} />
        ) : rulesQuery.isError ? (
          <ErrorState
            title="Couldn't load allocation rules"
            description={
              rulesQuery.error instanceof Error ? rulesQuery.error.message : "The rule list failed to load."
            }
            onRetry={() => rulesQuery.refetch()}
          />
        ) : (
          <DataTable
            columns={ruleColumns}
            data={rulesQuery.data ?? []}
            emptyTitle="No allocation rules yet"
            emptyDescription="Create a split rule, then preview and commit it to accrue member entitlements."
            emptyAction={
              canManage ? (
                <Button onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New rule
                </Button>
              ) : undefined
            }
          />
        )}
      </SectionCard>

      <PreviewPanel projects={projects} projectsLoading={projectsQuery.isLoading} canApprove={canApprove} />

      {dialogOpen ? (
        <NewRuleDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          projects={projects}
          defaultProjectId={projectId}
          onCreated={(id) => setProjectId(id)}
        />
      ) : null}
    </div>
  );
}
