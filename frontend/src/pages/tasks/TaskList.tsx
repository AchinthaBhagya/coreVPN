import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, MessageSquare, Pencil, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { useApiList, useApiQuery } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { formatDate, isOverdue, toDateInput } from "@/lib/format";
import { OPTIONS, statusLabel } from "@/lib/status";
import type { PersonRef, Project, Task } from "@/types";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ErrorState, LoadingState } from "@/components/common/states";
import { SelectField, SwitchField, TextField, TextareaField } from "@/components/common/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const taskSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().optional(),
  projectId: z.string().optional(),
  assigneeId: z.string().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DONE", "CANCELLED"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  estimatedHours: z.string().optional(),
  labels: z.string().optional(),
});

type TaskFormValues = z.infer<typeof taskSchema>;

const DEFAULT_VALUES: TaskFormValues = {
  title: "",
  description: "",
  projectId: "NONE",
  assigneeId: "NONE",
  status: "TODO",
  priority: "MEDIUM",
  startDate: "",
  dueDate: "",
  estimatedHours: "",
  labels: "",
};

function buildTaskPayload(values: TaskFormValues) {
  return {
    title: values.title.trim(),
    description: values.description?.trim() || null,
    projectId: values.projectId && values.projectId !== "NONE" ? values.projectId : null,
    assigneeId: values.assigneeId && values.assigneeId !== "NONE" ? values.assigneeId : null,
    status: values.status,
    priority: values.priority,
    startDate: values.startDate || undefined,
    dueDate: values.dueDate || undefined,
    estimatedHours: values.estimatedHours?.trim() || undefined,
    labels: (values.labels ?? "")
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean),
  };
}

/** Create/edit dialog for tasks. Fetches its own pickers so it only loads while open. */
function TaskDialog({
  task,
  onOpenChange,
}: {
  task: Task | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = useAuth();
  const form = useForm<TaskFormValues>({ resolver: zodResolver(taskSchema), defaultValues: DEFAULT_VALUES });

  const projects = useApiList<Project>(qk.list("projects", { limit: 200 }), "/projects", { limit: 200 }, {
    enabled: can("projects.view"),
  });
  const assignable = useApiQuery<PersonRef[]>(["users", "assignable"], "/users/assignable", undefined, {
    enabled: can("users.view"),
  });

  useEffect(() => {
    if (task) {
      form.reset({
        title: task.title,
        description: task.description ?? "",
        projectId: task.projectId ?? "NONE",
        assigneeId: task.assigneeId ?? "NONE",
        status: task.status as TaskFormValues["status"],
        priority: task.priority as TaskFormValues["priority"],
        startDate: toDateInput(task.startDate),
        dueDate: toDateInput(task.dueDate),
        estimatedHours: task.estimatedHours ?? "",
        labels: (task.labels ?? []).join(", "),
      });
    } else {
      form.reset(DEFAULT_VALUES);
    }
  }, [task, form]);

  const mutation = useMutation({
    mutationFn: (values: TaskFormValues) =>
      task ? api.patch(`/tasks/${task.id}`, buildTaskPayload(values)) : api.post("/tasks", buildTaskPayload(values)),
    onSuccess: () => {
      toastSuccess(task ? "Task updated" : "Task created");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onOpenChange(false);
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) form.setError(key as keyof TaskFormValues, { message });
      toastError(error);
    },
  });

  const projectOptions = [
    { value: "NONE", label: "No project" },
    ...(projects.data?.items ?? []).map((project) => ({
      value: project.id,
      label: `${project.projectNo} · ${project.name}`,
    })),
  ];
  const assigneeOptions = [
    { value: "NONE", label: "Unassigned" },
    ...(assignable.data ?? []).map((user) => ({
      value: user.id,
      label: `${user.firstName} ${user.lastName}`,
    })),
  ];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            {task ? "Update the details of this task." : "Break the work down into an actionable task."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4" noValidate>
          <TextField form={form} name="title" label="Title" required placeholder="Build landing page" />
          <TextareaField form={form} name="description" label="Description" rows={3} />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField form={form} name="projectId" label="Project" options={projectOptions} placeholder="Select a project" />
            <SelectField form={form} name="assigneeId" label="Assignee" options={assigneeOptions} placeholder="Select an assignee" />
            <SelectField form={form} name="status" label="Status" options={[...OPTIONS.taskStatus]} required />
            <SelectField form={form} name="priority" label="Priority" options={[...OPTIONS.priority]} required />
            <TextField form={form} name="startDate" label="Start date" type="date" />
            <TextField form={form} name="dueDate" label="Due date" type="date" />
            <TextField form={form} name="estimatedHours" label="Estimated hours" type="number" min="0" step="0.5" />
            <TextField form={form} name="labels" label="Labels" placeholder="design, backend" description="Comma separated." />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {task ? "Save changes" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const commentSchema = z.object({
  body: z.string().trim().min(1, "Write a comment first").max(5000),
  isInternal: z.boolean(),
});

type CommentFormValues = z.infer<typeof commentSchema>;

/** Side dialog with the full task summary and its comment thread. */
function TaskCommentsDialog({
  taskId,
  onOpenChange,
  canComment,
}: {
  taskId: string;
  onOpenChange: (open: boolean) => void;
  canComment: boolean;
}) {
  const taskQuery = useApiQuery<Task>(qk.detail("tasks", taskId), `/tasks/${taskId}`);
  const form = useForm<CommentFormValues>({
    resolver: zodResolver(commentSchema),
    defaultValues: { body: "", isInternal: true },
  });

  const commentMutation = useMutation({
    mutationFn: (values: CommentFormValues) =>
      api.post(`/tasks/${taskId}/comments`, { body: values.body.trim(), isInternal: values.isInternal }),
    onSuccess: () => {
      toastSuccess("Comment posted");
      form.reset({ body: "", isInternal: true });
      queryClient.invalidateQueries({ queryKey: qk.detail("tasks", taskId) });
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) form.setError(key as keyof CommentFormValues, { message });
      toastError(error);
    },
  });

  const task = taskQuery.data;
  const comments = task?.comments ?? [];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{task?.title ?? "Task"}</DialogTitle>
          <DialogDescription>
            {task?.project ? `${task.project.projectNo} · ${task.project.name}` : "No project"}
          </DialogDescription>
        </DialogHeader>

        {taskQuery.isLoading ? (
          <LoadingState label="Loading task..." />
        ) : taskQuery.isError || !task ? (
          <ErrorState
            description={taskQuery.error instanceof Error ? taskQuery.error.message : "This task could not be loaded."}
            onRetry={() => taskQuery.refetch()}
          />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={task.status} />
              <StatusBadge status={task.priority} />
              {(task.labels ?? []).map((label) => (
                <Badge key={label} variant="muted">
                  {label}
                </Badge>
              ))}
            </div>

            {task.description ? (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p>
            ) : null}

            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Assignee</dt>
                <dd>{task.assignee ? `${task.assignee.firstName} ${task.assignee.lastName}` : "Unassigned"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Reporter</dt>
                <dd>{task.reporter ? `${task.reporter.firstName} ${task.reporter.lastName}` : "-"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Start</dt>
                <dd>{formatDate(task.startDate)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Due</dt>
                <dd className={isOverdue(task.dueDate) && task.status !== "DONE" ? "text-danger" : undefined}>
                  {formatDate(task.dueDate)}
                </dd>
              </div>
            </dl>

            <Separator />

            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">Comments ({comments.length})</p>
              {comments.length === 0 ? (
                <p className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                  No comments yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {comments.map((comment) => (
                    <li key={comment.id} className="rounded-lg border border-border bg-muted/20 p-3">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium text-foreground">
                          {comment.author ? `${comment.author.firstName} ${comment.author.lastName}` : "Team member"}
                        </p>
                        <div className="flex items-center gap-2">
                          {comment.isInternal ? <Badge variant="muted">Internal</Badge> : null}
                          <span className="text-xs text-muted-foreground">{formatDate(comment.createdAt, "dd MMM yyyy, HH:mm")}</span>
                        </div>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{comment.body}</p>
                    </li>
                  ))}
                </ul>
              )}

              {canComment ? (
                <form
                  onSubmit={form.handleSubmit((values) => commentMutation.mutate(values))}
                  className="space-y-3 rounded-lg border border-border bg-muted/20 p-3"
                  noValidate
                >
                  <TextareaField form={form} name="body" label="Add a comment" rows={3} placeholder="Share an update with the team..." />
                  <SwitchField form={form} name="isInternal" label="Internal only" description="Internal comments are never shown to clients." />
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" disabled={commentMutation.isPending}>
                      {commentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                      Comment
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function TaskList() {
  const { can } = useAuth();
  const [searchParams] = useSearchParams();
  const params = useListParams({
    status: "",
    priority: "",
    projectId: searchParams.get("projectId") ?? "",
    assigneeId: "",
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const canCreate = can("tasks.create");
  const canUpdate = can("tasks.update");

  const tasks = useApiList<Task>(qk.list("tasks", params.query), "/tasks", params.query);
  const projects = useApiList<Project>(qk.list("projects", { limit: 200 }), "/projects", { limit: 200 }, {
    enabled: can("projects.view"),
  });
  const assignable = useApiQuery<PersonRef[]>(["users", "assignable"], "/users/assignable", undefined, {
    enabled: can("users.view"),
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; status: string }) => api.patch(`/tasks/${vars.id}`, { status: vars.status }),
    onSuccess: () => {
      toastSuccess("Task updated");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => toastError(error),
  });

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const columns: ColumnDef<Task, unknown>[] = [
    {
      accessorKey: "title",
      header: "Task",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{row.original.title}</span>
          {row.original._count?.comments ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <MessageSquare className="h-3 w-3" />
              {row.original._count.comments}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "project",
      header: "Project",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.project ? `${row.original.project.projectNo} · ${row.original.project.name}` : "-",
    },
    {
      id: "assignee",
      header: "Assignee",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.assignee
          ? `${row.original.assignee.firstName} ${row.original.assignee.lastName}`
          : <span className="text-muted-foreground">Unassigned</span>,
    },
    {
      id: "status",
      header: "Status",
      enableSorting: false,
      cell: ({ row }) =>
        canUpdate ? (
          <Select
            value={row.original.status}
            onValueChange={(status) => statusMutation.mutate({ id: row.original.id, status })}
          >
            <SelectTrigger className="h-9 w-36" aria-label={`Status for ${row.original.title}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPTIONS.taskStatus.map((status) => (
                <SelectItem key={status} value={status}>
                  {statusLabel(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <StatusBadge status={row.original.status} />
        ),
    },
    { accessorKey: "priority", header: "Priority", cell: ({ row }) => <StatusBadge status={row.original.priority} /> },
    {
      accessorKey: "dueDate",
      header: "Due date",
      cell: ({ row }) => {
        const overdue =
          isOverdue(row.original.dueDate) && !["DONE", "CANCELLED"].includes(row.original.status);
        return <span className={overdue ? "text-danger" : undefined}>{formatDate(row.original.dueDate)}</span>;
      },
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Comments"
            onClick={() => setDetailId(row.original.id)}
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
          {canUpdate ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Edit task"
              onClick={() => {
                setEditing(row.original);
                setDialogOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="Everything the team is working on, across every project."
        actions={
          canCreate ? (
            <Button type="button" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              New task
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput value={params.search} onChange={params.setSearch} placeholder="Search title or description..." />
        <Select value={params.filters.status || "ALL"} onValueChange={(value) => params.setFilter("status", value)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {OPTIONS.taskStatus.map((status) => (
              <SelectItem key={status} value={status}>
                {statusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={params.filters.priority || "ALL"} onValueChange={(value) => params.setFilter("priority", value)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All priorities</SelectItem>
            {OPTIONS.priority.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {statusLabel(priority)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={params.filters.projectId || "ALL"} onValueChange={(value) => params.setFilter("projectId", value)}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All projects</SelectItem>
            {(projects.data?.items ?? []).map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.projectNo} · {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={params.filters.assigneeId || "ALL"} onValueChange={(value) => params.setFilter("assigneeId", value)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All assignees</SelectItem>
            {(assignable.data ?? []).map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.firstName} {user.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {params.debouncedSearch || Object.values(params.filters).some(Boolean) ? (
          <Button type="button" variant="ghost" size="sm" onClick={params.resetFilters}>
            Reset filters
          </Button>
        ) : null}
      </FilterBar>

      <div className="space-y-4">
        {tasks.isError ? (
          <ErrorState
            description={tasks.error instanceof Error ? tasks.error.message : "Tasks could not be loaded."}
            onRetry={() => tasks.refetch()}
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              data={tasks.data?.items ?? []}
              isLoading={tasks.isLoading}
              emptyTitle="No tasks found"
              emptyDescription="Adjust the filters or create a task to get started."
              emptyAction={
                canCreate ? (
                  <Button type="button" onClick={openCreate}>
                    <Plus className="h-4 w-4" />
                    New task
                  </Button>
                ) : undefined
              }
            />
            <Pagination pagination={tasks.data?.pagination} onPageChange={params.setPage} />
          </>
        )}
      </div>

      {dialogOpen ? (
        <TaskDialog
          task={editing}
          onOpenChange={(next) => {
            setDialogOpen(next);
            if (!next) setEditing(null);
          }}
        />
      ) : null}

      {detailId ? (
        <TaskCommentsDialog
          taskId={detailId}
          canComment={canUpdate}
          onOpenChange={(next) => {
            if (!next) setDetailId(null);
          }}
        />
      ) : null}
    </div>
  );
}
