import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { BellRing, Loader2, RotateCcw, Save } from "lucide-react";

import { api } from "@/lib/api";
import { qk } from "@/lib/queryClient";
import { toastError, toastSuccess } from "@/lib/errors";
import { humanize } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable } from "@/components/common/DataTable";
import { ErrorState } from "@/components/common/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { NotificationPreference } from "@/types";

/**
 * Per-user notification delivery channels.
 *
 * Contract (backend/src/routes/notification.routes.ts):
 * - `GET /notifications/preferences` returns `{ preferences }` covering every
 *   `NotificationType` value (missing rows default to `inApp: true`).
 * - `PUT /notifications/preferences` takes `{ preferences: [...] }` and upserts
 *   each row. In-app alerts for critical security/financial events cannot be
 *   fully disabled, so their in-app switch is locked on in this UI.
 */

type Channel = "inApp" | "email" | "discord";

const NOTIFICATION_TYPES = [
  "LEAD_NEW",
  "ORDER_NEW",
  "PROJECT_ASSIGNED",
  "TASK_ASSIGNED",
  "DEADLINE_UPCOMING",
  "TASK_OVERDUE",
  "QUOTATION_APPROVAL",
  "INVOICE_ISSUED",
  "INVOICE_OVERDUE",
  "PAYMENT_RECORDED",
  "TICKET_CREATED",
  "TICKET_REPLY",
  "REVISION_REQUESTED",
  "PROJECT_COMPLETED",
  "PAYOUT_APPROVAL",
  "SYSTEM",
] as const;

/** Types whose in-app delivery is mandatory (security / financial). */
const CRITICAL_IN_APP = new Set<string>([
  "INVOICE_ISSUED",
  "INVOICE_OVERDUE",
  "PAYMENT_RECORDED",
  "PAYOUT_APPROVAL",
  "SYSTEM",
]);

const TYPE_META: Record<string, { label: string; description: string }> = {
  LEAD_NEW: { label: "New lead", description: "A new lead is captured." },
  ORDER_NEW: { label: "New order", description: "A service order is created." },
  PROJECT_ASSIGNED: { label: "Project assigned", description: "You are added to a project." },
  TASK_ASSIGNED: { label: "Task assigned", description: "A task is assigned to you." },
  DEADLINE_UPCOMING: { label: "Deadline approaching", description: "A task or project deadline is near." },
  TASK_OVERDUE: { label: "Task overdue", description: "A task has passed its due date." },
  QUOTATION_APPROVAL: { label: "Quotation approval", description: "A quotation needs approval or was decided." },
  INVOICE_ISSUED: { label: "Invoice issued", description: "An invoice is issued to a client." },
  INVOICE_OVERDUE: { label: "Invoice overdue", description: "An invoice has passed its due date." },
  PAYMENT_RECORDED: { label: "Payment recorded", description: "A payment is recorded against an invoice." },
  TICKET_CREATED: { label: "Ticket created", description: "A support ticket is raised." },
  TICKET_REPLY: { label: "Ticket reply", description: "Someone replies on a support ticket." },
  REVISION_REQUESTED: { label: "Revision requested", description: "A client requests a project revision." },
  PROJECT_COMPLETED: { label: "Project completed", description: "A project is marked complete." },
  PAYOUT_APPROVAL: { label: "Payout approval", description: "A member payout needs approval or was paid." },
  SYSTEM: { label: "System notices", description: "Security and system announcements." },
};

function typeLabel(type: string): string {
  return TYPE_META[type]?.label ?? humanize(type);
}

/** Normalises the API payload into one editable row per known notification type. */
function buildDraft(preferences: NotificationPreference[]): NotificationPreference[] {
  const byType = new Map(preferences.map((preference) => [preference.type, preference]));
  return NOTIFICATION_TYPES.map((type) => {
    const preference = byType.get(type);
    return {
      type,
      inApp: CRITICAL_IN_APP.has(type) ? true : preference?.inApp ?? true,
      email: preference?.email ?? false,
      discord: preference?.discord ?? false,
    };
  });
}

function withChannel(preference: NotificationPreference, channel: Channel, value: boolean): NotificationPreference {
  if (channel === "inApp") return { ...preference, inApp: value };
  if (channel === "email") return { ...preference, email: value };
  return { ...preference, discord: value };
}

export default function NotificationSettings() {
  const queryClient = useQueryClient();
  const query = useQuery<{ preferences: NotificationPreference[] }>({
    queryKey: qk.notifications.preferences,
    queryFn: ({ signal }) => api.get<{ preferences: NotificationPreference[] }>("/notifications/preferences", undefined, signal),
  });

  const baseline = useMemo(
    () => (query.data ? buildDraft(query.data.preferences) : null),
    [query.data],
  );
  const [draft, setDraft] = useState<NotificationPreference[] | null>(null);

  useEffect(() => {
    setDraft(baseline);
  }, [baseline]);

  const saveMutation = useMutation({
    mutationFn: (preferences: NotificationPreference[]) =>
      api.put<{ updated: number }>("/notifications/preferences", { preferences }),
    onSuccess: () => {
      toastSuccess("Preferences saved", "Your notification delivery settings are up to date.");
      queryClient.invalidateQueries({ queryKey: qk.notifications.preferences });
    },
    onError: (error) => {
      toastError(error, "Your notification preferences could not be saved.");
    },
  });

  const dirty = Boolean(draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline));

  const update = (type: string, channel: Channel, value: boolean) => {
    setDraft((prev) =>
      prev ? prev.map((preference) => (preference.type === type ? withChannel(preference, channel, value) : preference)) : prev,
    );
  };

  const columns: ColumnDef<NotificationPreference, unknown>[] = [
    {
      accessorKey: "type",
      header: "Notification",
      cell: ({ row }) => {
        const meta = TYPE_META[row.original.type];
        return (
          <div className="max-w-md min-w-0">
            <p className="font-medium text-foreground">{typeLabel(row.original.type)}</p>
            {meta?.description ? <p className="text-xs text-muted-foreground">{meta.description}</p> : null}
          </div>
        );
      },
    },
    {
      id: "inApp",
      header: "In-app",
      enableSorting: false,
      cell: ({ row }) => (
        <Switch
          checked={row.original.inApp}
          disabled={CRITICAL_IN_APP.has(row.original.type)}
          onCheckedChange={(checked) => update(row.original.type, "inApp", checked)}
          aria-label={`In-app notifications for ${typeLabel(row.original.type)}`}
        />
      ),
    },
    {
      id: "email",
      header: "Email",
      enableSorting: false,
      cell: ({ row }) => (
        <Switch
          checked={row.original.email}
          onCheckedChange={(checked) => update(row.original.type, "email", checked)}
          aria-label={`Email notifications for ${typeLabel(row.original.type)}`}
        />
      ),
    },
    {
      id: "discord",
      header: "Discord",
      enableSorting: false,
      cell: ({ row }) => (
        <Switch
          checked={row.original.discord}
          onCheckedChange={(checked) => update(row.original.type, "discord", checked)}
          aria-label={`Discord notifications for ${typeLabel(row.original.type)}`}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notification settings"
        description="Choose how you want to be alerted about activity in the workspace."
        actions={
          <>
            {dirty ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setDraft(baseline)}
                disabled={saveMutation.isPending}
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={() => {
                if (draft) saveMutation.mutate(draft);
              }}
              disabled={!dirty || saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save preferences
            </Button>
          </>
        }
      />

      <Alert variant="info">
        <BellRing />
        <AlertTitle>Critical alerts can't be turned off in-app</AlertTitle>
        <AlertDescription>
          In-app alerts for critical security and financial events — invoices, payments, payouts and system notices —
          are always delivered. You can still control whether those events also reach you by email or Discord.
        </AlertDescription>
      </Alert>

      {query.isError ? (
        <ErrorState
          title="Couldn't load notification settings"
          description={query.error instanceof Error ? query.error.message : "Please try again in a moment."}
          onRetry={() => query.refetch()}
        />
      ) : (
        <SectionCard
          title="Notification types"
          description="Toggle the delivery channels for each kind of notification."
        >
          <DataTable
            columns={columns}
            data={(draft ?? baseline) ?? []}
            isLoading={query.isLoading}
            emptyTitle="No notification types"
            emptyDescription="Notification preferences will appear here once available."
          />
        </SectionCard>
      )}
    </div>
  );
}
