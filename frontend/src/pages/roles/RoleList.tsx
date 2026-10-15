import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiQuery } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { formatNumber, humanize } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorState, LoadingState } from "@/components/common/states";
import { TextareaField, TextField } from "@/components/common/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PermissionDef } from "@/types";

interface RoleSummary {
  id: string;
  name: string;
  description: string | null;
  type: string;
  isSystem: boolean;
  userCount: number;
  permissionCount: number;
  permissions: string[];
}

interface PermissionCatalog {
  all: PermissionDef[];
  grouped: Record<string, PermissionDef[]>;
}

const roleSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  description: z.string().trim().max(255, "Description must be 255 characters or fewer"),
});

type RoleValues = z.infer<typeof roleSchema>;

export default function RoleList() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canManage = can("roles.manage");

  const [dialogRole, setDialogRole] = useState<RoleSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoleSummary | null>(null);

  const rolesQuery = useApiQuery<RoleSummary[]>(qk.list("roles"), "/roles");
  const permissionsQuery = useApiQuery<PermissionCatalog>(["permissions", "catalog"], "/permissions", undefined, {
    enabled: canManage,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del<void>(`/roles/${id}`),
    onSuccess: () => {
      toastSuccess("Role deleted");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (error) => toastError(error),
  });

  const columns = useMemo<ColumnDef<RoleSummary, unknown>[]>(() => {
    const cols: ColumnDef<RoleSummary, unknown>[] = [
      {
        id: "name",
        header: "Role",
        accessorFn: (row) => row.name,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.name}</p>
            {row.original.description ? (
              <p className="line-clamp-1 max-w-[24rem] text-xs text-muted-foreground">{row.original.description}</p>
            ) : null}
          </div>
        ),
        enableSorting: false,
      },
      {
        accessorKey: "type",
        header: "Type",
        cell: ({ row }) => <Badge variant="outline">{humanize(row.original.type)}</Badge>,
        enableSorting: false,
      },
      {
        accessorKey: "permissionCount",
        header: "Permissions",
        cell: ({ row }) => <span>{formatNumber(row.original.permissionCount)}</span>,
        enableSorting: false,
      },
      {
        accessorKey: "userCount",
        header: "Users",
        cell: ({ row }) =>
          row.original.userCount > 0 ? (
            <span>{formatNumber(row.original.userCount)}</span>
          ) : (
            <span className="text-xs italic text-muted-foreground">None</span>
          ),
        enableSorting: false,
      },
      {
        accessorKey: "isSystem",
        header: "Kind",
        cell: ({ row }) =>
          row.original.isSystem ? <Badge variant="info">System</Badge> : <Badge variant="muted">Custom</Badge>,
        enableSorting: false,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          if (!canManage) return null;
          const role = row.original;
          return (
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Edit role"
                disabled={role.isSystem}
                title={role.isSystem ? "System roles are read-only" : "Edit role"}
                onClick={() => {
                  setDialogRole(role);
                  setDialogOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                aria-label="Delete role"
                disabled={role.isSystem || role.userCount > 0}
                title={
                  role.isSystem
                    ? "System roles cannot be deleted"
                    : role.userCount > 0
                      ? "Reassign users before deleting this role"
                      : "Delete role"
                }
                onClick={() => setDeleteTarget(role)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      },
    ];
    return cols;
  }, [canManage]);

  if (rolesQuery.isLoading) return <LoadingState label="Loading roles..." />;
  if (rolesQuery.isError) {
    return (
      <ErrorState
        title="Roles could not be loaded"
        description={rolesQuery.error instanceof Error ? rolesQuery.error.message : undefined}
        onRetry={() => rolesQuery.refetch()}
      />
    );
  }

  const roles = rolesQuery.data ?? [];
  const totalUsers = roles.reduce((sum, role) => sum + role.userCount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles & permissions"
        description={`${formatNumber(roles.length)} roles · ${formatNumber(totalUsers)} role assignments. System roles are read-only templates.`}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setDialogRole(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New role
            </Button>
          ) : null
        }
      />

      <div className="space-y-4">
        <DataTable
          columns={columns}
          data={roles}
          emptyTitle="No roles yet"
          emptyDescription="Custom roles you create will appear here."
        />
      </div>

      {dialogOpen && permissionsQuery.data ? (
        <RoleDialog
          role={dialogRole}
          catalog={permissionsQuery.data}
          onClose={() => {
            setDialogOpen(false);
            setDialogRole(null);
          }}
        />
      ) : dialogOpen && permissionsQuery.isError ? (
        <Dialog open onOpenChange={() => setDialogOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Permissions unavailable</DialogTitle>
              <DialogDescription>
                The permission catalogue could not be loaded, so a role cannot be edited right now.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Close
              </Button>
              <Button variant="outline" onClick={() => permissionsQuery.refetch()}>
                Try again
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete role ${deleteTarget ? `"${deleteTarget.name}"` : ""}?`}
        description="This permanently removes the role and its permission set. Users must be reassigned first."
        confirmLabel="Delete role"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </div>
  );
}

function RoleDialog({
  role,
  catalog,
  onClose,
}: {
  role: RoleSummary | null;
  catalog: PermissionCatalog;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [permissions, setPermissions] = useState<string[]>(() => role?.permissions ?? []);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<RoleValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: {
      name: role?.name ?? "",
      description: role?.description ?? "",
    },
  });

  const groups = useMemo(
    () =>
      Object.entries(catalog.grouped)
        .map(([module, items]) => ({ module, items }))
        .sort((a, b) => a.module.localeCompare(b.module)),
    [catalog.grouped],
  );

  const mutation = useMutation({
    mutationFn: (values: RoleValues) => {
      const body = {
        name: values.name,
        description: values.description.trim() || null,
        permissions,
      };
      return role ? api.patch<RoleSummary>(`/roles/${role.id}`, body) : api.post<RoleSummary>("/roles", body);
    },
    onSuccess: () => {
      toastSuccess(role ? "Role updated" : "Role created");
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      onClose();
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) {
        form.setError(key as keyof RoleValues, { message });
      }
      if (Object.keys(fields).length === 0) {
        setSubmitError(error instanceof Error ? error.message : "The role could not be saved.");
      }
      toastError(error);
    },
  });

  const togglePermission = (name: string, checked: boolean) => {
    setPermissions((prev) => (checked ? [...prev, name] : prev.filter((permission) => permission !== name)));
  };

  const toggleGroup = (groupItems: PermissionDef[], checked: boolean) => {
    const names = groupItems.map((permission) => permission.name);
    setPermissions((prev) => {
      if (checked) return Array.from(new Set([...prev, ...names]));
      const removal = new Set(names);
      return prev.filter((permission) => !removal.has(permission));
    });
  };

  const submit = form.handleSubmit((values) => {
    setSubmitError(null);
    mutation.mutate(values);
  });

  const saving = mutation.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : "New role"}</DialogTitle>
          <DialogDescription>
            {role
              ? "Update the role's name, description and permission set."
              : "Define a custom role and exactly what it can access."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5" noValidate>
          <div className="space-y-4">
            <TextField form={form} name="name" label="Role name" required placeholder="e.g. QA Engineer" />
            <TextareaField
              form={form}
              name="description"
              label="Description"
              rows={2}
              placeholder="What is this role responsible for?"
            />
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Permissions</p>
                <p className="text-xs text-muted-foreground">
                  {formatNumber(permissions.length)} of {formatNumber(catalog.all.length)} selected
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPermissions(catalog.all.map((permission) => permission.name))}
                >
                  Select all
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPermissions([])}>
                  Clear all
                </Button>
              </div>
            </div>

            <div className="max-h-[45vh] space-y-4 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-4">
              {groups.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No permissions available.</p>
              ) : (
                groups.map(({ module, items }) => {
                  const selectedCount = items.filter((permission) => permissions.includes(permission.name)).length;
                  const allSelected = selectedCount === items.length;
                  return (
                    <div key={module} className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {humanize(module)}{" "}
                          <span className="normal-case tracking-normal">
                            ({selectedCount}/{items.length})
                          </span>
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => toggleGroup(items, !allSelected)}
                        >
                          {allSelected ? "Clear group" : "Select all in group"}
                        </Button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {items.map((permission) => (
                          <label
                            key={permission.id}
                            className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/10 bg-white/5 p-2.5"
                          >
                            <Checkbox
                              checked={permissions.includes(permission.name)}
                              onCheckedChange={(checked) => togglePermission(permission.name, Boolean(checked))}
                              className="mt-0.5"
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium">{permission.name}</span>
                              {permission.description ? (
                                <span className="block text-xs text-muted-foreground">{permission.description}</span>
                              ) : null}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {submitError ? <p className="text-xs font-medium text-destructive">{submitError}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {saving ? "Saving..." : role ? "Save changes" : "Create role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
