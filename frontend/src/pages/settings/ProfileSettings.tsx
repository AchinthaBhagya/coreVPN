import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, Lock, Loader2, ShieldCheck, User } from "lucide-react";

import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { passwordPolicy, passwordSchema } from "@/lib/validation";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { TextField } from "@/components/common/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthUser } from "@/types";

/**
 * Personal profile, password and access summary.
 *
 * Contract (backend/src/routes/auth.routes.ts):
 * - `PATCH /auth/profile` accepts `firstName`/`lastName` (1-80), `phone` (<=40,
 *   nullable) and `jobTitle` (<=120, nullable). It returns the updated user, but
 *   `phone` is only echoed by `GET /auth/me`, so the context is refreshed after
 *   saving.
 * - `POST /auth/change-password` takes `currentPassword` + `newPassword`
 *   (400 = wrong current password, 422 = policy/different-password errors, which
 *   carry a `newPassword` field error).
 */

const profileSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80, "First name is too long"),
  lastName: z.string().trim().min(1, "Last name is required").max(80, "Last name is too long"),
  phone: z.string().trim().max(40, "Phone number is too long"),
  jobTitle: z.string().trim().max(120, "Job title is too long"),
});

type ProfileValues = z.infer<typeof profileSchema>;

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

function valuesFromUser(user: AuthUser): ProfileValues {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone ?? "",
    jobTitle: user.jobTitle ?? "",
  };
}

function ProfileCard({ user }: { user: AuthUser }) {
  const { refresh } = useAuth();
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: valuesFromUser(user),
  });
  const { reset } = form;

  useEffect(() => {
    reset(valuesFromUser(user));
  }, [user, reset]);

  const mutation = useMutation({
    mutationFn: (values: ProfileValues) =>
      api.patch<{ user: AuthUser }>("/auth/profile", {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        phone: values.phone.trim() || null,
        jobTitle: values.jobTitle.trim() || null,
      }),
    onSuccess: async () => {
      toastSuccess("Profile updated", "Your details have been saved.");
      await refresh();
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) {
        form.setError(key as keyof ProfileValues, { message });
      }
      toastError(error);
    },
  });

  return (
    <SectionCard
      title="Profile"
      description="Your name, contact number and role title shown across the workspace."
      actions={<User className="h-4 w-4 text-muted-foreground" />}
    >
      <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="firstName" label="First name" required autoComplete="given-name" />
          <TextField form={form} name="lastName" label="Last name" required autoComplete="family-name" />
          <TextField
            form={form}
            name="phone"
            label="Phone"
            type="tel"
            placeholder="+94 77 000 0000"
            autoComplete="tel"
          />
          <TextField form={form} name="jobTitle" label="Job title" placeholder="e.g. Project Manager" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-email" className="text-xs font-medium text-muted-foreground">
            Email
          </Label>
          <Input id="profile-email" type="email" value={user.email} disabled autoComplete="email" />
          <p className="text-xs text-muted-foreground">
            Your sign-in email. Contact an administrator if it needs to change.
          </p>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending || !form.formState.isDirty}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function ChangePasswordCard() {
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: (values: ChangePasswordValues) =>
      api.post<{ changed: boolean }>("/auth/change-password", {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }),
    onSuccess: () => {
      toastSuccess("Password updated", "Use your new password the next time you sign in.");
      form.reset();
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) {
        form.setError(key as keyof ChangePasswordValues, { message });
      }
      toastError(error);
    },
  });

  return (
    <SectionCard
      title="Change password"
      description={passwordPolicy.summary}
      actions={<Lock className="h-4 w-4 text-muted-foreground" />}
    >
      <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4" noValidate>
        <TextField
          form={form}
          name="currentPassword"
          label="Current password"
          type="password"
          required
          autoComplete="current-password"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            form={form}
            name="newPassword"
            label="New password"
            type="password"
            required
            autoComplete="new-password"
          />
          <TextField
            form={form}
            name="confirmPassword"
            label="Confirm new password"
            type="password"
            required
            autoComplete="new-password"
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Update password
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function AccessCard({ user }: { user: AuthUser }) {
  const roles = user.roles ?? [];
  const permissions = user.permissions ?? [];

  return (
    <SectionCard
      title="Roles & permissions"
      description="Access is assigned by administrators and cannot be edited here."
      actions={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Roles</p>
          {roles.length ? (
            <div className="flex flex-wrap gap-2">
              {roles.map((role) => (
                <Badge key={role.id} variant="info">
                  {role.name}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No roles assigned.</p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Permissions
            <span className="ml-2 text-foreground">{permissions.length}</span>
          </p>
          {permissions.length ? (
            <div className="max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap gap-1.5">
                {permissions.map((permission) => (
                  <Badge key={permission} variant="muted" className="font-mono text-[11px]">
                    {permission}
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No permissions granted.</p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

export default function ProfileSettings() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My profile"
        description="Manage your personal details and account security."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileCard user={user} />
        <ChangePasswordCard />
      </div>

      <AccessCard user={user} />
    </div>
  );
}
