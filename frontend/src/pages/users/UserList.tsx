import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, MoreHorizontal, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiList, useApiQuery } from "@/hooks/useApi";
import { useListParams } from "@/hooks/useListParams";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { formatRelative, humanize } from "@/lib/format";
import { passwordPolicy, passwordSchema } from "@/lib/validation";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar, SearchInput } from "@/components/common/FilterBar";
import { DataTable } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorState } from "@/components/common/states";
import { SelectField, TextField } from "@/components/common/form";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AppUser } from "@/types";

const USER_STATUSES = ["ACTIVE", "INACTIVE", "PENDING", "SUSPENDED"] as const;

type UserRow = AppUser & { phone?: string | null };

interface RoleOption {
  id: string;
  name: string;
  type: string;
}

const createUserSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  phone: z.string().trim(),
  jobTitle: z.string().trim(),
  password: passwordSchema,
  status: z.string().min(1),
});

const editUserSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  phone: z.string().trim(),
  jobTitle: z.string().trim(),
  status: z.string().min(1),
});

type CreateUserValues = z.infer<typeof createUserSchema>;
type EditUserValues = z.infer<typeof editUserSchema>;

function RolePicker({
  roleOptions,
  selected,
  onToggle,
  disabled,
  error,
}: {
  roleOptions: RoleOption[];
  selected: string[];
  onToggle: (roleId: string, checked: boolean) => void;
  disabled?: boolean;
  error?: string;
}) {
  if (!roleOptions.length) {
    return (
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        Roles are unavailable for your account. Contact an administrator to assign roles.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">
        Roles<span className="ml-0.5 text-destructive">*</span>
      </Label>
      <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
        {roleOptions.map((role) => (
          <label key={role.id} className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox
              checked={selected.includes(role.id)}
              disabled={disabled}
              onCheckedChange={(checked) => onToggle(role.id, Boolean(checked))}
            />
            <span className="font-medium">{role.name}</span>
            <Badge variant="muted">{humanize(role.type)}</Badge>
          </label>
        ))}
      </div>
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

export default function UserList() {
  const { can, user: me } = useAuth();
  const params = useListParams({ status: "ALL", roleId: "ALL" });
  const queryClient = useQueryClient();

  const canCreate = can("users.create");
  const canUpdate = can("users.update");
  const canDelete = can("users.delete");
  const canViewRoles = can("roles.view");

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  const usersQuery = useApiList<UserRow>(qk.list("users", params.query), "/users", params.query);
  const rolesQuery = useApiQuery<RoleOption[]>(["roles", "picker"], "/roles", undefined, {
    enabled: canViewRoles,
  });
  const roleOptions = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["users"] });
  };

  const resetMutation = useMutation({
    mutationFn: (vars: { id: string; password: string }) =>
      api.post(`/users/${vars.id}/reset-password`, { password: vars.password }),
    onSuccess: () => {
      toastSuccess("Password reset", "The user must sign in again with the new password.");
      setResetTarget(null);
      setResetPasswordValue("");
      setResetPasswordError(null);
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del<void>(`/users/${id}`),
    onSuccess: () => {
      toastSuccess("User deactivated", "The account has been deactivated and signed out.");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toastError(error),
  });

  const confirmReset = () => {
    if (!resetTarget) return;
    const result = passwordSchema.safeParse(resetPasswordValue);
    if (!result.success) {
      setResetPasswordError(result.error.issues[0]?.message ?? "Password does not meet the policy.");
      return;
    }
    setResetPasswordError(null);
    resetMutation.mutate({ id: resetTarget.id, password: resetPasswordValue });
  };

  const columns = useMemo<ColumnDef<UserRow, unknown>[]>(() => {
    const cols: ColumnDef<UserRow, unknown>[] = [
      {
        id: "name",
        header: "User",
        accessorFn: (row) => `${row.firstName} ${row.lastName}`,
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/60 text-[10px] font-semibold">
              {(row.original.firstName?.charAt(0) ?? "?").toUpperCase()}
              {(row.original.lastName?.charAt(0) ?? "").toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">
                {row.original.firstName} {row.original.lastName}
              </p>
              {row.original.jobTitle ? (
                <p className="truncate text-xs text-muted-foreground">{row.original.jobTitle}</p>
              ) : null}
            </div>
          </div>
        ),
        enableSorting: false,
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.email}</span>,
      },
      {
        id: "roles",
        header: "Roles",
        accessorFn: (row) => (row.userRoles ?? []).map((ur) => ur.role.name).join(", "),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {(row.original.userRoles ?? []).map((ur) => (
              <Badge key={ur.role.id} variant="muted">
                {ur.role.name}
              </Badge>
            ))}
          </div>
        ),
        enableSorting: false,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "lastLogin",
        header: "Last login",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.lastLogin ? formatRelative(row.original.lastLogin) : "Never"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const user = row.original;
          if (!canUpdate && !canDelete) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="User actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canUpdate ? (
                  <DropdownMenuItem onClick={() => setEditUser(user)}>
                    <Pencil className="h-4 w-4" />
                    Edit user
                  </DropdownMenuItem>
                ) : null}
                {canUpdate ? (
                  <DropdownMenuItem
                    onClick={() => {
                      setResetPasswordValue("");
                      setResetPasswordError(null);
                      setResetTarget(user);
                    }}
                  >
                    <KeyRound className="h-4 w-4" />
                    Reset password
                  </DropdownMenuItem>
                ) : null}
                {canUpdate && canDelete ? <DropdownMenuSeparator /> : null}
                {canDelete && user.id !== me?.id ? (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteTarget(user)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Deactivate
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ];
    return cols;
  }, [canUpdate, canDelete, me?.id]);

  const items = usersQuery.data?.items ?? [];
  const hasActiveFilters = params.debouncedSearch.trim() !== "" || Object.values(params.filters).some((v) => v !== "ALL");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Manage team accounts, their roles and access status."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New user
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput value={params.search} onChange={params.setSearch} placeholder="Search name, email or title..." />
        <Select value={params.filters.status} onValueChange={(value) => params.setFilter("status", value)}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Status filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {USER_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {humanize(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canViewRoles ? (
          <Select value={params.filters.roleId} onValueChange={(value) => params.setFilter("roleId", value)}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Role filter">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All roles</SelectItem>
              {roleOptions.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {hasActiveFilters ? (
          <Button variant="ghost" size="sm" onClick={params.resetFilters}>
            Reset
          </Button>
        ) : null}
      </FilterBar>

      {usersQuery.isError ? (
        <ErrorState
          title="Users could not be loaded"
          description={usersQuery.error instanceof Error ? usersQuery.error.message : undefined}
          onRetry={() => usersQuery.refetch()}
        />
      ) : (
        <div className="space-y-4">
          <DataTable
            columns={columns}
            data={items}
            isLoading={usersQuery.isLoading}
            emptyTitle="No users found"
            emptyDescription={
              hasActiveFilters ? "No users match the current search and filters." : "Team accounts will appear here."
            }
            emptyAction={
              canCreate && !hasActiveFilters ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New user
                </Button>
              ) : null
            }
          />
          <Pagination pagination={usersQuery.data?.pagination} onPageChange={params.setPage} />
        </div>
      )}

      {createOpen ? <CreateUserDialog roleOptions={roleOptions} onClose={() => setCreateOpen(false)} /> : null}
      {editUser ? (
        <EditUserDialog key={editUser.id} user={editUser} roleOptions={roleOptions} onClose={() => setEditUser(null)} />
      ) : null}

      <ConfirmDialog
        open={Boolean(resetTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setResetTarget(null);
            setResetPasswordValue("");
            setResetPasswordError(null);
          }
        }}
        title={`Reset password for ${resetTarget ? `${resetTarget.firstName} ${resetTarget.lastName}` : ""}`}
        description="Set a new temporary password. All existing sessions of this user will be signed out."
        confirmLabel="Reset password"
        loading={resetMutation.isPending}
        onConfirm={confirmReset}
      >
        <div className="space-y-2">
          <Label htmlFor="reset-password" className="text-xs font-medium text-muted-foreground">
            New password
          </Label>
          <Input
            id="reset-password"
            type="password"
            value={resetPasswordValue}
            onChange={(event) => setResetPasswordValue(event.target.value)}
            placeholder="••••••••••"
          />
          <p className="text-xs text-muted-foreground">{passwordPolicy.summary}</p>
          {resetPasswordError ? <p className="text-xs font-medium text-destructive">{resetPasswordError}</p> : null}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Deactivate ${deleteTarget ? `${deleteTarget.firstName} ${deleteTarget.lastName}` : ""}?`}
        description="The account will be deactivated and all sessions revoked. This can be reversed by an administrator later."
        confirmLabel="Deactivate"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </div>
  );
}

function CreateUserDialog({ roleOptions, onClose }: { roleOptions: RoleOption[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
      phone: "",
      jobTitle: "",
      password: "",
      status: "ACTIVE",
    },
  });

  const mutation = useMutation({
    mutationFn: (values: CreateUserValues) =>
      api.post("/users", {
        email: values.email,
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone || undefined,
        jobTitle: values.jobTitle || undefined,
        password: values.password,
        status: values.status,
        roleIds,
      }),
    onSuccess: () => {
      toastSuccess("User created");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      onClose();
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) {
        form.setError(key as keyof CreateUserValues, { message });
      }
      if (Object.keys(fields).length === 0) {
        setSubmitError(error instanceof Error ? error.message : "The user could not be created.");
      }
      toastError(error);
    },
  });

  const submit = form.handleSubmit((values) => {
    setSubmitError(null);
    if (!roleIds.length) {
      setRoleError("Select at least one role");
      return;
    }
    setRoleError(null);
    mutation.mutate(values);
  });

  const saving = mutation.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>Create a team account and assign at least one role.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="firstName" label="First name" required />
            <TextField form={form} name="lastName" label="Last name" required />
          </div>
          <TextField form={form} name="email" label="Email" type="email" required placeholder="name@company.com" />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="jobTitle" label="Job title" placeholder="e.g. Developer" />
            <TextField form={form} name="phone" label="Phone" placeholder="+94..." />
          </div>
          <TextField
            form={form}
            name="password"
            label="Password"
            type="password"
            required
            autoComplete="new-password"
            hint={passwordPolicy.summary}
          />
          <SelectField form={form} name="status" label="Status" options={[...USER_STATUSES]} />
          <RolePicker
            roleOptions={roleOptions}
            selected={roleIds}
            onToggle={(roleId, checked) => {
              setRoleError(null);
              setRoleIds((prev) => (checked ? [...prev, roleId] : prev.filter((id) => id !== roleId)));
            }}
            error={roleError ?? undefined}
          />
          {submitError ? <p className="text-xs font-medium text-destructive">{submitError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
              {saving ? "Creating..." : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  roleOptions,
  onClose,
}: {
  user: UserRow;
  roleOptions: RoleOption[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [roleIds, setRoleIds] = useState<string[]>(() => (user.userRoles ?? []).map((ur) => ur.role.id));
  const [roleError, setRoleError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<EditUserValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      email: user.email ?? "",
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone ?? "",
      jobTitle: user.jobTitle ?? "",
      status: user.status,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: EditUserValues) =>
      api.patch(`/users/${user.id}`, {
        email: values.email,
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone || undefined,
        jobTitle: values.jobTitle || undefined,
        status: values.status,
        roleIds,
      }),
    onSuccess: () => {
      toastSuccess("User updated");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      onClose();
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) {
        form.setError(key as keyof EditUserValues, { message });
      }
      if (Object.keys(fields).length === 0) {
        setSubmitError(error instanceof Error ? error.message : "The user could not be updated.");
      }
      toastError(error);
    },
  });

  const submit = form.handleSubmit((values: EditUserValues) => {
    setSubmitError(null);
    if (!roleIds.length) {
      setRoleError("Select at least one role");
      return;
    }
    setRoleError(null);
    mutation.mutate(values);
  });

  const saving = mutation.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Edit {user.firstName} {user.lastName}
          </DialogTitle>
          <DialogDescription>Update account details, status and role assignments.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="firstName" label="First name" required />
            <TextField form={form} name="lastName" label="Last name" required />
          </div>
          <TextField form={form} name="email" label="Email" type="email" required />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="jobTitle" label="Job title" />
            <TextField form={form} name="phone" label="Phone" />
          </div>
          <SelectField form={form} name="status" label="Status" options={[...USER_STATUSES]} />
          <RolePicker
            roleOptions={roleOptions}
            selected={roleIds}
            onToggle={(roleId, checked) => {
              setRoleError(null);
              setRoleIds((prev) => (checked ? [...prev, roleId] : prev.filter((id) => id !== roleId)));
            }}
            error={roleError ?? undefined}
          />
          {submitError ? <p className="text-xs font-medium text-destructive">{submitError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
