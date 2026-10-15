import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ChevronDown, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { useApiList, useApiQuery } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { errorMessage, fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { clientDisplayName, formatDate, formatDateTime, formatMoney, isOverdue, toDateInput } from "@/lib/format";
import { OPTIONS, statusLabel } from "@/lib/status";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import { Pagination } from "@/components/common/Pagination";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/states";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Client, ClientRef, PersonRef, Service } from "@/types";

/**
 * `GET /orders` returns the raw Prisma order (plus client/service/assignee
 * relations). `ServiceOrder` in `@/types` mirrors an older payload shape, so
 * this local interface matches what the API actually sends.
 */
interface Order {
  id: string;
  orderNo: string;
  clientId: string;
  serviceId: string | null;
  quotationId: string | null;
  title: string;
  requirements: string | null;
  budget: string | null;
  currency: string;
  expectedDelivery: string | null;
  status: string;
  assignedToId: string | null;
  projectId: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  client?: ClientRef;
  service?: { id: string; name: string } | null;
  assignedTo?: PersonRef | null;
}

const INITIAL_FILTERS = { status: "", clientId: "" };

const CLIENT_OPTIONS_KEY = ["clients", "options"] as const;

/* --------------------------------- Dialog --------------------------------- */

const orderSchema = z.object({
  clientId: z.string().min(1, "Select a client"),
  serviceId: z.string(),
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title must be 200 characters or fewer"),
  requirements: z.string(),
  budget: z
    .string()
    .refine(
      (value) => value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "Enter a valid amount",
    ),
  currency: z.string().trim().length(3, "Currency must be a 3-letter code"),
  expectedDelivery: z.string(),
});

type OrderValues = z.infer<typeof orderSchema>;

interface OrderPayload {
  clientId: string;
  serviceId?: string | null;
  title: string;
  requirements: string | null;
  budget?: string;
  currency: string;
  expectedDelivery: string | null;
}

function OrderDialog({ order, onClose }: { order?: Order; onClose: () => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const isEdit = Boolean(order);

  const clientsQuery = useApiQuery<Client[]>(CLIENT_OPTIONS_KEY, "/clients", { limit: 200 });
  const servicesQuery = useApiQuery<Service[]>(["services", "options"], "/services", { limit: 200 }, {
    enabled: can("services.view"),
  });

  const form = useForm<OrderValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      clientId: order?.clientId ?? "",
      serviceId: order?.serviceId ?? "",
      title: order?.title ?? "",
      requirements: order?.requirements ?? "",
      budget: order?.budget ?? "",
      currency: order?.currency ?? "LKR",
      expectedDelivery: toDateInput(order?.expectedDelivery),
    },
  });

  const clients = clientsQuery.data ?? [];
  const services = servicesQuery.data ?? [];
  const watchedClientId = form.watch("clientId");

  // Currency follows the picked client (never clobbers an existing order).
  useEffect(() => {
    if (isEdit && watchedClientId === order?.clientId) return;
    const picked = clients.find((client) => client.id === watchedClientId);
    if (picked) form.setValue("currency", picked.currency || "LKR");
  }, [clients, form, isEdit, order?.clientId, watchedClientId]);

  const mutation = useMutation({
    mutationFn: (body: OrderPayload) =>
      order ? api.patch<Order>(`/orders/${order.id}`, body) : api.post<Order>("/orders", body),
    onSuccess: (saved) => {
      toastSuccess(isEdit ? "Order updated" : "Order created", `${saved.orderNo} · ${saved.title}`);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      onClose();
    },
    onError: (error) => {
      for (const [key, message] of Object.entries(fieldErrors(error))) {
        form.setError(key as keyof OrderValues, { message });
      }
      toastError(error);
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate({
      clientId: values.clientId,
      title: values.title,
      requirements: values.requirements.trim() || null,
      currency: values.currency.toUpperCase(),
      expectedDelivery: values.expectedDelivery || null,
      ...(values.budget.trim() ? { budget: values.budget.trim() } : {}),
      ...(can("services.view")
        ? { serviceId: values.serviceId && values.serviceId !== "NONE" ? values.serviceId : null }
        : {}),
    });
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? `Edit ${order?.orderNo}` : "New order"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the order details. The status is changed from the status selector in the list."
                : "Log a client service order. New orders start as drafts."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <SelectField
                form={form}
                name="clientId"
                label="Client"
                required
                placeholder={clients.length === 0 ? "Loading clients..." : "Select a client"}
                disabled={clients.length === 0}
                options={clients.map((client) => ({ value: client.id, label: clientDisplayName(client) }))}
              />
            </div>
            <TextField
              form={form}
              name="title"
              label="Title"
              required
              placeholder="Monthly website maintenance"
              className="sm:col-span-2"
            />
            {can("services.view") ? (
              <SelectField
                form={form}
                name="serviceId"
                label="Service (optional)"
                placeholder={servicesQuery.isLoading ? "Loading services..." : "No service"}
                disabled={servicesQuery.isLoading}
                options={[
                  { value: "NONE", label: "No service" },
                  ...services.map((service) => ({ value: service.id, label: service.name })),
                ]}
              />
            ) : null}
            <TextField form={form} name="currency" label="Currency" placeholder="LKR" required />
            <TextField
              form={form}
              name="budget"
              label="Budget (optional)"
              type="number"
              min={0}
              step="0.01"
              description="Amount in the order currency."
            />
            <TextField form={form} name="expectedDelivery" label="Expected delivery" type="date" />
            <TextareaField
              form={form}
              name="requirements"
              label="Requirements (optional)"
              rows={5}
              placeholder="Scope, deliverables, acceptance criteria..."
              className="sm:col-span-2"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {mutation.isPending ? "Saving..." : isEdit ? "Save changes" : "Create order"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Status control ----------------------------- */

function OrderStatusSelect({
  order,
  disabled,
  onStatusChange,
}: {
  order: Order;
  disabled: boolean;
  onStatusChange: (order: Order, status: string) => void;
}) {
  return (
    <Select value={order.status} onValueChange={(status) => onStatusChange(order, status)}>
      <SelectTrigger
        className="h-8 w-40 border-white/10 bg-white/[0.03] text-xs"
        disabled={disabled}
        onClick={(event) => event.stopPropagation()}
        aria-label={`Status for ${order.orderNo}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.orderStatus.map((status) => (
          <SelectItem key={status} value={status}>
            {statusLabel(status)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* --------------------------------- Page ----------------------------------- */

export default function OrderList() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const params = useListParams(INITIAL_FILTERS);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Order | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const orders = useApiList<Order>(qk.list("orders", params.query), "/orders", params.query);
  const clientsQuery = useApiQuery<Client[]>(CLIENT_OPTIONS_KEY, "/clients", { limit: 200 });

  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; status: string }) => api.patch<Order>(`/orders/${vars.id}`, { status: vars.status }),
    onSuccess: (saved) => {
      toastSuccess("Status updated", `${saved.orderNo} is now ${statusLabel(saved.status)}.`);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error) => toastError(error),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del<void>(`/orders/${id}`),
    onSuccess: () => {
      toastSuccess("Order deleted", "The draft order was removed.");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error) => toastError(error),
  });

  const clientOptions = clientsQuery.data ?? [];
  const canCreate = can("orders.create");
  const canUpdate = can("orders.update");
  const hasFilters = Boolean(params.search || params.filters.status || params.filters.clientId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Client service orders with inline details, status transitions and delivery dates."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New order
            </Button>
          ) : null
        }
      />

      <div className="space-y-4">
        <FilterBar>
          <SearchInput
            value={params.search}
            onChange={params.setSearch}
            placeholder="Search order number or title..."
          />

          <Select
            value={params.filters.status || "ALL"}
            onValueChange={(value) => params.setFilter("status", value)}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {OPTIONS.orderStatus.map((status) => (
                <SelectItem key={status} value={status}>
                  {statusLabel(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={params.filters.clientId || "ALL"}
            onValueChange={(value) => params.setFilter("clientId", value)}
          >
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder={clientsQuery.isLoading ? "Loading clients..." : "All clients"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All clients</SelectItem>
              {clientOptions.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {clientDisplayName(client)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={params.resetFilters}>
              Clear filters
            </Button>
          ) : null}
        </FilterBar>

        {orders.isError ? (
          <ErrorState
            title="Orders could not be loaded"
            description={errorMessage(orders.error)}
            onRetry={() => orders.refetch()}
          />
        ) : orders.isLoading ? (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <TableSkeleton columns={6} />
          </div>
        ) : (orders.data?.items ?? []).length === 0 ? (
          <EmptyState
            title="No orders found"
            description={
              hasFilters
                ? "Nothing matches the current search and filters."
                : "Create your first order to start tracking client work."
            }
            action={
              canCreate && !hasFilters ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New order
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10">
                    <span className="sr-only">Expand</span>
                  </TableHead>
                  <TableHead>Order #</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Expected delivery</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(orders.data?.items ?? []).map((order) => {
                  const expanded = expandedId === order.id;
                  const overdue =
                    Boolean(order.expectedDelivery) &&
                    isOverdue(order.expectedDelivery) &&
                    !["DELIVERED", "CANCELLED"].includes(order.status);
                  const statusBusy = statusMutation.isPending && statusMutation.variables?.id === order.id;

                  return (
                    <Fragment key={order.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpandedId(expanded ? null : order.id)}
                      >
                        <TableCell className="pr-0">
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 text-muted-foreground transition-transform",
                              expanded && "rotate-180",
                            )}
                          />
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs font-medium">{order.orderNo}</span>
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0 max-w-[260px]">
                            <p className="truncate text-sm font-medium">{order.title}</p>
                            {order.service ? (
                              <p className="truncate text-xs text-muted-foreground">{order.service.name}</p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{clientDisplayName(order.client)}</span>
                        </TableCell>
                        <TableCell>
                          {canUpdate ? (
                            <OrderStatusSelect
                              order={order}
                              disabled={statusBusy}
                              onStatusChange={(target, status) =>
                                statusMutation.mutate({ id: target.id, status })
                              }
                            />
                          ) : (
                            <StatusBadge status={order.status} />
                          )}
                        </TableCell>
                        <TableCell>
                          {order.budget ? (
                            <span className="text-sm">{formatMoney(order.budget, order.currency)}</span>
                          ) : (
                            <span className="text-sm text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={overdue ? "text-sm font-medium text-rose-300" : "text-sm text-muted-foreground"}>
                            {formatDate(order.expectedDelivery)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canUpdate ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setEditTarget(order);
                                }}
                                aria-label={`Edit ${order.orderNo}`}
                                title="Edit order"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            ) : null}
                            {canUpdate && order.status === "DRAFT" ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDeleteTarget(order);
                                }}
                                aria-label={`Delete ${order.orderNo}`}
                                title="Delete order"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>

                      {expanded ? (
                        <TableRow className="hover:bg-transparent bg-white/[0.03]">
                          <TableCell colSpan={8}>
                            <div className="grid gap-5 py-1 sm:grid-cols-3">
                              <div className="space-y-1 sm:col-span-2">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Requirements
                                </p>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                                  {order.requirements || "No requirements were recorded for this order."}
                                </p>
                              </div>

                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between gap-3">
                                  <span className="text-muted-foreground">Service</span>
                                  <span className="text-right">{order.service?.name ?? "-"}</span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span className="text-muted-foreground">Assigned to</span>
                                  <span className="text-right">
                                    {order.assignedTo
                                      ? `${order.assignedTo.firstName} ${order.assignedTo.lastName}`
                                      : "-"}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span className="text-muted-foreground">Budget</span>
                                  <span className="text-right">
                                    {order.budget ? formatMoney(order.budget, order.currency) : "-"}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span className="text-muted-foreground">Currency</span>
                                  <span>{order.currency}</span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span className="text-muted-foreground">Created</span>
                                  <span className="text-right">{formatDateTime(order.createdAt)}</span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span className="text-muted-foreground">Updated</span>
                                  <span className="text-right">{formatDateTime(order.updatedAt)}</span>
                                </div>

                                {order.quotationId || order.projectId ? (
                                  <div className="flex flex-wrap gap-3 pt-1">
                                    {order.quotationId ? (
                                      <Link
                                        to={`/quotations/${order.quotationId}`}
                                        className="text-xs font-medium text-primary hover:underline"
                                      >
                                        View quotation
                                      </Link>
                                    ) : null}
                                    {order.projectId ? (
                                      <Link
                                        to={`/projects/${order.projectId}`}
                                        className="text-xs font-medium text-primary hover:underline"
                                      >
                                        View project
                                      </Link>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <Pagination pagination={orders.data?.pagination} onPageChange={params.setPage} />
      </div>

      {createOpen || editTarget ? (
        <OrderDialog
          order={editTarget ?? undefined}
          onClose={() => {
            setCreateOpen(false);
            setEditTarget(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete this draft order?"
        description={`${deleteTarget?.orderNo ?? "This order"} and its details are permanently removed.`}
        confirmLabel="Delete"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
