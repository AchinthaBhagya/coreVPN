import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Activity as ActivityIcon, Building2, Loader2, Lock, User } from "lucide-react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { useApiQuery } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { formatDate, formatRelative } from "@/lib/format";
import { passwordPolicy, passwordSchema } from "@/lib/validation";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard, InfoList } from "@/components/common/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TextField } from "@/components/common/form";
import { ErrorState, LoadingState } from "@/components/common/states";
import type { PortalProfile } from "@/types";

interface PortalCompany {
  name: string;
  legalName: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  taxId: string | null;
  currency: string;
  paymentTermsDays: number;
}

interface PortalActivityItem {
  id: string;
  action: string;
  summary: string;
  entityType: string;
  createdAt: string;
}

const profileFormSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80, "First name is too long"),
  lastName: z.string().trim().min(1, "Last name is required").max(80, "Last name is too long"),
  phone: z.string().trim().max(40, "Phone number is too long").optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

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

function ProfileDetailsCard({
  profile,
  canUpdate,
  onUpdated,
}: {
  profile: PortalProfile;
  canUpdate: boolean;
  onUpdated: () => void;
}) {
  const queryClient = useQueryClient();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      firstName: profile.client?.firstName ?? profile.user.firstName,
      lastName: profile.client?.lastName ?? profile.user.lastName,
      phone: profile.client?.phone ?? profile.user.phone ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: (values: ProfileFormValues) =>
      api.patch("/portal/profile", {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        phone: values.phone?.trim() || null,
      }),
    onSuccess: () => {
      toastSuccess("Profile updated", "Your contact details have been saved.");
      queryClient.invalidateQueries({ queryKey: qk.portal.profile });
      onUpdated();
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) form.setError(key as keyof ProfileFormValues, { message });
      toastError(error);
    },
  });

  return (
    <SectionCard
      title="Contact details"
      description="Used on invoices, quotations and project correspondence."
      actions={<User className="h-4 w-4 text-muted-foreground" />}
    >
      <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="firstName" label="First name" required disabled={!canUpdate} />
          <TextField form={form} name="lastName" label="Last name" required disabled={!canUpdate} />
        </div>
        <TextField form={form} name="phone" label="Phone" type="tel" disabled={!canUpdate} placeholder="+94 11 000 0000" />
        <div className="space-y-1.5">
          <Label htmlFor="profile-email" className="text-xs font-medium text-muted-foreground">
            Email
          </Label>
          <Input id="profile-email" type="email" value={profile.user.email} disabled autoComplete="email" />
          <p className="text-xs text-muted-foreground">Your sign-in email. Contact us if it needs to change.</p>
        </div>
        {canUpdate ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={mutation.isPending || !form.formState.isDirty}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            You don't have permission to edit your contact details. Please reach out to 3xCodz instead.
          </p>
        )}
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
      api.post("/auth/change-password", { currentPassword: values.currentPassword, newPassword: values.newPassword }),
    onSuccess: () => {
      toastSuccess("Password updated", "Use your new password the next time you sign in.");
      form.reset();
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      for (const [key, message] of Object.entries(fields)) form.setError(key as keyof ChangePasswordValues, { message });
      toastError(error);
    },
  });

  return (
    <SectionCard
      title="Change password"
      description={passwordPolicy.summary}
      actions={<Lock className="h-4 w-4 text-muted-foreground" />}
    >
      <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
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
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Update password
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

export default function PortalProfilePage() {
  const { can, refresh } = useAuth();

  const profileQuery = useApiQuery<PortalProfile>(qk.portal.profile, "/portal/profile");
  const companyQuery = useApiQuery<PortalCompany>(["portal", "company"], "/portal/company");
  const activityQuery = useApiQuery<PortalActivityItem[]>(["portal", "activity"], "/portal/activity");

  if (profileQuery.isLoading) return <LoadingState label="Loading your profile..." />;
  if (profileQuery.isError || !profileQuery.data) {
    return (
      <ErrorState
        title="We couldn't load your profile"
        description={profileQuery.error instanceof Error ? profileQuery.error.message : undefined}
        onRetry={() => void profileQuery.refetch()}
      />
    );
  }

  const profile = profileQuery.data;
  const activityItems = activityQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My profile"
        description="Manage your contact details, account security and review recent account activity."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileDetailsCard
          profile={profile}
          canUpdate={can("portal.profile.update")}
          onUpdated={() => void refresh()}
        />
        <ChangePasswordCard />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Company & billing"
          description="3xCodz details shown on your invoices and official correspondence."
          actions={<Building2 className="h-4 w-4 text-muted-foreground" />}
        >
          {companyQuery.isLoading ? (
            <LoadingState label="Loading company details..." className="py-8" />
          ) : companyQuery.isError || !companyQuery.data ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Company details could not be loaded right now.
            </p>
          ) : (
            <InfoList
              items={[
                { label: "Company", value: companyQuery.data.name },
                { label: "Legal name", value: companyQuery.data.legalName || "-" },
                { label: "Address", value: companyQuery.data.address || "-", full: true },
                { label: "Email", value: companyQuery.data.email || "-" },
                { label: "Phone", value: companyQuery.data.phone || "-" },
                { label: "Website", value: companyQuery.data.website || "-" },
                { label: "Tax ID", value: companyQuery.data.taxId || "-" },
                { label: "Default currency", value: companyQuery.data.currency },
                { label: "Payment terms", value: `${companyQuery.data.paymentTermsDays} days` },
              ]}
            />
          )}
        </SectionCard>

        <SectionCard
          title="Recent activity"
          description="The latest client-visible events on your account."
          actions={<ActivityIcon className="h-4 w-4 text-muted-foreground" />}
        >
          {activityQuery.isLoading ? (
            <LoadingState label="Loading activity..." className="py-8" />
          ) : activityQuery.isError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Activity could not be loaded right now.</p>
          ) : activityItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {activityItems.slice(0, 10).map((entry) => (
                <div key={entry.id} className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-r from-primary to-primary/40" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{entry.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.entityType} · {formatRelative(entry.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
              <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                Earliest shown: {formatDate(activityItems[activityItems.length - 1]?.createdAt)}
              </p>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
