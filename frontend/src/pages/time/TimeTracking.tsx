import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Loader2, Play, Plus, Send, Square, Timer, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { useApiList, useApiQuery } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { formatDateTime, toDateInput } from "@/lib/format";
import { OPTIONS, statusLabel } from "@/lib/status";
import type { Project, Task, TimeEntry } from "@/types";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ErrorState } from "@/components/common/states";
import { SelectField, SwitchField, TextField, TextareaField } from "@/components/common/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * Server shape of a time entry. The shared `TimeEntry` type predates the
 * prisma model (`durationMinutes` / `isBillable`), so we override the stale
 * fields here instead of editing the shared file.
 */
type TimeEntryRow = Omit<TimeEntry, "hours" | "billable" | "entryDate"> & {
  durationMinutes: number;
  isBillable: boolean;
  rejectionNote?: string | null;
};

const logEntrySchema = z
  .object({
    date: z.string().min(1, "Date is required"),
    startedTime: z.string().min(1, "Start time is required"),
    endedTime: z.string().optional(),
    durationMinutes: z.string().optional(),
    projectId: z.string(),
    taskId: z.string(),
    description: z.string().optional(),
    isBillable: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const hasEnd = Boolean(values.endedTime?.trim());
    const rawDuration = values.durationMinutes?.trim();
    if (!hasEnd && !rawDuration) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["durationMinutes"], message: "Enter an end time or a duration" });
      return;
    }
    if (!hasEnd && rawDuration) {
      const minutes = Number(rawDuration);
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["durationMinutes"],
          message: "Duration must be between 1 and 1440 minutes",
        });
      }
    }
  });

type LogFormValues = z.infer<typeof logEntrySchema>;

const LOG_DEFAULTS: LogFormValues = {
  date: "",
  startedTime: "",
  endedTime: "",
  durationMinutes: "",
  projectId: "NONE",
  taskId: "NONE",
  description: "",
  isBillable: true,
};

/** Maps the form onto the create body; prefers an end time, else a duration. */
function buildLogPayload(values: LogFormValues) {
  const base = {
    startedAt: `${values.date}T${values.startedTime}:00`,
    projectId: values.projectId !== "NONE" ? values.projectId : null,
    taskId: values.taskId !== "NONE" ? values.taskId : null,
    description: values.description?.trim() || null,
    isBillable: values.isBillable,
  };
  const end = values.endedTime?.trim();
  if (end) return { ...base, endedAt: `${values.date}T${end}:00` };
  return { ...base, durationMinutes: Math.round(Number(values.durationMinutes)) };
}

/** "125" -> "2h 5m" for the duration column and confirmations. */
function formatDuration(minutes: number | null | undefined): string {
  const total = Math.floor(minutes ?? 0);
  if (!Number.isFinite(total) || total <= 0) return "0m";
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

/** Milliseconds -> "HH:MM:SS" for the live timer readout. */
function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Both the list and the running-timer widget live under these key prefixes. */
function invalidateTime() {
  queryClient.invalidateQueries({ queryKey: ["time-entries"] });
  queryClient.invalidateQueries({ queryKey: ["time"] });
}

/** Live timer: shows the running entry with a stop button, else a start form. */
function TimerCard() {
  const { can } = useAuth();
  const canLog = can("time.log");
  const canProjects = can("projects.view");
  const canTasks = can("tasks.view");

  const running = useApiQuery<TimeEntryRow | null>(["time", "running"], "/time-entries/running", undefined, {
    enabled: canLog,
  });
  const active = running.data ?? null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active?.id) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active?.id]);

  const [projectId, setProjectId] = useState("NONE");
  const [taskId, setTaskId] = useState("NONE");
  const [description, setDescription] = useState("");

  const projects = useApiList<Project>(qk.list("projects", { limit: 200 }), "/projects", { limit: 200 }, {
    enabled: canProjects && !active,
  });
  const tasks = useApiList<Task>(qk.list("tasks", { projectId, limit: 200 }), "/tasks", { projectId, limit: 200 }, {
    enabled: canTasks && !active && projectId !== "NONE",
  });

  useEffect(() => {
    setTaskId("NONE");
  }, [projectId]);

  const stopMutation = useMutation({
    mutationFn: (entryId: string) => api.post(`/time-entries/${entryId}/stop`),
    onSuccess: () => {
      toastSuccess("Timer stopped");
      invalidateTime();
    },
    onError: (error) => toastError(error),
  });

  const startMutation = useMutation({
    mutationFn: () =>
      api.post("/time-entries/start", {
        projectId: projectId !== "NONE" ? projectId : null,
        taskId: taskId !== "NONE" ? taskId : null,
        description: description.trim() || null,
      }),
    onSuccess: () => {
      toastSuccess("Timer started");
      invalidateTime();
    },
    onError: (error) => toastError(error),
  });

  if (!canLog) return null;

  return (
    <Card className="border-white/10 bg-white/5">
      <CardContent className="p-4">
        {running.isError ? (
          <ErrorState
            description="Your running timer could not be loaded."
            onRetry={() => running.refetch()}
            className="py-4"
          />
        ) : active ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <Timer className="h-3.5 w-3.5" /> Timer running
              </p>
              <p className="font-mono text-3xl font-semibold tabular-nums text-foreground">
                {formatElapsed(now - (active.startedAt ? Date.parse(active.startedAt) : Number.NaN))}
              </p>
              <p className="text-sm text-muted-foreground">
                {active.project?.name ?? "No project"}
                {active.task ? ` · ${active.task.title}` : ""}
                {active.description ? ` — ${active.description}` : ""}
              </p>
            </div>
            <Button
              type="button"
              variant="destructive"
              disabled={stopMutation.isPending}
              onClick={() => stopMutation.mutate(active.id)}
            >
              <Square className="h-4 w-4" />
              Stop timer
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Timer className="h-3.5 w-3.5" /> Live timer
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">No project</SelectItem>
                  {(projects.data?.items ?? []).map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.projectNo ? `${project.projectNo} · ${project.name}` : project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canTasks ? (
                <Select value={taskId} onValueChange={setTaskId} disabled={projectId === "NONE"}>
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder="Task" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No task</SelectItem>
                    {(tasks.data?.items ?? []).map((task) => (
                      <SelectItem key={task.id} value={task.id}>
                        {task.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What are you working on?"
                className="min-w-48 flex-1"
              />
              <Button type="button" disabled={startMutation.isPending} onClick={() => startMutation.mutate()}>
                {startMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Start timer
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Manual entry dialog: date + start/end times, or a duration when no end time. */
function LogEntryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { can } = useAuth();
  const canTasks = can("tasks.view");
  const form = useForm<LogFormValues>({ resolver: zodResolver(logEntrySchema), defaultValues: LOG_DEFAULTS });

  const projects = useApiList<Project>(qk.list("projects", { limit: 200 }), "/projects", { limit: 200 }, {
    enabled: can("projects.view"),
  });
  const projectId = form.watch("projectId");
  const tasks = useApiList<Task>(qk.list("tasks", { projectId, limit: 200 }), "/tasks", { projectId, limit: 200 }, {
    enabled: canTasks && projectId !== "NONE",
  });

  useEffect(() => {
    if (open) form.reset({ ...LOG_DEFAULTS, date: toDateInput(new Date()) });
  }, [open, form]);

  useEffect(() => {
    form.setValue("taskId", "NONE");
  }, [projectId, form]);

  const mutation = useMutation({
    mutationFn: (values: LogFormValues) => api.post("/time-entries", buildLogPayload(values)),
    onSuccess: () => {
      toastSuccess("Time entry logged");
      invalidateTime();
      onOpenChange(false);
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) {
        if (key in LOG_DEFAULTS) form.setError(key as keyof LogFormValues, { message });
      }
      toastError(error);
    },
  });

  const projectOptions = [
    { value: "NONE", label: "No project" },
    ...(projects.data?.items ?? []).map((project) => ({
      value: project.id,
      label: project.projectNo ? `${project.projectNo} · ${project.name}` : project.name,
    })),
  ];
  const taskOptions = [
    { value: "NONE", label: "No task" },
    ...(tasks.data?.items ?? []).map((task) => ({ value: task.id, label: task.title })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log time</DialogTitle>
          <DialogDescription>
            Record hours manually. Entries start as drafts and go through approval.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField form={form} name="date" label="Date" type="date" required />
            <TextField form={form} name="startedTime" label="Start time" type="time" required />
            <TextField form={form} name="endedTime" label="End time" type="time" />
          </div>
          <TextField
            form={form}
            name="durationMinutes"
            label="Duration (minutes)"
            type="number"
            min="1"
            max="1440"
            disabled={Boolean(form.watch("endedTime"))}
            description="Used when no end time is given."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField form={form} name="projectId" label="Project" options={projectOptions} placeholder="Select a project" />
            {canTasks ? (
              <SelectField form={form} name="taskId" label="Task" options={taskOptions} placeholder="Select a task" />
            ) : null}
          </div>
          <TextareaField form={form} name="description" label="Description" rows={2} />
          <SwitchField
            form={form}
            name="isBillable"
            label="Billable"
            description="Billable hours feed invoicing and earnings."
          />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Log entry
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Optional rejection note before sending an entry back to its owner. */
function RejectDialog({
  entry,
  onOpenChange,
  onReject,
  isPending,
}: {
  entry: TimeEntryRow;
  onOpenChange: (open: boolean) => void;
  onReject: (note: string) => void;
  isPending: boolean;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject time entry</DialogTitle>
          <DialogDescription>Add an optional note so the person knows what to change.</DialogDescription>
        </DialogHeader>
        <Textarea
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Please split the design and build hours."
        />
        <p className="text-xs text-muted-foreground">
          {formatDuration(entry.durationMinutes)} logged {formatDateTime(entry.startedAt)}
        </p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={isPending} onClick={() => onReject(note)}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            Reject entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type TimeAction = { id: string; action: "submit" | "approve" | "reject" | "delete"; note?: string };

export default function TimeTracking() {
  const { can, user } = useAuth();
  const params = useListParams({ status: "", projectId: "", dateFrom: "", dateTo: "" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TimeEntryRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TimeEntryRow | null>(null);

  const canLog = can("time.log");
  const canApprove = can("time.approve");
  const canViewAll = can("time.viewAll");

  const projects = useApiList<Project>(qk.list("projects", { limit: 200 }), "/projects", { limit: 200 }, {
    enabled: can("projects.view"),
  });

  const listQuery: Record<string, string | number> = { ...params.query };
  if (params.filters.dateTo) listQuery.dateTo = `${params.filters.dateTo}T23:59:59`;

  const entries = useApiList<TimeEntryRow>(
    qk.list("time-entries", { ...listQuery, scope: canViewAll ? "all" : "mine" }),
    canViewAll ? "/time-entries" : "/time-entries/mine",
    listQuery,
  );

  const actionMutation = useMutation({
    mutationFn: (vars: TimeAction) => {
      if (vars.action === "delete") return api.del(`/time-entries/${vars.id}`);
      if (vars.action === "reject") return api.post(`/time-entries/${vars.id}/reject`, { note: vars.note || null });
      return api.post(`/time-entries/${vars.id}/${vars.action}`);
    },
    onSuccess: (_data, vars) => {
      toastSuccess(
        vars.action === "submit"
          ? "Time entry submitted for approval"
          : vars.action === "approve"
            ? "Time entry approved"
            : vars.action === "reject"
              ? "Time entry rejected"
              : "Time entry deleted",
      );
      setDeleteTarget(null);
      setRejectTarget(null);
      invalidateTime();
    },
    onError: (error) => toastError(error),
  });

  const items = entries.data?.items ?? [];
  const projectFilter = params.filters.projectId;
  // `/time-entries/mine` has no server-side project filter, so narrow locally.
  const rows = canViewAll || !projectFilter ? items : items.filter((entry) => entry.projectId === projectFilter);

  const columns: ColumnDef<TimeEntryRow, unknown>[] = [
    { accessorKey: "startedAt", header: "Started", cell: ({ row }) => formatDateTime(row.original.startedAt) },
    {
      id: "project",
      header: "Project",
      enableSorting: false,
      cell: ({ row }) => {
        const { project } = row.original;
        if (!project) return <span className="text-muted-foreground">-</span>;
        return <span>{project.projectNo ? `${project.projectNo} · ${project.name}` : project.name}</span>;
      },
    },
    {
      id: "task",
      header: "Task",
      enableSorting: false,
      cell: ({ row }) => row.original.task?.title ?? <span className="text-muted-foreground">-</span>,
    },
    {
      accessorKey: "description",
      header: "Description",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="block max-w-[26ch] truncate text-muted-foreground">{row.original.description || "-"}</span>
      ),
    },
    {
      accessorKey: "durationMinutes",
      header: "Duration",
      cell: ({ row }) => formatDuration(row.original.durationMinutes),
    },
    {
      id: "billable",
      header: "Billable",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.isBillable ? <Badge variant="info">Billable</Badge> : <Badge variant="muted">No</Badge>,
    },
    ...(canViewAll
      ? [
          {
            id: "user",
            header: "User",
            enableSorting: false,
            cell: ({ row }: { row: { original: TimeEntryRow } }) =>
              row.original.user ? `${row.original.user.firstName} ${row.original.user.lastName}` : "-",
          } satisfies ColumnDef<TimeEntryRow, unknown>,
        ]
      : []),
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <span title={row.original.rejectionNote ?? undefined}>
          <StatusBadge status={row.original.status} />
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const entry = row.original;
        const isOwn = entry.userId === user?.id;
        const showSubmit = canLog && isOwn && ["DRAFT", "REJECTED"].includes(entry.status);
        const showReview = canApprove && entry.status === "SUBMITTED";
        const showDelete = canApprove || (canLog && isOwn && entry.status !== "APPROVED");
        if (!showSubmit && !showReview && !showDelete) return <span className="text-muted-foreground">-</span>;
        return (
          <div className="flex items-center justify-end gap-1">
            {showSubmit ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Submit for approval"
                onClick={() => actionMutation.mutate({ id: entry.id, action: "submit" })}
              >
                <Send className="h-4 w-4" />
              </Button>
            ) : null}
            {showReview ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-emerald-300 hover:text-emerald-200"
                  aria-label="Approve entry"
                  onClick={() => actionMutation.mutate({ id: entry.id, action: "approve" })}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-rose-300 hover:text-rose-200"
                  aria-label="Reject entry"
                  onClick={() => setRejectTarget(entry)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : null}
            {showDelete ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-rose-300 hover:text-rose-200"
                aria-label="Delete entry"
                onClick={() => setDeleteTarget(entry)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  const projectFilterOptions = (projects.data?.items ?? []).map((project) => ({
    value: project.id,
    label: project.projectNo ? `${project.projectNo} · ${project.name}` : project.name,
  }));
  const hasFilters = Boolean(params.filters.status || projectFilter || params.filters.dateFrom || params.filters.dateTo);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Time tracking"
        description="Run live timers or log hours manually, then route entries through approval."
        actions={
          canLog ? (
            <Button type="button" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Log time
            </Button>
          ) : null
        }
      />

      <TimerCard />

      <FilterBar>
        <Select value={params.filters.status || "ALL"} onValueChange={(value) => params.setFilter("status", value)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {OPTIONS.timeStatus.map((status) => (
              <SelectItem key={status} value={status}>
                {statusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {can("projects.view") ? (
          <Select value={projectFilter || "ALL"} onValueChange={(value) => params.setFilter("projectId", value)}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All projects</SelectItem>
              {projectFilterOptions.map((project) => (
                <SelectItem key={project.value} value={project.value}>
                  {project.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="flex items-center gap-2">
          <Label htmlFor="time-dateFrom" className="whitespace-nowrap text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="time-dateFrom"
            type="date"
            value={params.filters.dateFrom}
            onChange={(event) => params.setFilter("dateFrom", event.target.value)}
            className="w-36"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="time-dateTo" className="whitespace-nowrap text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="time-dateTo"
            type="date"
            value={params.filters.dateTo}
            onChange={(event) => params.setFilter("dateTo", event.target.value)}
            className="w-36"
          />
        </div>
        {hasFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={params.resetFilters}>
            Reset filters
          </Button>
        ) : null}
      </FilterBar>

      <div className="space-y-4">
        {entries.isError ? (
          <ErrorState
            description={entries.error instanceof Error ? entries.error.message : "Time entries could not be loaded."}
            onRetry={() => entries.refetch()}
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              data={rows}
              isLoading={entries.isLoading}
              emptyTitle="No time entries"
              emptyDescription={
                hasFilters
                  ? "No entries match these filters."
                  : canLog
                    ? "Start a timer or log your first entry."
                    : "No time has been logged yet."
              }
              emptyAction={
                canLog && !hasFilters ? (
                  <Button type="button" onClick={() => setDialogOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Log time
                  </Button>
                ) : undefined
              }
            />
            <Pagination pagination={entries.data?.pagination} onPageChange={params.setPage} />
          </>
        )}
      </div>

      {dialogOpen ? <LogEntryDialog open={dialogOpen} onOpenChange={setDialogOpen} /> : null}

      {rejectTarget ? (
        <RejectDialog
          entry={rejectTarget}
          onOpenChange={(next) => {
            if (!next) setRejectTarget(null);
          }}
          onReject={(note) => actionMutation.mutate({ id: rejectTarget.id, action: "reject", note })}
          isPending={actionMutation.isPending}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        title="Delete this time entry?"
        description={
          deleteTarget
            ? `${formatDuration(deleteTarget.durationMinutes)} logged ${formatDateTime(deleteTarget.startedAt)} will be permanently removed.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={actionMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) actionMutation.mutate({ id: deleteTarget.id, action: "delete" });
        }}
      />
    </div>
  );
}
