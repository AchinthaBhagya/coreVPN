import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { useApiList, useApiQuery } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { currencyValue } from "@/lib/validation";
import { clientDisplayName, formatDate, isOverdue, toDateInput } from "@/lib/format";
import { OPTIONS, statusLabel } from "@/lib/status";
import type { Client, PersonRef, Project, Service } from "@/types";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ErrorState } from "@/components/common/states";
import { SelectField, TextField, TextareaField } from "@/components/common/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

const projectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required"),
  clientId: z.string().min(1, "Select a client"),
  serviceId: z.string().optional(),
  managerId: z.string().optional(),
  budget: z.string().optional(),
  currency: currencyValue,
  startDate: z.string().optional(),
  deadline: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  status: z.enum([
    "INQUIRY",
    "QUOTATION",
    "AWAITING_PAYMENT",
    "PLANNING",
    "IN_PROGRESS",
    "ON_HOLD",
    "REVIEW",
    "CLIENT_APPROVAL",
    "REVISION_REQUESTED",
    "COMPLETED",
    "CANCELLED",
  ]),
  estimatedHours: z.string().optional(),
  progress: z.number().min(0).max(100),
  description: z.string().optional(),
  internalNotes: z.string().optional(),
  tags: z.string().optional(),
});

type ProjectFormValues = z.infer<typeof projectSchema>;

const DEFAULT_VALUES: ProjectFormValues = {
  name: "",
  clientId: "",
  serviceId: "NONE",
  managerId: "NONE",
  budget: "",
  currency: "LKR",
  startDate: "",
  deadline: "",
  priority: "MEDIUM",
  status: "PLANNING",
  estimatedHours: "",
  progress: 0,
  description: "",
  internalNotes: "",
  tags: "",
};

/** Maps the form onto the create/patch body. Empty strings become null/undefined. */
function buildProjectPayload(values: ProjectFormValues) {
  return {
    name: values.name.trim(),
    clientId: values.clientId,
    serviceId: values.serviceId && values.serviceId !== "NONE" ? values.serviceId : null,
    managerId: values.managerId && values.managerId !== "NONE" ? values.managerId : null,
    budget: values.budget?.trim() || undefined,
    currency: values.currency,
    startDate: values.startDate || undefined,
    deadline: values.deadline || undefined,
    priority: values.priority,
    status: values.status,
    estimatedHours: values.estimatedHours?.trim() || undefined,
    progress: values.progress,
    description: values.description?.trim() || null,
    internalNotes: values.internalNotes?.trim() || null,
    tags: (values.tags ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

/**
 * Create/edit dialog for projects. Shared with ProjectDetail (named export);
 * fetches its own option lists so it only loads them while mounted.
 */
export function ProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = useAuth();
  const form = useForm<ProjectFormValues>({ resolver: zodResolver(projectSchema), defaultValues: DEFAULT_VALUES });

  const clients = useApiList<Client>(qk.list("clients", { limit: 200 }), "/clients", { limit: 200 }, { enabled: can("clients.view") });
  const services = useApiQuery<Service[]>(["services", "options"], "/services", { limit: 200 }, { enabled: can("services.view") });
  const assignable = useApiQuery<PersonRef[]>(["users", "assignable"], "/users/assignable", undefined, { enabled: can("users.view") });

  useEffect(() => {
    if (!open) return;
    if (project) {
      form.reset({
        name: project.name,
        clientId: project.clientId,
        serviceId: project.serviceId ?? "NONE",
        managerId: project.managerId ?? "NONE",
        budget: project.budget ?? "",
        currency: project.currency || "LKR",
        startDate: toDateInput(project.startDate),
        deadline: toDateInput(project.deadline),
        priority: project.priority as ProjectFormValues["priority"],
        status: project.status as ProjectFormValues["status"],
        estimatedHours: project.estimatedHours ?? "",
        progress: project.progress ?? 0,
        description: project.description ?? "",
        internalNotes: project.internalNotes ?? "",
        tags: (project.tags ?? []).join(", "),
      });
    } else {
      form.reset(DEFAULT_VALUES);
    }
  }, [open, project, form]);

  const mutation = useMutation({
    mutationFn: (values: ProjectFormValues) =>
      project ? api.patch(`/projects/${project.id}`, buildProjectPayload(values)) : api.post("/projects", buildProjectPayload(values)),
    onSuccess: () => {
      toastSuccess(project ? "Project updated" : "Project created");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onOpenChange(false);
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) form.setError(key as keyof ProjectFormValues, { message });
      toastError(error);
    },
  });

  const clientOptions = (clients.data?.items ?? []).map((client) => ({ value: client.id, label: clientDisplayName(client) }));
  const serviceOptions = [
    { value: "NONE", label: "No service" },
    ...(services.data ?? []).map((service) => ({ value: service.id, label: service.name })),
  ];
  const managerOptions = [
    { value: "NONE", label: "Not set" },
    ...(assignable.data ?? []).map((user) => ({ value: user.id, label: `${user.firstName} ${user.lastName}` })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>
            {project ? `Update the details of ${project.projectNo}.` : "Capture the commercial and delivery details of a new engagement."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4" noValidate>
          <TextField form={form} name="name" label="Project name" required placeholder="Website redesign" />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              form={form}
              name="clientId"
              label="Client"
              required
              options={clientOptions}
              placeholder={clients.isLoading ? "Loading clients..." : "Select a client"}
              description={clients.isError ? "The client directory could not be loaded." : undefined}
            />
            <SelectField form={form} name="serviceId" label="Service" options={serviceOptions} placeholder="Select a service" />
            <SelectField form={form} name="managerId" label="Manager" options={managerOptions} placeholder="Select a manager" />
            <TextField form={form} name="budget" label="Budget" type="number" min="0" step="0.01" placeholder="0.00" />
            <TextField form={form} name="currency" label="Currency" required maxLength={3} placeholder="LKR" description="Three-letter ISO code" />
            <SelectField form={form} name="status" label="Status" options={[...OPTIONS.projectStatus]} required />
            <SelectField form={form} name="priority" label="Priority" options={[...OPTIONS.priority]} required />
            <TextField form={form} name="estimatedHours" label="Estimated hours" type="number" min="0" step="0.5" />
            <TextField form={form} name="startDate" label="Start date" type="date" />
            <TextField form={form} name="deadline" label="Deadline" type="date" />
          </div>

          <Controller
            control={form.control}
            name="progress"
            render={({ field }) => (
              <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground">Progress</span>
                  <span className="text-foreground">{field.value}%</span>
                </div>
                <Slider value={[field.value]} onValueChange={(next) => field.onChange(next[0])} max={100} step={1} />
              </div>
            )}
          />

          <TextareaField form={form} name="description" label="Description" rows={4} />
          <TextareaField form={form} name="internalNotes" label="Internal notes" rows={3} description="Never shared with the client portal." />
          <TextField form={form} name="tags" label="Tags" placeholder="design, retainer, urgent" description="Comma separated." />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {project ? "Save changes" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectList() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const params = useListParams({ status: "", priority: "", clientId: "" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const canCreate = can("projects.create");
  const canUpdate = can("projects.update");
  const canDelete = can("projects.delete");

  const clients = useApiList<Client>(qk.list("clients", { limit: 200 }), "/clients", { limit: 200 }, { enabled: can("clients.view") });
  const projects = useApiList<Project>(qk.list("projects", params.query), "/projects", params.query);

  const deleteMutation = useMutation({
    mutationFn: (projectId: string) => api.del(`/projects/${projectId}`),
    onSuccess: () => {
      toastSuccess("Project archived");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDeleteTarget(null);
    },
    onError: (error) => toastError(error),
  });

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditing(project);
    setDialogOpen(true);
  };

  const columns: ColumnDef<Project, unknown>[] = [
    { accessorKey: "projectNo", header: "Project No." },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
    },
    { id: "client", header: "Client", enableSorting: false, cell: ({ row }) => clientDisplayName(row.original.client) },
    {
      id: "manager",
      header: "Manager",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.manager ? `${row.original.manager.firstName} ${row.original.manager.lastName}` : "-",
    },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { accessorKey: "priority", header: "Priority", cell: ({ row }) => <StatusBadge status={row.original.priority} /> },
    {
      accessorKey: "progress",
      header: "Progress",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Progress value={row.original.progress} className="h-1.5 w-20" />
          <span className="text-xs text-muted-foreground">{row.original.progress}%</span>
        </div>
      ),
    },
    {
      accessorKey: "deadline",
      header: "Deadline",
      cell: ({ row }) => {
        const overdue =
          isOverdue(row.original.deadline) && !["COMPLETED", "CANCELLED"].includes(row.original.status);
        return <span className={overdue ? "text-danger" : undefined}>{formatDate(row.original.deadline)}</span>;
      },
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          {canUpdate ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Edit project"
              onClick={() => openEdit(row.original)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-danger hover:text-danger/80"
              aria-label="Archive project"
              onClick={() => setDeleteTarget(row.original)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const clientFilterOptions = (clients.data?.items ?? []).map((client) => ({
    value: client.id,
    label: clientDisplayName(client),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Delivery, budgets and deadlines across every engagement."
        actions={
          canCreate ? (
            <Button type="button" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              New project
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput value={params.search} onChange={params.setSearch} placeholder="Search name or project no..." />
        <Select value={params.filters.status || "ALL"} onValueChange={(value) => params.setFilter("status", value)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {OPTIONS.projectStatus.map((status) => (
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
        <Select value={params.filters.clientId || "ALL"} onValueChange={(value) => params.setFilter("clientId", value)}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All clients</SelectItem>
            {clientFilterOptions.map((client) => (
              <SelectItem key={client.value} value={client.value}>
                {client.label}
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
        {projects.isError ? (
          <ErrorState
            description={projects.error instanceof Error ? projects.error.message : "The projects could not be loaded."}
            onRetry={() => projects.refetch()}
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              data={projects.data?.items ?? []}
              isLoading={projects.isLoading}
              onRowClick={(row) => navigate(`/projects/${row.id}`)}
              emptyTitle="No projects yet"
              emptyDescription="Create your first project to start tracking delivery."
              emptyAction={
                canCreate ? (
                  <Button type="button" onClick={openCreate}>
                    <Plus className="h-4 w-4" />
                    New project
                  </Button>
                ) : undefined
              }
            />
            <Pagination pagination={projects.data?.pagination} onPageChange={params.setPage} />
          </>
        )}
      </div>

      {dialogOpen ? (
        <ProjectDialog
          project={editing}
          open={dialogOpen}
          onOpenChange={(next) => {
            setDialogOpen(next);
            if (!next) setEditing(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        title="Archive this project?"
        description={
          deleteTarget
            ? `${deleteTarget.projectNo} · ${deleteTarget.name} will be archived and marked as cancelled.`
            : undefined
        }
        confirmLabel="Archive"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
