import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, Pencil, Plus, Trash2, UserPlus } from "lucide-react";

import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiList } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { clientDisplayName, formatMoney, toDateInput } from "@/lib/format";
import { OPTIONS } from "@/lib/status";
import { currencyValue } from "@/lib/validation";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ErrorState } from "@/components/common/states";
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
import type { AssignableUser } from "@/pages/clients/ClientList";
import type { Client, Lead, PersonRef } from "@/types";

/** Full lead shape as returned by the leads routes (list includes `assignedTo`). */
interface LeadRow extends Lead {
  website: string | null;
  serviceInterest: string | null;
  assignedToId: string | null;
  convertedClientId: string | null;
  convertedAt: string | null;
  lostReason: string | null;
  lastContactAt: string | null;
  assignedTo?: PersonRef | null;
}

/** Radix `<SelectItem />` rejects empty values, so an explicit sentinel means "unassigned". */
const NO_ASSIGNEE = "none";

const INITIAL_FILTERS = { status: "ALL" };

const leadSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  phone: z.string().trim().max(40, "Phone is too long"),
  companyName: z.string().trim().max(160, "Company name is too long"),
  website: z.string().trim().max(255, "Website is too long"),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"]),
  source: z.string().trim().max(120, "Source is too long"),
  estimatedValue: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d+(\.\d{1,2})?$/.test(value), "Enter a valid amount"),
  currency: currencyValue,
  serviceInterest: z.string().trim().max(200, "Service interest is too long"),
  assignedToId: z.string(),
  lastContactAt: z.string(),
  notes: z.string().trim().max(5000, "Notes are too long"),
});

type LeadFormValues = z.infer<typeof leadSchema>;

const EMPTY_LEAD_VALUES: LeadFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  companyName: "",
  website: "",
  status: "NEW",
  source: "",
  estimatedValue: "",
  currency: "LKR",
  serviceInterest: "",
  assignedToId: NO_ASSIGNEE,
  lastContactAt: "",
  notes: "",
};

function asLeadStatus(value: string): LeadFormValues["status"] {
  return (OPTIONS.leadStatus as readonly string[]).includes(value)
    ? (value as LeadFormValues["status"])
    : "NEW";
}

function valuesFromLead(lead: LeadRow): LeadFormValues {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone ?? "",
    companyName: lead.companyName ?? "",
    website: lead.website ?? "",
    status: asLeadStatus(lead.status),
    source: lead.source ?? "",
    estimatedValue: lead.estimatedValue ?? "",
    currency: lead.currency || "LKR",
    serviceInterest: lead.serviceInterest ?? "",
    assignedToId: lead.assignedToId ?? NO_ASSIGNEE,
    lastContactAt: toDateInput(lead.lastContactAt),
    notes: lead.notes ?? "",
  };
}

function toLeadPayload(values: LeadFormValues) {
  const nullable = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  };
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    email: values.email,
    phone: nullable(values.phone),
    companyName: nullable(values.companyName),
    website: nullable(values.website),
    status: values.status,
    source: nullable(values.source),
    estimatedValue: values.estimatedValue === "" ? null : values.estimatedValue,
    currency: values.currency,
    serviceInterest: nullable(values.serviceInterest),
    assignedToId: values.assignedToId === NO_ASSIGNEE ? null : values.assignedToId,
    lastContactAt: values.lastContactAt === "" ? null : values.lastContactAt,
    notes: nullable(values.notes),
  };
}

/** Create/edit form for a lead. */
function LeadFormDialog({
  open,
  onOpenChange,
  lead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadRow | null;
}) {
  const queryClient = useQueryClient();
  const form = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: EMPTY_LEAD_VALUES,
  });

  const assignable = useQuery<AssignableUser[]>({
    queryKey: ["users", "assignable"],
    queryFn: () => api.get<AssignableUser[]>("/users/assignable"),
    retry: false,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(lead ? valuesFromLead(lead) : EMPTY_LEAD_VALUES);
  }, [open, lead, form]);

  const mutation = useMutation({
    mutationFn: (values: LeadFormValues) => {
      const payload = toLeadPayload(values);
      return lead ? api.patch<LeadRow>(`/leads/${lead.id}`, payload) : api.post<LeadRow>("/leads", payload);
    },
    onSuccess: () => {
      toastSuccess(lead ? "Lead updated" : "Lead created");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      onOpenChange(false);
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) {
        form.setError(key as keyof LeadFormValues, { message });
      }
      toastError(error);
    },
  });

  const assigneeOptions = [
    { value: NO_ASSIGNEE, label: "Unassigned" },
    ...(assignable.data ?? []).map((user) => ({
      value: user.id,
      label: `${user.firstName} ${user.lastName}`,
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lead ? "Edit lead" : "New lead"}</DialogTitle>
          <DialogDescription>
            {lead
              ? "Update the details captured for this lead."
              : "Record a new enquiry so it never slips through the cracks."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="firstName" label="First name" required />
            <TextField form={form} name="lastName" label="Last name" required />
            <TextField form={form} name="email" label="Email" type="email" required />
            <TextField form={form} name="phone" label="Phone" />
            <TextField form={form} name="companyName" label="Company" />
            <TextField form={form} name="website" label="Website" placeholder="https://" />
            <SelectField form={form} name="status" label="Status" options={OPTIONS.leadStatus} />
            <TextField form={form} name="source" label="Source" placeholder="e.g. Website, Referral" />
            <TextField
              form={form}
              name="estimatedValue"
              label="Estimated value"
              type="number"
              min={0}
              step="0.01"
              placeholder="0.00"
            />
            <TextField
              form={form}
              name="currency"
              label="Currency"
              description="Three-letter ISO code, e.g. LKR"
              required
            />
            <TextField form={form} name="serviceInterest" label="Service interest" />
            <TextField form={form} name="lastContactAt" label="Last contact" type="date" />
            <SelectField
              form={form}
              name="assignedToId"
              label="Assigned to"
              options={assigneeOptions}
              placeholder="Unassigned"
            />
          </div>

          <TextareaField form={form} name="notes" label="Notes" rows={3} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {lead ? "Save changes" : "Create lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Small labelled `<Select>` used for list filters (sentinel value `ALL` = no filter). */
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-44" aria-label={label}>
        <SelectValue placeholder={label} />
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

export default function LeadList() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const params = useListParams(INITIAL_FILTERS);
  const list = useApiList<LeadRow>(qk.list("leads", params.query), "/leads", params.query);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LeadRow | null>(null);
  const [deleting, setDeleting] = useState<LeadRow | null>(null);
  const [converting, setConverting] = useState<LeadRow | null>(null);

  const hasFilters = params.search.trim() !== "" || params.filters.status !== "ALL";

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (lead: LeadRow) => {
    setEditing(lead);
    setDialogOpen(true);
  };

  const handleDialogChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) setEditing(null);
  };

  const deleteMutation = useMutation({
    mutationFn: (leadId: string) => api.del<void>(`/leads/${leadId}`),
    onSuccess: () => {
      toastSuccess("Lead deleted");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (error) => toastError(error),
  });

  const convertMutation = useMutation({
    mutationFn: (leadId: string) => api.post<Client>(`/leads/${leadId}/convert`, {}),
    onSuccess: (client) => {
      toastSuccess("Lead converted to client", `${clientDisplayName(client)} is now an active client.`);
      setConverting(null);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error) => toastError(error),
  });

  const columns: ColumnDef<LeadRow, unknown>[] = [
    {
      id: "name",
      accessorFn: (row) => `${row.firstName} ${row.lastName}`,
      header: "Name",
      cell: ({ row }) => (
        <span className="font-medium text-foreground">
          {row.original.firstName} {row.original.lastName}
        </span>
      ),
    },
    {
      accessorKey: "companyName",
      header: "Company",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.companyName || "-"}</span>,
    },
    {
      accessorKey: "email",
      header: "Email",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.email}</span>,
    },
    {
      accessorKey: "source",
      header: "Source",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.source || "-"}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "estimatedValue",
      header: "Est. value",
      cell: ({ row }) => (
        <span className="font-medium text-foreground">
          {row.original.estimatedValue ? formatMoney(row.original.estimatedValue, row.original.currency) : "-"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          {can("leads.convert") && !row.original.convertedClientId ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Convert to client"
              onClick={() => setConverting(row.original)}
            >
              <UserPlus className="h-4 w-4" />
            </Button>
          ) : null}
          {can("leads.update") ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Edit lead"
              onClick={() => openEdit(row.original)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          ) : null}
          {can("leads.delete") ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-danger hover:text-danger/80"
              title="Delete lead"
              onClick={() => setDeleting(row.original)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Every enquiry in the pipeline, from first contact through to conversion."
        actions={
          can("leads.create") ? (
            <Button type="button" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              New lead
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <SearchInput
          value={params.search}
          onChange={params.setSearch}
          placeholder="Search name, company, email..."
        />
        <FilterSelect
          label="Status"
          value={params.filters.status}
          onChange={(value) => params.setFilter("status", value)}
          options={[
            { value: "ALL", label: "All statuses" },
            ...OPTIONS.leadStatus.map((status) => ({ value: status, label: status.replace(/_/g, " ") })),
          ]}
        />
        {hasFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={params.resetFilters}>
            Reset filters
          </Button>
        ) : null}
      </FilterBar>

      <div className="space-y-4">
        {list.isError ? (
          <ErrorState
            description={list.error instanceof Error ? list.error.message : "Leads could not be loaded."}
            onRetry={() => list.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            data={list.data?.items ?? []}
            isLoading={list.isLoading}
            emptyTitle="No leads found"
            emptyDescription={
              hasFilters
                ? "No lead matches your search or filters. Try adjusting them."
                : "Capture your first lead to start building your pipeline."
            }
            emptyAction={
              can("leads.create") ? (
                <Button type="button" onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  New lead
                </Button>
              ) : undefined
            }
            footer={<Pagination pagination={list.data?.pagination} onPageChange={params.setPage} />}
          />
        )}
      </div>

      <LeadFormDialog open={dialogOpen} onOpenChange={handleDialogChange} lead={editing} />

      <ConfirmDialog
        open={Boolean(converting)}
        onOpenChange={(open) => {
          if (!open) setConverting(null);
        }}
        title="Convert lead to client?"
        description={
          converting
            ? `${converting.firstName} ${converting.lastName} will become a client record and this lead will be marked as Won.`
            : undefined
        }
        confirmLabel="Convert to client"
        loading={convertMutation.isPending}
        onConfirm={() => {
          if (converting) convertMutation.mutate(converting.id);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete lead?"
        description={
          deleting
            ? `${deleting.firstName} ${deleting.lastName} will be permanently removed. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting.id);
        }}
      />
    </div>
  );
}
