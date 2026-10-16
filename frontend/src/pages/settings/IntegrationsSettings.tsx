import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, FlaskConical, Loader2, Lock, Pencil, Save, Send, ShieldAlert, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useApiMutation } from "@/hooks/useApi";
import { toastSuccess } from "@/lib/errors";
import { formatRelative } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { AsyncBoundary } from "@/components/common/states";
import { DataTable } from "@/components/common/DataTable";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SelectField, TextField } from "@/components/common/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { DiscordEventConfig, SmtpSettings } from "@/types";

/**
 * Discord webhooks + SMTP configuration.
 *
 * Secrets contract (backend/src/routes/integration.routes.ts):
 * - Discord webhook URLs and the SMTP password are stored server-side and are
 *   NEVER returned by the API. The browser only ever sees masked fingerprints
 *   / "configured" flags, plus whatever the user just typed into an input.
 * - Failed Discord deliveries are retried by the server and tracked with
 *   failure counters + lastError, so nothing is lost silently.
 */

interface Opt {
  value: string;
  label: string;
}

interface DiscordResponse {
  events: DiscordEventConfig[];
  available: string[];
}

interface IntegrationStatusRow {
  id: string;
  provider: string;
  key: string;
  value: string | null;
  isSecret: boolean;
  isEnabled: boolean;
  description: string | null;
  failureCount: number;
  lastError: string | null;
  lastUsedAt: string | null;
  updatedAt: string;
}

const DISCORD_WEBHOOK_PATTERN = /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const urlSchema = z.object({
  event: z.string().min(1, "Choose an event"),
  url: z
    .string()
    .trim()
    .min(1, "Paste the full webhook URL")
    .max(500, "That URL is too long")
    .refine((value) => DISCORD_WEBHOOK_PATTERN.test(value), "Must be a Discord webhook URL (https://discord.com/api/webhooks/...)"),
});

type UrlValues = z.infer<typeof urlSchema>;

const smtpSchema = z.object({
  host: z.string().trim().max(255),
  port: z.string().refine(
    (value) => value.trim() === "" || (/^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 65535),
    "Port must be between 1 and 65535",
  ),
  user: z.string().trim().max(255),
  pass: z.string().max(500),
  from: z
    .string()
    .trim()
    .max(255)
    .refine((value) => value === "" || z.string().email().safeParse(value).success, "Enter a valid from address"),
});

type SmtpValues = z.infer<typeof smtpSchema>;

const EMPTY_SMTP: SmtpValues = { host: "", port: "", user: "", pass: "", from: "" };

function buildSmtpPayload(values: SmtpValues) {
  return {
    host: values.host,
    port: values.port.trim() === "" ? null : Number(values.port),
    user: values.user,
    from: values.from,
    // Blank password means "keep the stored one" - the API ignores it.
    ...(values.pass ? { pass: values.pass } : {}),
  };
}

export default function IntegrationsSettings() {
  const { can, user } = useAuth();
  const canEdit = can("settings.integrations");
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");

  const discordQuery = useQuery({
    queryKey: ["integrations", "discord"],
    queryFn: ({ signal }) => api.get<DiscordResponse>("/integrations/discord", undefined, signal),
  });
  const smtpQuery = useQuery({
    queryKey: ["integrations", "smtp"],
    queryFn: ({ signal }) => api.get<SmtpSettings>("/integrations/smtp", undefined, signal),
  });
  // Supplementary status (failure counters / last delivery) - degrades silently.
  const statusQuery = useQuery({
    queryKey: ["integrations", "status"],
    queryFn: ({ signal }) => api.get<IntegrationStatusRow[]>("/integrations/", undefined, signal),
    staleTime: 30_000,
  });

  const urlForm = useForm<UrlValues>({ resolver: zodResolver(urlSchema), defaultValues: { event: "", url: "" } });
  const smtpForm = useForm<SmtpValues>({ resolver: zodResolver(smtpSchema), defaultValues: EMPTY_SMTP });
  const { reset: resetSmtp } = smtpForm;

  const smtpData = smtpQuery.data;

  useEffect(() => {
    if (smtpData) {
      resetSmtp({
        host: smtpData.host ?? "",
        port: smtpData.port ?? "",
        user: smtpData.user ?? "",
        pass: "",
        from: smtpData.from ?? "",
      });
    }
  }, [smtpData, resetSmtp]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["integrations"] });
  };

  const toggleMutation = useApiMutation(
    (vars: { event: string; isEnabled: boolean }) =>
      api.put<{ event: string; maskedUrl: string | null; isEnabled: boolean }>("/integrations/discord", vars),
    { onSuccess: invalidate },
  );

  const testMutation = useApiMutation((vars: { event: string }) =>
    api.post<{ ok: boolean; status: number | null }>("/integrations/discord/test", { event: vars.event }),
  );

  const urlMutation = useApiMutation(
    (vars: { event: string; url: string }) =>
      api.put<{ event: string; maskedUrl: string | null; isEnabled: boolean }>("/integrations/discord", vars),
    {
      onSuccess: (_data, vars) => {
        toastSuccess(
          vars.url ? "Webhook URL saved" : "Webhook URL cleared",
          "The URL lives server-side only and is never sent back to the browser.",
        );
        urlForm.setValue("url", "");
        urlForm.clearErrors("url");
        invalidate();
      },
    },
  );

  const removeMutation = useApiMutation((vars: { event: string }) =>
    api.del<void>(`/integrations/discord/${encodeURIComponent(vars.event)}`),
  );

  const smtpSaveMutation = useApiMutation(
    (formValues: SmtpValues) => api.put<SmtpSettings>("/integrations/smtp", buildSmtpPayload(formValues)),
    {
      onSuccess: (_data, formValues) => {
        toastSuccess(
          "SMTP settings saved",
          formValues.pass ? "The password was stored as a server-side secret." : "SMTP connection details are up to date.",
        );
        smtpForm.setValue("pass", "");
        invalidate();
      },
    },
  );

  const smtpTestMutation = useApiMutation((vars: { to: string }) =>
    api.post<{ ok: boolean }>("/integrations/smtp/test", vars),
    { onSuccess: () => toastSuccess("Test email sent", "Check the inbox for the 3xCodz SMTP test message.") },
  );

  const discordData = discordQuery.data;
  const statusRows = statusQuery.data ?? [];
  const statusByEvent = new Map<string, IntegrationStatusRow>();
  for (const row of statusRows) {
    if (row.provider === "DISCORD" && row.key.startsWith("webhook.")) {
      statusByEvent.set(row.key.slice("webhook.".length), row);
    }
  }

  const eventList: string[] = discordData
    ? discordData.available.length > 0
      ? discordData.available
      : discordData.events.map((entry) => entry.event)
    : [];
  const eventOptions: Opt[] = eventList.map((event) => ({ value: event, label: event }));

  const columns: ColumnDef<DiscordEventConfig, unknown>[] = [
    {
      accessorKey: "event",
      header: "Event",
      cell: ({ row }) => <span className="font-mono text-xs text-foreground">{row.original.event}</span>,
    },
    {
      id: "webhook",
      header: "Webhook",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="space-y-1">
          <Badge variant={row.original.hasWebhook ? "success" : "muted"}>
            {row.original.hasWebhook ? "Configured" : "Not configured"}
          </Badge>
          {row.original.maskedUrl ? (
            <p
              className="max-w-[32ch] truncate font-mono text-[11px] text-muted-foreground"
              title={row.original.maskedUrl}
            >
              {row.original.maskedUrl}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: "delivery",
      header: "Delivery status",
      enableSorting: false,
      cell: ({ row }) => {
        if (!statusQuery.data) return <span className="text-xs text-muted-foreground">-</span>;
        const status = statusByEvent.get(row.original.event);
        const error = row.original.lastError ?? status?.lastError ?? null;
        const failures = status?.failureCount ?? 0;
        if (error || failures > 0) {
          return (
            <div className="space-y-1">
              <p className="max-w-[28ch] break-words text-xs font-medium text-danger">{error ?? "Delivery failed"}</p>
              <p className="text-[11px] text-muted-foreground">
                {failures} {failures === 1 ? "failure" : "failures"} - retried &amp; logged server-side
              </p>
            </div>
          );
        }
        return (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">No failures recorded</p>
            {status?.lastUsedAt ? (
              <p className="text-[11px] text-muted-foreground">Last delivery {formatRelative(status.lastUsedAt)}</p>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "enabled",
      header: "Enabled",
      enableSorting: false,
      cell: ({ row }) => (
        <Switch
          checked={row.original.isEnabled}
          disabled={!canEdit || (toggleMutation.isPending && toggleMutation.variables?.event === row.original.event)}
          onCheckedChange={(checked) => toggleMutation.mutate({ event: row.original.event, isEnabled: checked })}
          aria-label={`Toggle ${row.original.event}`}
        />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => {
        const event = row.original.event;
        const testing = testMutation.isPending && testMutation.variables?.event === event;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canEdit || !row.original.hasWebhook || testing}
              title={row.original.hasWebhook ? "Send a test message to Discord" : "Add a webhook URL first"}
              onClick={() => testMutation.mutate({ event })}
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              Test
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canEdit}
              title="Replace webhook URL for this event"
              onClick={() => {
                urlForm.setValue("event", event);
                urlForm.setValue("url", "");
                urlForm.clearErrors("event");
                document.getElementById("url")?.focus();
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canEdit || !row.original.hasWebhook}
              title="Remove webhook"
              onClick={() => setRemoveTarget(event)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        );
      },
    },
  ];

  const onSaveUrl = urlForm.handleSubmit((formValues) => urlMutation.mutate(formValues));

  const onClearUrl = () => {
    const { event } = urlForm.getValues();
    if (!event) {
      urlForm.setError("event", { message: "Choose an event first" });
      return;
    }
    urlMutation.mutate({ event, url: "" });
  };

  const onSaveSmtp = smtpForm.handleSubmit((formValues) => smtpSaveMutation.mutate(formValues));

  const effectiveTestTo = testTo.trim() || smtpData?.from || user?.email || "";
  const testToValid = EMAIL_PATTERN.test(effectiveTestTo);

  const sendTestEmail = () => {
    if (!testToValid) return;
    smtpTestMutation.mutate({ to: effectiveTestTo });
  };

  const configuredCount = discordData?.events.filter((entry) => entry.hasWebhook).length ?? 0;
  const enabledCount = discordData?.events.filter((entry) => entry.isEnabled).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Discord notifications and outbound email. Secrets are stored server-side and are never returned to this browser."
      />

      {!canEdit ? (
        <Alert variant="info">
          <ShieldAlert />
          <AlertTitle>View-only access</AlertTitle>
          <AlertDescription>
            You can review the integration setup, but changing it requires the{" "}
            <span className="font-medium">settings.integrations</span> permission.
          </AlertDescription>
        </Alert>
      ) : null}

      <SectionCard
        title="Discord notifications"
        description="Per-event webhooks for leads, orders, invoices, tickets and payouts."
        actions={
          discordData ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success">
                {configuredCount} of {discordData.events.length} configured
              </Badge>
              <Badge variant={enabledCount > 0 ? "info" : "muted"}>{enabledCount} enabled</Badge>
            </div>
          ) : null
        }
      >
        <AsyncBoundary
          isLoading={discordQuery.isLoading}
          isError={discordQuery.isError}
          error={discordQuery.error}
          onRetry={() => discordQuery.refetch()}
        >
          {discordData ? (
            <div className="space-y-4">
              <Alert variant="info">
                <Lock />
                <AlertTitle>Webhook URLs never leave the server</AlertTitle>
                <AlertDescription>
                  Stored as server-side secrets and never echoed back - the table only shows a masked fingerprint. To
                  replace one, paste the full Discord webhook URL below; it is sent once and only the mask is kept.
                </AlertDescription>
              </Alert>
              <Alert variant="warning">
                <AlertTriangle />
                <AlertTitle>Failures are retried and logged</AlertTitle>
                <AlertDescription>
                  When Discord rejects a delivery the server retries automatically and records the failure (count and
                  last error) against the integration, so missed alerts show up here instead of disappearing silently.
                </AlertDescription>
              </Alert>

              <div className="space-y-4">
                <DataTable
                  columns={columns}
                  data={discordData.events}
                  emptyTitle="No Discord events available"
                  emptyDescription="This server does not expose any subscribable Discord events."
                />
              </div>

              <Separator />

              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">Replace a webhook URL</h3>
                  <p className="text-xs text-muted-foreground">
                    The stored URL is never sent to this browser. Pick the event and paste the full webhook URL to
                    replace it, or clear it to stop deliveries.
                  </p>
                </div>
                <form onSubmit={onSaveUrl} noValidate className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    form={urlForm}
                    name="event"
                    label="Event"
                    options={eventOptions}
                    placeholder="Select an event..."
                    disabled={!canEdit}
                  />
                  <TextField
                    form={urlForm}
                    name="url"
                    label="New webhook URL"
                    placeholder="https://discord.com/api/webhooks/..."
                    autoComplete="off"
                    disabled={!canEdit}
                  />
                  <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                    <Button type="submit" size="sm" disabled={!canEdit || urlMutation.isPending}>
                      {urlMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save URL
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onClearUrl}
                      disabled={!canEdit || urlMutation.isPending}
                    >
                      Clear URL
                    </Button>
                    <p className="text-xs text-muted-foreground">Stored server-side only - never displayed again.</p>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
        </AsyncBoundary>
      </SectionCard>

      <form onSubmit={onSaveSmtp} noValidate>
        <SectionCard
          title="Email (SMTP)"
          description="Outbound mail for quotations, invoices, alerts and password resets."
          actions={
            canEdit ? (
              <Button type="submit" size="sm" disabled={smtpSaveMutation.isPending}>
                {smtpSaveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save SMTP
              </Button>
            ) : null
          }
        >
          <AsyncBoundary
            isLoading={smtpQuery.isLoading}
            isError={smtpQuery.isError}
            error={smtpQuery.error}
            onRetry={() => smtpQuery.refetch()}
          >
            {smtpData ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={smtpData.configured ? "success" : "warning"}>
                    {smtpData.configured ? "SMTP configured" : "SMTP not configured"}
                  </Badge>
                  <Badge variant={smtpData.hasPassword ? "info" : "muted"}>
                    {smtpData.hasPassword ? "Password stored" : "No password stored"}
                  </Badge>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    form={smtpForm}
                    name="host"
                    label="SMTP host"
                    placeholder="smtp.company.com"
                    description="Leave blank to disable SMTP."
                    disabled={!canEdit}
                  />
                  <TextField
                    form={smtpForm}
                    name="port"
                    label="Port"
                    type="number"
                    min={1}
                    max={65535}
                    placeholder="587"
                    disabled={!canEdit}
                  />
                  <TextField
                    form={smtpForm}
                    name="user"
                    label="Username"
                    placeholder="smtp user"
                    disabled={!canEdit}
                  />
                  <TextField
                    form={smtpForm}
                    name="from"
                    label="From address"
                    type="email"
                    placeholder="no-reply@company.com"
                    disabled={!canEdit}
                  />
                </div>

                <TextField
                  form={smtpForm}
                  name="pass"
                  label="Password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={smtpData.hasPassword ? "•••••••• (stored - leave blank to keep)" : "Not set yet"}
                  description="Stored server-side as a secret; only whether a password is set is ever reported back."
                  disabled={!canEdit}
                />

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="smtp-test-to" className="text-xs font-medium text-muted-foreground">
                    Send a test email to
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      id="smtp-test-to"
                      type="email"
                      placeholder="you@company.com"
                      value={testTo}
                      onChange={(event) => setTestTo(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          sendTestEmail();
                        }
                      }}
                      disabled={!canEdit}
                      className="h-10 min-w-[220px] flex-1"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={sendTestEmail}
                      disabled={!canEdit || !testToValid || smtpTestMutation.isPending}
                    >
                      {smtpTestMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Send test email
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Uses the from address above and the subject "3xCodz SMTP test".{" "}
                    {smtpData.from || user?.email ? `Defaults to ${smtpData.from || user?.email}.` : null}
                  </p>
                </div>
              </div>
            ) : null}
          </AsyncBoundary>
        </SectionCard>
      </form>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="Remove Discord webhook?"
        description={
          removeTarget
            ? `The stored webhook for "${removeTarget}" will be deleted and deliveries for this event will stop immediately.`
            : undefined
        }
        confirmLabel="Remove webhook"
        destructive
        loading={removeMutation.isPending}
        onConfirm={() => {
          if (!removeTarget) return;
          removeMutation.mutate(
            { event: removeTarget },
            {
              onSuccess: (_data, vars) => {
                toastSuccess("Webhook removed", `${vars.event} no longer delivers to Discord.`);
                setRemoveTarget(null);
                invalidate();
              },
            },
          );
        }}
      />
    </div>
  );
}
