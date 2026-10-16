import { useEffect, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, FileUp, HardDrive, Loader2, MessageSquare, Save, Server, Timer } from "lucide-react";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { OPTIONS } from "@/lib/status";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { ErrorState, LoadingState } from "@/components/common/states";
import { SelectField, TextField } from "@/components/common/form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { SystemSettings as SystemSettingsData } from "@/types";

/**
 * Operational defaults + read-only runtime information.
 *
 * Contract note (backend/src/routes/settings.routes.ts):
 * - `PUT /settings/system` accepts numbering prefixes, tax rate, allocation
 *   model, payment terms and maintenance mode.
 * - timezone / date / number format are owned by `PUT /settings/company`
 *   (`settings.company` permission). They are editable here and saved together
 *   with the system settings when the user holds both permissions; otherwise
 *   they render read-only with a pointer to Company settings.
 */

interface Opt {
  value: string;
  label: string;
}

const systemSchema = z.object({
  invoicePrefix: z.string().trim().min(1, "Prefix is required").max(20),
  quotationPrefix: z.string().trim().min(1, "Prefix is required").max(20),
  orderPrefix: z.string().trim().min(1, "Prefix is required").max(20),
  projectPrefix: z.string().trim().min(1, "Prefix is required").max(20),
  taxRate: z.string().refine(
    (value) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100,
    "Tax rate must be between 0 and 100",
  ),
  defaultAllocationModel: z.enum(OPTIONS.allocationModel),
  paymentTermsDays: z
    .string()
    .regex(/^\d+$/, "Enter a number of days")
    .refine((value) => Number(value) >= 0 && Number(value) <= 365, "Must be between 0 and 365"),
  timezone: z.string().trim().min(1, "Timezone is required").max(64),
  dateFormat: z.string().trim().min(1, "Date format is required").max(40),
  numberFormat: z.string().trim().min(1, "Number format is required").max(40),
  maintenanceMode: z.boolean(),
});

type Values = z.infer<typeof systemSchema>;

const EMPTY_VALUES: Values = {
  invoicePrefix: "",
  quotationPrefix: "",
  orderPrefix: "",
  projectPrefix: "",
  taxRate: "0",
  defaultAllocationModel: "PERCENT_OF_PROFIT",
  paymentTermsDays: "14",
  timezone: "",
  dateFormat: "",
  numberFormat: "",
  maintenanceMode: false,
};

function toValues(data: SystemSettingsData): Values {
  const allocation =
    data.defaultAllocationModel === "FIXED" || data.defaultAllocationModel === "PERCENT_OF_REVENUE"
      ? data.defaultAllocationModel
      : "PERCENT_OF_PROFIT";
  return {
    invoicePrefix: data.invoicePrefix ?? "",
    quotationPrefix: data.quotationPrefix ?? "",
    orderPrefix: data.orderPrefix ?? "",
    projectPrefix: data.projectPrefix ?? "",
    taxRate: String(data.taxRate ?? "0"),
    defaultAllocationModel: allocation,
    paymentTermsDays: String(data.paymentTermsDays ?? 14),
    timezone: data.timezone ?? "",
    dateFormat: data.dateFormat ?? "",
    numberFormat: data.numberFormat ?? "",
    maintenanceMode: Boolean(data.maintenanceMode),
  };
}

const TIMEZONE_OPTIONS: Opt[] = [
  "Asia/Colombo",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
].map((value) => ({ value, label: value }));

const DATE_FORMAT_OPTIONS: Opt[] = [
  { value: "yyyy-MM-dd", label: "2026-10-15 (yyyy-MM-dd)" },
  { value: "dd/MM/yyyy", label: "15/10/2026 (dd/MM/yyyy)" },
  { value: "MM/dd/yyyy", label: "10/15/2026 (MM/dd/yyyy)" },
  { value: "dd MMM yyyy", label: "15 Oct 2026 (dd MMM yyyy)" },
  { value: "dd MMM, yyyy", label: "15 Oct, 2026 (dd MMM, yyyy)" },
];

const NUMBER_FORMAT_OPTIONS: Opt[] = ["en-LK", "en-US", "en-GB", "en-IN", "en-AU", "de-DE", "fr-FR", "ja-JP"].map(
  (value) => ({ value, label: value }),
);

const ALLOCATION_OPTIONS: Opt[] = OPTIONS.allocationModel.map((value) => ({
  value,
  label:
    value === "FIXED"
      ? "Fixed amount"
      : value === "PERCENT_OF_REVENUE"
        ? "Percent of revenue"
        : "Percent of profit",
}));

/** Keeps the stored value visible even when it is not part of the preset list. */
function ensureOpt(options: Opt[], current: string | null | undefined): Opt[] {
  if (!current || options.some((option) => option.value === current)) return options;
  return [...options, { value: current, label: current }];
}

export default function SystemSettings() {
  const { can } = useAuth();
  const canEdit = can("settings.system");
  const canCompany = can("settings.company");
  const canLocale = canEdit && canCompany;

  const query = useQuery({
    queryKey: ["settings", "system"],
    queryFn: ({ signal }) => api.get<SystemSettingsData>("/settings/system", undefined, signal),
  });

  const form = useForm<Values>({ resolver: zodResolver(systemSchema), defaultValues: EMPTY_VALUES });
  const { reset } = form;

  useEffect(() => {
    if (query.data) reset(toValues(query.data));
  }, [query.data, reset]);

  const values = form.watch();
  const { isDirty } = form.formState;
  const maintenance = Boolean(values.maintenanceMode);

  const mutation = useMutation({
    mutationFn: async (formValues: Values) => {
      await api.put("/settings/system", {
        invoicePrefix: formValues.invoicePrefix.trim(),
        quotationPrefix: formValues.quotationPrefix.trim(),
        orderPrefix: formValues.orderPrefix.trim(),
        projectPrefix: formValues.projectPrefix.trim(),
        taxRate: Number(formValues.taxRate),
        defaultAllocationModel: formValues.defaultAllocationModel,
        paymentTermsDays: Number(formValues.paymentTermsDays),
        maintenanceMode: formValues.maintenanceMode,
      });
      if (canCompany) {
        // Locale formats live on the company profile - save them too.
        await api.put("/settings/company", {
          timezone: formValues.timezone.trim(),
          dateFormat: formValues.dateFormat.trim(),
          numberFormat: formValues.numberFormat.trim(),
        });
      }
    },
    onSuccess: (_data, formValues) => {
      toastSuccess(
        "System settings saved",
        formValues.maintenanceMode ? "Maintenance mode is currently ON." : undefined,
      );
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => {
      const errors = fieldErrors(error);
      for (const [key, message] of Object.entries(errors)) {
        if (key in systemSchema.shape) form.setError(key as keyof Values, { message });
      }
      toastError(error);
      // A partial save is possible when both endpoints are used - resync.
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const onSubmit = form.handleSubmit((formValues) => mutation.mutate(formValues));

  if (query.isLoading) return <LoadingState label="Loading system settings..." />;

  const data = query.data;
  if (query.isError || !data) {
    return (
      <ErrorState
        title="Couldn't load system settings"
        description={query.error instanceof Error ? query.error.message : "Please try again in a moment."}
        onRetry={() => query.refetch()}
      />
    );
  }

  const runtime = data.runtime;
  const runtimeItems: Array<{ label: string; icon: ReactNode; value: ReactNode }> = [
    {
      label: "Environment",
      icon: <Server className="h-4 w-4" />,
      value: (
        <Badge variant={runtime.nodeEnv === "production" ? "success" : "warning"}>
          {runtime.nodeEnv === "production" ? "Production" : runtime.nodeEnv === "test" ? "Test" : "Development"}
        </Badge>
      ),
    },
    {
      label: "Upload directory",
      icon: <HardDrive className="h-4 w-4" />,
      value: <span className="break-all font-mono text-xs">{runtime.uploadDir}</span>,
    },
    {
      label: "Max upload size",
      icon: <FileUp className="h-4 w-4" />,
      value: `${runtime.maxFileSizeMb} MB`,
    },
    {
      label: "Session TTL",
      icon: <Timer className="h-4 w-4" />,
      value: `${runtime.sessionTtlHours} hours`,
    },
    {
      label: "Discord integration",
      icon: <MessageSquare className="h-4 w-4" />,
      value: <Badge variant={runtime.discordEnabled ? "success" : "muted"}>{runtime.discordEnabled ? "Enabled" : "Disabled"}</Badge>,
    },
  ];

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <PageHeader
          title="System settings"
          description="Operational defaults for document numbering, finance and platform-wide behaviour."
          actions={
            canEdit ? (
              <Button type="submit" disabled={mutation.isPending || !isDirty} title={isDirty ? undefined : "No unsaved changes"}>
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save changes
              </Button>
            ) : null
          }
        />

        {!canEdit ? (
          <Alert variant="info">
            <AlertTriangle />
            <AlertTitle>View-only access</AlertTitle>
            <AlertDescription>
              You can review the system settings, but changing them requires the{" "}
              <span className="font-medium">settings.system</span> permission.
            </AlertDescription>
          </Alert>
        ) : null}

        <SectionCard
          title="Runtime environment"
          description="Read-only values reported by the running server process. They come from the deployment environment, not from this screen."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {runtimeItems.map((item) => (
              <div key={item.label} className="rounded-xl border border-border bg-muted/25 p-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  {item.icon}
                  <span className="text-xs font-medium uppercase tracking-wide">{item.label}</span>
                </div>
                <div className="mt-2 text-sm font-medium text-foreground">{item.value}</div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Numbering defaults" description="Prefixes prepended to every generated document number.">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <TextField form={form} name="invoicePrefix" label="Invoice prefix" placeholder="INV-" disabled={!canEdit} />
            <TextField
              form={form}
              name="quotationPrefix"
              label="Quotation prefix"
              placeholder="QT-"
              disabled={!canEdit}
            />
            <TextField form={form} name="orderPrefix" label="Order prefix" placeholder="ORD-" disabled={!canEdit} />
            <TextField form={form} name="projectPrefix" label="Project prefix" placeholder="PRJ-" disabled={!canEdit} />
          </div>
        </SectionCard>

        <SectionCard title="Finance defaults" description="Tax and profit-allocation behaviour for new documents.">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <TextField
              form={form}
              name="taxRate"
              label="Default tax rate (%)"
              type="number"
              step="any"
              min={0}
              max={100}
              placeholder="0"
              disabled={!canEdit}
            />
            <SelectField
              form={form}
              name="defaultAllocationModel"
              label="Default allocation model"
              options={ALLOCATION_OPTIONS}
              disabled={!canEdit}
            />
            <TextField
              form={form}
              name="paymentTermsDays"
              label="Payment terms (days)"
              type="number"
              min={0}
              max={365}
              placeholder="14"
              disabled={!canEdit}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Locale formats"
          description={
            canLocale
              ? "Stored with your company profile and saved together when you press Save."
              : "Editing requires the settings.company permission - these formats are also managed under Company settings."
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <SelectField
              form={form}
              name="timezone"
              label="Timezone"
              required
              options={ensureOpt(TIMEZONE_OPTIONS, values.timezone)}
              disabled={!canLocale}
            />
            <SelectField
              form={form}
              name="dateFormat"
              label="Date format"
              required
              options={ensureOpt(DATE_FORMAT_OPTIONS, values.dateFormat)}
              disabled={!canLocale}
            />
            <SelectField
              form={form}
              name="numberFormat"
              label="Number format"
              required
              options={ensureOpt(NUMBER_FORMAT_OPTIONS, values.numberFormat)}
              disabled={!canLocale}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Maintenance mode"
          description="Platform-wide availability switch. Changes are written to the audit log."
        >
          <div
            className={cn(
              "rounded-xl border p-4 transition-colors",
              maintenance ? "border-warning/50 bg-warning/10" : "border-border bg-muted/40",
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <AlertTriangle className={cn("h-4 w-4", maintenance ? "text-warning" : "text-muted-foreground")} />
                  Enable maintenance mode
                </p>
                <p className="text-xs text-muted-foreground">
                  Flags the workspace as being under maintenance. Toggle it only when you deliberately want to signal a
                  maintenance window - the change is recorded in the audit log together with your user.
                </p>
              </div>
              <Switch
                checked={maintenance}
                onCheckedChange={(checked) =>
                  form.setValue("maintenanceMode", checked, { shouldDirty: true, shouldValidate: true })
                }
                disabled={!canEdit}
                aria-label="Toggle maintenance mode"
                className={maintenance ? "data-[state=checked]:bg-warning" : undefined}
              />
            </div>
            {maintenance ? (
              <p className="mt-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                Maintenance mode is currently ON.
              </p>
            ) : null}
          </div>
        </SectionCard>
      </form>
    </div>
  );
}
