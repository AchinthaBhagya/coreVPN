import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, FileDown, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { api, downloadBlob } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiList } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { clientDisplayName, formatDate } from "@/lib/format";
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
import type { Client } from "@/types";

/** Lightweight directory entry returned by `GET /users/assignable`. */
export interface AssignableUser {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  email: string;
}

/** Radix `<SelectItem />` rejects empty values, so an explicit sentinel means "unassigned". */
const NO_MANAGER = "none";

const INITIAL_FILTERS = { status: "ALL", type: "ALL" };

const clientSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  phone: z.string().trim().max(40, "Phone is too long"),
  companyName: z.string().trim().max(160, "Company name is too long"),
  type: z.enum(["INDIVIDUAL", "BUSINESS"]),
  status: z.enum(["LEAD", "PROSPECT", "ACTIVE", "INACTIVE", "ARCHIVED"]),
  currency: currencyValue,
  website: z.string().trim().max(255, "Website is too long"),
  address: z.string().trim().max(1000, "Address is too long"),
  city: z.string().trim().max(120, "City is too long"),
  country: z.string().trim().max(120, "Country is too long"),
  taxId: z.string().trim().max(80, "Tax ID is too long"),
  leadSource: z.string().trim().max(120, "Lead source is too long"),
  accountManagerId: z.string(),
  notes: z.string().trim().max(5000, "Notes are too long"),
});

type ClientFormValues = z.infer<typeof clientSchema>;

const EMPTY_CLIENT_VALUES: ClientFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  companyName: "",
  type: "BUSINESS",
  status: "ACTIVE",
  currency: "LKR",
  website: "",
  address: "",
  city: "",
  country: "",
  taxId: "",
  leadSource: "",
  accountManagerId: NO_MANAGER,
  notes: "",
};

function asClientType(value: string): ClientFormValues["type"] {
  return value === "INDIVIDUAL" ? "INDIVIDUAL" : "BUSINESS";
}

function asClientStatus(value: string): ClientFormValues["status"] {
  return (OPTIONS.clientStatus as readonly string[]).includes(value)
    ? (value as ClientFormValues["status"])
    : "ACTIVE";
}

function valuesFromClient(client: Client): ClientFormValues {
  return {
    firstName: client.firstName,
    lastName: client.lastName,
    email: client.email,
    phone: client.phone ?? "",
    companyName: client.companyName ?? "",
    type: asClientType(client.type),
    status: asClientStatus(client.status),
    currency: client.currency || "LKR",
    website: client.website ?? "",
    address: client.address ?? "",
    city: client.city ?? "",
    country: client.country ?? "",
    taxId: client.taxId ?? "",
    leadSource: client.leadSource ?? "",
    accountManagerId: client.accountManagerId ?? NO_MANAGER,
    notes: client.notes ?? "",
  };
}

/** Empty optional strings become `null` so clearing a field actually clears it. */
function toClientPayload(values: ClientFormValues) {
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
    type: values.type,
    status: values.status,
    currency: values.currency,
    website: nullable(values.website),
    address: nullable(values.address),
    city: nullable(values.city),
    country: nullable(values.country),
    taxId: nullable(values.taxId),
    leadSource: nullable(values.leadSource),
    accountManagerId: values.accountManagerId === NO_MANAGER ? null : values.accountManagerId,
    notes: nullable(values.notes),
  };
}

/** Create/edit form shared by the client list and the client detail screen. */
export function ClientFormDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client | null;
}) {
  const queryClient = useQueryClient();
  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: EMPTY_CLIENT_VALUES,
  });

  const assignable = useQuery<AssignableUser[]>({
    queryKey: ["users", "assignable"],
    queryFn: () => api.get<AssignableUser[]>("/users/assignable"),
    retry: false,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(client ? valuesFromClient(client) : EMPTY_CLIENT_VALUES);
  }, [open, client, form]);

  const mutation = useMutation({
    mutationFn: (values: ClientFormValues) => {
      const payload = toClientPayload(values);
      return client ? api.patch<Client>(`/clients/${client.id}`, payload) : api.post<Client>("/clients", payload);
    },
    onSuccess: () => {
      toastSuccess(client ? "Client updated" : "Client created");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      onOpenChange(false);
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) {
        form.setError(key as keyof ClientFormValues, { message });
      }
      toastError(error);
    },
  });

  const managerOptions = [
    { value: NO_MANAGER, label: "Unassigned" },
    ...(assignable.data ?? []).map((user) => ({
      value: user.id,
      label: `${user.firstName} ${user.lastName}`,
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{client ? "Edit client" : "New client"}</DialogTitle>
          <DialogDescription>
            {client ? "Update the details stored for this client." : "Add a new client record to your workspace."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className="space-y-4"
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="firstName" label="First name" required />
            <TextField form={form} name="lastName" label="Last name" required />
            <TextField form={form} name="email" label="Email" type="email" required />
            <TextField form={form} name="phone" label="Phone" placeholder="+94 77 000 0000" />
            <TextField form={form} name="companyName" label="Company" />
            <SelectField form={form} name="type" label="Client type" options={OPTIONS.clientType} />
            <SelectField form={form} name="status" label="Status" options={OPTIONS.clientStatus} />
            <TextField
              form={form}
              name="currency"
              label="Currency"
              description="Three-letter ISO code, e.g. LKR"
              required
            />
            <TextField form={form} name="website" label="Website" placeholder="https://" />
            <TextField form={form} name="city" label="City" />
            <TextField form={form} name="country" label="Country" />
            <TextField form={form} name="taxId" label="Tax ID" />
            <TextField form={form} name="leadSource" label="Lead source" />
            <SelectField
              form={form}
              name="accountManagerId"
              label="Account manager"
              options={managerOptions}
              placeholder="Unassigned"
            />
          </div>

          <TextareaField form={form} name="address" label="Address" rows={2} />
          <TextareaField form={form} name="notes" label="Notes" rows={3} placeholder="Internal context for your team..." />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {client ? "Save changes" : "Create client"}
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

export default function ClientList() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const params = useListParams(INITIAL_FILTERS);
  const list = useApiList<Client>(qk.list("clients", params.query), "/clients", params.query);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [archiving, setArchiving] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);

  const hasFilters =
    params.search.trim() !== "" || params.filters.status !== "ALL" || params.filters.type !== "ALL";

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (client: Client) => {
    setEditing(client);
    setDialogOpen(true);
  };

  const handleDialogChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) setEditing(null);
  };

  const archiveMutation = useMutation({
    mutationFn: (clientId: string) => api.del<void>(`/clients/${clientId}`),
    onSuccess: () => {
      toastSuccess("Client archived", "The client was moved out of the active list.");
      setArchiving(null);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error) => {
      toastError(error);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (clientId: string) => api.del<void>(`/clients/${clientId}/permanent`),
    onSuccess: () => {
      toastSuccess("Client deleted", "The client has been permanently deleted.");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error) => {
      toastError(error);
    },
  });

  const exportMutation = useMutation({
    mutationFn: () => {
      const query: Record<string, string | number> = {};
      const search = params.debouncedSearch.trim();
      if (search) query.search = search;
      if (params.filters.status !== "ALL") query.status = params.filters.status;
      if (params.filters.type !== "ALL") query.type = params.filters.type;
      return api.blob("/clients/export", query);
    },
    onSuccess: (blob) => {
      downloadBlob(blob, `clients-${new Date().toISOString().slice(0, 10)}.csv`);
      toastSuccess("Export ready", "Your client CSV download has started.");
    },
    onError: (error) => {
      toastError(error);
    },
  });

  const columns: ColumnDef<Client, unknown>[] = [
    {
      id: "name",
      accessorFn: (row) => clientDisplayName(row),
      header: "Name",
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{clientDisplayName(row.original)}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.type === "INDIVIDUAL" ? "Individual" : "Business"}
          </p>
        </div>
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
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "currency",
      header: "Currency",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.currency}</span>,
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => <span className="text-muted-foreground">{formatDate(row.original.createdAt)}</span>,
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => (
        <div
          className="flex items-center justify-end gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          {can("clients.update") ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Edit client"
              onClick={() => openEdit(row.original)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          ) : null}
          {can("clients.delete") ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-warning hover:text-warning/80"
                title="Archive client"
                onClick={() => setArchiving(row.original)}
              >
                <Archive className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-danger hover:text-danger/80"
                title="Delete client permanently"
                onClick={() => setDeleting(row.original)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Every customer record, its contacts and who owns the relationship."
        actions={
          <>
            {can("clients.export") ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
              >
                {exportMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4" />
                )}
                Export CSV
              </Button>
            ) : null}
            {can("clients.create") ? (
              <Button type="button" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                New client
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <SearchInput
          value={params.search}
          onChange={params.setSearch}
          placeholder="Search name, company, email, phone..."
        />
        <FilterSelect
          label="Status"
          value={params.filters.status}
          onChange={(value) => params.setFilter("status", value)}
          options={[
            { value: "ALL", label: "All statuses" },
            ...OPTIONS.clientStatus.map((status) => ({ value: status, label: status.replace(/_/g, " ") })),
          ]}
        />
        <FilterSelect
          label="Type"
          value={params.filters.type}
          onChange={(value) => params.setFilter("type", value)}
          options={[
            { value: "ALL", label: "All types" },
            ...OPTIONS.clientType.map((type) => ({ value: type, label: type.replace(/_/g, " ") })),
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
            description={list.error instanceof Error ? list.error.message : "Clients could not be loaded."}
            onRetry={() => list.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            data={list.data?.items ?? []}
            isLoading={list.isLoading}
            onRowClick={(client) => navigate(`/clients/${client.id}`)}
            emptyTitle="No clients found"
            emptyDescription={
              hasFilters
                ? "No client matches your search or filters. Try adjusting them."
                : "Create your first client to start tracking projects, invoices and tickets."
            }
            emptyAction={
              can("clients.create") ? (
                <Button type="button" onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  New client
                </Button>
              ) : undefined
            }
            footer={<Pagination pagination={list.data?.pagination} onPageChange={params.setPage} />}
          />
        )}
      </div>

      <ClientFormDialog open={dialogOpen} onOpenChange={handleDialogChange} client={editing} />

      <ConfirmDialog
        open={Boolean(archiving)}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        title="Archive client?"
        description={
          archiving
            ? `${clientDisplayName(archiving)} will be archived and removed from the active client list.`
            : undefined
        }
        confirmLabel="Archive client"
        destructive
        loading={archiveMutation.isPending}
        onConfirm={() => {
          if (archiving) archiveMutation.mutate(archiving.id);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete client permanently?"
        description={
          deleting
            ? `${clientDisplayName(deleting)} will be permanently deleted. This action cannot be undone.`
            : undefined
        }
        confirmLabel="Delete permanently"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting.id);
        }}
      />
    </div>
  );
}
