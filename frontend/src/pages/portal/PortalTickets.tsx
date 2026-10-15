import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiList, useApiQuery } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { humanize, formatRelative } from "@/lib/format";
import { OPTIONS } from "@/lib/status";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import { SelectField, TextField, TextareaField } from "@/components/common/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorState } from "@/components/common/states";
import type { Project, Ticket } from "@/types";

const ticketSchema = z.object({
  subject: z.string().trim().min(3, "Subject must be at least 3 characters").max(200, "Subject is too long"),
  description: z.string().trim().min(1, "Please describe your request").max(10000, "Description is too long"),
  category: z.string().min(1),
  priority: z.string().min(1),
  projectId: z.string().optional(),
});

type TicketValues = z.infer<typeof ticketSchema>;

export default function PortalTickets() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const list = useListParams();
  const [dialogOpen, setDialogOpen] = useState(false);

  const canCreate = can("portal.tickets.create");
  const canPickProject = can("portal.projects.view");

  const statusFilter = list.filters.status || undefined;
  const ticketsQuery = useApiList<Ticket>(
    [...qk.portal.tickets, "list", { page: list.page, limit: list.limit, status: statusFilter ?? "" }],
    "/portal/tickets",
    { page: list.page, limit: list.limit, status: statusFilter },
  );

  // Client-owned projects, only needed while the new-ticket dialog is open.
  const projectsQuery = useApiQuery<Project[]>(
    [...qk.portal.tickets, "form-projects"],
    "/portal/projects",
    { limit: 200 },
    { enabled: dialogOpen && canPickProject },
  );

  // The portal ticket route only filters by status server-side; search and
  // priority are narrowed on the loaded page.
  const term = list.debouncedSearch.trim().toLowerCase();
  const priorityFilter = list.filters.priority || undefined;
  const rows = useMemo(() => {
    const items = ticketsQuery.data?.items ?? [];
    return items.filter((ticket) => {
      if (priorityFilter && ticket.priority !== priorityFilter) return false;
      if (!term) return true;
      return ticket.ticketNo.toLowerCase().includes(term) || ticket.subject.toLowerCase().includes(term);
    });
  }, [ticketsQuery.data, term, priorityFilter]);

  const form = useForm<TicketValues>({
    resolver: zodResolver(ticketSchema),
    defaultValues: { subject: "", description: "", category: "GENERAL", priority: "MEDIUM", projectId: "NONE" },
  });

  const createMutation = useMutation({
    mutationFn: (values: TicketValues) =>
      api.post<Ticket>("/portal/tickets", {
        subject: values.subject.trim(),
        description: values.description.trim(),
        category: values.category,
        priority: values.priority,
        ...(values.projectId && values.projectId !== "NONE" ? { projectId: values.projectId } : {}),
      }),
    onSuccess: (ticket) => {
      toastSuccess("Ticket submitted", `${ticket.ticketNo} was created and our team has been notified.`);
      queryClient.invalidateQueries({ queryKey: qk.portal.tickets });
      setDialogOpen(false);
      form.reset();
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) form.setError(key as keyof TicketValues, { message });
      toastError(error);
    },
  });

  const columns: ColumnDef<Ticket, unknown>[] = [
    {
      accessorKey: "ticketNo",
      header: "Ticket",
      cell: ({ row }) => <span className="font-medium">{row.original.ticketNo}</span>,
    },
    {
      accessorKey: "subject",
      header: "Subject",
      cell: ({ row }) => <span className="block max-w-md truncate">{row.original.subject}</span>,
    },
    {
      accessorKey: "category",
      header: "Category",
      enableSorting: false,
      cell: ({ row }) => <span className="text-muted-foreground">{humanize(row.original.category)}</span>,
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
      id: "messages",
      accessorFn: (ticket) => ticket._count?.messages ?? 0,
      header: "Replies",
      cell: ({ row }) => (
        <span className="block text-right text-muted-foreground">{row.original._count?.messages ?? 0}</span>
      ),
    },
    {
      accessorKey: "updatedAt",
      header: "Updated",
      cell: ({ row }) => <span className="text-muted-foreground">{formatRelative(row.original.updatedAt)}</span>,
    },
  ];

  const isFiltering = Boolean(term || statusFilter || priorityFilter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support tickets"
        description="Track requests and stay in the conversation with the 3xCode team."
        actions={
          canCreate ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              New ticket
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search number or subject..." />
        <Select value={list.filters.status || "ALL"} onValueChange={(value) => list.setFilter("status", value)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {OPTIONS.ticketStatus.map((status) => (
              <SelectItem key={status} value={status}>
                {humanize(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={list.filters.priority || "ALL"} onValueChange={(value) => list.setFilter("priority", value)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All priorities</SelectItem>
            {OPTIONS.priority.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {humanize(priority)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {ticketsQuery.isError ? (
        <ErrorState description="Your tickets could not be loaded." onRetry={() => void ticketsQuery.refetch()} />
      ) : (
        <div className="space-y-4">
          <DataTable
            columns={columns}
            data={rows}
            isLoading={ticketsQuery.isLoading}
            onRowClick={(ticket) => navigate(`/portal/tickets/${ticket.id}`)}
            emptyTitle={isFiltering ? "No matching tickets" : "No tickets yet"}
            emptyDescription={
              isFiltering
                ? "Try a different subject, status or priority."
                : canCreate
                  ? "Submit a ticket whenever you need help and our team will reply here."
                  : "Tickets raised for your account will appear here."
            }
            emptyAction={
              canCreate && !isFiltering ? (
                <Button variant="outline" onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New ticket
                </Button>
              ) : null
            }
          />
          <Pagination pagination={ticketsQuery.data?.pagination} onPageChange={list.setPage} />
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New support ticket</DialogTitle>
            <DialogDescription>
              Describe your request and our team will get back to you through this portal.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit((values) => createMutation.mutate(values))} className="space-y-4">
            <TextField form={form} name="subject" label="Subject" placeholder="Short summary of your request" required />
            <TextareaField
              form={form}
              name="description"
              label="Description"
              rows={6}
              placeholder="What do you need help with? Include any relevant details."
              required
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField form={form} name="category" label="Category" options={OPTIONS.ticketCategory} required />
              <SelectField form={form} name="priority" label="Priority" options={OPTIONS.priority} required />
            </div>
            {canPickProject && (projectsQuery.data?.length ?? 0) > 0 ? (
              <SelectField
                form={form}
                name="projectId"
                label="Related project (optional)"
                placeholder="Select a project"
                options={[
                  { value: "NONE", label: "No project" },
                  ...(projectsQuery.data ?? []).map((project) => ({
                    value: project.id,
                    label: `${project.projectNo} · ${project.name}`,
                  })),
                ]}
              />
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={createMutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Submit ticket
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
