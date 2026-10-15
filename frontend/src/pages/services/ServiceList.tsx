import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, CheckCircle2, Loader2, Pencil, Plus } from "lucide-react";

import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiList } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { formatMoney, humanize } from "@/lib/format";
import { OPTIONS } from "@/lib/status";
import { currencyValue } from "@/lib/validation";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
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

/**
 * Service shape as returned by the service routes. Defined locally because the
 * shared `Service` type predates the `status` field.
 */
interface ServiceRecord {
  id: string;
  name: string;
  slug: string;
  category: string;
  shortDescription: string | null;
  description: string | null;
  publicDescription: string | null;
  internalInstructions: string | null;
  pricingModel: string;
  basePrice: string;
  currency: string;
  estimatedDelivery: string | null;
  status: string;
  icon: string | null;
  createdAt: string;
  updatedAt: string;
}

const INITIAL_FILTERS = { status: "ALL" };

const serviceSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  category: z.string().trim().min(1, "Category is required"),
  pricingModel: z.enum(["FIXED", "HOURLY", "DAILY", "MONTHLY", "PROJECT_BASED", "CUSTOM"]),
  basePrice: z
    .string()
    .trim()
    .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), "Enter a valid base price"),
  currency: currencyValue,
  estimatedDelivery: z.string().trim().max(120, "Delivery window is too long"),
  shortDescription: z.string().trim().max(500, "Short description is too long"),
  description: z.string().trim().max(5000, "Description is too long"),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]),
});

type ServiceFormValues = z.infer<typeof serviceSchema>;

const EMPTY_SERVICE_VALUES: ServiceFormValues = {
  name: "",
  category: "",
  pricingModel: "FIXED",
  basePrice: "0",
  currency: "LKR",
  estimatedDelivery: "",
  shortDescription: "",
  description: "",
  status: "ACTIVE",
};

function asPricingModel(value: string): ServiceFormValues["pricingModel"] {
  return (OPTIONS.pricingModel as readonly string[]).includes(value)
    ? (value as ServiceFormValues["pricingModel"])
    : "FIXED";
}

function asServiceStatus(value: string): ServiceFormValues["status"] {
  return (OPTIONS.serviceStatus as readonly string[]).includes(value)
    ? (value as ServiceFormValues["status"])
    : "ACTIVE";
}

function valuesFromService(service: ServiceRecord): ServiceFormValues {
  return {
    name: service.name,
    category: service.category,
    pricingModel: asPricingModel(service.pricingModel),
    basePrice: service.basePrice,
    currency: service.currency || "LKR",
    estimatedDelivery: service.estimatedDelivery ?? "",
    shortDescription: service.shortDescription ?? "",
    description: service.description ?? "",
    status: asServiceStatus(service.status),
  };
}

function toServicePayload(values: ServiceFormValues) {
  const nullable = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  };
  return {
    name: values.name,
    category: values.category,
    pricingModel: values.pricingModel,
    basePrice: values.basePrice,
    currency: values.currency,
    estimatedDelivery: nullable(values.estimatedDelivery),
    shortDescription: nullable(values.shortDescription),
    description: nullable(values.description),
    status: values.status,
  };
}

/** Create/edit form for a service (gated by `services.manage` on the server). */
function ServiceFormDialog({
  open,
  onOpenChange,
  service,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: ServiceRecord | null;
}) {
  const queryClient = useQueryClient();
  const form = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues: EMPTY_SERVICE_VALUES,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(service ? valuesFromService(service) : EMPTY_SERVICE_VALUES);
  }, [open, service, form]);

  const mutation = useMutation({
    mutationFn: (values: ServiceFormValues) => {
      const payload = toServicePayload(values);
      return service
        ? api.patch<ServiceRecord>(`/services/${service.id}`, payload)
        : api.post<ServiceRecord>("/services", payload);
    },
    onSuccess: () => {
      toastSuccess(service ? "Service updated" : "Service created");
      queryClient.invalidateQueries({ queryKey: ["services"] });
      onOpenChange(false);
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) {
        form.setError(key as keyof ServiceFormValues, { message });
      }
      toastError(error);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{service ? "Edit service" : "New service"}</DialogTitle>
          <DialogDescription>
            {service
              ? "Update how this service is described, priced and offered."
              : "Add a service to your catalogue so quotations and orders can reference it."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="name" label="Name" required />
            <TextField form={form} name="category" label="Category" required placeholder="e.g. Web Development" />
            <SelectField form={form} name="pricingModel" label="Pricing model" options={OPTIONS.pricingModel} />
            <TextField
              form={form}
              name="basePrice"
              label="Base price"
              type="number"
              min={0}
              step="0.01"
              required
            />
            <TextField
              form={form}
              name="currency"
              label="Currency"
              description="Three-letter ISO code, e.g. LKR"
              required
            />
            <TextField
              form={form}
              name="estimatedDelivery"
              label="Estimated delivery"
              placeholder="e.g. 2-3 weeks"
            />
            <SelectField form={form} name="status" label="Status" options={OPTIONS.serviceStatus} />
          </div>

          <TextareaField form={form} name="shortDescription" label="Short description" rows={2} />
          <TextareaField form={form} name="description" label="Full description" rows={4} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {service ? "Save changes" : "Create service"}
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

export default function ServiceList() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const params = useListParams(INITIAL_FILTERS);
  const list = useApiList<ServiceRecord>(qk.list("services", params.query), "/services", params.query);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceRecord | null>(null);

  const hasFilters = params.search.trim() !== "" || params.filters.status !== "ALL";

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (service: ServiceRecord) => {
    setEditing(service);
    setDialogOpen(true);
  };

  const handleDialogChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) setEditing(null);
  };

  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; status: string }) =>
      api.patch(`/services/${vars.id}`, { status: vars.status }),
    onSuccess: (_data, vars) => {
      toastSuccess(vars.status === "ACTIVE" ? "Service activated" : "Service deactivated");
      queryClient.invalidateQueries({ queryKey: ["services"] });
    },
    onError: (error) => toastError(error),
  });

  const columns: ColumnDef<ServiceRecord, unknown>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{row.original.name}</p>
          {row.original.shortDescription ? (
            <p className="truncate text-xs text-muted-foreground">{row.original.shortDescription}</p>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.category}</span>,
    },
    {
      accessorKey: "pricingModel",
      header: "Pricing model",
      cell: ({ row }) => <span className="text-muted-foreground">{humanize(row.original.pricingModel)}</span>,
    },
    {
      accessorKey: "basePrice",
      header: "Base price",
      cell: ({ row }) => (
        <span className="font-medium text-foreground">
          {formatMoney(row.original.basePrice, row.original.currency)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          {can("services.manage") ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Edit service"
              onClick={() => openEdit(row.original)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          ) : null}
          {can("services.manage") ? (
            row.original.status === "ACTIVE" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-amber-300 hover:text-amber-200"
                title="Deactivate service"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate({ id: row.original.id, status: "INACTIVE" })}
              >
                <Ban className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-emerald-300 hover:text-emerald-200"
                title="Activate service"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate({ id: row.original.id, status: "ACTIVE" })}
              >
                <CheckCircle2 className="h-4 w-4" />
              </Button>
            )
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Services"
        description="The catalogue of services you sell, how they are priced and who delivers them."
        actions={
          can("services.manage") ? (
            <Button type="button" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              New service
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <SearchInput
          value={params.search}
          onChange={params.setSearch}
          placeholder="Search service or category..."
        />
        <FilterSelect
          label="Status"
          value={params.filters.status}
          onChange={(value) => params.setFilter("status", value)}
          options={[
            { value: "ALL", label: "All statuses" },
            ...OPTIONS.serviceStatus.map((status) => ({ value: status, label: status.replace(/_/g, " ") })),
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
            description={list.error instanceof Error ? list.error.message : "Services could not be loaded."}
            onRetry={() => list.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            data={list.data?.items ?? []}
            isLoading={list.isLoading}
            emptyTitle="No services found"
            emptyDescription={
              hasFilters
                ? "No service matches your search or filters. Try adjusting them."
                : "Add your first service to start quoting and invoicing against it."
            }
            emptyAction={
              can("services.manage") ? (
                <Button type="button" onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  New service
                </Button>
              ) : undefined
            }
            footer={<Pagination pagination={list.data?.pagination} onPageChange={params.setPage} />}
          />
        )}
      </div>

      <ServiceFormDialog open={dialogOpen} onOpenChange={handleDialogChange} service={editing} />
    </div>
  );
}
