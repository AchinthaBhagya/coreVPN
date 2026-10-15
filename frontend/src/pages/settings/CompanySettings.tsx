import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Save, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { fieldErrors, toastError, toastSuccess } from "@/lib/errors";
import { OPTIONS } from "@/lib/status";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { ErrorState, LoadingState } from "@/components/common/states";
import { FieldShell, SelectField, TextField } from "@/components/common/form";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { CompanySettings as CompanySettingsData } from "@/types";

/**
 * Company identity, contact and locale defaults.
 *
 * Contract note (backend/src/routes/settings.routes.ts):
 * - `PUT /settings/company` accepts identity/contact/locale fields only.
 * - Numbering prefixes + finance defaults are owned by `PUT /settings/system`
 *   (`settings.system` permission). They are shown here for reference and can be
 *   edited from this screen only for users who hold BOTH permissions - in that
 *   case the single Save button updates both resources.
 */

interface Opt {
  value: string;
  label: string;
}

const NONE = "__NONE__";

const companySchema = z.object({
  // Identity
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  legalName: z.string().trim().max(200),
  taxId: z.string().trim().max(80),
  // Contact
  email: z
    .string()
    .trim()
    .max(255)
    .refine((value) => value === "" || z.string().email().safeParse(value).success, "Enter a valid email address"),
  phone: z.string().trim().max(40),
  website: z.string().trim().max(255),
  address: z.string().trim().max(1000),
  // Locale & currency
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code (e.g. USD)"),
  secondaryCurrency: z
    .string()
    .refine((value) => value === NONE || /^[A-Za-z]{3}$/.test(value), "Use a 3-letter currency code"),
  exchangeRate: z.string().refine(
    (value) => value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) > 0),
    "Enter a positive exchange rate",
  ),
  timezone: z.string().trim().min(1, "Timezone is required").max(64),
  dateFormat: z.string().trim().min(1, "Date format is required").max(40),
  numberFormat: z.string().trim().min(1, "Number format is required").max(40),
  // Numbering prefixes (system-owned)
  invoicePrefix: z.string().trim().min(1, "Prefix is required").max(20),
  quotationPrefix: z.string().trim().min(1, "Prefix is required").max(20),
  orderPrefix: z.string().trim().min(1, "Prefix is required").max(20),
  projectPrefix: z.string().trim().min(1, "Prefix is required").max(20),
  // Finance defaults (system-owned)
  taxRate: z.string().refine(
    (value) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100,
    "Tax rate must be between 0 and 100",
  ),
  defaultAllocationModel: z.enum(OPTIONS.allocationModel),
  paymentTermsDays: z
    .string()
    .regex(/^\d+$/, "Enter a number of days")
    .refine((value) => Number(value) >= 0 && Number(value) <= 365, "Must be between 0 and 365"),
});

type Values = z.infer<typeof companySchema>;

const EMPTY_VALUES: Values = {
  companyName: "",
  legalName: "",
  taxId: "",
  email: "",
  phone: "",
  website: "",
  address: "",
  currency: "LKR",
  secondaryCurrency: NONE,
  exchangeRate: "",
  timezone: "",
  dateFormat: "",
  numberFormat: "",
  invoicePrefix: "",
  quotationPrefix: "",
  orderPrefix: "",
  projectPrefix: "",
  taxRate: "0",
  defaultAllocationModel: "PERCENT_OF_PROFIT",
  paymentTermsDays: "14",
};

function toValues(data: CompanySettingsData): Values {
  const allocation =
    data.defaultAllocationModel === "FIXED" || data.defaultAllocationModel === "PERCENT_OF_REVENUE"
      ? data.defaultAllocationModel
      : "PERCENT_OF_PROFIT";
  return {
    companyName: data.companyName ?? "",
    legalName: data.legalName ?? "",
    taxId: data.taxId ?? "",
    email: data.email ?? "",
    phone: data.phone ?? "",
    website: data.website ?? "",
    address: data.address ?? "",
    currency: data.currency || "LKR",
    secondaryCurrency: data.secondaryCurrency || NONE,
    exchangeRate: data.exchangeRate ?? "",
    timezone: data.timezone ?? "",
    dateFormat: data.dateFormat ?? "",
    numberFormat: data.numberFormat ?? "",
    invoicePrefix: data.invoicePrefix ?? "",
    quotationPrefix: data.quotationPrefix ?? "",
    orderPrefix: data.orderPrefix ?? "",
    projectPrefix: data.projectPrefix ?? "",
    taxRate: String(data.taxRate ?? "0"),
    defaultAllocationModel: allocation,
    paymentTermsDays: String(data.paymentTermsDays ?? 14),
  };
}

function buildCompanyPayload(values: Values) {
  const secondary = values.secondaryCurrency === NONE ? null : values.secondaryCurrency.toUpperCase();
  return {
    companyName: values.companyName.trim(),
    legalName: values.legalName.trim() || null,
    email: values.email.trim() || null,
    phone: values.phone.trim() || null,
    website: values.website.trim() || null,
    address: values.address.trim() || null,
    taxId: values.taxId.trim() || null,
    currency: values.currency.trim().toUpperCase(),
    secondaryCurrency: secondary,
    exchangeRate: secondary === null || values.exchangeRate.trim() === "" ? null : Number(values.exchangeRate),
    timezone: values.timezone.trim(),
    dateFormat: values.dateFormat.trim(),
    numberFormat: values.numberFormat.trim(),
  };
}

function buildSystemPayload(values: Values) {
  return {
    invoicePrefix: values.invoicePrefix.trim(),
    quotationPrefix: values.quotationPrefix.trim(),
    orderPrefix: values.orderPrefix.trim(),
    projectPrefix: values.projectPrefix.trim(),
    taxRate: Number(values.taxRate),
    defaultAllocationModel: values.defaultAllocationModel,
    paymentTermsDays: Number(values.paymentTermsDays),
  };
}

const CURRENCY_OPTIONS: Opt[] = [
  { value: "LKR", label: "LKR - Sri Lankan Rupee" },
  { value: "USD", label: "USD - US Dollar" },
  { value: "EUR", label: "EUR - Euro" },
  { value: "GBP", label: "GBP - British Pound" },
  { value: "AUD", label: "AUD - Australian Dollar" },
  { value: "CAD", label: "CAD - Canadian Dollar" },
  { value: "INR", label: "INR - Indian Rupee" },
  { value: "SGD", label: "SGD - Singapore Dollar" },
  { value: "AED", label: "AED - UAE Dirham" },
  { value: "JPY", label: "JPY - Japanese Yen" },
];

const SECONDARY_CURRENCY_OPTIONS: Opt[] = [{ value: NONE, label: "None (single currency)" }, ...CURRENCY_OPTIONS];

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

export default function CompanySettings() {
  const { can, canAny } = useAuth();
  const canEdit = can("settings.company");
  const canSystem = can("settings.system");
  const canOperational = canEdit && canSystem;

  const query = useQuery({
    queryKey: ["settings", "company"],
    queryFn: ({ signal }) => api.get<CompanySettingsData>("/settings/company", undefined, signal),
  });

  const form = useForm<Values>({ resolver: zodResolver(companySchema), defaultValues: EMPTY_VALUES });
  const { reset } = form;

  useEffect(() => {
    if (query.data) reset(toValues(query.data));
  }, [query.data, reset]);

  const values = form.watch();
  const { isDirty } = form.formState;

  const mutation = useMutation({
    mutationFn: async (formValues: Values) => {
      const tasks: Promise<unknown>[] = [api.put("/settings/company", buildCompanyPayload(formValues))];
      if (canSystem) tasks.push(api.put("/settings/system", buildSystemPayload(formValues)));
      await Promise.all(tasks);
    },
    onSuccess: () => {
      toastSuccess(
        "Company settings saved",
        canSystem ? "Company profile and operational defaults are up to date." : "Your changes are live.",
      );
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => {
      const errors = fieldErrors(error);
      for (const [key, message] of Object.entries(errors)) {
        if (key in companySchema.shape) form.setError(key as keyof Values, { message });
      }
      toastError(error);
      // A partial save is possible when both endpoints are used - resync.
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const onSubmit = form.handleSubmit((formValues) => mutation.mutate(formValues));

  if (query.isLoading) return <LoadingState label="Loading company settings..." />;

  const data = query.data;
  if (query.isError || !data) {
    return (
      <ErrorState
        title="Couldn't load company settings"
        description={query.error instanceof Error ? query.error.message : "Please try again in a moment."}
        onRetry={() => query.refetch()}
      />
    );
  }

  const secondaryActive = values.secondaryCurrency !== NONE;
  const primaryCurrency = String(values.currency ?? "").toUpperCase();
  const secondaryCurrency = String(values.secondaryCurrency ?? "");

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <PageHeader
          title="Company settings"
          description="Identity, contact details and locale defaults used across invoices, quotations and client documents."
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
            <ShieldAlert />
            <AlertTitle>View-only access</AlertTitle>
            <AlertDescription>
              You can review the company settings, but changing them requires the{" "}
              <span className="font-medium">settings.company</span> permission.
            </AlertDescription>
          </Alert>
        ) : null}

        <SectionCard title="Identity" description="Legal and trading identity printed on documents.">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <TextField
              form={form}
              name="companyName"
              label="Trading name"
              required
              placeholder="3xCode"
              disabled={!canEdit}
            />
            <TextField
              form={form}
              name="legalName"
              label="Legal name"
              placeholder="Registered business entity"
              disabled={!canEdit}
            />
            <TextField
              form={form}
              name="taxId"
              label="Tax / registration no."
              placeholder="VAT123456789"
              disabled={!canEdit}
            />
          </div>
        </SectionCard>

        <SectionCard title="Contact" description="Shown on invoices, quotations and client communication.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              form={form}
              name="email"
              label="Email address"
              type="email"
              placeholder="hello@company.com"
              disabled={!canEdit}
            />
            <TextField form={form} name="phone" label="Phone" placeholder="+94 11 000 0000" disabled={!canEdit} />
            <TextField
              form={form}
              name="website"
              label="Website"
              placeholder="https://company.com"
              className="sm:col-span-2"
              disabled={!canEdit}
            />
            <FieldShell
              label="Address"
              htmlFor="address"
              className="sm:col-span-2"
              description="Postal address printed on documents."
              error={form.formState.errors.address?.message as string | undefined}
            >
              <Textarea
                id="address"
                rows={3}
                placeholder="Street, city, country"
                disabled={!canEdit}
                {...form.register("address")}
              />
            </FieldShell>
          </div>
        </SectionCard>

        <SectionCard
          title="Locale & currency"
          description="Defaults for currencies, dates and numbers across the workspace."
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <SelectField
              form={form}
              name="currency"
              label="Primary currency"
              required
              options={ensureOpt(CURRENCY_OPTIONS, values.currency)}
              disabled={!canEdit}
            />
            <SelectField
              form={form}
              name="secondaryCurrency"
              label="Secondary currency"
              options={ensureOpt(SECONDARY_CURRENCY_OPTIONS, values.secondaryCurrency)}
              disabled={!canEdit}
            />
            <TextField
              form={form}
              name="exchangeRate"
              label="Exchange rate"
              type="number"
              step="any"
              min={0}
              placeholder={secondaryActive ? "e.g. 305.50" : "Add a secondary currency first"}
              description={
                secondaryActive
                  ? `Rate used to convert ${primaryCurrency} and ${secondaryCurrency}.`
                  : "Select a secondary currency to enable the exchange rate."
              }
              disabled={!canEdit || !secondaryActive}
            />
            <SelectField
              form={form}
              name="timezone"
              label="Timezone"
              required
              options={ensureOpt(TIMEZONE_OPTIONS, values.timezone)}
              disabled={!canEdit}
            />
            <SelectField
              form={form}
              name="dateFormat"
              label="Date format"
              required
              options={ensureOpt(DATE_FORMAT_OPTIONS, values.dateFormat)}
              disabled={!canEdit}
            />
            <SelectField
              form={form}
              name="numberFormat"
              label="Number format"
              required
              options={ensureOpt(NUMBER_FORMAT_OPTIONS, values.numberFormat)}
              disabled={!canEdit}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Numbering prefixes"
          description={
            canOperational
              ? "Prefixes prepended to every generated document number."
              : "Editing requires the settings.system permission - these operational defaults are also managed under System settings."
          }
          actions={
            canAny("settings.view", "settings.system") ? (
              <Link to="/settings/system" className="text-xs font-medium text-primary hover:underline">
                System settings &rarr;
              </Link>
            ) : null
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <TextField
              form={form}
              name="invoicePrefix"
              label="Invoice prefix"
              placeholder="INV-"
              disabled={!canOperational}
            />
            <TextField
              form={form}
              name="quotationPrefix"
              label="Quotation prefix"
              placeholder="QT-"
              disabled={!canOperational}
            />
            <TextField form={form} name="orderPrefix" label="Order prefix" placeholder="ORD-" disabled={!canOperational} />
            <TextField
              form={form}
              name="projectPrefix"
              label="Project prefix"
              placeholder="PRJ-"
              disabled={!canOperational}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Finance defaults"
          description={
            canOperational
              ? "Default tax and profit-allocation behaviour for new documents."
              : "Editing requires the settings.system permission - these operational defaults are also managed under System settings."
          }
        >
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
              disabled={!canOperational}
            />
            <SelectField
              form={form}
              name="defaultAllocationModel"
              label="Default allocation model"
              options={ALLOCATION_OPTIONS}
              disabled={!canOperational}
            />
            <TextField
              form={form}
              name="paymentTermsDays"
              label="Payment terms (days)"
              type="number"
              min={0}
              max={365}
              placeholder="14"
              disabled={!canOperational}
            />
          </div>
        </SectionCard>
      </form>
    </div>
  );
}
