import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Ticket as TicketIcon } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiList, useApiQuery } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { clientDisplayName, formatRelative, humanize } from "@/lib/format";
import { OPTIONS } from "@/lib/status";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ErrorState } from "@/components/common/states";
import { SelectField, TextareaField, TextField } from "@/components/common/form";
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
import type { Client, PersonRef, Ticket } from "@/types";

interface PickedProject {
  id: string;
  name: string;
  projectNo: string;
  clientId: string;
}

const NONE = "NONE";

const createTicketSchema = z.object({
  clientId: z.string().min(1, "Select a client"),
  subject: z.string().trim().min(3, "Subject must be at least 3 characters"),
  description: z.string().trim().min(1, "Description is required"),
  category: z.string().min(1, "Select a category"),
  priority: z.string().min(1, "Select a priority"),
  projectId: z.string(),
  assignedToId: z.string(),
});

type CreateTicketValues = z.infer<typeof createTicketSchema>;

function FilterSelect({
  value,
  onValueChange,
  placeholder,
  options,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-full sm:w-44" aria-label={placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function TicketList() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const params = useListParams({ status: "ALL", priority: "ALL", category: "ALL", assignedToId: "ALL" });
  const [createOpen, setCreateOpen] = useState(false);

  const canCreate = can("tickets.create");
  // Users without tickets.viewAll only see tickets they created or are assigned to.
  const listPath = can("tickets.viewAll") ? "/tickets" : "/tickets/mine";

  const ticketsQuery = useApiList<Ticket>(qk.list("tickets", { ...params.query, path: listPath }), listPath, params.query);
  const assignableQuery = useApiQuery<PersonRef[]>(["users", "assignable"], "/users/assignable", undefined, {
    enabled: canCreate || params.filters.assignedToId !== "ALL",
  });

  const assigneeOptions = useMemo(
    () => [
      { value: "ALL", label: "All assignees" },
      ...(assignableQuery.data ?? []).map((user) => ({
        value: user.id,
        label: `${user.firstName} ${user.lastName}`,
      })),
    ],
    [assignableQuery.data],
  );

  const columns = useMemo<ColumnDef<Ticket, unknown>[]>(
    () => [
      {
        accessorKey: "ticketNo",
        header: "Ticket",
        cell: ({ row }) => <span className="font-mono text-xs font-medium text-primary">{row.original.ticketNo}</span>,
      },
      {
        accessorKey: "subject",
        header: "Subject",
        cell: ({ row }) => <p className="line-clamp-1 max-w-[22rem] font-medium">{row.original.subject}</p>,
        enableSorting: false,
      },
      {
        id: "client",
        header: "Client",
        accessorFn: (row) => clientDisplayName(row.client),
        cell: ({ row }) => <span className="line-clamp-1">{clientDisplayName(row.original.client)}</span>,
        enableSorting: false,
      },
      {
        accessorKey: "category",
        header: "Category",
        cell: ({ row }) => <span className="text-muted-foreground">{humanize(row.original.category)}</span>,
        enableSorting: false,
      },
      {
        accessorKey: "priority",
        header: "Priority",
        cell: ({ row }) => <StatusBadge status={row.original.priority} />,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "assignee",
        header: "Assignee",
        accessorFn: (row) => (row.assignedTo ? `${row.assignedTo.firstName} ${row.assignedTo.lastName}` : ""),
        cell: ({ row }) =>
          row.original.assignedTo ? (
            <span className="line-clamp-1">
              {row.original.assignedTo.firstName} {row.original.assignedTo.lastName}
            </span>
          ) : (
            <span className="text-xs italic text-muted-foreground">Unassigned</span>
          ),
        enableSorting: false,
      },
      {
        accessorKey: "updatedAt",
        header: "Updated",
        cell: ({ row }) => <span className="text-muted-foreground">{formatRelative(row.original.updatedAt)}</span>,
      },
    ],
    [],
  );

  const items = ticketsQuery.data?.items ?? [];
  const hasActiveFilters =
    params.debouncedSearch.trim() !== "" || Object.values(params.filters).some((value) => value !== "ALL");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support tickets"
        description="Track and resolve client support requests across the business."
        actions={
          canCreate ? (
            <Button
              onClick={() => {
                setCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New ticket
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput value={params.search} onChange={params.setSearch} placeholder="Search ticket no or subject..." />
        <FilterSelect
          value={params.filters.status}
          onValueChange={(value) => params.setFilter("status", value)}
          placeholder="Status"
          options={[{ value: "ALL", label: "All statuses" }, ...OPTIONS.ticketStatus.map((s) => ({ value: s, label: humanize(s) }))]}
        />
        <FilterSelect
          value={params.filters.priority}
          onValueChange={(value) => params.setFilter("priority", value)}
          placeholder="Priority"
          options={[{ value: "ALL", label: "All priorities" }, ...OPTIONS.priority.map((p) => ({ value: p, label: humanize(p) }))]}
        />
        <FilterSelect
          value={params.filters.category}
          onValueChange={(value) => params.setFilter("category", value)}
          placeholder="Category"
          options={[{ value: "ALL", label: "All categories" }, ...OPTIONS.ticketCategory.map((c) => ({ value: c, label: humanize(c) }))]}
        />
        <FilterSelect
          value={params.filters.assignedToId}
          onValueChange={(value) => params.setFilter("assignedToId", value)}
          placeholder="Assignee"
          options={assigneeOptions}
        />
        {hasActiveFilters ? (
          <Button variant="ghost" size="sm" onClick={params.resetFilters}>
            Reset
          </Button>
        ) : null}
      </FilterBar>

      {ticketsQuery.isError ? (
        <ErrorState
          title="Tickets could not be loaded"
          description={ticketsQuery.error instanceof Error ? ticketsQuery.error.message : undefined}
          onRetry={() => ticketsQuery.refetch()}
        />
      ) : (
        <div className="space-y-4">
          <DataTable
            columns={columns}
            data={items}
            isLoading={ticketsQuery.isLoading}
            emptyTitle="No tickets found"
            emptyDescription={
              hasActiveFilters
                ? "No tickets match the current search and filters."
                : "Support tickets raised by staff will appear here."
            }
            emptyAction={
              canCreate && !hasActiveFilters ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New ticket
                </Button>
              ) : null
            }
            onRowClick={(ticket) => navigate(`/tickets/${ticket.id}`)}
          />
          <Pagination pagination={ticketsQuery.data?.pagination} onPageChange={params.setPage} />
        </div>
      )}

      {createOpen ? <CreateTicketDialog onClose={() => setCreateOpen(false)} /> : null}
    </div>
  );
}

function CreateTicketDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<CreateTicketValues>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: {
      clientId: "",
      subject: "",
      description: "",
      category: "GENERAL",
      priority: "MEDIUM",
      projectId: NONE,
      assignedToId: NONE,
    },
  });

  const clientId = form.watch("clientId");

  const clientsQuery = useApiQuery<Client[]>(["clients", "picker"], "/clients", { limit: 200 });
  const assignableQuery = useApiQuery<PersonRef[]>(["users", "assignable"], "/users/assignable");
  const projectsQuery = useApiQuery<PickedProject[]>(
    ["projects", "picker", clientId],
    "/projects",
    { limit: 200, clientId },
    { enabled: Boolean(clientId) },
  );

  useEffect(() => {
    form.setValue("projectId", NONE);
  }, [clientId, form]);

  const clientOptions = useMemo(
    () =>
      (clientsQuery.data ?? []).map((client) => ({
        value: client.id,
        label: clientDisplayName(client),
      })),
    [clientsQuery.data],
  );

  const projectOptions = useMemo(
    () => [
      { value: NONE, label: "No project" },
      ...(projectsQuery.data ?? []).map((project) => ({
        value: project.id,
        label: `${project.projectNo} - ${project.name}`,
      })),
    ],
    [projectsQuery.data],
  );

  const assigneeOptions = useMemo(
    () => [
      { value: NONE, label: "Unassigned" },
      ...(assignableQuery.data ?? []).map((user) => ({
        value: user.id,
        label: `${user.firstName} ${user.lastName}`,
      })),
    ],
    [assignableQuery.data],
  );

  const submit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await api.post<Ticket>("/tickets", {
        clientId: values.clientId,
        subject: values.subject,
        description: values.description,
        category: values.category,
        priority: values.priority,
        projectId: values.projectId && values.projectId !== NONE ? values.projectId : undefined,
        assignedToId: values.assignedToId && values.assignedToId !== NONE ? values.assignedToId : undefined,
      });
      toastSuccess("Ticket created");
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      onClose();
    } catch (error) {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) {
        form.setError(key as keyof CreateTicketValues, { message });
      }
      if (Object.keys(fields).length === 0) {
        setSubmitError(error instanceof Error ? error.message : "The ticket could not be created.");
      }
      toastError(error);
    }
  });

  const saving = form.formState.isSubmitting;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New support ticket</DialogTitle>
          <DialogDescription>Log a support request on behalf of a client.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <SelectField
            form={form}
            name="clientId"
            label="Client"
            required
            placeholder={clientsQuery.isLoading ? "Loading clients..." : "Select a client"}
            options={clientOptions}
          />
          <TextField form={form} name="subject" label="Subject" required placeholder="Brief summary of the issue" />
          <TextareaField
            form={form}
            name="description"
            label="Description"
            required
            rows={5}
            placeholder="Describe the request or issue in detail..."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField form={form} name="category" label="Category" options={OPTIONS.ticketCategory} />
            <SelectField form={form} name="priority" label="Priority" options={OPTIONS.priority} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              form={form}
              name="projectId"
              label="Project"
              description={clientId ? undefined : "Select a client first"}
              disabled={!clientId}
              options={projectOptions}
            />
            <SelectField form={form} name="assignedToId" label="Assign to" options={assigneeOptions} />
          </div>

          {submitError ? <p className="text-xs font-medium text-destructive">{submitError}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <TicketIcon className="h-4 w-4" />}
              {saving ? "Creating..." : "Create ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
